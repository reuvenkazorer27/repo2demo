# Brand: clean and clear

Every repo2demo video uses this look, so the videos read as one series.

- Canvas 1920x1080 (16:9), 30 fps.
- Background `#F6F6F3` (warm off-white). Text `#14171C`. Secondary text `#5B6270`.
- One accent colour per video. Default `#2F6FEB`. If the repo has a clear logo colour, use that instead, as long as
  text on it keeps 4.5:1 contrast.
- Font: Inter (Latin), Heebo when the text is Hebrew. Two weights only: 700 for titles, 500 for body.
- Sizes: title 88-104 px, body 44-56 px, nothing under 34 px. At most 3 lines of text on screen, at most ~8 words a line.
- Real screenshots/images from the repo sit in a simple window frame: radius 18 px, 1 px border `#E3E3DE`,
  one soft shadow. Never stretch, crop faces or redraw the repo's interface; scale it to fit, zoom into it if needed.
- Generous margins: 120 px left/right, 96 px top/bottom. Everything on an 8 px grid. Left-aligned text (right-aligned for Hebrew).
- No gradients behind text, no glow, no particles, no glitch, no 3D spin, no emoji.

## Example demo (the "example" scene)
- Title (the example's title) top-left as usual; under it the scenario caption in secondary text.
- One neutral window, about 1240×620, centred-right: rounded 18 px, 1 px border, a slim title bar with three grey dots.
  - terminal: dark `#14171C` body, monospace (JetBrains Mono or Cascadia), prompt sign `>` in the accent.
  - chat / app / browser / editor: light `#FFFFFF` body; chat = the input as a user bubble on the right, output as the
    reply on the left.
- Input types in at ~22 characters a second with a blinking caret only while typing. Steps appear as a short list with
  a small accent tick each (0.5 s apart). Output lines fade/slide in 0.15 s apart, then everything holds ≥ 3 s.
- Monospace 28-32 px in the window, nothing under 26 px. Max ~60 characters a line; never shrink text to fit.
- Small label "Illustrative example" in the window's top-right corner, secondary text, the whole scene.
- Never draw the repo's real product UI or logos inside the demo window: this is an honest illustration.
