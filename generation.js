// This controller never simulates progress or automatically retries a submission.
export function initGeneration({getJob,onVideo}) {
  const $=id=>document.getElementById(id);
  const defaultEndpoint='https://rhjhrwfvlxuijtjoalzb.supabase.co/functions/v1/studio-relay';
  const keyName='private-ai-studio.relay-key.v1',endpointName='private-ai-studio.relay-url.v1',pendingName='private-ai-studio.pending.v1';
  let endpoint='',key='',connected=false,ready=false,busy=false,pending=null,timer=null,fetchingVideo=false,otherJob=null,latestJob=null;
  const say=text=>$('generationStatus').textContent=text;
  let progressTimer=null,lastRecord=null,lastConfirmed=null;
  function showProgress(record) {
    clearTimeout(progressTimer);
    if(record) {lastRecord=record;lastConfirmed=Date.now();}
    const active=Boolean(pending && lastRecord && lastRecord.id===pending.id);
    $('generationProgress').hidden=!active;
    if(!active) return;
    const phases={submitting:'送信中',unknown:'送信結果を確認中',queued:'実行待ち',running:'Kaggleで処理中',finishing:'出力を確認中',completed:'動画を取得中',failed:'失敗・停止'};
    $('progressPhase').textContent=phases[lastRecord.status] || '状態確認中';
    const started=Date.parse(lastRecord.createdAt);
    const elapsed=Number.isFinite(started)?Math.max(0,Math.floor((Date.now()-started)/1000)):null;
    $('progressElapsed').textContent=elapsed===null?'開始時刻を確認中':`送信からの経過：${Math.floor(elapsed/60)}分${String(elapsed%60).padStart(2,'0')}秒`;
    const age=Math.max(0,Math.floor((Date.now()-lastConfirmed)/1000));
    $('progressChecked').textContent=`サーバー応答の最終確認：${age}秒前。15秒ごとに状態を確認します。`;
    $('progressReference').textContent=elapsed!==null && elapsed>900
      ? '前回の実測9分25秒を超えています。15分以上経過していますが、完了時刻や計算の進み具合はAPIから確認できません。Kaggleの詳細も確認してください。'
      : '参考：軽量設定の前回実測は約9分25秒（1件）。完了時刻を保証する目安ではありません。';
    $('progressActivity').hidden=['failed','completed'].includes(lastRecord.status);
    progressTimer=setTimeout(()=>showProgress(),1000);
  }
  function savePending(value) {
    pending=value;
    if(!value) {clearTimeout(progressTimer);lastRecord=null;$('generationProgress').hidden=true;}
    try { if(value) localStorage.setItem(pendingName,JSON.stringify(value)); else localStorage.removeItem(pendingName); } catch {}
  }
  function update() {
    $('generate').disabled=busy;
    $('generate').textContent=busy ? '処理中…' : pending ? '生成状況を確認' : '生成';
    $('checkGeneration').hidden=!pending;
    $('pairRelay').disabled=busy;
    $('viewLatest').disabled=busy || Boolean(pending);
    $('pairingPanel').hidden=connected;
    $('checkGeneration').disabled=!connected || !pending;
    $('fetchResult').disabled=!connected || fetchingVideo;
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
    showProgress(record);
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
    clearTimeout(timer); connected=false;ready=false;busy=true;update();
    $('connectionStatus').textContent='サーバーへ接続しています…';
    try {
      endpoint=defaultEndpoint;
      if(pending && pending.endpoint!==endpoint) throw new Error('以前の生成記録の接続先が異なります。');
      if(key.length<32 || key.startsWith('KGAT')) throw new Error('初回の接続コードでこの端末を接続してください。');
      const info=await api('/v1/connection');
      if(info.provider!=='kaggle-svd' || !(info.configured===true || info.authenticated===true)) throw new Error('対応する中継サーバーを確認できません。');
      connected=true;ready=info.configured===true;storeConnection();
      const message=ready ? 'この端末は接続済みです。写真を選んで生成できます。' : 'サーバーの生成設定が完了していません。管理側での確認が必要です。';
      $('connectionStatus').textContent=message;say(message);
      if(ready){try{const result=await api('/v1/jobs/latest');latestJob=result.job || null;$('viewLatest').hidden=!latestJob;}catch{latestJob=null;}}
    } catch(error) { const message=error instanceof TypeError ? '通信できませんでした。ネット接続を確認して、もう一度接続してください。' : error.message || '接続できませんでした。';$('connectionStatus').textContent=message;say(message);
      if(ready){try{const result=await api('/v1/jobs/latest');latestJob=result.job || null;$('viewLatest').hidden=!latestJob;}catch{latestJob=null;}} }
    finally { busy=false;update(); }
    if(connected && pending) await check();
    return connected;
  }
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
      await connect();
    }catch(error){$('connectionStatus').textContent=error instanceof TypeError?'通信できませんでした。もう一度接続してください。':error.message || '接続コードを確認できません。';}
    finally {$('pairCode').value='';busy=false;update();}
  });
  $('fetchResult').addEventListener('click',download);
  $('checkGeneration').addEventListener('click',check);
  $('viewLatest').addEventListener('click',async()=>{if(!latestJob || pending)return;savePending({id:latestJob.id,endpoint});say('前回の生成を確認しています。今回の写真は送信していません。');await check();});
  $('resumeOther').addEventListener('click',async()=>{if(!otherJob)return;savePending(otherJob);otherJob=null;$('resumeOther').hidden=true;await check();});
  $('generate').addEventListener('click',async()=>{
    if(busy) return;
    if(!connected) {
      const message='まだ端末が接続されていません。上の接続コードを入力して「この端末を接続」を押してください。';
      say(message);$('connectionStatus').textContent=message;$('pairCode').focus();return;
    }
    if(!ready) {say('サーバーの生成設定を確認する必要があります。写真はまだ送信していません。');return;}
    if(pending) {say('実行中の生成状況を確認しています。');await check();return;}
    if(!$('preview').hasAttribute('src')) {say('まず「画像を選ぶ」から元の写真を選んでください。');$('image').focus();return;}
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
  try {
    const stored=JSON.parse(localStorage.getItem(pendingName));
    if(stored && /^[a-f0-9-]{36}$/.test(stored.id) && typeof stored.endpoint==='string') pending=stored;
  } catch {}
  try { const storedKey=localStorage.getItem(keyName)||sessionStorage.getItem(keyName);if(storedKey) key=storedKey; } catch {}
  if(pending) say('前回の生成記録があります。同じ中継サーバーに接続すると状況を確認します。');
  update();
  if(key) connect();
  return {update};
}
