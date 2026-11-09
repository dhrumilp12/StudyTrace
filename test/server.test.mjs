import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createApp,MAX_NOTES,parseListenOptions} from '../src/server.mjs';
import {generateStudySet} from '../src/engine.mjs';
const notes='# Biology\nChlorophyll is a green pigment that absorbs light.\nPlants produce oxygen through photosynthesis in chloroplasts.';
async function app(t, options) { const server=createApp(options); await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);})); return {server,base:`http://127.0.0.1:${server.address().port}`}; }
async function post(base,route,payload,headers={}) {return fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});}
function raw(base,pathname,headers={}) {return new Promise((resolve,reject)=>{const u=new URL(base); const req=http.request({host:u.hostname,port:u.port,path:pathname,headers},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end();});}
test('HTTP offline generation and source-grounded ask',async t=>{
 const {base}=await app(t); const response=await post(base,'/api/study',{title:'Biology',notes}); assert.equal(response.status,200); const set=await response.json(); assert.equal(set.mode,'offline'); assert.ok(set.cards.length); assert.equal(set.title,'Biology');
 const answer=await (await post(base,'/api/ask',{notes,question:'What is chlorophyll?'})).json();assert.equal(answer.supported,true);assert.equal(answer.label,'Matching note excerpt');assert.equal(answer.evidence[0].quote,set.sources.find(s=>s.id===answer.evidence[0].sourceId).text);
 const unsupported=await (await post(base,'/api/ask',{notes,question:'What is the capital of France?'})).json();assert.equal(unsupported.supported,false);
});
test('HTTP validates empty, incorrect types, size and question bounds',async t=>{
 const {base}=await app(t);
 for(const payload of [{},{notes:''},{notes:[]},{notes:42},{notes,title:{}},{notes,provider:'external'}])assert.equal((await post(base,'/api/study',payload)).status,400);
 assert.equal((await post(base,'/api/study',{notes:'x'.repeat(MAX_NOTES+1)})).status,413);
 assert.equal((await post(base,'/api/study',{notes:'x'.repeat(280_000)})).status,413);
 for(const question of [null,{},'ab','x'.repeat(501)])assert.equal((await post(base,'/api/ask',{notes,question})).status,400);
});
test('HTTP rejects malformed JSON and unsupported media types',async t=>{
 const {base}=await app(t);
 for(const body of ['{','null','[]','42'])assert.equal((await fetch(base+'/api/study',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,400);
 for(const type of ['text/plain','application/json-evil',''])assert.equal((await post(base,'/api/study',{notes},{'Content-Type':type})).status,415);
 assert.equal((await post(base,'/api/study',{notes},{'Content-Type':'application/json; charset=utf-8'})).status,200);
});
test('HTTP routes, methods, static assets and security headers',async t=>{
 const {base}=await app(t);
 for(const route of ['/','/index.html','/app.js','/styles.css','/favicon.svg','/api/health']) {const res=await fetch(base+route);assert.equal(res.status,200,route);assert.equal(res.headers.get('x-content-type-options'),'nosniff');assert.equal(res.headers.get('x-frame-options'),'DENY');assert.equal(res.headers.get('cache-control'),'no-store');assert.match(res.headers.get('content-security-policy'),/connect-src 'self'/);}
 const head=await fetch(base+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 for(const route of ['/api/study','/api/ask'])assert.equal((await fetch(base+route)).status,405);
 assert.equal((await post(base,'/api/health',{})).status,405);assert.equal((await post(base,'/',{})).status,405);
 for(const route of ['/not-found','/api/not-found','/src/server.mjs'])assert.equal((await fetch(base+route)).status,404);
});
test('HTTP rejects traversal and malformed request paths',async t=>{
 const {base}=await app(t);
 for(const route of ['/../src/server.mjs','/%2e%2e/src/server.mjs','/foo/../index.html','/foo/%2e%2e/index.html','/foo%5c..%5cindex.html'])assert.equal((await raw(base,route)).status,404,route);
 assert.equal((await raw(base,'/%zz')).status,400);
});
test('HTTP rejects cross-origin and cross-site requests but supports preview hosts',async t=>{
 const {base}=await app(t);
 for(const origin of ['https://evil.example','null','ftp://'+new URL(base).host,base+'/extra'])assert.equal((await post(base,'/api/study',{notes},{Origin:origin})).status,403,origin);
 assert.equal((await post(base,'/api/study',{notes},{Origin:base})).status,200);
 assert.equal((await post(base,'/api/study',{notes},{'Sec-Fetch-Site':'cross-site'})).status,403);
 assert.equal((await raw(base,'/api/health',{Host:'managed-preview.example',Origin:'https://managed-preview.example'})).status,200);
});
test('HTTP never reuses stale sources between requests or clients',async t=>{
 const {base}=await app(t);await post(base,'/api/study',{notes});
 const fresh='Mitochondria produce ATP through cellular respiration in most eukaryotic cells.';
 const missing=await (await post(base,'/api/ask',{notes:fresh,question:'What is chlorophyll?'})).json();assert.equal(missing.supported,false);
 const found=await (await post(base,'/api/ask',{notes:fresh,question:'What do mitochondria produce?'})).json();assert.equal(found.evidence[0].sourceId,'S1');assert.equal(found.evidence[0].quote,fresh);
});
test('HTTP injected local AI receives configured inputs and fails safely',async t=>{
 const calls=[]; const {base}=await app(t,{generateAI:async input=>{calls.push(input);if(input.title==='Fail')throw Error('private upstream details');return {...generateStudySet(input),mode:'ollama'};}});
 const success=await (await post(base,'/api/study',{notes,title:'Success',provider:'ollama',baseUrl:'https://evil.example',model:'external'})).json();assert.equal(success.mode,'ollama');assert.equal(calls[0].notes,notes);assert.notEqual(calls[0].baseUrl,'https://evil.example');assert.notEqual(calls[0].model,'external');
 const fallback=await (await post(base,'/api/study',{notes,title:'Fail',provider:'ollama'})).json();assert.equal(fallback.mode,'offline');assert.ok(fallback.warnings.length);assert.ok(!JSON.stringify(fallback).includes('private upstream details'));
});
test('HTTP allows only two concurrent model requests and releases slots',async t=>{
 const gates=[];let active=0,max=0;
 const {base}=await app(t,{generateAI:input=>new Promise(resolve=>{active++;max=Math.max(active,max);gates.push(()=>{active--;resolve(generateStudySet(input));});})});
 const first=post(base,'/api/study',{notes,provider:'ollama'});const second=post(base,'/api/study',{notes,provider:'ollama'});
 const deadline=Date.now()+2000;while(gates.length<2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.equal(gates.length,2);
 assert.equal((await post(base,'/api/study',{notes,provider:'ollama'})).status,429);assert.equal((await post(base,'/api/study',{notes})).status,200);
 gates.splice(0).forEach(release=>release());assert.equal((await first).status,200);assert.equal((await second).status,200);assert.equal(max,2);
 const third=post(base,'/api/study',{notes,provider:'ollama'});while(!gates.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.equal(gates.length,1);gates.shift()();assert.equal((await third).status,200);
});
test('CLI host and port support preview arguments and override environment',()=>{
 assert.deepEqual(parseListenOptions([],{}),{port:3000,host:'127.0.0.1'});
 assert.deepEqual(parseListenOptions(['--host','127.0.0.1','--port','4173','--strictPort'],{PORT:'3000',HOST:'0.0.0.0'}),{port:4173,host:'127.0.0.1'});
 assert.deepEqual(parseListenOptions(['--host=::1','--port=0'],{}),{host:'::1',port:0});
 assert.deepEqual(parseListenOptions([],{PORT:'8080',HOST:'localhost'}),{host:'localhost',port:8080});
 for(const args of [['--port'],['--host'],['--port='],['--port','NaN'],['--port','-1'],['--port','65536'],['--port','3.14'],['--host','http://localhost'],['--unknown']]) assert.throws(()=>parseListenOptions(args,{}),undefined,args.join(' '));
});
test('CLI actually binds the requested ephemeral port',async t=>{
 const child=spawn(process.execPath,['src/server.mjs','--host','127.0.0.1','--port','0','--strictPort'],{cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 const base=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Server startup timed out')),3000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error(`Server exited early: ${code}`));});});
 const response=await fetch(base+'/api/health');assert.equal(response.status,200);assert.equal((await response.json()).name,'StudyTrace');
});
