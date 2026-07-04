// Shared default-shape + load-or-create logic for weekly meal plans, used by
// both the Meals tab (planning a whole week) and the recipe detail view's
// "Add to plan" action (which may target a week that isn't currently open).
import { getMealPlanByWeek } from "./db.js";
import { weekISOFromMonday, weekDays } from "./utils.js";

export function defaultMealPlan(monday) {
  return {
    weekISO: weekISOFromMonday(monday),
    targets: { kcal: 2200, protein: 180, carbs: 200, fat: 70 },
    days: weekDays(monday).map((date) => ({ date, meals: [] })),
    groceryList: [],
    generatedBy: "manual",
    aiRationale: "",
  };
}

// AI actions (or a plan touching only some days) can leave `days` partial or
// out of order — always backfill so callers get all 7 dates present.
export function backfillDays(plan, monday) {
  const byDate = new Map(plan.days.map((d) => [d.date, d]));
  plan.days = weekDays(monday).map((date) => byDate.get(date) || { date, meals: [] });
  return plan;
}

export async function loadOrCreateMealPlan(monday) {
  const weekISO = weekISOFromMonday(monday);
  const existing = await getMealPlanByWeek(weekISO);
  if (existing) return backfillDays(existing, monday);
  return defaultMealPlan(monday);
}
