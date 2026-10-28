import fs from 'node:fs';
const paths={'index.ts':'server/supabase/index.ts','database.js':'server/supabase/database.js','handler.js':'server/supabase/handler.js','notebook.js':'notebook.js','kaggle.js':'server/kaggle.js'};
console.log(JSON.stringify(Object.entries(paths).map(([name,path])=>({name,content:fs.readFileSync(new URL('../'+path,import.meta.url),'utf8')}))));
