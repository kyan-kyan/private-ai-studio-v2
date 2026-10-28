# Private AI Studio v2

PixelのChromeで使う、個人向け画像→動画ワークフロー。会社PC不要。GitHub Pagesの静的画面で画像を準備し、画像入りNotebookをKaggleのGPUで実行します。

## 現在の状態

|機能|状態|
|---|---|
|スマホ向け画面・画像プレビュー|実装済み。ブラウザ／モバイル相当幅で確認、実機未確認|
|画像を埋め込んだNotebook出力|公開画面からの実ダウンロードとKaggleへの取り込みを確認済み|
|SVDで画像→動画・MP4書き出し|軽量設定でKaggle T4の実生成・MP4取得を確認済み。標準は未検証|
|MP4のローカル再生／保存|生成した実MP4でWeb再生・再保存を確認済み。Pixel実機は未確認|
|画像生成・文章による動作指定|未実装。SVDはテキスト制御に非対応|
|WebからKaggleへの直接実行|未実装。手動インポート方式|
|GitHub Pages公開|公開済み。公開画面からの画像入りNotebook保存成功|

以前に利用者が成功したKaggle T4のテストと、この新しいNotebookの動作検証は別です。

公開URL: https://kyan-kyan.github.io/private-ai-studio-v2/

## スマホでの手順

1. Web画面でJPEG・PNG・WebPを選び、時間・動きの強さ・シードを設定。
2. 「画像入りNotebookを保存」で `.ipynb` をダウンロード。
3. KaggleのCodeからNew Notebookを作成し、File → Import Notebookで読み込む。
4. **Private**を確認。GPU T4とInternet ONを設定し、Run All。
5. 最後のセルの `private-ai-studio.mp4` を保存。画面の「保存済みのMP4を選ぶ」で再生。

初回はモデルのダウンロードに時間がかかります。Kaggleへのログイン・GPU利用資格・空き枠が必要です。無料枠はアカウントの現状を確認してください。初期費用0円を優先し、有料リソースへの自動切り替えはありません。

画面内にスマホ向けのメニュー案内、手動チェックリスト、MP4の取り出し方、GPU停止手順を用意しています。チェックは生成状況の自動取得ではありません。

## 仕様と制限

- 入力は20MBまで。端末内で最大辺1536pxのJPEGに変換し、EXIFを除去して埋め込みます。
- Notebook内で選択した解像度に余白付きで調整。端末固有のファイルパスには依存しません。
- 初期値は軽量576×320・15推論ステップ。標準1024×576・25ステップも選択可能。標準はT4実測で1ステップ約83秒かかったため、初回は軽量を推奨。標準での生成完了は未検証。
- SVDで14フレームを生成。約2/3/4秒は7/5/4fpsでの再生です。長さを延ばす追加生成ではありません。
- 動きの強さはmotion_bucket_id。文章での動作指示は利用できません。
- T4のメモリ節約のためfp16・CPU offload・forward chunking・decode_chunk_size=1を使用。2枚のT4を1枚分のVRAMとしては扱いません。
- 画像はこのWeb画面から外部へ送信しません。画像・生成動画は画面の再読み込み後まで保持しません。画質・再生時間・動きの強さ・シードのみ、このブラウザのlocalStorageに保存します。保存が使えない環境でも利用できます。
- Notebookには画像を含みます。GitHubへのコミットやKaggleでの公開は避けてください。
- APIキーを静的画面に入力／保存する設計ではありません。
- MP4は端末上のファイルを読み込みます。GPUからの自動回収は未実装です。

## 公開

リポジトリのSettings → Pages → Deploy from a branch → main / (root) → Save。
公開先はPages設定に表示されたURLで確認します。公開画面には認証がないため秘密情報を追加しないでください。名称のPrivateは個人用途を表し、ページの閲覧制限を意味しません。

## 開発・検証

依存パッケージ不要のHTML/CSS/ES Modules。`npm test`（NodeとPython）でNotebook JSON、Python構文、埋め込みデータ、入力検証を確認します。これはGPU生成の成功を保証するテストではありません。

`notebook.js`のジョブ形式とエクスポーターを分離しています。将来のクラウドGPU／個人GPUは新しいプロバイダーを追加し、認証を持つバックエンド経由で接続します。

## 実生成の確認結果

公開画面から保存したNotebookをKaggleのPrivate Notebookに取り込み、Tesla T4でSVD生成に成功しました。軽量576×320・14フレーム・15ステップ・seed123・再生5fps。MP4はH.264・2.8秒・18,092バイトでした。生成セルの実行時間は435.5秒で、モデル取得済みのセッションでの計測です。初回は環境・モデル取得の時間が追加されます。

実MP4をKaggleからダウンロードし、公開Web画面に読み込んで再生終了まで確認。Web画面から再保存したファイルも元ファイルとバイト一致しました。これで全ての入力画像の成功を保証するものではありません。

## 次の開発タスク

1. Pixel Chrome実機で画像選択・Notebook保存・Kaggleインポートを確認。
2. 認証を持つバックエンドを設け、GPUへの直接送信・進捗表示・動画回収を実装。
3. 文章で動作を制御できるモデルを検討。SVDは非対応。
4. 画像生成機能を追加。
5. 標準1024×576の速度改善と、生成完了までの検証。
6. モデルリビジョンの固定と、別のGPUプロバイダーへの対応。

公式参考: [SVDモデル](https://huggingface.co/stabilityai/stable-video-diffusion-img2vid)、[Diffusers SVD](https://huggingface.co/docs/diffusers/api/pipelines/stable_diffusion/svd)、[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)。

詳細は[検証記録](VALIDATION.md)を参照。
