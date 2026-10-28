import postgres from 'npm:postgres@3.4.9';
import {StudioDatabase} from './database.js';
import {createHandler} from './handler.js';
const connection = Deno.env.get('SUPABASE_DB_URL');
// Do not log connection strings, headers, payloads or provider errors.
const handler = connection ? createHandler(new StudioDatabase(postgres(connection,{prepare:false,max:1,idle_timeout:20,connect_timeout:10}))) : null;
Deno.serve(req => handler ? handler(req) : Response.json({error:'NOT_CONFIGURED',message:'サーバーの接続設定が必要です。'},{status:503}));
