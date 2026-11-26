// repo2demo UI. All text from runs goes through textContent / esc(): repo content is untrusted.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VERDICT = { use: 'Use', try: 'Try', watch: 'Watch', skip: 'Skip' };
const state = { status: null, runs: [], selected: null, steps: ['Clone', 'Analyse', 'Brief', 'Scenes', 'Render', 'Check', 'Report'], live: null, filter: '', verdict: '' };

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Repo2demo': '1', ...(opts.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: j };
}
const fmtSecs = s => (s == null ? '–' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`);
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replaceAll('/', '.'); };
const vClass = v => (VERDICT[v] ? `v-${v}` : '');

// ---------------------------------------------------------------- status
async function loadStatus() {
  const { data } = await api('/api/status');
  state.status = data;
  if (data.steps) state.steps = data.steps;
  $('#hello').textContent = data.claude?.loggedIn ? `Signed in with your Claude ${data.claude.method === 'claude.ai' ? 'subscription' : 'account'}` : 'Claude Code is not signed in';
  const m = $('#chip-motlab');
  if (data.motlab) { m.textContent = `motlab ${data.motlab}`; m.hidden = false; }
  const v = $('#chip-video');
  if (data.videoBlocked) { v.textContent = 'Video renders in a Chrome window'; v.title = data.videoBlocked; v.hidden = false; }
  if (data.job?.status === 'running') follow();
}

// ---------------------------------------------------------------- runs
async function loadRuns(selectId) {
  const { data } = await api('/api/runs');
  state.runs = Array.isArray(data) ? data : [];
  const pick = state.runs.find(r => r.id === selectId) ?? state.runs.find(r => r.id === state.selected?.id) ?? state.runs[0];
  renderRecent();
  renderLibrary();
  if (pick) await select(pick.id, false); else renderWave(null);
}

async function select(id, scroll = true) {
  const { ok, data } = await api(`/api/runs/${encodeURIComponent(id)}`);
  if (!ok) return;
  state.selected = data;
  renderBig();
  if (!state.live) renderWave(data.steps);
  for (const b of document.querySelectorAll('.row')) b.setAttribute('aria-pressed', String(b.dataset.id === id));
  if (scroll && matchMedia('(max-width:860px)').matches) $('#big').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderBig() {
  const d = state.selected, a = d?.analysis ?? {};
  const owner = d?.repo?.match(/github\.com\/([^/]+)\/([^/]+)/);
  $('#big-name').textContent = owner ? `${owner[1]}/${owner[2]}` : d?.id ?? 'No repo yet';
  $('#big-score').textContent = a.fitScore ?? '–';
  const v = $('#big-verdict');
  v.className = `verdict ${vClass(a.verdict)}`;
  v.innerHTML = a.verdict ? `<span class="vdot"></span>${esc(VERDICT[a.verdict])}` : esc(d ? 'No verdict (run did not finish)' : 'Paste a link to start');
  $('#big-line').textContent = a.oneLiner ?? '';
  const f = d?.facts ?? {};
  const mins = d?.durationSec != null ? fmtSecs(d.durationSec) : null;
  $('#big-metrics').innerHTML = [
    f.stars != null ? `<li title="GitHub stars"><svg aria-hidden="true"><use href="#i-star"/></svg><span class="num">${esc(f.stars.toLocaleString('en'))}</span></li>` : '',
    f.license ? `<li title="License"><svg aria-hidden="true"><use href="#i-scale"/></svg>${esc(f.license)}</li>` : '',
    mins ? `<li title="Run time"><svg aria-hidden="true"><use href="#i-clock"/></svg><span class="num">${esc(mins)}</span></li>` : '',
  ].join('');
  $('#big-open').hidden = !d;
}

function rowHtml(r) {
  return `<button class="row card glass-card" data-id="${esc(r.id)}" aria-pressed="false">
    <span class="meta"><span class="o">${esc(r.owner)}</span><span class="n" style="display:block">${esc(r.repo)}</span>
    <span class="v ${vClass(r.verdict)}"><span class="vdot"></span>${esc(VERDICT[r.verdict] ?? (r.status === 'failed' ? 'Failed' : 'Unfinished'))}</span></span>
    <span class="s">${esc(r.fitScore ?? '–')}</span></button>`;
}
function renderRecent() {
  const el = $('#recent');
  const rows = state.runs.slice(0, 3);
  el.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<div class="card glass-card empty">Repos you check show up here, newest first. Everything stays in <b>runs/</b> on this PC.</div>';
  for (const b of el.querySelectorAll('.row')) b.addEventListener('click', () => select(b.dataset.id));
}

// ---------------------------------------------------------------- pipeline wave (signature)
// Height = how long each step took (log scale), so the peaks show where the time went. The pen draws only as far as
// the run has really got.
function renderWave(steps, liveStep) {
  const names = state.steps;
  const W = 835, H = 200, n = names.length;
  const info = names.map(s => steps?.[s] ?? { status: 'pending', secs: null });
  const maxLog = Math.max(1, ...info.map(i => Math.log1p(i.secs ?? 0)));
  const pts = info.map((i, k) => [k * (W / (n - 1)), i.secs != null ? 168 - 128 * (Math.log1p(i.secs) / maxLog) : 150]);
  const d = smooth(pts);
  for (const id of ['wl1', 'wl2', 'wl3']) $(`#${id}`).setAttribute('d', d);
  $('#wfill').setAttribute('d', `${d} L${W},${H} L0,${H} Z`);
  $('#wbase').setAttribute('d', d);

  let upto = -1;
  info.forEach((i, k) => { if (i.status === 'done' || i.status === 'skipped' || i.status === 'failed') upto = k; });
  const liveIdx = liveStep ? names.indexOf(liveStep) : -1;
  const reach = liveIdx >= 0 ? (liveIdx - 0.5) / (n - 1) : upto / (n - 1);
  const p = Math.max(0, Math.min(1, reach + (liveIdx >= 0 ? 0.04 : 0)));
  $('#wave').style.setProperty('--p', String(p));
  const pen = $('#pen');
  if (liveIdx >= 0) {
    const x = p * W, y = yAt(pts, x);
    pen.setAttribute('cx', x); pen.setAttribute('cy', y); pen.hidden = false;
  } else pen.hidden = true;

  $('#times').innerHTML = info.map((i, k) => `<span class="${i.secs == null ? 'muted' : ''}" style="animation-delay:${1.26 + k * 0.07}s">${esc(i.status === 'skipped' ? '—' : fmtSecs(i.secs))}</span>`).join('');
  $('#days').innerHTML = info.map((i, k) => {
    const cls = names[k] === liveStep ? 'on' : i.status === 'skipped' ? 'skipped' : i.status === 'failed' ? 'failed' : '';
    const tip = i.note ? ` title="${esc(i.note)}"` : '';
    return `<li class="${cls}"${tip} style="animation-delay:${2.1 + k * 0.055}s">${names[k] === liveStep ? '<span class="live" aria-hidden="true"></span>' : ''}${esc(names[k])}</li>`;
  }).join('');
}
function smooth(p) {
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
function yAt(pts, x) {
  const path = $('#wl3');
  try {
    const L = path.getTotalLength(); let lo = 0, hi = L;
    for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (path.getPointAtLength(mid).x < x) lo = mid; else hi = mid; }
    return path.getPointAtLength(lo).y;
  } catch { return pts[0][1]; }
}

// ---------------------------------------------------------------- run a repo
const note = html => { $('#note').innerHTML = html; };
$('#ask').addEventListener('submit', async e => {
  e.preventDefault();
  await analyze(false);
});
async function analyze(force) {
  const url = $('#url').value.trim();
  if (!url) { note('<span class="err">Paste a GitHub link first, like github.com/owner/repo.</span>'); $('#url').focus(); return; }
  $('#go').disabled = true;
  const { ok, status, data } = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ url, video: $('#opt-video').checked, lang: $('#opt-he').checked ? 'he' : 'en', force }) });
  if (!ok) {
    $('#go').disabled = false;
    if (status === 409 && data.existing) {
      const r = data.existing;
      note(`Already checked on ${esc(fmtDate(r.createdAt))}: <b>${esc(VERDICT[r.verdict] ?? '')} · fit ${esc(r.fitScore)}/10</b><span class="acts"><button class="link" id="n-open">Open it</button><button class="link" id="n-again">Run again</button></span>`);
      $('#n-open').onclick = () => openDetail(r.id);
      $('#n-again').onclick = () => analyze(true);
    } else note(`<span class="err">${esc(data.error ?? 'Something went wrong.')}</span>`);
    return;
  }
  note('<span class="now"><span class="live" aria-hidden="true"></span>Starting…</span>');
  follow();
}

let es = null;
function follow() {
  if (es) es.close();
  $('#go').disabled = true;
  const steps = {};
  state.live = { steps };
  let current = null, runId = null;
  es = new EventSource('/api/job/stream');
  es.onmessage = m => {
    const ev = JSON.parse(m.data);
    if (ev.type === 'run') runId = ev.id;
    if (ev.type === 'step') {
      steps[ev.step] = { status: ev.status, secs: ev.secs ?? null, note: ev.note };
      if (ev.status === 'live') { current = ev.step; note(`<span class="now"><span class="live" aria-hidden="true"></span><b>${esc(ev.step)}</b> · ${esc(ev.msg ?? '')}</span>`); }
      renderWave(steps, ev.status === 'live' ? ev.step : null);
    }
    if (ev.type === 'tool' && current) note(`<span class="now"><span class="live" aria-hidden="true"></span><b>${esc(current)}</b> · ${esc(ev.tool)} ${esc(ev.detail)}</span>`);
    if (ev.type === 'analysis') {
      $('#big-score').textContent = ev.fitScore;
      const v = $('#big-verdict'); v.className = `verdict ${vClass(ev.verdict)}`; v.innerHTML = `<span class="vdot"></span>${esc(VERDICT[ev.verdict])}`;
      $('#big-line').textContent = ev.oneLiner;
    }
    if (ev.type === 'existing') { note('This repo was already checked.'); }
    if (ev.type === 'error') note(`<span class="err">Failed at ${esc(current ?? 'start')}: ${esc(ev.message)}</span>`);
    if (ev.type === 'exit') {
      es.close(); es = null; state.live = null; $('#go').disabled = false;
      if (ev.status === 'done') {
        note(runId ? `Done. <button class="link" id="n-open">Open the report</button>` : 'Done.');
        if (runId) $('#n-open').onclick = () => openDetail(runId);
        $('#url').value = '';
      }
      loadRuns(runId);
    }
  };
  es.onerror = () => { /* the browser reconnects by itself; the server replays the events */ };
}

// ---------------------------------------------------------------- library
function renderLibrary() {
  const q = state.filter.toLowerCase();
  const rows = state.runs.filter(r => (!state.verdict || r.verdict === state.verdict) && (!q || `${r.owner}/${r.repo} ${r.oneLiner}`.toLowerCase().includes(q)));
  $('#lib-rows').innerHTML = rows.length ? rows.map(r => `<tr class="r-click" tabindex="0" data-id="${esc(r.id)}">
      <td class="repo"><b>${esc(r.repo)}</b><span>${esc(r.owner)}</span></td>
      <td class="what">${esc(r.oneLiner)}</td>
      <td><span class="vcell ${vClass(r.verdict)}"><span class="vdot"></span>${esc(VERDICT[r.verdict] ?? (r.status === 'failed' ? 'Failed' : 'Unfinished'))}</span></td>
      <td class="r">${esc(r.fitScore ?? '–')}</td>
      <td class="r">${esc(fmtDate(r.createdAt))}</td>
      <td class="vid">${r.hasVideo ? '<svg role="img" aria-label="Has video"><use href="#i-play"/></svg>' : ''}</td>
      <td class="del"><button class="rowdel" data-del="${esc(r.id)}" data-name="${esc(`${r.owner}/${r.repo}`)}" aria-label="Delete ${esc(r.repo)}"><svg aria-hidden="true"><use href="#i-trash"/></svg></button></td></tr>`).join('')
    : `<tr><td colspan="7" class="lib-empty">${state.runs.length ? 'Nothing matches that filter.' : 'No repos checked yet.'}</td></tr>`;
  for (const b of document.querySelectorAll('#lib-rows [data-del]')) b.addEventListener('click', e => { e.stopPropagation(); deleteRun(b.dataset.del, b.dataset.name); });
  for (const tr of document.querySelectorAll('#lib-rows tr[data-id]')) {
    tr.addEventListener('click', () => openDetail(tr.dataset.id));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') openDetail(tr.dataset.id); });
  }
}
$('#filter').addEventListener('input', e => { state.filter = e.target.value; renderLibrary(); });
for (const b of document.querySelectorAll('.seg button')) b.addEventListener('click', () => {
  state.verdict = b.dataset.v;
  for (const o of document.querySelectorAll('.seg button')) o.setAttribute('aria-pressed', String(o === b));
  renderLibrary();
});

// ---------------------------------------------------------------- detail sheet
async function openDetail(id) {
  await select(id, false);
  const d = state.selected, a = d.analysis ?? {};
  const repo = d.repo?.replace(/^https:\/\//, '') ?? id;
  $('#d-title').textContent = a.repoName ?? repo;
  $('#d-sub').innerHTML = `<span class="vcell ${vClass(a.verdict)}" style="display:inline-flex;align-items:center;gap:6px"><span class="vdot"></span>${esc(VERDICT[a.verdict] ?? 'No verdict')}</span><span>Fit ${esc(a.fitScore ?? '–')}/10</span><span>Checked ${esc(fmtDate(d.createdAt))}</span>`;
  const acts = [`<a class="btn" href="${esc(d.repo)}" target="_blank" rel="noopener noreferrer"><svg aria-hidden="true"><use href="#i-gh"/></svg>GitHub</a>`,
    `<button class="btn" id="d-folder"><svg aria-hidden="true"><use href="#i-folder"/></svg>Folder</button>`,
    `<a class="btn" href="/files/${encodeURIComponent(id)}/report.md" target="_blank">report.md</a>`];
  if (d.hasProject) acts.push(`<button class="btn" id="d-viewer"><svg aria-hidden="true"><use href="#i-play"/></svg>motlab viewer</button>`);
  acts.push(`<button class="btn" id="d-again">Run again</button>`);
  acts.push(`<button class="btn danger" id="d-delete"><svg aria-hidden="true"><use href="#i-trash"/></svg>Delete</button>`);
  $('#d-actions').innerHTML = acts.join('');

  const videoNote = d.steps?.Render?.note ?? d.steps?.Scenes?.note ?? (d.steps?.Render ? null : 'this run was made before video rendering worked on this PC; press Run again');
  const video = d.hasVideo
    ? `<div class="d-video"><video controls preload="metadata" src="/files/${encodeURIComponent(id)}/demo.mp4"></video></div>`
    : a.verdict === 'skip'
    ? `<div class="d-novideo"><p><b>No video: not worth trying</b></p><p>${esc(a.fitReason)}</p></div>`
    : `<div class="d-novideo"><p><b>No video for this run</b></p><p>${videoNote ? esc(videoNote[0].toUpperCase() + videoNote.slice(1)) + '.' : ''}${d.hasProject ? ' The scenes are built: Run again to render them.' : ''}</p></div>`;

  // "yes: …" / "maybe. …" / "no, …" → a word badge + the rest of the sentence
  const answer = s => {
    const m = String(s ?? '').match(/^\s*(yes|maybe|no)\b[\s.:,;—-]*/i);
    const word = m ? m[1].toLowerCase() : null;
    const rest = m ? s.slice(m[0].length) : s;
    const cls = { yes: 'v-use', maybe: 'v-watch', no: 'v-skip' }[word] ?? '';
    return `${word ? `<span class="ans ${cls}"><span class="vdot"></span>${esc(word[0].toUpperCase() + word.slice(1))}</span>` : ''}<p>${esc(rest ? rest[0].toUpperCase() + rest.slice(1) : '')}</p>`;
  };
  const EFFORT = { low: 'Quick to try', medium: 'Some setup', high: 'Big effort' };
  const CTX = { work: 'Work', home: 'Home', both: 'Work and home' };
  const WHO = { me: 'For you', team: 'For your team', organisation: 'For the organisation', presenting: 'For presentations' };
  const DATA = { 'sensitive-ok': 'OK for sensitive data', 'non-sensitive': 'Non-sensitive data only' };
  const tldr = a.tldr?.length ? a.tldr : [a.fitReason].filter(Boolean);
  const f = d.facts ?? {};
  const facts = [
    ['Stars', f.stars != null ? f.stars.toLocaleString('en') : null], ['License', f.license], ['Language', f.language],
    ['Last update', f.pushedAt ? fmtDate(f.pushedAt) : null], ['Checked in', d.durationSec != null ? fmtSecs(d.durationSec) : null],
  ].filter(([, v]) => v);
  const stepsDone = state.steps.filter(s => d.steps?.[s]).map(s => { const i = d.steps[s]; return `<li class="${i.status}"><span>${esc(s)}</span><span class="num">${esc(i.status === 'skipped' ? 'skipped' : i.status === 'failed' ? 'failed' : fmtSecs(i.secs))}</span></li>`; }).join('');

  $('#d-body').innerHTML = `<div class="rd">
    <article class="rd-main">
      <section class="sum ${vClass(a.verdict)}" aria-label="Summary">
        <div class="sum-top"><span class="sum-v"><span class="vdot"></span>${esc(VERDICT[a.verdict] ?? 'No verdict')}</span><span class="sum-s num">${esc(a.fitScore ?? '–')}<small>/10 fit</small></span></div>
        <ul class="tldr">${tldr.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      </section>

      <section class="blk"><h3>What it does</h3><p>${esc(a.whatItDoes)}</p></section>

      ${a.uses?.length ? `<section class="blk"><h3>How it can help you</h3><ol class="uses">${a.uses.map(u => `<li>
        <p class="u-t">${esc(u.title)}</p><p>${esc(u.detail)}</p>
        <p class="tags">${u.who ? `<span>${esc(WHO[u.who] ?? u.who)}</span>` : ''}<span>${esc(CTX[u.context] ?? u.context)}</span><span>${esc(EFFORT[u.effort] ?? u.effort)}</span>${u.data ? `<span>${esc(DATA[u.data] ?? u.data)}</span>` : ''}</p></li>`).join('')}</ol></section>` : ''}

      ${a.example ? `<section class="blk"><h3>Example: ${esc(a.example.title)}</h3><p>${esc(a.example.scenario)}</p>
        <div class="ex ex-${esc(a.example.surface)}"><p class="ex-l">Illustrative example</p>
          <pre class="ex-in">${a.example.input.map(l => `<span>${esc(l)}</span>`).join('\n')}</pre>
          <ol class="ex-steps">${a.example.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
          <pre class="ex-out">${esc(a.example.output.join('\n'))}</pre></div>
        <p class="ex-src">Based on <code>${esc(a.example.basedOn)}</code>. An illustration of how it is used, not a test run.</p></section>` : ''}

      <section class="blk"><h3>Can you use it?</h3><div class="wh">
        <div><p class="wh-t">At work</p>${answer(a.worksAtWork)}</div>
        <div><p class="wh-t">At home</p>${answer(a.worksAtHome)}</div></div></section>

      ${a.risks?.length ? `<section class="blk"><h3>Watch out for</h3><ul class="risks">${a.risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul></section>` : ''}

      <section class="blk"><h3>What you need</h3>${a.setup?.requirements?.length ? `<ul class="req">${a.setup.requirements.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p>Nothing listed.</p>'}
        ${a.setup?.install ? `<div class="code"><pre>${esc(a.setup.install)}</pre><button class="btn copy" data-copy>Copy</button></div>` : ''}</section>

      ${a.tldr?.length && a.fitReason ? `<section class="blk"><h3>Why this score</h3><p>${esc(a.fitReason)}</p></section>` : ''}

      ${a.evidence?.length ? `<details class="blk ev"><summary>Where this comes from <span class="num">(${a.evidence.length})</span></summary><ul>${a.evidence.map(e => `<li><p>${esc(e.claim)}</p><code>${esc(e.file)}</code></li>`).join('')}</ul></details>` : ''}
    </article>
    <aside class="rd-side">
      ${video}
      ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${stepsDone ? `<div class="steps-box"><p class="wh-t">Steps</p><ul class="steps">${stepsDone}</ul></div>` : ''}
    </aside></div>`;
  const cp = $('#d-body [data-copy]');
  if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(a.setup.install); cp.textContent = 'Copied'; setTimeout(() => (cp.textContent = 'Copy'), 1600); } catch {} };
  $('#d-folder').onclick = () => api(`/api/runs/${encodeURIComponent(id)}/folder`, { method: 'POST' });
  $('#d-again').onclick = () => { closeSheets(); $('#url').value = d.repo; analyze(true); };
  $('#d-delete').onclick = () => deleteRun(id, repo.replace(/^github\.com\//, ''));
  const vb = $('#d-viewer');
  if (vb) vb.onclick = async () => { vb.disabled = true; const r = await api(`/api/runs/${encodeURIComponent(id)}/viewer`, { method: 'POST' }); vb.disabled = false; if (r.ok) window.open(r.data.url, '_blank', 'noopener'); };
  show('detail');
}
$('#big-open').addEventListener('click', () => state.selected && openDetail(state.selected.id));

// ---------------------------------------------------------------- delete (asks first; removes report, video and clone)
function confirmBox(title, text) {
  const dlg = $('#confirm');
  $('#c-title').textContent = title; $('#c-text').textContent = text;
  return new Promise(ok => { dlg.addEventListener('close', () => ok(dlg.returnValue === 'ok'), { once: true }); dlg.returnValue = ''; dlg.showModal(); });
}
async function deleteRun(id, name) {
  if (!(await confirmBox(`Delete ${name}?`, 'This removes its report, video and the cloned code from this PC. It cannot be undone.'))) return;
  const v = document.querySelector('#d-body video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
  const r = await api(`/api/runs/${encodeURIComponent(id)}/delete`, { method: 'POST' });
  if (!r.ok) { note(`<span class="err">${esc(r.data.error ?? 'Could not delete it.')}</span>`); return; }
  if (state.selected?.id === id) state.selected = null;
  note(`Deleted ${esc(name)}.`);
  await loadRuns();
  renderLibrary(); show('library');
}

// ---------------------------------------------------------------- views
const PIP = { analyze: 0, library: 1, profile: 2 };
function show(sheet) {
  for (const s of ['library', 'detail', 'profile']) $(`#${s}`).hidden = s !== sheet;
  const view = sheet === 'detail' ? 'library' : sheet ?? 'analyze';
  for (const b of document.querySelectorAll('.navbtn')) b.toggleAttribute('aria-current', b.dataset.view === view), b.dataset.view === view && b.setAttribute('aria-current', 'page');
  $('#pip').style.transform = `translateY(calc(${PIP[view] * 66} * var(--u)))`;
  if (sheet) $(`#${sheet} .x`)?.focus();
}
function closeSheets() { show(null); }
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', closeSheets);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });
for (const b of document.querySelectorAll('.navbtn')) b.addEventListener('click', async () => {
  const v = b.dataset.view;
  if (v === 'analyze') { closeSheets(); $('#url').focus(); }
  if (v === 'library') { renderLibrary(); show('library'); }
  if (v === 'profile') {
    const { data } = await api('/api/profile');
    $('#p-path').textContent = data.template
      ? 'This is the template. Copy config/profile.example.md to config/profile.local.md and describe yourself: repos are judged against it.'
      : `Edit ${data.path} to change how repos are judged.`;
    $('#p-text').textContent = data.text;
    show('profile');
  }
});
$('#tool-library').addEventListener('click', () => { renderLibrary(); show('library'); $('#filter').focus(); });

// ---------------------------------------------------------------- boot
renderWave(null);
await Promise.all([loadStatus(), loadRuns()]);
setTimeout(() => document.body.classList.remove('intro'), 3200);
