import {makeNotebook} from './notebook.js';
const $ = id => document.getElementById(id);
let imageBase64 = null, videoUrl = null, notebookUrl = null, selectionVersion = 0;
function clearNotebook() {
  if (notebookUrl) URL.revokeObjectURL(notebookUrl);
  notebookUrl = null;
  $('saveNotebook').hidden = true; $('saveNotebook').removeAttribute('href');
}
for (const id of ['duration','motion','seed','preset']) $(id).addEventListener('input', clearNotebook);
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
    $('status').textContent = 'Notebookの保存を開始しました。まだ動画は生成されていません。KaggleへPrivateでインポートしてください。';
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
  $('videoStatus').textContent = 'この端末のMP4を読み込みました。';
});
$('player').addEventListener('error', () => { $('videoStatus').textContent = 'この動画を再生できません。MP4の破損または未対応コーデックを確認してください。'; });
