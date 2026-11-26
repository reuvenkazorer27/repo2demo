# repo2demo UI: DESIGN

**Context:** a personal local tool (one user, 127.0.0.1). The look adapts a "liquid glass weather dashboard" style:
frosted glass over a dark SVG scene and a chart that draws itself. UI in English.

## Direction
- Product: paste a GitHub URL, watch the agent work, then open any repo checked before (report, video, verdict).
- Character: quiet instrument; real data only (verdicts, scores, step times from the runs). Nothing is made up.
- World: night scene drawn in SVG (deep teal-blue, layered hills, faint dot grid) instead of Aurora's storm photo,
  with frosted white glass and white ink.
- Moments: pressing Analyze. The pipeline line starts drawing and advances one step at a time as the agent works.
- Signature: **the pipeline wave** (Aurora's self-drawing forecast chart). 7 steps sit where the days were, the time
  each step took sits where the temperatures were, and the pen draws as far as the run has really got.

## Tokens (from Aurora)
- Stage 1357×871, `--u: min(100vw/1357, 100dvh/871)`. Absolute, edge-anchored. ≤860px: one scrolling column,
  `--u: min(100vw/430, 1.22px)`, sidebar becomes a bottom dock.
- Ink `#fff`; secondary `rgba(255,255,255,.80)` (AA on the darkest glass); fallback bg `#04121b`.
- Glass: sidebar (Aurora sidebar gradient, blur 18u), cards (rail gradient, blur 26u), chips/tools `rgba(255,255,255,.15/.175)`.
  No opaque cards, no shadow stacks, no purple.
- Verdict colours (the only colour in the UI, on data): use `#7EE2B8`, try `#9CC8FF`, watch `#F2D27A`, skip `#F2A7A0`.
- Type: Inter 400/500/600 + Inter Tight 500 for the headline; h1 63u/78u; blurb 15.2u/24u; numbers tabular.
- Easing: `--e-out .16,1,.3,1` · `--e-soft .22,.61,.36,1` · `--e-pen .37,.01,.2,1`.

## Layout map (Aurora → repo2demo)
| Aurora | repo2demo |
|---|---|
| Sidebar nav | Analyze · Library · Profile |
| Header "Welcome / name" | "repo2demo" / live status: Claude account signed in, motlab version |
| Hero chip + h1 + blurb | chip "Repo check" · h1 "Check a repo / before you install it" · one-line blurb + glass URL field |
| Forecast temps + wave + days | step times + pipeline wave + 7 step names |
| Rail big card | selected repo: fit score big, verdict, stars · license · minutes |
| Rail row cards | the 3 latest repos (owner / repo / verdict · score) |
| — | Library sheet: every run, filter, open → detail sheet (video, report, risks, evidence) |

## Motion
- The entrance is Aurora's choreography, cut down (sidebar, header, hero, rail, wave, sheen once).
- Continuous motion only while a run is live: the pen advances and the current step's label shows a small pulsing
  dot. Nothing moves when idle.
- `prefers-reduced-motion`: no entrance, wave drawn in its final state, no sheen.

## Accessibility
WCAG 2.2 AA: white on glass over the dark scene ≥ 4.5:1 (secondary text kept ≥ .80 alpha), `:focus-visible` 2u white
outline, labelled icon buttons, live region for run progress, keyboard: Enter submits, Esc closes sheets.

## Components (states)
- URL field: empty · invalid (message under it) · already checked (offer "Open" or "Run again") · running (disabled).
- Step: pending · live · done (time) · failed (message).
- Repo row: verdict colour dot + word (never colour alone).
