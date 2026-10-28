# 自動生成の中継サーバー（接続・実生成は未検証）

GitHub Pages → HTTPS中継サーバー → KaggleのPrivate Notebook → MP4を画面へ返す構成。
生成コードは既にT4で検証した `notebook.js` を共用する。**このAPI経路によるKaggle実生成は未検証**であり、単体テストの成功を実生成成功とは扱わない。

Cloudflare WorkersとSQLite Durable ObjectsのFree枠を想定する。GPUはKaggle T4のみ。支払い情報登録・有料プランへの変更・有料GPUへのフォールバックは行わない。WorkersのCPU時間制限やKaggle側のAPI制限は、公開後の実測が必要。

## 初回セットアップ

必要な本人操作はCloudflareへのログインと、KaggleのAPI利用認証。Googleログイン済みのブラウザセッションは、Kaggle API認証の代用にならない。APIトークンはチャットや公開リポジトリに貼らない。

1. Cloudflare WorkersのFreeプランを利用する。ローカルCLIまたはCloudflareの接続済みGitHubリポジトリからデプロイできる。会社PCを使う必要はない。
2. `server/wrangler.jsonc` の `KAGGLE_USERNAME` に、T4を利用できる本人のKaggleユーザー名を設定する。
3. CloudflareのSecretに `KAGGLE_API_TOKEN` と `STUDIO_TOKEN` を登録する。
   - `KAGGLE_API_TOKEN`: Kaggle Settingsで発行するAPIトークン。Kaggleの利用資格、Internet権限、GPU枠が必要。
   - `STUDIO_TOKEN`: 中継サーバー専用のランダムな32文字以上の接続キー。Kaggleトークンを流用しない。生成例: `openssl rand -hex 32`。
   - CLIの場合は `npx wrangler secret put KAGGLE_API_TOKEN --config server/wrangler.jsonc` と同様に `STUDIO_TOKEN` を対話入力。値をコマンド引数に含めない。
4. `npx wrangler deploy --config server/wrangler.jsonc`。SQLite Durable Objectの移行も同時に適用される。
5. Pagesの「初回の接続設定」で公開されたHTTPSのURLと `STUDIO_TOKEN` を入力。Kaggle APIトークンは画面に入力しない。
6. 接続確認後、テスト画像で「生成」を1回だけ押す。MP4の取得・再生まで確認する。ここが済むまで自動生成の実動作は未検証。

CloudflareのGit連携設定例はリポジトリルートを作業ディレクトリにし、deploy commandを `npx wrangler deploy --config server/wrangler.jsonc` にする。ビルドは不要。SecretsをGitHubに保存しない。

## API

すべて `Authorization: Bearer <STUDIO_TOKEN>` が必要。CORSは `ALLOWED_ORIGIN` の完全一致のみ。既定は `https://kyan-kyan.github.io`。他サイトからの呼び出しと未設定状態を拒否する。

- `GET /v1/connection`: 中継サーバーの設定と接続キーを確認する。Kaggleの認証やGPU利用可能性を保証するものではない。
- `POST /v1/jobs`: `{requestId: UUIDv4, job: {provider:'kaggle-svd', imageBase64, preset:'light', duration:2|3|4, motion:1..255, seed:0..4294967295}}`
- `GET /v1/jobs/<id>`: queued/running/unknown/finishing/completed/failed。パーセントの疑似進捗は表示しない。
- `GET /v1/jobs/<id>/video`: MP4出力確認済みのジョブだけ取得。Kaggle署名URLは毎回引き直し、認証ヘッダーを動画配信先に転送しない。

## 再試行とデータ

- 同一requestId・同一内容の再送は元の記録を返す。異なる内容は409。
- 同時実行は1件。通信断で結果不明になっても自動で再送しない。
- アカウントの無料GPU全体の枠ではなく、このサーバーから送るジョブのみ制御する。
- 送信前にメタデータをDurable Objectsへ保存する。写真・Notebook本体・MP4・Kaggle認証情報はDBに保存しない。
- 画像はHTTPSで中継され、KaggleのPrivate Notebookのソースに含まれる。生成後もKaggleには残る。自動削除は実装しない。
- タイムアウトした送信の状況は、固有のNotebook名で再確認する。2分経過後もKaggleが404を返す場合だけ失敗へ移し、ロックを解除する。自動再送はしない。
- セッションは30分の実行上限を指定し、バッチ実行終了後のGPU終了をKaggleに委ねる。この挙動も実API検証が必要。中止APIは未実装。
- ブラウザは中継URLと生成IDだけをlocalStorageに、接続キーはsessionStorageに保存する。KaggleトークンはサーバーSecretのみ。
- 現在はSVD軽量のみ。文章の動作指定、画像生成、標準解像度の自動生成は拒否する。
- 外部APIのエラー本文・画像・認証ヘッダーをログへ出力しない。Workersのobservabilityは既定で無効。

## 検証

`npm test` で疑似Kaggle応答による、認証・CORS・二重送信・失敗・通信断・MP4出力待ち・配信元制限を確認する。これはCloudflare本番や実Kaggle認証の検証ではない。

公式の `kagglesdk 0.1.38` に合わせて `https://api.kaggle.com/v1/kernels.KernelsApiService/SaveKernel` / `GetKernelSessionStatus` / `ListKernelSessionOutput` を使う。既存のブラウザログインのCookieや非公開UIエンドポイントには依存しない。

公式資料:
- https://github.com/Kaggle/kaggle-cli
- https://www.kaggle.com/docs/api
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/durable-objects/
