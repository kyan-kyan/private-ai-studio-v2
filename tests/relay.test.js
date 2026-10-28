import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{StudioJobs} from '../server/worker.js';
import {KaggleProvider,ProviderError} from '../server/kaggle.js';
const id='70de639b-10a0-4585-8340-f8d080b22801';
const id2='70de639b-10a0-4585-8340-f8d080b22802';
const job={provider:'kaggle-svd',imageBase64:'/9j/AA==',preset:'light',duration:3,motion:127,seed:42};
function setup() {
  const data=new Map(); let pending=Promise.resolve();
  const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>{if(typeof k==='object'){for(const [a,b] of Object.entries(k)) data.set(a,structuredClone(b));}else data.set(k,structuredClone(v));},delete:async k=>data.delete(k)};
  const env={STUDIO_TOKEN:'x'.repeat(40),KAGGLE_API_TOKEN:'server-only-secret',KAGGLE_USERNAME:'testowner',ALLOWED_ORIGIN:'https://studio.test'};
  const state={storage,blockConcurrencyWhile:fn=>{const call=pending.then(fn);pending=call.catch(()=>{});return call;}};
  const obj=new StudioJobs(state,env);
  env.STUDIO={idFromName:()=>'',get:()=>obj};
  const req=(path,body,opts={})=>worker.fetch(new Request('https://relay.test'+path,{method:body?'POST':'GET',headers:{Origin:env.ALLOWED_ORIGIN,Authorization:`Bearer ${env.STUDIO_TOKEN}`,...(body?{'Content-Type':'application/json'}:{}),...opts.headers},...(body?{body:JSON.stringify(body)}:{})}),env);
  return {obj,env,req,data};
}
test('relay rejects missing authentication, wrong origin and unconfigured credentials',async()=>{
 const {req,env}=setup();
 assert.equal((await req('/v1/connection',null,{headers:{Authorization:''}})).status,401);
 assert.equal((await req('/v1/connection',null,{headers:{Origin:'https://evil.test'}})).status,403);
 assert.equal((await req('/v1/connection')).status,200);
 env.KAGGLE_API_TOKEN=''; assert.equal((await req('/v1/connection')).status,503);
});
test('duplicate retries and competing jobs trigger only one private GPU submission',async()=>{
 const {obj,req,data}=setup();let submissions=0;
 obj.provider.submit=async(slug,notebook)=>{submissions++;assert.match(slug,/^pas-/);assert.equal(notebook.nbformat,4);return 1;};
 const responses=await Promise.all([req('/v1/jobs',{requestId:id,job}),req('/v1/jobs',{requestId:id,job}),req('/v1/jobs',{requestId:id2,job})]);
 assert.deepEqual(responses.map(r=>r.status),[202,200,409]);assert.equal(submissions,1);
 assert.equal((await req('/v1/jobs',{requestId:id,job:{...job,seed:2}})).status,409);
 assert.ok(!JSON.stringify([...data.values()]).includes(job.imageBase64));
});
test('a lost submit response is retained as unknown and is never automatically resubmitted',async()=>{
 const {obj,req}=setup();let submits=0;
 obj.provider.submit=async()=>{submits++;throw new ProviderError('UPSTREAM_UNCERTAIN','unknown',true);};
 assert.equal((await (await req('/v1/jobs',{requestId:id,job})).json()).status,'unknown');
 await req('/v1/jobs',{requestId:id,job});
 assert.equal((await req('/v1/jobs',{requestId:id2,job})).status,409);assert.equal(submits,1);
});
test('Internet denial is actionable and never becomes a successful generation',async()=>{
 const {obj,req}=setup();
 obj.provider=new KaggleProvider(obj.env,async()=>Response.json({code:403,message:"Permission 'kernelSessions.enableInternet' was denied"},{status:403}));
 const r=await (await req('/v1/jobs',{requestId:id,job})).json();assert.equal(r.status,'failed');assert.equal(r.code,'INTERNET_DENIED');
});
test('invalid motion prompts and heavy presets are rejected instead of silently ignored',async()=>{
 const {req}=setup();
 for(const patch of [{direction:'walk'},{preset:'standard'},{imageBase64:'aGVsbG8='},{seed:-1}]) assert.equal((await req('/v1/jobs',{requestId:id,job:{...job,...patch}})).status,400);
});
test('completed requires an actual MP4 listing and a later retry can recover missing output',async()=>{
 const {obj,req,data}=setup();obj.provider.submit=async()=>1;
 await req('/v1/jobs',{requestId:id,job});obj.provider.status=async()=> 'completed';
 obj.provider.output=async()=>{throw new ProviderError('OUTPUT_MISSING','No MP4');};
 let r=await (await req(`/v1/jobs/${id}`)).json();assert.equal(r.status,'finishing');
 assert.equal((await req('/v1/jobs',{requestId:id2,job})).status,409);
 const record=data.get(`job:${id}`);record.checkedAt=0;data.set(`job:${id}`,record);
 obj.provider.output=async()=> 'https://storage.googleapis.com/output.mp4';
 r=await (await req(`/v1/jobs/${id}`)).json();assert.equal(r.status,'completed');
 assert.equal(data.get('activeId'),undefined);
});
test('Kaggle adapter uses pinned version, private T4 run and no automatic retry',async()=>{
 const calls=[];
 const provider=new KaggleProvider({KAGGLE_USERNAME:'owner',KAGGLE_API_TOKEN:'hidden'},async(url,options)=>{
  calls.push({url,options,body:JSON.parse(options.body)});
  return Response.json(url.endsWith('SaveKernel')?{versionNumber:2}:{status:'COMPLETE'});
 });
 await provider.submit('pas-test',{cells:[{source:['a\n','b']} ]});
 assert.equal(calls[0].body.isPrivate,true);assert.equal(calls[0].body.machineShape,'NvidiaTeslaT4');assert.equal(calls[0].body.sessionTimeoutSeconds,1800);
 assert.equal(calls[0].body.enableInternet,true);assert.equal(JSON.parse(calls[0].body.text).cells[0].source,'a\nb');
 assert.equal(await provider.status({slug:'pas-test',version:2}),'completed');assert.equal(calls[1].body.versionLabel,'2');
});
test('signed file downloads never receive Kaggle credentials and reject offsite redirects',async()=>{
 const calls=[];
 const provider=new KaggleProvider({},async(url,options)=>{calls.push(options);return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/internal'}});});
 provider.output=async()=> 'https://storage.googleapis.com/video.mp4?signature=example';
 await assert.rejects(()=>provider.video({}),e=>e.code==='OUTPUT_HOST');assert.equal(calls.length,1);assert.equal(calls[0].headers,undefined);
});
