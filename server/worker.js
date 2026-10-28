import {makeNotebook,validateJob} from '../notebook.js';
import {KaggleProvider,ProviderError} from './kaggle.js';
const MAX_BODY = 4 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const activeStates = ['submitting','unknown','queued','running','finishing'];
const json = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
function configured(env) {
  return Boolean(env.STUDIO && env.STUDIO_TOKEN?.length >= 32 && env.KAGGLE_API_TOKEN && /^[a-zA-Z0-9_-]+$/.test(env.KAGGLE_USERNAME || '') && env.ALLOWED_ORIGIN);
}
async function authorized(request,env) {
  const supplied = request.headers.get('Authorization') || '';
  const digest = async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [a,b] = await Promise.all([digest(supplied),digest(`Bearer ${env.STUDIO_TOKEN}`)]);
  let diff=0; for(let i=0;i<a.length;i++) diff |= a[i]^b[i];
  return diff===0;
}
export default {
  async fetch(request,env) {
    const origin = request.headers.get('Origin');
    const headers = {'Cache-Control':'no-store','Vary':'Origin'};
    if (origin && origin !== env.ALLOWED_ORIGIN) return json({error:'ORIGIN_DENIED',message:'この画面からの接続は許可されていません。'},403);
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
    let response;
    try {
      const path = new URL(request.url).pathname;
      if (!configured(env)) response=json({error:'NOT_CONFIGURED',message:'中継サーバーの初期設定が完了していません。'},503);
      else if (!await authorized(request,env)) response=json({error:'AUTH_REQUIRED',message:'接続キーを確認してください。'},401);
      else if (request.method==='GET' && path==='/v1/connection') response=json({provider:'kaggle-svd',configured:true,liveGenerationVerified:false});
      else response=await env.STUDIO.get(env.STUDIO.idFromName('owner')).fetch(request);
    } catch { response=json({error:'SERVER_ERROR',message:'サーバーでエラーが発生しました。再送する前に生成状況を確認してください。'},500); }
    const outgoing = new Response(response.body,response);
    for(const [name,value] of Object.entries(headers)) outgoing.headers.set(name,value);
    return outgoing;
  }
};
async function boundedJson(request) {
  const reader=request.body?.getReader();
  if(!reader) throw new Error('リクエストが空です。');
  const chunks=[]; let size=0;
  while(true) { const {value,done}=await reader.read(); if(done) break; size+=value.byteLength; if(size>MAX_BODY) { await reader.cancel(); throw new Error('画像が自動生成の上限を超えています。小さい画像を選んでください。'); } chunks.push(value); }
  const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export class StudioJobs {
  constructor(state,env) { this.state=state; this.env=env; this.provider=new KaggleProvider(env); }
  async fetch(request) {
    const path=new URL(request.url).pathname;
    try {
      if (request.method==='POST' && path==='/v1/jobs') {
        let body;
        try { body=await boundedJson(request); } catch(e) { return json({error:'INVALID_REQUEST',message:e.message},400); }
        return await this.state.blockConcurrencyWhile(()=>this.submit(body));
      }
      const match=path.match(/^\/v1\/jobs\/([a-f0-9-]+)(\/video)?$/);
      if(request.method!=='GET' || !match || !uuid.test(match[1])) return json({error:'NOT_FOUND',message:'生成が見つかりません。'},404);
      if(match[2]) {
        const record=await this.state.storage.get(`job:${match[1]}`);
        if(!record) return json({error:'NOT_FOUND',message:'生成が見つかりません。'},404);
        if(record.status!=='completed') return json({error:'NOT_READY',message:'動画はまだ取得できません。'},409);
        const upstream=await this.provider.video(record);
        return new Response(upstream.body,{headers:{'Content-Type':'video/mp4','Content-Disposition':'attachment; filename="private-ai-studio.mp4"','Cache-Control':'no-store'}});
      }
      return await this.state.blockConcurrencyWhile(()=>this.refresh(match[1]));
    } catch(error) {
      if(error instanceof ProviderError) return json({error:error.code,message:error.message},502);
      return json({error:'SERVER_ERROR',message:'生成状況を確認できません。再送せず、状態を再確認してください。'},500);
    }
  }
  public(record) {
    const {id,status,createdAt,message,code}=record;
    return {id,status,createdAt,message,code,notebookUrl:`https://www.kaggle.com/code/${this.env.KAGGLE_USERNAME}/${record.slug}`};
  }
  async submit({requestId,job}={}) {
    if(!uuid.test(requestId||'')) return json({error:'INVALID_ID',message:'リクエストIDが不正です。'},400);
    try {
      validateJob(job);
      if(job.direction) throw new Error('文章による動作指定はまだ利用できません。');
      if(job.preset!=='light') throw new Error('自動生成は軽量設定のみ対応しています。');
      if(job.imageBase64.length % 4 !== 0 || !/^(\/9j\/|iVBOR|UklGR)/.test(job.imageBase64)) throw new Error('JPEG・PNG・WebPの画像データを確認してください。');
    } catch(e) { return json({error:'INVALID_JOB',message:e.message},400); }
    const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(job))))).map(x=>x.toString(16).padStart(2,'0')).join('');
    const prior=await this.state.storage.get(`job:${requestId}`);
    if(prior) return prior.fingerprint===fingerprint ? json(this.public(prior)) : json({error:'ID_CONFLICT',message:'同じIDで異なる条件を送信できません。'},409);
    const activeId=await this.state.storage.get('activeId');
    if(activeId) {
      const active=await this.state.storage.get(`job:${activeId}`);
      if(active && activeStates.includes(active.status)) return json({error:'BUSY',message:'前の生成を確認してください。同時に複数のGPU生成は開始しません。',activeJob:this.public(active)},409);
    }
    const record={id:requestId,slug:`pas-${requestId}`,fingerprint,createdAt:new Date().toISOString(),status:'submitting',checkedAt:0};
    // Save before the network request: a lost response must never cause a second GPU run.
    await this.state.storage.put({[`job:${requestId}`]:record,activeId:requestId});
    try {
      record.version=await this.provider.submit(record.slug,makeNotebook(job));
      record.status='queued';
    } catch(error) {
      record.status=error instanceof ProviderError && !error.uncertain ? 'failed' : 'unknown';
      record.message=error instanceof ProviderError ? error.message : '送信結果が不明です。再送せず、状態を確認してください。';
      record.code=error.code || 'SUBMIT_UNKNOWN';
    }
    await this.state.storage.put(`job:${requestId}`,record);
    if(record.status==='failed') await this.state.storage.delete('activeId');
    return json(this.public(record),202);
  }
  async refresh(id) {
    const record=await this.state.storage.get(`job:${id}`);
    if(!record) return json({error:'NOT_FOUND',message:'生成が見つかりません。'},404);
    if(['completed','failed'].includes(record.status) || Date.now()-record.checkedAt<15000) return json(this.public(record));
    record.checkedAt=Date.now();
    try {
      record.status=await this.provider.status(record);
      if(record.status==='completed') {
        await this.provider.output(record); // A completed session without an MP4 is not a successful generation.
        record.message='Kaggleでの処理完了とMP4の出力を確認しました。';
      } else if(record.status==='failed') record.message='Kaggleで生成が失敗または停止しました。Notebookの出力を確認してください。';
      else record.message=record.status==='running' ? 'Kaggleで生成処理を実行中です。' : 'Kaggleで実行待ちです。';
      delete record.code;
    } catch(error) {
      if(record.status==='completed') record.status='finishing';
      if(record.status==='unknown' && error.code==='KAGGLE_NOT_FOUND' && Date.now()-Date.parse(record.createdAt)>120000) record.status='failed';
      record.message=error instanceof ProviderError ? error.message : '状態を取得できません。しばらくして再確認してください。';
      record.code=error.code || 'STATUS_ERROR';
    }
    await this.state.storage.put(`job:${id}`,record);
    if(['completed','failed'].includes(record.status)) await this.state.storage.delete('activeId');
    return json(this.public(record));
  }
}
