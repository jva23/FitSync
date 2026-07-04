// Grocery-list generation: pulls structured ingredients from the week's
// recipe-linked meals, scales them, and consolidates duplicates.
//
// Consolidation only merges entries whose (singularized name, normalized
// unit) match exactly — it never attempts cross-unit arithmetic (e.g. "1
// cup" + "2 tbsp" stays as two separate lines rather than a wrong/implied
// conversion). That's the safer failure mode per RECIPES_MODULE_PLAN §7's
// own test case.
import { scaleAmount, formatAmount, uid } from "./utils.js";
import { guessAisle } from "./aisle.js";

const PROTECTED_S_WORDS = new Set(["hummus", "asparagus", "molasses", "couscous", "grits"]);

function singularize(name) {
  const w = (name || "").trim().toLowerCase();
  if (!w || PROTECTED_S_WORDS.has(w)) return w;
  if (w.endsWith("ies") && w.length > 3) return w.slice(0, -3) + "y";
  if (w.endsWith("oes") && w.length > 3) return w.slice(0, -2);
  if ((w.endsWith("shes") || w.endsWith("ches") || w.endsWith("xes")) && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

const UNIT_ALIASES = {
  cups: "cup",
  tbsp: "tbsp",
  tbsps: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tsp: "tsp",
  tsps: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  oz: "oz",
  ozs: "oz",
  ounce: "oz",
  ounces: "oz",
  g: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  clove: "clove",
  cloves: "clove",
};

function normalizeUnit(unit) {
  const u = (unit || "").trim().toLowerCase();
  return UNIT_ALIASES[u] ?? u;
}

// Walks the week's planned meals and collects the ingredients each
// recipe-linked meal needs. Meals sharing a batchTag + recipeId only
// contribute the recipe's base ingredients ONCE (the batch was cooked a
// single time, however many days it's portioned across); meals without a
// batchTag scale by that day's own servings every time they appear.
export function collectWeekIngredients(mealPlan, recipesById) {
  const items = [];
  const batchSeen = new Set();
  for (const day of mealPlan.days || []) {
    for (const meal of day.meals || []) {
      if (!meal.recipeId) continue;
      const recipe = recipesById.get(meal.recipeId);
      if (!recipe) continue;

      if (meal.batchTag) {
        const batchKey = `${meal.recipeId}:${meal.batchTag}`;
        if (batchSeen.has(batchKey)) continue;
        batchSeen.add(batchKey);
        for (const ing of recipe.ingredients || []) {
          items.push({ ...ing, recipeTitle: recipe.title });
        }
      } else {
        const targetServings = meal.servings || recipe.baseServings || 1;
        for (const ing of recipe.ingredients || []) {
          items.push({
            ...ing,
            amount: scaleAmount(ing.amount, recipe.baseServings || 1, targetServings),
            recipeTitle: recipe.title,
          });
        }
      }
    }
  }
  return items;
}

export function consolidateIngredients(items, aisleOverrides) {
  const groups = new Map();
  for (const item of items) {
    if (!item.name) continue;
    const key = `${singularize(item.name)}|${normalizeUnit(item.unit)}`;
    if (!groups.has(key)) {
      groups.set(key, { name: item.name, unit: normalizeUnit(item.unit), amount: 0, sources: new Set() });
    }
    const g = groups.get(key);
    g.amount += Number(item.amount) || 0;
    if (item.recipeTitle) g.sources.add(item.recipeTitle);
  }
  return [...groups.values()].map((g) => {
    const text = [g.amount ? formatAmount(g.amount) : "", g.unit, g.name].filter(Boolean).join(" ");
    return {
      id: uid(),
      text,
      name: g.name,
      aisle: guessAisle(g.name, aisleOverrides),
      checked: false,
      source: "recipe",
      recipeSources: [...g.sources],
    };
  });
}

// Phase 2 stored groceryList as plain strings with no checkoff/aisle state.
// Upgrade those in place the first time a plan is loaded, so old plans keep
// their items instead of losing them to the new structured shape.
export function normalizeGroceryList(list) {
  return (list || []).map((item) =>
    typeof item === "string"
      ? { id: uid(), text: item, name: item, aisle: "other", checked: false, source: "manual" }
      : item
  );
}

// Recomputes the recipe-derived portion of a plan's grocery list from its
// currently-planned recipes, leaving manually-added items (and their
// checked state) untouched.
export function regenerateGroceryList(plan, recipesById, aisleOverrides) {
  const manual = (plan.groceryList || []).filter((item) => item.source !== "recipe");
  const ingredients = collectWeekIngredients(plan, recipesById);
  const recipeItems = consolidateIngredients(ingredients, aisleOverrides);
  return [...manual, ...recipeItems];
}
