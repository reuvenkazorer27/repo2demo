#!/usr/bin/env node
// repo2demo <github-url> [--lang en|he] [--no-video] [--4k] [--model <alias>] [--force]
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyze } from '../src/analyze.mjs';
import { cloneRepo, makePreviews, mapRepo, parseGithubUrl, repoFacts, sanitize, uniqueDir } from '../src/clone.mjs';
import { findExisting, profilePath, RUNS, STEPS, upsertRun } from '../src/history.mjs';
import { reportMd } from '../src/report.mjs';
import { childEnv, emit, findClaude, findMotlab, videoBlockedReason } from '../src/util.mjs';
import { buildVideo, checkProject, prepareVideo, qaVideo, renderVideo } from '../src/video.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    lang: { type: 'string', default: 'en' },
    'no-video': { type: 'boolean', default: false },
    '4k': { type: 'boolean', default: false },
    model: { type: 'string' },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || !positionals[0]) {
  console.log(`repo2demo <github-url> [options]

  Clones the repo (shallow, agent configs stripped), has Claude judge how it fits config/profile.md,
  and renders a short clean demo video with motlab. Output: runs/<owner>__<repo>/ (listed in runs/index.json)

  --lang en|he     language of the report and the video text (default en)
  --no-video       report only
  --4k             render at 3840x2160 instead of 1080p
  --model <alias>  Claude model for both steps (default: your Claude Code default)
  --force          run again even if this repo was already checked

  UI: node server.mjs  → http://127.0.0.1:4180`);
  process.exit(values.help ? 0 : 1);
}

const t0 = Date.now();
const steps = Object.fromEntries(STEPS.map(s => [s, { status: 'pending', secs: null }]));
let current = null, stepStart = 0;
function begin(name, msg) {
  current = name; stepStart = Date.now();
  steps[name].status = 'live';
  console.log(`\n[${STEPS.indexOf(name) + 1}/${STEPS.length}] ${msg}`);
  emit('step', { step: name, status: 'live', msg });
}
function end(name = current, status = 'done', note) {
  const secs = Math.round((Date.now() - stepStart) / 1000);
  steps[name] = { status, secs, ...(note ? { note } : {}) };
  emit('step', { step: name, status, secs, note });
}
function skip(name, note) { steps[name] = { status: 'skipped', secs: null, note }; emit('step', { step: name, status: 'skipped', note }); }

let runDir = null, gh = null, facts = null, a = null;
function saveAnalysis(status) {
  if (!runDir || !existsSync(runDir)) return;
  writeFileSync(path.join(runDir, 'analysis.json'), JSON.stringify({
    repo: gh.web, status, createdAt: new Date(t0).toISOString(), durationSec: Math.round((Date.now() - t0) / 1000),
    lang: values.lang, steps, facts, analysis: a,
  }, null, 2));
}

try {
  gh = parseGithubUrl(positionals[0]);
  const existing = findExisting(gh.owner, gh.repo);
  if (existing && !values.force) {
    console.log(`Already checked on ${existing.createdAt.slice(0, 10)}: ${String(existing.verdict).toUpperCase()} · fit ${existing.fitScore}/10`);
    console.log(`   ${path.join(RUNS, existing.id)}\n   Run again with --force.`);
    emit('existing', { id: existing.id });
    process.exit(0);
  }
  findClaude();
  let wantVideo = !values['no-video'];
  const blocked = wantVideo ? videoBlockedReason() : null;
  if (wantVideo) findMotlab();

  runDir = uniqueDir(path.join(RUNS, `${gh.owner}__${gh.repo}`));
  const repoDir = path.join(runDir, 'repo');
  emit('run', { id: path.basename(runDir), repo: gh.web });

  begin('Clone', `Cloning ${gh.web}`);
  [, facts] = await Promise.all([cloneRepo(gh, repoDir), repoFacts(gh)]);
  const sanitized = sanitize(repoDir);
  const map = mapRepo(repoDir);
  await makePreviews(repoDir, map, childEnv());
  console.log(`   ${map.files} files · ${map.images.length} image candidates · ${sanitized.length ? sanitized.join('; ') : 'no agent config found'}`);
  end();

  begin('Analyse', 'Claude is reading the repo and judging the fit');
  const profile = readFileSync(profilePath(), 'utf8');
  a = await analyze({ repoDir, gh, facts, map, profile, lang: values.lang, model: values.model });
  console.log(`   ${a.verdict.toUpperCase()} · fit ${a.fitScore}/10 · ${a.oneLiner}`);
  end();
  saveAnalysis('partial');
  emit('analysis', { verdict: a.verdict, fitScore: a.fitScore, oneLiner: a.oneLiner });

  if (wantVideo && a.status !== 'ok') { wantVideo = false; console.log('   Not enough in the repo to make a video; report only.'); }
  // Not worth trying → no video (saves ~10 minutes); the report explains why.
  const notWorth = a.verdict === 'skip';
  if (wantVideo && notWorth) { wantVideo = false; console.log(`   Verdict is SKIP, so no video. Why: ${a.fitReason}`); }
  const windowMode = !!blocked;
  if (wantVideo && windowMode) console.log(`\n   ${blocked}`);
  const skipNote = values['no-video'] ? 'report only' : a.status !== 'ok' ? 'not enough in the repo' : notWorth ? 'not worth trying, so no video was made' : null;

  let videoDir = null, qa = null;
  if (wantVideo) {
    begin('Brief', 'Preparing the brief and references');
    const prep = prepareVideo({ runDir, repoDir, analysis: a, gh, facts, lang: values.lang });
    videoDir = prep.videoDir;
    console.log(`   ${a.video.scenes.length} scenes, ~${Math.round(prep.total)} s, ${prep.refs.length} images from the repo`);
    end();

    begin('Scenes', 'Claude is building the scenes with motlab (this takes a while)');
    const built = await buildVideo({ videoDir, model: values.model, windowMode });
    console.log(`   ${checkProject(videoDir)} scenes in project.json`);
    if (built.text) console.log(built.text.split('\n').map(l => '   > ' + l).join('\n'));
    end();

    begin('Render', `Rendering MP4 (${values['4k'] ? '4K' : '1080p'}${windowMode ? ', in a Chrome window' : ''})`);
    const out = path.join(videoDir, 'out', `demo-${values['4k'] ? '2160p' : '1080p'}.mp4`);
    await renderVideo({ videoDir, outFile: out, scale: values['4k'] ? 2 : 1, windowMode });
    copyFileSync(out, path.join(runDir, 'demo.mp4'));
    end();

    begin('Check', 'Checking the rendered video');
    qa = await qaVideo({ mp4: path.join(runDir, 'demo.mp4'), sheet: path.join(runDir, 'demo-sheet.jpg') });
    console.log(`   ${qa.duration.toFixed(1)} s · ${qa.width}x${qa.height} · brightness jumps: ${qa.brightnessJumps} (worst ${qa.worstJump}/255)`);
    end('Check', 'done', `${qa.brightnessJumps} brightness jumps`);
  } else {
    for (const s of ['Brief', 'Scenes', 'Render', 'Check']) skip(s, skipNote);
  }

  begin('Report', 'Writing the report');
  writeFileSync(path.join(runDir, 'report.md'), reportMd({ a, gh, facts, sanitized, video: videoDir, qa, videoNote: skipNote }));
  if (qa) writeFileSync(path.join(runDir, 'qa.json'), JSON.stringify(qa, null, 2));
  end();
  saveAnalysis('ok');
  upsertRun(runDir);
  emit('done', { id: path.basename(runDir) });

  console.log(`\nDone in ${Math.round((Date.now() - t0) / 60000)} min → ${runDir}`);
  console.log(`   report.md${videoDir ? ' · demo.mp4 · demo-sheet.jpg' : ''}`);
  if (videoDir) console.log(`   Review or tweak: motlab edit "${videoDir}"`);
} catch (e) {
  if (current && steps[current]?.status === 'live') end(current, 'failed', e.message);
  if (a) { saveAnalysis('failed'); upsertRun(runDir); }
  emit('error', { message: e.message, id: runDir ? path.basename(runDir) : null });
  console.error(`\nFailed: ${e.message}`);
  process.exit(1);
}
