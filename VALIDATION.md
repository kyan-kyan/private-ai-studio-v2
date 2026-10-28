# 検証記録 — 2026-10-28 JST

## GitHub接続

ChatGPTのアカウント認証に加え、ChatGPT Codex ConnectorをGitHub個人アカウントkyan-kyanにインストールし、private-ai-studio-v2だけを許可した。
その後、contents APIで.nojekyllの作成が成功。許可前は旧・新リポジトリとも403だった。

## ローカルで確認済み

- Node標準テスト4件成功。NotebookのJSON・Python構文・画像データの復元・不正入力・fps設定を確認。
- テストPNG（720×1280）のブラウザプレビューを確認。
- 412pxのiframeで横のはみ出しなし。Pixel実機ではない。
- ffmpeg製H.264/MP4をブラウザに読み込み、2秒・readyState=4・320×180・エラーなしを確認。これは画面確認専用でAI生成ではない。
- 実画像を埋め込んだNotebookからPillowで画像を復元し、1024×576に変換できることを確認。
- 1ファイル版standalone/index.htmlのJavaScript構文と外部アセット参照がないことを確認。

## 公開環境で確認済み

- GitHub Pagesのbuild/deploy成功（5474a7d5b3242feb150b460c9b48c7f0fcdb7707）。
- https://kyan-kyan.github.io/private-ai-studio-v2/ をブラウザで開いて表示を確認。
- 公開画面から720×1280のテスト画像を読み込み、Notebookをダウンロードできることを確認。
- ダウンロードした実ファイルの全Pythonセル構文・画像復元・設定fps=5とseed=123を確認。
- その実NotebookをKaggleに取り込み、Private・Internet ON・GPU T4 x2を設定して実行開始。

## 未検証

- Android Chrome実機でのNotebookダウンロード。クラウドChromeの公開環境では成功。
- この新NotebookのKaggleインポート・T4実生成・実MP4取得。
- Pixel実機での全操作。

## 次の確認

1. Kaggleの実行結果を確認。
2. 公開画面で画像選択・Notebook保存・MP4の読み込みを確認。
3. Kaggleに本人ログインし、Private・GPU T4・Internet ONで実行。
4. 実MP4とgeneration-report.jsonを確認。失敗時は最初の例外とgeneration-error.jsonから修正。

## 再生成

1ファイル版はnode scripts/build-standalone.mjsで再生成する。standaloneは補助配布用で、Pagesのルートは分割されたHTML/CSS/JSを使う。

## T4実測と軽量設定

1024×576・14フレーム・25ステップでは、GPU使用率100%、GPUメモリ8.3GiB、3/25時点の表示83.00秒/ステップを観測。待ち時間と無料枠の消費を抑えるため中断した。
初期値を576×320・15ステップに変更し、標準設定も選べるようにした。Notebook内の画像整形と推論の両方に解像度を渡す。5件のテストで構文・画像復元・設定の伝達を確認。
破損PNGを選んだ際の英語のデコードエラーも確認し、日本語の案内に置き換えた。
