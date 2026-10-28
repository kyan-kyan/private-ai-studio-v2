import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../server/supabase/handler.js';
import {ProviderError} from '../server/kaggle.js';
const key='test-only-owner-key-'+'x'.repeat(32);
const id='70de639b-10a0-4585-8340-f8d080b22801';
const id2='70de639b-10a0-4585-8340-f8d080b22802';
const job={provider:'kaggle-svd',imageBase64:'/9j/AA==',preset:'light',duration:3,motion:127,seed:42};
const digest=async s=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
async function fixture(configured=true) {
 const records=new Map();let active=null,configuredValue=configured;
 let chain=Promise.resolve();const lock=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
 const db={config:async()=>({token_hash:await digest(key),kaggle_secret_id:configuredValue?'secret-id':null,kaggle_username:'owner'}),credentials:async()=>({kaggle_username:'owner',token:'fake-test-provider-token'}),
  setup:async(username,token)=>{assert.equal(username,'owner');assert.ok(token.startsWith('KGAT'));configuredValue=true;return true;},
  get:async id=>structuredClone(records.get(id)),
  claim:record=>lock(async()=>{if(records.has(record.id))return {prior:structuredClone(records.get(record.id))};if(active)return {active:structuredClone(records.get(active))};records.set(record.id,structuredClone(record));active=record.id;return {created:true};}),
  save:async record=>{records.set(record.id,structuredClone(record));if(['failed','completed'].includes(record.status)&&active===record.id)active=null;},
  claimPoll:async id=>records.has(id)?{record:structuredClone(records.get(id)),cached:false}:{missing:true}};
 const provider={submit:async()=>1,status:async()=> 'running',output:async()=> 'https://storage.googleapis.com/result.mp4'};
 const handler=createHandler(db,{providerFactory:()=>provider});
 const call=(path,body,auth=key)=>handler(new Request('https://relay.test/functions/v1/studio-relay'+path,{method:body?'POST':'GET',headers:{Origin:'https://kyan-kyan.github.io',Authorization:'Bearer '+auth,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
 return {call,provider,records};
}
test('Supabase relay exposes health but refuses private routes without owner authentication',async()=>{
 const {call}=await fixture();assert.equal((await call('/health',null,'')).status,200);assert.equal((await call('/v1/connection',null,'')).status,401);
});
test('authenticated relay can register Kaggle once and rejects generation before that',async()=>{
 const {call}=await fixture(false);
 let data=await (await call('/v1/connection')).json();assert.equal(data.authenticated,true);assert.equal(data.needsSetup,true);
 assert.equal((await call('/v1/jobs',{requestId:id,job})).status,503);
 assert.equal((await call('/v1/setup',{username:'owner',token:'not-an-api-token'})).status,400);
 assert.equal((await call('/v1/setup',{username:'owner',token:'KGAT_test-credential-not-real'})).status,200);
 data=await (await call('/v1/connection')).json();assert.equal(data.configured,true);assert.equal(data.token,undefined);
});
test('Supabase submit is durable before provider call and concurrent requests submit only once',async()=>{
 const {call,provider,records}=await fixture();let runs=0;
 provider.submit=async()=>{runs++;assert.ok(records.has(id));return 1;};
 const responses=await Promise.all([call('/v1/jobs',{requestId:id,job}),call('/v1/jobs',{requestId:id,job}),call('/v1/jobs',{requestId:id2,job})]);
 assert.deepEqual(responses.map(r=>r.status),[202,200,409]);assert.equal(runs,1);assert.ok(!JSON.stringify([...records.values()]).includes(job.imageBase64));
});
test('Supabase lost provider response remains unknown instead of allowing another GPU run',async()=>{
 const {call,provider}=await fixture();provider.submit=async()=>{throw new ProviderError('UPSTREAM_UNCERTAIN','unknown',true);};
 assert.equal((await (await call('/v1/jobs',{requestId:id,job})).json()).status,'unknown');assert.equal((await call('/v1/jobs',{requestId:id2,job})).status,409);
});
test('Supabase completed status requires MP4 and can recover after output availability delay',async()=>{
 const {call,provider}=await fixture();await call('/v1/jobs',{requestId:id,job});provider.status=async()=> 'completed';provider.output=async()=>{throw new ProviderError('OUTPUT_MISSING','waiting');};
 assert.equal((await (await call('/v1/jobs/'+id)).json()).status,'finishing');
 provider.output=async()=> 'https://storage.googleapis.com/result.mp4';assert.equal((await (await call('/v1/jobs/'+id)).json()).status,'completed');
});
