import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../generation.js',import.meta.url),'utf8').replace('export function initGeneration','function initGeneration');
function setup(fetcher) {
  const entries=new Map(),session=new Map(),elements=new Map();
  const storage=map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
  function element(id) {
    if(!elements.has(id)) {
      const listeners=new Map();
      elements.set(id,{value:'',textContent:'',hidden:false,disabled:false,open:false,
        addEventListener:(name,fn)=>listeners.set(name,fn),
        hasAttribute:name=>id==='preview' && name==='src',
        emit:async (name,event)=>listeners.get(name)?.(event)});
    }
    return elements.get(id);
  }
  let received=0;
  const context=vm.createContext({document:{getElementById:element},localStorage:storage(entries),sessionStorage:storage(session),URL,Response,Blob,AbortSignal,crypto,Uint8Array,TextEncoder,MutationObserver:class{observe(){}},setTimeout:()=>1,clearTimeout:()=>{},fetch:fetcher});
  vm.runInContext(source+'\ninitGeneration({getJob:()=>({provider:"kaggle-svd",imageBase64:"fixture"}),onVideo:()=>onVideo()});',vm.createContext({...context,onVideo:()=>received++}));
  element('relayUrl').value='https://relay.example';element('relayKey').value='x'.repeat(40);
  return {element,entries,session,get received(){return received;}};
}
test('UI keeps generate disabled until relay authentication succeeds',async()=>{
 const ui=setup(async()=>Response.json({configured:true,provider:'kaggle-svd'}));
 assert.equal(ui.element('generate').disabled,true);
 await ui.element('connectRelay').emit('click');assert.equal(ui.element('generate').disabled,false);
 assert.equal(ui.element('relayKey').value,'');assert.equal(ui.session.size,1);
});
test('UI sends once on double tap and retains only job metadata for recovery',async()=>{
 let count=0;
 const ui=setup(async(url,options)=>{
   if(url.endsWith('/connection')) return Response.json({configured:true,provider:'kaggle-svd'});
   if(options.method==='POST') {count++;const b=JSON.parse(options.body);return Response.json({id:b.requestId,status:'running'});}
 });
 await ui.element('connectRelay').emit('click');
 await Promise.all([ui.element('generate').emit('click'),ui.element('generate').emit('click')]);
 assert.equal(count,1);assert.equal(ui.element('generate').disabled,true);
 assert.ok(!JSON.stringify([...ui.entries.values()]).includes('fixture'));
});
test('UI never reports success after submit disconnect and does not resubmit on status check',async()=>{
 let submits=0;
 const ui=setup(async(url,options)=>{
   if(url.endsWith('/connection')) return Response.json({configured:true,provider:'kaggle-svd'});
   if(options.method==='POST') {submits++;throw new TypeError('offline');}
   const id=url.split('/').at(-1);return Response.json({id,status:'running'});
 });
 await ui.element('connectRelay').emit('click');await ui.element('generate').emit('click');
 assert.match(ui.element('generationStatus').textContent,/再送せず/);
 await ui.element('checkGeneration').emit('click');assert.equal(submits,1);assert.equal(ui.received,0);
});
test('UI rejects a Kaggle token entered instead of the dedicated connection key',async()=>{
 let requests=0;const ui=setup(async()=>{requests++;return Response.json({});});
 ui.element('relayKey').value='KGAT_'+'x'.repeat(40);await ui.element('connectRelay').emit('click');
 assert.equal(requests,0);assert.match(ui.element('generationStatus').textContent,/Kaggle APIトークンではなく/);
});

test('connected relay without Kaggle credentials cannot generate and exposes setup instead',async()=>{
 const ui=setup(async()=>Response.json({provider:'kaggle-svd',authenticated:true,configured:false,username:'owner'}));
 await ui.element('connectRelay').emit('click');
 assert.equal(ui.element('generate').disabled,true);assert.equal(ui.element('kaggleSetup').hidden,false);assert.equal(ui.element('saveKaggle').disabled,false);
 assert.match(ui.element('generationStatus').textContent,/APIトークンを登録/);
});
test('connection file imports the intended relay and setup clears credentials after saving',async()=>{
 let setupCalls=0;
 const ui=setup(async(url,options)=>{
   if(url.endsWith('/connection'))return Response.json({provider:'kaggle-svd',authenticated:true,configured:false});
   if(url.endsWith('/setup')){setupCalls++;assert.ok(JSON.parse(options.body).token.startsWith('KGAT'));return Response.json({configured:true});}
 });
 const target={files:[{size:300,text:async()=>JSON.stringify({schema:'private-ai-studio-connection-v1',endpoint:'https://rhjhrwfvlxuijtjoalzb.supabase.co/functions/v1/studio-relay',key:'a'.repeat(64)})}],value:'selected'};
 await ui.element('connectionFile').emit('change',{target});assert.equal(target.value,'');
 ui.element('kaggleUsername').value='owner';ui.element('kaggleToken').value='KGAT_test-credential-not-real';
 await ui.element('saveKaggle').emit('click');assert.equal(setupCalls,1);assert.equal(ui.element('kaggleToken').value,'');assert.equal(ui.element('generate').disabled,false);
});
