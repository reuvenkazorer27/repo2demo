# repo2demo

**Cut through the AI hype: check every new skill, agent or tool on GitHub against *you*, before you adopt it.**

Every week brings a flood of new AI repos: agent frameworks, Claude Code skills and plugins, MCP servers, "10x"
tools. Most READMEs promise a lot, and few tell you whether the repo fits *your* work, *your* constraints and *your*
team. repo2demo answers that question per repo, so you can pick skills and agents deliberately and only adopt the
ones that pay off.

Paste a GitHub URL. repo2demo:

1. **Clones it safely** (shallow, agent config stripped, nothing installed or run).
2. **Has Claude judge the fit** against a profile you write once (`config/profile.local.md`): your role, what you
   build, how you present it, where sensitive data may go, your machines and license rules.
3. **Gives a verdict** (use / try / watch / skip) with a fit score, a short summary, concrete uses (for you, your team,
   the people you build for, or your presentations), work vs home fit, sensitive-data fit, setup, risks, and evidence
   with file names.
4. **Makes a 30-40 second demo video** with [motlab](https://github.com/staryone/motlab), including a short
   illustrative example of one practical use. A "skip" gets no video, only a clear explanation why.
5. **Keeps a library** of everything you checked, so you can compare, revisit, re-run or delete.

It runs on your own Claude subscription, through the Claude Code CLI that is signed in on your machine.

## Quick start

```powershell
npm install -g @motlab/cli
npx @motlab/cli setup
copy config\profile.example.md config\profile.local.md   # then describe yourself in it
node server.mjs                                          # UI at http://127.0.0.1:4180
```

Or from the command line:

```powershell
node bin/repo2demo.mjs https://github.com/owner/repo
```

A repo that was already checked is not run again unless you pass `--force` (the UI asks: open it or run again).

## The profile is the point

The verdicts are only as good as `config/profile.local.md` (git-ignored, so it stays on your machine). Start from
`config/profile.example.md` and fill in:

- **Role:** what you build and for whom; whether you lead a team; how you present your work.
- **Data sensitivity:** which platforms are allowed for sensitive data and which for everything else.
- **Stack:** the tools, agents and skills you already use (so duplicates get a "skip").
- **Constraints:** locked-down machines, license rules, OS.
- **What "useful" means:** time saved, new capability, reusable pattern, easier to show.

## What you get per repo

Output lands in `runs/<owner>__<repo>/` and in the UI's Library:

| File | What |
|---|---|
| `report.md` | Verdict, fit score, summary, uses (with who benefits and data fit), illustrative example, work/home fit, setup, risks, evidence |
| `demo.mp4` | 30-40 s, 1080p, silent, one clean style across all videos (none for a "skip") |
| `demo-sheet.jpg` | One frame per second on one sheet, for a quick look |
| `analysis.json` | The raw structured answer from Claude |
| `video/` | The motlab project: `motlab edit "<path>"` opens it in the viewer to leave notes or export 4K |
| `repo/` | The shallow clone (agent config removed) |

## Options

```
--lang he        report and video text in Hebrew (RTL)
--no-video       report only (about 1 minute)
--4k             render 3840x2160
--model <alias>  e.g. opus, sonnet (default: your Claude Code default)
--force          run again even if this repo was already checked
```

## How it works

1. **Clone**: `git clone --depth 1`, no tags, no submodules, no LFS. Then `.claude/`, `.cursor/`, `.mcp.json` and
   `.cursorrules` are deleted and `CLAUDE.md` / `AGENTS.md` are renamed to `*.repo.txt`, because a headless Claude run
   would load them without asking. The repo's own code is never installed or run. AVIF/SVG images get a still PNG.
2. **Analyse**: `claude -p` with only `Read, Glob, Grep`, no MCP servers, no user hooks, and a JSON schema for the
   answer. Text inside the repo is treated as data, not instructions. Image paths the model returns are checked against
   the real candidates.
3. **Brief**: the video text, the example and the images come only from the analysis and the repo; `style/*.md` sets the
   look.
4. **Build**: a second `claude -p` run reads the motlab skill + `style/` + `brief.md`, writes the scenes and checks its
   own stills. It may only run motlab stills, `python` and `ffprobe`; it cannot render or touch other folders.
5. **Render**: `motlab render`, or, where an organisation turns off Chrome remote debugging
   (`RemoteDebuggingAllowed = 0`), an ordinary Chrome window that draws and encodes each scene with WebCodecs in the
   page and hands the bytes to a local server (`src/browser-render.mjs`). No remote debugging is used.
6. **QA**: ffprobe for size and length, ffmpeg `signalstats` counts sudden brightness jumps (flashes), and a contact
   sheet.

## Make it yours

- `config/profile.local.md`: who the repos are judged for.
- `style/brand.md`, `style/pacing.md`, `style/captions.md`: the series look. Change once, every video follows.

## Requirements

Node 24+, Git, Google Chrome, ffmpeg/ffprobe on PATH, Python 3 with Pillow/numpy/scipy, the Claude Code CLI signed in,
and motlab: `npm install -g @motlab/cli && npx @motlab/cli setup`.

## Notes

- A personal Claude subscription covers your own use. If other people use this app, it needs an API key instead.
- Analysis sends the repo's text to Claude: use it on public repos, not on internal code.
- The UI server listens on 127.0.0.1 only and rejects requests from other sites.
