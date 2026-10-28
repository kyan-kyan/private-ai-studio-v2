# 検証記録 — 2026-10-28 JST

## GitHub接続

ChatGPTのアカウント認証に加え、ChatGPT Codex ConnectorをGitHub個人アカウントkyan-kyanにインストールし、private-ai-studio-v2だけを許可した。
その後、contents APIで.nojekyllの作成が成功。許可前は旧・新リポジトリとも403だった。

## ローカルで確認済み

- Node標準テスト5件成功。NotebookのJSON・Python構文・画像データの復元・不正入力・fps設定を確認。
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

## 実生成と保存・再生の確認

- 公開画面から保存した軽量NotebookをKaggleに取り込み、Private・Internet ON・GPU T4 x2で実行。
- 実行レポートstatus=completed。Tesla T4、torch 2.11.0+cu128、576×320、14フレーム、15ステップ、fps5、seed123、435.5秒（モデル取得済み）。
- KaggleのOutputからMP4とgeneration-report.jsonをダウンロード。ffprobeでH.264、576×320、5fps、14フレーム、2.8秒、18092バイトを確認。
- 公開画面に実MP4を選び、readyState4、paused=falseからended=trueになるまで再生を確認。Web画面から再保存し、元のMP4とバイト一致。
- 新しい公開画面を412pxのiframeで表示し、clientWidth=scrollWidth=397、1列レイアウトを確認。これはPixel実機ではない。
- 破損PNGで日本語エラーと保存ボタン無効化を確認。

## 未検証

- Android Chrome実機でのNotebookダウンロード。クラウドChromeの公開環境では成功。
- 標準設定1024×576での生成完了。軽量設定は成功。
- Pixel実機での全操作。

## 次の確認

1. Pixel実機での操作。
2. 標準1024×576の生成完了と速度改善。
3. 文章による動作指定・画像生成・GPUへの直接送信／動画回収。

実行レポートはvalidation/generation-report.json、MP4の検査結果はvalidation/video-metadata.jsonを参照。テスト動画そのものはリポジトリに含めない。

## 再生成

1ファイル版はnode scripts/build-standalone.mjsで再生成する。standaloneは補助配布用で、Pagesのルートは分割されたHTML/CSS/JSを使う。

## T4実測と軽量設定

1024×576・14フレーム・25ステップでは、GPU使用率100%、GPUメモリ8.3GiB、3/25時点の表示83.00秒/ステップを観測。待ち時間と無料枠の消費を抑えるため中断した。
初期値を576×320・15ステップに変更し、標準設定も選べるようにした。Notebook内の画像整形と推論の両方に解像度を渡す。5件のテストで構文・画像復元・設定の伝達を確認。
破損PNGを選んだ際の英語のデコードエラーも確認し、日本語の案内に置き換えた。

## 自動生成経路の実装（まだ実生成未検証）

- Cloudflare Workers + SQLite Durable Objects向けの中継コードを追加。Kaggleの公式kagglesdk 0.1.38のリクエスト定義を確認し、Private・T4・Internet ON・30分上限で送信する実装。
- 同一ID再送、別ジョブの同時実行抑止、送信結果不明時の再送禁止、MP4出力待ち、認証／CORS拒否を検証。疑似応答によるテストであり、実GPU生成の証拠ではない。
- 画面には未接続時の無効化、状態確認、MP4の取得、前回の生成IDからの復帰処理を追加。
- Nodeテスト17件成功。Notebookの生成処理は変更せず、以前の手動T4検証結果を保持。
- Wrangler 4.154.0のdeploy --dry-run成功。ローカルWorker実行は環境のuv_interface_addressesエラーで起動できなかったため、Workers実ランタイムの検証とは扱わない。
- ブラウザの412px iframeでclientWidth=scrollWidth=397を確認。Pixel実機ではない。
- 中継サーバーの本番公開、Cloudflare本人認証、Kaggle APIトークンの設定、自動経路の実生成は未完了。

## Supabase本番公開 — 初回Kaggle API認証待ち

- 接続済み組織の新規専用プロジェクト作成費用をAPIで確認し、$0/month。利用者の許可を受けてPrivate AI Studioを作成。既存WatchTowerには変更なし。
- `studio-relay` Edge Functionを公開し、HTTP health 200、キーなし401、正しい個人用キー200（authenticated=true, configured=false, needsSetup=true）、別Origin403、Kaggle未設定503を確認。
- DBでanon/authenticatedのprivateスキーマ使用権・テーブルSELECT権がfalseであること、ジョブ件数0であることを確認。
- セキュリティアドバイザーの指摘はprivate2テーブルの「RLS有効・ポリシーなし」というINFOのみ。外部は全拒否する意図どおりの設定。説明: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Nodeテスト24件成功。Supabase版の認証、初回設定、重複送信の抑止、通信結果不明、MP4待ち、画面での接続ファイル取り込みを追加検証。Kaggle応答は疑似であり、実生成の証明ではない。
- 個人用の接続ファイルを非公開で用意。専用キーを含むためGitHubには保存しない。Kaggle APIトークンは含めない。
- Kaggle APIトークンの登録・この経路での実GPU生成は未完了。手動Notebookでの実生成と混同しない。
