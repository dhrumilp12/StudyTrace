import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateStudySet } from '../src/engine.mjs';

const cardsFor = notes => generateStudySet({ notes }).cards;
const one = notes => {
  const cards = cardsFor(notes);
  assert.equal(cards.length, 1, notes);
  return cards[0];
};
function assertGrounded(result) {
  assert.deepEqual(result.cards.map(card => card.id), result.cards.map((_, i) => `C${i + 1}`));
  for (const card of result.cards) {
    const source = result.sources.find(source => source.id === card.sourceId);
    assert.equal(card.quote, source.text);
    assert.ok(source.text.includes(card.answer));
    assert.equal(card.prompt, `Complete the note: ${source.text.replace(card.answer, '____')}`);
    assert.equal(card.prompt.replace(/^Complete the note: /, '').replace('____', card.answer), source.text);
    assert.match(card.prompt.replace(/^Complete the note: /, '').replace('____', ''), /[\p{L}\p{N}]/u);
    assert.ok(card.answer.split(/\s+/).length <= 8);
    assert.ok(card.answer.length <= 80);
    assert.equal(card.provenance, 'offline');
  }
  assert.equal(result.generation.fallbackItems, result.summary.length + result.cards.length);
}

test('observed generic blanks become concise complete recall targets on the same source', () => {
  const cases = [
    ['The National Assembly adopted the Tennis Court Oath on 20 June 1789.', '20 June 1789'],
    ['A finally clause runs when control leaves a try statement, including during a return or raised exception.', 'finally clause'],
    ['# Buffers\nA buffer resists a large pH change when a small amount of acid or base is added.', 'a large pH change'],
    ['At 25 degrees Celsius, neutral pure water has pH 7.00.', 'pH 7.00']
  ];
  for (const [notes, expected] of cases) assert.equal(one(notes).answer, expected);
});

test('an early relation prevents the noun means from being treated as the predicate', () => {
  const card = one('The standard error of the mean describes the variability of sample means across repeated samples.');
  assert.equal(card.answer, 'standard error of the mean');
  assert.match(card.prompt, /sample means across repeated samples/);
  assert.equal(one('Conditional probability restricts the sample space to the event that is known to have occurred.').answer, 'Conditional probability');
});

test('multi-part definitions keep later claims visible rather than demand them in one answer', () => {
  const card = one('Binary search requires sorted input and has logarithmic time complexity O(log n) for random-access sequences.');
  assert.equal(card.answer, 'sorted input');
  assert.match(card.prompt, /and has logarithmic time complexity O\(log n\) for random-access sequences/);
  const fresh = one('A secure archive requires a passphrase and has a separate recovery procedure for administrators.');
  assert.equal(fresh.answer, 'a passphrase');
  assert.match(fresh.prompt, /separate recovery procedure/);
});

test('copied noun lists and adjective alternatives are not cut into dangling answers', () => {
  const card = one('Statistical significance is not the same as a large or practically important effect.');
  assert.equal(card.answer, 'Statistical significance');
  assert.match(card.prompt, /is not the same as a large or practically important effect/);
  const list = one('The Henderson-Hasselbalch equation relates pH, pKa, and the ratio of conjugate base to acid concentrations.');
  assert.equal(list.answer, 'Henderson-Hasselbalch equation');
});

test('a compound concept stays intact when its whole span fits', () => {
  const card = one('# Buffers\nA buffer contains a weak acid and its conjugate base or a weak base and its conjugate acid.');
  assert.equal(card.answer, 'a weak acid and its conjugate base');
  assert.match(card.prompt, /or a weak base and its conjugate acid/);
});

test('negation and frequency qualifications stay visible', () => {
  const negative = one('A small p-value is not the probability that the null hypothesis is true.');
  assert.equal(negative.answer, 'small p-value');
  assert.match(negative.prompt, /is not the probability that the null hypothesis is true/);
  const qualified = one('Increasing temperature usually increases reaction rate because a greater fraction of collisions can overcome the activation barrier.');
  assert.equal(qualified.answer, 'reaction rate');
  assert.match(qualified.prompt, /usually increases/);
});

test('date answers preserve day, month, and year as a single literal span', () => {
  const card = one('The observatory opened to visitors on 3 March 1986 after a lengthy renovation.');
  assert.equal(card.answer, '3 March 1986');
  assert.match(card.prompt, /after a lengthy renovation/);
});

test('obvious unresolved references are skipped without removing their source or map excerpt', () => {
  for (const notes of [
    'The original a now contains [1, 3] in its first inner list because the shallow copy shares that inner list.',
    'This contains the answer supplied by the previous example.',
    'The declaration stated that sovereignty resides in the nation rather than the monarch.',
    'The result describes the relationship shown in the preceding figure.'
  ]) {
    const result = generateStudySet({ notes });
    assert.equal(result.cards.length, 0);
    assert.equal(result.sources.length, 1);
    assert.equal(result.summary[0].quote, notes);
    assert.match(result.warnings[0], /No concise card spans/);
  }
});

test('full answer clues in headings or remaining text cause a different span or abstention', () => {
  const card = one('# Chlorophyll\nChlorophyll is a green pigment that absorbs light.');
  assert.equal(card.answer, 'a green pigment');
  const repeated = generateStudySet({ notes: '# Adenine\nAdenine is paired with thymine, and adenine helps form DNA base pairs.' });
  assert.ok(repeated.cards.every(card => card.answer.toLowerCase() !== 'adenine'));
  const pluralHeading = one('# Buffers\nA buffer has limited capacity and can be overwhelmed by adding too much strong acid or strong base.');
  assert.equal(pluralHeading.answer, 'limited capacity');
});

test('unrecognized grammar and symbolic lines do not fall back to arbitrary longest words', () => {
  for (const notes of ['Unusually sophisticated architectural classifications.', 'P(A | B) = P(A and B) / P(B)']) {
    const result = generateStudySet({ notes });
    assert.equal(result.cards.length, 0);
    assert.equal(result.sources[0].text, notes);
    assert.ok(result.summary.some(item => item.quote === notes));
  }
});

test('cards prioritize sources missing from the map while retaining heading diversity', () => {
  const notes = ['# First topic', ...Array.from({ length: 12 }, (_, i) => `Concept A${i} contains distinct information about biological structures.`), '# Second topic', ...Array.from({ length: 12 }, (_, i) => `Concept B${i} requires distinct information about chemical reactions.`)].join('\n');
  const result = generateStudySet({ notes });
  const summarized = new Set(result.summary.map(item => item.sourceId));
  assert.equal(result.cards.length, 12);
  assert.equal(result.summary.length, 8);
  assert.ok(result.cards.every(card => !summarized.has(card.sourceId)));
  assert.deepEqual(new Set(result.cards.map(card => card.topic)), new Set(['First topic', 'Second topic']));
  assertGrounded(result);
});

test('each diverse fixture remains deterministic, bounded, and exactly grounded', () => {
  for (const subject of ['history', 'statistics', 'programming', 'chemistry']) {
    const notes = readFileSync(new URL(`../examples/evaluation/${subject}-notes.md`, import.meta.url), 'utf8');
    const result = generateStudySet({ notes });
    assert.deepEqual(result, generateStudySet({ notes }));
    assert.equal(result.cards.length, 12);
    assert.equal(new Set(result.cards.map(card => card.topic)).size, 4);
    assert.ok(result.summary.length <= 8);
    assertGrounded(result);
  }
});


test('fully named statements are not mistaken for unresolved bare references', () => {
  const named = 'The Declaration of the Rights of Man and of the Citizen was adopted in August 1789.';
  assert.equal(one(named).answer, 'August 1789');
  assert.ok(one('The table of atomic masses describes common isotopes and their measured masses.').answer);
});


test('paired either-or alternatives are not reduced to an incomplete first half', () => {
  const card = one('A visitor pass requires either a ticket or a membership card before admission.');
  assert.equal(card.answer, 'visitor pass');
  assert.match(card.prompt, /either a ticket or a membership card/);
});


test('automatically inferred topic labels do not reveal a selected subject answer', () => {
  const card = one('Conditional probability restricts the sample space to the event that is known to have occurred.');
  assert.equal(card.answer, 'Conditional probability');
  assert.equal(card.topic, 'Notes');
});

test('counted nouns are not mistaken for predicates that hide entire multi-claim tails', () => {
  for (const notes of [
    'After a compact-selection adapter fix, four runs accepted 30/36 proposed cards and took 13.2–26.5 seconds; rejected items remained visibly offline replacements.',
    'After the calibration, three runs yielded comparable measurements for the instrument.',
    'Two uses improved the measured durability of the material.'
  ]) {
    const result = generateStudySet({ notes });
    assert.equal(result.cards.length, 0, notes);
    assert.equal(result.sources[0].text, notes);
    assert.equal(result.summary[0].quote, notes);
    assert.match(result.warnings[0], /No concise card spans/);
  }
});

test('skipping an ambiguous noun still allows a later recognized relation', () => {
  const notes = 'Four runs are required for each verified calibration.';
  const card = one(notes);
  assert.equal(card.answer, 'required for each verified calibration');
  assert.equal(card.prompt, 'Complete the note: Four runs are ____.');
  assertGrounded(generateStudySet({ notes }));
  const numeral = one('4 runs are required for each verified calibration.');
  assert.equal(numeral.answer, card.answer);
  // The same tokens remain usable when they really are the relation.
  assert.equal(one('The calibration routine runs nightly checks on each instrument.').answer, 'nightly checks on each instrument');
});

test('Markdown task-list markers cannot become recall answers but remain source evidence', () => {
  for (const marker of ['[x]', '[X]', '[ ]']) {
    const notes = `- ${marker} Run the optional AI path with the real installed model on the two original fixtures; record accepted/rejected items, latency and actual failure paths.`;
    const result = generateStudySet({ notes });
    assert.equal(result.cards.length, 0, marker);
    assert.equal(result.sources[0].text, notes.slice(2));
    assert.equal(result.summary[0].quote, notes.slice(2));
  }
});

test('README and preserved regression excerpts avoid predicate, checkbox, and formatting defects', () => {
  const currentReadme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assertGrounded(generateStudySet({ notes: currentReadme }));
  // Preserve historical defect inputs explicitly: public documentation may change.
  // These are regression fixtures, not claims about the current test run.
  const notes = currentReadme + `
# Historical regression excerpts
After a compact-selection adapter fix, four runs accepted 30/36 proposed cards and took 13.2–26.5 seconds.
**Real local inference was tested on November 5, 2026** using official Ollama 0.40.14 and qwen2.5:3b on a CPU-only cloud computer with original sample notes.
The latest recorded run passed **151 tests**, including card quality, retrieval safeguards, import cancellation/races, and accessibility source contracts.
- [x] Run the optional AI path with the real installed model on the two original fixtures; record accepted/rejected items, latency and actual failure paths.
`;
  const result = generateStudySet({ notes });
  const observed = result.sources.find(source => source.text.startsWith('After a compact-selection adapter fix, four runs accepted'));
  assert.ok(observed);
  assert.ok(!result.cards.some(card => card.sourceId === observed.id));
  assert.ok(!result.cards.some(card => /^\[[ xX]\]\s/.test(card.quote)));
  // The full README exceeds the twelve-card cap. Test these live source spans
  // independently so documentation growth cannot make selection look like a
  // malformed answer; the full-set exclusions and grounding stay checked below.
  const cardFromSource = prefix => {
    const source = result.sources.find(source => source.text.startsWith(prefix));
    assert.ok(source, `Missing README source: ${prefix}`);
    const focused = generateStudySet({ notes: `# ${source.heading}\n${source.text}` });
    assert.equal(focused.cards.length, 1, source.text);
    assertGrounded(focused);
    return focused.cards[0];
  };
  const inference = cardFromSource('**Real local inference was tested');
  assert.equal(inference?.answer, 'Real local inference');
  assert.match(inference.prompt, /^Complete the note: \*\*____ was tested/);
  const recordedRun = cardFromSource('The latest recorded run passed');
  assert.match(recordedRun?.answer || '', /^\d+ tests$/);
  assert.match(recordedRun.prompt, /run passed \*\*____\*\*/);
  assertGrounded(result);
});

test('a noun followed by a recognized finite predicate does not hide the predicate in its answer', () => {
  const notes = 'The latest recorded run passed **141 tests**, including card quality, retrieval safeguards, import cancellation/races, and accessibility source contracts.';
  const card = one(notes);
  assert.equal(card.answer, '141 tests');
  assert.match(card.prompt, /run passed \*\*____\*\*, including/);
  assertGrounded(generateStudySet({ notes }));
  const other = one('The calibration run passed twelve instrument checks, including the pressure test.');
  assert.equal(other.answer, 'twelve instrument checks');
  assert.equal(one('The calibration routine runs nightly checks on each instrument.').answer, 'nightly checks on each instrument');
});

test('the observed README emphasis remains intact around a clean literal answer', () => {
  const notes = '**Real local inference was tested on November 5, 2026** using official Ollama 0.40.14 and qwen2.5:3b on a CPU-only cloud computer with original sample notes.';
  const card = one(notes);
  assert.equal(card.answer, 'Real local inference');
  assert.match(card.prompt, /^Complete the note: \*\*____ was tested on November 5, 2026\*\*/);
  assertGrounded(generateStudySet({ notes }));
});

test('paired inline emphasis stays in the prompt at either answer boundary', () => {
  for (const marker of ['*', '**', '***']) {
    const notes = `The archive stores ${marker}encrypted records${marker}.`;
    const card = one(notes);
    assert.equal(card.answer, 'encrypted records');
    assert.equal(card.prompt, `Complete the note: The archive stores ${marker}____${marker}.`);
    assertGrounded(generateStudySet({ notes }));
  }
  const left = one('**A protected archive stores encrypted records**.');
  assert.equal(left.answer, 'encrypted records');
  assert.equal(left.prompt, 'Complete the note: **A protected archive stores ____**.');
  const nested = one('The archive stores **encrypted *medical* records**.');
  assert.equal(nested.answer, 'encrypted *medical* records');
  assert.equal(nested.prompt, 'Complete the note: The archive stores **____**.');
});

test('inline code delimiters stay outside answers without stripping literal identifier characters', () => {
  for (const markup of ['`__init__`', '``__init__``', '__init__', 'name_with_underscores']) {
    const notes = `The routine is ${markup} when the class is created.`;
    const card = one(notes);
    assert.equal(card.answer, markup.replace(/`/g, ''));
    assertGrounded(generateStudySet({ notes }));
  }
  const escaped = one('The operator uses \\* as a literal wildcard.');
  assert.equal(escaped.answer, '\\* as a literal wildcard');
});

test('a partial delimiter inside an answer is rejected instead of breaking the copied Markdown', () => {
  const notes = '# Chlorophyll\nChlorophyll is a *green pigment that absorbs light*.';
  const result = generateStudySet({ notes });
  // The complement would hide just the opening asterisk. The subject is already
  // in the heading, so there is no eligible alternate span in this case.
  assert.equal(result.cards.length, 0);
  assert.equal(result.sources[0].text, 'Chlorophyll is a *green pigment that absorbs light*.');
  assert.equal(result.summary[0].quote, result.sources[0].text);
});


test('adjectival participles after uses, runs, and means are not mistaken for another predicate', () => {
  const cases = [
    ['The parser uses accepted tokens to construct a syntax tree.', 'parser'],
    ['A classifier uses rejected samples for evaluation.', 'rejected samples for evaluation'],
    ['The routine runs accepted samples through the model.', 'accepted samples through the model'],
    ['A comparator uses returned values to determine ordering.', 'returned values to determine ordering'],
    ['The term means accepted practice in this context.', 'accepted practice in this context']
  ];
  for (const [notes, answer] of cases) {
    assert.equal(one(notes).answer, answer);
    assertGrounded(generateStudySet({ notes }));
  }
});
