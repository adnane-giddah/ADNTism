# epsilon — Unified Product & Game Design Masterplan

> **Purpose:** A coherent, prioritized upgrade plan combining the existing `GAMES.md` design with selected ideas from the Gemini review and additional proposals. This is an enhancement contract, not permission to replace working code wholesale. Preserve the existing nine games, their mechanics, routes, deterministic seeds, local-first/offline behavior, and lower-is-better raw-error philosophy unless a change is explicitly approved.

---

## 0. Executive decision

epsilon should become **a precision laboratory that feels like an arcade and behaves like a trustworthy instrument**.

Its central question is: *How accurately can you perceive, predict, remember, and control a system?*

The core is already distinctive: measurements instead of arbitrary points, deterministic seeded runs, difficulty through information and constraints, and a shared daily experiment. The plan is to strengthen those advantages, then add a small number of genuinely different games.

### Adopt now
- Post-run ideal-vs-actual overlays and clear breakdowns.
- Seed-based challenge links.
- Better practice/official-run separation.
- Run history, a transparent Precision Profile, and data export/import.
- Accessibility, timing fairness, score-validation, and test improvements.
- Carefully designed optional audio cues, only where they add information and can be disabled.

### Adopt with guardrails
- Calibration-based device diagnostics, but **not** a “Biometric Precision Index” and not an unvalidated cross-device normalization claim.
- Haptics only as optional enhancement on supported devices, never as a scoring dependency.
- Additional telemetry only when it measures a clearly defined quantity and is not presented as physics jargon for decoration.
- New games selected for distinct mechanics, feasible inputs, robust scoring, and fun—not by quantity.

### Defer
- Global leaderboards until there is a backend, a privacy decision, and credible score verification.
- Real-time multiplayer.
- Complex spectrograms, curvature metrics, and jerk analytics until playtests show that users understand and value them.
- Pressure-by-touch-area mechanics: browser APIs do not provide a reliable, standardized physical-force measurement across common devices.

## 1. Non-negotiable design principles

1. **Raw error stays primary.** Display the real unit (ms, degrees, u, %, etc.) prominently. Any derived rating must be clearly labeled as a derived index.
2. **Never compare incompatible units directly.** A timing error, angle error, and distance error are not inherently comparable.
3. **Fairness before competition.** Distinguish practice, official daily attempts, and challenge runs. Make scoring rules explicit.
4. **Determinism matters.** A game + seed + level + mode should reproduce the same target conditions and simulation, apart from the player's inputs.
5. **Offline-first remains a feature.** No account, server, analytics, or remote dependency is required for core play.
6. **Difficulty changes information or constraints**, not merely speed or punishment.
7. **Every result should teach.** Show the ideal target or trajectory after the run and explain the main source of error.
8. **No false scientific claims.** epsilon measures performance on its own tasks; it must not claim to measure intelligence, clinical abilities, biometrics, or stable psychological traits.
9. **Accessibility is part of the design.** Keyboard, mouse, touch, sound-off, reduced-motion, and high-contrast paths must remain usable.
10. **Build in small steps.** Inspect first, test formulas, and avoid a risky rewrite of all games.

## 2. System and UX improvements

### 2.1 Onboarding and home screen
- Make the purpose obvious in one sentence: “Tiny experiments in timing, aiming, memory, balance, and control.”
- Keep Calibration as the welcoming instrument, not a ranked game.
- Offer a fast first attempt with short rules and an optional deeper “Why this works” section.
- Show a clear start action, a last result or personal best if one exists, and a daily experiment entry.
- Explain level, input, round count, and whether a run is official before the run begins.
- Include a forgiving, unranked first-use practice run.

### 2.2 Results and ideal-vs-actual replay
For every game where it is meaningful, provide a **post-run forensic view**:
- Ideal target/path/force versus actual execution.
- The primary error with units.
- A concise explanation of the error direction or pattern.
- Secondary metrics in a collapsible “Details” area.
- Retry, practice, change level, and share challenge actions.

Keep animations short and skippable. Do not overload a simple game with a technical dashboard.

### 2.3 Run Journal and Precision Profile
Add a local **Run Journal** with date, game, level, mode, seed, score, and optional player note. Add safe JSON export/import and version localStorage data.

The **Precision Profile** should show category-level trends, not one misleading universal score:
- Timing and rhythm: Zero, Echo
- Spatial estimation: Exact, Close the Loop, Center
- Motor control: Stop, Drift
- Visual memory and drawing: Draw
- Physical inference: Balance

Show “not enough data” until there are enough valid attempts. Use medians, best scores, and recent trends. Do not imply these categories are scientifically validated measures of a person's abilities.

### 2.4 Calibration: diagnostics, not biometrics
Keep Calibration as a personal baseline for duration-estimation tasks. Optionally add a diagnostic that reports:
- Browser/device information only when locally available and with clear explanation.
- Approximate input-event timing characteristics, with uncertainty.
- A short repeatability check.

Do **not** create a “Biometric Precision Index (BPI)” that claims to normalize scores across 60 Hz and 120 Hz displays or remove latency. A hold-duration task is not a full device-latency calibration, and one test cannot reliably normalize all games. Instead, show the raw calibration results and a clearly labeled **personal baseline**. If a derived index is later tested, publish its formula, uncertainty, limits, and validation evidence.

### 2.5 Seed sharing and challenge links
Support reproducible challenge links, for example:
`/e/drift?seed=8492&level=hard&mode=net`

Requirements:
- Validate and normalize seed values.
- Preserve existing query parameters and routes.
- The link must encode the full relevant configuration: game, seed, level, scoring mode, and challenge type.
- Clearly label practice/challenge/daily status.
- A challenge link must not silently consume one of the three official daily attempts.
- Share links should not imply a global ranking or verified score.
- Add a “Copy challenge link” action with a graceful fallback if clipboard access is unavailable.

### 2.6 Audio and haptics
- Optional synthesized audio can reinforce state changes, but should never be required to understand or score a task.
- Use consistent, restrained tones for start, lock/release, and result. Avoid pitch cues that reveal hidden values in blind modes.
- Haptics may be used only when the platform/browser supports them. Treat support as optional and unreliable; never promise uniform mobile-browser haptics.
- Sound and haptics must have independent controls and respect reduced sensory stimulation preferences.
- Keep a complete visual equivalent for every cue.
- Audio must not create extra timing advantage in official attempts. For Echo, use the game's defined scoring logic and clearly distinguish visual fallback conditions.

## 3. Measurement integrity and technical audit

### 3.1 Scoring issues to inspect first
- **Balance:** its current relative error divides by `x*`. If `x*` can approach zero, the score becomes unstable or undefined. Either constrain the generated target away from zero with a documented minimum magnitude, or use a well-defined alternative such as absolute position error in u. Do not silently change the meaning of the metric.
- **Consistency:** `1 − σ/μ` is unstable when the mean error is near zero and may be negative. Prefer median absolute deviation, median error, and a carefully defined consistency statistic. If coefficient of variation is retained, guard against a near-zero mean and document the interpretation.
- **Draw:** ensure coverage and closure are reported separately so a short accurate segment cannot masquerade as a good full-shape result.
- **Center:** validate that the ideal final point is reachable and that generated weighted configurations do not create degenerate denominators.
- **Stop/Drift:** specify how background tabs, frame suspension, focus loss, and visibility changes affect a run. Use deterministic simulation time, not render frame count.
- **All games:** reject NaN/infinite values, unreachable targets, invalid seeds, duplicate events, and accidental scores from pointer cancellation.

### 3.2 Timing and input handling
- Use input event timestamps for human-input timing where appropriate.
- Separate event time, simulation time, and render time.
- Audit `pointercancel`, focus loss, page visibility, touch scrolling, high-frequency/coalesced pointer events, and browser audio latency.
- Do not claim that event timestamps eliminate all device latency. State what is compensated for and what is not.
- Keep mouse, touch, and keyboard experiences fair. If one input method has different information or mechanics, label its record category rather than pretending it is identical.
- Use deterministic seeded RNG for all generated game conditions.

### 3.3 Tests and data safety
- Add deterministic score fixtures and seed-reproducibility tests.
- Test keyboard, mouse, touch, resize, focus loss, audio disabled, reduced motion, and corrupted localStorage.
- Version stored data and migrate safely.
- Keep a JSON backup path for local records.
- Do not add analytics, tracking, accounts, or network calls without explicit approval.
- Run the existing test suite and production build; report only results actually observed.

## 4. Refinements to the nine existing games

### 00 · Calibration
- Keep it unranked and prominent on the homepage.
- Add a short explanation that it measures duration control/estimation, not pure reaction speed.
- Show over/under-estimation by target duration.
- Optional: record a personal baseline without claiming cross-device normalization.

### 01 · Zero
- In practice mode, optionally reveal the running total after each hold.
- In Hard official mode, preserve the hidden tally and scale.
- Consider a subtle visual pulse on direction changes only if playtests show it helps orientation without revealing the sum. It must be optional and visually equivalent for sound-off users.
- Reveal signed final residual as well as absolute error after the run.

### 02 · Exact
- Show per-round angular error and clockwise/counter-clockwise direction.
- Add a target-by-target results breakdown.
- Ensure keyboard visibility accommodations do not silently mix different information conditions into one leaderboard.

### 03 · Close the Loop
- Overlay the ideal missing vector and the player's vector after the run.
- In practice mode, optionally show horizontal/vertical components.
- Explain scaling, rotation, and mirroring before Hard mode, without revealing a ranked target prematurely.

### 04 · Draw
- Show a reference-outline ghost after the run.
- Keep shape RMS, average offset, closure gap, and degrees swept separate.
- Curvature/inflection metrics are **deferred** until a stable definition and a clear player-facing explanation exist; they may be useful as optional advanced analytics, not core score clutter.

### 05 · Stop
- Overlay the actual trajectory and ideal braking trajectory after the run.
- Explain early brake, late brake, and wall impact in plain language.
- A jerk/smoothness metric is **optional future telemetry** only if the simulation defines the relevant acceleration changes. Do not label a decorative derivative plot as physical jerk when the model does not support that claim.

### 06 · Balance
- Reveal hidden masses and the true balance point after the attempt.
- Explain why block size is unrelated to mass.
- Fix the near-zero target/relative-error issue before adding leaderboard features.

### 07 · Drift
- Overlay the player's trace and hidden force with a clear legend.
- Explain `|∫|` versus net `∫` before the first mode switch.
- Define what happens when the tab is backgrounded so simulation fairness is reproducible.

### 08 · Echo
- Add replay of the reference rhythm on the result screen.
- Keep gap accuracy and tempo/shape accuracy distinct.
- A simple expected-versus-actual interval chart is preferred over a spectrogram. Spectrograms are deferred unless they reveal something meaningful that a clear interval chart cannot.
- Announce visual fallback before an attempt if sound is unavailable or disabled.

### 09 · Center
- Animate the weighted centroid and ideal final point after the run.
- Reveal weights after the attempt, especially on Hard.
- Validate that the ideal correction point is feasible.

## 5. New game proposals — ranked and refined

Do not build every proposal. Implement one at a time and playtest.

### 10 · Plumb — straightness (recommended first)
**Core loop:** draw a single stroke between two endpoints without a guide.  
**Primary score:** RMS perpendicular distance from the ideal line, in u.  
**Difficulty:** Easy shows a faint guide; Medium hides it once drawing begins; Hard briefly shows the guide then removes it.  
**Why it earns a slot:** immediate comprehension, quick retries, robust scoring, and a mechanic not fully covered by Draw.  
**Key safeguard:** score only the intended segment and require enough path coverage.

### 11 · Vector — trajectory interception (accept Gemini's idea, but refine it)
**Core loop:** predict a moving target's path and launch a projectile to intercept it.  
**Primary score:** miss distance at closest approach, in u.  
**Difficulty:** Easy shows target trajectory and guidance; Medium introduces deterministic acceleration; Hard hides part of the target's path and uses a transformed offset launch pad.  
**Why it earns a slot:** combines spatial prediction, timing, and control in a distinct physics problem.  
**Safeguard:** keep the projectile model simple and deterministic; score distance at a precisely defined time/closest-approach point. Avoid vague “swipe speed” physics unless input-to-velocity mapping is specified.

### 12 · Tangent — curve tangency (accept with a scoring redesign)
**Core loop:** place a tangent point and direction on a highlighted location of a curve.  
**Primary scores:** point offset from the true contact point in u, and angular error in degrees, shown separately. Do **not** add unlike units into an unexplained sum.  
**Difficulty:** simple curve with guides; composite curve with fewer guides; curve briefly visible and transformed on Hard.  
**Why it earns a slot:** rewards geometric intuition and estimation.  
**Safeguard:** define the target point clearly and keep the curve family deterministic and solvable.

### 13 · Scale — ratio estimation (accept with a clearer primary metric)
**Core loop:** reproduce a target ratio using two line segments.  
**Primary score:** absolute relative ratio error in %, with the formula displayed.  
**Difficulty:** integer ratios; irrational ratios such as √2 and φ; sequential-memory mode with the reference hidden.  
**Why it earns a slot:** easy to explain and mathematically elegant, while remaining accessible.  
**Safeguard:** avoid ratios so small or large that display constraints dominate the score; distinguish length-estimation error from ratio error.

### 14 · Split — simultaneous timing (accept from the earlier proposal, but accessibility-first)
**Core loop:** trigger two targets at two specified times using alternating inputs or two controls.  
**Primary scores:** mean absolute timing error in ms and left/right or first/second error difference.  
**Hard twist:** cues disappear and targets are offset.  
**Safeguard:** provide a one-control alternative and keep its records separate from two-control runs.

### 15 · Orbit — circular control (defer until after playtesting)
Keep radial deviation and angular-speed error as separate measurements. Use deterministic target motion and avoid blending metrics without a justified formula.

### Other concepts: defer
- **Pressure:** reject as originally described for now. Pointer contact area is not a reliable standardized measurement of physical force across browsers/devices; keyboard “pressure simulation” measures a different action. Revisit only with a clearly defined abstract control variable that does not pretend to measure real pressure.
- **Pendulum:** promising but overlaps with Echo's period/rhythm memory. Revisit if its core is prediction of a moving physical system rather than reproducing intervals.
- **Estimate:** overlaps with Draw/Scale unless narrowed to a distinct perceptual estimation task.
- **Catch:** overlaps with Vector unless it becomes a pure interception-timing game with no direction/trajectory control.
- **Split/Orbit/Plumb/Vector/Tangent/Scale:** do not launch all together. Prioritize by playtest evidence and implementation cost.

## 6. Competition and replay

1. **Daily Experiment:** preserve the existing shared seed, Medium difficulty, three official tries, and date-based selection unless a change is intentionally versioned.
2. **Seed Challenge:** a shareable game/level/seed/mode URL for asynchronous friend challenges.
3. **Ghost Replay:** store a compact local input trace for supported games and compare it to the ideal or a friend's trace after the attempt. Make clear when a ghost is local, imported, or verified.
4. **Weekly Lab:** a fixed-seed set of three games that measures several dimensions without pretending to produce a scientifically universal score.
5. **Pass-and-play:** optional local turns on one device; hide the previous player's result until the next attempt finishes if desired.
6. **Global leaderboards:** defer until there is a backend, anti-cheat/verification strategy, data-retention policy, and clear separation from local records.

## 7. Visual and interaction design

- Treat epsilon as a precise instrument, not a generic neon gaming dashboard.
- Use consistent typography, spacing, units, and state transitions.
- Keep the 100 u logical field consistent across viewports.
- Make results readable at a glance; advanced plots stay collapsible.
- Use restrained, purposeful animations: target reveal, vector transform, trajectory overlay, centroid reveal.
- Respect reduced-motion settings; never rely on screen inversion, animation, sound, or color alone to convey success.
- Provide keyboard focus, high contrast, clear touch affordances, and sensible text sizing.
- Prevent page scrolling during deliberate canvas gestures while preserving ordinary page scrolling elsewhere.
- Keep visual language coherent across games without making every game look mechanically identical.

## 8. Implementation roadmap

### Phase A — correctness first
1. Inspect repository and document actual architecture.
2. Audit Balance and consistency formulas, target feasibility, deterministic RNG, background-tab behavior, pointer cancellation, and timing assumptions.
3. Add score/seed tests and run current build.
4. Fix only verified defects; preserve current behavior elsewhere.

### Phase B — make each run satisfying
5. Improve onboarding and result screens.
6. Add ideal-vs-actual post-run overlays for the existing games.
7. Add a Run Journal, personal history, and safe JSON export/import.
8. Add a transparent Precision Profile without a universal score.

### Phase C — sharing and practice
9. Add practice versus official-attempt separation.
10. Add seed challenge links with validated parameters.
11. Add a simple Weekly Lab and local ghost replay if architecture supports them.

### Phase D — add games carefully
12. Prototype Plumb.
13. Playtest, then prototype Vector.
14. Choose Tangent or Scale based on observed player enjoyment and clarity.
15. Add Split or Orbit only if the collection needs that skill and testing supports it.

---

## 9. Copy-paste prompt for Claude Code

You are the lead gameplay engineer, measurement-integrity reviewer, and product designer for epsilon, a browser-based precision laboratory built with Vite, TypeScript, and Canvas 2D. Read `GAMES.md` and this masterplan fully. Inspect the entire repository and existing UI before editing. Treat `GAMES.md` as the current behavior contract. Preserve all nine games, their core mechanics, routes, seeded determinism, local-first/offline behavior, and lower-is-better raw-error philosophy. Do not replace working code wholesale or remove existing features.

Start by reporting the actual architecture, current tests, and risks you found. Then work in small steps:
1. Audit score formulas and edge cases, especially Balance's division by `x*`, consistency near zero, unreachable targets, NaN/infinite scores, Draw coverage, Center feasibility, deterministic RNG, pointer cancellation, and background-tab behavior.
2. Add or update tests for score calculations, seed reproducibility, and relevant input edge cases before altering game mechanics.
3. Improve onboarding, short rules, result breakdowns, and post-run ideal-vs-actual overlays for existing games. Keep advanced telemetry optional and understandable.
4. Add practice/official-run separation, a local Run Journal, a transparent category-based Precision Profile with “not enough data” states, and safe versioned JSON export/import.
5. Add validated seed challenge URLs while preserving existing query parameters and ensuring challenge runs do not consume daily attempts.
6. Add restrained optional audio/haptics only where supported, with visual equivalents and no hidden information leaks. Do not claim Calibration can normalize all device latency or create a biometric score.
7. After existing games are stable, implement Plumb as the first new game. Do not implement all new-game ideas in one pass.

Design constraints: keep raw units primary; never combine degrees and distance into an unexplained score; do not invent global ranks or scientific claims; do not add accounts, analytics, tracking, remote services, coins, or meaningless XP. Preserve keyboard, mouse, touch, offline, reduced-motion, and sound-off usability. Maintain seeded determinism and backwards-compatible routes/data.

After each phase, run the available tests and production build. Report changed files, behavior changes, actual test/build results, known limitations, and deferred work. Never claim a test passed unless you actually ran it. If the plan conflicts with the repository or existing spec, explain the conflict and choose the least destructive solution.
