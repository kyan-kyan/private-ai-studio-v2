import {makeNotebook,validateJob} from './notebook.js';
import {initGeneration} from './generation.js?v=20261028-relay1';
const $ = id => document.getElementById(id);
let imageBase64 = null, videoUrl = null, notebookUrl = null, selectionVersion = 0;
function clearNotebook() {
  if (notebookUrl) URL.revokeObjectURL(notebookUrl);
  notebookUrl = null;
  $('saveNotebook').hidden = true; $('saveNotebook').removeAttribute('href');
}
const settingDefaults = {preset:'light',duration:'2',motion:'127',seed:'42'};
const settingsKey = 'private-ai-studio.settings.v1';
function validSettings(value) {
  if (!value || typeof value !== 'object') return false;
  return ['light','standard'].includes(value.preset) && ['2','3','4'].includes(value.duration)
    && /^\d+$/.test(value.motion) && Number(value.motion) >= 1 && Number(value.motion) <= 255
    && /^\d+$/.test(value.seed) && Number(value.seed) >= 0 && Number(value.seed) <= 4294967295;
}
function applySettings(value) {
  for (const id of Object.keys(settingDefaults)) $(id).value = value[id];
  $('motionValue').textContent = $('motion').value;
}
function saveSettings() {
  const value = Object.fromEntries(Object.keys(settingDefaults).map(id => [id,$(id).value]));
  if (!validSettings(value)) {
    $('settingsStatus').textContent = 'シードは0〜4294967295の整数を入力してください。未入力・不正な設定は保存しません。';
    return;
  }
  try {
    localStorage.setItem(settingsKey,JSON.stringify(value));
    $('settingsStatus').textContent = '設定をこのブラウザに保存しました。画像・動画は保存しません。';
  } catch {
    $('settingsStatus').textContent = 'ブラウザに設定を保存できません。この画面ではそのまま使えます。';
  }
}
try {
  const saved = JSON.parse(localStorage.getItem(settingsKey));
  if (validSettings(saved)) {
    applySettings(saved);
    $('settingsStatus').textContent = '前回の設定を復元しました。画像はもう一度選んでください。';
  } else $('settingsStatus').textContent = '変更した設定だけをこのブラウザに保存します。画像・動画は保存しません。';
} catch {
  $('settingsStatus').textContent = '設定を復元できなかったため初期値で開始しました。';
}
for (const id of Object.keys(settingDefaults)) $(id).addEventListener('input', () => { clearNotebook(); saveSettings(); });
$('resetSettings').addEventListener('click', () => {
  applySettings(settingDefaults); clearNotebook(); saveSettings();
});
function clearImage() {
  selectionVersion++;
  imageBase64 = null;
  clearNotebook();
  $('image').value = ''; $('preview').removeAttribute('src');
  $('previewBox').hidden = $('clear').hidden = true;
  $('export').disabled = true;
  $('status').textContent = '画像を選ぶと保存できます。';
}
$('clear').addEventListener('click', clearImage);
$('motion').addEventListener('input', () => $('motionValue').textContent = $('motion').value);
$('image').addEventListener('change', async event => {
  const file = event.target.files[0];
  clearImage(); $('imageError').textContent = '';
  if (!file) return;
  const version = selectionVersion;
  try {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('JPEG・PNG・WebPの画像を選んでください。HEICはJPEGに変換してください。');
    if (file.size > 20 * 1024 * 1024) throw new Error('画像が20MBを超えています。サイズを小さくしてください。');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, {imageOrientation:'from-image'});
    } catch {
      throw new Error('画像を読み込めませんでした。破損していないJPEG・PNG・WebPを選んでください。');
    }
    try {
      if (version !== selectionVersion) return;
      // Re-encode a bounded image. Removes EXIF and avoids large notebook payloads.
      const scale = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#101010'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const data = canvas.toDataURL('image/jpeg', 0.92);
      imageBase64 = data.split(',')[1];
      $('preview').src = data;
      $('imageInfo').textContent = `${file.name} · ${canvas.width} × ${canvas.height} · 端末内で準備済み`;
      $('previewBox').hidden = $('clear').hidden = false; $('export').disabled = false;
      $('status').textContent = '準備完了。画像入りNotebookを保存できます。';
    } finally { bitmap.close(); }
  } catch(error) {
    if (version !== selectionVersion) return;
    clearImage(); $('imageError').textContent = error.message || '画像を読み込めませんでした。別のJPEG・PNGを選んでください。';
  }
});
$('export').addEventListener('click', () => {
  try {
    const notebook = makeNotebook({provider:'kaggle-svd',imageBase64,preset:$('preset').value,duration:Number($('duration').value),motion:Number($('motion').value),seed:Number($('seed').value)});
    clearNotebook();
    notebookUrl = URL.createObjectURL(new Blob([JSON.stringify(notebook,null,2)],{type:'application/x-ipynb+json'}));
    $('saveNotebook').href = notebookUrl; $('saveNotebook').download = 'private-ai-studio.ipynb';
    $('saveNotebook').hidden = false; $('saveNotebook').click();
    $('status').textContent = 'Notebookの保存を開始しました。Chromeのダウンロード一覧を確認し、次の「Kaggleを開く」へ進んでください。まだ動画は生成されていません。';
  } catch(error) { $('status').textContent = error.message; }
});
$('video').addEventListener('change', event => {
  const file = event.target.files[0];
  $('player').pause(); $('player').removeAttribute('src'); $('player').load();
  $('player').hidden = $('saveVideo').hidden = true; $('saveVideo').removeAttribute('href');
  if(videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null; $('videoStatus').textContent = '';
  if(!file) return;
  if(!file.name.toLowerCase().endsWith('.mp4') && file.type !== 'video/mp4') { $('videoStatus').textContent = 'MP4ファイルを選んでください。'; return; }
  videoUrl = URL.createObjectURL(file);
  $('player').src = videoUrl; $('player').hidden = false;
  $('saveVideo').href = videoUrl; $('saveVideo').download = file.name; $('saveVideo').hidden = false;
  $('videoStatus').textContent = 'MP4を確認中です。';
});
$('player').addEventListener('loadedmetadata', () => {
  const player = $('player');
  $('videoStatus').textContent = `MP4の再生準備ができました。${player.videoWidth} × ${player.videoHeight} · ${Number.isFinite(player.duration) ? player.duration.toFixed(1) + '秒' : '再生時間不明'}`;
});
$('player').addEventListener('error', () => { $('videoStatus').textContent = 'この動画を再生できません。MP4の破損または未対応コーデックを確認してください。'; });

initGeneration({
  getJob: () => {
    const job={provider:'kaggle-svd',imageBase64,preset:$('preset').value,duration:Number($('duration').value),motion:Number($('motion').value),seed:Number($('seed').value)};
    validateJob(job);
    if(job.preset!=='light') throw new Error('自動生成は軽量設定を選んでください。標準設定の自動実行は未検証です。');
    return job;
  },
  onVideo: blob => {
    $('player').pause();
    if(videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl=URL.createObjectURL(blob);
    $('player').src=videoUrl;$('player').hidden=false;
    $('saveVideo').href=videoUrl;$('saveVideo').download='private-ai-studio.mp4';$('saveVideo').hidden=false;
    $('videoStatus').textContent='Kaggleから取得したMP4を確認中です。';
  }
});
