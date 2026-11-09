import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {generateStudySet} from '../src/engine.mjs';

const script=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const STORAGE_KEY='studytrace.workspace.v1';
const OLD_NOTES='# Earlier topic\nChlorophyll is a green pigment that absorbs light energy in plants.';
const NEW_NOTES='# New topic\nMitochondria produce ATP through cellular respiration in most eukaryotic cells.';
const AT='2026-11-05T07:00:00.000Z';

// A deliberately small DOM double exercises the actual app and event handlers
// without dependencies. It is not a substitute for visual/browser QA.
class Element {
  constructor(tag='div',attributes={}) {
    this.tagName=tag.toUpperCase();this.attributes={...attributes};this.id=attributes.id || '';
    this.className=attributes.class || '';this.dataset={};this.children=[];this.listeners={};this.value='';this.hidden=Object.hasOwn(attributes,'hidden');this.disabled=Object.hasOwn(attributes,'disabled');this.open=false;this._text='';
    for(const [key,value] of Object.entries(attributes))if(key.startsWith('data-'))this.dataset[key.slice(5)]=value;
    this.classList={
      contains:name=>this.className.split(/\s+/).includes(name),
      toggle:(name,force)=>{const classes=new Set(this.className.split(/\s+/).filter(Boolean));const add=force ?? !classes.has(name);if(add)classes.add(name);else classes.delete(name);this.className=[...classes].join(' ');return add;},
      add:name=>this.classList.toggle(name,true),remove:name=>this.classList.toggle(name,false)
    };
  }
  set textContent(value) {this._text=String(value);this.children=[];}
  get textContent() {return this._text+this.children.map(child=>child.textContent).join('');}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this._text='';this.children=[...children];}
  setAttribute(name,value) {this.attributes[name]=String(value);}
  removeAttribute(name) {delete this.attributes[name];}
  addEventListener(type,callback) {(this.listeners[type] ||= []).push(callback);}
  dispatchEvent(event) {for(const callback of this.listeners[event.type] || [])callback(event);return true;}
  async emit(type,properties={}) {
    if(type==='click' && this.disabled)return;
    const event={type,target:this,preventDefault(){},...properties};
    await Promise.all((this.listeners[type] || []).map(callback=>callback(event)));
    if(type==='click')this.onclick?.(event);
  }
  click() {return this.emit('click');}
  querySelector(selector) {assert.equal(selector,'span');return this.span ||= new Element('span');}
  showModal() {this.open=true;}
  close() {this.open=false;}
  focus() {}
  remove() {}
}
function workspace(notes=OLD_NOTES) {
  const study=generateStudySet({title:'Earlier set',notes}),card=study.cards[0];
  return {
    version:1,draft:{title:study.title,notes,provider:'offline'},study,studyNotes:notes,
    progress:{[card.id]:{lastOutcome:'review',confidence:3,attempts:1,updatedAt:AT}},
    history:[{cardId:card.id,sourceId:card.sourceId,topic:card.topic,outcome:'review',confidence:3,answer:'My previous answer',at:AT}]
  };
}
function app({saved,fetch:fetcher=()=>{throw Error('Unexpected fetch');}}={}) {
  const elements=[...html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)].map(([,tag,attrs])=>{
    const attributes=Object.fromEntries([...attrs.matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/gi)].map(([,name,value])=>[name,value ?? '']));
    return new Element(tag,attributes);
  });
  const ids=new Map(elements.filter(element=>element.id).map(element=>[element.id,element]));
  const select=selector=>elements.filter(element=>selector[0]==='.'?element.classList.contains(selector.slice(1)):selector[0]==='['?Object.hasOwn(element.attributes,selector.slice(1,-1)):element.tagName===selector.toUpperCase());
  const storage=new Map(saved===undefined?[]:[[STORAGE_KEY,JSON.stringify(saved)]]),calls=[],downloads=[];
  const context=vm.createContext({
    document:{getElementById:id=>{assert.ok(ids.has(id),`Missing DOM element ${id}`);return ids.get(id);},querySelectorAll:select,createElement:tag=>new Element(tag),createTextNode:text=>{const node=new Element('#text');node.textContent=text;return node;},body:elements.find(element=>element.tagName==='BODY')},
    window:{scrollY:0,scrollTo(){},addEventListener(){}},
    localStorage:{getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    fetch:(...args)=>{calls.push(args);return fetcher(...args);},
    Event:class {constructor(type){this.type=type;}},AbortController,Blob,
    URL:{createObjectURL:blob=>{downloads.push(blob);return `blob:test-${downloads.length}`;},revokeObjectURL(){}},
    setTimeout:()=>1,clearTimeout(){}
  });
  vm.runInContext(script,context,{filename:'public/app.js'});
  return {get:id=>ids.get(id),select,calls,downloads,run:source=>vm.runInContext(source,context),state:()=>JSON.parse(vm.runInContext('JSON.stringify(state)',context)),stored:()=>JSON.parse(storage.get(STORAGE_KEY))};
}
function deferredResponse(study) {
  let release;
  const response=new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>study});});
  return {fetch:()=>response,release};
}
async function startBuild(client) {
  client.get('set-title').value='New set';client.get('notes').value=NEW_NOTES;
  const finished=client.run('buildStudy()');
  if(client.get('confirm-dialog').open)await client.get('confirm-action').emit('click');
  assert.equal(client.calls.length,1);
  assert.equal(client.get('generate-button').disabled,true);
  return {finished};
}

test('a delayed build refreshes the current practice card before rating can resume',async()=>{
  const next=generateStudySet({title:'New set',notes:NEW_NOTES}),request=deferredResponse(next),client=app({saved:workspace(),fetch:request.fetch});
  const {finished}=await startBuild(client);
  client.run("changeView('practice')");
  await client.select('[data-confidence]')[2].emit('click');await client.get('reveal-button').emit('click');
  assert.equal(client.get('card-reveal').hidden,false);
  assert.match(client.get('card-prompt').textContent,/Chlorophyll/);
  client.run("openSource('S1')");assert.equal(client.get('source-dialog').open,true);
  request.release();await finished;
  assert.equal(client.run('view'),'practice');assert.equal(client.get('practice-view').hidden,false);
  assert.equal(client.get('card-prompt').textContent,next.cards[0].prompt.replace(/^Complete the note:\s*/,''));
  assert.equal(client.get('card-reveal').hidden,true);assert.equal(client.get('recall-answer').value,'');
  assert.equal(client.get('source-dialog').open,false);
  await client.get('mark-known').emit('click');assert.equal(client.state().history.length,0);
  await client.select('[data-confidence]')[1].emit('click');await client.get('reveal-button').emit('click');await client.get('mark-known').emit('click');
  assert.equal(client.state().history.length,1);assert.equal(client.state().history[0].topic,'New topic');assert.equal(client.state().history[0].confidence,2);
  assert.equal(client.stored().study.title,'New set');
});
for(const view of ['sources','activity'])test(`a delayed build refreshes ${view} without moving the learner`,async()=>{
  const request=deferredResponse(generateStudySet({title:'New set',notes:NEW_NOTES})),client=app({saved:workspace(),fetch:request.fetch});
  const {finished}=await startBuild(client);client.run(`changeView('${view}')`);
  if(view==='sources')assert.match(client.get('source-list').textContent,/Chlorophyll/);
  else {assert.equal(client.get('progress-stats').children[0].children[0].textContent,'1');assert.match(client.get('activity-list').textContent,/Earlier topic/);}
  request.release();await finished;
  assert.equal(client.run('view'),view);assert.equal(client.get(`${view}-view`).hidden,false);
  if(view==='sources'){assert.match(client.get('source-list').textContent,/Mitochondria/);assert.doesNotMatch(client.get('source-list').textContent,/Chlorophyll/);}
  else {assert.equal(client.get('progress-stats').children[0].children[0].textContent,'0');assert.match(client.get('activity-list').textContent,/No attempts yet/);assert.match(client.get('topic-progress').textContent,/New topic/);assert.equal(client.get('clear-progress').disabled,true);}
});
test('a failed delayed build preserves the existing card and practice history',async()=>{
  let release;const response=new Promise(resolve=>release=()=>resolve({ok:false,json:async()=>({error:'Service unavailable'})}));
  const saved=workspace(),client=app({saved,fetch:()=>response});const {finished}=await startBuild(client);client.run("changeView('practice')");release();await finished;
  assert.deepEqual(client.state().study,saved.study);assert.deepEqual(client.state().history,saved.history);assert.match(client.get('card-prompt').textContent,/Chlorophyll/);assert.equal(client.get('generate-button').disabled,false);
});
for(const draftType of ['sample','empty'])test(`demo replacement asks before clearing history when editor notes are ${draftType}`,async()=>{
  const demoNotes=app().run('DEMO_NOTES'),saved=workspace(demoNotes);saved.draft.notes=draftType==='sample'?demoNotes:'';
  const client=app({saved});const pending=client.get('demo-button').emit('click');
  assert.equal(client.get('confirm-dialog').open,true);assert.equal(client.calls.length,0);assert.match(client.get('confirm-text').textContent,/practice history/);
  await client.get('confirm-cancel').emit('click');await pending;
  assert.deepEqual(client.state().study,saved.study);assert.deepEqual(client.state().history,saved.history);assert.equal(client.get('notes').value,saved.draft.notes);
});
test('confirming a repeated demo replaces it once and clears the old history',async()=>{
  const demoNotes=app().run('DEMO_NOTES'),next=generateStudySet({title:'Biology · Photosynthesis',notes:demoNotes});
  const client=app({saved:workspace(demoNotes),fetch:async()=>({ok:true,json:async()=>next})});
  const pending=client.get('demo-button').emit('click');assert.equal(client.get('confirm-dialog').open,true);await client.get('confirm-action').emit('click');await pending;
  assert.equal(client.calls.length,1);assert.equal(client.get('confirm-dialog').open,false);assert.equal(client.state().history.length,0);assert.deepEqual(client.state().study,next);
});
test('the first demo does not require a destructive replacement confirmation',async()=>{
  const demoNotes=app().run('DEMO_NOTES'),next=generateStudySet({notes:demoNotes});
  const client=app({fetch:async()=>({ok:true,json:async()=>next})});await client.get('demo-button').emit('click');
  assert.equal(client.calls.length,1);assert.equal(client.get('confirm-dialog').open,false);assert.ok(client.state().study.cards.length);
});

const corruptions={
  'null source':saved=>saved.study.sources[0]=null,
  'non-string source text':saved=>saved.study.sources[0].text={toString:'invalid'},
  'duplicate source IDs':saved=>saved.study.sources.push({...saved.study.sources[0]}),
  'null card':saved=>saved.study.cards[0]=null,
  'non-string card prompt':saved=>saved.study.cards[0].prompt=7,
  'duplicate card IDs':saved=>saved.study.cards.push({...saved.study.cards[0]}),
  'unsafe card ID':saved=>saved.study.cards[0].id='__proto__',
  'missing card source':saved=>saved.study.cards[0].sourceId='missing',
  'null summary item':saved=>saved.study.summary[0]=null,
  'non-string summary text':saved=>saved.study.summary[0].text={},
  'invalid title':saved=>saved.study.title={},
  'invalid generation metadata':saved=>saved.study.generation.model={toString:'invalid'},
  'invalid arrays':saved=>saved.study.cards={},
  'invalid study notes':saved=>saved.studyNotes=null
};
for(const [name,corrupt] of Object.entries(corruptions))test(`saved workspace with ${name} recovers without crashing or losing editor notes`,()=>{
  const saved=workspace();corrupt(saved);const client=app({saved});
  assert.equal(client.state().study,null);assert.deepEqual(client.state().history,[]);assert.deepEqual(client.state().progress,{});
  assert.equal(client.get('notes').value,OLD_NOTES);assert.equal(client.get('set-title').value,saved.draft.title);assert.match(client.get('notice').textContent,/editor notes were kept/);
  for(const view of ['practice','sources','activity','studio'])assert.doesNotThrow(()=>client.run(`changeView('${view}')`));
});
test('valid saved study and history survive reload while malformed practice entries are ignored',()=>{
  const saved=workspace(),validHistory=structuredClone(saved.history),validProgress=structuredClone(saved.progress);
  saved.study.cards.push({...saved.study.cards[0],id:'C2'});saved.progress.C2={lastOutcome:'known',confidence:3,attempts:{},updatedAt:AT};saved.progress.missing=validProgress.C1;
  saved.history.push(null,{cardId:'C1'},{...validHistory[0],outcome:'invalid'},{...validHistory[0],at:'not a date'},{...validHistory[0],sourceId:'missing'});
  const client=app({saved});assert.deepEqual(client.state().study,saved.study);assert.deepEqual(client.state().history,validHistory);assert.deepEqual(client.state().progress,validProgress);
  for(const view of ['practice','sources','activity','studio'])assert.doesNotThrow(()=>client.run(`changeView('${view}')`));
});
test('a study set with no extracted cards is a valid saved workspace',()=>{
  const saved={version:1,draft:{title:'Empty set',notes:'Short fragment',provider:'offline'},study:generateStudySet({notes:'Short fragment'}),studyNotes:'Short fragment',progress:[],history:{}};
  const client=app({saved});assert.ok(client.state().study);assert.equal(client.state().study.cards.length,0);assert.deepEqual(client.state().progress,{});assert.deepEqual(client.state().history,[]);
  client.run("changeView('practice')");assert.equal(client.get('practice-empty').hidden,false);
});

function mixedWorkspace() {
  const saved=workspace(`${OLD_NOTES}\n\n${NEW_NOTES}`);
  saved.study.mode='ollama';saved.draft.provider='ollama';
  saved.study.summary[0].provenance='ollama';saved.study.cards[0].provenance='ollama';
  saved.study.generation={model:'test-model',accepted:2,rejected:0,fallbackItems:2};
  return saved;
}
function summaryBadges(client) {
  return client.get('summary-list').children.map(row=>row.children[1].children[1].children[1]);
}
test('mixed study-map items show their individual origins with readable text and source links',async()=>{
  const saved=mixedWorkspace(),client=app({saved}),badges=summaryBadges(client);
  assert.deepEqual(badges.map(badge=>badge.textContent),['Origin: Model-selected','Origin: Offline extractive']);
  assert.ok(badges[0].classList.contains('provenance-model'));assert.ok(badges[1].classList.contains('provenance-offline'));
  assert.match(badges[0].title,/local model/);assert.match(badges[1].title,/not a generative AI model/);
  for(const [index,row] of client.get('summary-list').children.entries()) {
    assert.equal(row.children[1].children[0].textContent,saved.study.summary[index].text);
    await row.children[1].children[1].children[0].emit('click');
    assert.equal(client.get('dialog-source-id').textContent,saved.study.summary[index].sourceId);
  }
});
test('mixed recall-card origins update through next, previous, reveal, and review filtering',async()=>{
  const client=app({saved:mixedWorkspace()});client.run("changeView('practice')");
  assert.equal(client.get('card-origin').textContent,'Origin: Model-selected');
  await client.get('next-card').emit('click');assert.equal(client.get('card-origin').textContent,'Origin: Offline extractive');
  await client.select('[data-confidence]')[1].emit('click');await client.get('reveal-button').emit('click');
  assert.equal(client.get('card-reveal').hidden,false);assert.equal(client.get('card-origin').textContent,'Origin: Offline extractive');
  await client.get('previous-card').emit('click');assert.equal(client.get('card-origin').textContent,'Origin: Model-selected');
  await client.get('next-card').emit('click');await client.get('review-cards').emit('click');
  assert.equal(client.get('practice-position').textContent,'1 of 1 cards');assert.equal(client.get('card-origin').textContent,'Origin: Model-selected');
});
test('mixed Markdown export identifies summary and card origins without losing source or practice data',async()=>{
  const saved=mixedWorkspace(),client=app({saved});await client.get('export-button').emit('click');
  assert.equal(client.downloads.length,1);assert.equal(client.downloads[0].type,'text/markdown;charset=utf-8');
  const markdown=await client.downloads[0].text(),map=markdown.split('## Study map')[1].split('## Recall cards')[0],cards=markdown.split('## Recall cards')[1].split('## Sources')[0];
  for(const [index,label] of ['Model-selected','Offline extractive'].entries()) {
    const summary=saved.study.summary[index],card=saved.study.cards[index];
    assert.ok(map.includes(`- ${summary.text} [${summary.sourceId}]\n  Origin: ${label}.`));
    assert.ok(cards.includes(`Source: ${card.sourceId}. Origin: ${label}.`));
    assert.ok(cards.includes(`Answer: ${card.answer}`));
  }
  assert.ok(markdown.includes(saved.studyNotes));assert.ok(markdown.includes(`${AT} · C1/S1 · confidence 3/3 · self-rated needs review`));
});
test('an all-offline set retains offline origin labels in study map, recall, and export',async()=>{
  const client=app({saved:workspace()});
  assert.equal(summaryBadges(client)[0].textContent,'Origin: Offline extractive');
  client.run("changeView('practice')");assert.equal(client.get('card-origin').textContent,'Origin: Offline extractive');
  await client.get('export-button').emit('click');const markdown=await client.downloads[0].text();
  assert.equal((markdown.match(/Origin: Offline extractive/g)||[]).length,2);assert.doesNotMatch(markdown,/Model-selected/);
});
test('legacy missing and unrecognized origins are not inferred from the set mode',async()=>{
  const saved=mixedWorkspace();delete saved.study.summary[0].provenance;delete saved.study.cards[0].provenance;
  saved.study.summary[1].provenance='future-engine';saved.study.cards[1].provenance='future-engine';
  const client=app({saved});assert.ok(client.state().study);
  assert.deepEqual(summaryBadges(client).map(badge=>badge.textContent),['Origin: Not recorded','Origin: Not recorded']);
  client.run("changeView('practice')");assert.equal(client.get('card-origin').textContent,'Origin: Not recorded');
  await client.get('next-card').emit('click');assert.equal(client.get('card-origin').textContent,'Origin: Not recorded');
  await client.get('export-button').emit('click');const markdown=await client.downloads[0].text();
  assert.equal((markdown.match(/Origin: Not recorded/g)||[]).length,4);assert.doesNotMatch(markdown,/Origin: (ollama|Model-selected|Offline extractive)/);
});
test('mixed origins survive saving and reload without being replaced by the set mode',()=>{
  const client=app({saved:mixedWorkspace()});client.run('save()');const restored=app({saved:client.stored()});
  assert.deepEqual(summaryBadges(restored).map(badge=>badge.textContent),['Origin: Model-selected','Origin: Offline extractive']);
  restored.run("changeView('practice')");assert.equal(restored.get('card-origin').textContent,'Origin: Model-selected');
  restored.run('practiceIndex=1;renderPractice()');assert.equal(restored.get('card-origin').textContent,'Origin: Offline extractive');
});
test('a new offline build clears previous mixed item labels in the currently visible recall view',async()=>{
  const request=deferredResponse(generateStudySet({title:'New set',notes:NEW_NOTES})),client=app({saved:mixedWorkspace(),fetch:request.fetch});
  client.run("changeView('practice')");assert.equal(client.get('card-origin').textContent,'Origin: Model-selected');
  const {finished}=await startBuild(client);request.release();await finished;
  assert.equal(client.get('card-origin').textContent,'Origin: Offline extractive');
  assert.deepEqual(summaryBadges(client).map(badge=>badge.textContent),['Origin: Offline extractive']);
});

// These exercise the real import handler with File/DOM doubles. They do not
// exercise a native file chooser, mobile layout, browser storage or keyboard.
function importFile(client,{name='new-notes.txt',content=NEW_NOTES,size=Buffer.byteLength(content),error}={}) {
  const input=client.get('file-input');
  input.files=[{name,size,text:async()=>{if(error)throw error;return content;}}];
  input.value='selected-file';
  return input.emit('change');
}
for(const name of ['new-notes.txt','new-notes.MD'])test(`importing ${name} updates the draft without building or sending notes`,async()=>{
  const client=app();await importFile(client,{name});
  assert.equal(client.get('notes').value,NEW_NOTES);assert.equal(client.state().draft.notes,NEW_NOTES);
  assert.equal(client.get('set-title').value,'new-notes');assert.equal(client.state().study,null);
  assert.equal(client.get('file-input').value,'');assert.equal(client.calls.length,0);
  assert.equal(client.get('confirm-dialog').open,false);assert.match(client.get('toast').textContent,/Notes imported/);
  client.run('save()');const restored=app({saved:client.stored()});assert.equal(restored.get('notes').value,NEW_NOTES);
});
for(const [label,file,expected] of [
  ['unsupported extension',{name:'notes.pdf'},/Choose a \.txt or \.md file/],
  ['oversized byte count',{size:270001},/under 270 KB/],
  ['oversized character count',{content:'x'.repeat(60001)},/too large or is not plain text/],
  ['NUL-containing file',{content:`${NEW_NOTES}\0`},/too large or is not plain text/],
  ['failed read',{error:new Error('Synthetic file read failure')},/Synthetic file read failure/]
])test(`import rejects ${label} without changing the saved workspace`,async()=>{
  const saved=workspace(),client=app({saved});await importFile(client,file);
  assert.deepEqual(client.state(),saved);assert.equal(client.get('notes').value,OLD_NOTES);
  assert.equal(client.get('confirm-dialog').open,false);assert.equal(client.calls.length,0);
  assert.match(client.get('notice').textContent,expected);assert.equal(client.get('notice').hidden,false);
});
test('unsupported and oversized files are rejected before their contents are read',async()=>{
  for(const file of [{name:'notes.exe',size:1},{name:'notes.txt',size:270001}]) {
    const client=app(),input=client.get('file-input');let reads=0;
    input.files=[{...file,text:async()=>{reads++;return NEW_NOTES;}}];await input.emit('change');
    assert.equal(reads,0);assert.equal(client.state().draft.notes,'');
  }
});
test('canceling the file chooser leaves the existing workspace unchanged',async()=>{
  const saved=workspace(),client=app({saved}),input=client.get('file-input');input.files=[];
  await input.emit('change');assert.deepEqual(client.state(),saved);assert.equal(client.calls.length,0);
  assert.equal(client.get('confirm-dialog').open,false);
});
for(const dismissal of ['keep','escape'])test(`canceling note replacement via ${dismissal} preserves all existing work`,async()=>{
  const saved=workspace(),client=app({saved});const pending=importFile(client);await new Promise(setImmediate);
  assert.equal(client.get('confirm-dialog').open,true);assert.match(client.get('confirm-text').textContent,/current study set stays/);
  if(dismissal==='keep')await client.get('confirm-cancel').emit('click');else await client.get('confirm-dialog').emit('cancel');
  await pending;assert.deepEqual(client.state(),saved);assert.equal(client.get('notes').value,OLD_NOTES);
  assert.equal(client.get('confirm-dialog').open,false);assert.equal(client.calls.length,0);
});
test('confirming an import replaces only the editor and retains the study and practice trail',async()=>{
  const saved=workspace(),client=app({saved});const pending=importFile(client);await new Promise(setImmediate);
  await client.get('confirm-action').emit('click');await pending;
  assert.equal(client.state().draft.notes,NEW_NOTES);assert.equal(client.state().draft.title,'new-notes');
  assert.deepEqual(client.state().study,saved.study);assert.equal(client.state().studyNotes,OLD_NOTES);
  assert.deepEqual(client.state().progress,saved.progress);assert.deepEqual(client.state().history,saved.history);
  assert.equal(client.calls.length,0);assert.equal(client.get('confirm-dialog').open,false);
});
test('a file can be selected again after canceling its replacement confirmation',async()=>{
  const client=app({saved:workspace()});let pending=importFile(client);await new Promise(setImmediate);
  await client.get('confirm-cancel').emit('click');await pending;assert.equal(client.get('file-input').value,'');
  pending=importFile(client);await new Promise(setImmediate);await client.get('confirm-action').emit('click');await pending;
  assert.equal(client.state().draft.notes,NEW_NOTES);assert.equal(client.get('file-input').value,'');
});
test('the 60000-character import boundary is accepted without sending notes',async()=>{
  const client=app(),content='x'.repeat(60000);await importFile(client,{content});
  assert.equal(client.state().draft.notes,content);assert.equal(client.get('notice').hidden,true);assert.equal(client.calls.length,0);
});
test('empty text can be imported but cannot replace an existing set through generation',async()=>{
  const client=app();await importFile(client,{content:''});await client.run('buildStudy()');
  assert.equal(client.state().draft.notes,'');assert.equal(client.state().study,null);assert.equal(client.calls.length,0);
  assert.match(client.get('notice').textContent,/at least 40 characters/);
});

function delayedImport(client,name='delayed-notes.txt') {
  let release,reject;
  const content=new Promise((resolve,fail)=>{release=resolve;reject=fail;});
  const input=client.get('file-input');input.files=[{name,size:100,text:()=>content}];
  return {finished:input.emit('change'),release,reject};
}
test('clearing the workspace invalidates a pending file read before it can restore notes',async()=>{
  const client=app(),pending=delayedImport(client);
  const clear=client.get('clear-workspace').emit('click');await client.get('confirm-action').emit('click');await clear;
  pending.release(NEW_NOTES);await pending.finished;
  assert.equal(client.get('notes').value,'');assert.equal(client.state().draft.notes,'');assert.equal(client.state().study,null);
  assert.equal(client.get('confirm-dialog').open,false);assert.doesNotMatch(client.get('toast').textContent,/Notes imported/);
  client.run('save()');assert.equal(client.stored().draft.notes,'');
});
test('canceling a clear request does not revive its superseded file read',async()=>{
  const saved=workspace(),client=app({saved}),pending=delayedImport(client);
  const clear=client.get('clear-workspace').emit('click');await client.get('confirm-cancel').emit('click');await clear;
  pending.release(NEW_NOTES);await pending.finished;assert.deepEqual(client.state(),saved);
  assert.equal(client.get('notes').value,OLD_NOTES);assert.equal(client.get('confirm-dialog').open,false);
});
for(const field of ['notes','set-title'])test(`editing ${field} invalidates an earlier file read`,async()=>{
  const client=app(),pending=delayedImport(client),text=field==='notes'?OLD_NOTES:'My newer title';
  client.get(field).value=text;await client.get(field).emit('input');
  pending.release(NEW_NOTES);await pending.finished;
  assert.equal(client.get(field).value,text);assert.equal(client.state().draft.notes,field==='notes'?OLD_NOTES:'');
  assert.equal(client.get('confirm-dialog').open,false);assert.equal(client.calls.length,0);
});
test('a newer file selection supersedes a delayed import without opening a stale confirmation',async()=>{
  const client=app(),pending=delayedImport(client);
  await importFile(client,{name:'latest.md',content:OLD_NOTES});pending.release(NEW_NOTES);await pending.finished;
  assert.equal(client.get('set-title').value,'latest');assert.equal(client.get('notes').value,OLD_NOTES);
  assert.equal(client.get('confirm-dialog').open,false);
});
test('a superseded file read error cannot overwrite a newer successful import notice',async()=>{
  const client=app(),pending=delayedImport(client);
  await importFile(client,{name:'latest.md',content:OLD_NOTES});pending.reject(new Error('Stale read error'));await pending.finished;
  assert.equal(client.get('notes').value,OLD_NOTES);assert.equal(client.get('notice').hidden,true);
  assert.doesNotMatch(client.get('notice').textContent,/Stale read error/);
});
test('starting a demo invalidates a pending read without replacing the new demo',async()=>{
  const client=app({fetch:async(_url,options)=>({ok:true,json:async()=>generateStudySet(JSON.parse(options.body))})}),pending=delayedImport(client);
  await client.get('demo-button').emit('click');const afterDemo=client.state();assert.ok(afterDemo.study);
  pending.release(NEW_NOTES);await pending.finished;assert.deepEqual(client.state(),afterDemo);
  assert.equal(client.get('confirm-dialog').open,false);
});
test('starting a study build invalidates a pending read without changing the built notes',async()=>{
  const client=app({fetch:async(_url,options)=>({ok:true,json:async()=>generateStudySet(JSON.parse(options.body))})});
  client.get('notes').value=OLD_NOTES;await client.get('notes').emit('input');const pending=delayedImport(client);
  await client.run('buildStudy()');const afterBuild=client.state();assert.ok(afterBuild.study);
  pending.release(NEW_NOTES);await pending.finished;assert.deepEqual(client.state(),afterBuild);
  assert.equal(client.get('confirm-dialog').open,false);
});
test('a newer import dismisses an older import confirmation and accepts only the newer notes',async()=>{
  const client=app({saved:workspace()}),first=importFile(client,{name:'first.txt'});await new Promise(setImmediate);
  assert.equal(client.get('confirm-dialog').open,true);
  const second=delayedImport(client,'second.md');await first;
  assert.equal(client.get('confirm-dialog').open,false);assert.equal(client.get('notes').value,OLD_NOTES);
  const newer='# Newest notes\nChloroplasts contain chlorophyll and perform photosynthesis in plant cells.';
  second.release(newer);await new Promise(setImmediate);assert.equal(client.get('confirm-dialog').open,true);
  await client.get('confirm-action').emit('click');await second.finished;
  assert.equal(client.get('notes').value,newer);assert.equal(client.get('set-title').value,'second');
});
test('practice filter buttons expose their selected state including empty-review fallback',async()=>{
  const client=app({saved:workspace()});client.run("changeView('practice')");
  assert.equal(client.get('all-cards').attributes['aria-pressed'],'true');assert.equal(client.get('review-cards').attributes['aria-pressed'],'false');
  await client.get('review-cards').emit('click');
  assert.equal(client.get('all-cards').attributes['aria-pressed'],'false');assert.equal(client.get('review-cards').attributes['aria-pressed'],'true');
  await client.get('all-cards').emit('click');assert.equal(client.get('all-cards').attributes['aria-pressed'],'true');
  client.run('state.progress={};renderPractice()');await client.get('review-cards').emit('click');
  assert.equal(client.get('all-cards').attributes['aria-pressed'],'true');assert.equal(client.get('review-cards').attributes['aria-pressed'],'false');
});
test('opening a source populates the heading referenced by the dialog accessible name',()=>{
  const saved=workspace(),client=app({saved});client.run("openSource('S1')");
  const dialog=client.get('source-dialog');assert.equal(dialog.open,true);
  const heading=client.get(dialog.attributes['aria-labelledby']);assert.equal(heading.textContent,saved.study.sources[0].heading);
  assert.ok(heading.textContent.trim());
});
