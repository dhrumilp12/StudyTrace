// Optional, explicit live test. Requires the reviewed qwen2.5:3b model already
// installed in Ollama at 127.0.0.1:11434. Never installs or downloads anything.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { createApp } from '../src/server.mjs';
import { generateWithOllama } from '../src/ollama.mjs';
import { generateStudySet } from '../src/engine.mjs';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const model = 'qwen2.5:3b';
const baseUrl = 'http://127.0.0.1:11434';
const shortNotes = await read('examples/biology-notes.md');
const demoNotes = (await read('public/app.js')).match(/const DEMO_NOTES = `([\s\S]*?)`;/)[1];
const getModel = async path => {
  const response = await fetch(`${baseUrl}${path}`);
  assert.ok(response.ok, `Ollama read ${path}: HTTP ${response.status}`);
  return response.json();
};
const version = await getModel('/api/version');
const installed = (await getModel('/api/tags')).models.find(item => item.name === model);
assert.ok(installed, `${model} must already be installed; this script will not download it.`);
const files = ['src/ollama.mjs', 'src/server.mjs', 'src/engine.mjs', 'test/ollama.test.mjs', 'scripts/validate-live-coverage.mjs', 'examples/biology-notes.md', 'public/app.js'];
const sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await read(file)).digest('hex')])));
const artifact = { metadata: { startedAt: new Date().toISOString(), runtime: version, model: installed, node: process.version, hardware: { cpu: cpus()[0]?.model, visibleLogicalCPUs: cpus().length, visibleMemoryBytes: totalmem() }, sourceHashes }, runs: [] };
let capture;
const recordingFetch = async (...args) => {
  capture.request = JSON.parse(args[1].body);
  const response = await fetch(...args);
  capture.httpStatus = response.status;
  capture.outer = await response.clone().json();
  return response;
};
const app = createApp({ generateAI: input => generateWithOllama({ ...input, baseUrl, fetchImpl: recordingFetch }) });
await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${app.address().port}`;
const save = () => writeFile(new URL('artifacts/live-model-coverage-runs.json', root), JSON.stringify(artifact, null, 2)+'\n');
const headings = (sources, items) => [...new Set(items.map(item => sources.find(source => source.id === item.sourceId)?.heading).filter(Boolean))];
async function run(name, notes, { requestedModel = model, timeoutMs = 90_000, expectOffline = false } = {}) {
  process.env.OLLAMA_MODEL = requestedModel;
  process.env.OLLAMA_TIMEOUT_MS = String(timeoutMs);
  capture = {};
  const startedAt = new Date().toISOString(), start = performance.now();
  const response = await fetch(`${origin}/api/study`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ title: name, notes, provider: 'ollama' }) });
  const result = await response.json();
  const elapsedMs = Math.round(performance.now()-start);
  assert.equal(response.status, 200);
  assert.equal(result.mode, expectOffline ? 'offline' : 'ollama');
  for (const item of [...result.summary, ...result.cards]) {
    const source = result.sources.find(source => source.id === item.sourceId);
    assert.ok(source); assert.equal(item.quote, source.text);
    assert.ok(['ollama', 'offline'].includes(item.provenance));
    if (item.answer) { assert.ok(source.text.includes(item.answer)); assert.equal(item.prompt, `Complete the note: ${source.text.replace(item.answer, '____')}`); }
    else assert.equal(item.text, source.text);
  }
  const selected = [...result.summary, ...result.cards];
  assert.equal(result.generation.accepted, selected.filter(item => item.provenance === 'ollama').length);
  assert.equal(result.generation.fallbackItems, selected.filter(item => item.provenance === 'offline').length);
  const offline = generateStudySet({ notes });
  const finalHeadings = headings(result.sources, result.summary);
  assert.equal(finalHeadings.length, headings(offline.sources, offline.summary).length);
  const finalCardHeadings = headings(result.sources, result.cards);
  assert.equal(finalCardHeadings.length, headings(offline.sources, offline.cards).length);
  let plan;
  try { plan = JSON.parse(capture.outer?.response); } catch { /* Expected for failure-path runs. */ }
  if (plan) assert.equal(result.generation.accepted+result.generation.rejected+(result.generation.omittedForCoverage || 0), plan.summary.length+plan.cards.length);
  const outer = capture.outer || {};
  const entry = { name, startedAt, elapsedMs, inputCharacters: notes.length, inputSourceCount: result.sources.length, timeoutMs, model: requestedModel, httpStatus: response.status, mode: result.mode, generation: result.generation, warnings: result.warnings, proposedSummaryHeadings: headings(result.sources, plan?.summary || []), finalSummaryHeadings: finalHeadings, proposedCardHeadings: headings(result.sources, plan?.cards || []), finalCardHeadings, sourceIntegrityPassed: true, modelMetrics: { totalDurationMs: outer.total_duration/1e6, loadDurationMs: outer.load_duration/1e6, evalCount: outer.eval_count, evalDurationMs: outer.eval_duration/1e6, doneReason: outer.done_reason }, result, raw: capture };
  artifact.runs.push(entry); await save();
  console.log(JSON.stringify({ ...entry, result: undefined, raw: undefined }));
}
try {
  await run('biology-cold-default', shortNotes);
  await run('biology-warm-repeat', shortNotes);
  await run('demo-default', demoNotes);
  await run('demo-warm-repeat', demoNotes);
  await run('missing-model-fallback', shortNotes, { requestedModel: 'qwen2.5:studytrace-missing-test', expectOffline: true });
  await run('timeout-fallback', demoNotes, { timeoutMs: 5000, expectOffline: true });
  assert.equal((await (await fetch(`${origin}/api/health`)).json()).ok, true);
  artifact.metadata.finishedAt = new Date().toISOString();
  artifact.metadata.healthAfterFailuresPassed = true;
  await save();
} finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); }
