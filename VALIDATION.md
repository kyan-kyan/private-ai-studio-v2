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

## 未検証

- 公開環境・Android ChromeでのNotebookダウンロード完了。ローカルプレビューではダウンロードイベントがタイムアウトし、明示的な保存リンクを追加した。
- この新NotebookのKaggleインポート・T4実生成・実MP4取得。
- Pixel実機での全操作。

## 次の確認

1. GitHub Pagesの有効化と公開URLの確認。
2. 公開画面で画像選択・Notebook保存・MP4の読み込みを確認。
3. Kaggleに本人ログインし、Private・GPU T4・Internet ONで実行。
4. 実MP4とgeneration-report.jsonを確認。失敗時は最初の例外とgeneration-error.jsonから修正。

## 再生成

1ファイル版はnode scripts/build-standalone.mjsで再生成する。standaloneは補助配布用で、Pagesのルートは分割されたHTML/CSS/JSを使う。
