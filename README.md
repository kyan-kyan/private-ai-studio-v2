# Private AI Studio v2

PixelのChromeで使う、個人向け画像→動画ワークフロー。会社PC不要。GitHub Pagesの静的画面で画像を準備し、画像入りNotebookをKaggleのGPUで実行します。

## 現在の状態

|機能|状態|
|---|---|
|スマホ向け画面・画像プレビュー|実装済み。ブラウザ／モバイル相当幅で確認、実機未確認|
|画像を埋め込んだNotebook出力|実装済み。JSON・Python構文・画像データ往復をテスト|
|SVDで画像→動画・MP4書き出し|Notebookコード実装済み。今回のKaggle実生成は未検証|
|MP4のローカル再生／保存|実装済み。テストMP4の読み込み確認、実機と保存完了は未確認|
|画像生成・文章による動作指定|未実装。SVDはテキスト制御に非対応|
|WebからKaggleへの直接実行|未実装。手動インポート方式|
|GitHub Pages公開|設定中|

以前に利用者が成功したKaggle T4のテストと、この新しいNotebookの動作検証は別です。

## スマホでの手順

1. Web画面でJPEG・PNG・WebPを選び、時間・動きの強さ・シードを設定。
2. 「画像入りNotebookを保存」で `.ipynb` をダウンロード。
3. KaggleのCodeからNew Notebookを作成し、File → Import Notebookで読み込む。
4. **Private**を確認。GPU T4とInternet ONを設定し、Run All。
5. 最後のセルの `private-ai-studio.mp4` を保存。画面の「保存済みのMP4を選ぶ」で再生。

初回はモデルのダウンロードに時間がかかります。Kaggleへのログイン・GPU利用資格・空き枠が必要です。無料枠はアカウントの現状を確認してください。初期費用0円を優先し、有料リソースへの自動切り替えはありません。

## 仕様と制限

- 入力は20MBまで。端末内で最大辺1536pxのJPEGに変換し、EXIFを除去して埋め込みます。
- Notebook内で画像を1024×576に余白付きで調整。端末固有のファイルパスには依存しません。
- SVDで14フレームを生成。約2/3/4秒は7/5/4fpsでの再生です。長さを延ばす追加生成ではありません。
- 動きの強さはmotion_bucket_id。文章での動作指示は利用できません。
- T4のメモリ節約のためfp16・CPU offload・forward chunking・decode_chunk_size=1を使用。2枚のT4を1枚分のVRAMとしては扱いません。
- 画像はこのWeb画面から外部へ送信しません。画像・生成動画は画面の再読み込み後まで保持しません。
- Notebookには画像を含みます。GitHubへのコミットやKaggleでの公開は避けてください。
- APIキーを静的画面に入力／保存する設計ではありません。
- MP4は端末上のファイルを読み込みます。GPUからの自動回収は未実装です。

## 公開

リポジトリのSettings → Pages → Deploy from a branch → main / (root) → Save。
公開先はPages設定に表示されたURLで確認します。公開画面には認証がないため秘密情報を追加しないでください。名称のPrivateは個人用途を表し、ページの閲覧制限を意味しません。

## 開発・検証

依存パッケージ不要のHTML/CSS/ES Modules。`npm test`（NodeとPython）でNotebook JSON、Python構文、埋め込みデータ、入力検証を確認します。これはGPU生成の成功を保証するテストではありません。

`notebook.js`のジョブ形式とエクスポーターを分離しています。将来のクラウドGPU／個人GPUは新しいプロバイダーを追加し、認証を持つバックエンド経由で接続します。

## 次の開発タスク

1. GitHub Pagesを有効化し、公開画面を確認。
2. Pixel Chromeで画像選択、Notebook保存、Kaggleインポートを実機検証。
3. このNotebookをKaggle T4で実行し、generation-report.jsonと実MP4を確認。失敗時はgeneration-error.jsonで原因を修正。
4. 実生成成功後、依存ライブラリ・モデルリビジョンを検証済み構成として固定。
5. 文章での動作制御に対応したモデルと画像生成を追加検討。
6. 安全な認証を備えたGPUプロバイダーを追加し、直接実行／進捗／動画回収を実装。

公式参考: [SVDモデル](https://huggingface.co/stabilityai/stable-video-diffusion-img2vid)、[Diffusers SVD](https://huggingface.co/docs/diffusers/api/pipelines/stable_diffusion/svd)、[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)。

詳細は[検証記録](VALIDATION.md)を参照。
