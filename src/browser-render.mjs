// Render motlab scenes in an ordinary Chrome window: no DevTools / remote debugging, which an organisation can switch
// off by policy. motlab's own file server serves the project; a driver page loads each scene in a same-origin iframe,
// injects motlab's in-page runtime (WebCodecs encoder, unchanged) and posts the encoded bytes back to that server.
// Progress comes back through a "status" file the page appends JSON lines to.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { childEnv, findMotlab, run } from './util.mjs';

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
export const findChrome = () => process.env.CHROME && existsSync(process.env.CHROME) ? process.env.CHROME : CHROME.find(p => existsSync(p));

const engineDir = () => path.resolve(path.dirname(findMotlab()), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Driver page: runs in the Chrome window, does one job (encode scenes, or take stills), reports in status lines. */
const DRIVER = String.raw`<!doctype html><meta charset="utf-8"><title>repo2demo · rendering</title>
<style>body{margin:0;background:#04121b;color:#fff;font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;height:100vh}
main{text-align:center}#p{margin-top:8px;opacity:.75}iframe{position:fixed;left:0;top:0;border:0;opacity:0;pointer-events:none}</style>
<main><b>repo2demo is rendering your video</b><div id="p">Starting…</div><div style="margin-top:14px;opacity:.6">This window closes by itself.</div></main>
<script type="module">
const job = await fetch('job.json', { cache: 'no-store' }).then(r => r.json());
const say = o => fetch(job.base + '/append?id=' + job.statusSink, { method: 'POST', body: JSON.stringify(o) + '\n' });
const p = document.getElementById('p');
async function load(file) {
  const f = document.createElement('iframe');
  f.width = 1920; f.height = 1080;
  f.src = '/' + file + (file.includes('?') ? '&' : '?') + 'scale=' + job.scale;
  document.body.append(f);
  await new Promise((ok, no) => { f.onload = ok; f.onerror = no; });
  const w = f.contentWindow;
  if (!w.__motlab) await new Promise((ok, no) => { const s = w.document.createElement('script'); s.src = '/.render/runtime.js'; s.onload = ok; s.onerror = () => no(new Error('runtime did not load')); w.document.head.append(s); });
  for (let i = 0; i < 200 && !w.ready && !w.renderAt; i++) await new Promise(r => setTimeout(r, 50));
  await w.ready; if (w.document.fonts) await w.document.fonts.ready;
  if (typeof w.renderAt !== 'function') throw new Error(file + ': no window.renderAt');
  return { f, w };
}
async function pickConfig(width, height) {
  const level = width * height > 2304000 ? '640033' : '640028';
  for (const hw of [true, false]) for (const codecString of ['avc1.' + level, 'avc1.4d0028', 'avc1.42e028']) {
    const cfg = { codec: codecString, width, height, framerate: job.fps, hardwareAcceleration: hw ? 'prefer-hardware' : 'prefer-software', bitrateMode: 'variable', bitrate: job.bitrate, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { hw, codecString }; } catch {}
  }
  throw new Error('no H.264 encoder available in this Chrome');
}
try {
  if (job.mode === 'encode') {
    for (const [i, s] of job.scenes.entries()) {
      p.textContent = 'Scene ' + (i + 1) + ' of ' + job.scenes.length;
      const { f, w } = await load(s.file);
      const info = w.__motlab.info();
      const frames = Math.round(info.total * job.fps);
      const c = await pickConfig(info.width, info.height);
      const r = await w.__motlab.encodeRange({ start: 0, end: frames, fps: job.fps, codec: 'avc', codecString: c.codecString, hw: c.hw,
        rc: 'variable', bitrate: job.bitrate, keyInterval: job.fps * 2, mux: 'mediabunny', base: job.base, sink: s.sink });
      await say({ type: 'scene', i, frames, width: info.width, height: info.height, hw: c.hw, codec: c.codecString, ms: Math.round(r.ms) });
      f.remove();
    }
  } else {
    const { f, w } = await load(job.scene);
    for (const s of job.stills) { p.textContent = 'Still ' + s.t + 's'; await w.__motlab.still({ t: s.t, type: 'image/png', base: job.base, sink: s.sink }); }
    await say({ type: 'stills', n: job.stills.length });
    f.remove();
  }
  await say({ type: 'done' });
} catch (e) {
  await say({ type: 'error', message: String(e && (e.message || e)) });
}
setTimeout(() => window.close(), 300);
</script>`;

/**
 * Run one driver job in a fresh Chrome window (own temporary profile, closed afterwards).
 * prepare(srv) creates the sinks and returns the job object (without base/statusSink).
 */
async function runJob(projectDir, prepare, { timeoutMs = 30 * 60_000, onEvent } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('Google Chrome not found (set CHROME to its path).');
  const { startServer } = await import(pathToFileURL(path.join(engineDir(), 'src', 'server.js')).href);
  const renderDir = path.join(projectDir, '.render');
  mkdirSync(renderDir, { recursive: true });
  copyFileSync(path.join(engineDir(), 'src', 'page', 'runtime.js'), path.join(renderDir, 'runtime.js'));
  writeFileSync(path.join(renderDir, 'driver.html'), DRIVER);

  const srv = await startServer({ root: projectDir });
  const statusPath = path.join(renderDir, 'status.jsonl');
  const status = await srv.createSink(statusPath);
  const { job, sinks } = await prepare(srv);
  writeFileSync(path.join(renderDir, 'job.json'), JSON.stringify({ ...job, base: srv.base, statusSink: status.id }));

  const profile = mkdtempSync(path.join(tmpdir(), 'repo2demo-chrome-'));
  const proc = spawn(chrome, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--window-size=520,260', '--window-position=40,40', `--app=${srv.origin}/.render/driver.html`], { stdio: 'ignore', windowsHide: false });

  const started = Date.now(); let seen = 0, result = null;
  try {
    while (!result) {
      if (Date.now() - started > timeoutMs) throw new Error(`browser render timed out after ${Math.round(timeoutMs / 60000)} min`);
      await sleep(400);
      const lines = existsSync(statusPath) ? readFileSync(statusPath, 'utf8').split('\n').filter(Boolean) : [];
      for (; seen < lines.length; seen++) {
        let ev; try { ev = JSON.parse(lines[seen]); } catch { continue; }
        onEvent?.(ev);
        if (ev.type === 'done') result = { ok: true };
        if (ev.type === 'error') throw new Error(`browser render: ${ev.message}`);
      }
      if (proc.exitCode != null && !result) {
        await sleep(800);   // a last status line may still be on its way
        const rest = readFileSync(statusPath, 'utf8');
        if (!rest.includes('"done"')) throw new Error('the Chrome window closed before the render finished');
      }
    }
  } finally {
    for (const s of sinks) await s.close().catch(() => {});
    await status.close().catch(() => {});
    await srv.close().catch(() => {});
    try { proc.kill(); } catch {}
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
  return result;
}

/** Encode every scene to its own MP4, then join them (and any audio) with ffmpeg. */
export async function browserRenderProject({ videoDir, outFile, scale = 1, onEvent }) {
  const project = JSON.parse(readFileSync(path.join(videoDir, 'project.json'), 'utf8'));
  const fps = project.fps ?? 30;
  const scenes = (project.scenes ?? []).map(s => (typeof s === 'string' ? s : s.file));
  if (!scenes.length) throw new Error('project.json has no scenes');
  const partsDir = path.join(videoDir, '.render', 'parts');
  rmSync(partsDir, { recursive: true, force: true });
  mkdirSync(partsDir, { recursive: true });
  const parts = scenes.map((_, i) => path.join(partsDir, `${String(i + 1).padStart(2, '0')}.mp4`));

  await runJob(videoDir, async srv => {
    const sinks = await Promise.all(parts.map(p => srv.createSink(p)));
    return { sinks, job: { mode: 'encode', fps, scale, bitrate: scale > 1 ? 40e6 : 14e6, scenes: scenes.map((file, i) => ({ file, sink: sinks[i].id })) } };
  }, { onEvent });

  const env = childEnv();
  const list = path.join(partsDir, 'list.txt');
  writeFileSync(list, parts.map(p => `file '${p.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`).join('\n'));
  const joined = path.join(partsDir, 'joined.mp4');
  let r = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined], { env, timeoutMs: 10 * 60_000 });
  if (r.code !== 0) throw new Error(`ffmpeg concat failed: ${r.stderr.trim().slice(-300)}`);

  const audio = (project.audio ?? []).filter(a => a.file && existsSync(path.join(videoDir, a.file)));
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', joined];
  if (audio.length) {
    audio.forEach(a => args.push(...(a.from ? ['-ss', String(a.from)] : []), ...(a.duration ? ['-t', String(a.duration)] : []), '-i', path.join(videoDir, a.file)));
    const chains = audio.map((a, i) => `[${i + 1}:a]adelay=${Math.round((a.start ?? 0) * 1000)}:all=1,volume=${a.volume ?? 1}[a${i}]`);
    args.push('-filter_complex', `${chains.join(';')};${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0[aout]`,
      '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '320k', '-shortest');
  }
  args.push('-c:v', 'copy', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', outFile);
  r = await run('ffmpeg', args, { env, timeoutMs: 10 * 60_000 });
  if (r.code !== 0 || !existsSync(outFile)) throw new Error(`ffmpeg finish failed: ${r.stderr.trim().slice(-300)}`);
}

/** PNG stills of one scene page at the given times (seconds). */
export async function browserStills({ projectDir, scene, outDir, times, scale = 1 }) {
  mkdirSync(outDir, { recursive: true });
  const files = times.map(t => path.join(outDir, `${path.basename(scene, '.html')}-${String(t).replace('.', '_')}s.png`));
  await runJob(projectDir, async srv => {
    const sinks = await Promise.all(files.map(f => srv.createSink(f)));
    return { sinks, job: { mode: 'stills', scale, scene: scene.replaceAll('\\', '/'), stills: times.map((t, i) => ({ t, sink: sinks[i].id })) } };
  }, { timeoutMs: 5 * 60_000 });
  return files;
}
