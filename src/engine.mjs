/** Deterministic source matching, not factual verification or a generative model. */
const STOP = new Set('a an the and or but of to in on at for from with by as is are was were be been being it its this that these those what which who why how when where does do did can could would should explain describe tell me about according notes'.split(' '));
const rawWords = text => String(text).toLowerCase().match(/[a-z][a-z0-9'-]*/g) || [];
const words = text => rawWords(text).filter(w => !STOP.has(w));
function stem(word) {
  if (word.length > 5 && word.endsWith('ies')) return word.slice(0,-3)+'y';
  if (word.length > 4 && /(?:ches|shes|sses|xes)$/.test(word)) return word.slice(0,-2);
  if (word.length > 3 && word.endsWith('s') && !/(?:ss|is|us)$/.test(word)) return word.slice(0,-1);
  if (word.length > 6 && word.endsWith('ing')) return word.slice(0,-3).replace(/(.)\1$/, '$1');
  return word;
}
const unique = text => [...new Set(words(text).map(stem))];
const unsafe = text => /(?:ignore (?:all |previous |the )?(?:instructions|rules)|system prompt|developer message|you are (?:an? )?(?:assistant|chatgpt)|\b(?:execute|run) (?:this |the )?(?:command|script)|send (?:the |your )?(?:password|secret|api key))/i.test(text);
function headingText(line) { return line.replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').replace(/[:\s]+$/, '').trim(); }
function sentences(line) {
  // Split only sentence-ending punctuation. Decimal points, abbreviations and URLs remain intact.
  const results=[]; let start=0;
  for(let i=0;i<line.length;i++) {
    if(!/[.!?]/.test(line[i]) || (i+1<line.length && !/\s/.test(line[i+1]))) continue;
    const prefix=line.slice(start,i+1);
    if(line[i]==='.' && /\b(?:Mr|Mrs|Ms|Dr|Prof|vs|etc|e\.g|i\.e)\.$/i.test(prefix)) continue;
    const value=prefix.trim(); if(value) results.push(value); start=i+1;
  }
  const tail=line.slice(start).trim(); if(tail) results.push(tail);
  return results;
}
export function parseNotes(text) {
  if (typeof text !== 'string') return [];
  const sources = []; let heading = 'Notes';
  for (let line of text.replace(/\r\n?/g, '\n').split('\n')) {
    line = line.trim();
    if (!line || /^```\w*\s*$/.test(line)) continue;
    if (/^#{1,6}\s+/.test(line) || (line.endsWith(':') && line.length < 90 && line.split(/\s+/).length < 12)) { heading = headingText(line) || 'Notes'; continue; }
    line = line.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '');
    for (const sentence of sentences(line)) if(sentence) sources.push({ id: `S${sources.length + 1}`, text: sentence, heading });
  }
  return sources;
}
function substantive(source) { return !unsafe(source.text) && source.text.length >= 24 && words(source.text).length >= 3; }
// Preserve the model adapter's prior source-eligibility boundary independently
// of the stricter offline card chooser. This tests only that the old extractor
// had some non-whole-source span; it does not score or construct a model card.
export function isEligibleModelSource(source) {
  if (!substantive(source)) return false;
  const relation = source.text.match(/^.{3,80}?\s+(?:is|are|was|were|means|refers to|converts|contains|stores|requires|produces|uses)\s+(.+?)[.!?]?$/i);
  if (relation && relation[1].length > 4) return true;
  return [...source.text.matchAll(/\b[a-zA-Z][a-zA-Z-]{4,}\b/g)].some(match => !STOP.has(match[0].toLowerCase()));
}
function topicFor(source) {
  if (source.heading !== 'Notes') return source.heading;
  const match = source.text.match(/^(.{3,65}?)\s+(?:is|are|was|were|refers to|means|occurs|uses|converts|helps|stores|contains)\b/i);
  return match ? match[1].replace(/^[\s*-]+/, '') : words(source.text).slice(0, 3).join(' ');
}
function informationScore(s) {
 const terms=unique(s.text);
 return Math.min(terms.length,24) + (/\b(?:is|are|means|because|causes|requires|converts|produces|contains|stores|defined|consists|depends)\b/i.test(s.text)?5:0) + (/\d/.test(s.text)?2:0) - (s.text.length>450?8:0) - (/\?$/.test(s.text)?12:0);
}
function selectDiverse(facts, limit, compare = (a, b) => informationScore(b) - informationScore(a)) {
 const groups=new Map();
 for(const s of facts) { if(!groups.has(s.heading))groups.set(s.heading,[]); groups.get(s.heading).push(s); }
 for(const group of groups.values())group.sort(compare);
 const queues=[...groups.values()].sort((a,b)=>compare(a[0],b[0]));
 const chosen=[];
 while(chosen.length<limit && queues.some(g=>g.length)) for(const group of queues) {if(group.length && chosen.length<limit)chosen.push(group.shift());}
 return chosen;
}
// These are English surface heuristics, not a parser or a claim of educational
// importance. If a concise intact span cannot be identified, keep the source
// available without manufacturing a question or hiding an arbitrary long word.
const CARD_RELATION = /\s+((?:(?:can|could|may|might|must|will|does|do)\s+(?:not\s+)?(?:[a-z]+ly\s+)?[a-z]+|(?:is|are|was|were)(?:\s+not)?|means|refers to|converts?|contains?|stores?|requires?|produces?|uses?|describes?|restricts?|measures?|establishes|established|binds?|creates?|copies|makes?|runs?|handles?|preserves?|donates?|accepts?|dissociates?|relates?|resists?|has|have|increases?|decreases?|compares?|absorbs?|occurs?|takes? place|provides?|replaced|covers?|stated|coordinated|challenged|passes|passed))(?=\s)/gi;
const SUBJECT_MODIFIERS = new Set('a an the one two three four five six seven eight nine ten eleven twelve first second third some any all both each every few many several more most less least other another only'.split(' '));
function cardRelation(text) {
  for (const match of text.matchAll(CARD_RELATION)) {
    const subject = text.slice(0, match.index).trim();
    if (subject.length > 100) break;
    if (subject.length < 2) continue;
    // A quantifier cannot supply the missing noun in a subject. In "four runs
    // accepted...", runs is a noun, not the relation. Try later predicates
    // (e.g. "Four runs are required...") or leave the source without a card.
    const clauseSubject = subject.split(/[,;:]/).at(-1);
    if (!rawWords(clauseSubject).some(term => !SUBJECT_MODIFIERS.has(term))) continue;
    const complement = text.slice(match.index + match[0].length).trim().replace(/[.!?]$/, '');
    // These forms can also be nouns. Only recognize a narrow next-predicate
    // pattern; participles such as "accepted" or "rejected" can instead modify
    // an object in valid phrases like "uses rejected samples".
    if (/^(?:runs?|uses?|means)$/i.test(match[1]) && /^(?:is|are|was|were|has|have|passes|passed)\b/i.test(complement)) continue;
    if (complement) return [null, subject, match[1], complement];
  }
  return null;
}
// Track simple inline delimiters without changing the cited source. A cloze may
// sit inside emphasis/code, but must not take only one half of its delimiters.
// This is deliberately smaller than a Markdown parser; recognized partial spans abstain.
function cardFormatting(text) {
  const pairs = [], open = new Map(); let code = null;
  for (const match of text.matchAll(/`+|\*+|_+/g)) {
    const token = { text: match[0], start: match.index, end: match.index + match[0].length };
    if (code) {
      if (token.text === code.text) { pairs.push([code, token]); code = null; }
      continue;
    }
    let escaped = false;
    for (let i = token.start - 1; text[i] === '\\'; i--) escaped = !escaped;
    if (escaped) continue;
    if (token.text[0] === '`') { code = token; continue; }
    if (token.text.length > 3) continue;
    const before = text[token.start - 1] || '', after = text[token.end] || '';
    if (token.text[0] === '_' && /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after)) continue;
    if (open.has(token.text) && /\S/.test(before)) {
      pairs.push([open.get(token.text), token]); open.delete(token.text);
    } else if (/\S/.test(after)) open.set(token.text, token);
  }
  const unmatched = [...open.values(), ...(code ? [code] : [])];
  const opening = new Map(pairs.map(pair => [pair[0].start, pair]));
  const closing = new Map(pairs.map(pair => [pair[1].end, pair]));
  return (start, end) => {
    // Leave paired asterisks/backticks in the prompt when they touch a span's
    // edge. Do not strip underscores: they may belong to a literal identifier.
    for (;;) {
      const beforeStart = start, beforeEnd = end;
      const left = opening.get(start), right = closing.get(end);
      if (left && left[0].text[0] !== '_' && end <= left[1].end) start = left[0].end;
      if (right && right[0].text[0] !== '_' && start >= right[0].end) end = right[1].start;
      if (start === beforeStart && end === beforeEnd) break;
    }
    const intersects = token => start < token.end && end > token.start;
    if (start >= end || unmatched.some(intersects)) return null;
    for (const [left, right] of pairs) {
      if (intersects(left) !== intersects(right)) return null;
      if ([left, right].some(token => intersects(token) && (start > token.start || end < token.end))) return null;
    }
    return { start, answer: text.slice(start, end) };
  };
}
const CONTEXT_DEPENDENT = /^(?:it|its|they|their|these|those|this|that|he|she|his|her|such)\b|^the (?:original|former|latter|above|following|same)\b/i;
function containsAnswer(text, answer) {
  const key = words(answer).map(stem).join(' ');
  return !!key && ` ${words(text).map(stem).join(' ')} `.includes(` ${key} `);
}
function cardSpan(source) {
  const text = source.text;
  // Task-list markers and instructions are not factual recall targets. Preserve
  // their source text, but do not turn a checkbox into a cloze answer.
  if (CONTEXT_DEPENDENT.test(text) || /^\[[ xX]\]\s/.test(text)) return null;
  const relation = cardRelation(text);
  if (relation && /^the (?:statement|declaration|result|example|passage|figure|table|chart|code|output)$/i.test(relation[1])) return null;
  const candidates = [];
  const formatting = cardFormatting(text);
  const add = (answer, priority) => {
    if (!answer) return;
    const rawStart = text.indexOf(answer);
    if (rawStart < 0) return;
    const span = formatting(rawStart, rawStart + answer.length);
    if (!span) return;
    const { start } = span; answer = span.answer;
    const count = answer.trim().split(/\s+/).length;
    if (start < 0 || count > 8 || answer.length > 80 || !/[\p{L}\p{N}]/u.test(answer)) return;
    const rest = text.slice(0, start) + text.slice(start + answer.length);
    if (!/[\p{L}\p{N}]/u.test(rest)) return;
    // Avoid giving the entire answer away in the heading or remaining sentence.
    // Matching normalized contiguous terms also catches simple plural headings.
    if (!words(answer).length || containsAnswer(source.heading, answer) || containsAnswer(rest, answer)) return;
    candidates.push({ answer, start, priority });
  };
  const date = text.match(/\b(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/);
  if (date) add(date[0], 5);
  if (relation) {
    const subject = relation[1].replace(/^(?:The|An?)\s+/i, '').replace(/\s+(?:usually|generally|often|sometimes|always|never|rarely|typically|nearly|almost)$/i, '');
    // A leading condition or a relative clause is not a clean subject span.
    if (!/[,;:]|\b(?:that|which|when|while|because|if)\b/i.test(subject) && !/^(?:At|In|For|On|With|After|Before)\b/i.test(subject)) add(subject, 3);
    // Use explicit clause or alternative boundaries, never a word-count cut.
    // An and-linked noun phrase (e.g. acid and conjugate base) stays intact.
    let complement = relation[3].split(/;|,\s+(?:whereas|although|but|subject to|including)\b|\s+(?:whereas|although|because|when|while|subject to|rather than)\b|\s+(?:and|but)\s+(?:has|have|is|are|can|does|requires)\b|\s+or\s+(?=(?:a|an|the)\b)/i)[0];
    if (/^(?:is|are|was|were)$/i.test(relation[2])) complement = complement.split(/\s+(?:that|which|where)\b/i)[0];
    complement = complement.replace(/[,;.!?]+$/, '').trim();
    // Do not hide a qualification, an unanchored adverbial tail, or an entire
    // second proposition behind a seemingly short answer.
    if (complement && !/^(?:not|only|always|never|generally|usually|nearly|almost|either|when|where|that|to|by|from|during|across)\b/i.test(complement) && !/\b(?:is|are|was|were|can|does|has)\b/i.test(complement)) add(complement, complement.split(/\s+/).length <= 6 ? 4 : 2);
  }
  return candidates.sort((a, b) => b.priority - a.priority || a.answer.length - b.answer.length)[0] || null;
}
function cardFor(source, i) {
  const span = cardSpan(source);
  if (!span) return null;
  const { answer, start } = span;
  const inferredTopic = topicFor(source);
  // A generated topic label must not reveal the subject used as the answer.
  const topic = containsAnswer(inferredTopic, answer) ? 'Notes' : inferredTopic;
  return { id: `C${i + 1}`, prompt: `Complete the note: ${source.text.slice(0,start)}____${source.text.slice(start + answer.length)}`, answer, sourceId: source.id, quote: source.text, topic,provenance:'offline' };
}
export function generateStudySet({ title = 'My study notes', notes = '' } = {}) {
  const sources = parseNotes(notes);
  const seen = new Set();
  const facts = sources.filter(s => { const key = s.text.toLowerCase(); if (!substantive(s) || seen.has(key)) return false; seen.add(key); return true; });
  const summary=selectDiverse(facts,8).map((s,i) => ({ id: `M${i+1}`, text: s.text, sourceId:s.id, quote:s.text,provenance:'offline' }));
  const cardFacts = facts.filter(source => cardFor(source, 0) !== null);
  // Reuse the same heading diversity, but spend card slots on eligible sources
  // absent from the map before repeating one. Eight excerpts and twelve cards
  // are caps, not a promise that every concept has been covered.
  const summarized = new Set(summary.map(item => item.sourceId));
  const cards=selectDiverse(cardFacts,12,(a, b) => Number(summarized.has(a.id)) - Number(summarized.has(b.id)) || informationScore(b) - informationScore(a)).map(cardFor);
  return { title: String(title || 'My study notes').slice(0,160), sources, summary,cards, mode:'offline',generation:{model:null,accepted:0,rejected:0,fallbackItems:summary.length+cards.length},warnings: !facts.length ? ['Add a few complete factual sentences to generate study aids.'] : !cards.length ? ['No concise card spans were found. The source notes and study map are still available.'] : [] };
}
function retrievalConstraints(question) {
  // Keep literal numbers out of the English stemmer. Matching a numeral is a
  // necessary condition, not a claim about its units, role, or equivalence.
  const numbers = text => new Set(String(text).match(/[+\-\u2212]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+\-]?\d+)?/g) || []);
  const requiredNumbers = numbers(question);
  const q = String(question);
  const probabilityStarts = q.match(/\bp\s*\(/gi) || [];
  // Recognize only a single simple literal probability expression. Preserve
  // event case and operators; do not equate and/or/conditional notation.
  const expression = /\bp\s*\(\s*([a-z][a-z0-9_]*)(?:\s*(\||&|\u2229|\u222a|\band\b|\bor\b|\bgiven\b)\s*([a-z][a-z0-9_]*))?\s*\)/i;
  const requested = q.match(expression);
  const key = match => JSON.stringify([match[1], (match[2] || '').toLowerCase(), match[3] || '']);
  const unsupportedExpression = probabilityStarts.length > 0 && (probabilityStarts.length !== 1 || !requested || /[=<>+*/^|&\u2229\u222a]/.test(q.replace(requested[0], '')));
  return text => {
    if (unsupportedExpression) return false;
    const presentNumbers = numbers(text);
    if ([...requiredNumbers].some(number => !presentNumbers.has(number))) return false;
    if (!requested) return true;
    const declared = String(text).match(expression);
    // A formula's RHS can mention a different quantity. Require the requested
    // expression to be the entire LHS, rather than treating that mention as an answer.
    return !!declared && declared.index === 0 && /^\s*=\s*\S/.test(text.slice(declared[0].length)) && key(declared) === key(requested);
  };
}
export function searchSources(sources, question) {
  const query = unique(question);
  if (!query.length || !Array.isArray(sources)) return [];
  const matchesConstraints = retrievalConstraints(question);
  return sources.filter(s => substantive(s) && matchesConstraints(s.text)).map(s => {
    const textTerms = new Set(unique(s.text));
    const matches = query.filter(w => textTerms.has(w)).length;
    return { sourceId:s.id, text:s.text, score: matches / query.length };
  }).filter(s => s.score > 0).sort((a,b) => b.score-a.score).slice(0,4);
}
export function answerQuestion(sources, question) {
  const matches = searchSources(sources,question);
  const query = unique(question); const best=matches[0];
  const q=String(question);
  const negated=/\b(?:not|never|no|neither|without|except|cannot|can't|don't|doesn't|isn't|aren't|won't)\b/i.test(q);
  const comparative=/\b(?:compare|compared|comparison|difference|different|versus|vs|better|worse|more|less|most|least|greater|fewer|higher|lower)\b/i.test(q);
  const quantity=/\b(?:how many|how much|percentage|percent|quantity|amount|number of|how long|how often|how far)\b/i.test(q);
  // Exact symbolic lookup still cannot establish a formula's assumptions or
  // connect qualifiers from another source. Do not promote it to a Q&A answer.
  const formula=/\b(?:formula|equation)\b|\bp\s*\(|[=+*/|<>^\u2229\u222a]/i.test(q);
  const unsupported= !best || best.score<1 || !query.length || unsafe(q) || negated || comparative || formula || (quantity && (!/\d/.test(best.text) || best.score<0.85));
  if (unsupported) return { supported:false,label:'Insufficient matching evidence',answer:'I could not find enough matching evidence in these notes. Try adding notes on this topic or asking a more specific question.', evidence:[], mode:'offline' };
  return { supported:true,label:'Matching note excerpt',answer:best.text,evidence:[{sourceId:best.sourceId,quote:best.text}],mode:'offline' };
}
