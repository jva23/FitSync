// Validates AI-proposed actions against a schema (dropping bad ones
// individually, never the whole batch), describes them as human-readable
// diff lines for the preview screen, and applies/undoes them against IndexedDB.
import { state } from "./state.js";
import {
  getWorkoutPlanByWeek,
  saveWorkoutPlan,
  deleteWorkoutPlan,
  getMealPlanByWeek,
  saveMealPlan,
  deleteMealPlan,
  getMealLogByDate,
  saveMealLog,
  deleteMealLog,
  getRecipe,
  saveRecipe,
  deleteRecipe,
  saveAiEvent,
  getLatestAiEvent,
} from "./db.js";
import { normalizeRecipeDraft } from "./ai-recipes.js";
import { mondayOf, weekISOFromMonday, weekDays } from "./utils.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_ISO_RE = /^\d{4}-W\d{2}$/;
const PREP_METHODS = new Set(["grill", "smoker", "stove", "oven", "none"]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function resolveExerciseId(name) {
  const match = state.exercises.find((e) => e.name.toLowerCase() === String(name).toLowerCase());
  return match ? match.id : null;
}

function validateExerciseEntry(raw) {
  if (!raw || typeof raw.exerciseName !== "string" || !raw.exerciseName.trim()) return null;
  return {
    exerciseId: resolveExerciseId(raw.exerciseName),
    name: raw.exerciseName.trim(),
    sets: Number.isFinite(Number(raw.sets)) && raw.sets > 0 ? Number(raw.sets) : 3,
    reps: typeof raw.reps === "string" || typeof raw.reps === "number" ? String(raw.reps) : "8-10",
    targetWeight: typeof raw.targetWeight === "string" ? raw.targetWeight : "",
    notes: typeof raw.notes === "string" ? raw.notes : "",
  };
}

// Returns { valid: Action[], errors: string[] }. Each valid action carries
// resolved refs (e.g. exerciseId) alongside the original fields.
//
// `allowedDates`/`allowedWeekISO` scope a call to the week it's actually
// meant to touch (e.g. replanWeek should only ever touch the current week) —
// per BUILD_GUIDE, "date within the plan week" is part of the schema check,
// not just well-formedness. Omit both to allow any well-formed date (used
// for open-ended contexts like coach chat).
export function validateActions(actions, { allowedDates, allowedWeekISO } = {}) {
  const valid = [];
  const errors = [];
  if (!Array.isArray(actions)) return { valid, errors: ["Response had no actions array."] };

  function checkDate(date) {
    if (!DATE_RE.test(date)) throw new Error("invalid or missing date");
    if (allowedDates && !allowedDates.has(date)) throw new Error(`date ${date} is outside the expected week`);
  }

  for (const action of actions) {
    const type = action?.type;
    try {
      switch (type) {
        case "replace_workout_day": {
          checkDate(action.date);
          const exercises = (action.exercises || []).map(validateExerciseEntry).filter(Boolean);
          valid.push({ type, date: action.date, focus: String(action.focus || ""), exercises });
          break;
        }
        case "update_workout_day": {
          checkDate(action.date);
          const changes = action.changes || {};
          valid.push({
            type,
            date: action.date,
            changes: {
              focus: typeof changes.focus === "string" ? changes.focus : undefined,
              addExercises: (changes.addExercises || []).map(validateExerciseEntry).filter(Boolean),
              removeExerciseNames: (changes.removeExerciseNames || []).filter((n) => typeof n === "string"),
              setAdjustments: (changes.setAdjustments || []).filter((s) => s && typeof s.exerciseName === "string"),
            },
          });
          break;
        }
        case "mark_rest_day": {
          checkDate(action.date);
          valid.push({ type, date: action.date, reason: String(action.reason || "") });
          break;
        }
        case "set_meal_day": {
          checkDate(action.date);
          if (!Array.isArray(action.meals) || action.meals.length === 0) throw new Error("missing meals");
          const meals = action.meals.map((m) => ({
            name: String(m.name || "Meal"),
            description: String(m.description || ""),
            // recipeId is only a format check here — it's resolved (and
            // dropped if it doesn't match a real recipe) at apply time,
            // since that's the first point with async DB access.
            recipeId: typeof m.recipeId === "string" && m.recipeId.trim() ? m.recipeId.trim() : undefined,
            servings: Number(m.servings) > 0 ? Number(m.servings) : undefined,
            macros: {
              kcal: num(m.macros?.kcal),
              protein: num(m.macros?.protein),
              carbs: num(m.macros?.carbs),
              fat: num(m.macros?.fat),
            },
            prepMethod: PREP_METHODS.has(m.prepMethod) ? m.prepMethod : "none",
            batchTag: typeof m.batchTag === "string" ? m.batchTag : "",
          }));
          valid.push({ type, date: action.date, meals });
          break;
        }
        case "adjust_macro_targets": {
          if (!WEEK_ISO_RE.test(action.weekISO)) throw new Error("invalid or missing weekISO");
          if (allowedWeekISO && action.weekISO !== allowedWeekISO) throw new Error(`weekISO ${action.weekISO} is outside the expected week`);
          const t = action.targets || {};
          if (!(num(t.kcal, -1) >= 0)) throw new Error("invalid targets");
          valid.push({
            type,
            weekISO: action.weekISO,
            targets: { kcal: num(t.kcal), protein: num(t.protein), carbs: num(t.carbs), fat: num(t.fat) },
            reason: String(action.reason || ""),
          });
          break;
        }
        case "log_meal_estimate": {
          if (!DATE_RE.test(action.date)) throw new Error("invalid or missing date");
          if (!action.name) throw new Error("missing name");
          valid.push({
            type,
            date: action.date,
            name: String(action.name),
            macros: {
              kcal: num(action.macros?.kcal),
              protein: num(action.macros?.protein),
              carbs: num(action.macros?.carbs),
              fat: num(action.macros?.fat),
            },
            confidence: CONFIDENCE_LEVELS.has(action.confidence) ? action.confidence : "medium",
            assumptions: String(action.assumptions || ""),
          });
          break;
        }
        case "add_note": {
          if (!action.text) throw new Error("missing text");
          valid.push({ type, text: String(action.text) });
          break;
        }
        case "save_recipe": {
          const recipe = normalizeRecipeDraft(action.recipe, {
            type: "coach_generated",
            importedAt: new Date().toISOString(),
          });
          if (!recipe.title) throw new Error("recipe has no title");
          valid.push({ type, recipe });
          break;
        }
        default:
          throw new Error(`unknown action type "${type}"`);
      }
    } catch (err) {
      errors.push(`Dropped ${type || "unlabeled"} action: ${err.message}.`);
    }
  }

  return { valid, errors };
}

// Human-readable one-liner for the preview screen. Best-effort before/after —
// not a full field-by-field diff, but enough to sanity-check at a glance.
export async function describeAction(action) {
  switch (action.type) {
    case "replace_workout_day": {
      const weekISO = weekISOFromMonday(mondayOf(action.date));
      const plan = await getWorkoutPlanByWeek(weekISO);
      const existing = plan?.days.find((d) => d.date === action.date);
      const before = existing && existing.exercises.length ? existing.focus || "workout" : "nothing planned";
      const after = `${action.focus || "Workout"} (${action.exercises.map((e) => e.name).join(", ") || "no exercises"})`;
      return `${action.date}: ${before} → ${after}`;
    }
    case "update_workout_day": {
      const bits = [];
      if (action.changes.focus) bits.push(`focus → ${action.changes.focus}`);
      if (action.changes.addExercises?.length) bits.push(`+${action.changes.addExercises.map((e) => e.name).join(", ")}`);
      if (action.changes.removeExerciseNames?.length) bits.push(`-${action.changes.removeExerciseNames.join(", ")}`);
      if (action.changes.setAdjustments?.length) bits.push(`adjust ${action.changes.setAdjustments.length} exercise(s)`);
      return `${action.date}: ${bits.join(", ") || "no changes"}`;
    }
    case "mark_rest_day":
      return `${action.date}: → Rest day${action.reason ? ` (${action.reason})` : ""}`;
    case "set_meal_day":
      return `${action.date}: meals → ${action.meals.map((m) => m.name).join(", ")}`;
    case "adjust_macro_targets":
      return `${action.weekISO} targets → ${action.targets.kcal} kcal / ${action.targets.protein}g protein${action.reason ? ` — ${action.reason}` : ""}`;
    case "log_meal_estimate":
      return `${action.date}: log "${action.name}" (~${action.macros.kcal} kcal, ${action.confidence} confidence)`;
    case "add_note":
      return `Note: ${action.text}`;
    case "save_recipe": {
      const r = action.recipe;
      const n = r.nutritionPerServing || {};
      return `New recipe: ${r.title} (${r.ingredients.length} ingredient${r.ingredients.length === 1 ? "" : "s"}, ~${n.kcal || 0} kcal/serving)`;
    }
    default:
      return JSON.stringify(action);
  }
}

function emptyPlanDraft(weekISO, date) {
  const monday = mondayOf(date);
  return {
    weekISO,
    days: weekDays(monday).map((d) => ({ date: d, focus: "", exercises: [], isRest: false, status: "planned" })),
    generatedBy: "ai",
    aiRationale: "",
  };
}

// `date` is omitted when this is created from an `adjust_macro_targets`
// action, which only carries a weekISO — the Meals view backfills any
// missing day placeholders itself when it's next opened for that week.
function emptyMealPlanDraft(weekISO, date) {
  return {
    weekISO,
    targets: { kcal: 2200, protein: 180, carbs: 200, fat: 70 },
    days: date ? weekDays(mondayOf(date)).map((d) => ({ date: d, meals: [] })) : [],
    groceryList: [],
    generatedBy: "ai",
    aiRationale: "",
  };
}

// Applies already-validated actions in one logical batch: mutates the
// affected plan/log documents, saves them, and records the batch (with an
// inverse snapshot for undo) in ai_events.
export async function applyActions(validActions, { trigger, promptSummary } = {}) {
  const plans = new Map(); // weekISO -> { before, doc }
  const mealPlans = new Map();
  const mealLogs = new Map(); // date -> { before, doc }

  async function planFor(date) {
    const weekISO = weekISOFromMonday(mondayOf(date));
    if (!plans.has(weekISO)) {
      const existing = await getWorkoutPlanByWeek(weekISO);
      plans.set(weekISO, {
        before: existing ? structuredClone(existing) : null,
        doc: existing ? structuredClone(existing) : emptyPlanDraft(weekISO, date),
      });
    }
    return plans.get(weekISO).doc;
  }

  async function mealPlanFor(dateOrWeekISO, isWeekISO = false) {
    const weekISO = isWeekISO ? dateOrWeekISO : weekISOFromMonday(mondayOf(dateOrWeekISO));
    if (!mealPlans.has(weekISO)) {
      const existing = await getMealPlanByWeek(weekISO);
      mealPlans.set(weekISO, {
        before: existing ? structuredClone(existing) : null,
        doc: existing ? structuredClone(existing) : emptyMealPlanDraft(weekISO, isWeekISO ? null : dateOrWeekISO),
      });
    }
    return mealPlans.get(weekISO).doc;
  }

  async function mealLogFor(date) {
    if (!mealLogs.has(date)) {
      const existing = await getMealLogByDate(date);
      mealLogs.set(date, {
        before: existing ? structuredClone(existing) : null,
        doc: existing ? structuredClone(existing) : { date, meals: [], water: 0 },
      });
    }
    return mealLogs.get(date).doc;
  }

  const recipeCache = new Map(); // recipeId -> recipe | null, so a batch referencing the same recipe multiple times only fetches it once.
  async function resolveRecipe(recipeId) {
    if (!recipeId) return null;
    if (!recipeCache.has(recipeId)) recipeCache.set(recipeId, await getRecipe(recipeId));
    return recipeCache.get(recipeId);
  }

  // If a meal references a real recipe, its macros are computed from that
  // recipe (nutritionPerServing x servings) rather than the model's own
  // estimate — that's the whole point of linking it. An invalid/hallucinated
  // recipeId is dropped silently and the meal falls back to the model's
  // estimated macros, rather than failing the action.
  async function resolveMeal(m) {
    if (!m.recipeId) return m;
    const recipe = await resolveRecipe(m.recipeId);
    if (!recipe) {
      const { recipeId, servings, ...rest } = m;
      return rest;
    }
    const servings = m.servings || recipe.baseServings || 1;
    const n = recipe.nutritionPerServing || {};
    return {
      ...m,
      servings,
      macros: {
        kcal: Math.round((n.kcal || 0) * servings),
        protein: Math.round((n.protein || 0) * servings),
        carbs: Math.round((n.carbs || 0) * servings),
        fat: Math.round((n.fat || 0) * servings),
      },
      prepMethod: recipe.prepMethod && PREP_METHODS.has(recipe.prepMethod) ? recipe.prepMethod : m.prepMethod,
    };
  }

  const noteTexts = [];
  const createdRecipeIds = [];

  for (const action of validActions) {
    switch (action.type) {
      case "replace_workout_day": {
        const plan = await planFor(action.date);
        const day = plan.days.find((d) => d.date === action.date);
        if (day) {
          day.focus = action.focus;
          day.exercises = action.exercises.map(({ exerciseId, name, sets, reps, targetWeight, notes }) => ({
            exerciseId,
            name,
            sets,
            reps,
            targetWeight,
            notes,
          }));
          day.isRest = false;
          day.status = "planned";
        }
        break;
      }
      case "update_workout_day": {
        const plan = await planFor(action.date);
        const day = plan.days.find((d) => d.date === action.date);
        if (day) {
          const { focus, addExercises, removeExerciseNames, setAdjustments } = action.changes;
          if (focus !== undefined) day.focus = focus;
          if (removeExerciseNames?.length) {
            const removeSet = new Set(removeExerciseNames.map((n) => n.toLowerCase()));
            day.exercises = day.exercises.filter((e) => !removeSet.has(e.name.toLowerCase()));
          }
          for (const adj of setAdjustments || []) {
            const target = day.exercises.find((e) => e.name.toLowerCase() === adj.exerciseName.toLowerCase());
            if (target) {
              if (adj.sets) target.sets = Number(adj.sets) || target.sets;
              if (adj.reps) target.reps = String(adj.reps);
              if (adj.targetWeight) target.targetWeight = String(adj.targetWeight);
            }
          }
          for (const add of addExercises || []) {
            day.exercises.push({
              exerciseId: add.exerciseId,
              name: add.name,
              sets: add.sets,
              reps: add.reps,
              targetWeight: add.targetWeight,
              notes: add.notes,
            });
          }
        }
        break;
      }
      case "mark_rest_day": {
        const plan = await planFor(action.date);
        const day = plan.days.find((d) => d.date === action.date);
        if (day) {
          day.isRest = true;
          day.exercises = [];
          day.focus = "Rest";
        }
        break;
      }
      case "set_meal_day": {
        const plan = await mealPlanFor(action.date);
        const day = plan.days.find((d) => d.date === action.date);
        if (day) day.meals = await Promise.all(action.meals.map(resolveMeal));
        break;
      }
      case "adjust_macro_targets": {
        const plan = await mealPlanFor(action.weekISO, true);
        plan.targets = action.targets;
        break;
      }
      case "log_meal_estimate": {
        const log = await mealLogFor(action.date);
        log.meals.push({
          name: action.name,
          macros: action.macros,
          source: "ai",
          confidence: action.confidence,
          assumptions: action.assumptions,
        });
        break;
      }
      case "add_note": {
        noteTexts.push(action.text);
        break;
      }
      case "save_recipe": {
        const saved = await saveRecipe(action.recipe);
        createdRecipeIds.push(saved.id);
        break;
      }
    }
  }

  for (const { doc } of plans.values()) await saveWorkoutPlan(doc);
  for (const { doc } of mealPlans.values()) await saveMealPlan(doc);
  for (const { doc } of mealLogs.values()) await saveMealLog(doc);

  const inverseSnapshot = {
    workout_plans: [...plans.entries()].map(([weekISO, { before }]) => ({ weekISO, before })),
    meal_plans: [...mealPlans.entries()].map(([weekISO, { before }]) => ({ weekISO, before })),
    meal_logs: [...mealLogs.entries()].map(([date, { before }]) => ({ date, before })),
    // A save_recipe action's "before" state is simply "didn't exist" — undo
    // deletes the created recipe rather than restoring a prior version.
    createdRecipeIds,
  };

  return saveAiEvent({
    trigger,
    promptSummary,
    actionsApplied: validActions,
    accepted: true,
    undone: false,
    inverseSnapshot,
    notes: noteTexts,
  });
}

// Logs a proposal the owner discarded, so the audit trail includes rejections too.
export async function logDiscardedProposal(trigger, promptSummary, actions) {
  return saveAiEvent({
    trigger,
    promptSummary,
    actionsApplied: actions,
    accepted: false,
    undone: false,
    inverseSnapshot: null,
  });
}

export async function undoLastAiEvent() {
  const latest = await getLatestAiEvent();
  if (!latest || !latest.accepted || latest.undone || !latest.inverseSnapshot) {
    throw new Error("Nothing to undo.");
  }
  const { inverseSnapshot } = latest;

  for (const { weekISO, before } of inverseSnapshot.workout_plans || []) {
    if (before) await saveWorkoutPlan(before);
    else {
      const current = await getWorkoutPlanByWeek(weekISO);
      if (current) await deleteWorkoutPlan(current.id);
    }
  }
  for (const { weekISO, before } of inverseSnapshot.meal_plans || []) {
    if (before) await saveMealPlan(before);
    else {
      const current = await getMealPlanByWeek(weekISO);
      if (current) await deleteMealPlan(current.id);
    }
  }
  for (const { date, before } of inverseSnapshot.meal_logs || []) {
    if (before) await saveMealLog(before);
    else {
      const current = await getMealLogByDate(date);
      if (current) await deleteMealLog(current.id);
    }
  }
  for (const recipeId of inverseSnapshot.createdRecipeIds || []) {
    await deleteRecipe(recipeId);
  }

  await saveAiEvent({ ...latest, undone: true });
}
