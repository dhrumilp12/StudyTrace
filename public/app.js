const $ = id => document.getElementById(id);
const STORAGE_KEY = 'studytrace.workspace.v1';
const DEMO_TITLE = 'Biology · Photosynthesis';
const DEMO_NOTES = `# The big picture
Photosynthesis converts light energy into chemical energy stored in glucose.
Plants use carbon dioxide and water to make glucose and release oxygen during photosynthesis.
Chloroplasts are the organelles where photosynthesis takes place in plant cells.

# Capturing light
Chlorophyll absorbs light energy, especially red and blue light.
The light-dependent reactions occur in the thylakoid membranes of chloroplasts.
During the light-dependent reactions, water molecules are split and oxygen is released.
ATP and NADPH carry energy from the light-dependent reactions to the Calvin cycle.

# Building sugars
The Calvin cycle takes place in the stroma, the fluid inside a chloroplast.
The Calvin cycle uses carbon dioxide, ATP, and NADPH to help build sugars.
Carbon fixation is the incorporation of inorganic carbon dioxide into organic molecules.

# What affects the rate?
Light intensity, carbon dioxide concentration, and temperature can limit the rate of photosynthesis.
Increasing light intensity does not keep increasing photosynthesis when another factor becomes limiting.
Photosynthesis supports food webs by turning light energy into chemical energy available to other organisms.`;
let state = { version:1, draft:{title:'',notes:'',provider:'offline'}, study:null, studyNotes:'', progress:{}, history:[] };
let view = 'studio', practiceIndex = 0, reviewOnly = false, practiceDrafts = {}, busy = false, askController, loadWarning = '';
let toastTimer, saveTimer, pendingConfirm, pendingConfirmOwner = '', importRevision = 0;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasStrings = (value, keys) => isRecord(value) && keys.every(key=>typeof value[key]==='string');
const safeId = id => typeof id === 'string' && id.length > 0 && !Object.hasOwn(Object.prototype,id);
function validSavedStudy(study) {
  if(!hasStrings(study,['title','mode']) || !['offline','ollama'].includes(study.mode) || !['sources','cards','summary'].every(key=>Array.isArray(study[key])))return false;
  const sources=new Set(),cards=new Set();
  if(!study.sources.every(source=>{
    if(!hasStrings(source,['id','text','heading']) || !safeId(source.id) || sources.has(source.id))return false;
    sources.add(source.id);return true;
  }))return false;
  if(!study.cards.every(card=>{
    if(!hasStrings(card,['id','prompt','answer','sourceId','topic','quote']) || !safeId(card.id) || cards.has(card.id) || !sources.has(card.sourceId) || (card.provenance!==undefined && typeof card.provenance!=='string'))return false;
    cards.add(card.id);return true;
  }))return false;
  if(!study.summary.every(item=>hasStrings(item,['text','sourceId']) && sources.has(item.sourceId)))return false;
  if(study.warnings!==undefined && (!Array.isArray(study.warnings) || !study.warnings.every(warning=>typeof warning==='string')))return false;
  const generation=study.generation;
  return generation===undefined || (isRecord(generation) && (generation.model==null || typeof generation.model==='string') && ['accepted','rejected','fallbackItems'].every(key=>generation[key]===undefined || (Number.isSafeInteger(generation[key]) && generation[key]>=0)));
}
function restorePractice(saved) {
  const cards=new Map((state.study?.cards || []).map(card=>[card.id,card]));
  const validRating=item=>isRecord(item) && ['known','review'].includes(item.lastOutcome ?? item.outcome) && Number.isInteger(item.confidence) && item.confidence>=1 && item.confidence<=3;
  state.progress=Object.fromEntries(Object.entries(isRecord(saved.progress)?saved.progress:{}).filter(([id,item])=>cards.has(id) && validRating(item) && ['known','review'].includes(item.lastOutcome) && Number.isSafeInteger(item.attempts) && item.attempts>0 && typeof item.updatedAt==='string' && Number.isFinite(Date.parse(item.updatedAt))));
  state.history=(Array.isArray(saved.history)?saved.history:[]).filter(item=>hasStrings(item,['cardId','sourceId','topic','answer','at']) && cards.has(item.cardId) && item.sourceId===cards.get(item.cardId).sourceId && validRating(item) && ['known','review'].includes(item.outcome) && Number.isFinite(Date.parse(item.at))).slice(-500);
}
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    if (saved?.version === 1 && saved.draft && typeof saved.draft.notes === 'string' && typeof saved.draft.title === 'string' && saved.draft.notes.length <= 60000) {
      state.draft={title:saved.draft.title,notes:saved.draft.notes,provider:saved.draft.provider==='ollama'?'ollama':'offline'};
      if(saved.study != null) {
        if(validSavedStudy(saved.study) && typeof saved.studyNotes==='string' && saved.studyNotes.length<=60000) {
          state.study=saved.study;state.studyNotes=saved.studyNotes;restorePractice(saved);
        } else loadWarning='Saved study data could not be read. Your editor notes were kept; build a new study set.';
      }
    } else loadWarning = 'Saved workspace data could not be read. Start a new set below.';
  }
} catch { loadWarning = 'Browser storage is unavailable or could not be read. You can still study, but export your set before leaving.'; }

function node(tag, className, text) { const el = document.createElement(tag); if(className) el.className=className; if(text !== undefined) el.textContent=String(text); return el; }
function setNotice(message, error=false) { $('notice').textContent=message || ''; $('notice').classList.toggle('error',error); $('notice').hidden=!message; }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent=message; $('toast').hidden=false; toastTimer=setTimeout(()=>$('toast').hidden=true,3500); }
function save() { try { localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); } catch { setNotice('This browser could not save your workspace. Export your set before leaving.'); } }
function updateDraft() { state.draft = {title:$('set-title').value,notes:$('notes').value,provider:$('provider').value}; $('word-count').textContent=`${state.draft.notes.trim() ? state.draft.notes.trim().split(/\s+/).length.toLocaleString() : 0} words`; clearTimeout(saveTimer); saveTimer=setTimeout(save,300); }
function showConfirm(title,text,action,owner='') {
  if (pendingConfirm) pendingConfirm(false);
  pendingConfirmOwner=owner;
  $('confirm-title').textContent=title; $('confirm-text').textContent=text; $('confirm-action').textContent=action;
  $('confirm-dialog').showModal();
  return new Promise(resolve => { pendingConfirm=resolve; });
}
function resolveConfirm(answer) { $('confirm-dialog').close(); const resolve=pendingConfirm; pendingConfirm=null; pendingConfirmOwner=''; resolve?.(answer); }
function cancelPendingImport() {
  // File.text() cannot be aborted. Ignore its result after newer editor work,
  // replacement, or clearing, and dismiss only a confirmation owned by import.
  importRevision++;
  if(pendingConfirmOwner==='import')resolveConfirm(false);
}
function changeView(next) {
  if (!['studio','practice','sources','activity'].includes(next)) return;
  view=next;
  document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`${view}-view`);
  document.querySelectorAll('.nav-item').forEach(el=>{const active=el.dataset.view===view;el.classList.toggle('active',active); if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  const names={studio:'Study studio',practice:'Recall practice',sources:'Source notes',activity:'Your progress'};
  $('breadcrumb-title').textContent=names[view];
  const titles={studio:['A little clarity.','A lot more confidence.'],practice:['Less familiar.','More remembered.'],sources:['Every answer','has a beginning.'],activity:['Notice the gaps.','Celebrate the growth.']};
  $('page-title').replaceChildren(document.createTextNode(titles[view][0]),node('br'),document.createTextNode(titles[view][1]));
  const subtitles={studio:'Turn what you’re learning into what you actually know. Your notes. Your pace. Evidence at every step.',practice:'Try it from memory. Say how sure you are. Then follow the evidence.',sources:'A clear path back to the words you started with. No invented references.',activity:'Your confidence and recall, side by side. See what deserves another look.'};
  $('page-subtitle').textContent=subtitles[view];
  renderCurrentView();
  if(window.scrollY>160) window.scrollTo({top:0,behavior:'instant'});
}
function renderCurrentView() { if(view==='practice')renderPractice();if(view==='sources')renderSources();if(view==='activity')renderActivity(); }
function sourceButton(sourceId,label) { const b=node('button','source-link',label || `↗ ${sourceId} · View source`); b.type='button'; b.addEventListener('click',()=>openSource(sourceId)); return b; }
function itemOrigin(item) {
  if(item.provenance==='ollama')return {kind:'model',label:'Model-selected',description:'Selected by the local model. The displayed text is built from the cited notes.'};
  if(item.provenance==='offline')return {kind:'offline',label:'Offline extractive',description:'Selected by the deterministic offline engine, not a generative AI model.'};
  // Legacy items may not record provenance. A mixed set's mode cannot tell us
  // which individual items were selected by the model or the offline engine.
  return {kind:'unknown',label:'Not recorded',description:'This saved item has no recognized origin. The study set mode does not establish its origin.'};
}
function originBadge(item) {
  const origin=itemOrigin(item),badge=node('span',`provenance-badge provenance-${origin.kind}`,`Origin: ${origin.label}`);
  badge.title=origin.description;
  return badge;
}
function openSource(id) {
  const source=state.study?.sources.find(x=>x.id===id); if(!source)return;
  $('dialog-source-heading').textContent=source.heading || 'Your notes'; $('dialog-source-id').textContent=id; $('dialog-source-text').textContent=source.text; $('source-dialog').showModal();
}
function renderStudy() {
  const set=state.study, has=Boolean(set);
  $('empty-state').hidden=has; $('study-results').hidden=!has; $('ask-panel').hidden=!has; $('export-button').disabled=!has;
  $('sidebar-title').textContent=has ? set.title : 'A fresh start'; $('sidebar-subtitle').textContent=has ? `${set.cards.length} cards · saved on this browser` : 'Add notes to begin';
  $('practice-count').textContent=set?.cards.length || 0;
  if(!has)return;
  $('result-title').textContent=set.title; $('source-count').textContent=set.sources.length; $('card-count').textContent=set.cards.length; $('topic-count').textContent=new Set(set.sources.map(x=>x.heading)).size;
  $('mode-badge').textContent=set.mode==='ollama' ? 'Local AI + evidence checks' : 'Offline · Extractive';
  const g=set.generation;
  $('generation-note').textContent=set.mode==='ollama' ? `Local model: ${g?.model || 'Ollama'}. ${g?.accepted || 0} model items accepted after source checks; ${g?.fallbackItems || 0} extractive items. Source checks do not establish factual truth.` : 'Built from exact excerpts. This mode uses deterministic extraction, not a generative AI model.';
  const list=$('summary-list'); list.replaceChildren();
  set.summary.forEach((item,i)=>{const row=node('div','summary-item');row.append(node('span','summary-number',String(i+1).padStart(2,'0')));const content=node('div'),metadata=node('div','item-metadata');metadata.append(sourceButton(item.sourceId),originBadge(item));content.append(node('p','',item.text),metadata);row.append(content);list.append(row);});
  if(!set.summary.length)list.append(node('p','empty-copy','No factual sentences were found. Add complete notes with a subject and an explanation.'));
  $('start-practice').disabled=!set.cards.length;
}
function setBusy(value) {
  busy=value;
  ['generate-button','demo-button','set-title','notes','provider','file-input'].forEach(id=>$(id).disabled=value);
  $('generate-button').querySelector('span').textContent=value ? ($('provider').value==='ollama' ? 'Checking your local model…' : 'Connecting your notes…') : 'Build my study set';
  $('study-form').setAttribute('aria-busy',String(value));
}
async function buildStudy({skipConfirm=false}={}) {
  if(busy)return;
  cancelPendingImport();
  updateDraft(); const {title,notes,provider}=state.draft;
  if(notes.trim().length<40){setNotice('Add at least 40 characters of notes. Complete factual sentences work best.',true);$('notes').focus();return;}
  if(state.study && state.history.length && !skipConfirm && !await showConfirm('Build a fresh study set?','This replaces the current set and resets its practice history. Export your existing set first if you want to keep it.','Build a fresh set'))return;
  setNotice('');setBusy(true);askController?.abort();
  try {
    const response=await fetch('/api/study',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,notes,provider})});
    const data=await response.json();if(!response.ok)throw new Error(data.error || 'Could not create a study set.');
    state.study=data;state.studyNotes=notes;state.progress={};state.history=[];practiceDrafts={};practiceIndex=0;reviewOnly=false;
    $('source-dialog').close();$('answer-result').hidden=true;$('question').value='';save();renderStudy();renderCurrentView();setNotice((data.warnings || []).join('\n'));toast(`${data.cards.length} recall cards ready. Follow the evidence.`);
  } catch(error) {setNotice(`${error.message} Your existing study set has not been changed.`,true);}
  finally {setBusy(false);}
}
function filteredCards() { return (state.study?.cards || []).filter(c=>!reviewOnly || state.progress[c.id]?.lastOutcome==='review'); }
function cardDraft(card) { return practiceDrafts[card.id] ||= {answer:'',confidence:0,revealed:false,rated:false}; }
function renderPractice() {
  const all=state.study?.cards || []; $('practice-empty').hidden=Boolean(all.length);$('practice-content').hidden=!all.length;if(!all.length)return;
  $('review-count').textContent=all.filter(c=>state.progress[c.id]?.lastOutcome==='review').length;
  let cards=filteredCards();
  if(!cards.length){reviewOnly=false;cards=all;toast('No cards need review right now. Keep exploring your set.');}
  for(const [id,selected] of [['all-cards',!reviewOnly],['review-cards',reviewOnly]]) {
    $(id).classList.toggle('selected',selected);$(id).setAttribute('aria-pressed',String(selected));
  }
  practiceIndex=Math.max(0,Math.min(practiceIndex,cards.length-1));const c=cards[practiceIndex],draft=cardDraft(c),p=state.progress[c.id];
  $('practice-position').textContent=`${practiceIndex+1} of ${cards.length} cards`;
  $('card-topic').textContent=c.topic || 'Your notes';$('card-status').textContent=p?.lastOutcome==='known' ? 'Recalled' : p?.lastOutcome==='review' ? 'Needs review' : 'New';
  $('card-origin').replaceChildren(originBadge(c));
  $('card-prompt').textContent=c.prompt.replace(/^Complete the note:\s*/,'');$('recall-answer').value=draft.answer;$('recall-answer').disabled=draft.revealed;
  document.querySelectorAll('[data-confidence]').forEach(b=>{b.setAttribute('aria-pressed',String(Number(b.dataset.confidence)===draft.confidence));b.disabled=draft.revealed;});
  $('reveal-button').hidden=draft.revealed;$('reveal-button').disabled=!draft.confidence;$('confidence-help').hidden=draft.revealed;$('card-reveal').hidden=!draft.revealed;
  $('card-answer').textContent=c.answer;$('card-citation').textContent=`↗ ${c.sourceId} · See the complete source`;$('card-citation').onclick=()=>openSource(c.sourceId);
  $('mark-known').disabled=draft.rated;$('mark-review').disabled=draft.rated;
  $('previous-card').disabled=practiceIndex===0;$('next-card').disabled=practiceIndex===cards.length-1;
  $('practice-prompt').textContent=draft.rated ? 'Saved. Move to the next card when you’re ready.' : 'Small steps build strong memories.';
}
function rateCard(outcome) {
  const card=filteredCards()[practiceIndex];if(!card)return;const draft=cardDraft(card);if(!draft.revealed || draft.rated)return;
  draft.rated=true;const old=state.progress[card.id];const now=new Date().toISOString();
  state.progress[card.id]={lastOutcome:outcome,confidence:draft.confidence,attempts:(old?.attempts || 0)+1,updatedAt:now};
  state.history.push({cardId:card.id,sourceId:card.sourceId,topic:card.topic,outcome,confidence:draft.confidence,answer:draft.answer,at:now});state.history=state.history.slice(-500);save();
  toast(outcome==='known' ? 'Recall recorded. A little stronger than before.' : draft.confidence===3 ? 'A confidence gap noticed. That’s useful progress.' : 'Saved for another look. You’re finding your gaps.');
  renderPractice();
}
function renderSources() {
  const list=$('source-list');list.replaceChildren(); const query=$('source-search').value.trim().toLowerCase();
  const sources=(state.study?.sources || []).filter(s=>`${s.text} ${s.heading} ${s.id}`.toLowerCase().includes(query));
  if(!sources.length){list.append(node('p','empty-copy',state.study ? 'No excerpts match your filter.' : 'Add notes in the study studio to create your source trail.'));return;}
  sources.forEach(s=>{const article=node('article','source-item'),header=node('header');header.append(node('h3','',s.heading),node('span','pill',s.id));article.append(header,node('p','',s.text));list.append(article);});
}
function renderActivity() {
  const cards=state.study?.cards || [],progress=state.progress,known=cards.filter(c=>progress[c.id]?.lastOutcome==='known').length,review=cards.filter(c=>progress[c.id]?.lastOutcome==='review').length;
  const gaps=cards.filter(c=>progress[c.id]?.lastOutcome==='review' && progress[c.id]?.confidence===3);
  const stats=$('progress-stats');stats.replaceChildren();
  [[state.history.length,'Practice attempts'],[known,'Cards recalled'],[review,'Cards to revisit'],[gaps.length,'Confidence gaps']].forEach(([value,label],i)=>{const box=node('div',`stat-card${i===3?' accent':''}`);box.append(node('div','stat-value',value),node('div','stat-label',label));stats.append(box);});
  const topics=$('topic-progress');topics.replaceChildren();const topicNames=[...new Set(cards.map(c=>c.topic))];
  if(!cards.length)topics.append(node('p','empty-copy','Your learning landscape will grow as you practice.'));
  topicNames.forEach(topic=>{const group=cards.filter(c=>c.topic===topic),count=group.filter(c=>progress[c.id]?.lastOutcome==='known').length;const row=node('div','topic-row'),header=node('header');header.append(node('strong','',topic),node('span','',`${count} / ${group.length} recalled`));const meter=node('progress','progress-track');meter.max=group.length;meter.value=count;meter.setAttribute('aria-label',`${topic}: ${count} of ${group.length} recalled`);row.append(header,meter);topics.append(row);});
  const gapsEl=$('confidence-gaps');gapsEl.replaceChildren();
  if(!gaps.length)gapsEl.append(node('p','empty-copy',state.history.length ? 'No unresolved confidence gaps. Keep checking what feels familiar.' : 'Your honest “I know this” moments will help spot hidden gaps.'));
  gaps.forEach(c=>{const box=node('div','gap-item'),b=node('button','text-button','Try this idea again →');box.append(node('p','',c.prompt.replace(/^Complete the note:\s*/,'')));b.addEventListener('click',()=>retryCard(c.id));box.append(b);gapsEl.append(box);});
  const list=$('activity-list');list.replaceChildren();$('clear-progress').disabled=!state.history.length;
  if(!state.history.length)list.append(node('p','empty-copy','No attempts yet. Take your first card for a spin.'));
  [...state.history].reverse().slice(0,50).forEach(item=>{const card=cards.find(c=>c.id===item.cardId);if(!card)return;const row=node('div','activity-row');row.append(node('span','',item.outcome==='known'?'✓':'↻'));const detail=node('div');detail.append(node('p','',`${item.topic} · ${item.outcome==='known'?'Recalled':'Needs another look'}`),node('small','',`Confidence: ${['','still figuring it out','fairly sure','I know this'][item.confidence] || 'not recorded'} · ${item.sourceId}`));const time=node('time','',new Date(item.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));time.dateTime=item.at;const b=node('button','text-button','Retry');b.addEventListener('click',()=>retryCard(item.cardId));row.append(detail,time,b);list.append(row);});
}
function retryCard(id) {reviewOnly=false;practiceIndex=(state.study?.cards || []).findIndex(c=>c.id===id);delete practiceDrafts[id];changeView('practice');$('recall-answer').focus();}
async function askNotes(event) {
  event.preventDefault();if(!state.study)return;const question=$('question').value.trim();if(question.length<3)return;
  askController?.abort();const controller=new AbortController();askController=controller;const study=state.study;
  $('ask-button').disabled=true;$('answer-result').hidden=false;$('answer-result').className='answer-result';$('answer-result').replaceChildren(node('p','muted tiny','Looking for evidence in your notes…'));
  try {
    const response=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({notes:state.studyNotes,question})});const data=await response.json();if(!response.ok)throw new Error(data.error || 'Could not search notes.');if(state.study!==study)return;
    const result=$('answer-result');result.classList.toggle('unsupported',!data.supported);result.replaceChildren(node('strong','',data.supported?'MATCHING NOTE EXCERPT':'NOT ENOUGH EVIDENCE'),node('p','',data.answer));
    data.evidence?.forEach(e=>result.append(sourceButton(e.sourceId)));
    if(data.supported)result.append(node('p','muted tiny','Check whether this excerpt fully answers your question. Matching terms are not a guarantee.'));
  }catch(error){if(error.name!=='AbortError')$('answer-result').replaceChildren(node('p','',error.message));}
  finally{if(askController===controller)$('ask-button').disabled=false;}
}
function exportStudy() {
  const set=state.study;if(!set)return;
  const markdown=[`# ${set.title}`,'',`Exported from StudyTrace on ${new Date().toISOString()}.`,`Mode: ${set.mode==='ollama'?'Local Ollama AI with evidence validation':'Offline deterministic extraction (not generative AI)'}.`,'','Evidence matching is not fact-checking. Recall outcomes are self-rated.','','## Study map','',...set.summary.flatMap(s=>[`- ${s.text} [${s.sourceId}]`,`  Origin: ${itemOrigin(s).label}.`, '']),'## Recall cards','',...set.cards.flatMap((c,i)=>[`${i+1}. ${c.prompt}`,`   Answer: ${c.answer}`,`   Source: ${c.sourceId}. Origin: ${itemOrigin(c).label}. Latest self-rating: ${state.progress[c.id]?.lastOutcome || 'not practiced'}.`,'']),'## Sources','',...set.sources.flatMap(s=>[`### ${s.id} · ${s.heading}`,s.text,'']),'## Practice history','',...state.history.map(h=>`- ${h.at} · ${h.cardId}/${h.sourceId} · confidence ${h.confidence}/3 · ${h.outcome==='known'?'self-rated recalled':'self-rated needs review'}`),'','## Original notes','',state.studyNotes].join('\n');
  const url=URL.createObjectURL(new Blob([markdown],{type:'text/markdown;charset=utf-8'}));const a=node('a');a.href=url;a.download=`${set.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,70)||'studytrace'}-study-set.md`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('Your study set and practice trail are exported.');
}
$('study-form').addEventListener('submit',e=>{e.preventDefault();buildStudy();});
['set-title','notes'].forEach(id=>$(id).addEventListener('input',()=>{cancelPendingImport();updateDraft();}));
$('provider').addEventListener('change',()=>{updateDraft();$('mode-description').textContent=$('provider').value==='ollama'?'Requires Ollama on this computer. Falls back honestly if unavailable.':'Free, deterministic study aids. No model or internet needed.';});
$('demo-button').addEventListener('click',async()=>{
  if(busy)return;
  cancelPendingImport();
  const replacesWork=state.study || state.history.length || (state.draft.notes.trim() && state.draft.notes!==DEMO_NOTES);
  if(replacesWork && !await showConfirm('Explore the demo?','The demo will replace the notes in the editor and the current set, and reset its practice history. Export any work you want to keep first.','Load the demo'))return;
  $('set-title').value=DEMO_TITLE;$('notes').value=DEMO_NOTES;$('provider').value='offline';$('provider').dispatchEvent(new Event('change'));updateDraft();await buildStudy({skipConfirm:true});
});
$('file-input').addEventListener('change',async e=>{
  const file=e.target.files[0];e.target.value='';if(!file || busy)return;
  cancelPendingImport();const revision=importRevision;
  if(!/\.(txt|md)$/i.test(file.name) || file.size>270000){setNotice('Choose a .txt or .md file under 270 KB, with at most 60,000 characters.',true);return;}
  try {
    const content=await file.text();if(revision!==importRevision)return;
    if(content.length>60000 || content.includes('\0'))throw new Error('This file is too large or is not plain text.');
    if(state.draft.notes.trim() && !await showConfirm('Replace the editor notes?','The imported file will replace the notes in your editor. Your current study set stays until you build a new one.','Import notes','import'))return;
    if(revision!==importRevision)return;
    $('notes').value=content;$('set-title').value=file.name.replace(/\.(txt|md)$/i,'');updateDraft();setNotice('');toast('Notes imported. Build your study set when you’re ready.');
  } catch(error) {if(revision===importRevision)setNotice(error.message,true);}
});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>changeView(b.dataset.view)));
$('start-practice').addEventListener('click',()=>changeView('practice'));
$('all-cards').addEventListener('click',()=>{reviewOnly=false;practiceIndex=0;renderPractice();});
$('review-cards').addEventListener('click',()=>{reviewOnly=true;practiceIndex=0;for(const c of filteredCards())delete practiceDrafts[c.id];renderPractice();});
$('recall-answer').addEventListener('input',()=>{const card=filteredCards()[practiceIndex];if(card)cardDraft(card).answer=$('recall-answer').value;});
document.querySelectorAll('[data-confidence]').forEach(b=>b.addEventListener('click',()=>{const card=filteredCards()[practiceIndex];if(!card)return;cardDraft(card).confidence=Number(b.dataset.confidence);renderPractice();}));
$('reveal-button').addEventListener('click',()=>{const card=filteredCards()[practiceIndex];if(!card)return;const draft=cardDraft(card);if(!draft.confidence)return;draft.revealed=true;renderPractice();});
$('mark-review').addEventListener('click',()=>rateCard('review'));$('mark-known').addEventListener('click',()=>rateCard('known'));
$('previous-card').addEventListener('click',()=>{practiceIndex--;renderPractice();});$('next-card').addEventListener('click',()=>{practiceIndex++;renderPractice();});
$('source-search').addEventListener('input',renderSources);$('ask-form').addEventListener('submit',askNotes);$('export-button').addEventListener('click',exportStudy);
['mode-info','privacy-button'].forEach(id=>$(id).addEventListener('click',()=>$('info-dialog').showModal()));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.dataset.close==='confirm-dialog'?resolveConfirm(false):$(b.dataset.close).close()));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom){if(d.id==='confirm-dialog')resolveConfirm(false);else d.close();}}}));
$('confirm-dialog').addEventListener('cancel',e=>{e.preventDefault();resolveConfirm(false);});$('confirm-cancel').addEventListener('click',()=>resolveConfirm(false));$('confirm-action').addEventListener('click',()=>resolveConfirm(true));
$('clear-progress').addEventListener('click',async()=>{if(await showConfirm('Reset your practice trail?','Your notes and study cards stay. All self-ratings and attempt history will be removed from this browser.','Reset progress')){state.progress={};state.history=[];practiceDrafts={};save();renderActivity();toast('A fresh practice trail. Your notes are still here.');}});
$('clear-workspace').addEventListener('click',async()=>{if(busy){toast('Wait for your study set to finish, then clear the workspace.');return;}cancelPendingImport();if(await showConfirm('Clear this workspace?','This removes your notes, study set and practice history from this browser. Export anything you want to keep first.','Clear workspace')){askController?.abort();clearTimeout(saveTimer);state={version:1,draft:{title:'',notes:'',provider:'offline'},study:null,studyNotes:'',progress:{},history:[]};practiceDrafts={};try{localStorage.removeItem(STORAGE_KEY);}catch{}$('set-title').value='';$('notes').value='';$('provider').value='offline';$('word-count').textContent='0 words';$('provider').dispatchEvent(new Event('change'));setNotice('');renderStudy();changeView('studio');toast('Local workspace cleared.');}});
$('set-title').value=state.draft.title;$('notes').value=state.draft.notes;$('provider').value=state.draft.provider==='ollama'?'ollama':'offline';$('provider').dispatchEvent(new Event('change'));renderStudy();if(loadWarning)setNotice(loadWarning);
window.addEventListener('pagehide',()=>{clearTimeout(saveTimer);save();});
