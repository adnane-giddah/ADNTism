| 01 | [Zero](#01--zero)| 26 | [Brake Point](#26--brake-point)| 25 | [Quantity Sense](#25--quantity-sense)| 24 | [Difference Engine](#24--difference-engine)| 23 | [Rule Hunter](#23--rule-hunter)| 22 | [Letterfall](#22--letterfall)| 21 | [Verbatim](#21--verbatim)| 20 | [Valve Engineer](#20--valve-engineer)| 19 | [Communicating Vessels](#19--communicating-vessels)| 18 | [Mirror](#18--mirror)| 17 | [Shadow](#17--shadow)| 16 | [Pour](#16--pour)| 15 | [Afterimage](#15--afterimage)| 14 | [Perception](#14--perception)| 13 | [Intersect](#13--intersect)| 12 | [False Beat](#12--false-beat)| 11 | [Phaseshift](#11--phaseshift)| 10 | [Plumb](#10--plumb)| 09 | [Center](#09--center)| 08 | [Echo](#08--echo)| 07 | [Drift](#07--drift)| 06 | [Balance](#06--balance)| 05 | [Stop](#05--stop)| 04 | [Draw](#04--draw)| 03 | [Close the Loop](#03--close-the-loop)| 02 | [Exact](#02--exact)| 01 | [Zero](#01--zero)# ε epsilon — every game, explained

**epsilon** is a laboratory of very small errors: twenty-seven browser games (plus a calibration instrument on the home page) that measure how exactly you can time, aim, draw, balance, predict, remember and control things. Each one takes a few seconds to understand and much longer to master.

Your score is never "points". It is a real measurement — milliseconds, degrees, distance units, percent — and in **every game, lower is better**, because the score is your error.

---

## Contents

| No. | Game | What it measures | Unit | How you play |
| --- | --- | --- | --- | --- |
| 00 | [Calibration](#00--calibration) | duration control | s | hold |
| 01 | [Zero](#01--zero) | signed time cancellation | s | hold |
| 02 | [Exact](#02--exact) | angle | ° | drag / ← → |
| 03 | [Close the Loop](#03--close-the-loop) | vector closure | u | drag |
| 04 | [Draw](#04--draw) | shape memory | u | draw |
| 05 | [Stop](#05--stop) | stopping point | u | hold |
| 06 | [Balance](#06--balance) | hidden weights | % | drag / ← → |
| 07 | [Drift](#07--drift) | control of a noisy system | u | drag / ← → |
| 08 | [Echo](#08--echo) | rhythm and interval memory | ms | tap |
| 09 | [Center](#09--center) | centre of mass | u | tap |
| 10 | [Plumb](#10--plumb) | straightness | u | draw |
| 11 | [Phaseshift](#11--phaseshift) | synchronisation | ° | drag / sliders |
| 12 | [False Beat](#12--false-beat) | timing through silence | ms | tap |
| 13 | [Intersect](#13--intersect) | interception | u | drag / sliders |
| 14 | [Perception](#14--perception) | geometry under illusions | % | slider |
| 15 | [Afterimage](#15--afterimage) | signal memory | % | sliders / tap |
| 16 | [Pour](#16--pour) | volume estimation | % of capacity | hold |
| 17 | [Shadow](#17--shadow) | pursuit tracking | u | follow |
| 18 | [Mirror](#18--mirror) | reflection | u | tap |
| 19 | [Communicating Vessels](#19--communicating-vessels) | equilibrium | u | drag / valves |
| 20 | [Valve Engineer](#20--valve-engineer) | fluid routing | % | valves |
| 21 | [Verbatim](#21--verbatim) | exact recall | % | type |
| 22 | [Letterfall](#22--letterfall) | key timing | ms | keys |
| 23 | [Rule Hunter](#23--rule-hunter) | rule inference | % cells | tap |
| 24 | [Difference Engine](#24--difference-engine) | change detection | % | tap |
| 25 | [Quantity Sense](#25--quantity-sense) | ratio estimation | pts | slider |
| 26 | [Brake Point](#26--brake-point) | stopping over terrain | u | hold |
| 27 | [Pendulum Catch](#27--pendulum-catch) | interception timing | ms | tap |
| 28 | [Slipstream](#28--slipstream) | reaction at speed | m (higher is better) | hold |

---

## Rules that apply to every game

- **Lower is better.** The score is an error in a real unit.
- **u (units).** Spatial games use a field that is always 100 u wide, whatever your screen size, so a phone and a monitor are scored alike.
- **Time** comes from your input events' own high-resolution timestamps, never from timers or frame counts.
- **Levels.** Every game has **Easy / Medium / Hard** (keys `1` `2` `3`). Levels change the *rules* — what you can see, how many controls you have, what tries to fool you — not just the speed. Records are kept separately per level.
- **Modes.** Some games have scoring or rule variants (switch them in the header). Records are kept per mode too.
- **Seeds.** Every attempt is generated from a seed shown as `RUN XXXX`. The same seed always produces the same targets. Click it to copy a **challenge link** that replays exactly the same conditions for a friend.
- **Run kinds.** *Ranked* (fresh seed, counts for your bests), *Daily* (one shared game per day, Medium, three official tries), *Practice* (`P`, never ranked), *Challenge* (from a link, never ranked). Your very first attempt at any game is an unranked warm-up.
- **EXACT.** A score that rounds to exactly zero at the shown precision. The screen inverts and a bell rings. Deliberately rare.
- **Integrity.** Invalid scores are discarded. An interrupted touch never commits an answer. In time-critical games, hiding the tab mid-run voids the attempt.
- **Reveal.** After every attempt (and in many games after every round) you see the true answer, your answer and the exact error.
- **Keys everywhere:** `Space`/`Enter`/`R` another attempt · `R` restart · `Esc` back · `?` rules · `M` sound · `1` `2` `3` level · `P` practice.
- **Privacy.** No account, no server. Records live in your browser only, and work offline.

---

## 00 · Calibration

*The instrument on the home page.*

**Goal:** press and hold, and release at exactly the target duration.

**Targets, in order:** 1.000 s → 0.500 s → √2 ≈ 1.414 s → 1/φ ≈ 0.618 s → √3 ≈ 1.732 s → π/2 ≈ 1.571 s → 2.000 s → 0.250 s, then it repeats. Release within **±25 ms** and the next target unlocks.

**Feedback:** a 0–2.5 s ruler plus a ×12.5 magnifier around the target, and your personal tendency to over- or under-estimate each duration.

It measures how well you *produce* a length of time — not reaction speed — and it is never recorded as a game score.

---

## 01 · Zero

**Signed time, cancellation.** A series of blind holds whose durations alternately **add and subtract**. The running total must end at exactly zero.

**How to play:** press and hold anywhere (or `Space`), release to commit one hold. Each hold must last at least the minimum or it has to be redone.

**Score:** |Σ signᵢ · durationᵢ| in **seconds**, three decimals.

| Level | Holds | Minimum hold | What you see |
| --- | --- | --- | --- |
| Easy | 2: + − | 0.300 s | The bar grows live while you hold. |
| Medium | 4: + − + − | 0.300 s | Blind while holding; the total is shown between holds. |
| Hard | 6: + − + − + − | 0.400 s | Blind, and the total is **never shown**. You keep the sum in your head. |

**Modes:** `±` Plain (default) · `×` **Weighted**: each hold carries a weight shown beside it (×½ counts half, ×2 counts double; Hard adds ×⅓ and ×3). You still have to land on zero, so the holds must be timed in proportion.

---

## 02 · Exact

**Angle.** Turn a needle to a target angle on a dial with no numbers. 0° is at the dial's mark; angles go **clockwise**.

**How to play:** drag anywhere — the needle points at your finger or cursor — and release to lock. Keyboard: `←` `→` rotate (48°/s, `Shift` 6°/s), `Enter` locks.

**Score:** mean absolute angular error over all targets, in **degrees**, one decimal. Details show each target, your error and direction (cw/ccw), and your overall bias.

| Level | Targets | Help |
| --- | --- | --- |
| Easy | 5 multiples of 5° | Guide marks every 30°. |
| Medium | 5: one of 90/180/270, one of 45/135/225/315, two "odd" integers, one with .5 | Quadrant marks for the first two rounds, then only 0°. |
| Hard | 7, each with a decimal (e.g. 211.7°), never near a multiple of 45° | The whole dial is **turned** 25–335° every round, and the needle is **invisible while you aim** (keyboard users see it; those runs are recorded separately). |

**Modes:** `°` Degrees (default) · `⅜` **Mixed units**: the same angles, said differently. A fraction of a turn ("⅜ turn"), the hour hand of a clock ("1:30" is 45°), and on Hard radians ("2.39 rad") and decimal turns. Each notation is converted to the exact angle it means, and that angle is scored; the first time a notation appears, a one-line hint explains it.

---

## 03 · Close the Loop

**Vector closure.** A path of arrows wanders away from home (○). Draw the **one missing arrow** that brings it back. You draw it on a separate **pad**; it is then attached to the end of the path.

**How to play:** drag from the pad's centre and release to send. Keyboard: arrow keys move the tip, `Enter` sends.

**The twist:** the pad may be scaled, rotated or mirrored relative to the field. Your pad vector is un-mirrored, rotated back and scaled before it lands. The pad shows where the field's UP and RIGHT point.

**Score:** mean distance from your arrow's tip to home over 5 paths, in **u**, one decimal (plus a closure %).

| Level | Arrows per path | Pads |
| --- | --- | --- |
| Easy | 2, 2, 3, 3, 3 | Plain copies. |
| Medium | 2, 3, 4, 3, 3 | Round 4: a half-size pad (your arrow ×2). Round 5: pad turned 90°. |
| Hard | 5, 5, 6, 5, 6 | Every pad scaled **and** turned by odd angles; one is mirrored; the path **vanishes while you draw**. |

---

## 04 · Draw

**Shape memory.** Look at a shape, then draw it from memory in one continuous stroke, all the way round.

**How to play:** one pointer stroke (mouse, pen or finger). The stroke must sweep at least 330° around the centre and visit 90% of the angular sectors, so a short accurate arc can't pass as a full shape.

**Score:** length-weighted RMS distance between your stroke and the true outline, in **u**, two decimals. Details: average offset (outside +, inside −), closure gap, degrees swept.

| Level | Shape | Visibility |
| --- | --- | --- |
| Easy | Circle, radius 14–36 u | Stays faintly visible while you draw. |
| Medium | Circle, radius 14–36 u | Disappears the moment you start; the centre cross stays. |
| Hard | **Tilted ellipse** | Shown for **1.5 s** only, then the shape and its centre vanish. |

**Modes:** `◯` Curves (default) · `△` **Shapes**: squares and triangles. Easy shows them upright, Medium and Hard at a random turn, and Hard for 1.5 s only. The reveal marks the true corners.

---

## 05 · Stop

**Momentum.** A mass slides along a 100 u track toward a wall. Hold to brake (constant deceleration), release to coast. It must come to rest exactly on the target line.

**How to play:** the first tap launches; then hold / release (pointer or `Space`).

**Physics:** exact piecewise motion — coasting x = x₀ + v·t; braking x = x₀ + v·t − A·t²/2.

**Score:** |stop position − line| in **u**, one decimal. Hit the wall and the score uses where full braking *would* have stopped it. A phase plot (speed vs. position) shows your run against the ideal "coast, then one clean brake", and the result explains whether you braked early or late.

| Level | Brake | Launch speed | Extras |
| --- | --- | --- | --- |
| Easy | 60 u/s² | 30–42 u/s | A shadow shows where full braking would stop you. |
| Medium | 60 u/s² (learnable) | 38–62 u/s | none |
| Hard | **Secret**, 32–95 u/s², new every run | 56–74 u/s | The track's end is in **fog**; no speed readout. |

---

## 06 · Balance

**Inference of hidden weights.** A beam has hidden blocks on the left with **unknown masses** (block size says nothing about mass). Slide your weight on the right arm, drop it, read the tilt, adjust, drop again.

**How to play:** drag horizontally and release to drop. Keyboard: `←` `→` slide (`Shift` fine), `Enter` drops.

**Model:** the balance point is x* = Σ mᵢ·dᵢ; the tilt is 14° · tanh((x − x*) / S).

**Score:** residual imbalance of your **final** drop, |x − x*| / x* × 100, in **%**, one decimal. The hidden masses are revealed afterwards.

| Level | Hidden blocks | Drops | Response | Tilt readout |
| --- | --- | --- | --- | --- |
| Easy | 1 | 4 | almost linear | to 0.01° |
| Medium | 1 or 2 | 3 | moderate | shown |
| Hard | 2 or 3 | **2** | saturates early | **hidden** — only the beam's angle |

---

## 07 · Drift

**Controlling a noisy system.** Keep a dot on the zero line while an invisible, changing force pushes it. You control **acceleration, not position**.

**How to play:** press and drag sideways (a joystick relative to where you pressed), or `←` `→` (`Shift` = gentle). The run starts on your first press.

**Dynamics:** fixed 1/120 s steps, deterministic: v' = 42·u + f(t) − 0.55·v. The hidden force is a bias, three sine waves and sudden steps at hidden times. At the end it is drawn over your trace.

**Two scoring modes** (records kept separately):

| Mode | Score | Meaning |
| --- | --- | --- |
| `|∫|` Magnitude (default) | ∫|x| dt / T | Every moment away from zero counts. |
| `∫` Net | |∫x dt| / T | Left cancels right — wander as you like as long as the signed area balances. Shows a live tally gauge. |

Both in **u**, two decimals.

| Level | Duration | Force | Sudden changes | Extra |
| --- | --- | --- | --- | --- |
| Easy | 15 s | ×0.55 | 0 | wide band |
| Medium | 20 s | ×1 | 2 | — |
| Hard | 25 s | ×1.35 | 4 | your push arrives **180 ms late**; the Net gauge is hidden |

---

## 08 · Echo

**Rhythm and interval memory.** Hear (and on lower levels see) a rhythm, then tap it back.

**How to play:** tap anywhere or `Space`. Your first tap starts your own clock.

**Fairness:** only the **gaps between your own taps** are compared with the original gaps, so screen and audio latency cancel out.

**Score:** mean absolute gap error in **ms**. Details: every gap, your tempo deviation, and a "shape" error that forgives a uniformly faster or slower tempo. On the result you can hear the rhythm again.

| Level | Pulses | Rhythm | Playback |
| --- | --- | --- | --- |
| Easy | 4 | 1- and 2-beat gaps | Played **twice**, with visual pulses. |
| Medium | 5 | ½, ¾, 1, 1½, 2 beats | Once, visual pulses. |
| Hard | **9** | triplets, dotted notes, √2⁄2 and 1/φ gaps, a slowing tempo | Once, **sound only** (falls back to visual if sound is off). |

**Modes:**

| Mode | What changes |
| --- | --- |
| `▸` Immediate (default) | As above. |
| `⏸` **Rhythm memory** | The rhythm gets a deliberate tempo change (speeding up or slowing down 6% per note). Then **3–5 s of silence** with nothing on screen before you may tap. Reproduce the changed schedule from memory. |

---

## 09 · Center

**Centre of mass.** Place points anywhere **outside** a forbidden ring around the cross ✛. Their (weighted) average must land exactly on ✛ — the last point must correct for all the others.

**How to play:** tap to place. Keyboard: arrows move a cursor, `Space`/`Enter` places.

**Score:** distance from the weighted centroid to ✛, in **u**, one decimal. The reveal shows the centre of the earlier points, ✛ and the ideal last point on one line, with the lever ratio.

| Level | Points (weights) | Ring radius | Help or handicap |
| --- | --- | --- | --- |
| Easy | 3 (×1 ×1 ×1) | 16 u | The running centre is shown. |
| Medium | 4 (×1 ×1 ×1 ×1) | 20 u | none |
| Hard | 5 (**×1 ×2 ×1 ×3 ×1**) | 28 u | ✛ and its ring **disappear after your first point**. |

---

## 10 · Plumb

**Straightness.** Draw one stroke from one dot to the other, as straight as you can.

**How to play:** one continuous stroke, either direction. It must start and end within 8 u of the dots and cover 90% of the way, or it doesn't count.

**Score:** only the part between the dots is scored — length-weighted RMS perpendicular distance from the true line, in **u**, two decimals. Details: widest deviation, bow, coverage, start/end miss. The reveal draws error spikes and a deviation profile.

| Level | Direction | Guide |
| --- | --- | --- |
| Easy | near-horizontal, vertical or 45° | A faint guide stays while you draw. |
| Medium | any | The guide vanishes when you start. |
| Hard | any | The guide **and the far dot** show for 1.2 s, then vanish. You draw to a remembered point. |

---

## 11 · Phaseshift

**Synchronisation.** Two hands circle their dials. Make yours (■) move **in step** with the reference (●) — same position *and* same speed — then lock. One moment of overlap is not enough.

**How to play:** grab your dial and turn it (the hand follows your finger and carries on from where you let go), or use the **phase** slider; on Medium and Hard there is also a **speed** slider. `↑ ↓` choose a slider, `← →` adjust (`Shift` fine), `Enter` or the **Lock** button locks. Three rounds.

**Model:** each hand is θ(t) = θ0 + ω·t, measured clockwise from its **own** 0 mark.

**Score:** after you lock, both hands keep running for **4 seconds**; your score is the **worst gap between them in that window**, in **degrees**, averaged over three rounds. A speed error turns into a growing gap, so a lucky overlap scores badly. Each lock is labelled *stable* or *temporary*, and a chart shows the true gap over the window. Details: phase error at the lock and speed error in %.

| Level | Controls | What tries to fool you |
| --- | --- | --- |
| Easy | phase only (speeds are equal) | nothing |
| Medium | phase + speed | the hands often **meet for a moment** although their speeds differ |
| Hard | phase + speed | your dial's 0 mark is **turned**, the trails are **unequal**, and the 0 marks **blink out** |

**Modes:** `◐` Sighted (default) · `◌` **Blind** — the reference hand vanishes after a few seconds (6 / 5 / 4 s) and keeps running unseen. Keep in step with what you remember.

---

## 12 · False Beat

**Timing through silence and decoys.** A count-in of four clicks sets the tempo. Then the clicks **stop**. A block keeps sliding toward a line. Tap **once** — on the beat the round asks for, or, when the round says so, at the moment the block crosses the line.

**How to play:** tap anywhere, `Space` or `Enter`. Taps during the count-in are just tapping along and don't count. Press **`C`** before a run to **calibrate your latency**: tap along with twelve beats and epsilon measures your steady offset (audio delay plus your own habit of tapping early or late) and removes it from every tap. It only accepts a steady calibration, and stores it separately for sound on and sound off.

**Ground truth:** beat n = start + n·60/BPM, scheduled before the round; the crossing comes from the block's trajectory, not from what the screen shows.

**Score:** mean |your tap − the ideal moment| in **ms** (a missing or wild tap counts as 600 ms). Details: every round early/late, your overall bias ("you anticipate" / "you lag"), and how often you followed the right event instead of the decoy.

| Level | Rounds | Silent beats | What tries to fool you |
| --- | --- | --- | --- |
| Easy | 4 | 2 | nothing — the block crosses exactly on the beat, in plain view |
| Medium | 4 | 3–4 | a **tunnel** hides the block before the line; the **background drifts** |
| Hard | 5 | 4–6 | rounds alternate between *the beat* and *the crossing* — the other is a decoy, 90–190 ms away; a **fake flash** in the silence; motion trails; the block **changes shape** |

---

## 13 · Intersect

**Interception.** Object ● is already on its way along a fixed path through the target ✛. Launch ■ so that the two **meet exactly at ✛, at the same instant**.

**How to play:** set ■'s **heading** and **speed** by dragging the arrow (direction = heading, length = speed) or with the sliders, then press **Launch** (`Enter`). Both objects start together. Three rounds.

**Score:** **where ■ is at the moment ● passes ✛**, in **u** — zero only for the right place *and* the right time. Shown separately: the **direction error** (how far ■'s path passes from ✛) and the **timing error** (how early or late ■ reaches ✛, in ms). A collision is only reported if the objects truly touched; otherwise you see "no collision" and the closest approach. After a shot with tries left, a hint tells you the single best correction (e.g. "turn 4.2° clockwise, 12% faster").

| Level | You control | Shots per round | Information |
| --- | --- | --- | --- |
| Easy | speed only (■ is pre-aimed at ✛) | 2 | a ghost of ● loops along its path to show its pace |
| Medium | heading + speed | 2 | ghost preview |
| Hard | heading + speed | **1** | **no preview**: a metronome plays, and ● reaches ✛ exactly on beat 3 or 4 after launch — feel the tempo |

**Modes:**

| Mode | What changes |
| --- | --- |
| `╱` Linear (default) | Straight, honest paths. |
| `≋` **Misleading** | A drifting striped background, an oversized ● and motion trails distort the picture. The paths and the score are unchanged. |
| `◯` **Phase collision** | ● circles and passes ✛ once per lap. Hit it at ✛ on any lap — position and phase must agree. |

---

## 14 · Perception

**Real geometry under optical illusions.** Five measurements per attempt — one of each type below. Adjust the lower (or right) object until it *truly* matches the reference, then **Lock**. Illusions change how things look, never how they are scored.

**How to play:** drag the slider (or `← →`, `Shift` fine), then `Enter` or **Lock**. Tap for the next measurement.

| Type | What must match — and only this | Medium illusion | Hard illusion |
| --- | --- | --- | --- |
| Length | the line itself, **not** its arrowheads | Müller-Lyer arrowheads | longer arrowheads, or Ponzo converging rails |
| Size | the disk's radius | Ebbinghaus surrounding circles | bigger surrounding circles |
| Gap | the empty space, edge to edge | Oppel-Kundt filled space | denser fill |
| Angle | the opening between the two rays | the reference is turned | turned + Zöllner hatching |
| Alignment | the right segment continues the left one on one straight line | Poggendorff occluding bar | wider bar, shallower slope |

Easy has **no illusions** — it is your baseline.

**Score:** mean relative error |yours − true| ÷ reference size (for alignment, ÷ the bar's width), in **%**. The reveal fades the illusion away and overlays the true geometry with your signed error; for the classic illusions it tells you whether you were pulled the way the illusion predicts or saw through it.

**Personal bias profile:** epsilon keeps your signed errors per type on this device and tells you, for example, "you set lengths too big by 4.1% — systematic". It only says that after **8+ rounds** with consistent evidence; otherwise "not enough data" or "no consistent direction". It also compares your accuracy with and without surrounding context.

**Modes:** `◇` Free (default) · `♩` **On the beat** — a metronome runs, and a lock only counts if it lands within ±150 / ±100 / ±70 ms of a beat (Easy / Medium / Hard). Geometry and timing are measured separately; the score is still the geometry.

---

## 15 · Afterimage

**Signal memory.** A dot bobs up and down (or a lamp blinks) for a few seconds. Then it's gone. Rebuild it from memory.

**What can be asked:** the dot's **amplitude** (how high it swings), **frequency** (how fast), **phase** (where it starts and which way it moves), **size**, or the lamp's **beat interval**. Only the asked parameters change between rounds; everything else stays at a familiar default, so you never have to rebuild something you weren't shown.

**How to play:** press to watch. Afterwards use the sliders — your own signal runs live as you adjust — or, for the beat interval, **tap** the beat at least five times. Then **Lock**. After each lock, the original and your version replay side by side with the differences.

**Score:** errors are made comparable before they are combined — relative error for amplitude, frequency, size and interval; phase as a fraction of a full cycle. The score is the mean in **%**. Over time you also get a profile: e.g. "your amplitude memory exaggerates by 6%".

| Level | Per round | Watch | Then |
| --- | --- | --- | --- |
| Easy | 1 parameter (amplitude, frequency, size or interval) | 4 s | rebuild immediately |
| Medium | 1 parameter, phase included | 3 s | 2 s of nothing |
| Hard | **2 parameters at once** | 3 s | 3 s of a **look-alike** signal that is *not* the one — to overwrite your memory |

---

## 16 · Pour

**Volume, not height.** Fill a strangely shaped tank to an exact fraction of its **volume**. Half the volume is almost never half the height — the walls decide.

**How to play:** hold anywhere (or `Space`) to pour at a constant rate, release to stop. Press **Done** (`Enter`) when you're satisfied. Three tanks.

**Model:** the tank is flat, so its volume is its area: V(h) = ∫ w(y) dy. The amount poured comes straight from how long you held.

**Score:** |your volume ÷ capacity − target| in **percentage points of capacity**. The reveal draws the true target level, the tempting "same fraction of the height" line, and hatches the difference. Details show whether you tend to overfill or underfill.

| Level | Target | Tanks | Pours |
| --- | --- | --- | --- |
| Easy | ½ | cones and funnels | top up as often as you like |
| Medium | ¼, ⅓, ½, ⅔ or ¾ | cones, funnels, bulbs, hourglasses, flasks | 3 |
| Hard | odd fractions like 37% | all shapes, **leaning** | **1** — release ends it |

---

## 17 · Shadow

**Pursuit tracking.** A dot drifts along a hidden, smooth, ever-changing path. Stay on it until the time runs out.

**How to play:** press on the dot to start. With a mouse, just follow it; on touch, keep your finger down. Keyboard: `Space` starts a run with an arrow-key cursor (recorded separately).

**Score:** your distance from the dot is sampled **120 times a second** on a fixed clock from your actual pointer positions, so frame rate and event rate can't change it. Score = RMS distance in **u**. Details: mean distance, % of time within 3 u, your worst second, and on Hard your error while the dot was visible vs. hidden. The reveal draws both paths and your distance over time.

| Level | Duration | Speed | Extra |
| --- | --- | --- | --- |
| Easy | 15 s | slow and smooth | — |
| Medium | 18 s | faster, more turns | — |
| Hard | 20 s | fastest | the dot **vanishes three times** for about a second — keep following where it would be |

---

## 18 · Mirror

**Reflection.** A point ● and a mirror line. Tap exactly where its reflection appears. Six rounds.

**How to play:** tap; or move a cursor with the arrow keys (`Shift` fine) and press `Enter`.

**Model:** the image lies on the perpendicular through ●, exactly as far behind the mirror as ● is in front of it.

**Score:** mean distance from your tap to the true image, in **u**. On one-mirror levels, details split your error into *along the mirror* and *across it*.

| Level | Mirrors | Help |
| --- | --- | --- |
| Easy | 1, horizontal or vertical | a faint grid |
| Medium | 1, at any angle | none |
| Hard | **2** — reflect in mirror 1, then reflect that in mirror 2 (secretly a rotation) | the in-between image appears only in the reveal |

**Modes:** `⫽` Reflections (default) · `↻` **Transforms**: reflections alternate with rotations ("turn ● 90° clockwise around ✛"). Easy uses quarter and half turns, Medium multiples of 30°, Hard any angle from 25° to 155°. A rotation keeps the distance to ✛, and the reveal draws both radii.

---

## 19 · Communicating Vessels

**Surfaces level out; volumes don't.** Vessels of different shapes stand side by side, joined at the bottom by pipes with valves.

**How to play:**
- *Predict rounds:* drag the dashed line to where the shared surface will settle, then **Open all** and watch the liquid flow.
- *Target rounds:* tap a valve (or `Q` / `W`) to open or close it; press **Done** when the marked vessel reaches its mark.

**The rule:** connected free surfaces settle at one height, and the total volume is conserved. If that height would rise above the lowest rim, the shortest vessel overflows and the excess is lost. The flow is a real step-by-step simulation, and it always ends exactly at that equilibrium.

**Score:** height error of the surface in **u**. The reveal shows the true level and the volume in each vessel, which are usually very different.

| Level | Setup |
| --- | --- |
| Easy | two vessels; three predictions, one target |
| Medium | three vessels, bottle shapes, sometimes a short one that overflows |
| Hard | three vessels standing on different floors; more valve work |

**Modes:** `◎` Challenge · `∿` **Sandbox**: open valves and pour in freely (hold on a vessel); nothing is scored.

---

## 20 · Valve Engineer

**Plan the flow.** Reservoirs, junction tanks, pipes and valves. Fill every target container to its mark exactly, and spill nothing.

**How to play:** tap a valve or press its key (`A` `S` `D` `F` `G` `H` `J` `K`) to open or close it. Each valve shows its rate (u² per second). **`Space` pauses** so you can plan; changes made while paused apply on resume. Press **Done** to close everything and measure.

**The rules:** an open valve passes its rate while its source holds liquid; a container filled past its rim spills, and that is lost; nothing else is created or destroyed. Every puzzle is built from a hidden plan that works, so it is always solvable.

**Score:** (Σ |volume − goal| + spilled) ÷ Σ goals, in **%**.

| Level | Network |
| --- | --- |
| Easy | one reservoir, two targets, two valves |
| Medium | two reservoirs, a junction tank, alternative paths |
| Hard | eight valves, small junction tanks that overflow easily, mixed rates, and at most **14 valve operations** |

**Modes:** `◎` Precision · `∿` **Sandbox**: sources never run dry; nothing is scored.

---

## 21 · Verbatim

**Exact recall.** Read a passage. It disappears. Write it back, word for word and comma for comma.

**How to play:** press to read. When it vanishes, type it into the box and press `Enter`. While you type, letters and digits go into the box; no shortcut fires. `Esc` leaves the box.

**The rules (shown before every round):** capitals and punctuation count; extra spaces and curly-vs-straight quotes don't; time is never scored. This is a recall test, not a typing test.

**Score:** **character error rate**, the edit distance ÷ the passage length, in %. Details: word accuracy, words left out, words added, words changed (and how many of those were only capitals or punctuation). The reveal shows the original with every word marked as kept, struck out (left out or replaced), underlined (what you wrote instead) or `[+added]`.

| Level | Passages |
| --- | --- |
| Easy | three short sentences, 6 s each |
| Medium | two two-clause passages, 12 s each |
| Hard | one paragraph of about 50 words, 25 s |

**Modes:** `⏱` Timed · `⏸` **Delayed** (6 s of nothing before you write) · `∞` **Relaxed** (read as long as you like; untimed).

---

## 22 · Letterfall

**Keys on the line.** Keycaps fall down lanes toward a line. Press each key the moment it lands.

**Before you start:** `←` `→` choose your keyboard layout (**QWERTY, AZERTY, QWERTZ, Dvorak**, or **Auto**, detected from your keyboard where the browser allows; it is never guessed from your language). `↓` lets you **remap** the eight lanes to any keys you like. The labels on screen always show the real mapping.

**How to play:** `Space` starts. Press lane keys as keys cross the line. Hard adds chords (two keys at once). **`Space` pauses**; the song resumes after a one-second lead-in. On touch screens, tap the lanes.

**Score:** mean |timing error| per note in **ms** (a missed note counts as the full 150 ms window). Details: hits, misses, notes within ±30 ms, stray presses (counted, not scored), and your **bias**, the average early or late. Timing comes from input timestamps (about 1 ms resolution) and includes your display's constant delay, which is why the bias is shown separately.

| Level | Lanes | Keys | Extra |
| --- | --- | --- | --- |
| Easy | 4 (D F J K) | 24 | steady |
| Medium | 6 | 36 | syncopation |
| Hard | 8 | 48 | chords |

**Modes (speed):** `▸` Normal (1.6 s fall) · `▹` Slow (2.3 s) · `▸▸` Fast (1.1 s).

---

## 23 · Rule Hunter

**Find the hidden rule.** Three grids, S₀ → S₁ → S₂. The same rule turns each into the next. Build S₃.

**How to play:** tap cells on the big grid to cycle them (empty ↔ filled, or empty → grey → black). `C` copies S₂ as a starting point; arrow keys and `Space` work too. **Submit** (`Enter`).

**Rules you may meet:** rotations, reflections, wrapping shifts, inversion, adding one modulo 3, invert-every-second-column, growth into neighbours, gravity, two-step combinations, and on Hard the Game of Life and an XOR automaton.

**Fairness:** every puzzle is checked so that every rule of that level that fits the examples predicts the same S₃. There is never a second valid answer.

**Score:** share of cells wrong, in **%**. The reveal names the rule, explains it, marks every wrong cell with ✕ and shows the true S₃.

| Level | Grid | Rule families |
| --- | --- | --- |
| Easy | 5×5 | rotations, reflections, shifts, inversion |
| Medium | 6×6 | + modulo-3, conditional, neighbour, gravity, combinations |
| Hard | 7×7 | + Game of Life, XOR |

---

## 24 · Difference Engine

**Spot the structural change.** Study a constellation of points and connections. After a brief mask it returns with exactly one change. Tap where it changed, then choose what kind of change it was.

**Possible changes:** a point moved · a connection appeared · a connection vanished · a triangle turned · an edge got longer or shorter · a connection was rewired to another point (a topology change) · the mirror symmetry broke.

**Score:** per round, 0 if place and kind are both right, ½ if only the place is right, 1 if the place is wrong. The score is the mean, in **%**. The reveal overlays before and after, circles the change and explains the property that changed. It measures change detection on this task only; nothing tracks your eyes.

| Level | Points | Study time | Changes |
| --- | --- | --- | --- |
| Easy | 7 | 4 s | moves, added and removed connections |
| Medium | 9 | 3 s | + rotations, stretched edges |
| Hard | 11 | 2.2 s | + rewiring, broken symmetry, smaller changes |

**Modes:** `⚡` Flash · `∞` **Relaxed** (study as long as you like) · `◫` **Side by side** (a static alternative: before and after shown together).

---

## 25 · Quantity Sense

**Count, not ink.** A crowd of ● and □. What share of all the items are ●? Answer on a 0–100% gauge.

**How to play:** press to look; set the gauge (`←` `→`, `Shift` fine); **Lock**. Six rounds.

**The trap:** each group has its own item size. On Hard the bigger group has the smaller items, so judging by how much area each kind covers leads you astray.

**Score:** absolute error in **percentage points**. Details: the **relative error** (error ÷ true share, which is harsher on small shares), your bias, and how many times your answer sat closer to the *ink* share than to the *count* share. The reveal puts the count, the ink and your answer on one bar.

| Level | Items | Look | Arrangement |
| --- | --- | --- | --- |
| Easy | 10–30 | 2.5 s | two separate groups |
| Medium | 20–60 | 1.5 s | mixed |
| Hard | 40–110 | 0.9 s | mixed, sizes set against the counts |

**Modes:** `⚡` Flash · `▣` **Static** (the items stay while you answer).

---

## 26 · Brake Point

**Stopping on real terrain.** Like Stop, but the ground is part of the puzzle: hills push the object forward or hold it back, **ice** leaves the brake only 30% of its grip, air drag grows with speed², and on Hard the **brake fades** as it heats up.

**How to play:** tap (or `Space`) to launch; hold to brake, release to coast. Stop on the line. Three tracks.

**Physics:** a = −G·sin(slope) − rolling resistance − c·v² − brake·grip·(1 − fade), integrated in fixed 0.5 ms steps from your press and release times, so the frame rate doesn't matter. When it stops, the parking brake holds it.

**Score:** distance from the line in **u** (into the wall: where full braking would have stopped it). The reveal shows your speed curve (coasting in ink, braking in signal colour) against the **ideal single brake**, and names the main reason: braked early or late, braked on ice, the downhill fed it speed, or the brake faded. Every track is checked to be solvable with one clean brake.

| Level | Terrain |
| --- | --- |
| Easy | flat, one ice patch, no drag |
| Medium | hills, one or two ice patches, drag |
| Hard | steeper hills, ice, drag, and brake fade (a heat gauge shows it) |

---

## 27 · Pendulum Catch

**A real pendulum.** Release the bob, then tap the instant it crosses the mark, moving the way the arrow says. Four swings.

**Physics:** θ″ = −(g/L)·sin θ, solved accurately (RK4 at 1 ms). The true period is 4·√(L/g)·K(sin(θ₀/2)). The familiar 2π√(L/g) is only a small-angle approximation, and every reveal tells you how far off it is at that amplitude (about 18% at 90°).

**Score:** |your tap − the true crossing| in **ms** (500 if missed), with the angle error too. The reveal plots the angle over time around your catch.

| Level | Swing | Mark |
| --- | --- | --- |
| Easy | gentle, 18–32° | at the bottom, either direction |
| Medium | wide, 40–70° | off-centre, one direction |
| Hard | huge, 65–110° | **behind a frosted screen**: predict it |

**Modes:** `◎` Catch · `∿` **Sandbox**: change the length and release angle and compare the exact and small-angle periods live; nothing is scored. With reduced motion, the decorative motion trail is off.

## 28 · Slipstream

**Full speed down a tube.** Hold ← or → (A / D, or the left / right half of the screen) to steer round the tube's wall. Rings, blades and lanes rush at you: be in a gap when each one arrives. A wall beside you only blocks your turn; a wall in front ends the run.

**Slipstream:** pass within 6° of an edge (a **graze**) and its slipstream pulls you faster: more distance, less time to react. Grazes in quick succession chain (×n). A graze under 1.5° is **PERFECT**, and time slows for a moment. **Five grazes charge a shield**: the next wall you hit shatters instead of you, and you pass through for 0.6 s (your slipstream is lost).

**Reading the tube:** the next two walls show their way through as a glowing floor. Your **aim line** runs ahead of the ship and turns red, with the wall's face, while you are lined up to hit it. Gates in the tube mark each **gear change**, your **star distances** and your **best**.

**Score:** distance before the crash, in **m**. **Higher is better** (the only game where it is). Stars on every level: ★ 700 m · ★★ 1800 m · ★★★ 4000 m.

| Level | Start | What changes |
| --- | --- | --- |
| Easy | 34 m/s, a new gear every 500 m | wide gaps, gentle bends |
| Medium | 46 m/s, a new gear every 600 m | spirals and rotors from gear 3, slalom lanes from gear 4 |
| Hard | gear 2 at 60 m/s, a new gear every 700 m | narrower gaps, harder bends, quicker turns |

**Patterns:** gates, twin gaps, blades, zigzags, corkscrew spirals, rotors (gaps that turn), closing **doors** (wide far away, closing as they come) and slalom lanes (three rails with blades alternating inside). Every run opens with four wide, slow gates, and the tube clears before every gear change. The music's tempo and the tube's colour change with the gear.

**Instant retry:** from the result, ← / → or a tap starts the next run at once. The course comes from the seed, so a challenge link replays the same tube, and a fairness test checks that no turn ever asks more than the ship can do, even at full slipstream.

---

## Stars, streaks and how it feels

- **Stars.** Every game has three targets per level: ★ is a decent first attempt, ★★ is good, ★★★ is mastery. They are in the game's own unit (for example Exact Medium: ★ ≤ 6°, ★★ ≤ 3°, ★★★ ≤ 1.2°). Easy asks for more, Hard forgives more. Slipstream is the exception: its targets are distances (★ ≥ 700 m), the same on every level. Your stars come from your best ranked run at each level, so practice and challenge runs never earn them. The side panel always shows your stars at this level and the score for the next one.
- **Hard unlocks with ★ on Medium.** If you have already played Hard, it stays open. **Practice** (`P`) can always try Hard, and challenge links always open their level.
- **Home page:** stars per game (E / M / H), your total, and your **streak**: consecutive days with at least one run.
- **Round judgements.** In every game made of rounds, each round is judged **EXACT · EXCELLENT · GREAT · GOOD · OFF** (on the same targets as the stars). Consecutive GREAT-or-better rounds build a **streak ×n**, with a chime that climbs as it grows. In Letterfall every key is judged, and a missed key breaks the streak.
- **The result moment.** The score counts up to its value, your stars land one by one, "New ★" marks a better rating, and the next target is named. Reduced motion shows it all at once.
- **Tutorial.** The first time you open a game, a card shows an animated demo, the steps, how it is scored and its star targets, with **Start** or **Practice first**. Reopen it any time from `?` → *Show the tutorial*.
- **Variety modes** in Zero (*Weighted*), Exact (*Mixed units*), Draw (*Shapes*) and Mirror (*Transforms*). Each mode has its own records; the daily always uses the default.

## The play screen

- **Top bar:** back, the game's number and name, the level and mode pickers in the middle (a padlock marks a locked Hard), and the run tools on the right (seed, practice, sound, theme, help).
- **HUD strip** over the stage: where you are in the attempt (`2 / 5` becomes a row of pips), your stars at this level with a meter towards the next one and its target, and your best.
- **The verdict:** when a run ends, the strip shows your score, its stars and an **Again** button (Space). It sits beside the stage, never over the game's reveal.
- **The stage** is a framed window. Instructions are written over it as clear text, never in a box that would hide part of the game.
- **The panel** is a column of cards: the full result (its top bar turns the signal colour for a new best), your readouts and trend, what is measured, the keys.

---

## Settings (About → Settings, saved on this device)

- **Sound** and **volume**.
- **No flashes:** no screen inversion on EXACT; beat lamps glow gently instead of flashing (the timing cue stays visible).
- **Reduce motion:** no easing or decorative motion; results appear instantly.
- **Large text:** bigger interface *and* in-game text.
- **Large targets:** bigger slider knobs and start zones; never changes how a result is scored.
- **Key sensitivity:** how fast arrow keys move sliders and cursors (½×, 1×, 2×).
- **High contrast**, **dark / light**, **haptics**.

Every game's `?` help shows step-by-step instructions and exactly how it is scored. Timed, relaxed, static and sandbox variants are offered as modes where they make sense; practice (`P`) is never ranked.

---

## Records and progress

- **Readouts beside every game:** best, median of your last 10 ranked runs, run count, spread (how steady you are), a history sparkline and your trend.
- **Records page:** a **Precision Profile** grouped by skill — Timing & rhythm (Zero, Echo, False Beat), Spatial estimation (Exact, Close the Loop, Center, Mirror), Motor control (Stop, Drift, Shadow), Drawing & shape memory (Draw, Plumb), Physical inference (Balance), Synchronisation & prediction (Phaseshift, Intersect, Pendulum Catch), Perception & memory (Perception, Afterimage, Quantity Sense, Difference Engine), Fluids (Pour, Communicating Vessels, Valve Engineer), Exact recall & keys (Verbatim, Letterfall), Reasoning (Rule Hunter), Stopping over terrain (Brake Point), Reflexes at speed (Slipstream). There is **no overall score**: milliseconds, degrees and units can't honestly be added together.
- **Run journal:** every attempt with date, game, level, mode, score, kind and seed, plus an optional note. Click a seed to replay it as a challenge.
- **Backup:** export and import your records as JSON.
- **Daily experiment:** one game per day for everyone, same seed, Medium, three official tries. The daily rotation uses the original nine games (Zero to Center).

---

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests: scoring, seeds, feasibility, storage, all game maths
npm run build    # typecheck + tests + production build into dist/
```

Direct links: `/e/<id>` with ids `zero`, `exact`, `loop`, `draw`, `stop`, `balance`, `drift`, `echo`, `center`, `plumb`, `phase`, `beat`, `intersect`, `perception`, `afterimage`, `pour`, `shadow`, `mirror`, `vessels`, `valves`, `verbatim`, `letterfall`, `rules`, `diff`, `quantity`, `brake`, `pendulum`.
Options: `?level=easy|hard`, `?mode=…` (Drift `net`, Echo `held`, Phaseshift `blind`, Intersect `mislead` / `orbit`, Perception `beat`, Vessels / Valves / Pendulum `sandbox`, Verbatim `delayed` / `relaxed`, Letterfall `slow` / `fast`, Difference Engine `relaxed` / `side`, Quantity `static`), `?seed=<base36>` (challenge), `?daily`.

The full technical contract (every formula, tolerance and generator rule) is in [GAMES.md](GAMES.md).
