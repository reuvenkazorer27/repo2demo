// Small helpers: run a process without a shell, find the tools we need.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const isWin = process.platform === 'win32';

/** Run a command (no shell, args as an array). Resolves {code, stdout, stderr}. */
export function run(cmd, args, opts = {}) {
  const { cwd, env, timeoutMs = 0, onStdoutLine, input, quiet = true } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ?? process.env, windowsHide: true });
    let stdout = '', stderr = '', buf = '';
    let timer = null;
    if (timeoutMs) timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(cmd)} timed out after ${Math.round(timeoutMs / 60000)} min`)); }, timeoutMs);
    child.stdout.on('data', d => {
      const s = d.toString();
      stdout += s;
      if (!quiet) process.stdout.write(s);
      if (onStdoutLine) {
        buf += s;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { onStdoutLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
      }
    });
    child.stderr.on('data', d => { stderr += d.toString(); if (!quiet) process.stderr.write(d); });
    child.on('error', e => { if (timer) clearTimeout(timer); reject(e); });
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      if (onStdoutLine && buf.trim()) onStdoutLine(buf);
      resolve({ code, stdout, stderr });
    });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

function onPath(name) {
  const r = spawnSync(isWin ? 'where' : 'which', [name], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] ?? null;
}

/** Make sure winget's ffmpeg links are visible to child processes, even in a shell opened before the install. */
export function childEnv() {
  const env = { ...process.env };
  const extra = [];
  if (isWin && process.env.LOCALAPPDATA) extra.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
  extra.push(path.join(homedir(), '.local', 'bin'));
  const key = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH';
  const parts = (env[key] ?? '').split(path.delimiter);
  if (isWin) {   // the user PATH as saved now (winget adds ffmpeg there; shells opened earlier don't have it yet)
    const r = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8', windowsHide: true });
    const m = r.stdout?.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
    if (m) for (const p of m[1].trim().split(';')) extra.push(p.replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? ''));
  }
  for (const e of extra) if (existsSync(e) && !parts.includes(e)) parts.push(e);
  env[key] = parts.join(path.delimiter);
  return env;
}

/** The Claude Code CLI (uses whatever account is signed in on this machine). */
export function findClaude() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const local = path.join(homedir(), '.local', 'bin', isWin ? 'claude.exe' : 'claude');
  if (existsSync(local)) return local;
  const p = onPath('claude');
  if (p && (!isWin || p.toLowerCase().endsWith('.exe'))) return p;
  throw new Error('Claude Code CLI not found. Install Claude Code or set CLAUDE_BIN to claude(.exe).');
}

/** motlab's JS entry, so we can run it with node (Windows .cmd shims need a shell; we avoid one). */
export function findMotlab() {
  if (process.env.MOTLAB_JS && existsSync(process.env.MOTLAB_JS)) return process.env.MOTLAB_JS;
  const appdata = process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', '@motlab', 'cli', 'bin', 'motlab.js');
  if (appdata && existsSync(appdata)) return appdata;
  const r = spawnSync(isWin ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: isWin, windowsHide: true });
  const root = r.stdout?.trim();
  const js = root && path.join(root, '@motlab', 'cli', 'bin', 'motlab.js');
  if (js && existsSync(js)) return js;
  throw new Error('motlab not found. Run: npm install -g @motlab/cli && npx @motlab/cli setup');
}

export function motlabSkillDir() {
  const d = path.join(homedir(), '.claude', 'skills', 'motlab');
  if (!existsSync(path.join(d, 'SKILL.md'))) throw new Error(`motlab skill not found at ${d}. Run: npx @motlab/cli setup`);
  return d;
}

/**
 * motlab renders through headless Chrome's DevTools port. An organisation can switch that off with the
 * RemoteDebuggingAllowed policy; that is the admin's security control, so we do not work around it: we skip the video
 * and say why. Returns a reason string, or null when video should work.
 */
export function videoBlockedReason() {
  if (!isWin) return null;
  for (const hive of ['HKLM', 'HKCU']) {
    const r = spawnSync('reg', ['query', `${hive}\\SOFTWARE\\Policies\\Google\\Chrome`, '/v', 'RemoteDebuggingAllowed'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && /RemoteDebuggingAllowed\s+REG_DWORD\s+0x0\b/i.test(r.stdout)) {
      return 'Chrome remote debugging is off on this PC (organisation policy RemoteDebuggingAllowed = 0), so videos render in an ordinary Chrome window instead of motlab\'s headless renderer.';
    }
  }
  return null;
}

/** Machine-readable progress for the UI server: one "@@EV {json}" line per event when REPO2DEMO_EVENTS=1. */
export function emit(type, data = {}) {
  if (process.env.REPO2DEMO_EVENTS === '1') process.stdout.write(`@@EV ${JSON.stringify({ type, ...data, t: Date.now() })}\n`);
}

export const log = (...a) => console.log(...a);
export const step = (n, total, msg) => console.log(`\n[${n}/${total}] ${msg}`);
