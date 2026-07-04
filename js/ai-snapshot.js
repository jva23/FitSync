// Builds the compact state snapshot sent with every planning call. Summarized
// in code (not raw JSON dumps) to keep prompts under ~3-4k tokens.
import { state } from "./state.js";
import {
  getWorkoutPlanByWeek,
  getMealPlanByWeek,
  listWorkoutLogs,
  listMealLogs,
} from "./db.js";
import { mondayOf, weekISOFromMonday, addDaysStr, todayLocalDate, kgToLb } from "./utils.js";

function summarizeWorkoutLog(log, exercisesById) {
  const parts = log.exercises.map((ex) => {
    const completed = (ex.sets || []).filter((s) => s.completed && s.weight);
    if (completed.length === 0) return `${ex.name}: no completed sets`;
    const top = completed.reduce((a, b) => (b.weight > a.weight ? b : a));
    return `${ex.name} top set ${top.weight}x${top.reps}`;
  });
  const readiness = log.readiness ? `, readiness ${log.readiness}/5` : "";
  return `${log.date}: ${parts.join(", ")}${readiness}`;
}

function summarizeMealAdherence(mealLogs, weekTargetsByDate) {
  return mealLogs
    .map((log) => {
      const kcal = log.meals.reduce((s, m) => s + (m.macros?.kcal || 0), 0);
      const protein = log.meals.reduce((s, m) => s + (m.macros?.protein || 0), 0);
      const target = weekTargetsByDate.get(log.date);
      const targetStr = target ? ` (target ${target.kcal}kcal/${target.protein}p)` : "";
      return `${log.date}: ${Math.round(kcal)}kcal/${Math.round(protein)}p${targetStr}`;
    })
    .join("; ");
}

export async function buildSnapshot({ weekISO, note } = {}) {
  const today = todayLocalDate();
  const fourWeeksAgo = addDaysStr(today, -28);

  const profile = state.profile || {};
  const lastWeight = profile.weightLog?.length
    ? kgToLb(profile.weightLog[profile.weightLog.length - 1].kg).toFixed(1)
    : "unknown";

  const equipmentLines = state.equipment
    .filter((e) => e.available !== false)
    .map((e) => `${e.name} (${e.category}${e.details ? ", " + e.details : ""})`)
    .join("; ") || "none listed";

  const activeProgram = state.programs.find((p) => p.active);
  const programNote = activeProgram
    ? `${activeProgram.name}: ${activeProgram.structureNotes || activeProgram.description || "no structure notes"}`
    : "no active program";

  const allWorkoutLogs = await listWorkoutLogs();
  const recentWorkoutLogs = allWorkoutLogs
    .filter((l) => l.date >= fourWeeksAgo && l.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const exercisesById = new Map(state.exercises.map((e) => [e.id, e]));
  const workoutSummary = recentWorkoutLogs.map((l) => summarizeWorkoutLog(l, exercisesById)).join("\n") || "no logs yet";

  const allMealLogs = await listMealLogs();
  const recentMealLogs = allMealLogs
    .filter((l) => l.date >= fourWeeksAgo && l.date <= today && l.meals.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  // Best-effort per-date target lookup: just use the current week's targets for the whole window.
  const currentWeekPlanForTargets = await getMealPlanByWeek(weekISOFromMonday(mondayOf(today)));
  const weekTargetsByDate = new Map();
  if (currentWeekPlanForTargets) {
    for (const d of recentMealLogs) weekTargetsByDate.set(d.date, currentWeekPlanForTargets.targets);
  }
  const mealSummary = summarizeMealAdherence(recentMealLogs, weekTargetsByDate) || "no meal logs yet";

  const targetWeekISO = weekISO || weekISOFromMonday(mondayOf(today));
  const currentPlan = await getWorkoutPlanByWeek(targetWeekISO);
  const planSummary = currentPlan
    ? currentPlan.days
        .map((d) => `${d.date} [${d.status}${d.isRest ? ", rest" : ""}]: ${d.focus || "no focus"} — ${d.exercises.map((e) => e.name).join(", ") || "no exercises"}`)
        .join("\n")
    : "no plan exists yet for this week";

  const availableExerciseNames = state.exercises.map((e) => e.name).join(", ");

  return `
PROFILE
Goals: ${profile.goals || "not set"}
Constraints/injuries: ${profile.constraints || "none noted"}
Weekly availability: ${(profile.availability || []).join(", ") || "not set"}
Latest weight: ${lastWeight} lb

EQUIPMENT (available)
${equipmentLines}

ACTIVE PROGRAM
${programNote}

LAST 4 WEEKS — WORKOUTS
${workoutSummary}

LAST 4 WEEKS — MEAL ADHERENCE
${mealSummary}

CURRENT PLAN FOR ${targetWeekISO}
${planSummary}

EXERCISE LIBRARY (use these names when possible; you may propose a new one if none fit)
${availableExerciseNames}

TODAY: ${today}
${note ? `NOTE FROM OWNER: ${note}` : ""}
`.trim();
}
