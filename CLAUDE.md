# BUILD_GUIDE.md — How to Build This (read fully before writing code)

You are building a single-user fitness/nutrition PWA per PROJECT_PLAN.md. This guide is how to build it well. Follow it over your defaults.

## 0. Operating principles

1. **Read PROJECT_PLAN.md first.** Build phase by phase, in order. Do not start Phase 4 (AI) until Phase 2 works end-to-end.
2. **One user, one device.** When you face a tradeoff between generality and a better experience for this specific owner, choose the owner. No feature flags, no i18n, no auth.
3. **No build toolchain.** The app must run by serving a folder of static files. ES modules + CDN libraries only (idb, Chart.js, optionally Preact + htm). If you can't `python -m http.server` the folder and use the app, you've broken this rule.
4. **Offline-first, AI-optional.** Every screen must work with no network and no API key. AI features render as clearly-marked enhancements that fail soft with a useful message.
5. **Small files, clear names.** Target structure:
   ```
   /index.html
   /manifest.webmanifest
   /sw.js
   /css/app.css
   /js/app.js          (router + bootstrapping)
   /js/db.js           (all IndexedDB access — the ONLY file that touches idb)
   /js/state.js        (in-memory state + pub/sub)
   /js/ai.js           (API client, prompt builders, action validator/applier)
   /js/views/*.js      (one module per screen)
   /js/seed/exercises.js
   ```
   No file over ~400 lines. If one grows past that, split it.

## 1. Data layer rules

- All IndexedDB access goes through `db.js`. Views never import idb directly.
- Every write goes through a function that stamps `updatedAt` and emits a state event. Views re-render from state events, not ad-hoc.
- Dates: store ISO 8601 strings, always local-date semantics for "which day is this workout" (use `YYYY-MM-DD`, never UTC-midnight Date objects — this is the classic off-by-one-day bug on evening logging).
- Export = one JSON object containing every store (minus settings.apiKey by default). Import = validate shape, then wipe-and-replace inside a single transaction. Test the round trip early and add it to your manual test script.
- Call `navigator.storage.persist()` on first run; surface the result in Settings.

## 2. The AI contract (the heart of the app — get this exactly right)

### 2.0 Model tiering
Use two models, chosen per task in `ai.js`:
- **claude-sonnet-4-6** — weekly generation, adaptive replans, weekly review observation, coach chat. Reasoning-heavy, low frequency.
- **claude-haiku-4-5-20251001** — natural-language meal macro estimates and other small single-purpose calls. These are high-frequency and must feel instant; Haiku keeps them fast and cheap. Same JSON envelope, tiny prompt (just the food description + profile targets), no full snapshot needed.

### 2.1 Request pattern
`ai.js` exposes `generateWeek()`, `replanWeek(trigger)`, `coachChat(history, msg)`, `estimateMealMacros(text)`, and `weeklyReview()`. The planning functions build a prompt from a **state snapshot**, not the whole database:

- profile (goals, constraints, availability, latest weight)
- equipment list (names + key details only)
- active program structure notes
- last 4 weeks: workout logs summarized (per session: date, focus, top sets per exercise, RPE, readiness score if given), meal adherence summarized (daily kcal/protein vs target)
- current week's plan + statuses
- the trigger/user note (a low readiness check-in is itself a valid trigger for a scaled-down session proposal)

Keep the snapshot under ~3–4k tokens by summarizing logs in code before prompting. Do not dump raw log JSON.

### 2.2 API call
```js
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": settings.apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,   // see 2.3
    messages,
  }),
});
```
Wrap in try/catch; map failures to friendly messages ("No connection — plan unchanged", "API key rejected — check Settings"). Never leave a spinner hanging; 60s timeout via AbortController.

### 2.3 System prompt requirements (write it into ai.js as a template)
The system prompt must instruct the model to:
- Act as a strength & nutrition coach planning ONLY with the provided equipment and program structure.
- Respect stated constraints/injuries absolutely.
- Respond with **JSON only** — no prose, no markdown fences — matching this envelope:
```json
{
  "rationale": "2-4 sentences explaining the changes in plain language",
  "actions": [
    { "type": "replace_workout_day", "date": "2026-07-06", "focus": "Upper push", "exercises": [{ "exerciseName": "Incline DB Press", "sets": 4, "reps": "8-10", "targetWeight": "60 lb DBs", "notes": "" }] },
    { "type": "update_workout_day", "date": "2026-07-07", "changes": { "focus": "...", "addExercises": [], "removeExerciseNames": [], "setAdjustments": [] } },
    { "type": "mark_rest_day", "date": "2026-07-08", "reason": "..." },
    { "type": "set_meal_day", "date": "2026-07-06", "meals": [{ "name": "", "description": "", "macros": { "kcal": 0, "protein": 0, "carbs": 0, "fat": 0 }, "prepMethod": "grill|smoker|stove|oven|none", "batchTag": "optional-string" }] },
    { "type": "adjust_macro_targets", "weekISO": "2026-W28", "targets": { "kcal": 0, "protein": 0, "carbs": 0, "fat": 0 }, "reason": "" },
    { "type": "log_meal_estimate", "date": "2026-07-06", "name": "short label", "macros": { "kcal": 0, "protein": 0, "carbs": 0, "fat": 0 }, "confidence": "high|medium|low", "assumptions": "portion assumptions in one line" },
    { "type": "add_note", "text": "" }
  ]
}
```
- Prefer minimal diffs: only emit actions for days that change.

### 2.4 Validate, preview, apply, undo
- `validateActions(actions)`: schema-check each action independently (type whitelist, date within the plan week, exercises resolvable to the library or flagged as new, macros are positive numbers). Drop invalid actions with per-action error notes; never reject the whole batch for one bad action.
- **Preview is mandatory.** Render a human-readable diff (per day: before → after) plus the rationale. Two buttons: Apply / Discard. The AI never mutates data before Apply.
- Apply in one IndexedDB transaction. Store `{actions, inverseSnapshot}` in `ai_events` so "Undo last AI change" is one tap.
- Strip markdown fences defensively before `JSON.parse` (`text.replace(/```json|```/g, "")`), and if parse fails, retry once with a corrective message before surfacing an error.

### 2.5 Coach chat
Same envelope, but `actions` may be empty (pure advice). Persist chat history in memory per session only; always prepend the current state snapshot — the API is stateless.

## 3. UX requirements (non-negotiables)

- **Gym logging screen is the most important screen in the app.** Design it first within Phase 2: one exercise visible at a time, previous session's numbers shown inline, +/- steppers sized for thumbs (min 48px targets), a rest timer that starts on set completion, plate-math helper for barbell lifts. No dropdowns mid-workout.
- Bottom tab bar: Today · Plan · Meals · Progress · Coach. Settings behind a gear icon.
- "Today" is home: today's workout (start button), today's meals with quick-log, water tracker, and any pending AI proposal.
- **Natural-language meal quick-log**: a single text box on Today ("what did you eat?") → Haiku estimate → confirm card showing macros + assumptions + confidence → one tap to log, or edit numbers inline. Two taps total for the happy path. Estimates are labeled as estimates.
- **Readiness check-in**: when starting a workout, one optional row of five tappable faces/numbers. Skippable with zero guilt — no nag if skipped. A 1–2 offers "want a lighter version of today?" which routes through the normal propose→diff→apply flow.
- **Weekly review**: one screen, scrollable: adherence summary, volume per muscle group, weight trend, then exactly ONE AI observation with its recommended change, then a "Generate next week" button. Resist the urge to show five insights; one memorable observation beats a dashboard.
- **Friction killers**: "Repeat last week" on the Plan screen; long-press any meal → "Save as template"; templates appear as chips in meal planning and quick-log; "Close day as planned" on Today.
- Optimistic UI: log writes apply instantly; never block interaction on IndexedDB.
- Dark theme default (gym use), with a light option.
- Empty states tell the user what to do next, in one sentence, with the button that does it.

## 4. Visual design direction

Do not ship a generic template look (the cream-background/serif/terracotta default, or black-with-acid-green). Design intentionally for the subject: this is a personal training log for someone who lifts and cooks over fire. Suggested direction — dark charcoal base, one warm ember accent used sparingly (progress, PRs, active timers), a confident condensed display face for big numbers (weights, timers) and a clean body face for everything else. Big numerals ARE the interface on logging screens — treat the type scale for numbers as the signature element. Respect `prefers-reduced-motion`; keep animation to state changes that carry meaning (set complete, PR hit).

## 5. Quality bar & testing

Maintain `TESTING.md` with a manual test script; run it after each phase:
1. Fresh install → guided setup → seed data present.
2. Airplane mode → full app tour → nothing breaks, AI buttons explain themselves.
3. Plan a week manually; log a workout with the phone in one hand.
4. Export → wipe (DevTools) → import → data identical.
5. Phase 4: generate week → verify equipment constraints respected → mark a workout missed → replan → review diff → apply → undo → verify restoration.
6. Kill the tab mid-log → reopen → last completed set persisted.

Also:
- Handle `QuotaExceededError` and surface it.
- Service worker: cache app shell only, network-first for nothing (there is no server data). Show an "Update available — reload" toast when a new SW is waiting.
- No console errors on any screen. Lighthouse PWA installability check must pass.

## 6. Seed content notes (make it feel personal on day one)

- Exercise seed library: ~60 exercises spanning barbell, dumbbell, machine, bodyweight, and cardio, tagged by equipment so filtering by owned equipment works immediately.
- Meal planning should treat batch-cooking as first-class: a `batchTag` links one prep (e.g., a smoked pork shoulder) across several days' meals, and the grocery list aggregates it once. Prep methods include grill and smoker — the owner cooks this way weekly, and AI meal generation should be told (via the system prompt) to favor grill/smoker-friendly, high-protein meals with Latin flavors when generating plans.

## 7. Working style

- After each phase, stop and produce: what was built, how to test it, and any decisions made that deviate from this guide (with reasons). Deviations are fine when justified — silent deviations are not.
- Commit-sized chunks: each view/module should land in a reviewable piece, not one 3,000-line dump.
- When uncertain about an Anthropic API detail, check current docs rather than guessing.
