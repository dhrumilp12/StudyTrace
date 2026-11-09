import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseNotes,searchSources,answerQuestion} from '../src/engine.mjs';
import {createApp} from '../src/server.mjs';

const water = 'At 25 degrees Celsius, neutral pure water has pH 7.00.';
const conditional = 'P(A | B) = P(A and B) / P(B)';
const joint = 'P(A and B) = P(A) * P(B)';

test('numeric query constraints prevent a different temperature from supplying evidence',()=>{
  const sources=parseNotes(water);
  assert.equal(answerQuestion(sources,'What is pH at 100 degrees Celsius?').supported,false);
  assert.deepEqual(searchSources(sources,'What is pH at 100 degrees Celsius?'),[]);
  const answer=answerQuestion(sources,'What is pH at 25 degrees Celsius?');
  assert.equal(answer.supported,true);
  assert.equal(answer.evidence[0].quote,water);
  assert.equal(answerQuestion(sources,'What is the pH of neutral pure water?').supported,true);
});

test('numeric constraints filter before the search result limit and keep exact matching sources',()=>{
  const sources=parseNotes(Array.from({length:5},(_,i)=>`At ${i+20} degrees Celsius, the sample has pH 7.00.`).join('\n')+'\nAt 100 degrees Celsius, the sample has pH 6.14.');
  const answer=answerQuestion(sources,'What is pH at 100 degrees Celsius?');
  assert.equal(answer.supported,true);
  assert.equal(answer.evidence[0].sourceId,'S6');
  assert.equal(searchSources(sources,'pH at 100 degrees Celsius').length,1);
});

test('numeric literals retain decimal precision, signs and whole-token boundaries',()=>{
  const sources=parseNotes('The sample at -25 degrees Celsius has a density of 1.25 grams per milliliter.');
  for(const q of ['sample at 25 degrees Celsius','sample at 5 degrees Celsius','sample density 1.2 grams per milliliter','sample density 125 grams per milliliter','sample density 1.25 grams per milliliter at 100 degrees Celsius']) {
    assert.equal(answerQuestion(sources,q).supported,false,q);
  }
  assert.equal(answerQuestion(sources,'sample density 1.25 grams per milliliter').supported,true);
  assert.equal(answerQuestion(sources,'sample at -25 degrees Celsius').supported,true);
  assert.equal(answerQuestion(sources,'sample at 25.0 degrees Celsius').supported,false);
  assert.equal(answerQuestion(parseNotes('The sample at \u221225 degrees Celsius is frozen solid.'),'sample at 25 degrees Celsius').supported,false);
});

test('probability search preserves its operator and selects only an exact formula left side',()=>{
  const sources=parseNotes(conditional+'\n'+joint);
  for(const [q,id] of [['What is P(A | B)?','S1'],['What is P(A and B)?','S2'],['What is P( A|B )?','S1'],['What is P(A AND B)?','S2']]) {
    const matches=searchSources(sources,q);
    assert.equal(matches.length,1,q);
    assert.equal(matches[0].sourceId,id,q);
    assert.equal(matches[0].text,sources.find(s=>s.id===id).text);
    const answer=answerQuestion(sources,q);
    assert.equal(answer.supported,false,q);
    assert.deepEqual(answer.evidence,[],q);
  }
});

test('RHS occurrences, different operators, different event case and unsupported expressions abstain',()=>{
  const onlyConditional=parseNotes(conditional);
  assert.equal(answerQuestion(onlyConditional,'What is P(A and B)?').supported,false);
  const sources=parseNotes(conditional+'\n'+joint);
  for(const q of ['What is P(A or B)?','What is P(A & B)?','What is P(A \u2229 B)?','What is P(a | b)?','What is P(B | A)?','What is P(A and B','What is P((A and B))?','What is P(A | B) + P(A and B)?','What is P(A | B) / 2?','What is P(A | B) = P(A and B)?']) {
    assert.equal(answerQuestion(sources,q).supported,false,q);
    assert.deepEqual(searchSources(sources,q),[],q);
  }
});

test('formula answers abstain instead of dropping assumptions or returning only prose',()=>{
  const sources=parseNotes('Independence means that learning event B occurred does not change the probability of event A.\n'+joint+'\nThe Henderson-Hasselbalch equation relates pH, pKa, and the ratio of conjugate base to acid concentrations.');
  for(const q of ['What is P(A and B)?','What is the Henderson-Hasselbalch equation?','What formula relates pH and pKa?','What is pH + pKa?']) {
    const answer=answerQuestion(sources,q);
    assert.equal(answer.supported,false,q);
    assert.deepEqual(answer.evidence,[],q);
  }
  assert.equal(searchSources(sources,'What is P(A and B)?')[0].text,joint);
});

test('original diverse-note regressions use unchanged source evidence',async()=>{
  const read=subject=>readFile(new URL(`../examples/evaluation/${subject}-notes.md`,import.meta.url),'utf8');
  const chemistry=parseNotes(await read('chemistry'));
  const statistics=parseNotes(await read('statistics'));
  assert.equal(answerQuestion(chemistry,'What is pH at 100 degrees Celsius?').supported,false);
  assert.equal(answerQuestion(chemistry,'What is pH at 25 degrees Celsius?').evidence[0].sourceId,'S6');
  assert.equal(searchSources(statistics,'What is P(A and B)?')[0].sourceId,'S14');
  assert.equal(searchSources(statistics,'What is P(A | B)?')[0].sourceId,'S11');
  assert.equal(answerQuestion(statistics,'What is P(A and B)?').supported,false);
  assert.equal(answerQuestion(statistics,'What is P(A | B)?').supported,false);
});

test('HTTP ask applies numeric and formula safeguards',async t=>{
  const app=createApp();
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));
  const origin=`http://127.0.0.1:${app.address().port}`;
  const ask=async question=>{
    const response=await fetch(`${origin}/api/ask`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({notes:water+'\n'+conditional+'\n'+joint,question})});
    assert.equal(response.status,200);
    return response.json();
  };
  const unsupported=await ask('What is pH at 100 degrees Celsius?');
  assert.equal(unsupported.supported,false);
  assert.deepEqual(unsupported.evidence,[]);
  for(const question of ['What is P(A and B)?','What is P(A | B)?']) {
    const answer=await ask(question);
    assert.equal(answer.supported,false);
    assert.deepEqual(answer.evidence,[]);
  }
});
