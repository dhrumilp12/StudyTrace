import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { generateStudySet, parseNotes, answerQuestion } from './engine.mjs';
import { generateWithOllama } from './ollama.mjs';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BYTES = 270_000;
export const MAX_NOTES = 60_000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
function json(res, status, data) { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw Object.assign(new Error('Send application/json.'), {status:415});
  if (Number(req.headers['content-length']) > MAX_BYTES) throw Object.assign(new Error('Request is too large. Keep notes under 60,000 characters.'), {status:413});
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw Object.assign(new Error('Request is too large. Keep notes under 60,000 characters.'), {status:413});
    chunks.push(chunk);
  }
  try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw Object.assign(new Error('Request is not a JSON object.'), {status:400}); }
}
function validateNotes(notes) {
  if (typeof notes !== 'string' || notes.trim().length < 40) throw Object.assign(new Error('Add at least 40 characters of notes so there is enough to study.'), {status:400});
  if (notes.length > MAX_NOTES) throw Object.assign(new Error('Keep your notes under 60,000 characters.'), {status:413});
}
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try { const origin = new URL(req.headers.origin); return ['http:','https:'].includes(origin.protocol) && origin.origin === req.headers.origin && origin.host === req.headers.host; } catch { return false; }
}
export function createApp({generateAI = generateWithOllama} = {}) {
  let activeAI = 0;
  return http.createServer(async (req, res) => {
    try {
      // No cross-origin writes, credentials, third-party resources, or note logging.
      if (!sameOrigin(req) || req.headers['sec-fetch-site'] === 'cross-site') return json(res,403,{error:'Cross-origin requests are not allowed.'});
      let rawPath;
      try { rawPath = decodeURIComponent(req.url.split('?')[0]); } catch { return json(res,400,{error:'Invalid request path.'}); }
      if (rawPath.includes('\\') || rawPath.split('/').some(part=>part==='..' || part==='.')) return json(res,404,{error:'Not found.'});
      const url = new URL(req.url, 'http://localhost');
      const methods = {'/api/health':'GET','/api/study':'POST','/api/ask':'POST'};
      if (methods[url.pathname] && req.method !== methods[url.pathname]) return json(res,405,{error:'Method not allowed.'});
      if (url.pathname === '/api/health' && req.method === 'GET') return json(res,200,{ok:true,name:'StudyTrace',version:'0.1.0',maxNotes:MAX_NOTES});
      if (url.pathname === '/api/study' && req.method === 'POST') {
        const data = await body(req); validateNotes(data.notes);
        if (data.title !== undefined && typeof data.title !== 'string') return json(res,400,{error:'Title must be text.'});
        const input = {title: data.title?.trim().slice(0,100) || 'Untitled study set',notes:data.notes};
        if (!['offline','ollama',undefined].includes(data.provider)) return json(res,400,{error:'Choose offline or local AI mode.'});
        let set;
        if (data.provider === 'ollama') {
          if (activeAI >= 2) return json(res,429,{error:'Local AI is already busy. Try again shortly or use offline mode.'});
          activeAI++;
          try { set = await generateAI({...input,baseUrl:process.env.OLLAMA_URL || 'http://127.0.0.1:11434',model:process.env.OLLAMA_MODEL || 'qwen2.5:3b',timeoutMs:process.env.OLLAMA_TIMEOUT_MS || 90_000}); }
          catch { set = generateStudySet(input); set.warnings = [...(set.warnings || []),'Local AI was unavailable or returned an unverified result. This study set uses the offline extractive engine instead.']; }
          finally { activeAI--; }
        } else set = generateStudySet(input);
        return json(res,200,set);
      }
      if (url.pathname === '/api/ask' && req.method === 'POST') {
        const data = await body(req); validateNotes(data.notes);
        if (typeof data.question !== 'string' || data.question.trim().length < 3 || data.question.length > 500) return json(res,400,{error:'Ask a question between 3 and 500 characters.'});
        return json(res,200,answerQuestion(parseNotes(data.notes),data.question));
      }
      if (url.pathname.startsWith('/api/')) return json(res,404,{error:'API route not found.'});
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'Method not allowed.'});
      const routes = {'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
      const filename = routes[url.pathname];
      if (!filename) return json(res,404,{error:'Not found.'});
      const content = await readFile(path.join(PUBLIC,filename));
      res.writeHead(200,{...headers,'Content-Type':MIME[path.extname(filename)]}); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) { if (!res.headersSent && !res.destroyed) json(res,error.status || 500,{error:error.status ? error.message : 'Something went wrong. Please try again.'}); }
  });
}
export function parseListenOptions(args = process.argv.slice(2), env = process.env) {
  let port = env.PORT || '3000'; let host = env.HOST || '127.0.0.1';
  for (let i=0;i<args.length;i++) {
    const argument=args[i];
    if (argument === '--strictPort') continue; // Node never silently switches an occupied port.
    const match=argument.match(/^--(port|host)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown option: ${argument}`);
    const value=match[2] === undefined ? args[++i] : match[2];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${match[1]}`);
    if (match[1] === 'port') port=value; else host=value;
  }
  if (!/^\d+$/.test(String(port)) || Number(port)>65535) throw new Error('Port must be an integer from 0 to 65535.');
  if (typeof host !== 'string' || !host || /[\s/\\?#@]/.test(host)) throw new Error('Host must be a hostname or IP address, without a URL scheme or path.');
  return {port:Number(port),host};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {port,host}=parseListenOptions();
    const server = createApp();
    server.requestTimeout = 190_000;
    server.on('error',error=>{console.error(`StudyTrace could not start: ${error.message}`);process.exitCode=1;});
    server.listen(port,host,() => console.log(`StudyTrace is ready at http://${host.includes(':') ? '['+host+']' : host}:${server.address().port}`));
  } catch(error) { console.error(`StudyTrace could not start: ${error.message}`);process.exitCode=1; }
}
