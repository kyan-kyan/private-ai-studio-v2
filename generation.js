// This controller never simulates progress or automatically retries a submission.
export function initGeneration({getJob,onVideo}) {
  const $=id=>document.getElementById(id);
  const keyName='private-ai-studio.relay-key.v1',endpointName='private-ai-studio.relay-url.v1',pendingName='private-ai-studio.pending.v1';
  let endpoint='',key='',connected=false,busy=false,pending=null,timer=null,fetchingVideo=false;
  const say=text=>$('generationStatus').textContent=text;
  function savePending(value) {
    pending=value;
    try { if(value) localStorage.setItem(pendingName,JSON.stringify(value)); else localStorage.removeItem(pendingName); } catch {}
  }
  function update() {
    $('generate').disabled=!connected || busy || Boolean(pending) || !$('preview').hasAttribute('src');
    $('connectRelay').disabled=busy;
    $('checkGeneration').disabled=!connected || !pending;
    $('fetchResult').disabled=!connected || fetchingVideo;
  }
  function storeConnection() {
    try { localStorage.setItem(endpointName,endpoint); } catch {}
    try { sessionStorage.setItem(keyName,key); } catch {}
  }
  async function api(path,body) {
    const response=await fetch(endpoint+path,{
      method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)
    });
    if(path.endsWith('/video') && response.ok) return response.blob();
    let data;
    try { data=await response.json(); } catch { throw new Error('サーバーの応答を読み取れません。再送せず、状態を確認してください。'); }
    if(!response.ok) {
      const error=new Error(data.message || 'サーバーに接続できません。');
      error.status=response.status;error.data=data;throw error;
    }
    return data;
  }
  function resultLink(url) {
    $('jobNotebook').hidden=true;
    try {
      const parsed=new URL(url);
      if(parsed.origin==='https://www.kaggle.com' && parsed.pathname.startsWith('/code/')) {
        $('jobNotebook').href=parsed.href;$('jobNotebook').hidden=false;
      }
    } catch {}
  }
  function schedule() { clearTimeout(timer); timer=setTimeout(()=>check().catch(()=>{}),15000); }
  async function accept(record) {
    if(!record || record.id!==pending?.id) throw new Error('生成IDを確認できません。');
    resultLink(record.notebookUrl);
    const messages={submitting:'Kaggleへ送信中です。',unknown:'送信結果を確認中です。重複実行を避けるため再送しません。',queued:'Kaggleの実行待ちです。',running:'Kaggleで生成中です。',finishing:'出力の確認待ちです。',completed:'MP4の出力を確認しました。動画を取得します。',failed:'Kaggleで生成が失敗または拒否されました。'};
    say(record.message || messages[record.status] || '生成状況を確認しています。');
    $('fetchResult').hidden=record.status!=='completed';
    if(record.status==='completed') {
      busy=false;update();
      await download();
    } else if(record.status==='failed') { savePending(null);busy=false;clearTimeout(timer);update(); }
    else { busy=false;update();schedule(); }
  }
  async function check() {
    if(!connected || !pending) return;
    try { await accept(await api(`/v1/jobs/${pending.id}`)); }
    catch(error) {
      busy=false;
      if(error.status===404) { clearTimeout(timer);savePending(null);say('サーバーに生成記録がありません。送信前の状態に戻りました。'); }
      else if(error.status===401) { connected=false;clearTimeout(timer);say('接続キーが失効または不一致です。再接続すると生成状況を確認できます。'); }
      else { say(`${error.message || '通信が切れました。'} 生成を再送せず、15秒後に状態を再確認します。`);schedule(); }
      update();
    }
  }
  async function download() {
    if(!pending || fetchingVideo) return;
    fetchingVideo=true;update();
    try {
      const blob=await api(`/v1/jobs/${pending.id}/video`);
      if(!blob.size) throw new Error('動画が空です。');
      const bytes=new Uint8Array(await blob.slice(0,12).arrayBuffer());
      if(String.fromCharCode(...bytes.slice(4,8))!=='ftyp') throw new Error('取得したファイルがMP4形式ではありません。');
      onVideo(blob);
      say('MP4を取得しました。下のプレーヤーで再生・保存できます。');
      savePending(null);$('fetchResult').hidden=true;clearTimeout(timer);
    } catch(error) { say(`動画を取得できませんでした。${error.message} 「動画を再取得」で再試行できます。`); }
    finally { fetchingVideo=false;update(); }
  }
  async function connect() {
    clearTimeout(timer); connected=false;busy=true;update();
    try {
      const url=new URL($('relayUrl').value.trim());
      if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new Error('中継サーバーのHTTPSのURLを入力してください。');
      const nextEndpoint=url.origin;
      if(pending && pending.endpoint!==nextEndpoint) throw new Error('確認中の生成と同じサーバーに接続してください。');
      const nextKey=$('relayKey').value.trim() || (nextEndpoint===endpoint ? key : '');
      if(nextKey.startsWith('KGAT')) throw new Error('ここにはKaggle APIトークンではなく、中継サーバー専用の接続キーを入力してください。');
      if(nextKey.length<32) throw new Error('専用の接続キーを入力してください。KaggleのAPIトークンはここに入力しません。');
      endpoint=nextEndpoint;key=nextKey;
      const info=await api('/v1/connection');
      if(info.provider!=='kaggle-svd' || info.configured!==true) throw new Error('対応する中継サーバーを確認できません。');
      connected=true;storeConnection();
      $('relayKey').value='';$('connectionDetails').open=false;
      say('中継サーバーに接続しました。Kaggleの認証・GPU利用権限は生成送信時に確認します。');
    } catch(error) { say(error.message || '接続できませんでした。URLと接続キーを確認してください。'); }
    finally { busy=false;update(); }
    if(connected && pending) await check();
  }
  $('connectRelay').addEventListener('click',connect);
  $('fetchResult').addEventListener('click',download);
  $('checkGeneration').addEventListener('click',check);
  $('generate').addEventListener('click',async()=>{
    if(!connected || busy || pending) return;
    let job;
    try { job=getJob(); } catch(error) { say(error.message);return; }
    busy=true;update();
    const requestId=crypto.randomUUID();
    savePending({id:requestId,endpoint});
    say('画像と設定を送信しています。この画像は中継サーバー経由でKaggleのPrivate Notebookに送られます。');
    try { await accept(await api('/v1/jobs',{requestId,job})); }
    catch(error) {
      if(error.data?.activeJob) { savePending({id:error.data.activeJob.id,endpoint});await accept(error.data.activeJob); }
      else if([400,401,403,413].includes(error.status)) { savePending(null);say(error.message);if(error.status===404) { clearTimeout(timer);savePending(null);say('サーバーに生成記録がありません。送信前の状態に戻りました。'); }
      else if(error.status===401) connected=false; }
      else { say('送信結果を確認できません。重複実行を避けるため再送せず、生成状況を確認します。');schedule(); }
    } finally { busy=false;update(); }
  });
  const observer=new MutationObserver(update);observer.observe($('preview'),{attributes:true,attributeFilter:['src']});
  try { $('relayUrl').value=localStorage.getItem(endpointName)||''; } catch {}
  try {
    const stored=JSON.parse(localStorage.getItem(pendingName));
    if(stored && /^[a-f0-9-]{36}$/.test(stored.id) && typeof stored.endpoint==='string') pending=stored;
  } catch {}
  try { const storedKey=sessionStorage.getItem(keyName);if(storedKey) $('relayKey').value=storedKey; } catch {}
  if(pending) say('前回の生成記録があります。同じ中継サーバーに接続すると状況を確認します。');
  update();
  if($('relayUrl').value && $('relayKey').value) connect();
  return {update};
}
