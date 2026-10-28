# Supabase版 Private AI Studio中継サーバー

## 状態

- 専用プロジェクト `rhjhrwfvlxuijtjoalzb` を月額$0の見積もりで作成（東京）。既存WatchTowerは変更しない。
- `studio-relay` Edge Functionを公開済み。接続先は `https://rhjhrwfvlxuijtjoalzb.supabase.co/functions/v1/studio-relay`。
- 本番でhealth 200、個人用キーなし401、正しいキー200、別Origin403、Kaggle未設定503を確認。
- **Kaggle API経由のGPU生成は未検証。** 手動Notebook方式のT4検証と区別する。

## 個人用の初回設定

画面に個人用接続ファイルを読み込む。ファイルには専用キーが入るため共有しない。キーはこのタブのsessionStorageに、接続URLと生成IDはlocalStorageに保存する。

Kaggle APIトークンは画面の初回設定から入力する。Googleログインのパスワードは扱わない。専用サーバーへHTTPSで送信し、Supabase Vaultで暗号化保存する。トークンをチャット、GitHub、設定ファイルに記録しない。

## サーバーと権限

- `index.ts`: Deno Edge Function入口。`postgres@3.4.9` を固定。
- `database.js`: Supabaseがサーバーに用意する `SUPABASE_DB_URL` で接続。秘密値を出力しない。接続情報をフロントに返さない。
- `handler.js`: 専用BearerキーのSHA-256とDB内ハッシュを照合。Kaggleトークンとは別のキー。
- `/health` 以外は独自認証が必要。そのためSupabase gatewayの `verify_jwt=false` を使う。publishable keyだけでは利用できない。
- CORSはPagesの `https://kyan-kyan.github.io` のみ。
- データは `studio_private` スキーマ。anon/authenticated/PUBLICのアクセスを剥奪し、RLSも有効。ポリシーなしは外部から全拒否する意図どおりの設定。
- `jobs` は生成ID・状態・Notebook名などのメタデータのみ。画像・Notebook本体・動画は保存しない。
- `config` の専用キーはハッシュだけを保存。KaggleトークンはVaultのIDだけを持つ。
- 画像はKaggleのPrivate Notebookのソースに含まれ、Kaggle側には残る。自動削除は行わない。

## 二重実行防止

configの行ロックで同一ID・稼働中の別ジョブを確認し、生成記録をコミットしてからKaggleを呼ぶ。外部通信中はトランザクションを開いたままにしない。

送信結果不明時は再送せず、Notebook名から状況を再取得する。状態確認のロックは30秒。完了は実行状態とMP4出力の両方を確認する。

## API

- `GET /health`: 公開の稼働確認。生成成功の確認ではない。
- `GET /v1/connection`: 専用キー認証、Kaggle初回設定の要否。
- `POST /v1/setup`: `{username, token}`。専用キー認証後にVaultへ保存。生成中の変更は不可。トークンの実権限は生成時に確認。
- `POST /v1/jobs`: 共通ジョブ形式。軽量SVDのみ。1ジョブ30分の上限指定。
- `GET /v1/jobs/<id>`: 実行待ち／生成中／結果不明／出力待ち／完了／失敗。
- `GET /v1/jobs/<id>/video`: 署名URLを再取得してMP4を配信。Kaggleの認証ヘッダーをファイル配信先に送らない。

## デプロイ

`node scripts/package-supabase.mjs` はdeploy_edge_function向けのソースJSONを出力する。`notebook.js` と `kaggle.js` は共通の実装を同梱する。ローカル用の薄い再エクスポートを本番へ送らない。

DBスキーマは `supabase/migrations/` に保存。個人用キーのハッシュの初期値はソースに含めず、本人の環境にだけ設定する。

有料プラン・有料GPUへの自動切り替えはない。無料枠を超えた場合はエラーを表示する。Kaggleへの実行中止、画像生成、文章による動作指定は未実装。
