# Langton Ant Lab

A neon, interactive Langton's ant laboratory built with **Three.js** and **Vite**.
A tiny two-rule universe grows into a colorful colony, then suddenly locks into a
repeating highway. The Loop Lab catches the moment it happens.

![Langton Ant Lab](preview.png)

## Run it

This checkout is already installed. From PowerShell:

```powershell
.\run.cmd
```

Then open **http://127.0.0.1:5173/**.

If Node.js 20+ and pnpm are already on your PATH, the standard commands work too:

```powershell
pnpm install
pnpm dev
```

On this Windows machine pnpm's default junction links were malformed, so the
project uses a flat, hoisted install (`node-linker=hoisted`). The launchers use the
Node copy bundled with the harness when `node` is not on PATH.

| Command | What it does |
| --- | --- |
| `.\run.cmd` | Starts the Vite dev server at `127.0.0.1:5173` |
| `.\install.cmd` | Reinstalls dependencies (hoisted) |
| `pnpm build` | Production build in `dist/` |
| `pnpm preview` | Serves the production build |

## The rule

Each character in a rule is the turn taken on that cell state:

- `R` — turn right
- `L` — turn left
- `N` — go straight
- `U` — turn around

The ant reads the tile, turns, flips the tile to its next state, and moves one cell
forward. For the classic `RL` rule: state `0` turns right and becomes `1`; state `1`
turns left and becomes `0`. No randomness.

The grid is **451 × 451** and finite. When the ant reaches the edge, the walk stops
until you reset — zoom out or pan if you want to watch the edge approach.

## The Loop Lab

The ant's most famous trick is the **highway**: after wandering for roughly 10,000
steps, the classic rule starts repeating a 104-step pattern that translates across
the grid forever.

The Loop Lab fingerprints the **21 × 21 cell patch around the ant**. If an identical
patch returns, it records:

- **Period** — steps between recurrences
- **Drift** — how far the pattern moved, in cells per cycle (`Δx, Δy`)
- **Found at** — the step where the recurrence was detected

The mint trace draws one full period. The **ring** marks the start; the **diamond**
marks the end, so you can see the drift. **Frame loop** (`F`) zooms to the trace.

### Preset outcomes

| Preset | Rule | Period | Drift | Typically found |
| --- | --- | ---: | --- | ---: |
| Classic | `RL` | 104 | `-2, -2` | ~10,525 |
| Tight orbit | `RR` | 8 | `0, 0` | ~248 |
| Needle | `RRL` | 18 | `+1, -1` | ~258 |
| Weave | `RRRL` | 52 | `+2, -2` | ~344 |
| Slow burn | `LRRRRRLLR` | 374 | `+1, -1` | ~28,827 |
| Wanderer | `LLRR` | — | — | no early loop |

Different rules make very different loops: boxes, glides, long slow recurrences, or
no local recurrence at all. Randomize the rule and the detector will keep listening.

## Controls

| Input | Action |
| --- | --- |
| `Space` | Play / pause |
| `→` | Step once |
| `R` | Reset |
| `F` | Frame the detected loop |
| Drag | Pan (turns off auto-follow) |
| Scroll | Zoom at the cursor |
| Double-click | Recenter and resume auto-follow |
| `+` / `−` / home button | Camera controls |

**Auto-follow** keeps the growing colony framed while it is running. Panning or
zooming hands the camera to you; the home button (or double-click) gives it back.

## Shareable states

Deep links are useful for demos and bug reports:

```text
?steps=11200                 jump to step 11,200
?rule=RR&steps=400           load a rule and jump ahead
?rule=RL&steps=10525&frame=1 jump to the highway and frame its loop
?panel=1                     open the controls sheet on a narrow screen
```

Examples:

- [Classic, framed highway](http://127.0.0.1:5173/?rule=RL&steps=10525&frame=1)
- [Tight 8-step orbit](http://127.0.0.1:5173/?rule=RR&steps=400&frame=1)
- [Nine-state slow burn](http://127.0.0.1:5173/?rule=LRRRRRLLR&steps=28827)

## Look and feel

- **Spectrum** paints each newly flipped cell with a hue that moves through time
  and space, so the path becomes a rainbow recording of its own history.
- **States** gives each rule state a fixed neon color.
- `0`-state cells that have been visited keep a dim afterglow, so the shape of the
  path remains readable after tiles flip back.
- Bloom, a custom grid shader, and a hand-drawn SVG ant do the rest.

The ant SVG lives at [`public/ant.svg`](public/ant.svg) and can be replaced with any
transparent PNG or SVG of the same portrait orientation (head pointing up).

## Architecture

| File | Purpose |
| --- | --- |
| [`src/langton.js`](src/langton.js) | Ant state machine, generalized rules, local-patch cycle detector |
| [`src/main.js`](src/main.js) | Three.js scene, instanced tiles, camera, loop trace, UI wiring |
| [`src/style.css`](src/style.css) | Dark glass UI, responsive layout |
| [`public/ant.svg`](public/ant.svg) | The ant sprite |
| [`vite.config.js`](vite.config.js) | Dev server and build config |

The 203,401 tiles are one `InstancedMesh` with a single draw call. Tile colors are
uploaded incrementally as cells flip, using `BufferAttribute` update ranges. The
grid and glow are shader/bloom effects, not thousands of DOM elements.

The simulation is exposed for console tinkering:

```js
antLab.sim.steps
antLab.applyRule('RRL')
antLab.frameLoop()
antLab.setPlaying(false)
```

## Credits

Built as a sample Three.js project. Langton's ant was devised by Chris Langton in
1986. The classic highway behavior was popularized by later computer experiments.
