# RECIPES_MODULE_PLAN.md — FitSync Phase 6: Recipe Library ("one stop shop")

This is an addendum to PROJECT_PLAN.md and BUILD_GUIDE.md. All rules in BUILD_GUIDE.md remain in force (no build toolchain, offline-first, AI-optional, db.js owns storage, propose→preview→apply for AI mutations, files under ~400 lines). Read all three documents before writing code.

## 1. Goal

Add a full recipe manager INTO FitSync (not a separate app): the single place the owner stores every recipe with nutritional information. Recipes become first-class citizens that meal planning, meal logging, grocery lists, and the AI coach all draw from. Reference points for feature quality: Paprika (scaling, grocery consolidation, interactive cooking mode, meal planning from recipes) and Deglaze (near-zero-friction import from anywhere).

## 2. Recipe data model (new IndexedDB stores)

### recipes
- `id`, `createdAt`, `updatedAt`
- `title`, `description`
- `source`: { type: manual | web | photo | claude_import | coach_generated, url?, sourceName?, importedAt }
- `categories`: string[] (user-defined tags: "smoker", "weeknight", "argentine", "high-protein"…)
- `baseServings`: number
- `ingredients`: [{ id, amount, unit, name, prepNote?, aisle? }] — structured, never a text blob, so scaling and grocery consolidation work
- `steps`: [{ id, title, text, timerSeconds? }]
- `prepMethod`: grill | smoker | stove | oven | none | mixed
- `times`: { prepMin?, cookMin?, totalMin? }
- `nutritionPerServing`: { kcal, protein, carbs, fat, confidence: verified | ai_estimate | unknown, assumptions? } — REQUIRED field; every recipe must have at least an AI estimate before save completes (offline saves may hold `unknown` and queue estimation)
- `photos`: blob refs (store images as Blobs in a `recipe_images` store; keep recipes store lean)
- `notes`: freeform (owner's tweaks, "Danielle approved", wood used, etc.)
- `rating`: 1–5 optional; `timesCooked`: number; `lastCookedAt`
- `batchYield?`: e.g., "1 pork shoulder ≈ 8 servings across 3 days" — links to FitSync's batchTag concept

### recipe_images
- `id`, `recipeId`, `blob`, `isPrimary`

### Integration changes to existing stores
- `meal_plans` / `meal_logs` meal entries gain optional `recipeId` + `servings`. When present, macros derive from `nutritionPerServing × servings` automatically — no re-entry.
- Grocery list generation reads structured ingredients from planned recipes, consolidates duplicates (1 egg + 2 eggs = 3 eggs; normalize units where safe), and groups by aisle. Aisle assignment: seed a default ingredient→aisle map; learn corrections (user recategorizes once → remembered in a persistent `aisle_overrides` map).

## 3. The five intake paths (the core of this phase)

All AI-assisted paths converge on ONE canonical flow: extract → structured recipe JSON → **editable review screen** → save. The review screen is mandatory for every non-manual path; extraction is never trusted blindly. Nutrition estimation runs as part of extraction (single API call — extract AND estimate together).

1. **Manual entry.** Fast form matching the schema. Ingredient rows with amount/unit/name; step rows with optional timers. "Estimate nutrition" button (Haiku) fills nutritionPerServing with confidence: ai_estimate.

2. **Import from URL (web "scraping").** CRITICAL CONSTRAINT: a client-only PWA cannot fetch arbitrary websites (CORS). Do NOT attempt direct fetch + HTML parsing as the primary path. Instead: send the URL to the Anthropic API (Sonnet) with the web fetch/search tool enabled; instruct it to retrieve the page and return the canonical recipe JSON (extracting from the page's schema.org/Recipe JSON-LD when present, otherwise from the page content) plus a nutrition estimate. Verify current tool names/params in Anthropic docs at build time. Fallback path when that fails: a "paste the recipe text" box feeding the same extraction prompt. Store source.url for attribution and revisit.

3. **Digitize printed recipes (photo).** Camera/file input → downscale client-side (max ~1600px, JPEG) → base64 → Claude vision (Sonnet) with the extraction prompt. Support multi-photo recipes (card front/back, two-page cookbook spread) in one call. Keep the original photo(s) attached to the recipe.

4. **Import Claude-created recipes (desktop/web chats).** Define the canonical recipe JSON as the interchange format and document it in a copy-pasteable prompt snippet inside the app's Settings ("Ask Claude to format any recipe using this template, then paste it here"). Import box accepts: canonical JSON (validated directly), or arbitrary pasted recipe text/markdown (routed through the extraction prompt). Also accept .json file import.

5. **Coach-generated recipes.** New AI action type `save_recipe` (payload = canonical recipe JSON). The FitSync coach and weekly meal generation can propose saving any meal it invents into the library via the standard propose→preview→apply flow. Conversely, the meal-planning snapshot now includes a compact library index (id, title, categories, prepMethod, per-serving macros, rating, timesCooked) so weekly generation PREFERS owned recipes and says so ("Tuesday: your smoked pork shoulder tacos, 2 servings").

## 4. AI contract additions (extends BUILD_GUIDE §2)

New functions in ai.js:
- `extractRecipeFromUrl(url)` — Sonnet + web tool
- `extractRecipeFromImages(blobs[])` — Sonnet vision
- `extractRecipeFromText(text)` — Haiku (cheap, frequent)
- `estimateRecipeNutrition(recipe)` — Haiku
All return `{ recipe: <canonical JSON>, warnings: string[] }`. Same JSON-only envelope discipline, fence-stripping, single retry on parse failure.

New action type for the coach envelope:
- `{ "type": "save_recipe", "recipe": { ...canonical schema... } }` — validated against the recipe schema; applied only after preview/accept like every other action.

Extraction prompt requirements: output canonical schema exactly; ingredients MUST be structured (amount/unit/name), converting prose amounts; detect timers in steps; estimate nutrition per serving with stated assumptions and confidence; never invent ingredients not present in the source; list anything ambiguous in `warnings`.

Snapshot addition: `recipeIndex` (compact, capped at ~150 recipes summarized; if the library grows beyond that, send top-rated + recently cooked + category counts).

## 5. UX requirements

- **Recipes tab** replaces or nests under Meals (builder's choice; keep bottom tabs ≤5). Library view: search (title, ingredient, category), filter chips (category, prepMethod, rating), sort by recent/most-cooked.
- **Global "+ Add Recipe"** button opens a chooser: Manual · From URL · From Photo · Paste/Import. Two taps from anywhere to start an import (Deglaze bar).
- **Review screen** (post-extraction): fully editable, warnings surfaced at top, nutrition shown with confidence badge, one-tap category chips. Save is one tap.
- **Recipe view / cooking mode**: servings stepper rescales ingredient amounts live; tap-to-check ingredients; tap a step to highlight; detected timers start on tap; screen wake-lock while cooking mode is open (`navigator.wakeLock`, degrade silently).
- **Plan from recipe**: from any recipe, "Add to plan" → pick day + servings → macros flow into that day automatically.
- **Grocery list**: generated from the week's planned recipes + manual items, aisle-grouped, consolidated, check-off with strikethrough; batch-tagged recipes contribute ingredients once.
- Nutrition confidence is always visible where macros display (small badge: ✓ verified / ~ estimate). Owner can edit numbers anywhere they appear; editing flips confidence to verified.

## 6. Build order & gates

1. **6a — Data + manual path**: stores, migration (bump IndexedDB version; migrate existing meal templates into recipes where sensible), manual entry, library view, recipe view with scaling, export/import round-trip updated to include recipes + images. Gate: create, edit, scale, and cook from a manually entered recipe offline.
2. **6b — Intake paths**: text paste extraction → photo → URL (in that order; each reuses the review screen). Gate: one real cookbook photo and one real recipe URL land in the library correctly with nutrition estimates.
3. **6c — Integration**: recipeId on meals, auto-macros, grocery list generation, "Add to plan". Gate: plan a week from library recipes and watch macros/grocery list populate with zero manual macro entry.
4. **6d — Coach integration**: `save_recipe` action, recipeIndex in snapshots, weekly generation preferring owned recipes. Gate: coach proposes a new recipe → preview → save → it appears in library and next week's plan.
5. **6e — Polish**: cooking mode wake-lock/timers, aisle learning, Paprika HTML export retained for any recipes the owner still wants mirrored there.

## 7. Testing additions (append to TESTING.md)

- Import the same recipe via URL, photo, and paste — all three produce equivalent structured results through the same review screen.
- Scale a recipe 4 → 6 servings; verify fractional amounts render sanely (1.5 tbsp, not 1.500000001).
- Grocery consolidation: two recipes sharing ingredients merge correctly; unit-mismatched duplicates (1 cup + 2 tbsp) list separately rather than merging wrongly.
- Airplane mode: manual entry, library, cooking mode, and grocery list fully work; import buttons explain the network need.
- Export → wipe → import preserves recipes INCLUDING photos.
- IndexedDB version migration: existing FitSync data survives the upgrade untouched.

## 8. Non-goals

- No social features, no recipe discovery/search of the wider web from inside the app (paste a URL instead), no pantry inventory tracking (revisit later — it's Paprika's least-used feature for most people), no separate app or sync bridge.
