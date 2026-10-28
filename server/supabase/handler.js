import {makeNotebook,validateJob} from './notebook.js';
import {KaggleProvider,ProviderError} from './kaggle.js';
const ORIGIN='https://kyan-kyan.github.io';
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function readJson(request,max=4*1024*1024) {
  const reader=request.body?.getReader();if(!reader) throw new Error('データがありません。');
  let size=0;const chunks=[];
  while(true) {const {done,value}=await reader.read();if(done) break;size+=value.length;if(size>max){await reader.cancel();throw new Error('送信データが大きすぎます。画像を小さくしてください。');}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  try {return JSON.parse(new TextDecoder().decode(bytes));} catch {throw new Error('データ形式が正しくありません。');}
}
function publicJob(record,username) {
  const {id,status,createdAt,message,code}=record;
  return {id,status,createdAt,message,code,notebookUrl:`https://www.kaggle.com/code/${username}/${record.slug}`};
}
export function createHandler(db,{providerFactory=credentials=>new KaggleProvider({KAGGLE_USERNAME:credentials.kaggle_username,KAGGLE_API_TOKEN:credentials.token})}={}) {
 return async request=>{
  const origin=request.headers.get('Origin');
  const cors={'Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'};
  if(origin && origin!==ORIGIN) return json({error:'ORIGIN_DENIED',message:'この画面からは接続できません。'},403);
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
  let response;
  try {
    const path=new URL(request.url).pathname.replace(/^\/studio-relay/,'').replace(/^\/functions\/v1\/studio-relay/,'');
    if(request.method==='GET' && path==='/health') response=json({service:'private-ai-studio-relay',version:1,liveGenerationVerified:false});
    else {
      const config=await db.config();
      if(!config?.token_hash) response=json({error:'NOT_CONFIGURED',message:'中継サーバーの初期設定中です。'},503);
      else {
        const auth=request.headers.get('Authorization')||'';
        const actual=await hash(auth.startsWith('Bearer ')?auth.slice(7):'');
        let difference=0;for(let i=0;i<64;i++) difference |= actual.charCodeAt(i) ^ config.token_hash.charCodeAt(i);
        if(difference!==0) response=json({error:'AUTH_REQUIRED',message:'個人用の接続設定を取り込んでください。'},401);
        else if(request.method==='GET' && path==='/v1/connection') response=json({provider:'kaggle-svd',configured:Boolean(config.kaggle_secret_id),authenticated:true,needsSetup:!config.kaggle_secret_id,username:config.kaggle_username,liveGenerationVerified:false});
        else if(request.method==='POST' && path==='/v1/setup') {
          let data;try {data=await readJson(request,8192);}catch(e){return withCors(json({error:'INVALID_REQUEST',message:e.message},400),cors);}
          if(!data || !/^[a-zA-Z0-9_-]{3,64}$/.test(data.username||'') || typeof data.token!=='string' || !data.token.startsWith('KGAT') || data.token.length<20 || data.token.length>4096 || /\s/.test(data.token)) response=json({error:'INVALID_CREDENTIALS',message:'Kaggleユーザー名とAPIトークンを確認してください。Googleのパスワードは入力しません。'},400);
          else if(!await db.setup(data.username,data.token)) response=json({error:'BUSY',message:'生成中はKaggleの接続設定を変更できません。'},409);
          else response=json({configured:true,message:'KaggleのAPI認証を保存しました。実際の利用権限は生成時に確認します。'});
        } else if(!config.kaggle_secret_id) response=json({error:'KAGGLE_NOT_CONFIGURED',message:'初回のKaggle API認証の登録が必要です。'},503);
        else {
          const credentials=await db.credentials();
          if(!credentials?.token) return withCors(json({error:'KAGGLE_NOT_CONFIGURED',message:'KaggleのAPI認証を読み込めません。'},503),cors);
          const provider=providerFactory(credentials);
          if(request.method==='POST' && path==='/v1/jobs') {
            let data;try {data=await readJson(request);}catch(e){return withCors(json({error:'INVALID_REQUEST',message:e.message},400),cors);}
            const {requestId,job}=data||{};
            if(!ID.test(requestId||'')) response=json({error:'INVALID_ID',message:'生成IDが正しくありません。'},400);
            else {
              try {
                validateJob(job);
                if(job.direction) throw new Error('文章による動作指定はまだ利用できません。');
                if(job.preset!=='light') throw new Error('自動生成は軽量設定のみ対応しています。');
                if(job.imageBase64.length%4!==0 || !/^(\/9j\/|iVBOR|UklGR)/.test(job.imageBase64)) throw new Error('画像データを確認してください。');
              }catch(e){return withCors(json({error:'INVALID_JOB',message:e.message},400),cors);}
              const record={id:requestId,slug:`pas-${requestId}`,fingerprint:await hash(JSON.stringify(job)),status:'submitting',createdAt:new Date().toISOString(),checkedAt:0};
              const claim=await db.claim(record);
              if(claim.prior) response=claim.prior.fingerprint===record.fingerprint ? json(publicJob(claim.prior,config.kaggle_username)) : json({error:'ID_CONFLICT',message:'同じ生成IDで異なる条件を送信できません。'},409);
              else if(claim.active) response=json({error:'BUSY',message:'前の生成を確認します。',activeJob:publicJob(claim.active,config.kaggle_username)},409);
              else {
                try {record.version=await provider.submit(record.slug,makeNotebook(job));record.status='queued';}
                catch(e){record.status=e instanceof ProviderError && !e.uncertain ? 'failed':'unknown';record.code=e.code||'SUBMIT_UNKNOWN';record.message=e instanceof ProviderError ? e.message:'送信結果が不明です。再送せず、状況を確認してください。';}
                await db.save(record);response=json(publicJob(record,config.kaggle_username),202);
              }
            }
          } else {
            const match=path.match(/^\/v1\/jobs\/([a-f0-9-]+)(\/video)?$/);
            if(request.method!=='GET' || !match || !ID.test(match[1])) response=json({error:'NOT_FOUND',message:'生成が見つかりません。'},404);
            else if(match[2]) {
              const record=await db.get(match[1]);
              if(!record) response=json({error:'NOT_FOUND',message:'生成が見つかりません。'},404);
              else if(record.status!=='completed') response=json({error:'NOT_READY',message:'MP4の出力はまだ確認できていません。'},409);
              else {const video=await provider.video(record);response=new Response(video.body,{headers:{'Content-Type':'video/mp4','Content-Disposition':'attachment; filename="private-ai-studio.mp4"'}});}
            } else {
              const claim=await db.claimPoll(match[1]);
              if(claim.missing) response=json({error:'NOT_FOUND',message:'生成が見つかりません。'},404);
              else {
                const record=claim.record;
                if(!claim.cached) {
                  try {
                    record.status=await provider.status(record);
                    if(record.status==='completed'){await provider.output(record);record.message='MP4の出力を確認しました。';}
                    else if(record.status==='failed')record.message='Kaggleで生成が失敗または停止しました。';
                    else record.message=record.status==='running'?'Kaggleで生成中です。':'Kaggleの実行待ちです。';
                    delete record.code;
                  }catch(e){
                    if(record.status==='completed')record.status='finishing';
                    if(['submitting','unknown'].includes(record.status) && e.code==='KAGGLE_NOT_FOUND' && Date.now()-Date.parse(record.createdAt)>120000)record.status='failed';
                    record.message=e instanceof ProviderError?e.message:'状況を確認できません。再送せず、しばらく待ってください。';record.code=e.code||'STATUS_ERROR';
                  }
                  await db.save(record);
                }
                response=json(publicJob(record,config.kaggle_username));
              }
            }
          }
        }
      }
    }
  }catch(e){response=e instanceof ProviderError?json({error:e.code,message:e.message},502):json({error:'SERVER_ERROR',message:'サーバーでエラーが発生しました。再送せず、状態を再確認してください。'},500);}
  return withCors(response,cors);
 };
}
function withCors(response,cors){const result=new Response(response.body,response);for(const [k,v]of Object.entries(cors))result.headers.set(k,v);return result;}
