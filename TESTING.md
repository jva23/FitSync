# TESTING.md — Manual Test Script

Run this after every phase. Serve the folder with any static file server
(`python -m http.server`, or equivalent) and open it in a browser — Chrome on
Android for the real target, desktop Chrome for quick iteration.

## Core script (run every phase)

1. **Fresh install → guided setup → seed data present.**
   - Clear site data (DevTools → Application → Storage → Clear site data).
   - Load the app. It should route straight to onboarding (no manual
     navigation needed).
   - Complete profile → equipment → program steps (or skip equipment/program).
   - Land on Today. Open Exercise Library from the gear icon → Settings, or
     from Today's link — 59 seeded exercises should already be present,
     filterable by equipment category.

2. **Airplane mode → full app tour → nothing breaks.**
   - After first load (so the service worker has installed), go offline
     (DevTools → Network → Offline, or actual airplane mode on device).
   - Reload the app. It should load from cache instantly.
   - Visit every tab (Today, Plan, Meals, Progress, Coach) and Settings.
     Nothing should throw, spinners should never hang — Phase 1's stub
     views are static, Phase 4's AI buttons will need explicit offline
     copy once they exist.

3. **Plan a week manually; log a workout with the phone in one hand.**
   - Not testable until Phase 2 ships (Plan/logging views are stubs).

4. **Export → wipe → import → data identical.**
   - Settings → Export data. Confirm a `fitsync-backup-YYYY-MM-DD.json`
     file downloads.
   - DevTools → Application → IndexedDB → delete the `fitsync` database
     (or clear site data).
   - Reload — app should route back to onboarding since profile is gone.
   - There's no in-app way to import before a profile exists yet in this
     phase's flow beyond DevTools; for a full round-trip check, add a
     throwaway profile field, export, change it, then import the original
     file from Settings and confirm the field reverts and nothing else
     (equipment, exercises, programs) is lost.
   - Confirm the API key is preserved across import when the import file
     doesn't include one (exports omit it by default).

5. **Phase 4 checks** — not applicable yet (no AI features built).

6. **Kill the tab mid-log → reopen → last completed set persisted.**
   - Not testable until Phase 2 logging exists. For this phase, confirm the
     weaker version: edit a profile field in Settings, close the tab
     without navigating away, reopen — the change should have persisted
     (every db.js write commits before returning, so this should always hold).

## Phase 1 specific checks

- [ ] App installs on Android via "Add to Home Screen" (or desktop Chrome's
      install icon in the address bar) and opens full-screen/standalone.
- [ ] Lighthouse PWA installability check passes (manifest valid, icons
      present at 192/512 + maskable variants, service worker registered,
      HTTPS or localhost).
- [ ] No console errors on any screen (Today, Plan, Meals, Progress, Coach,
      Settings, Exercise Library, Onboarding).
- [ ] Theme toggle (Settings → Appearance) switches dark/light instantly and
      persists across reload.
- [ ] `navigator.storage.persist()` is requested on first run; Settings
      shows whether it was granted, with a manual retry button if not.
- [ ] Equipment/program/exercise CRUD (add/edit/delete) all write correctly
      and reflect immediately in the UI.
- [ ] Weight entered in onboarding (lb) round-trips correctly through the
      canonical kg storage (check Settings → Profile shows the same lb
      value back).

## Known deviations from BUILD_GUIDE (Phase 1)

- **Exercises reference equipment by category tag, not equipment record ID.**
  The data model in PROJECT_PLAN says exercises hold "equipment required
  (refs)". Seed exercises are created before any user equipment records
  exist, so seed data can't reference real equipment IDs. Exercises instead
  carry an `equipmentCategories` array (`barbell`, `dumbbell`, `machine`,
  `bodyweight`, `cardio`, `other`) matching `equipment.category`, and
  filtering-by-owned-equipment joins on category. This is what section 6 of
  BUILD_GUIDE actually asks for ("tagged by equipment so filtering by owned
  equipment works immediately").
- **Import preserves the current API key if the imported file omits one.**
  A strict wipe-and-replace would otherwise silently delete the device's
  API key on every import, since exports omit it by default. Settings after
  import are still fully replaced by the file's contents in every other
  respect.
- **Bodyweight scale stored as kg, displayed as lb.** PROJECT_PLAN's data
  model specifies weight log entries as `{date, kg}`; default units are
  imperial. Canonical storage stays in kg (matches the spec verbatim) and
  the UI converts to lb at the edges (`js/utils.js`).

## Phase 2 specific checks

Verified live in the preview browser this session:

- [x] Plan tab: week nav, per-day focus + rest-day toggle, equipment-filtered
      exercise picker (defaults to owned equipment, "show all" override),
      inline sets/reps/target-weight/notes editing — all persist immediately.
- [x] Today reflects the active plan day (start/close-as-planned/rest/done
      states) and falls back to "start ad-hoc workout" when nothing's planned.
- [x] Workout logging screen: readiness check-in (skippable), one exercise at
      a time, previous-session line, weight/rep steppers, plate-math per side
      for barbell exercises, rest timer that starts on set completion and
      counts down, "Finish workout" marks the plan day done and returns to
      Today.
- [x] **Kill-tab-mid-log survives**: completed a set, reloaded the page cold,
      confirmed the set was still marked done and the session resumed instead
      of restarting (autosave-per-set via `saveWorkoutLog` on every change).
- [x] Meals tab: macro targets editable, per-day meal add with prep-method
      chips and batch tag, "Batch preps this week" summary correctly groups
      meals sharing a batch tag across days, manual grocery list add/remove.
- [x] Today's meal quick-log + water tracker: add/remove meals, macro totals
      update live, water +8oz/reset both persist.
- [x] No console errors across Plan, Today, Meals, or the logging screen
      during the full flow above.

Not yet exercised: multiple concurrent workout sessions per day, a full
7-day week actually logged end-to-end (only one day was exercised live),
and meal plan → Today meal-plan-summary linkage beyond the name list.

## Known deviations from BUILD_GUIDE (Phase 2)

- **Meal planning and meal logging are split across tabs by intent, not by
  data.** BUILD_GUIDE describes Today as owning "today's meals with
  quick-log, water tracker" — so actual eating (quick-log + water) lives on
  Today, while the Meals tab owns forward-looking planning (macro targets,
  per-day meal plans, batch tags, grocery list). This wasn't spelled out
  as a split in PROJECT_PLAN's phase list but follows directly from how
  BUILD_GUIDE describes each screen's job.
- **Grocery list is a flat manual list, not aggregated from meal
  ingredients.** Generating real ingredient quantities would need recipe
  parsing (Paprika integration is Phase 5, AI is Phase 4) — out of scope
  for a non-AI phase. The batch-tag summary card gives the batching benefit
  the owner actually needs (which days share a prep) without inventing an
  ingredient parser.
- **Workout/meal logs are keyed one-per-date via a lookup, not enforced
  unique in the store.** `workout_logs`/`meal_logs` still allow multiple
  records per date at the schema level (per PROJECT_PLAN), but the UI only
  ever fetches/creates the first match for a date — a second same-day
  session isn't reachable from the UI yet. Fine for a single daily session;
  worth revisiting if the owner ever double-sessions.

## Phase 3 specific checks

Verified live in the preview browser this session:

- [x] Progress dashboard: "this week" done/remaining counts, avg logged kcal
      vs target, weight delta line all compute correctly from real data.
- [x] Recent PRs card lists newly detected PRs (name + weight × reps).
- [x] Bodyweight trend, weekly volume per muscle group, macro adherence
      (bar + dashed target line), and lift progression (exercise picker +
      line chart) all render via Chart.js with no console errors.
- [x] **PR auto-detection**: added a heavier set (145 lb vs a prior best of
      135 lb) to a finished workout, hit Finish again, confirmed
      `exercise.prs` gained a new entry and the Progress dashboard picked it
      up immediately.
- [x] Empty states verified: bodyweight trend, volume, macro adherence, and
      lift progression all show a one-sentence "what to do next" message
      instead of a blank/broken chart when there's no data yet.
- [x] Charts survive route navigation (destroy() properly tears down Chart
      instances so re-visiting Progress doesn't leak or double-render).

Not yet exercised: multiple weeks of history (only one day's data exists),
so trend lines with more than 1–2 points, and the volume chart with more
than one muscle group overlap scenario aren't visually confirmed beyond
what a single session produces.

## Known deviations from BUILD_GUIDE (Phase 3)

- **Weekly volume per muscle group attributes full set volume to every
  muscle group an exercise is tagged with, rather than splitting it.**
  E.g. a compound lift tagged `chest, triceps, shoulders` adds its full
  volume to all three bars rather than a fractional split. BUILD_GUIDE
  doesn't specify an attribution method; full-credit is the simpler and
  more standard convention (most training logs do this) and avoids
  inventing an arbitrary per-exercise weighting scheme.
- **PRs are "new all-time max weight lifted," not an estimated 1RM.** A
  true strength PR could arguably be judged by estimated 1RM (weight and
  reps combined via an Epley-style formula), but that formula is an
  approximation with its own error bars. Max-weight-lifted is simpler,
  legible on the dashboard without explanation, and matches how most
  lifters actually think about a PR.

## Phase 4 specific checks

**Important caveat: no real Anthropic API key was available in this
environment.** Every check below was verified by intercepting
`window.fetch` in the browser to return canned Anthropic-shaped responses,
which validates the entire client-side pipeline (prompt building, JSON
parsing/retry, validation, diff preview, apply, undo, error handling) but
does **not** verify actual model behavior, latency, or real auth. Re-run
the acceptance test in section 8 of PROJECT_PLAN.md with a real key before
considering Phase 4 done in practice.

Verified live (with mocked `fetch`) this session:

- [x] **No API key set** → "Add an API key in Settings to use AI features."
      toast, no request attempted, nothing crashes.
- [x] **Generate week** (Plan tab): full rationale + 4-action diff preview
      (replace_workout_day, mark_rest_day, set_meal_day,
      adjust_macro_targets) rendered as human-readable before→after lines;
      Apply wrote correctly to both `workout_plans` and `meal_plans` in one
      batch; exercise names resolved to real `exerciseId`s.
- [x] **Invalid actions dropped individually, not the whole batch**: fed a
      response with 4 valid actions, an unknown action type, and (in an
      earlier pass) actions with dates outside the target week — each bad
      action was dropped with a specific warning-colored note while the
      valid ones still applied. This caught a real gap during testing (see
      deviations below) that's now fixed.
- [x] **Undo**: applied a 4-action batch touching two plan stores, then hit
      "Undo last AI change" in AI Activity — both `workout_plans` and
      `meal_plans` reverted exactly, event flipped to "undone", and the
      undo button correctly disappeared (no double-undo).
- [x] **AI audit log**: applied, discarded, and undone events all show with
      correct badges, timestamps, and per-action diff lines.
- [x] **Natural-language meal quick-log** (Today, Haiku path): estimate →
      confirm card with editable macros, assumptions, and confidence badge
      → one-tap log → applied via the same action pipeline (shows up in AI
      Activity as "Meal quick-log").
- [x] **Coach chat**: grounded reply rendered as a bubble; history persists
      across messages in the same session.
- [x] **Weekly review**: adherence + volume + weight trend + exactly ONE
      observation card + "Generate next week" — matches the one-screen,
      one-observation spec instead of a multi-insight dashboard.
- [x] **Readiness-triggered replan** (workout-log.js): tapping a low
      readiness score (1–2) offers "Ask AI for a lighter session" instead
      of just a toast; accepting revises today's plan and the logging
      screen immediately reloads with the new (lighter) exercise list.
- [x] **Error paths**: 401 → "API key rejected — check Settings."; network
      failure → "No connection — plan unchanged."; malformed JSON on the
      first attempt correctly triggers exactly one corrective retry before
      either succeeding or surfacing "AI response wasn't understood."

## Known deviations from BUILD_GUIDE (Phase 4)

- **ai.js is split across four files, not one.** BUILD_GUIDE's target
  structure lists a single `js/ai.js`, but section 0 also says "no file
  over ~400 lines... split it" if it grows past that. The AI contract
  (snapshot building, validation/apply/undo, the preview overlay, and the
  API client itself) doesn't fit in 400 lines without becoming unreadable,
  so it's split into `ai.js` (client + prompt builders, the public
  surface), `ai-snapshot.js` (state snapshot), `ai-actions.js`
  (validate/describe/apply/undo), and `ai-preview.js` (the shared
  propose→diff→accept overlay).
- **validateActions() constrains actions to an expected week when the
  caller knows one, via optional `allowedDates`/`allowedWeekISO`
  params.** BUILD_GUIDE's validation spec says "date within the plan
  week" — this was initially missed (format-only validation) and caught
  during manual testing when a deliberately out-of-week test action
  applied to the wrong week's plan instead of being rejected. Fixed by
  threading the target week's dates through from every call site
  (Plan's generate/replan, the readiness-triggered replan, and both
  Weekly Review actions). Coach chat intentionally passes no constraint,
  since freeform chat isn't scoped to a single week.
- **`add_note` actions have no home besides the AI audit log.** There's no
  dedicated "notes" store in the data model (PROJECT_PLAN doesn't define
  one), so a note's only persisted trace is its entry in `ai_events` —
  it's visible in the diff preview and the AI Activity screen but doesn't
  surface anywhere else (e.g. it won't show up pinned on Today). Given
  `add_note` is the least-specified action type in the spec, this seemed
  like the right amount of investment rather than inventing a new store.
- **Estimated meal macros are tagged `source: "ai"`** (vs. `"manual"` for
  hand-entered meals) so a future screen could distinguish them, but
  nothing currently reads that field for display purposes beyond storage.

## Phase 5 specific checks

Verified live in the preview browser this session:

- [x] **Meal templates**: "Save as template" on a logged meal (Today) and a
      planned meal (Meals) both persist to the new `meal_templates` store;
      template chips appear in both the Meals add-meal form and Today's
      manual quick-log form; clicking a chip prefills all fields; the
      Meals-tab "Meal templates" management card lists and deletes them.
- [x] **Recipe HTML export**: generated file inspected directly (bypassing
      the actual download) — valid schema.org `Recipe` JSON-LD with name,
      description, nutrition, and keywords; the ingredients section
      honestly states they weren't tracked rather than inventing a list.
- [x] **Notifications settings**: verified all three permission states
      render correctly (`default` → "Enable notifications" button,
      `granted` → "Disable notifications", `denied` → blocked message with
      no button) by mocking `Notification.permission`/`requestPermission`.
      Clicking through `default` → `granted` persists `notificationsEnabled`
      and re-renders correctly.
- [x] **Boot-time nudges**: called `checkAndNotify()` directly with a
      captured `showNotification` — confirmed the stale-export reminder
      fires when `lastExportAt` is null/old and stops firing immediately
      after an export updates it; confirmed the missed-workout reminder
      fires for a past unfulfilled training day and includes its date/focus
      in the body.
- [x] **DB migration**: bumped `DB_VERSION` 1 → 2 with `contains()`-guarded
      store creation; confirmed the existing v1 database (with real data
      from earlier phases) upgraded cleanly to v2 with `meal_templates`
      added, no data loss, no console errors.
- [x] No console errors across Meals, Today, and Settings during any of the
      above.

One real bug caught (not app-related) during this pass: firing two
`location.hash` changes back-to-back in the same synchronous script, or
setting `location.hash` to its *current* value, doesn't produce a second
render (no `hashchange` event fires when the hash doesn't actually change).
This is correct browser behavior, not a bug — it just means my own test
sequencing needed a "navigate away, then back" pattern to force a
re-render after mocking browser APIs. Documented here in case future
testing hits the same confusion.

## Known deviations from BUILD_GUIDE (Phase 5)

- **"Save as template" is an explicit button, not a long-press gesture.**
  Section 3's UX non-negotiables literally say "long-press any meal."
  Long-press-only affordances are a known accessibility/discoverability
  anti-pattern (no visual hint that the gesture exists, awkward with mouse
  input, conflicts with text selection/scrolling), so a visible button was
  used instead. If touch-specific long-press is wanted later, it's
  additive — the button doesn't need to go away.
- **Notification nudges are foreground-only, checked on app launch.**
  BUILD_GUIDE and PROJECT_PLAN both frame this as "best effort," which is
  doing real work here: there's no backend in this architecture (by
  design — no accounts, no cloud), so there's no push server to trigger
  notifications while the app is closed, and the Push API requires exactly
  that. `showNotification()` via the service worker still gives real OS
  notifications, but only for nudges evaluated at the moment the app is
  opened, not true background delivery.
- **Recipe export can't produce a real ingredient list.** FitSync's meal
  model (from PROJECT_PLAN's data model) only has name/description/macros —
  no structured ingredients or numbered steps. Rather than fabricate a
  plausible-looking-but-wrong ingredient list to satisfy Paprika's parser,
  the export is honest about the gap and leaves it for the owner to fill in
  after import. The schema.org Recipe JSON-LD structure itself (the part
  Paprika actually parses) is fully correct.
- **"Repeat last week" and "close day as planned"** (also listed under
  Phase 5's friction-killers in PROJECT_PLAN) were already built in Phase 2
  — see [plan.js](js/views/plan.js) and [today.js](js/views/today.js). Not
  re-verified here since they're unrelated to this phase's changes and were
  already covered in the Phase 2 test pass.

## Phase 6a specific checks (Recipe library — data + manual path)

Verified live in the preview browser this session:

- [x] **DB migration v2 → v3**: `recipes` and `recipe_images` stores added
      via `contains()`-guarded creation; existing v2 data (profile,
      exercises, meal_templates, etc.) survived the upgrade untouched.
- [x] **Meal template → recipe migration**: saved a meal template, forced
      `settings.recipesMigrated = false`, ran `migrateMealTemplatesToRecipes()`
      — produced a starter recipe with matching title/prepMethod/macros and
      confidence `unknown`; a second call was a correct no-op (idempotent,
      gated on the settings flag rather than "recipes store is empty").
- [x] **Manual entry → create**: filled title, description, base servings,
      one ingredient row, one step, kcal/protein, a free-typed category
      chip ("smoker"), prep method, and a 4-star rating; Save navigated
      straight to the new recipe's detail view with everything persisted
      correctly, nutrition confidence auto-flipped to `verified` (non-zero
      values were entered).
- [x] **Scaling**: bumped servings 4 → 6 on the detail view; "2 lb pork
      shoulder" correctly rescaled to "3 lb pork shoulder" live
      (`formatAmount`/`scaleAmount` in utils.js).
- [x] **Cook-mode basics**: tapping an ingredient row toggles a
      checked/strikethrough state that survives re-renders; tapping a step
      card toggles its highlighted (ember) background. Both are ephemeral
      per view-visit, not persisted — expected, since these are cooking-session
      UI state, not recipe data.
- [x] **Mark as cooked**: increments `timesCooked` and stamps
      `lastCookedAt`; library card immediately shows a "cooked 1×" badge.
- [x] **Edit**: the same form (`recipe-form.js`) reopens fully pre-filled
      (title, servings, category chip, prep method, ingredient/step rows,
      nutrition with its current confidence) for both the library's inline
      "Manual" flow and the detail view's "Edit" button.
- [x] **Delete**: removes the recipe and its associated `recipe_images`
      records (verified via direct `db.js` calls), then returns to the
      library.
- [x] **Export → import round-trip including a photo**: attached a
      synthetic image Blob via `saveRecipeImage`, exported (confirmed the
      blob serializes to a `data:image/png;base64,...` string in the JSON),
      then imported that same export — the recipe came back intact and the
      image came back as a real `Blob` of the original byte size, and
      rendered correctly in the detail view's photo gallery.
- [x] Library search/filter/sort (title+ingredient+category search, category
      chips, prep-method chips, sort dropdown) all update the list live with
      no console errors.
- [x] No console errors across Recipes (library), Recipe (detail/edit), or
      the Meals-tab "Recipe library" entry card during the full flow above.

Not yet exercised: a real photo file upload through the `<input type="file">`
(only a synthetic Blob was pushed directly through `db.js`, since simulating
a native file picker isn't reachable from the browser automation used this
session) — the downscale/store code path itself is simple enough (canvas →
`toBlob` → `saveRecipeImage`) that this is a reasonable gap to leave for the
owner's first real use.

## Known deviations from BUILD_GUIDE / RECIPES_MODULE_PLAN (Phase 6a)

- **Only the Manual intake path is wired up.** The "+ Add Recipe" chooser
  shows all four options (Manual, From URL, From Photo, Paste/Import) per
  the UX spec, but the latter three just toast "coming in a later phase" —
  they need the Sonnet/Haiku extraction pipeline, which
  RECIPES_MODULE_PLAN's own build order (§6) schedules as Phase 6b. Building
  them now would mean designing the AI contract twice.
- **No "Estimate nutrition" (Haiku) button on the manual form.**
  RECIPES_MODULE_PLAN §3 lists this under the manual-entry intake path, but
  it needs the same 6b extraction/estimation plumbing as the other AI
  paths. Manual entry in 6a is fully usable offline without it — nutrition
  confidence is computed locally instead: `unknown` if all four macro
  fields are zero, `verified` if the owner filled in any of them (matches
  the "editing flips confidence to verified" rule in §5, since there's no
  AI-estimate state reachable yet).
- **Meal-template migration confidence is always `unknown`, never
  `verified` or `ai_estimate`, regardless of whether the template already
  had non-zero macros.** `meal_templates` records never recorded whether
  their macros were hand-typed or copied from an earlier AI estimate
  (Phase 4's `log_meal_estimate` results only tag `meal_logs` entries with
  `source: "ai"`, not templates), so `unknown` is the only honest choice —
  presuming `verified` would overstate confidence in numbers of unknown
  origin.
- **Migration is gated on `settings.recipesMigrated`, not "recipes store is
  empty".** An empty-store check would silently re-import old meal
  templates as recipes if the owner ever deleted every recipe they'd
  created since the upgrade. The settings flag makes it a true one-time
  migration.
- **Cooking mode has no wake-lock and no running/tappable timers.**
  RECIPES_MODULE_PLAN's own build order (§6) puts "cooking mode
  wake-lock/timers" in Phase 6e, grouped together since both are about
  making cooking mode hands-free. Steps with a `timerSeconds` value show a
  static `⏱ m:ss` badge in 6a; tapping to start a countdown is deferred.
- **No "Add to plan" button on the recipe detail view.** Linking a recipe
  into a day's meal plan (with servings → auto-macros) is Phase 6c's
  integration work (`recipeId` on meal-plan entries); building a button
  that writes to `meal_plans` now would duplicate that work under a
  different shape.
- **Grocery-list ingredient aggregation isn't wired to recipes yet.** The
  Meals tab's grocery list is still the flat manual list from Phase 2;
  consolidating structured recipe ingredients into it is explicitly Phase
  6c scope (RECIPES_MODULE_PLAN §2, "Integration changes to existing
  stores").
- **Duplicate-ID bug caught during manual testing, not by inspection.**
  The recipe library's filter toolbar and the embedded recipe form both
  originally used `#cat-chips`/`#prep-chips` as element IDs. Because each
  file scopes its own `querySelector` calls to its own root element, the
  app still worked correctly, but it was invalid HTML and broke an
  ID-based lookup during testing. Fixed by prefixing every form-internal
  ID in `recipe-form.js` with `rf-` (`#rf-cat-chips`, `#rf-prep-chips`,
  `#rf-ingredient-rows`, etc.).
- **The dev preview's service worker silently served a stale cached
  `recipe-form.js` after an edit**, because `sw.js` caches the app shell
  cache-first. Not an app bug, but worth noting for future testing
  sessions: after editing any file already cached by a running SW,
  unregister the SW and clear caches (or bump `CACHE_VERSION`, done here to
  `v6`) before trusting a reload to reflect new source.

## Phase 6b specific checks (Recipe library — intake paths)

Verified live in the preview browser this session, with `window.fetch`
intercepted to return canned Anthropic-shaped responses (no real API key was
available — same caveat as Phase 4: this validates the entire client-side
pipeline — prompt building, request shape, JSON parsing, the review screen,
save/photo-attach — but not real model output quality or latency).

- [x] **Paste/Import — direct canonical JSON**: pasted a full canonical
      recipe JSON (no AI call) — recognized automatically, opened the
      review form pre-filled with every field, saved and displayed
      correctly. Also doubles as the "re-import an export" and "paste a
      Claude-formatted recipe from another chat" paths since they're the
      same shape.
- [x] **Paste/Import — arbitrary text (Haiku)**: pasted plain prose
      ("Chili: 2 lb ground beef, simmer 30 minutes...") — routed through
      `extractRecipeFromText`; confirmed via the intercepted request that
      it used `claude-haiku-4-5-20251001` with plain string content (no
      `tools`), and the review form came back correctly populated.
- [x] **From Photo (Sonnet vision)**: injected a synthetic image file into
      the file input via `DataTransfer` (no real camera available),
      confirmed the photo was downscaled to JPEG before the call, the
      request used `claude-sonnet-4-6` with an `image` content block
      (base64, `media_type: "image/jpeg"`) alongside the text instruction,
      and the warnings box rendered at the top of the review form from the
      mocked response's `warnings` array.
- [x] **From URL (Sonnet + web_fetch tool)**: confirmed the request
      included `tools: [{ type: "web_fetch_20250910", name: "web_fetch",
      max_uses: 1, max_content_tokens: 50000 }]` and that the URL appeared
      literally in the message text (required — the tool can only fetch
      URLs already present in the conversation). Also specifically
      exercised the **last-text-block bug fix**: the mocked response
      included a preliminary text block ("I'll fetch that page now."),
      then `server_tool_use`/`web_fetch_tool_result` blocks, then the real
      JSON answer as a *later* text block — the response parsed correctly
      instead of choking on the preliminary text, confirming `callClaude`
      now reads the last text block rather than `content[0]`.
- [x] **Estimate nutrition (AI) button, manual entry**: with one ingredient
      entered, clicked the button — filled kcal/protein/carbs/fat from the
      mocked Haiku response, showed the assumptions line, and updated the
      hint to "(currently ai_estimate...)".
- [x] **Confidence-tracking fix**: saved an AI-extracted/estimated recipe
      *without* touching the nutrition fields — confidence correctly
      stayed `ai_estimate` (assumptions preserved) instead of the old 6a
      behavior of stamping `verified` on any non-zero save. Then edited one
      macro value by hand and saved again — confidence correctly flipped to
      `verified` and the stale assumptions text was cleared.
- [x] **XSS fix verification**: pasted a canonical JSON recipe with
      deliberately hostile strings in every text field (`<img
      src=x onerror=alert(1)>` in the title, `<script>bad</script>` as a
      category, an attribute-breakout string — `flour" onmouseover="alert(2)`
      — as an ingredient name, HTML tags in the description/notes). Every
      field rendered as inert literal text in the review form, the saved
      recipe's library card, and the detail view — no script execution, no
      layout breakage, no attribute breakout. Confirms the `recipe-form.js`
      rewrite (DOM property assignment instead of `value="${...}"` string
      interpolation) and the `escapeHtml()` additions in `recipes.js` /
      `recipe-detail.js` actually close the gap.
- [x] No console errors across any of the above, including the empty
      "Recipe not found" state after deleting a recipe whose detail view
      was still the active route.

Not yet exercised: a real end-to-end call against the live Anthropic API
(no key available in this environment — same caveat as every other AI
phase), and a `pause_turn`/multi-fetch continuation for an unusually large
recipe page (see deviations below).

## Known deviations from BUILD_GUIDE / RECIPES_MODULE_PLAN (Phase 6b)

- **A real stored-XSS gap in the Phase 6a form was found and fixed as part
  of this phase, not left as pre-existing.** 6a's manual entry form only
  had to trust the owner's own typing, so building `recipe-form.js`'s
  inputs via `value="${recipe.title}"`-style template interpolation was
  low-risk. Once recipe content can come from a scraped web page or photo
  OCR (this phase), that same pattern becomes a real stored-XSS vector —
  and separately, `value="..."` attribute interpolation was never safe
  against a bare `"` character breaking out of the attribute, since
  `escapeHtml()` (text-node-safe via `textContent`) doesn't escape quotes.
  Fixed by setting all dynamic field values via DOM property assignment
  (`.value =`) instead, which never parses the string as markup regardless
  of its content, plus `escapeHtml()` on every recipe-derived string
  rendered in `recipes.js`'s card list and `recipe-detail.js`'s read-only
  view (both text-node contexts, where `escapeHtml()` is sufficient).
- **`callClaude`/`callClaudeForJSON` signature changed** from a positional
  `maxTokens` argument to an options object (`{ maxTokens, tools }`), and
  both are now exported from `ai.js` (previously module-private) so
  `ai-recipes.js` can reuse the same request/retry/error-handling logic
  rather than duplicating it. The one existing call site
  (`estimateMealMacros`) was updated; behavior for every other existing
  call is unchanged since `maxTokens` still defaults to 4000.
- **`callClaude` now reads the *last* text content block instead of
  `content[0]`.** This was a latent bug that only matters once a `tools`
  array can be present: a `web_fetch`/`web_search` turn can return a
  preliminary text block ("I'll fetch that now") before the tool call,
  followed by the real answer in a later text block after the tool result.
  Reading `content[0]` would have silently fed Claude's preliminary text
  into the JSON parser instead of the real answer. Every existing
  tool-free call path (planning, chat, meal estimates) still has exactly
  one text block, so this is a strict fix with no behavior change for
  them.
- **No `pause_turn` continuation loop for `extractRecipeFromUrl`.** Per
  Anthropic's docs, an unusually large or slow page fetch can return
  `stop_reason: "pause_turn"`, requiring the paused message to be resent
  to continue. Building that continuation loop for what should be a rare
  case (recipe pages are typically small) wasn't worth the added
  complexity; a page that triggers this will surface as "AI response
  wasn't understood" via the existing corrective-retry path instead of
  silently hanging. `max_uses: 1` and `max_content_tokens: 50000` are set
  on the `web_fetch` tool to keep both cost and the chance of hitting this
  bounded.
- **Paste/Import routes both "arbitrary pasted text" and "canonical JSON
  without its own `source`" through `source.type: "claude_import"`.**
  RECIPES_MODULE_PLAN's intake path #4 ("Import Claude-created recipes")
  and the "arbitrary pasted recipe text/markdown" sub-case in the same
  section share one chooser button and one panel in this implementation,
  so they share one source type rather than inventing a distinct
  `source.type` for plain-text paste that the schema (§2) doesn't define.
- **The "From Photo" and "Paste/Import" panels don't auto-fallback into
  each other on failure.** RECIPES_MODULE_PLAN §3.2 describes a fallback
  from a failed URL fetch to "paste the recipe text" — implemented as a
  hint line pointing the owner at the other chooser button rather than an
  automatic panel switch, since silently discarding what they'd already
  entered (a URL, or photos) to swap UI out from under them seemed more
  surprising than a one-tap manual switch.
- **`extractRecipeFromImages` and `extractRecipeFromText` don't retry with
  a different model tier on failure** (e.g. falling back Sonnet → Haiku or
  vice versa). A single corrective JSON-retry (already built into
  `callClaudeForJSON`) is the only retry; model-tier fallback wasn't in
  scope and would mask genuine extraction failures behind a slower,
  different-quality response.

## Phase 6c specific checks (Recipe library — integration)

Verified live in the preview browser this session (direct `db.js`/module
calls plus real UI interaction — no AI calls needed for this phase, so no
`fetch` mocking was required):

- [x] **Auto-macros, Meals tab**: added a recipe via the new "From your
      recipes" section in the per-day add-meal form (2 servings of a
      380-kcal/serving recipe) — macros filled in as 760 kcal / 28g protein
      with zero manual entry; `recipeId`/`servings` stored on the meal
      entry; the day card shows "From recipe: `<title>` · N servings" with
      an "Open recipe" link back to the detail view.
- [x] **Auto-macros, Today's quick-log**: same computation via the new "Or
      log from a recipe" section — logged 2 servings of a 550-kcal recipe,
      confirmed 1100 kcal / 100g protein in the day's totals.
- [x] **"Add to plan" from the recipe detail view**: picked a date in a
      *different* week than the one currently open in the Meals tab (so
      `loadOrCreateMealPlan` had to create that week's plan doc from
      scratch, not just append to an already-loaded one) plus a servings
      count — the new week's plan was created correctly with the right
      per-serving-scaled macros.
- [x] **Grocery generation — batch-tag dedup**: planned the same recipe
      (with the same batch tag) on two different days, each showing
      "2 servings" and full per-day macros for both days independently —
      but "Generate from recipes" contributed that recipe's ingredients
      (e.g. "1 whole pork shoulder") only **once**, not twice, confirming
      a batch cook is shopped for once regardless of how many days it's
      portioned across.
- [x] **Grocery generation — normal (non-batch) scaling**: a second recipe
      planned without a batch tag at 2 of its 4 base servings had its
      ingredients scaled to half (e.g. "2 cup rice" → "1 cup rice") and
      contributed every time it's planned (as expected — a non-batch dish
      eaten twice genuinely needs the ingredients twice).
- [x] **Cross-recipe consolidation**: both test recipes used "chili
      powder" — the batch recipe's un-scaled 2 tbsp plus the second
      recipe's scaled 0.5 tbsp combined into a single "2.5 tbsp chili
      powder" line, confirming same-name-same-unit merging across
      different recipes.
- [x] **Unit-mismatch stays separate**: directly exercised
      `consolidateIngredients` with `1 cup flour` + `2 tbsp flour` —
      produced two separate lines ("1 cup flour", "2 tbsp flour") rather
      than an incorrect merge, matching RECIPES_MODULE_PLAN §7's explicit
      test case.
- [x] **Aisle grouping + learned overrides**: generated items grouped
      correctly under seeded categories (pork shoulder → Meat, eggs →
      Dairy, tortillas → Bakery, rice → Pantry, chili powder → Spices).
      Recategorized "pork shoulder" to Frozen via its dropdown — persisted
      to the new `aisle_overrides` store, and a subsequent "Generate from
      recipes" click correctly kept it filed under Frozen instead of
      reverting to the seed guess.
- [x] **Check-off**: tapping a grocery item toggles `checked` and applies
      `text-decoration: line-through` (confirmed via computed style, not
      just visually).
- [x] **Manual items coexist with recipe items and survive
      regeneration**: added a manual "Paper towels" item, then clicked
      "Generate from recipes" twice — the manual item was still present
      both times, while the recipe-derived items were recomputed fresh
      each time (as designed — regeneration only replaces the
      `source: "recipe"` portion of the list).
- [x] **Legacy string-array `groceryList` migration**: called
      `normalizeGroceryList(["Old plain string item", ...])` directly —
      upgraded to the new structured shape (`{id, text, name, aisle:
      "other", checked: false, source: "manual"}`) without losing any
      items, so a Phase 2 plan opened after this upgrade keeps its grocery
      list instead of it going blank.
- [x] No console errors across Meals, Today, or Recipe detail during any
      of the above, including a full clean reload afterward.

Not yet exercised: the AI weekly-generation/replan snapshot (`ai-snapshot.js`)
doesn't yet include the `recipeIndex` described in RECIPES_MODULE_PLAN §4 —
that's explicitly Phase 6d scope ("weekly generation preferring owned
recipes"), so AI-generated plans still can't reference the recipe library
yet; only manual planning (Meals tab, Today, recipe detail) does as of 6c.

## Known deviations from BUILD_GUIDE / RECIPES_MODULE_PLAN (Phase 6c)

- **`db.js` is now well past the ~400-line guideline (approaching 600).**
  BUILD_GUIDE has two rules in tension here: "no file over ~400 lines" and
  "All IndexedDB access goes through db.js... Views never import idb
  directly." Splitting db.js across multiple files (as `ai.js` was split
  in Phase 4) would fragment the single storage-access surface the second
  rule exists to protect, for a store of small, mostly-independent CRUD
  functions rather than one genuinely oversized subsystem. Kept as one
  file and flagging the tradeoff explicitly rather than making the split
  silently.
- **Grocery consolidation never attempts cross-unit-family conversion**
  (e.g. treating "1 cup" and "16 tbsp" as equivalent). RECIPES_MODULE_PLAN
  §2 says to "normalize units where safe" and §7's own test explicitly
  wants `1 cup` + `2 tbsp` to stay separate rather than risk a wrong
  merge — so "safe" was read narrowly as exact-match-after-aliasing
  (`tbsps`/`tablespoons` → `tbsp`, etc.), never arithmetic conversion
  between unit families. The failure mode is two separate grocery lines
  instead of one combined line, which is the safer direction per that
  same test case.
- **Ingredient-name singularization is a small alias/suffix heuristic, not
  a real stemmer.** Common recipe plurals (eggs, tomatoes, potatoes,
  cloves, and regular `-s`/`-ies`/`-oes` endings) consolidate correctly; a
  short protected-word list (hummus, asparagus, molasses, couscous, grits)
  guards the obvious false positives. Any plural this doesn't recognize
  just fails to consolidate (falls back to a separate line) rather than
  mangling the word — the same "list separately rather than merge wrongly"
  principle applied to names, not just units.
- **Aisle overrides are keyed by ingredient/item name only, not
  per-recipe.** If "chicken broth" should be Pantry in one context and
  something else elsewhere, there's a single global correction. Given a
  single owner's pantry doesn't actually vary by recipe, a per-recipe
  override felt like unwarranted complexity.
- **Batch-tag dedup is keyed on `(recipeId, batchTag)` together, not
  `batchTag` alone.** Two different recipes that happen to share a batch
  tag string contribute ingredients for both (correctly — they're two
  separate batch cooks), while the same recipe repeated under the same tag
  contributes once. This wasn't explicitly specified but follows directly
  from what a batch tag is supposed to mean (one cook, one recipe).
- **`meal_logs` entries logged "from a recipe" don't get a `batchTag`
  field** (unlike `meal_plans` entries, which do via the Meals tab and the
  recipe detail's "Add to plan"). Today's quick-log is about recording
  what was actually eaten *today*, not scheduling a future batch cook, so
  there's no day-spanning grouping concept for it to opt into.
- **Recipe-linked meals don't lock their macro fields.** If the owner
  later hand-edits a recipe-derived meal's macros directly (not built in
  this phase — there's no such UI yet, since the Meals/Today rows don't
  expose macro-editing for existing entries), nothing currently reconciles
  that against the recipe or clears `recipeId`. Not a regression — the
  same was already true of manually-entered meals — but worth noting if
  inline macro editing is added later.

## Phase 6d specific checks (Recipe library — coach integration)

Verified live this session — first via direct `ai-actions.js`/`ai-snapshot.js`
calls (fast, precise checks of the new logic in isolation), then end-to-end
through the real Plan tab UI with `window.fetch` intercepted to return a
canned Anthropic-shaped response (same caveat as every other AI phase: no
real API key in this environment, so model judgment/latency aren't verified,
only the client-side pipeline).

- [x] **`recipeIndex` in the snapshot**: `buildSnapshot()` now includes a
      `RECIPE LIBRARY` section listing each owned recipe with its real `[id]`,
      categories, prep method, per-serving macros, rating, and times cooked —
      confirmed a real recipe's exact `[id]` appears verbatim (needed since
      the model must echo it back in `recipeId`).
- [x] **`save_recipe` validation + apply**: hand-built a batch with one
      `save_recipe` action and two `set_meal_day` actions (one referencing a
      real recipe by id, one with a deliberately bogus id) — `validateActions`
      accepted all three with zero errors, `describeAction` produced `"New
      recipe: New Coach Invention (1 ingredient, ~300 kcal/serving)"`, and
      `applyActions` created the recipe in the library.
- [x] **`recipeId` macro auto-override, valid case**: the meal referencing a
      real 400-kcal/serving recipe at 2 servings had its macros silently
      *replaced* with the recipe-derived 800/40/100/20 — overriding the
      model's own (deliberately wrong, 999-everything) estimate — confirming
      the recipe is the source of truth once linked, not just a label.
- [x] **`recipeId` graceful fallback, invalid case**: the meal with a
      nonexistent `recipeId` kept the model's own provided macros and had
      `recipeId`/`servings` silently stripped, rather than failing the whole
      action or the whole batch.
- [x] **Undo removes the created recipe**: `undoLastAiEvent()` (both called
      directly and via the real "Undo last AI change" button in AI Activity)
      deleted the coach-created recipe entirely — a `save_recipe`'s "before"
      state is "didn't exist," so undo means delete, not restore.
- [x] **Full gate, end-to-end through the real UI**: Plan tab → "Generate
      this week" (mocked response proposing `save_recipe` for a new "Grilled
      Shrimp Bowl" recipe) → AI proposal overlay correctly showed the
      rationale plus the `"New recipe: Grilled Shrimp Bowl..."` diff line →
      Apply → the recipe appeared in `listRecipes()` with `source.type:
      "coach_generated"` → confirmed it *also* now appears in a freshly
      built snapshot, so the next planning call would see and could
      reference it — completing "→ it appears in library and next week's
      plan."
- [x] **AI Activity log**: the applied event's diff lines render correctly
      for the new action type (no special-casing needed — `describeAction`
      is already called generically per action).
- [x] No console errors across Plan, AI Activity, or a full clean reload
      throughout.

## Known deviations from BUILD_GUIDE / RECIPES_MODULE_PLAN (Phase 6d)

- **`recipeId` resolution happens in `applyActions`, not `validateActions`.**
  `validateActions` stays synchronous (matching every existing call site,
  none of which currently await it) and only format-checks `recipeId`/
  `servings`; the actual DB lookup — and the macro override or fallback it
  drives — happens in `applyActions`, which was already async and already
  the place other actions resolve refs (e.g. `exerciseName` → `exerciseId`
  happens at validation time there since the exercise library is already
  in memory via `state`, but recipes aren't kept in `state` the way
  exercises are, so an async lookup was unavoidable and `applyActions` was
  the natural place for it).
- **`save_recipe` always creates a new recipe; it never matches/updates an
  existing one by title.** RECIPES_MODULE_PLAN describes this action as
  the coach "proposing to save any meal it invents" — always a new
  invention, not editing something already owned (editing an owned recipe
  already has its own path: the recipe detail view's Edit form). If the
  model ever proposes a title that collides with an existing recipe, the
  result is two similarly-named recipes rather than a silent merge —
  acceptable for a personal single-user library the owner can tidy by hand.
- **A `set_meal_day` meal with a valid `recipeId` inherits the recipe's
  `prepMethod` (when it's one of the plan-day's allowed values), not the
  model's own guess.** The model's `prepMethod` guess for a linked meal is
  redundant once the real recipe is known, and could otherwise disagree
  with it (e.g. model says "stove" for a recipe whose prep method is
  actually "smoker"); the recipe's own value is authoritative. Recipes
  with `prepMethod: "mixed"` fall back to the model's guess instead, since
  "mixed" isn't in the meal-plan day's smaller prep-method enum.
  Recipe-linked meals in the same action can't reference a recipe created
  by a `save_recipe` action earlier in the *same* batch, since that
  recipe's id doesn't exist until after the batch applies — by design;
  see the 6d gate's own phrasing ("appears in library **and next week's
  plan**," not "this week's plan").

## Phase 6e specific checks (Recipe library — polish)

RECIPES_MODULE_PLAN §6e lists three items: cooking-mode wake-lock/timers,
aisle learning, and Paprika HTML export. **Aisle learning was already fully
built and verified in Phase 6c** (the `aisle_overrides` store plus the
recategorize-and-remember UI in `grocery-ui.js`) — §2 of the module plan
ties it directly to grocery-list generation, which is 6c's own deliverable,
so there was no remaining work for it here. This phase covers the other two.

Verified live in the preview browser this session:

- [x] **Real countdown timers**: tapping a step's timer badge starts a
      live per-second countdown (`⏱ 0:05` → ticking down), a second tap
      pauses it, and reaching zero flips the badge to `✓ done` (success
      style) and fires the completion path (toast + `navigator.vibrate` if
      available + a best-effort system notification gated on both
      `settings.notificationsEnabled` and `Notification.permission ===
      "granted"`, mirroring `nudges.js`'s existing gate exactly).
- [x] **A real, non-hypothetical bug caught by this feature**: a recipe
      created via `db.saveRecipe()` directly (bypassing
      `recipe-form.js`'s own id-assignment) had two steps both resolve to
      the same `undefined` id — their timer badges collided on the same
      DOM id (`#timer-undefined`) and showed identical, linked countdowns.
      Traced this to a real gap: `ai-recipes.js`'s `normalizeRecipeDraft`
      never assigned ids to ingredients/steps, and the Phase 6d
      `save_recipe` coach action calls `saveRecipe()` on its output
      directly — never routing through the form, which is the only place
      that previously assigned ids. Any coach-generated recipe would have
      hit this in production (colliding ingredient-checklist state too,
      not just timers). Fixed by assigning stable ids in
      `normalizeRecipeDraft` itself (preserving an existing id if the
      source already had one, e.g. a re-imported export), so every
      creation path guarantees unique ids independent of whether it passes
      through the manual form. Reproduced the exact `save_recipe` code
      path after the fix and confirmed both steps got distinct ids.
- [x] **Two independent timers don't interfere**: started one step's
      timer, confirmed the other stayed at its own untouched duration
      throughout, and that tapping a timer badge does not also toggle the
      step's highlight (`stopPropagation` on the badge's own click).
- [x] **Timers survive unrelated repaints**: since this view fully rebuilds
      its DOM on every state change, a naive implementation holding a
      reference to the button at start time would go stale on the next
      repaint. Confirmed the running countdown keeps updating correctly
      because each tick re-queries the *current* live node by a stable id
      through the outer `container` (which itself is never replaced) —
      see `cook-timer.js`.
- [x] **Wake lock**: `navigator.wakeLock.request("screen")` is attempted on
      mount and released on unmount; confirmed the try/catch swallows a
      failed acquisition with zero console errors (this sandboxed browser
      environment doesn't grant real screen wake locks, so acquisition
      itself couldn't be verified here — only that failure degrades
      silently, which is the actual requirement: "degrade silently" per
      BUILD_GUIDE/RECIPES_MODULE_PLAN). A `visibilitychange` listener
      re-requests the lock after the tab is backgrounded and returns,
      since browsers auto-release it on hide and don't reacquire on their
      own.
- [x] **Full-recipe Paprika export**: downloaded HTML for a recipe with a
      photo, structured ingredients, timed steps, and total time —
      confirmed real ingredient text ("2 cup rice, rinsed"), real step
      text, proper `schema.org` `HowToStep` entries (not the old
      "weren't tracked" placeholder), the embedded photo as a `data:`
      image, and `totalTime` correctly formatted as ISO 8601 (`PT25M`).
- [x] **Meals tab reuses the richer export for recipe-linked meals**: a
      day's meal entry with a `recipeId` now downloads the full recipe
      export (real ingredients/steps) instead of the old macros-only
      placeholder version, which is still used as-is for meals that were
      never linked to a recipe.
- [x] No console errors across Recipes, Recipe detail, or Meals during any
      of the above, including a full clean reload afterward.

Not yet exercised: real wake-lock acquisition and a real system
notification/vibration on an actual Android device — both are
platform/hardware-dependent and unavailable in this sandboxed environment;
only the code paths and graceful-degradation behavior were verified here.

## Known deviations from BUILD_GUIDE / RECIPES_MODULE_PLAN (Phase 6e)

- **A pre-existing FileReader-based `blobToDataURL` was duplicated three
  times** (`db.js`, `ai-recipes.js`'s private `blobToBase64`, and now the
  export feature needing a third copy) — consolidated into one shared
  `blobToDataURL` in `utils.js` that all three import, rather than adding
  yet another copy.
- **Wake lock is acquired once for the whole view session (view/edit
  toggling included), not re-acquired/released per edit-vs-view state.**
  "Screen wake-lock while cooking mode is open" reads naturally as "while
  this recipe's detail view is open" rather than needing to track a finer
  cooking-vs-editing distinction — releasing it the moment the owner taps
  Edit (then re-acquiring on Cancel) would add real complexity for a
  behavior nobody would actually want (why would the screen dim mid-edit
  of the same recipe you're cooking from?).
- **Timer state resets if the owner navigates away and back mid-countdown.**
  Timer state lives in a controller instance scoped to one view mount
  (`createTimerController(container)`, created fresh in `render()`), and
  the view's destroy function clears any running interval on unmount to
  avoid a leaked timer silently ticking (and potentially firing a
  notification) while the owner is looking at a different screen without
  context. The tradeoff is that a timer doesn't persist across a
  navigate-away-and-back; expecting the owner to stay on the recipe page
  while a step timer runs is a reasonable v1 scope.
- **Timer completion notifications reuse the exact same gate as
  `nudges.js`'s existing notification system** (`settings.notificationsEnabled`
  AND `Notification.permission === "granted"`) rather than adding a second,
  separate opt-in toggle specifically for cooking timers. One global
  notification preference is simpler for a single-owner app than a
  per-feature settings matrix.
