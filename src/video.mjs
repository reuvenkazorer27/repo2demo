// Step 3: Claude builds the motlab scenes from a fixed brief + style files; the app renders and checks the result.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserRenderProject } from './browser-render.mjs';
import { claude } from './claude.mjs';
import { childEnv, findMotlab, motlabSkillDir, run } from './util.mjs';

const APP_ROOT = path.resolve(import.meta.dirname, '..');

export function prepareVideo({ runDir, repoDir, analysis, gh, facts, lang }) {
  const videoDir = path.join(runDir, 'video');
  for (const d of ['refs', 'assets', 'scenes', 'audio', 'out', 'style']) mkdirSync(path.join(videoDir, d), { recursive: true });
  for (const f of readdirSync(path.join(APP_ROOT, 'style'))) copyFileSync(path.join(APP_ROOT, 'style', f), path.join(videoDir, 'style', f));

  const refs = new Map();
  for (const s of analysis.video.scenes) {
    if (!s.image || refs.has(s.image)) continue;
    const src = path.join(repoDir, s.image);
    if (!existsSync(src)) { s.image = null; continue; }
    const name = `${String(refs.size + 1).padStart(2, '0')}-${path.basename(s.image)}`;
    copyFileSync(src, path.join(videoDir, 'refs', name));
    refs.set(s.image, `refs/${name}`);
  }

  const total = analysis.video.scenes.reduce((a, s) => a + s.seconds, 0);
  const ex = analysis.example;
  const exampleMd = ex ? [
    `- Demo window: a neutral ${ex.surface} window (see style/brand.md "Example demo"). Not the repo's own UI.`,
    `- Scenario caption: "${ex.scenario}"`,
    `- Input, typed in character by character:`, ...ex.input.map(l => `    \`${l}\``),
    `- Then these steps tick by, one at a time:`, ...ex.steps.map(l => `    - "${l}"`),
    `- Then the output appears line by line and holds:`, ...ex.output.map(l => `    \`${l}\``),
    `- Small label in the window's corner: "Illustrative example" (always visible in this scene).`,
  ].join('\n') : '';
  const scenesMd = analysis.video.scenes.map((s, i) => [
    `### Scene ${i + 1} · ${s.purpose} · ${s.seconds}s`,
    ...s.lines.map(l => `- "${l}"`),
    s.purpose === 'example' ? exampleMd : (s.image ? `- Image: \`${refs.get(s.image)}\` (real file from the repo, show it as it is)` : '- Image: none (type only)'),
  ].join('\n')).join('\n\n');

  const brief = `# Brief: ${analysis.video.title}

- What: a short, independent overview video of the GitHub repo ${gh.web}, for the person in the profile.
- Where it is seen: on a laptop screen, maybe shared with a colleague. Landscape 16:9, 1920x1080 pages, 30 fps.
- Length: about ${Math.round(total)} s, ${analysis.video.scenes.length} scenes. Silent (no music, no voice) for now.
- Language: ${lang === 'he' ? 'Hebrew (RTL: right-aligned, dir="rtl", numbers and names in <bdi>)' : 'English'}.
- Accent colour: ${analysis.video.accent}. Everything else comes from \`style/brand.md\`.
- Ends on: the verdict and the repo address, so the viewer knows whether to open it.
- This is not the repo owner's brand: end with the small line "Independent overview · not affiliated with ${gh.owner}".
- Use only the files in \`refs/\` as pictures. Do not invent, download or redraw any logo, screenshot or UI.
${facts ? `- Facts you may show: ${facts.stars ?? '?'} stars, license ${facts.license ?? 'unknown'}, last push ${facts.pushedAt?.slice(0, 10) ?? '?'}.` : ''}

## Scenes (exact text, word for word)

${scenesMd}
`;
  writeFileSync(path.join(videoDir, 'brief.md'), brief);
  return { videoDir, refs: [...refs.values()], total };
}

export async function buildVideo({ videoDir, model, windowMode = false }) {
  const skillDir = motlabSkillDir();
  // Where Chrome's DevTools are off by policy, `motlab stills` cannot run: give the agent our window-based stills.
  if (windowMode) {
    mkdirSync(path.join(videoDir, '.render'), { recursive: true });
    writeFileSync(path.join(videoDir, '.render', 'stills.mjs'), `import ${JSON.stringify(pathToFileURL(path.join(APP_ROOT, 'bin', 'stills.mjs')).href)};\n`);
  }
  const stillsCmd = windowMode ? 'node .render/stills.mjs <scene> stills/<n> <times…>' : 'motlab stills <scene> stills/<n> <times…>';
  const prompt = `Build a motlab video project in the current directory.

Read, in this order, and follow them:
1. ${path.join(skillDir, 'SKILL.md')} (the motlab skill: page contract, project layout, stills)
2. ${path.join(skillDir, 'references', 'craft.md')} (polish rules)
3. style/brand.md, style/pacing.md, style/captions.md (this series' look; they win over the skill's ad preset)
4. brief.md (the exact scenes and text)

Rules for this run (the user set them; they override the skill where they differ):
- The brief is final. Do not ask questions and do not wait for approval.
- Build every scene properly in scenes/ and list them in project.json ("fps": 30). 2D canvas is the default
  (copy ${path.join(skillDir, 'templates', 'template-2d.html')}); screenshots may float in a gentle 3D panel only if it stays calm and readable.
- Fonts: download Inter (and Heebo if the text is Hebrew) into assets/fonts with
  \`python "${path.join(skillDir, 'scripts', 'get_font.py')}"\` (run it with --help first). Never rely on system fonts.
- Check your work: \`${stillsCmd}\` for every scene (include moments inside transitions${windowMode ? '; on this PC `motlab stills` does not work, use exactly this command: it opens a small Chrome window for a few seconds' : ''}),
  then \`python "${path.join(skillDir, 'scripts', 'contact_sheet.py')}" <dir> stills/sheet-<n>.jpg\` and look at the sheet with Read.
  Fix overflow, clipped or overlapping text, low contrast, flashes and anything brand.md/pacing.md forbids. Do at least one fix round.
- Do NOT run motlab render, motlab video, motlab edit or motlab start: the app renders after you finish.
- Do not touch anything outside this directory. Do not edit refs/ or brief.md.
- When done, reply with 3-6 lines: the scenes you built and anything you could not check.`;

  const systemAppend = 'This is an automated, non-interactive run started by the user\'s own repo2demo app. The user explicitly says: do not look up or invoke any personal library or other skills; follow only the files named in the prompt.';
  return claude({
    prompt, cwd: videoDir, model, timeoutMin: 45, label: 'video',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    allow: ['Read', 'Write', 'Edit', 'Glob', 'Grep',
      'Bash(motlab stills:*)', 'Bash(motlab events:*)', 'Bash(motlab --version)', 'Bash(motlab --help)', 'Bash(node .render/stills.mjs:*)',
      'Bash(python:*)', 'Bash(python3:*)', 'Bash(ffprobe:*)', 'Bash(ls:*)', 'Bash(mkdir:*)', 'Bash(cp:*)'],
    addDirs: [skillDir], systemAppend,
  });
}

export function checkProject(videoDir) {
  const pj = path.join(videoDir, 'project.json');
  if (!existsSync(pj)) throw new Error('The video step finished without a project.json.');
  const p = JSON.parse(readFileSync(pj, 'utf8'));
  const scenes = (p.scenes ?? []).map(s => (typeof s === 'string' ? s : s.file));
  const missing = scenes.filter(s => !existsSync(path.join(videoDir, s)));
  if (!scenes.length || missing.length) throw new Error(`project.json is incomplete: ${missing.length ? 'missing ' + missing.join(', ') : 'no scenes'}`);
  return scenes.length;
}

export async function renderVideo({ videoDir, outFile, scale = 1, windowMode = false }) {
  if (windowMode) return browserRenderProject({ videoDir, outFile, scale, onEvent: e => { if (e.type === 'scene') console.log(`   scene ${e.i + 1}: ${e.frames} frames, ${e.hw ? 'hardware' : 'software'} H.264, ${(e.ms / 1000).toFixed(1)}s`); } });
  const r = await run(process.execPath, [findMotlab(), 'render', videoDir, outFile, '--scale', String(scale)], { env: childEnv(), timeoutMs: 30 * 60_000, quiet: false });
  if (r.code !== 0 || !existsSync(outFile)) throw new Error(`motlab render failed (exit ${r.code}). ${r.stderr.trim().slice(-500)}`);
}

/**
 * Cheap QA on the real MP4 (a good preview is not a good render): count sudden brightness jumps between frames
 * and tile one frame a second into a contact sheet. ([book video-motion p3] RULES 1, 5)
 */
export async function qaVideo({ mp4, sheet }) {
  const env = childEnv();
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', mp4], { env });
  const info = JSON.parse(probe.stdout || '{}');
  const stats = await run('ffmpeg', ['-hide_banner', '-i', mp4, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], { env, timeoutMs: 10 * 60_000 });
  const ys = [...(stats.stdout + stats.stderr).matchAll(/YAVG=([\d.]+)/g)].map(m => Number(m[1]));
  let jumps = 0, worst = 0;
  for (let i = 1; i < ys.length; i++) { const d = Math.abs(ys[i] - ys[i - 1]); worst = Math.max(worst, d); if (d > 20) jumps++; }
  await run('ffmpeg', ['-hide_banner', '-y', '-i', mp4, '-vf', 'fps=1,scale=480:-1,tile=6x6', '-frames:v', '1', sheet], { env });
  return { duration: Number(info.format?.duration ?? 0), width: info.streams?.[0]?.width, height: info.streams?.[0]?.height, frames: ys.length, brightnessJumps: jumps, worstJump: Math.round(worst) };
}
