# Project Plan — Personal Fitness & Nutrition PWA ("FitSync 2")

## 1. Overview

A single-user, self-hosted Progressive Web App for planning and tracking workouts and meals, with an AI planning engine that adaptively rewrites the weekly plan when life happens (missed workouts, schedule changes, diet deviations). All data lives on-device in IndexedDB. No accounts, no cloud database, no multi-user concerns.

**Owner:** Josh. Single user, forever. Optimize for his workflow, not generality.

**Prior art:** An earlier prototype ("FitSync") was a single-file HTML/JS app with Firebase Firestore sync and an AI coach that returned structured JSON action blocks. Key learnings to carry forward:
- The structured-JSON-action pattern for AI worked well — keep it, expand its authority.
- Firebase added complexity and a network dependency for a single-user app — drop it in favor of IndexedDB + export/import backups.
- Single-file architecture became unwieldy past ~2,000 lines — this build should use a small number of ES modules served statically (no build step required, but organized).

## 2. Platform & Architecture

- **PWA**: installable on Android via "Add to Home Screen", full-screen standalone display, works offline.
- **Stack**: Vanilla JS with ES modules (or Preact via CDN if component state gets hairy — builder's choice, but NO build toolchain: no webpack/vite/npm install. Must run by serving static files.)
- **Storage**: IndexedDB via the `idb` library (CDN). LocalStorage only for small settings (theme, API key).
- **Charts**: Chart.js via CDN.
- **Service worker**: cache-first for app shell, so it opens instantly offline. Version the cache; bump on deploy.
- **Hosting**: any static file server on the home network or a cheap static host. HTTPS required for service worker + install prompt (use localhost, or a tunnel/host with TLS).
- **AI**: Anthropic Messages API called directly from the client with the owner's API key, stored locally in settings (acceptable: single user, personal device, self-hosted). Model: claude-sonnet-4-6. Every AI feature must degrade gracefully when offline or keyless — the app must be fully usable manually.

## 3. Data Model (IndexedDB object stores)

All records get `id` (uuid), `createdAt`, `updatedAt`.

- **profile** (single record): age, height, weight log (array of {date, kg}), goals (e.g., strength + recomposition), weekly availability (days/times willing to train), injury/constraint notes.
- **equipment**: name, category (barbell, dumbbell, machine, cardio, bodyweight, other), details (e.g., dumbbell range 5–50 lb in 5 lb steps), available (bool). This is a hard constraint set for planning.
- **programs**: name, source (e.g., a program he owns), description, structure notes (days/week, split, progression scheme), active (bool).
- **exercises**: name, muscle groups, equipment required (refs), notes, personal records (array of {date, weight, reps}).
- **workout_plans**: weekISO, days: [{date, focus, exercises: [{exerciseId, sets, reps, targetWeight, notes}], status: planned|done|missed|modified}], generatedBy: manual|ai, aiRationale.
- **workout_logs**: date, planned ref, exercises actually performed with sets/reps/weight/RPE, duration, notes.
- **meal_plans**: weekISO, targets {kcal, protein, carbs, fat}, days: [{date, meals: [{name, description, macros, prepMethod, batchRef}]}], groceryList, generatedBy, aiRationale.
- **meal_logs**: date, meals eaten (may diverge from plan), estimated macros, water (ml).
- **ai_events**: timestamp, trigger (missed_workout | manual_replan | weekly_gen | meal_adjust), promptSummary, actionsApplied (the JSON actions), accepted (bool). This is the audit log — every AI change must be traceable and reversible.
- **settings**: apiKey, units (imperial), theme, notification prefs.

## 4. Feature Scope by Phase

### Phase 1 — Foundation (build first, no AI)
1. App shell: PWA manifest, service worker, installable, offline-capable.
2. Settings screen incl. API key entry, data export/import (single JSON file — this is the backup story; make it prominent).
3. Profile, equipment, and program setup screens (guided first-run flow).
4. Exercise library: seed ~60 common exercises tagged by equipment/muscle group; user can add/edit.

**Done when:** app installs on Android, survives airplane mode, and a full export→wipe→import round-trip loses nothing.

### Phase 2 — Manual planning & logging
5. Weekly workout planner: build a week manually from the exercise library, respecting equipment constraints.
6. Workout logging: fast in-gym UX. Big touch targets, plate-math helper, previous-session numbers shown inline, rest timer. This screen gets used with sweaty thumbs — optimize ruthlessly.
7. Meal planning: set macro targets, plan meals per day, generate grocery list. Support batch-cook entries (one prep → multiple days), since the owner batch-cooks on a grill/smoker.
8. Meal + water logging.

**Done when:** a full week can be planned, executed, and logged without touching AI.

### Phase 3 — Progress & insight
9. Dashboard: this week at a glance (workouts done/remaining, macro adherence, weight trend).
10. Charts: lift progression per exercise, bodyweight trend, weekly volume per muscle group, macro adherence. Chart.js, simple, readable on a phone.
11. Personal records auto-detected from logs.

### Phase 4 — AI planning engine (the differentiator)
12. **Weekly generation**: AI generates next week's workout + meal plan from: profile, goals, equipment, active program's structure, last 4 weeks of logs, and any user notes ("traveling Thursday"). Returns structured JSON actions (see BUILD_GUIDE).
13. **Adaptive replan**: when a workout is marked missed or the user requests changes ("shoulder is tweaked", "ate out twice"), AI proposes a revised remainder-of-week. **Propose → review diff → accept/reject.** Never silently mutate the plan.
14. **Coach chat**: freeform chat grounded in current state; can emit the same action JSON from conversation.
15. **Natural-language quick log**: user types/dictates lazy descriptions ("leftover entraña plus two eggs and a tortilla") → AI returns a macro estimate as a `log_meal_estimate` action for one-tap confirm. This is expected to be the highest-frequency AI feature — make it fast (see model tiering in BUILD_GUIDE).
16. **Weekly review ritual**: end-of-week screen showing adherence, volume per muscle group, weight trend, and ONE AI observation with a recommendation (e.g., stalled lift → prescribed variation), flowing directly into next week's generation. This is the emotional core of the AI — a coach who watched the week, not a generator.
17. **Readiness check-in**: optional single-tap 1–5 "how are you feeling?" before a workout, stored on the log; low scores let the AI auto-propose scaled-down volume for that session.
18. AI audit log screen (ai_events) with one-tap undo of the last applied action set.

### Phase 5 — Polish / stretch
19. **Friction killers**: "repeat last week" one-tap plan starter; meal templates for regular dishes (save any logged/planned meal as a template); "logged as planned" one-tap day close-out.
20. Notification-style nudges via the PWA (best effort; Android PWA notifications are workable).
21. Recipe integration: meal entries exportable as HTML for Paprika import (owner uses Paprika; he has an existing HTML-recipe workflow).
22. Deload/periodization awareness in weekly generation.

### Deliberate restraint
Do not add trackers beyond lifts, food, water, and bodyweight (no sleep, steps, mood-journaling, supplements). Readiness (item 17) is the one allowed subjective input because it directly changes planning decisions. Every additional field is future guilt for skipping it; the app stays nimble by tracking only what changes decisions.

## 5. AI Integration Contract (summary — details in BUILD_GUIDE.md)

- Every planning call sends a compact state snapshot (profile, equipment, program, recent logs, current plan) and receives `{ "rationale": string, "actions": [...] }`.
- Action types: `replace_workout_day`, `update_workout_day`, `mark_rest_day`, `set_meal_day`, `adjust_macro_targets`, `log_meal_estimate`, `add_note`. Each action is validated against a schema before apply; invalid actions are rejected individually, not the whole batch.
- Model tiering: Sonnet for weekly generation/replans/review; Haiku for quick tasks (macro estimates, small tweaks). Details in BUILD_GUIDE.
- The app applies actions transactionally and records the batch in `ai_events` with undo data.

## 6. Non-goals

- No user accounts, auth, or multi-device sync (export/import JSON is the sync story).
- No cloud storage. No Firebase.
- No native Android build.
- No food-database API integration in v1 — macro estimates are AI-assisted or manual.
- No wearable integration in v1.

## 7. Risks & mitigations

- **IndexedDB eviction**: Android can evict site data under storage pressure. Mitigate: request persistent storage (`navigator.storage.persist()`), and nag weekly if no recent export.
- **API key on device**: acceptable for personal use; keep it out of exports by default.
- **CORS**: Anthropic API supports direct browser calls with the `anthropic-dangerous-direct-browser-access` header; verify current requirements at build time via docs.
- **Scope creep**: phases are gates. Phase 2 must be genuinely pleasant before Phase 4 starts — the AI needs good logged data to be useful.

## 8. Acceptance test (final)

Simulate two weeks of use: generate a week (AI), log 3 workouts, miss 1, trigger replan, review + accept diff, log meals with one batch-cook spanning 3 days, view charts, export data, wipe, import, verify everything intact.
