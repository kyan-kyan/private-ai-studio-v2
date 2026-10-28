// This controller never simulates progress or automatically retries a submission.
export function initGeneration({getJob,onVideo}) {
  const $=id=>document.getElementById(id);
  const defaultEndpoint='https://rhjhrwfvlxuijtjoalzb.supabase.co/functions/v1/studio-relay';
  const keyName='private-ai-studio.relay-key.v1',endpointName='private-ai-studio.relay-url.v1',pendingName='private-ai-studio.pending.v1';
  let endpoint='',key='',connected=false,ready=false,busy=false,pending=null,timer=null,fetchingVideo=false,otherJob=null,latestJob=null;
  const say=text=>$('generationStatus').textContent=text;
  function savePending(value) {
    pending=value;
    try { if(value) localStorage.setItem(pendingName,JSON.stringify(value)); else localStorage.removeItem(pendingName); } catch {}
  }
  function update() {
    $('generate').disabled=!connected || !ready || busy || Boolean(pending) || !$('preview').hasAttribute('src');
    $('connectRelay').disabled=busy;
    $('pairRelay').disabled=busy;
    $('viewLatest').disabled=busy || Boolean(pending);
    $('pairingPanel').hidden=connected;
    $('checkGeneration').disabled=!connected || !pending;
    $('fetchResult').disabled=!connected || fetchingVideo;
    $('saveKaggle').disabled=!connected || busy;
  }
  function storeConnection() {
    try { localStorage.setItem(endpointName,endpoint); } catch {}
    try { sessionStorage.setItem(keyName,key); } catch {}
    try { if($('rememberConnection').checked!==false) localStorage.setItem(keyName,key); else localStorage.removeItem(keyName); } catch {}
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
    $('connectionStatus').textContent='サーバーへ接続しています…';
    try {
      const url=new URL($('relayUrl').value.trim());
      if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || !(['','/'].includes(url.pathname) || /^\/functions\/v1\/studio-relay\/?$/.test(url.pathname))) throw new Error('中継サーバーのHTTPSのURLを入力してください。');
      const nextEndpoint=url.origin+url.pathname.replace(/\/$/,'');
      if(pending && pending.endpoint!==nextEndpoint) throw new Error('確認中の生成と同じサーバーに接続してください。');
      const nextKey=$('relayKey').value.trim() || (nextEndpoint===endpoint ? key : '');
      if(nextKey.startsWith('KGAT')) throw new Error('ここにはKaggle APIトークンではなく、中継サーバー専用の接続キーを入力してください。');
      if(nextKey.length<32) throw new Error('専用の接続キーを入力してください。KaggleのAPIトークンはここに入力しません。');
      endpoint=nextEndpoint;key=nextKey;
      const info=await api('/v1/connection');
      if(info.provider!=='kaggle-svd' || !(info.configured===true || info.authenticated===true)) throw new Error('対応する中継サーバーを確認できません。');
      connected=true;ready=info.configured===true;storeConnection();
      $('kaggleSetup').hidden=info.authenticated!==true;$('kaggleSetup').open=!ready;
      if(info.username) $('kaggleUsername').value=info.username;
      $('relayKey').value='';$('connectionDetails').open=false;
      const message=ready ? 'この端末は接続済みです。写真を選んで生成できます。' : 'サーバーに接続しました。Kaggleの初回認証の登録が必要です。';
      $('connectionStatus').textContent=message;say(message);
      if(ready){try{const result=await api('/v1/jobs/latest');latestJob=result.job || null;$('viewLatest').hidden=!latestJob;}catch{latestJob=null;}}
    } catch(error) { const message=error instanceof TypeError ? '通信できませんでした。ネット接続を確認して、もう一度接続してください。' : error.message || '接続できませんでした。';$('connectionStatus').textContent=message;say(message);
      if(ready){try{const result=await api('/v1/jobs/latest');latestJob=result.job || null;$('viewLatest').hidden=!latestJob;}catch{latestJob=null;}} }
    finally { busy=false;update(); }
    if(connected && pending) await check();
    return connected;
  }
  $('connectionFile').addEventListener('change',async event=>{
    const file=event.target.files[0];
    if(!file) return;
    $('importStatus').textContent='接続ファイルを読み込んでいます…';
    try {
      if(file.size>4096) throw new Error('接続ファイルが大きすぎます。');
      const data=JSON.parse(await file.text());
      if(data.schema!=='private-ai-studio-connection-v1' || data.endpoint!==defaultEndpoint || !/^[a-f0-9]{64}$/.test(data.key||'')) throw new Error('このアプリ用の接続ファイルを選んでください。');
      $('relayUrl').value=data.endpoint;$('relayKey').value=data.key;
      $('importStatus').textContent='ファイルを読み込みました。サーバーへ接続中です…';
      const ok=await connect();
      $('importStatus').textContent=ok ? `${file.name || '接続ファイル'}：読み込み・接続が完了しました。` : 'ファイルは読み込みましたが、サーバーへの接続に失敗しました。上の接続状態を確認してください。';
    }catch(error){$('importStatus').textContent=error.message || '接続ファイルを読み込めません。';say($('importStatus').textContent);event.target.value='';}
  });
  $('rememberConnection').addEventListener('change',()=>{if(connected) storeConnection();});
  $('pairRelay').addEventListener('click',async()=>{
    if(busy) return;
    const code=$('pairCode').value.trim();
    if(!/^\d{8}$/.test(code)) {$('connectionStatus').textContent='8桁の接続コードを入力してください。';return;}
    if(pending && pending.endpoint!==defaultEndpoint) {$('connectionStatus').textContent='前回の生成状況を確認してから接続先を変更してください。';return;}
    busy=true;update();$('connectionStatus').textContent='接続コードを確認しています…';
    try {
      endpoint=defaultEndpoint;
      const result=await api('/v1/pair',{code});
      if(!/^[a-f0-9]{64}$/.test(result.key||'')) throw new Error('接続情報を取得できませんでした。');
      key=result.key;storeConnection();
      $('relayUrl').value=endpoint;$('relayKey').value=key;
      await connect();
    }catch(error){$('connectionStatus').textContent=error instanceof TypeError?'通信できませんでした。もう一度接続してください。':error.message || '接続コードを確認できません。';}
    finally {$('pairCode').value='';busy=false;update();}
  });
  $('saveKaggle').addEventListener('click',async()=>{
    if(!connected || busy || pending) return;
    busy=true;update();
    try {
      const result=await api('/v1/setup',{username:$('kaggleUsername').value.trim(),token:$('kaggleToken').value.trim()});
      if(result.configured!==true) throw new Error('Kaggleの設定完了を確認できません。');
      ready=true;$('kaggleSetup').open=false;
      say('KaggleのAPI認証を保存しました。画像を選び「生成」を押してください。実際のGPU利用権限は生成時に確認します。');
    }catch(error){say(error.message || 'Kaggleの認証情報を保存できません。');}
    finally {$('kaggleToken').value='';busy=false;update();}
  });
  $('connectRelay').addEventListener('click',connect);
  $('fetchResult').addEventListener('click',download);
  $('checkGeneration').addEventListener('click',check);
  $('viewLatest').addEventListener('click',async()=>{if(!latestJob || pending)return;savePending({id:latestJob.id,endpoint});say('前回の生成を確認しています。今回の写真は送信していません。');await check();});
  $('resumeOther').addEventListener('click',async()=>{if(!otherJob)return;savePending(otherJob);otherJob=null;$('resumeOther').hidden=true;await check();});
  $('generate').addEventListener('click',async()=>{
    if(!connected || !ready || busy || pending) return;
    let job;
    try { job=getJob(); } catch(error) { say(error.message);return; }
    busy=true;update();
    const requestId=crypto.randomUUID();
    savePending({id:requestId,endpoint});
    say('画像と設定を送信しています。この画像は中継サーバー経由でKaggleのPrivate Notebookに送られます。');
    try { await accept(await api('/v1/jobs',{requestId,job})); }
    catch(error) {
      if(error.data?.activeJob) { savePending(null);otherJob={id:error.data.activeJob.id,endpoint};$('resumeOther').hidden=false;say('別の生成が実行中です。今回の写真は送信していません。「前の生成を確認」から、以前の結果を確認できます。'); }
      else if([400,401,403,413].includes(error.status)) { savePending(null);say(error.message);if(error.status===401) connected=false; }
      else { say('送信結果を確認できません。重複実行を避けるため再送せず、生成状況を確認します。');schedule(); }
    } finally { busy=false;update(); }
  });
  const observer=new MutationObserver(update);observer.observe($('preview'),{attributes:true,attributeFilter:['src']});
  try { $('relayUrl').value=localStorage.getItem(endpointName)||defaultEndpoint; } catch {}
  try {
    const stored=JSON.parse(localStorage.getItem(pendingName));
    if(stored && /^[a-f0-9-]{36}$/.test(stored.id) && typeof stored.endpoint==='string') pending=stored;
  } catch {}
  try { const storedKey=localStorage.getItem(keyName)||sessionStorage.getItem(keyName);if(storedKey) $('relayKey').value=storedKey; } catch {}
  if(pending) say('前回の生成記録があります。同じ中継サーバーに接続すると状況を確認します。');
  update();
  if($('relayUrl').value && $('relayKey').value) connect();
  return {update};
}
