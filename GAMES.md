| 27 | Pendulum Catch || 26 | Brake Point || 25 | Quantity Sense || 24 | Difference Engine || 23 | Rule Hunter || 22 | Letterfall || 21 | Verbatim || 20 | Valve Engineer || 19 | Communicating Vessels || 18 | Mirror || 17 | Shadow || 16 | Pour || 15 | Afterimage || 14 | Perception || 13 | Intersect || 12 | False Beat || 11 | Phaseshift || 10 | Plumb || 09 | Center || 08 | Echo || 07 | Drift || 06 | Balance || 05 | Stop || 04 | Draw || 03 | Close the Loop || 02 | Exact || 01 | Zero |# ε epsilon: the games

**epsilon** is a collection of twenty-seven small browser games that measure physical precision: how exactly a person can time, aim, draw, balance and control things. Every game is understandable in a few seconds; the score is a real measurement (milliseconds, degrees, distance units), not points.

> The question is never "can you solve it?" but "can your body actually produce the answer?"

- Runs entirely in the browser (Vite + TypeScript + Canvas 2D). No account, no server, works offline.
- Records are stored locally (localStorage), separately for each game, level and scoring mode.
- Works with mouse, touch and keyboard.
- Repository layout: each game is one file in `src/games/<id>.ts`; metadata is in `src/games/registry.ts`.

---

> **Numbering.** Games are listed and numbered on the site in play order (registry `ORDER`: Projection, Fold, Slipstream and Pour first). The section numbers below are the original catalogue numbers, kept so older notes still match; records are keyed by id and unaffected.

## Shared rules (apply to every game)

| Concept | Meaning |
| --- | --- |
| **Score** | One primary measurement. For every game in this collection, **lower is better** (it is an error). |
| **u (units)** | Spatial games use a field that is always 100 u wide, whatever the screen size, so phones and monitors are scored alike. Distances on the pad/track/beam use the same unit. |
| **Time** | Measured from the input events' own high-resolution timestamps (`event.timeStamp`), never from timers. Shown to 1 ms at most. |
| **Levels** | Every game has **Easy / Medium / Hard**. Levels change the *rules* (information hidden, constraints added), not just speed. Keys `1` `2` `3` switch level. |
| **Seed** | Each attempt is generated from a seed (shown as `RUN XXXX`). The same seed always gives the same targets and conditions. |
| **Perfect** | A score that rounds to exactly 0 at the displayed precision. Shown as **EXACT**; it inverts the screen briefly and plays a bell. Deliberately rare. |
| **Daily experiment** | One game per day, the same seed for everyone, always Medium (and the default scoring mode). 3 official tries; the best counts. Game of the day = `DAILY_POOL[(dayNumber × 4) mod 9]`, where day 1 = 2026-01-01 and `DAILY_POOL` is the frozen list of the original nine games (zero, exact, loop, draw, stop, balance, drift, echo, center), so adding games never changes a date's selection. Seed = FNV-1a hash of `"epsilon/YYYY-MM-DD"`. |
| **Run kinds** | **ranked** (fresh random seed; counts for bests), **daily** (official daily attempt; counts), **practice** (unranked; may show extra help), **challenge** (from a seed link; unranked; never consumes daily tries). The first attempt at each game on a device is an unranked **warm-up**. |
| **Challenge links** | `/e/<id>?seed=<base36>&level=<easy|hard>&mode=<id>` replays exactly the same conditions. The seed is validated (1–7 base-36 characters, ≤ 2³²−1); an invalid seed falls back to a normal run. Shown in the header as `RUN <seed>`; click it to copy the link. |
| **Per-run stats** | Best; **median** of the last 10 ranked runs; **spread** = median absolute deviation of those runs (in the game's unit); run count; trend = median of the last 5 vs the first 5 ranked runs (undefined if the early median is ≈ 0). Practice and challenge runs are kept in the journal only. |
| **Integrity rules** | A non-finite or negative score is discarded, never recorded. An interrupted touch (`pointercancel`) never commits an answer. Hiding the tab mid-run voids the attempt in Stop, Drift, Echo, False Beat, Shadow, Pour (while pouring), Afterimage (while the signal or delay is showing) and Perception's on-the-beat mode. Phaseshift and Intersect are computed analytically from elapsed time, so a hidden tab cannot change their outcome; they simply carry on. If an input method changes what the player can see (keyboard aiming in Exact Hard shows the needle), the run is recorded in a separate category (`exact.hard~keyboard`). |
| **Storage** | localStorage, version 2 (`eps:version`). Key `eps:rec:<game>[.<level>][~<mode>]`; each run stores score, time, kind, seed, optional daily key, input condition and note. Corrupt entries are dropped on read; backups export and import as JSON and merge without duplicates. |
| **Global keys** | `Space`/`Enter`/`R` another attempt (on the result screen) · `R` restart mid-attempt · `Esc` leave · `?` rules · `M` sound · `1` `2` `3` level · `P` practice. |

---

## 00 · Calibration (homepage instrument)

- **Action:** press and hold anywhere in the box; release at exactly the target duration.
- **Targets (in order):** 1.000 s → 0.500 s → √2 ≈ 1.414 s → 1/φ ≈ 0.618 s → √3 ≈ 1.732 s → π/2 ≈ 1.571 s → 2.000 s → 0.250 s, then repeats.
- **Progression:** if you release within **±25 ms** of the target, the next target unlocks.
- **Feedback:** a 0–2.5 s ruler, plus a ×12.5 magnifier showing target ±100 ms.
- No levels; not recorded as a game score.

---

## 01 · Zero: signed time, cancellation

- **Idea:** a series of blind holds whose durations alternately **add and subtract**. The running total must end at exactly 0.
- **Input:** press and hold anywhere (or `Space`), release to commit one hold.
- **Rule:** each hold must last at least the minimum, or it does not count and must be redone.
- **Score:** `|Σ signᵢ · durationᵢ|` in **seconds**, 3 decimals.

| Level | Holds (signs) | Min hold | Visibility |
| --- | --- | --- | --- |
| Easy | 2: + − | 0.300 s | The bar grows live while you hold. |
| Medium | 4: + − + − | 0.300 s | Blind while holding; the running total is shown between holds. |
| Hard | 6: + − + − + − | 0.400 s | Blind, and the running total and scale are **never shown** until the end. You keep the sum in your head. |

---

## 02 · Exact: angle

- **Idea:** turn a needle to a target angle on a dial that has no numbers.
- **Convention:** 0° is at the dial's mark; angles increase **clockwise**.
- **Input:** drag anywhere; the needle points at your finger or cursor; release to lock. Keyboard: `←` `→` rotate continuously (48°/s, `Shift` = 6°/s), `Enter` locks.
- **Score:** mean absolute angular error over all targets, in **degrees**, 1 decimal.

| Level | Targets | Help |
| --- | --- | --- |
| Easy | 5 multiples of 5° | Guide marks every 30°. |
| Medium | 5: one of 90/180/270, one of 45/135/225/315, two "odd" integers, one with .5 | Quadrant marks for rounds 1–2 only, then only 0°. |
| Hard | 7, each with a decimal (e.g. 211.7°), ≥ 6° from any multiple of 45° | The whole dial is rotated by a random 25–335° each round; the needle is **invisible while aiming** (visible for keyboard users). |

---

## 03 · Close the Loop: vector closure

- **Idea:** a path of arrows leaves home (○). Draw the **one missing arrow** that brings it back. You draw it on a separate **pad**; the arrow is then moved onto the end of the path.
- **Input:** drag from the pad's centre; release to send. Keyboard: arrow keys move the tip (14 u/s), `Enter` sends.
- **Transform:** pad vector → field vector = un-mirror → rotate back by the pad's rotation → multiply by the pad's scale. Pads show where the field's "UP" and "RIGHT" point.
- **Score:** mean closure gap (distance from the arrow's tip to home) over 5 paths, in **u**, 1 decimal. Also reports closure % = 1 − mean(gap / needed length).

| Level | Arrows per path | Pads |
| --- | --- | --- |
| Easy | 2, 2, 3, 3, 3 | All plain copies (×1, not rotated). |
| Medium | 2, 3, 4, 3, 3 | Round 4: half-size pad (your arrow ×2). Round 5: pad turned 90°. |
| Hard | 5, 5, 6, 5, 6 | Every pad scaled (×2, ×1.5, ×2, ×1.25, ×2) **and** turned (37°, 143°, −71°, 211°, 98°); round 3 is also mirrored. The path **vanishes while you draw**. |

---

## 04 · Draw: shape memory

- **Idea:** look at a shape, then draw it from memory in a single stroke, all the way round. The stroke must sweep ≥ 330° around the centre **and** visit ≥ 90% of 72 angular sectors (coverage), or it is rejected. This way a short, accurate arc cannot pass as a full shape.
- **Input:** one continuous pointer stroke (mouse, pen or finger). Uses coalesced pointer events for full sampling.
- **Score:** RMS of the signed distance from your stroke to the true outline, **weighted by stroke length**, in **u**, 2 decimals. Secondary: average offset (outside +, inside −), closure gap, degrees swept.

| Level | Shape | Visibility |
| --- | --- | --- |
| Easy | Circle, radius 14–36 u | Stays faintly visible while you draw (tracing). |
| Medium | Circle, radius 14–36 u | Disappears the moment you start drawing; the centre cross stays. |
| Hard | **Tilted ellipse**: semi-axis a = 22–38 u, b = a × 0.45–0.75, random tilt | Shown for **1.5 s** only, then the shape **and its centre** vanish on their own. |

---

## 05 · Stop: momentum

- **Idea:** a mass slides along a 100 u track toward a wall. Hold to brake (constant deceleration), release to coast. It must come to rest exactly on the target line.
- **Input:** first tap launches; then hold/release (pointer or `Space`).
- **Physics:** exact piecewise motion from event timestamps: coasting x = x₀ + v·t; braking x = x₀ + v·t − A·t²/2 until v = 0.
- **Score:** |stop position − target| in **u**, 1 decimal. If it hits the wall, the score uses where full braking *would* have stopped it: `100 + v_wall² / (2A)`.
- **Feedback:** a phase plot of speed against position, with the ideal "coast, then one clean brake" curve.

| Level | Brake A | Launch speed | Target | Extras |
| --- | --- | --- | --- | --- |
| Easy | 60 u/s² | 30–42 u/s | 56–86 u | A shadow shows where full braking would stop you. |
| Medium | 60 u/s² (constant, learnable) | 38–62 u/s | 56–86 u | none |
| Hard | **Secret**, random 32–95 u/s² every run | 56–74 u/s | 68–90 u | Track beyond 58 u is in **fog** (mass hidden), no speed readout. |

---

## 06 · Balance: inference of hidden weights

- **Idea:** a beam (−100…+100 u) has hidden blocks on the left with **unknown masses**; block sizes are deliberately unrelated to mass. Slide your weight (mass 1) on the right arm and drop it. Read the tilt, adjust, drop again.
- **Balance point:** x* = Σ mᵢ·dᵢ (your weight must sit at x*).
- **Tilt response:** θ = 14° · tanh((x − x*) / S). Positive = your side down.
- **Input:** drag horizontally, release = drop. Keyboard: `←` `→` slide (24 u/s, `Shift` 3 u/s), `Enter` drops.
- **Score:** residual imbalance of the **final** drop = |x_final − x*| / x* × 100, in **%**, 1 decimal.
- **Guarantee:** the generator always yields 18 u < x* < 94 u. The balance point is reachable (your arm reaches 100 u), and the relative score never divides by a value near zero.

| Level | Hidden blocks | Drops | S (response) | Tilt readout |
| --- | --- | --- | --- | --- |
| Easy | 1 | 4 | 40 (almost linear) | Shown to 0.01° |
| Medium | 1 or 2 | 3 | 22 | Shown |
| Hard | 2 or 3 | **2** | **8** (saturates early) | **Hidden**: only the beam's visual angle |

---

## 07 · Drift: controlling a noisy system

- **Idea:** keep a dot on the zero line while an invisible, changing force pushes it. You control **acceleration, not position**.
- **Input:** press and drag sideways (a joystick relative to where you pressed); keyboard `←` `→` (`Shift` = 30% push). The run starts on the first press.
- **Dynamics (fixed 1/120 s steps, deterministic):** v' = 42·u + f(t) − 0.55·v, x' = v, with walls at ±50 u. The hidden force f(t) = bias + three sine waves + sudden step changes at hidden times.
- **Reveal:** at the end, the hidden force is drawn (mirrored) over your trace.

**Two scoring modes** (switch `|∫|` / `∫` in the header; records kept separately):

| Mode | Score | Meaning |
| --- | --- | --- |
| **\|∫\| Magnitude** (default) | `∫|x| dt / T` | Every moment away from zero counts, left or right. |
| **∫ Net** | `|∫x dt| / T` | Left cancels right: you may wander, as long as the **signed area** balances to zero. Shows a live ∫x dt gauge and shades right area solid, left area hatched. |

Both in **u**, 2 decimals. Secondary stats: time within the band, zero crossings, worst excursion, RMS, mean push effort.

| Level | Duration | Force strength | Sudden changes | Band | Extra |
| --- | --- | --- | --- | --- | --- |
| Easy | 15 s | ×0.55 | 0 | ±3 u | none |
| Medium | 20 s | ×1 | 2 | ±2 u | none |
| Hard | 25 s | ×1.35 | 4 | ±1.5 u | Your push takes effect **180 ms late**; in Net mode the tally gauge is hidden. |

---

## 08 · Echo: rhythm and interval memory

- **Idea:** hear (and on lower levels see) a rhythm of pulses, then tap it back.
- **Input:** tap anywhere or `Space`. Your first tap starts your own clock.
- **Fairness:** only the **gaps between your own taps** are compared with the original gaps, so screen and audio latency cancel out.
- **Score:** mean absolute gap error in **ms**, integer. Secondary: tempo deviation %, and "shape" error (gaps rescaled so a uniformly faster or slower tempo is forgiven).

| Level | Pulses | Rhythm vocabulary (in beats) | Playback |
| --- | --- | --- | --- |
| Easy | 4 | 1 and 2 beats (beat 360–440 ms) | Played **twice**, with visual pulses. |
| Medium | 5 | ½, ¾, 1, 1½, 2 (beat 280–420 ms; total 0.9–2.6 s) | Once, visual pulses. |
| Hard | **9** (8 gaps) | Triplets (⅓, ⅔), ¼, ½, ¾, 1, 5⁄4, 3⁄2, **√2⁄2**, **1/φ ≈ 0.618**; must include a triplet, an irrational gap and a dotted value; ≥ 6 distinct values; **ritardando**: gap i is ×(1 + 0.04·i) (beat 390–470 ms; total 2.4–4.6 s) | Once, **sound only**, nothing drawn (falls back to visual if sound is off). |

**Two modes** (switch `▸` / `⏸` in the header; records kept separately; the daily uses Immediate):

| Mode | What changes |
| --- | --- |
| **▸ Immediate** (default) | As above. |
| **⏸ Rhythm memory** | The pattern gets a deliberate tempo change on top (accelerando or ritardando: gap i × (1 ± 0.06·i), seeded). After playback comes a **silent hold** (Easy 3 s, Medium 4 s, Hard 5 s) during which taps don't count and the heard pattern is hidden. The ground truth is the changed schedule. |

---

## 09 · Center: centre of mass

- **Idea:** place points anywhere **outside** a forbidden ring around the cross ✛. Their (weighted) average must land exactly on ✛. The last point must correct for all the others.
- **Input:** tap/click to place. Keyboard: arrow keys move a cursor (30 u/s), `Space`/`Enter` place.
- **Score:** distance from the weighted centroid Σwᵢpᵢ / Σwᵢ to ✛, in **u**, 1 decimal.
- **Reveal:** shows the centre of the earlier points, ✛ and the ideal last point on one line, with the lever ratio (e.g. 1 : 3).

| Level | Points (weights) | Forbidden ring radius | Help or handicap |
| --- | --- | --- | --- |
| Easy | 3 (×1 ×1 ×1) | 16 u | The running centre of the points so far is shown. |
| Medium | 4 (×1 ×1 ×1 ×1) | 20 u | none |
| Hard | 5 (**×1 ×2 ×1 ×3 ×1**) | 28 u | ✛ and its ring **disappear after your first point**. |

---

## 10 · Plumb: straightness

- **Idea:** draw one stroke from one dot to the other, as straight as you can.
- **Input:** one continuous pointer stroke, in either direction (A→B or B→A).
- **Validity:** the stroke must start and end within 8 u of the dots and cover at least 90% of the segment; otherwise it is rejected and not recorded.
- **Score:** only the part of the stroke whose projection lies between the dots is scored. The score is the length-weighted RMS of perpendicular distance to the true line, in **u**, 2 decimals. Secondary: widest deviation, bow (mean signed offset), segment covered, start miss, end miss, line length. Overshoot past a dot is ignored, but it shows up in the end miss.
- **Reveal:** the true line, perpendicular error spikes, the widest point, and a deviation profile from end to end.
- **Line:** 50–85 u long, inside the 100 u field.

| Level | Direction | Guide |
| --- | --- | --- |
| Easy | Near-horizontal, vertical or 45° | A faint guide stays while you draw. |
| Medium | Any direction | The guide vanishes when you start drawing. |
| Hard | Any direction | The guide **and the far dot** are shown for 1.2 s, then both vanish. You draw to a remembered point. |

---

## Precision, synchronisation, rhythm and illusions (11–15)

These five share one rule: **every round has a mathematically defined answer generated from explicit, seeded parameters, and the renderer is never the source of truth.** Illusions and decoys change what the player sees, never what is scored. Every attempt follows *present → observe → act → commit → reveal → next*; each reveal shows the true answer, your value and the exact error. Shared pieces: `src/core/controls.ts` (canvas sliders without numbers + a lock button; `↑ ↓` choose, `← →` adjust, `Shift` fine, `Enter` lock), `src/core/metronome.ts` (beat n = start + n·60000/BPM, clicks scheduled ahead on the audio clock from that schedule), `src/core/latency.ts` (tap-along calibration), `src/core/bias.ts` (personal bias profile).

**Slider ranges never leak the answer:** each slider's ends are randomised around the true value (typically 0.55–0.7× to 1.35–1.6×), and the starting position is at least 12% away from it.

### Latency calibration (False Beat, Perception on-the-beat)

Press `C` before a False Beat run (or *Calibrate latency* on its result). Twelve beats at 100 BPM; tap along. The signed errors of beats 3–12 give a **median** offset, accepted only with ≥ 5 taps, a spread (median absolute deviation) ≤ 45 ms and |offset| ≤ 300 ms. Stored per sound condition (heard clicks vs. seen flashes have different delays) and subtracted from every scored tap. It removes one stable systematic offset — audio output delay plus your own habit of tapping early or late — and does not claim to make browser timing physically perfect.

### Personal bias profile (Perception, Afterimage)

Every round's signed error is kept locally per challenge type (last 120). A bias is called **systematic** only with **≥ 8 samples** and a mean more than **two standard errors** from zero; otherwise the result says "no consistent direction" or "not enough data". Perception also reports mean |error| with vs. without surrounding context, and whether you are fooled *in the direction the illusion predicts* (for the illusions with a well-established direction).

---

## 11 · Phaseshift: synchronisation

- **Idea:** two hands circle their dials. Make yours (■) move *in step* with the reference (●) — same phase **and** same speed — then lock.
- **Model:** θ(t) = θ0 + ω·t, measured clockwise from each dial's **own** 0 mark (ω in °/s; periods 1.5–2.6 s).
- **Input:** grab your dial and turn it (it follows your finger while held, and continues from exactly where you let go); a **phase** slider; on Medium/Hard a **speed** slider. Changing speed keeps the hand continuous at that instant.
- **Score:** after the lock both keep running; the score is the **worst phase gap over the next 4 s**: max |wrap(d0 + Δω·τ)| for τ ∈ [0, 4 s], in **°**, 1 decimal, mean of 3 rounds. A speed error becomes a growing phase error, so a lucky moment of overlap cannot score well. Secondary: phase gap at the lock, speed error %, and whether each lock was **stable** or **temporary** (drifted ≥ 2° further in the window). The window is drawn as a chart of the true gap.

| Level | Controls | Deception |
| --- | --- | --- |
| Easy | Phase only (same speed). | none |
| Medium | Phase + speed (start ≥ 7% off). 70% of rounds stage a **brief coincidence** 1.2–2 s in: the hands meet although the speeds differ. | none |
| Hard | Phase + speed. | Your dial's 0 mark is **turned** 40–140° (false lead); **unequal trails** (95° vs 18°); the 0 marks **blink out** for 0.9 s of every 3 s. |

**Modes:** `◐ Sighted` (default) · `◌ Blind` — *combo A, Blind Synchronisation*: the reference hand vanishes after 6 / 5 / 4 s (Easy / Medium / Hard) and keeps running unseen; you must keep in step with what you remember. Scored identically.

## 12 · False Beat: rhythm through silence and decoys

- **Idea:** a 4-beat count-in (heard, and seen on a lamp), then **silence**. A block keeps sliding toward a line. Tap **once**, on the event the round asks for.
- **Schedule (generated before the round):** beat n = start + n·60000/BPM; target beat N = 3 + silent beats; the block moves x(t) = x0 + v·t and its crossing time is computed from that trajectory. Taps during the count-in are tapping along and are ignored.
- **Score:** |tap − offset − ideal| in **ms**, capped at 600 ms (a missing tap scores 600), mean over the rounds, integer. Signed errors (early −, late +), bias, and **whether you tracked the asked-for event** (closer to it than to the decoy) are reported. The latency calibration offset is subtracted.
- **Two questions, kept apart:** each round states its objective — *the beat* or *the crossing*. On Easy/Medium the crossing is exactly on the beat (both). On Hard they differ by 90–190 ms and the other one is the decoy.

| Level | Rounds · BPM | Silent beats | Deception |
| --- | --- | --- | --- |
| Easy | 4 · 84–104 | 2 | none — block in plain view |
| Medium | 4 · 90–120 | 3–4 | a **tunnel** hides the block before the line; the **background drifts** (induced motion) |
| Hard | 5 · 92–132 | 4–6 | objectives alternate beat / crossing (the other is offset); a **decoy flash** 70–150 ms off the target beat; **motion trails**; the block **changes shape** mid-way |

Sound off: the count-in is shown on the lamp only and calibration is stored separately for that condition.

## 13 · Intersect: meet at ✛, on time

- **Idea:** ● is already on a fixed trajectory through ✛ and passes it at time tA. Set ■'s **heading** and **speed**, then launch: both start together and must meet exactly at ✛.
- **Model:** p(t) = p0 + v·t for both (Phase-collision mode: ● on a circle). Contact = within 4.5 u.
- **Score:** **where ■ is when ● passes ✛**: |pB(tA) − ✛| in **u**, 1 decimal, mean of the final shots of 3 rounds. Zero only for the right place *and* the right time. Reported separately: **direction error** (how far ■'s path passes from ✛, u) and **timing error** (when ■ is nearest ✛ minus tA, ms); actual closest approach; **collision only if the objects truly came within contact distance** — a near miss is reported as "no collision, closest approach x u". After a shot with shots left, the hint states the single correction that would most improve the next one (turn x° clockwise/anticlockwise, y% faster/slower), computed from the true geometry.
- **Input:** drag the arrow's tip (direction = heading, length = speed); sliders; `Enter` launches.

| Level | Controls | Shots / round | Information |
| --- | --- | --- | --- |
| Easy | Speed only (■ is pre-aimed at ✛). | 2 | A ghost of ● loops along its path to show its pace. |
| Medium | Heading + speed. | 2 | Ghost preview. |
| Hard | Heading + speed. | **1** | **Rhythm round:** no preview of ●'s motion. A metronome plays; ● reaches ✛ exactly on beat 3 or 4 after launch (beats counted from the launch). |

**Modes:** `╱ Linear` (default) · `≋ Misleading` — *combo B, Misleading Intersection*: a drifting striped background, an oversized ● and motion trails distort the picture; trajectories and scoring are unchanged · `◯ Phase collision` — *combo E*: ● circles (period 2.6–3.6 s) and passes ✛ once per lap; hit it at ✛ on any lap. The score uses the pass that your launch comes closest to.

## 14 · Perception: real geometry under illusions

- **Idea:** five measurements per attempt, one of each type, in a seeded order. Adjust the lower/right object until it truly matches, then lock.
- **Engine:** each round is `{type, illusion, target, slider range, normalisation}`. The illusion is drawn from the same numbers the scorer uses, but the scorer only reads the true geometry.

| Type | What must match (and only this) | Illusion (Medium) | Illusion (Hard) | Normalised by |
| --- | --- | --- | --- | --- |
| Length | the shaft, **not** its arrowheads | Müller-Lyer fins (6.5 u) | longer fins (9 u), or **Ponzo** rails | reference length |
| Size | the disk's radius | Ebbinghaus circles (6 u) | bigger inducers (7.5 u) | reference radius |
| Gap | inner edge to inner edge | Oppel-Kundt fill (7 ticks) | denser fill (11) | reference gap |
| Angle | the opening between the rays | reference turned 35–75° | turned + Zöllner hatching | reference angle |
| Alignment | the right segment continues the left on one line | Poggendorff bar (11 u wide, slope 26–40°) | wider bar (16 u), shallower slope (18–28°) | bar width |

- **Score:** mean of |yours − true| ÷ normaliser, in **%**, 1 decimal. Easy has no illusions (your baseline). The reveal fades the context and overlays the true geometry with the signed error, and — for illusions with an established direction (Müller-Lyer, Ponzo, Ebbinghaus, Oppel-Kundt) — says whether you were pulled the way it predicts. Details show your bias profile per type.

**Modes:** `◇ Free` (default) · `♩ On the beat` — *combo C, Perfect on the Beat*: a metronome runs (76–96 BPM, also shown as a lamp). A lock only counts if it lands within ±150 / ±100 / ±70 ms of a beat (Easy / Medium / Hard), after the calibrated latency is removed; otherwise it is rejected and your setting kept. The geometry and the timing are measured independently: the score is the geometry; mean lock-timing error and rejected locks are reported.

## 15 · Afterimage: rebuild a signal from memory

- **Idea:** watch a signal for a fixed time; it disappears; rebuild it.
- **Signal:** a dot y(t) = A·sin(2πf·t + φ) of radius ρ on a fixed track (phase rounds replay every 1.5 cycles so the start is seen repeatedly), or a lamp blinking every P ms. Only the asked parameters differ from a familiar default (A 24 u, f 0.9 Hz, φ 0°, ρ 4.5 u, P 600 ms); you never rebuild something that wasn't shown.
- **Reconstruction:** sliders without numbers for amplitude, frequency, phase (start) and size — your signal runs live; the beat interval is **tapped** (≥ 5 taps; the mean of the last four gaps).
- **Score:** errors are **normalised before combining**: relative error for amplitude, frequency, size and interval; phase as a fraction of a full cycle (circular). A round's error is the mean of its parameters; the score is the mean over rounds in **%**, 1 decimal. After each lock the original and yours replay side by side with the parameter differences.

| Level | Parameters per round | Observe | Then |
| --- | --- | --- | --- |
| Easy | 1 of amplitude, frequency, size, interval (4 rounds) | 4 s | rebuild at once |
| Medium | 1, phase included (4 rounds) | 3 s | 2 s of nothing |
| Hard | 2: amplitude + frequency, frequency + phase, size + amplitude | 3 s | 3 s of a **look-alike** (each asked parameter 20–35% off, or the phase 70–130° off) labelled "not this one" |

*Combo D, Rhythm Memory*, is Echo's `⏸ Rhythm memory` mode (Echo already owned rhythm reproduction, so it was extended rather than duplicated).

---

## New experiments (16–18)

## 16 · Pour: volume, not height

- **Idea:** fill a strangely shaped tank to an exact fraction of its **volume**. Hold to pour at a constant rate, release to stop.
- **Model:** the tank is flat (uniform depth), so volume = area: V(h) = ∫₀ʰ w(y) dy (trapezoid integration, 600 slices). Shapes: cone, funnel, bulb, hourglass, flask; Hard tanks lean (a shear — area unchanged). The flow rate is set so a perfect continuous pour takes 2.8–4.4 s. Volume comes from your press/release timestamps.
- **Score:** |V ÷ capacity − target| in **percentage points of capacity**, 1 decimal, mean of 3 tanks. Overfilling to the brim is an overflow. The reveal draws the true target level, the "same fraction of the *height*" trap line, and hatches the difference.

| Level | Target | Shapes | Pours |
| --- | --- | --- | --- |
| Easy | ½ | cones and funnels | unlimited top-ups, then Done |
| Medium | ¼, ⅓, ½, ⅔ or ¾ | all five | 3 |
| Hard | 22–82% (to the percent) | all five, leaning | **1** — release ends it |

## 17 · Shadow: pursuit tracking

- **Idea:** a target drifts along a hidden smooth path; keep your pointer on it until the time is up.
- **Path:** p(t) = Σ₃ a·sin(ω·t + φ) independently in x and y (seeded; stays inside ±38 u).
- **Input:** press on the target to start; mouse movement counts while hovering, touch while the finger is down. Keyboard: `Space` starts a run with an arrow-key cursor (45 u/s, `Shift` 12 u/s), recorded separately (`~keyboard`).
- **Score:** distance sampled on a fixed **1/120 s grid** from your actual pointer positions (each held until the next sample), RMS in **u**, 2 decimals. Event rate and frame rate cannot change it. Secondary: mean distance, time within 3 u, worst second, and on Hard RMS while visible vs. hidden.

| Level | Duration | Speed | Extra |
| --- | --- | --- | --- |
| Easy | 15 s | slow (ω 0.35–0.9) | none |
| Medium | 18 s | faster (0.5–1.35) | none |
| Hard | 20 s | fastest (0.6–1.55) | the target **vanishes three times** for 0.9–1.3 s; you're still scored |

## 18 · Mirror: reflection

- **Idea:** tap where ● appears in the mirror line. Six rounds.
- **Model:** p' = 2·foot − p (foot = perpendicular foot on the line). Two mirrors compose to a rotation by twice the angle between them.
- **Input:** tap; or arrows move a cursor (30 u/s, `Shift` 6) and `Enter` places.
- **Score:** mean distance from your tap to the true image, in **u**, 1 decimal. One-mirror levels also split the error into along-the-mirror vs. across (distance) components.

| Level | Mirrors | Help |
| --- | --- | --- |
| Easy | 1, horizontal or vertical | faint 10 u grid |
| Medium | 1, any angle | none |
| Hard | **2** — reflect in mirror 1, then mirror 2 (never near-parallel) | the intermediate image is shown only in the reveal |

---

## Expansion 19–27: fluids, memory, keys, reasoning, estimation and physics

Design rule (the "Pour formula"): *intuitive action → hidden rule → measurable result → visual revelation → opportunity to improve.* Every round is generated from a seed; every generator that retries is tested to always deliver its full set of rounds; every reveal shows the true answer next to yours and explains the rule.

### Shared systems added with this expansion

| Piece | What it does |
| --- | --- |
| `core/materials.ts` | Subtle realism: liquid with a depth gradient and a meniscus highlight, glass walls with a thickness highlight, soft contact shadows, shaded solid blocks, spheres. Colours come from new theme tokens `--liquid`, `--liquid-deep`, `--glass`, `--shade` (light and dark). Used by Pour, Stop, and 19–27. |
| `core/settings.ts` | New persistent settings: `volume` (0–1, applied to the master gain), `noFlash`, `textSize` (`large` scales HTML and every canvas font ×1.2), `targets` (`large` scales slider knobs and hit zones ×1.6 — never scoring tolerances), `sensitivity` (keyboard adjust speed ½× / 1× / 2×). Older saves load with defaults; out-of-range values are clamped. UI: About → Settings. |
| `core/draw.ts` `beatLamp` | Beat lamps in False Beat, Perception (on the beat) and Intersect (rhythm): flash in the signal colour, or — with *no flashes* / reduced motion — a gentle glow. |
| `core/keymap.ts` | Letterfall lanes as physical keys (`KeyboardEvent.code`); labels for QWERTY / AZERTY / QWERTZ / Dvorak, detection via the Keyboard Map API where available, custom remaps; stored under `eps:keymap`. |
| Shell (`pages/play.ts`) | Shortcuts are ignored while typing in a text field (Esc leaves the field); `api.ownKeys(true)` lets an experiment own plain character keys while playing (Letterfall); the EXACT inversion respects *no flashes*; the help popover shows `steps` (all 29 games) and "How it is scored". |
| Records | Backup import now accepts record ids with a mode **and** an input condition (`letterfall~fast~touch`), which version 2 silently dropped. |
| `core/scoring.ts` | `revolveTable`, `volumeAt`, `equilibrium` (common surface, conservation, overflow at the lowest rim, raised floors), `flowStep` (conservative fixed-step pipe flow that never overshoots), `boxTank`. |

### 19 · Communicating Vessels

- Vessels: box / cone / funnel / bottle, uniform depth (volume = profile area); Hard floors ∈ {0, 0, 8, 14} u. Bottom pipes between neighbours, conductance K = 2.4 × the narrower mean width.
- Flow: `flowStep`, dt = 1/120 s, transfers k·(sₐ − s_b)·dt limited so a pair never passes its own equilibrium; overfull tanks spill. Predict rounds stop when every vessel is within 0.3 % of capacity of `equilibrium()` (or after 12 s) and are then scored against the exact equilibrium.
- Rounds: Easy 3 predict + 1 target (2 vessels); Medium 3 + 2 (3 vessels; 40 % of predict rounds include a short vessel → overflow); Hard 2 + 3 (raised floors). Target marks are generated between the vessel's start surface and its pair equilibrium with its highest neighbour (reachable by one valve).
- Score: |surface error| in u, mean. Done closes every valve first. Sandbox mode: hold on a vessel to pour (40 u²/s), never scored.

### 20 · Valve Engineer

- Rules: open valve i passes min(rateᵢ·dt, source volume) per step (dt = 1/60 s), processed in index order; any container above capacity spills (lost). Sandbox: root reservoirs refill.
- Networks: Easy 1 reservoir → 2 targets; Medium 2 reservoirs → junction → 3 targets (+ a bypass); Hard 2 reservoirs, 2 junction tanks (small), 4 targets, 8 valves, **14** operations. Goals = the result of a hidden plan with no spill (Hard: one route per target, ≤ 6 valves); each goal ≥ 20 u².
- Pause (Space) freezes simulated time; toggles while paused apply on resume. Hidden tab → auto-pause.
- Score: (Σ |V − goal| + spilled) ÷ Σ goals × 100.

### 21 · Verbatim

- Original passages (written for epsilon): 12 short, 10 medium, 6 long. Easy 3 × 6 s, Medium 2 × 12 s, Hard 1 × 25 s.
- Normalisation: whitespace collapsed; curly quotes → straight; en/em dashes and minus → "-"; "…" → "...". Case and punctuation count.
- Score: Levenshtein(original, typed) ÷ original length × 100. Word alignment (Levenshtein with backtrace; on ties a kept word + omission/insertion is preferred over substitutions) gives omissions, insertions, substitutions, case-only and punctuation-only slips. Spellcheck / autocorrect / autocapitalise are off. Time is not scored.
- Modes: `timed` (default), `delayed` (+6 s blank), `relaxed` (untimed viewing). Hidden tab while the passage or delay shows → void.

### 22 · Letterfall

- Notes on an eighth-note grid (Easy 90–104 BPM, 24 notes, 4 lanes; Medium 100–116, 36, 6; Hard 108–124, 48, 8 lanes, 25 % chords). Same-lane notes ≥ 320 ms apart, so the ±150 ms windows never overlap.
- Judging: each press takes the closest unhit note in its lane within ±150 ms; otherwise it is a stray (reported, not scored). Score = (Σ |error| of hits + 150 × misses) ÷ notes, ms. Bias = mean signed error (includes display delay).
- Fall time by mode: slow 2.3 s, normal 1.6 s, fast 1.1 s. Pause: the schedule shifts by the pause plus a 1 s lead-in. Blur / hidden tab → pause. Touch: tap lanes (recorded `~touch`).

### 23 · Rule Hunter

- Rules: rot90, rot180, flipH, flipV, transpose, shiftR, shiftD (wrapping), invert, inc3 (mod 3), oddCols (conditional), grow (4-neighbour dilation), gravity, life (B3/S23, wrapping), xorLR, and combinations. Families: Easy 7 rules / 5×5; Medium + 8 / 6×6; Hard + 5 / 7×7.
- Uniqueness: a puzzle is kept only if every candidate rule of the level (three-shade grids: three-shade rules only) that maps S₀→S₁ and S₁→S₂ also gives the same S₃; S₀≠S₁≠S₂≠S₃.
- Score: % of cells wrong, mean of 4.

### 24 · Difference Engine

- Figures: 7 / 9 / 11 points (≥ 13 u apart), each joined to 1–2 nearest neighbours; symmetry rounds use a mirror-symmetric figure. Change magnitudes scale ×1 / ×0.65 / ×0.42 by level (rotation 40° / 25° / 15°).
- Hit test: within 6 u of a changed point (×1.6 with large targets) or 4.5 u of a changed/removed edge (before or after). Kind: three choices (the true one + two of the level's kinds).
- Score: mean of {0, ½, 1} × 100. Flash: study 4 / 3 / 2.2 s, mask 0.6 s. Modes `relaxed`, `side`.

### 25 · Quantity Sense

- Two kinds: filled discs and hollow squares; counts Easy 10–30, Medium 20–60, Hard 40–110; shares 15–85 % (never within 6 points of 50 %). Sizes per group random (Hard: bigger group, smaller items). Non-overlapping placement.
- Score: |estimate − share| × 100 (points). Details: relative error = |e| ÷ share; ink share = disc area (π s²) ÷ total area; "closer to ink than count" per round.
- Exposure: 2.5 / 1.5 / 0.9 s; `static` mode keeps the items visible.

### 26 · Brake Point

- a = −G·sinθ − r₀ − c·v² − B·grip·(1 − 0.65·heat); G = 30 u/s², r₀ = 1.2 u/s², c ∈ [0.002, 0.006] (Medium/Hard), B = 52 (Hard 42–60) u/s², ice grip 0.3, heat +dt/2.2 s while braking, −dt/6 s otherwise (Hard). Terrain: heights every 10 u, linear between. Fixed step 0.5 ms; v never negative; stops hold.
- Generation: full braking from the start stops ≥ 8 u short, coasting ≥ 6 u past (or into the wall), and the ideal single-brake onset (bisection) lands within 0.05 u — hills can make the stop point jump, so tracks where that fails are rejected.
- Score: |stop − line| (wall: virtual stop with full braking on flat ground), mean of 3. Reveal: speed–position curve vs the ideal; diagnosis (early, late, ice, downhill, fade, released early).

### 27 · Pendulum Catch

- θ″ = −(g/L)·sin θ, g = 9.81 m/s², RK4 at 1 ms over 14 s; crossings by linear interpolation between samples. Exact period T = 4√(L/g)·K(sin(θ₀/2)), K via the arithmetic–geometric mean.
- Rounds (4): Easy L 0.8–1.6 m, 18–32°, mark at 0, either direction; Medium L 0.5–2.2 m, 40–70°, mark at ±(20–55 %)·θ₀, one direction; Hard 65–110°, mark behind a screen spanning ±0.45 rad.
- Score: |tap − nearest valid crossing after 0.25 s| in ms (cap 500; no catch in 12 s = 500). Reveal: θ(t) around the catch, exact vs small-angle period. Sandbox: L 0.3–2.5 m, 5–170°.

### 28 · Slipstream

- Tube R = 3 m; camera 3.2 m behind the ship, 1.15 m below the axis; draw distance 120 m. Fixed 1/240 s steps (frame dt capped at 50 ms). The course is generated lazily from the seed as a function of distance only.
- Ship half-width 0.1 rad; turn rate Easy 6.4, Medium 7.4, Hard 8.6 rad/s. Clearance = angular distance to the nearest wall edge − half-width. Clearance < 0 when a wall's front face reaches the ship ends the run (or breaks the shield). Walls beside the ship block the turn; rotors sweep it along.
- Speed: v0·(1 + 0.12·(gear − 1))·(1 + s/20000)·(1 + boost), gear = start + ⌊s / gearDist⌋ ≤ 9 (Easy 34 m/s, 500 m; Medium 46 m/s, 600 m; Hard starts in gear 2 at 60 m/s, 700 m). Launch ramp 0.8 s.
- Graze: clearance < 0.1 rad → boost += 0.045 + 0.01·min(chain, 6), capped at 0.35, decaying with τ = 1.5 s; grazes within 1.6 s chain. Clearance < 0.026 rad is PERFECT (the simulation runs at 0.35× real time for 0.28 s). Five grazes → a shield (at most one); a shielded hit removes the wall, resets boost and chain, and gives 0.6 s of pass-through.
- Pacing: 4 warm-up gates (gaps 2.3 → 1.45 rad, ×0.75 on Hard, 1.1 s apart; the first within ±1.2 rad of the ship), then patterns 0.7–0.85 s apart: gate, twin, blades, doors (each end 0.55 rad shorter until the last 45 m), zigzag (swing ≤ 0.6·ω·0.34 s), spiral (step 0.45·ω·0.17 s), rotor (0.2–0.3·ω), slalom (3 rails of 0.16 rad, 1.6 s long, blades every 0.32 s). No pattern starts within 1.8 s before a gear change. Tested: every consecutive pair of walls is reachable at full slipstream.
- Score: ⌊distance⌋ in m, **higher is better**; stars 700 / 1800 / 4000 m on every level. Instant retry: from the result, ← / → or a tap calls `api.again()`.

---

## Cognitive games 41–52

Twelve games built on one shared bench, `games/lab.ts`. Each game declares **variation families** (an id, a name, a one-line lesson, the difficulty bands it is offered at, a generator that returns only validated challenges, and a configuration signature). Every family's mechanics, success test and scoring are implemented; none is cosmetic.

| Piece | Contract |
| --- | --- |
| Scheduler (`chooseFamily`) | Eligible families for the current band; never the family just played when another is eligible; then the least frequent in the last 12 rounds, then the least recent; seeded choice among the best half. Tested to stay within ±20% of an even share over 500 picks. |
| History | Per game in `eps:var:<id>`: the last 30 family ids and 80 configuration signatures (gameplay-relevant content only — target cell, fold sequence, rule pair, gate wiring…). Recorded only when a challenge is presented. |
| Generation (`generate`) | Up to 40 seeded draws at the asked band avoiding recent signatures, then easier bands; if everything was seen recently the first valid draw is used. Never waits for a lucky configuration; a family that cannot generate is a bug (the tests sweep every family × band over many seeds). |
| Bands | 0 onboarding · 1 ordinary · 2 advanced · 3 mastery. Easy spans 0–2, Medium 2–3, Hard is mastery (3) throughout. After each round the band rises (penalty ≤ 0.15) or falls (≥ 0.6) within the level. A first session (and Easy) opens with the game's tutorial family at band 0; the last round is a mastery challenge on Hard, and on Medium for a player averaging under 0.2. |
| Teaching | The first time a family appears on a device its lesson is shown under the instruction (`eps:taught:<id>`). |
| Score | Mean round penalty (0 best … 1 worst) × 100, in %, lower is better; the result lists every round with its family, band and the specific reason. JND reports thresholds instead (below). Each round is scored once (`Session.done` ignores repeats) and the result is handed over once. |
| Cleanup | Every game owns its listeners through `Bench`; real-time games (Lag) step a fixed-timestep simulation from the frame clock, pause when the page is hidden, and stop when destroyed. A headless test plays each game with random input to a single result and checks it is silent after destroy. |

### 41 · Fovea
- Field 1.6 × 1 u, uniform scale. Low-detail field keeps position, size, tint; the lens (radius 0.21 → 0.135 u by band) shows gap direction (8 directions), centre dots, off-centre look-alike dots and clue text.
- Families: target search (with a coarse hint on bands 0–1), anomaly (same direction / towards the centre / chessboard dots; boundary-ambiguous rings excluded), clue search (2–3 cards; each clue alone ≥ 3 candidates, each pair ≥ 2), multi-target (2–4), compare (two panels; identical half the time).
- Validation: exactly the intended rings match; at least three rings share the target's size and tint. Penalty: wrong = 1; multi-target (misses + false marks) ÷ targets; otherwise 0.35 × lens travel ÷ raster-sweep length.

### 42 · Alias
- x(t) = A sin(2πft + φ), t_k = k/fs over 2 s; noise (bands 2–3) uniform within the drawn bars. Candidates fit when every sample is within the noise; a bare frequency fits when a least-squares sinusoid does — non-fitting options have RMS residual > 2× noise, which rules out any fit. Aliases (f ≡ ±f₀ mod fs) are always correct.
- Families: which signal (multi-select), resample (4 rates; ≥ 1 distinguishes the pair by ≥ 0.35, traps alias exactly), wagon wheel (apparent rate = wrap(n·f/fs)·fs/n, never within 0.06 of the ½-step ambiguity; inverse questions on bands 2–3), which frequencies, reconstruct (slowest fit ≤ fs/2; free amplitude on bands 2–3).
- Penalty: 0.4 per wrong or missed choice (cap 1); single answers 0/1; reconstruction RMS ≤ 6% → ≤ 0.15.

### 43 · Lag
- Fixed 1/120 s step; command acting = command recorded round(τ/step) steps earlier. τ ≈ 0.25 / 0.45 / 0.65 / 0.85 s by band (± 0.05). Ghost of the queued commands on band 0; queue hidden on band 3.
- Families: reach (ẋ = 0.5·u, settle 1.5 s in the ring), delayed brake (line beyond the shortest possible stop), steering (gates within the turning circle), stabilise (ẋ = λx + 1.5u + d(t), λτ ≤ 0.6), momentum (ẍ = 1.2u − cẋ, settle 1.5 s).
- Penalty: settling time against a delay-aware reference (≤ 0.6) + exits / overshoot; brake |error| ÷ 0.3 u; steering misses; stabilise time outside ±0.3 and RMS; loss of control 1 − ½·survived share.

### 44 · Fold
- Sheets N = 4 / 6 / 8 / 8 by band. A fold reflects cell centres across a crease on **any** grid line inside the folded sheet (off-centre folds from band 1: flaps overhang, stacks are uneven) or across a diagonal of a square folded sheet (last fold only). Lines keep their open-sheet numbers, even past the old edge. Holes = every cell in the punched fibre.
- Prediction: 1 fold (one-fold family) or 2 / 3 / 4 / 5 folds, 1 / 2 / 2 / 3 punches, at least one through several layers. Presentation: animated with replay (bands 0–1), animated once (band 2), written procedure plus the folded result only (band 3).
- Construction: up to 2 / 3 / 4 / 4 folds; the witness procedure must use fewer operations than there are holes. Fewest moves: exact minimum over every fold sequence and crease (searched below the witness, ≤ 3 folds).
- Families: one fold, several folds, construct, restricted directions, fewest moves. Penalty: (missing + extra holes) ÷ target holes (+0.05 per replay); fewest moves + 0.15 per extra operation.
### 45 · Last Look
- Regret per decision = better action value − chosen action value at that moment, under the optimal policy for what could be known: secretary win probabilities (best of N), W(k) = E[max(X, W(k+1) − c)] (known odds, cost), empirical distribution of examples + seen offers (unknown odds), current regime revealed two offers after a change (shift). The forced last offer has no regret.
- Penalty: Σ regret ÷ 15 points (value families) or ÷ the optimal win probability (best of N), capped at 1. Sequences without any offer above the 60th percentile are discarded.

### 46 · Checksum
- Codes: 2-D even parity; row/column counts with k flips (unique repair by brute force over k-subsets); Hamming(7,4)/(15,11) with even-parity groups (syndrome = position, 0 = intact from band 2); erasures (unique GF(2) solution, rank checked); erasures + one error (exactly one completion); digit sums (unique repair of 1–2 digits).
- Penalty: wrong cells ÷ cells needing repair; clean repairs pay 0.03 per undone edit and per check read beyond the deduction's need (Hamming: all groups; hidden grids: all but one row and column).

### 47 · Descent
- f = k|x − b|² + t·x − Σ dᵢ exp(−|x − cᵢ|²/2wᵢ²). Global minimum by grid + golden-section (1-D) or coordinate refinement (2-D); every other minimum ≥ 8% of the range higher and ≥ 0.12 away. The plot's floor sits a random 12–45% of the range below the minimum (no giveaway); 2-D readings are raw heights.
- Families: valley walk (reach 0.2 → 0.13, height + slope), plateau (slope only), noisy gauge (bounded noise, per-round stream), few queries, 2-D map. Penalty: within tolerance 0.15 × d/tol; otherwise 0.15 + 0.85·min(1, 3·gap + d).

### 48 · Projection
- Voxel structures in an n³ box, n = 3 / 4 / 4 / 5 by band; floor stacks on band 0, floating cubes (overhangs, bridges, cavities) above it, and always some positions the views allow but the target leaves empty. Silhouettes F(x, z), S(y, z), T(x, y) are computed; from band 2 one view (band 3: two) is given from the opposite side, mirrored left ↔ right.
- Built level by level. Feedback on your own silhouettes: match colours (bands 0–1), plain (band 2), hidden (band 3). Any structure meeting every constraint is accepted.
- Fewest cubes is exact: minimum cover of all view pixels by allowed cubes (each covers one pixel per view), branch and bound with the per-view uncovered-pixel bound; tested against brute force.
- Families: three views, missing view + cube count, fewest cubes (≥ 2 cubes saved from band 2), forbidden positions (allowed-but-empty cells), ambiguity (two structures with identical silhouettes; exactly one of four measurements separates them). Penalty: 0.45 + 0.55 × share of constraints failed; 0.15 per cube above the minimum.
### 49 · JND
- Three interleaved types per run (two on Easy) from length, size, tilt, gap, speed, contrast; 2-down/1-up staircases on a log scale (×1.5 until two reversals, then ×1.22), floor and ceiling per type; threshold = geometric mean of reversals after the first (≥ 3), else of the last four levels. Sides balanced per type, never 4 in a row; size, position, base angle, phase jittered. Hard shows stimuli for 0.75 s.
- Score: mean over types of threshold ÷ starting difference × 100; each type also reported in its own unit with a per-type device best (`eps:jnd:best`). Estimates within this game on this screen, not clinical measurements.

### 50 · Regime
- Symbols colour × shape → ← / →. Segments of 8–15 trials drawn per block (first ≥ 9); consecutive rules differ; every new segment has ≥ 3 trials where old and new rules disagree; symbols dealt in shuffled fours. Noisy blocks flip feedback on a stated 12–18% of trials; scoring uses the true rule.
- Delay after a change = trials to the first three correct in a row; slips = errors outside adaptation windows (after the first rule is learned). Penalty = 0.55 × mean clamp((delay − 2)/10) + 0.45 × min(1, 2.5 × slip rate). The reveal draws the timeline.

### 51 · Bifurcation
- Logistic and Ricker maps; period = smallest p ≤ 32 with |x_{n+p} − x_n| < 10⁻⁶ after 4000 iterations; chaotic only if no period and Lyapunov > 0.02. Windows from a 0.0025 grid (one-point artefacts next to a bifurcation ignored); edges by 40-step bisection with 30 000-iteration transients (tested: logistic 3 and 1 + √6, Ricker 2).
- Families: steady state at a level (r = 1/(1 − x*)), find a cycle (2; 3, 4, 8 on high bands), transition (tolerance 0.03 → 0.006), robust region (±δ), two starts (same fixed point / same cycle in step / out of step / diverge, decided by 5000 iterations). Penalty: wrong regime 1, distances scaled by tolerance, + 0.04 per experiment beyond 4 (or 3 reveals).

### 52 · Counterpoint
- Tokens alternate A, B through two-way gates into bins. A: arrow side, then flips the gate. B: opposite side, no flip. Links flip a second gate on any passage. Separate sources share at least one lower gate; Hard has a fixed gate.
- Every machine is brute-forced over all starting settings: ≥ 1 works, ≤ ⅓ work (½ on band 0 and for totals), and every working setting has a B passing a gate an A changed. Any working setting is accepted.
- Families: sequence, bottleneck (shared entrance, totals), cross-coupled (links), final state, two constraints, fewest changes (minimum Hamming distance from the shown start). Penalty: 0.15 per failed run (3 runs) + 0.12 per extra change; 1 if never met. Machines: 4–7 gates, 6–8 tokens (more through a shared entrance).

---

## Play screen (v4)

| Part | Contract |
| --- | --- |
| Top bar | Back, number chip and name, level + mode pickers centred (a padlock icon marks a locked Hard, replacing the strikethrough), run tools (seed, practice, sound, theme, help). |
| HUD strip | Above the stage: progress (`n / N` with N ≤ 12 becomes pips: done, current, to come), stars at this level with a meter of best ÷ next target (inverted for lower-is-better), the next target, and the best. |
| Verdict | On a result the strip shows the label, score, run stars and **Again** (click or Space). It is outside the canvas, so it can never cover a game's reveal; the full result stays in the panel. |
| Stage | A framed, rounded window; the instruction is unboxed text with a paper halo, so it never hides drawing under it. |
| Panel | Cards: result (accent bar: ink, signal for a new best or EXACT, a gradient when near), readouts, measure and run info, keys. |
| Game hooks | `api.best()` (best at this level and mode), `api.stars()` (this level's targets), `api.again()` (instant retry from the result). |
| Higher is better | `starsFor` / `nextStar` / goals / tutorial / unlock toast compare with ≥ (`starCmp`). The records layer is told each game's direction by the registry (`setBetterLookup`): the sanitizer and backup import keep the highest best for Slipstream instead of the lowest. |

---

## Progression, feel and variety (v3)

**Removed:** Halfway Is a Lie (overlapped Pour) and Steady Hand (overlapped Plumb and Shadow). Their sources are kept in `_removed/` and can be restored. The games are renumbered 01–27; ids, routes and records are unchanged.

| System | Contract |
| --- | --- |
| Stars (`core/progress.ts`) | Each game defines Medium targets `[★, ★★, ★★★]` in its unit (registry `STARS`). Level scale: Easy ×0.6, Medium ×1, Hard ×1.6 unless the game overrides it. A score earns the stars whose targets it meets, compared at the displayed precision. A level's rating comes from the stored ranked/daily best (default mode), so practice and challenge runs never earn stars and no data migration is needed. |
| Next goal | `nextStar(g, level, best)` returns the stars held and the score for the next one; shown in the panel and on the result. |
| Hard unlock | Hard is selectable once Medium has ★, or if Hard was ever played on this device. Practice and challenge links can always open Hard. A locked `?level=hard` falls back to Medium with a notice. |
| Streak | Consecutive local days with at least one run of any kind, ending today, or yesterday if nothing has been played yet today. |
| Round judgement (`api.judge(err, at?)`) | Tier of one round's error using the star targets: EXACT (0 at display precision), EXCELLENT (★★★), GREAT (★★), GOOD (★), OFF. GREAT or better extends the combo; anything lower resets it. A chime rises with the tier and the combo. Used by the 17 round-based games; Letterfall judges every note, and an unhit note counts as OFF. Purely feedback: never changes a score. |
| Result moment | Count-up of the value (instant with reduced motion), stars landing in turn with a tone each, "New ★" when the level rating rose, the next goal, and a notice when Hard unlocks. |
| Tutorial | First visit to a game (and *Show the tutorial* in help): animated demo (the home-page preview), steps, units and star targets, **Start** / **Practice first**. Closing it restarts the attempt so nothing timed ran behind it. |
| Variety modes | Separate records per mode; the default mode is the original game and the daily always uses it. **Zero · Weighted**: seeded weights with alternating signs, ×½ / ×2 (Hard also ×⅓ / ×3), at least one ≠ 1. **Exact · Mixed units**: notations deg / turn (fractions with denominators 2, 3, 4, 6, 8, 12, otherwise 3-decimal turns) / clock (hour hand, minutes rounded to 2, so at most ½° from the generated angle) / rad (2 decimals); the scored target is the exact angle of the notation. **Draw · Shapes**: regular triangle or square, circumradius 18–34 u (upright on Easy), signed distance with a point-in-polygon sign. **Mirror · Transforms**: odd rounds become rotations about a marked centre (Easy 90/180/270°, Medium multiples of 30°, Hard ±25–155°), with the image kept inside the field. |

---

## Records page

- **Precision Profile:** for each skill group, the median ± spread of the last 10 Medium ranked runs per game, with a trend arrow. A game shows "not enough data" until it has 5 ranked runs. Groups: Timing & rhythm (Zero, Echo, False Beat), Spatial estimation (Exact, Close the Loop, Center, Mirror), Motor control (Stop, Drift, Shadow), Drawing & shape memory (Draw, Plumb), Physical inference (Balance), Synchronisation & prediction (Phaseshift, Intersect, Pendulum Catch), Perception & memory (Perception, Afterimage, Quantity Sense, Difference Engine), Fluids (Pour, Communicating Vessels, Valve Engineer), Exact recall & keys (Verbatim, Letterfall), Reasoning (Rule Hunter), Stopping over terrain (Brake Point), Reflexes at speed (Slipstream). There is **no overall score**, because ms, degrees, u and % cannot be added together.
- **Every experiment:** best per level, run count, median ± spread, trend and history.
- **Run journal:** every attempt with date, game, level, mode, score, kind and seed, plus an optional note. Clicking a seed replays those conditions as a challenge.

---

## Quick reference

| No. | Game | Measures | Unit | Input | Hardest twist |
| --- | --- | --- | --- | --- | --- |
| 01 | Zero | signed time cancellation | s | hold | 6 holds, total never shown |
| 02 | Exact | angle | ° | drag / ← → | rotated dial, invisible needle |
| 03 | Close the Loop | vector closure | u | drag | scaled + rotated + mirrored pads, path vanishes |
| 04 | Draw | shape memory | u | draw | tilted ellipse seen 1.5 s |
| 05 | Stop | stopping point | u | hold | secret brake, fog |
| 06 | Balance | residual torque | % | drag / ← → | 3 hidden masses, 2 drops, no numbers |
| 07 | Drift | tracking error, \|∫\| or ∫ | u | drag / ← → | 180 ms control delay, 4 ambushes |
| 08 | Echo | interval memory | ms | tap | 9-pulse theme, irrational gaps, ritardando, sound only |
| 09 | Center | centre of mass | u | tap | weighted points, cross disappears |
| 10 | Plumb | straightness | u | draw | guide and far dot vanish after 1.2 s |
| 11 | Phaseshift | worst phase gap over 4 s | ° | drag / sliders | turned 0 mark, unequal trails, blinking marks |
| 12 | False Beat | tap timing | ms | tap | 6 silent beats, beat-or-crossing objective, decoy flash |
| 13 | Intersect | miss at the pass through ✛ | u | drag / sliders | one shot, no preview, meet on a beat |
| 14 | Perception | relative error | % | slider | strong illusions (Ponzo, Zöllner, wide Poggendorff bar) |
| 15 | Afterimage | normalised parameter error | % | sliders / tap | two parameters, a look-alike in the delay |
| 16 | Pour | fill error | % of capacity | hold | single pour, odd fraction, leaning tank |
| 17 | Shadow | RMS tracking distance | u | follow | target vanishes three times |
| 18 | Mirror | distance to the image | u | tap | two mirrors in sequence |
| 19 | Communicating Vessels | surface height error | u | drag / valves | raised floors, overflow |
| 20 | Valve Engineer | (Σ|V − goal| + spill) ÷ Σ goals | % | valves | 8 valves, 14 operations |
| 21 | Verbatim | character error rate | % | type | 50-word paragraph |
| 22 | Letterfall | mean |timing error| | ms | keys | 8 lanes with chords |
| 23 | Rule Hunter | cells wrong | % | tap | Life and XOR automata |
| 24 | Difference Engine | weighted miss rate | % | tap | rewiring, broken symmetry, 2.2 s |
| 25 | Quantity Sense | absolute share error | pts | slider | sizes set against the counts, 0.9 s |
| 26 | Brake Point | stopping error | u | hold | hills, ice, drag, brake fade |
| 27 | Pendulum Catch | catch timing error | ms | tap | 110° swings, mark behind a screen |
| 28 | Slipstream | distance before the crash (higher is better) | m | hold | gear 2 at 60 m/s, narrow gaps, hard bends |
| 41 | Fovea | wrong answers, then search length | % | pointer | small lens, look-alikes, three clues |
| 42 | Alias | wrong inferences about samples | % | tap / sliders | noise, inverse wagon wheel, free amplitude |
| 43 | Lag | settling, overshoot, control loss | % | keys / pad | 0.9 s delay, hidden queue |
| 44 | Fold | wrong holes, extra operations | % | tap | off-centre creases, five folds, written procedure only |
| 45 | Last Look | decision regret vs the optimal policy | % | keys | unknown odds, hidden change point |
| 46 | Checksum | wrong cells, wasted edits and reads | % | tap | hidden checks, 15-bit words |
| 47 | Descent | distance and gap to the global minimum | % | tap | noisy gauges, 2-D, tiny budgets |
| 48 | Projection | unmet views, extra cubes | % | tap | 5³ floating voxels, mirrored views, own views hidden |
| 49 | JND | mean threshold ÷ starting difference | % | ← → | 0.75 s exposure |
| 50 | Regime | adaptation delay and slips | % | ← → | three changes, lying feedback |
| 51 | Bifurcation | wrong regime, distance to edges | % | slider | period-3/8 windows, ±0.006 |
| 52 | Counterpoint | failed runs, extra changes | % | tap | six gates, links, fewest changes |

## Run it locally

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests (scoring, seeds, feasibility, storage)
npm run build   # typecheck + tests + production build in dist/
```

Direct links: `/e/<id>` (ids: `zero`, `exact`, `loop`, `draw`, `stop`, `balance`, `drift`, `echo`, `center`, `plumb`, `phase`, `beat`, `intersect`, `perception`, `afterimage`, `pour`, `shadow`, `mirror`, `vessels`, `valves`, `verbatim`, `letterfall`, `rules`, `diff`, `quantity`, `brake`, `pendulum`, `slipstream`). Optional query parameters: `?level=easy|hard`, `?mode=<id>` (Drift `net`; Echo `held`; Phaseshift `blind`; Intersect `mislead` / `orbit`; Perception `beat`; Vessels, Valves, Pendulum `sandbox`; Verbatim `delayed` / `relaxed`; Letterfall `slow` / `fast`; Difference Engine `relaxed` / `side`; Quantity `static`), `?seed=<base36>` (challenge), `?daily`. The daily pool stays frozen to the original nine.

Scoring math lives in `src/core/scoring.ts` (pure functions); every game exports its seeded generator (e.g. `makeTargets`, `makeBalance`, `makePlumb`) so tests can check determinism and feasibility. Tests are in `tests/`.
