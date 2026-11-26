#!/usr/bin/env node
// Local UI for repo2demo: node server.mjs → http://127.0.0.1:4180  (no dependencies; bound to this machine only)
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseGithubUrl } from './src/clone.mjs';
import { APP_ROOT, deleteRun, findExisting, profilePath, readIndex, rebuildIndex, RUNS, STEPS } from './src/history.mjs';
import { childEnv, findClaude, findMotlab, run, videoBlockedReason } from './src/util.mjs';

const PORT = Number(process.env.PORT || 4180);
const HOST = '127.0.0.1';
const UI = path.join(APP_ROOT, 'ui');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8', '.woff2': 'font/woff2' };
const RUN_FILES = new Set(['demo.mp4', 'demo-sheet.jpg', 'report.md', 'analysis.json']);
const ID_RE = /^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+$/;

// ---- status (cached) -------------------------------------------------------
let statusCache = null;
async function status() {
  if (statusCache && Date.now() - statusCache.at < 60_000) return statusCache.data;
  const data = { claude: null, motlab: null, videoBlocked: videoBlockedReason() };
  try {
    const r = await run(findClaude(), ['auth', 'status'], { timeoutMs: 15_000 });
    const j = JSON.parse(r.stdout);
    data.claude = { loggedIn: !!j.loggedIn, method: j.authMethod ?? null };
  } catch { data.claude = { loggedIn: false, method: null }; }
  try {
    const r = await run(process.execPath, [findMotlab(), '--version'], { env: childEnv(), timeoutMs: 15_000 });
    data.motlab = r.stdout.trim().split(/\s+/).pop() || null;
  } catch { data.motlab = null; }
  statusCache = { at: Date.now(), data };
  return data;
}

// ---- one job at a time -----------------------------------------------------
let job = null;          // { id, url, runId, status, events: [], started, ended, log: [] }
const listeners = new Set();
function push(ev) {
  job.events.push(ev);
  for (const res of listeners) res.write(`data: ${JSON.stringify(ev)}\n\n`);
}
function startJob({ url, video, lang, force }) {
  const args = [path.join(APP_ROOT, 'bin', 'repo2demo.mjs'), url, '--lang', lang];
  if (!video) args.push('--no-video');
  if (force) args.push('--force');
  job = { id: Date.now().toString(36), url, runId: null, status: 'running', events: [], log: [], started: Date.now(), ended: null };
  const child = spawn(process.execPath, args, { cwd: APP_ROOT, env: { ...childEnv(), REPO2DEMO_EVENTS: '1' }, windowsHide: true });
  let buf = '';
  const onData = d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (line.startsWith('@@EV ')) {
        try { const ev = JSON.parse(line.slice(5)); if (ev.type === 'run' || ev.type === 'done') job.runId = ev.id; push(ev); } catch {}
      } else if (line.trim()) {
        job.log.push(line); if (job.log.length > 400) job.log.shift();
        const m = line.match(/^\s{3}(analyse|video) · (\w+)\s?(.*)$/);
        if (m) push({ type: 'tool', agent: m[1], tool: m[2], detail: m[3].slice(0, 120), t: Date.now() });
      }
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', code => {
    job.status = code === 0 ? 'done' : 'failed';
    job.ended = Date.now();
    statusCache = null;
    push({ type: 'exit', code, status: job.status, t: Date.now() });
  });
}

// ---- helpers ---------------------------------------------------------------
function send(res, code, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}
function serveFile(req, res, file) {
  if (!existsSync(file)) return send(res, 404, { error: 'not found' });
  const st = statSync(file);
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range && type === 'video/mp4') {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  createReadStream(file).pipe(res);
}
async function body(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 10_000) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
}
function runDirOf(id) {
  if (!ID_RE.test(id)) return null;
  const dir = path.join(RUNS, id);
  return path.dirname(dir) === RUNS && existsSync(dir) ? dir : null;
}
/** State-changing calls must come from our own page: same Host, no foreign Origin, and a custom header (forces CORS preflight, which we never grant). */
function trusted(req) {
  const host = req.headers.host ?? '';
  if (host !== `${HOST}:${PORT}` && host !== `localhost:${PORT}`) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${HOST}:${PORT}` && origin !== `http://localhost:${PORT}`) return false;
  return req.headers['x-repo2demo'] === '1';
}

// ---- routes ----------------------------------------------------------------
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const p = decodeURIComponent(url.pathname);

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(req, res, path.join(UI, 'index.html'));
    if (req.method === 'GET' && p.startsWith('/ui/')) {
      const f = path.join(UI, p.slice(4));
      return path.relative(UI, f).startsWith('..') ? send(res, 403, { error: 'forbidden' }) : serveFile(req, res, f);
    }
    if (req.method === 'GET' && p === '/api/status') return send(res, 200, { ...(await status()), steps: STEPS, job: job && { id: job.id, url: job.url, runId: job.runId, status: job.status } });
    if (req.method === 'GET' && p === '/api/profile') { const f = profilePath(); return send(res, 200, { path: f, text: readFileSync(f, 'utf8'), template: f.endsWith('profile.example.md') }); }
    if (req.method === 'GET' && p === '/api/runs') return send(res, 200, url.searchParams.has('rebuild') ? rebuildIndex() : readIndex());

    let m;
    if (req.method === 'GET' && (m = p.match(/^\/api\/runs\/([^/]+)$/))) {
      const dir = runDirOf(m[1]); if (!dir) return send(res, 404, { error: 'unknown run' });
      const j = JSON.parse(readFileSync(path.join(dir, 'analysis.json'), 'utf8'));
      const qa = existsSync(path.join(dir, 'qa.json')) ? JSON.parse(readFileSync(path.join(dir, 'qa.json'), 'utf8')) : null;
      return send(res, 200, { id: m[1], ...j, qa, dir, hasVideo: existsSync(path.join(dir, 'demo.mp4')), hasSheet: existsSync(path.join(dir, 'demo-sheet.jpg')), hasProject: existsSync(path.join(dir, 'video', 'project.json')) });
    }
    if (req.method === 'GET' && (m = p.match(/^\/files\/([^/]+)\/([^/]+)$/))) {
      const dir = runDirOf(m[1]);
      if (!dir || !RUN_FILES.has(m[2])) return send(res, 404, { error: 'not found' });
      return serveFile(req, res, path.join(dir, m[2]));
    }
    if (req.method === 'GET' && p === '/api/job') return send(res, 200, job ?? null);
    if (req.method === 'GET' && p === '/api/job/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      for (const ev of job?.events ?? []) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      listeners.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => { clearInterval(ping); listeners.delete(res); });
      return;
    }

    if (req.method === 'POST') {
      if (!trusted(req)) return send(res, 403, { error: 'forbidden' });
      if (p === '/api/analyze') {
        const b = await body(req);
        let gh; try { gh = parseGithubUrl(String(b.url ?? '')); } catch { return send(res, 400, { error: 'That is not a GitHub repository URL. Use github.com/owner/repo.' }); }
        if (job?.status === 'running') return send(res, 409, { error: 'A run is already going. Wait for it to finish.', busy: true });
        const existing = findExisting(gh.owner, gh.repo);
        if (existing && !b.force) return send(res, 409, { error: 'already checked', existing });
        startJob({ url: gh.web, video: b.video !== false, lang: b.lang === 'he' ? 'he' : 'en', force: !!b.force });
        return send(res, 202, { jobId: job.id });
      }
      if ((m = p.match(/^\/api\/runs\/([^/]+)\/(viewer|folder|delete)$/))) {
        const dir = runDirOf(m[1]); if (!dir) return send(res, 404, { error: 'unknown run' });
        if (m[2] === 'delete') {
          if (job?.status === 'running' && job.runId === m[1]) return send(res, 409, { error: 'This run is still going. Wait for it to finish.' });
          try { return send(res, 200, { ok: true, runs: deleteRun(m[1]) }); } catch (e) { return send(res, 500, { error: e.message }); }
        }
        if (m[2] === 'folder') { spawn('explorer', [dir], { detached: true, stdio: 'ignore' }).unref(); return send(res, 200, { ok: true }); }
        const videoDir = path.join(dir, 'video');
        if (!existsSync(path.join(videoDir, 'project.json'))) return send(res, 404, { error: 'This run has no motlab project.' });
        const r = await run(process.execPath, [findMotlab(), 'edit', videoDir], { env: childEnv(), timeoutMs: 30_000 });
        const viewer = (r.stdout + r.stderr).match(/https?:\/\/127\.0\.0\.1:\d+\/\S*/)?.[0];
        return viewer ? send(res, 200, { url: viewer }) : send(res, 500, { error: 'The motlab viewer did not start.' });
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  rebuildIndex();
  console.log(`repo2demo UI → http://${HOST}:${PORT}`);
});
