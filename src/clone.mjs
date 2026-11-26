// Clone a GitHub repo shallowly and neutralise anything an agent would auto-load from it.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { run } from './util.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.next', 'target', '__pycache__', '.venv', 'venv']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);

export function parseGithubUrl(input) {
  const s = input.trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/)
    ?? s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!m) throw new Error(`Not a GitHub repo URL: ${input}`);
  return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}.git`, web: `https://github.com/${m[1]}/${m[2]}` };
}

export async function cloneRepo(gh, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' };
  const r = await run('git', ['-c', 'core.symlinks=false', 'clone',
    '--depth', '1', '--single-branch', '--no-tags', '--recurse-submodules=no', gh.url, dest], { env, timeoutMs: 5 * 60_000 });
  if (r.code !== 0) throw new Error(`git clone failed: ${r.stderr.trim().split('\n').pop()}`);
}

/**
 * Agent config inside a foreign repo is loaded without a trust prompt in headless runs, so remove or rename it
 * before any Claude run touches the folder. ([book claude-code p7] RULE 2)
 */
export function sanitize(root) {
  const actions = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (name === '.git') continue;
      const p = path.join(dir, name);
      let st; try { st = statSync(p); } catch { continue; }
      const rel = path.relative(root, p).replaceAll('\\', '/');
      if (st.isDirectory()) {
        if (name === '.claude' || name === '.cursor' || name === '.codex' || name === '.gemini') { rmSync(p, { recursive: true, force: true }); actions.push(`removed ${rel}/`); continue; }
        if (!SKIP_DIRS.has(name)) walk(p);
      } else if (name === '.mcp.json' || name === '.cursorrules') {
        rmSync(p, { force: true }); actions.push(`removed ${rel}`);
      } else if (/^(CLAUDE|AGENTS|GEMINI)(\.local)?\.md$/i.test(name)) {
        renameSync(p, p + '.repo.txt'); actions.push(`renamed ${rel} -> ${rel}.repo.txt (kept as data)`);
      }
    }
  };
  walk(root);
  return actions;
}

/** A compact map of the repo for the prompt: tree (capped), extension counts, image candidates. */
export function mapRepo(root, maxEntries = 350) {
  const tree = [], ext = {}, images = [];
  let files = 0, bytes = 0, truncated = false;
  const walk = (dir, depth) => {
    let names; try { names = readdirSync(dir).sort(); } catch { return; }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      const p = path.join(dir, name);
      let st; try { st = statSync(p); } catch { continue; }
      const rel = path.relative(root, p).replaceAll('\\', '/');
      if (st.isDirectory()) {
        if (tree.length < maxEntries) tree.push(`${'  '.repeat(depth)}${name}/`); else truncated = true;
        walk(p, depth + 1);
      } else {
        files++; bytes += st.size;
        const e = path.extname(name).toLowerCase() || '(none)';
        ext[e] = (ext[e] ?? 0) + 1;
        if (tree.length < maxEntries) tree.push(`${'  '.repeat(depth)}${name}  (${fmtSize(st.size)})`); else truncated = true;
        if (IMAGE_EXT.has(e) && st.size >= 3_000 && st.size <= 15_000_000) images.push({ path: rel, size: st.size });
      }
    }
  };
  walk(root, 0);
  const topExt = Object.entries(ext).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([e, n]) => `${e}:${n}`).join(' ');
  images.sort((a, b) => scoreImage(b.path) - scoreImage(a.path) || b.size - a.size);
  return { tree: tree.join('\n') + (truncated ? '\n… (tree truncated)' : ''), files, bytes, topExt, images: images.slice(0, 40) };
}

function scoreImage(p) {
  const s = p.toLowerCase();
  let n = 0;
  if (/screenshot|demo|preview|hero|banner|logo|social|readme|example/.test(s)) n += 2;
  if (/^(assets|docs|images|img|media|\.github)\//.test(s)) n += 1;
  if (/test|fixture|node_modules|icon-\d+/.test(s)) n -= 2;
  return n;
}

/**
 * Claude's Read can't open AVIF/SVG, and an animated image is a moving target in a scene. Convert those candidates to a
 * still PNG (first frame) inside the repo folder and use the PNG instead.
 */
export async function makePreviews(root, map, env) {
  const outDir = path.join(root, '.repo2demo-previews');
  for (const img of map.images) {
    const e = path.extname(img.path).toLowerCase();
    if (e !== '.avif' && e !== '.svg') continue;
    mkdirSync(outDir, { recursive: true });
    const name = img.path.replace(/[\\/]/g, '__').replace(/\.[^.]+$/, '.png');
    const out = path.join(outDir, name);
    // Animated images often open on a blank/dark frame: try a frame ~3 s in, then fall back to the first frame.
    const grab = seek => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...(seek ? ['-ss', seek] : []), '-i', path.join(root, img.path), '-frames:v', '1', '-vf', "scale='min(1920,iw)':-2", out], { env, timeoutMs: 60_000 }).catch(() => ({ code: 1 }));
    let r = e === '.avif' ? await grab('3') : { code: 1 };
    if (r.code !== 0 || !existsSync(out) || statSync(out).size < 2000) r = await grab(null);
    if (r.code === 0 && existsSync(out)) { img.originalPath = img.path; img.path = `.repo2demo-previews/${name}`; img.size = statSync(out).size; }
  }
}

export function fmtSize(b) {
  return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

/** Public repo facts from GitHub's API (no auth, nothing personal sent). Optional: returns null on failure. */
export async function repoFacts(gh) {
  try {
    const r = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}`, { headers: { 'User-Agent': 'repo2demo', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const j = await r.json();
    return { description: j.description, stars: j.stargazers_count, forks: j.forks_count, license: j.license?.spdx_id ?? null,
      language: j.language, pushedAt: j.pushed_at, createdAt: j.created_at, topics: j.topics ?? [], archived: j.archived, homepage: j.homepage || null };
  } catch { return null; }
}

export function uniqueDir(base) {
  if (!existsSync(base)) return base;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `${base}-${stamp}`;
}
