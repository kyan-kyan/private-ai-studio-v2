# 中継サーバー

現在使用するのは [Supabase版](supabase/README.md) です。専用プロジェクトへ公開し、認証とHTTP接続を確認しています。軽量設定でKaggle APIによる実生成・MP4取得を確認済みです。

`worker.js` と `wrangler.jsonc` はCloudflare版の初期実装です。こちらは本番公開しておらず、今の画面の接続先には使いません。共通のKaggleアダプターは `kaggle.js`、生成コードはルートの `notebook.js` です。
