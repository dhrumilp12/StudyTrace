// Offline by default. --live uses an already-installed localhost Ollama service.
// This script never downloads a runtime/model or sends notes to an external service.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { generateWithOllama } from '../src/ollama.mjs';

const root = new URL('../', import.meta.url);
const live = process.argv.includes('--live');
const outputArg = process.argv.find(arg => arg.startsWith('--output='));
const output = outputArg ? outputArg.slice('--output='.length) : 'artifacts/diverse-notes-evaluation.json';
const read = path => readFile(new URL(path, root), 'utf8');
const fixtures = [
  { subject: 'history', objectives: ['S3','S7','S8','S9','S13','S15'], queries: [
    ['When was the Bastille stormed?', true, 'S3', 'Lexical recall of a date and named event.'],
    ['When did France proclaim a republic?', true, 'S9', 'Morphology false negative: proclaim/proclaimed is unsupported.'],
    ['What were voting rights under the 1791 constitution?', true, 'S8', 'Retrieval preserves the limited-voting qualifier.'],
    ['What caused the revolution?', false, null, 'No source explains the broad causes of the revolution.']
  ] },
  { subject: 'statistics', objectives: ['S3','S4','S6','S7','S8','S9','S11','S12','S15','S16'], queries: [
    ['What is the standard error of the mean?', true, 'S5', 'Exact lexical request.'],
    ['What is the formula for standard error?', false, null, 'Intentional safe abstention: formula interpretation and connecting a standalone equation to its assumptions remain unsupported.'],
    ['What does correlation establish?', true, 'S15', 'Source preserves the warning that correlation does not establish causation.'],
    ['What is P(A | B)?', false, null, 'Intentional safe abstention for mathematical notation; no semantic formula answer is claimed.'],
    ['What is P(A and B)?', false, null, 'Intentional safe abstention: the standalone joint formula depends on an independence qualification in a separate source.'],
    ['What is the probability that the null hypothesis is true?', true, 'S16', 'Retrieves the warning, not an invented numerical probability.']
  ] },
  { subject: 'programming', objectives: ['S1','S2','S3','S5','S6','S8','S13','S17','S18'], queries: [
    ['What does a Python dictionary store?', true, 'S3', 'Supported singular verb normalization.'],
    ['What is a shallow copy?', true, 'S6', 'Direct concept retrieval.'],
    ['What happens to a after b[0].append(3)?', true, 'S12', 'Code behavior and cross-source context are not inferred.'],
    ['What does binary search require?', true, 'S17', 'Supported singular verb normalization.'],
    ['What is the time complexity of linear search?', true, 'S16', 'Direct concept and quantity-like fact retrieval.']
  ] },
  { subject: 'chemistry', objectives: ['S1','S4','S6','S9','S10','S11','S12','S13','S16','S19'], queries: [
    ['Does a catalyst change the equilibrium constant?', true, 'S13', 'Source negation is preserved.'],
    ['What is the pH of neutral pure water?', true, 'S6', 'The numerical fact retains its temperature condition.'],
    ['What is pH at 100 degrees Celsius?', false, null, 'Numeric-condition safeguard: the 25-degree source must not support a 100-degree request.'],
    ['What is the Henderson-Hasselbalch equation?', false, null, 'Intentional safe abstention: a prose description is not a semantic answer to an equation request.'],
    ['How many grams of product form?', false, null, 'Insufficient reactant quantities and no calculation are supported.']
  ] }
];
const sourceFiles = ['src/engine.mjs','src/ollama.mjs','src/server.mjs','scripts/evaluate-diverse-notes.mjs',...fixtures.map(x=>`examples/evaluation/${x.subject}-notes.md`)];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await read(path)).digest('hex')])));
const artifact = { metadata: { startedAt:new Date().toISOString(), node:process.version, liveRequested:live, noteOrigin:'Four original synthetic educational fixtures, not user notes.', reviewMethod:'Exploratory fixtures and retrospective review, not an independent benchmark. Final query expectations include intentional safe abstentions and are not an accuracy score.', sourceHashes }, runs:[] };
let capture;
const app=createApp({generateAI: input=>generateWithOllama({...input,fetchImpl:async(...args)=>{capture.request=JSON.parse(args[1].body); const response=await fetch(...args); capture.httpStatus=response.status; capture.outer=await response.clone().json(); return response;}})});
await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${app.address().port}`;
const post=async(path,body)=>{const r=await fetch(`${origin}${path}`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
const save=()=>writeFile(new URL(output,root),JSON.stringify(artifact,null,2)+'\n');
try {
  if (live) {
    const r=await fetch('http://127.0.0.1:11434/api/tags'); assert.ok(r.ok); const installed=await r.json();
    artifact.metadata.ollamaModels=installed.models;
    assert.ok(installed.models.some(x=>x.name==='qwen2.5:3b'),'Expected qwen2.5:3b must already be installed; no download is attempted.');
  }
  for(const fixture of fixtures) {
    const notes=await read(`examples/evaluation/${fixture.subject}-notes.md`);
    const queries=[];
    for(const [question,expectedSupported,expectedSourceId,interpretation] of fixture.queries) {
      const result=await post('/api/ask',{notes,question});
      queries.push({question,observedSupported:result.supported,expectedSupported,expectedSourceId,observationMatchesExpectation:result.supported===expectedSupported && (!expectedSourceId || result.evidence[0]?.sourceId===expectedSourceId),interpretation,result});
    }
    for (const provider of live ? ['offline','ollama'] : ['offline']) {
      capture={};const start=performance.now();const result=await post('/api/study',{title:`Synthetic ${fixture.subject} evaluation`,notes,provider});const elapsedMs=Math.round(performance.now()-start);
      const sourceMap=new Map(result.sources.map(s=>[s.id,s]));
      for(const item of [...result.summary,...result.cards]) {
        const source=sourceMap.get(item.sourceId);assert.ok(source);assert.ok(notes.includes(source.text));assert.equal(item.quote,source.text);
        if(item.answer) { assert.ok(source.text.includes(item.answer));assert.equal(item.prompt,`Complete the note: ${source.text.replace(item.answer,'____')}`); }
        else assert.equal(item.text,source.text);
      }
      const headings=items=>[...new Set(items.map(i=>sourceMap.get(i.sourceId).heading))];
      const present=ids=>fixture.objectives.filter(id=>ids.includes(id));
      const summaryIds=result.summary.map(i=>i.sourceId),cardIds=result.cards.map(i=>i.sourceId);
      const cueLessCards=result.cards.filter(c=>!/[\p{L}\p{N}]/u.test(c.prompt.replace(/^Complete the note: /,'').replace('____',''))).map(c=>c.id);
      const entry={subject:fixture.subject,provider,mode:result.mode,elapsedMs,inputCharacters:notes.length,sourceCount:result.sources.length,sourceIntegrityPassed:true,summaryCount:result.summary.length,cardCount:result.cards.length,summaryHeadings:headings(result.summary),cardHeadings:headings(result.cards),reviewedKeySourceIds:fixture.objectives,keySourceCoverage:{summary:present(summaryIds),cards:present(cardIds),either:present([...summaryIds,...cardIds])},cueLessCards,unselectedSources:result.sources.filter(s=>!summaryIds.includes(s.id)&&!cardIds.includes(s.id)),queries,result,...(provider==='ollama'?{raw:capture}:{})};
      artifact.runs.push(entry);await save();console.log(JSON.stringify({...entry,queries:undefined,result:undefined,raw:undefined,unselectedSources:entry.unselectedSources.map(s=>s.id)}));
      console.log('QUERIES',JSON.stringify(queries.map(q=>({question:q.question,supported:q.observedSupported,sourceId:q.result.evidence[0]?.sourceId,matchesExpected:q.observationMatchesExpectation}))));
    }
  }
  artifact.metadata.finishedAt=new Date().toISOString();artifact.metadata.healthPassed=(await (await fetch(`${origin}/api/health`)).json()).ok===true;await save();
} finally {app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
