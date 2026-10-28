// Protocol follows the official kagglesdk 0.1.38 KernelsApiService.
// Real authenticated API compatibility still requires a live smoke test.
export class ProviderError extends Error {
  constructor(code, message, uncertain = false) { super(message); this.code = code; this.uncertain = uncertain; }
}
export class KaggleProvider {
  constructor(env, fetcher = fetch) { this.env = env; this.fetcher = fetcher; }
  async rpc(method, body) {
    let response;
    try {
      response = await this.fetcher(`https://api.kaggle.com/v1/kernels.KernelsApiService/${method}`, {
        method:'POST', headers:{Authorization:`Bearer ${this.env.KAGGLE_API_TOKEN}`,'Content-Type':'application/json'},
        body:JSON.stringify(body), redirect:'error', signal:AbortSignal.timeout(method === 'SaveKernel' ? 20000 : 6000)
      });
    } catch { throw new ProviderError('UPSTREAM_UNCERTAIN','Kaggleとの通信結果を確認できません。再送せず、状態確認を続けてください。',true); }
    let data;
    try { data = await response.json(); } catch { throw new ProviderError('UPSTREAM_FORMAT','Kaggleから予期しない応答がありました。',true); }
    const details = data.error && typeof data.error==='object' ? data.error : null;
    const status = Math.max(response.status,Number(data.code || details?.code)||0);
    if (!response.ok || status >= 400 || data.error) {
      const reason = String(data.message || details?.message || (typeof data.error==='string' ? data.error : ''));
      if (reason.includes('kernelSessions.enableInternet')) throw new ProviderError('INTERNET_DENIED','KaggleがInternet利用を拒否しました。Kaggleの本人確認・Internet設定・APIトークンの権限を確認してください。');
      if (status === 401 || status === 403) throw new ProviderError('KAGGLE_AUTH','Kaggleの認証または利用権限を確認してください。');
      if (status === 404) throw new ProviderError('KAGGLE_NOT_FOUND','Kaggleに送信先のNotebookが見つかりません。');
      if (status === 429) throw new ProviderError('KAGGLE_LIMIT','Kaggleの利用制限に達しました。無料枠・空き枠を確認してください。');
      throw new ProviderError('KAGGLE_REJECTED','Kaggleが処理を受け付けませんでした。Notebook側の状態を確認してください。',status >= 500);
    }
    return data;
  }
  async submit(slug, notebook) {
    // The official CLI also joins source arrays before submitting notebooks.
    const cells = notebook.cells.map(c=>({...c,source:c.source.join('')}));
    const data = await this.rpc('SaveKernel',{
      slug:`${this.env.KAGGLE_USERNAME}/${slug}`,newTitle:slug.replaceAll('-',' '),
      text:JSON.stringify({...notebook,cells}),language:'python',kernelType:'notebook',
      isPrivate:true,enableGpu:true,enableInternet:true,enableTpu:false,
      machineShape:'NvidiaTeslaT4',sessionTimeoutSeconds:1800,
      datasetDataSources:[],kernelDataSources:[],competitionDataSources:[],modelDataSources:[]
    });
    if (!Number.isInteger(data.versionNumber) || data.versionNumber < 1) throw new ProviderError('UPSTREAM_UNCERTAIN','送信後のバージョンを確認できません。状態を確認してください。',true);
    return data.versionNumber;
  }
  query(record) {
    return {userName:this.env.KAGGLE_USERNAME,kernelSlug:record.slug,...(record.version ? {versionLabel:`v${record.version}`} : {})};
  }
  async status(record) {
    const data = await this.rpc('GetKernelSessionStatus',this.query(record));
    const names = {0:'QUEUED',1:'RUNNING',2:'COMPLETE',3:'ERROR',4:'CANCEL_REQUESTED',5:'CANCEL_ACKNOWLEDGED',6:'NEW_SCRIPT'};
    const state = typeof data.status === 'number' ? names[data.status] : String(data.status || '').toUpperCase();
    if (state === 'COMPLETE') return 'completed';
    if (['ERROR','CANCEL_ACKNOWLEDGED'].includes(state)) return 'failed';
    if (state === 'RUNNING') return 'running';
    if (['QUEUED','NEW_SCRIPT','CANCEL_REQUESTED'].includes(state)) return 'queued';
    throw new ProviderError('UPSTREAM_STATUS','Kaggleの生成状況を判定できません。完了とは扱いません。');
  }
  async output(record) {
    let pageToken;
    for (let page=0;page<5;page++) {
      const data = await this.rpc('ListKernelSessionOutput',{...this.query(record),pageSize:100,...(pageToken ? {pageToken} : {})});
      const file = (data.files || []).find(f=>f.fileName === 'private-ai-studio.mp4');
      if (file?.url) return file.url;
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    throw new ProviderError('OUTPUT_MISSING','Kaggleの処理は終了しましたが、MP4が見つかりません。まだ生成成功とは扱いません。');
  }
  async video(record) {
    let url = await this.output(record);
    // Signed output URLs are short-lived: resolve anew for each download.
    for (let i=0;i<5;i++) {
      const target = new URL(url);
      const host = target.hostname;
      if (target.protocol !== 'https:' || target.username || target.password || target.port || !(host==='storage.googleapis.com' || host==='kaggle.com' || host.endsWith('.kaggle.com') || host.endsWith('.kaggleusercontent.com'))) throw new ProviderError('OUTPUT_HOST','動画の配信元を確認できません。');
      let response;
      try { response = await this.fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(20000)}); }
      catch { throw new ProviderError('OUTPUT_DOWNLOAD','MP4を取得できませんでした。再度取得してください。'); }
      if ([301,302,303,307,308].includes(response.status)) { url = new URL(response.headers.get('location'),url).href; continue; }
      if (!response.ok || !response.body) throw new ProviderError('OUTPUT_DOWNLOAD','MP4を取得できませんでした。再度取得してください。');
      return response;
    }
    throw new ProviderError('OUTPUT_DOWNLOAD','MP4の取得先が繰り返し変更されています。');
  }
}
