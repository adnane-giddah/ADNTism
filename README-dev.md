# ε epsilon — a laboratory of very small errors

Tiny browser instruments that measure timing, angle, distance and control. No account, no server, works offline.

```bash
npm install
npm run dev      # http://localhost:5173 (also exposed on your LAN for phone testing)
npm test         # unit tests: scoring math, seed reproducibility, feasibility, storage
npm run build    # typecheck + tests + production build into dist/
npm run preview  # serve the production build
```

## Experiments

| No. | Name | Measures | Input |
| --- | --- | --- | --- |
| 00 | Calibration (homepage) | release at exactly 1.000 s, then √2, 1/φ, √3… | hold |
| 01 | Zero | four blind holds + − + −, total must be 0 | hold |
| 02 | Exact | angle on a dial with no numbers | drag / ← → |
| 03 | Close the Loop | the closing vector, drawn on a separate (scaled / rotated) pad | drag / arrows |
| 04 | Draw | a ring from memory, RMS distance | draw |
| 05 | Stop | brake a sliding mass onto a line (phase plot) | hold |
| 06 | Balance | infer hidden masses from the beam's tilt, 3 drops | drag / ← → |
| 07 | Drift | hold a dot on zero against a hidden, changing force | drag / ← → |
| 08 | Echo | reproduce a rhythm's gaps (latency cancels) | tap |
| 09 | Center | place 4 points; their average must hit ✛ | tap / arrows |
| 10 | Plumb | one straight stroke, dot to dot | draw |
| 11 | Phaseshift | make two oscillators move in step — phase and speed (Blind mode: the reference vanishes) | drag / sliders |
| 12 | False Beat | tap on a beat after the clicks stop, or on a hidden crossing, past decoys | tap |
| 13 | Intersect | launch so two movers meet at ✛ at the same instant (Misleading, Phase-collision modes) | drag / sliders |
| 14 | Perception | match real lengths, sizes, gaps, angles, alignments under classic illusions (On-the-beat mode) | slider |
| 15 | Afterimage | rebuild a signal's amplitude, frequency, phase, size or beat from memory | sliders / tap |
| 16 | Pour | fill a strange tank to an exact fraction of its *volume* | hold |
| 17 | Shadow | keep the pointer on a drifting target (it vanishes on Hard) | follow |
| 18 | Mirror | tap where a point's reflection lands (two mirrors on Hard) | tap |
| 19 | Communicating Vessels | predict and reach equilibrium levels; overflow; sandbox | drag / valves |
| 20 | Valve Engineer | route liquid to exact target volumes through valves | valves |
| 21 | Verbatim | exact recall of a passage (character error rate) | type |
| 22 | Letterfall | press falling keys on the line; QWERTY / AZERTY / QWERTZ / Dvorak / custom | keys |
| 23 | Rule Hunter | infer the hidden grid rule and build the next state | tap |
| 24 | Difference Engine | find and name the one structural change | tap |
| 25 | Quantity Sense | share of ● — count, not ink | slider |
| 26 | Brake Point | stop on the line over hills, ice and drag | hold |
| 27 | Pendulum Catch | catch a real (nonlinear) pendulum at the mark | tap |
| 28 | Slipstream | full speed down a tube: thread the gaps, graze edges for speed and shields (distance — higher is better) | hold |

Settings (About → Settings) include volume, no flashes, large text, large targets and key sensitivity. Every game has ★ ★★ ★★★ targets, Hard unlocks with ★ on Medium, rounds are judged with combos, and a first-visit tutorial explains each game. New variety modes: Zero · Weighted, Exact · Mixed units, Draw · Shapes, Mirror · Transforms. Gameplay twists (each its own mode, with its own records): Zero · Decoy (a false metronome ticks during your holds), Exact · Spinning dial (the dial turns while you aim), Stop · Moving line, Draw · Mirror hand (your pen is reflected), Pendulum · Gusts (wind kicks the bob mid-swing), Shadow · Twins (a mirror-image decoy keeps crossing the target), Letterfall · Ghost keys (some keys fade before the line). Pour now has three fluids — xenon, heavy water, mercury — with valve lag and afterflow: what is falling when you let go still lands. The play screen has a HUD strip (progress pips, stars and the next target, best) and shows the verdict beside the stage, never over it. Full contract: [GAMES.md](GAMES.md) · player guide: [ADNReAD.md](ADNReAD.md).

Shared timing rule for the rhythm modes: beat n = start + n·60/BPM, scheduled before the round; taps use input-event timestamps; an optional tap-along **latency calibration** (`C` in False Beat) removes one measured systematic offset per sound condition. Echo gained a **Rhythm memory** mode (a deliberate tempo change, then a silent hold).

## Levels

Every experiment has Easy, Medium and Hard. Pick one in the header or press `1` `2` `3`. Records are kept per level, and the daily experiment is always Medium. Levels change the *rules*, not just the speed:

| | Easy | Hard |
| --- | --- | --- |
| Zero | 2 holds, live total | 6 blind holds, the total is never shown, ≥ 0.4 s each |
| Exact | guide every 30° | dial turned each round, needle hidden while aiming, 7 decimal targets |
| Loop | 2–3 arrows, plain pad | 5–6 arrows, pads scaled + turned by odd angles, one mirrored, path vanishes while drawing |
| Draw | ring stays faintly visible | tilted ellipse shown 1.5 s, then the shape and centre vanish |
| Stop | stop-point shadow | secret brake strength each run, faster, fogged track end, no speed readout |
| Balance | 1 block, 4 drops, near-linear | 2–3 blocks, 2 drops, no tilt number, early saturation |
| Drift | 15 s, smooth push, wide band | 25 s, 4 ambushes, narrow band, 180 ms control delay |
| Echo | 4 pulses, heard twice | 9-pulse theme: triplets, dotted notes, √2 and golden-ratio gaps, slowing tempo, sound only, once |
| Center | 3 points, running centre shown | 5 weighted points (×1 ×2 ×1 ×3 ×1), wider ring, the cross vanishes after point 1 |

### Drift scoring modes

Drift has two scorings, chosen with the `|∫|` / `∫` switch in its header. Records are kept separately for each:

- **|∫| Magnitude**: the score is `∫|x| dt / T`. Every moment away from zero counts against you, left or right.
- **∫ Net**: the score is `|∫x dt| / T`. Time spent right cancels time spent left, so the signed area must balance. A live `∫x dt` gauge shows the tally (hidden on Hard), and the trace shades right-side area solid and left-side area hatched so you can see the cancellation.

Experiments declare variants through `modes` in `registry.ts`. The shell adds the switch, the URL parameter (`?mode=net`) and per-mode records automatically.

Full behaviour contract (formulas, levels, run kinds, integrity rules): **[GAMES.md](GAMES.md)**. Upgrade plan: [EPSILON_MASTERPLAN.md](EPSILON_MASTERPLAN.md).

## Architecture

- **Vite + vanilla TypeScript + Canvas 2D.** No framework. Each experiment is its own lazy chunk.
- `src/core/` holds the shared pieces: `stage.ts` (DPR-aware canvas that only redraws on demand), `draw.ts` (hairlines, brackets, hatches, palette from CSS tokens), `records.ts` (localStorage records, consistency, trend, daily), `audio.ts` (synthesized sounds), `rng.ts` (seeded PRNG), `share.ts` (PNG result card).
- `src/games/registry.ts` holds metadata for every experiment, plus the daily rotation and seed.
- `src/pages/play.ts` is the shared experiment shell: prompt, instrument panel, result, records, daily tries, share, keys.

### Adding an experiment

1. Create `src/games/<id>.ts` and export a default `GameFactory`. It receives a `GameAPI` (`stage`, `seed`, `prompt`, `progress`, `finish`, `sfx`…) and returns `{ reset(seed), destroy() }`.
2. Add a metadata entry in `registry.ts`.
3. Add a preview function in `src/pages/previews.ts`.

### The cognitive-game bench (41–52)

`src/games/lab.ts` adds what the round-based cognitive games share, on top of `kit.ts`'s `Bench`:

- `Family<R>` — a variation family: `id`, `name`, `teach` (one line, shown the first time on a device), `bands` (0 onboarding … 3 mastery), optional `intro`, `gen(rng, band)` returning a validated challenge or `null`, and `sig(challenge)` (gameplay identity, for repeat detection).
- `chooseFamily` / `generate` / `pushHistory` — the scheduler: no immediate repeat, least frequent then least recent, recent signatures avoided, bounded retries with an easier-band fallback. History persists in `eps:var:<id>`.
- `Session<R>` — the run: `start(seed)`, `next()` (draws family + challenge, records history, sets `teach`), `done(pen, note)` (scores once, judges, adapts the band), `result({ label })` (once).
- `Sliders` — canvas sliders registered per frame (drag, ↑ ↓ ← →, Shift for fine steps); `famChip`, `para`, `fork`.

A new cognitive game exports `FAMILIES` (≥ 5) and its pure generators, and gets a sweep in `tests/cognitive.test.ts` (every family × band × many seeds: generates, validates, solution accepted). `tests/cognitive-smoke.test.ts` plays every game headlessly to a single result and checks cleanup.

## Honesty notes

Time comes from input-event timestamps, never timers. Space is measured in field units (`u`), so the score doesn't depend on screen size. Every run is seeded. Records never leave the browser.
