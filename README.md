# ε epsilon — a laboratory of very small errors

52 tiny browser games that measure timing, angle, memory, reasoning, perception and control. Every score is a number you can beat. No account, no server, works offline; records never leave your browser.

**Play:** [adnane-giddah.github.io/ADNTism](https://adnane-giddah.github.io/ADNTism/) · **Android app (offline, landscape, its own interface):** [epsilon.apk](https://github.com/adnane-giddah/ADNTism/releases/latest/download/epsilon.apk) · **iPhone:** open the site in Safari → Share → *Add to Home Screen* (works offline).

```bash
npm install
npm run dev    # http://localhost:5173
npm test       # scoring math, seeds, storage
npm run build  # typecheck + tests + production build
npm run build:pages  # build for GitHub Pages (/ADNTism/)
npm run icons  # re-render every icon (yellow ε on black) from scripts/icons.mjs
```

Releases are automatic: every push to `main` deploys the website (`.github/workflows/pages.yml`) and builds the Android APK with Capacitor (`.github/workflows/android.yml`), attached to the latest GitHub release as `epsilon.apk`.

Each game has **Easy / Medium / Hard** (keys `1` `2` `3`), ★ targets, per-level records, a daily challenge, and a shareable result card.

## The games

| | Game | The idea |
| --- | --- | --- |
| 01 | Projection | Rebuild floating 3-D voxels from their silhouettes. |
| 02 | Fold | Fold on any line, punch, unfold: predict or build the pattern. |
| 03 | Slipstream | Thread gaps down a tube; graze edges for speed. |
| 04 | Pour | Fill a strange tank to an exact fraction of volume. |
| 05 | Pendulum Catch | Catch a real pendulum at the mark. |
| 06 | Brake Point | Stop on the line over hills, ice and drag. |
| 07 | Letterfall | Press each falling key as it lands. |
| 08 | Zero | Four blind holds, + − + −. End on exactly zero. |
| 09 | Exact | Turn a needle to an angle on a dial with no numbers. |
| 10 | Rule Hunter | Infer the hidden rule, build the next grid. |
| 11 | Function Path | Write f(x) that threads every obstacle. |
| 12 | Lag | Your commands arrive late. Steer by anticipation. |
| 13 | Fovea | Detail only exists under the lens. Choose where to look. |
| 14 | Checksum | Repair damaged data from its redundancy. |
| 15 | Counterpoint | Two streams share gates: every A reroutes the next B. |
| 16 | Bifurcation | Turn one knob; somewhere the behaviour changes. |
| 17 | Stop | Brake a sliding mass onto the line. |
| 18 | Draw | Redraw a vanished circle from memory. |
| 19 | Echo | Tap a rhythm back, gap by gap. |
| 20 | Shadow | Keep the pointer on a wandering dot. |
| 21 | Intercept | Press when it crosses, behind a frosted screen. |
| 22 | Rotate | Pick the shape that is turned, not mirrored. |
| 23 | Hypothesis | Test numbers, then name the hidden rule. |
| 24 | Last Look | Offers one by one; passing is forever. When to commit? |
| 25 | Descent | Find the lowest point of a landscape you cannot see. |
| 26 | Alias | Sparse samples can make one wave look like another. |
| 27 | Regime | A rule works — until it doesn't. Notice the change. |
| 28 | Valve Engineer | Route liquid to exact volumes, spill nothing. |
| 29 | Communicating Vessels | Predict where connected liquids settle. |
| 30 | Close the Loop | Draw the arrow that brings the path home. |
| 31 | Center | Place points so their average hits ✛. |
| 32 | Mirror | Tap where the reflection lands. |
| 33 | Perception | Match true geometry under classic illusions. |
| 34 | Phaseshift | Make two dials move in step. |
| 35 | False Beat | Tap on the beat after the clicks stop. |
| 36 | Intersect | Launch so two movers meet at ✛ together. |
| 37 | Drift | Hold a dot on zero against a hidden push. |
| 38 | Balance | Weigh hidden masses by the beam's tilt. |
| 39 | Plumb | One stroke, dot to dot, as straight as you can. |
| 40 | Trace | Tap back a lit sequence in order. |
| 41 | Count | Rank colours by number, too fast to count. |
| 42 | Quantity Sense | What share are ●? Don't count the ink. |
| 43 | Density | Which field has more dots per area? |
| 44 | Area | Rank shapes by true area. |
| 45 | Length | Rank paths by length along the curve. |
| 46 | Intersection | Do they overlap, and by how much? |
| 47 | Weigh | Deduce only what the scales prove. |
| 48 | Difference Engine | Find and name the one change. |
| 49 | Verbatim | Retype a passage, word for word. |
| 50 | Afterimage | Rebuild a bobbing signal from memory. |
| 51 | Filter | Press only when the rule is met. |
| 52 | JND | How small a difference can you still see? |

The cognitive games (Projection, Fold, Lag, Fovea, Checksum, Counterpoint, Bifurcation, Last Look, Descent, Alias, Regime, JND) draw each round from five or six variation families through a scheduler that avoids repeats and adapts the difficulty to you; their scores are mean round penalties in %.

## More

Rules, formulas and scoring: [GAMES.md](GAMES.md) · player guide: [ADNReAD.md](ADNReAD.md) · architecture and adding a game: [README-dev.md](README-dev.md).
