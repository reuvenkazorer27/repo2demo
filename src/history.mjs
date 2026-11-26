// runs/index.json: one row per run, so the CLI can say "already checked" and the UI can list everything.
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const APP_ROOT = path.resolve(import.meta.dirname, '..');
/** Your profile (config/profile.local.md, git-ignored) or the shipped template. */
export const profilePath = () => {
  const local = path.join(APP_ROOT, 'config', 'profile.local.md');
  return existsSync(local) ? local : path.join(APP_ROOT, 'config', 'profile.example.md');
};
export const STEPS =['Clone', 'Analyse', 'Brief', 'Scenes', 'Render', 'Check', 'Report'];
export const RUNS = path.join(APP_ROOT, 'runs');
const INDEX = path.join(RUNS, 'index.json');

export function readIndex() {
  if (!existsSync(INDEX)) return rebuildIndex();
  try { return JSON.parse(readFileSync(INDEX, 'utf8')); } catch { return rebuildIndex(); }
}

function writeIndex(rows) {
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const tmp = INDEX + '.tmp';
  writeFileSync(tmp, JSON.stringify(rows, null, 2));
  renameSync(tmp, INDEX);
  return rows;
}

/** Row from a run folder's analysis.json (also used to rebuild the index from folders made before it existed). */
export function rowFromRun(dir) {
  const id = path.basename(dir);
  const file = path.join(dir, 'analysis.json');
  if (!existsSync(file)) return null;
  let j; try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  const a = j.analysis ?? {};
  const m = String(j.repo ?? '').match(/github\.com\/([^/]+)\/([^/]+)/);
  return {
    id,
    owner: m?.[1] ?? id.split('__')[0], repo: m?.[2] ?? id.split('__')[1]?.replace(/-\d{12}$/, ''),
    url: j.repo, verdict: a.verdict ?? null, fitScore: a.fitScore ?? null, oneLiner: a.oneLiner ?? '',
    status: j.status ?? (existsSync(path.join(dir, 'report.md')) ? 'ok' : 'partial'),
    createdAt: j.createdAt ?? statSync(file).mtime.toISOString(),
    durationSec: j.durationSec ?? null, steps: j.steps ?? null, lang: j.lang ?? 'en',
    stars: j.facts?.stars ?? null, license: j.facts?.license ?? null,
    hasVideo: existsSync(path.join(dir, 'demo.mp4')), hasReport: existsSync(path.join(dir, 'report.md')),
  };
}

export function rebuildIndex() {
  if (!existsSync(RUNS)) return [];
  const rows = readdirSync(RUNS, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => rowFromRun(path.join(RUNS, d.name))).filter(Boolean);
  return writeIndex(rows);
}

export function upsertRun(dir) {
  const row = rowFromRun(dir);
  if (!row) return readIndex();
  const rows = readIndex().filter(r => r.id !== row.id);
  rows.push(row);
  return writeIndex(rows);
}

/** Remove a run folder (report, video, clone) and its index row. Returns the remaining rows. */
export function deleteRun(id) {
  const dir = path.join(RUNS, id);
  if (path.dirname(dir) !== RUNS) throw new Error('bad run id');
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  if (existsSync(dir)) throw new Error('Some files are still in use. Close the video and try again.');
  return writeIndex(readIndex().filter(r => r.id !== id));
}

/** Latest successful run of this repo, if any (case-insensitive owner/repo). */
export function findExisting(owner, repo) {
  const k = `${owner}/${repo}`.toLowerCase();
  return readIndex().find(r => `${r.owner}/${r.repo}`.toLowerCase() === k && r.status === 'ok') ?? null;
}
