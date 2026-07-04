// Exports a single meal as a standalone HTML page with schema.org Recipe
// JSON-LD, which Paprika's importer recognizes. Our data model only tracks
// a name/description/macros (no structured ingredient list or numbered
// steps), so this is honest best-effort: the description becomes the one
// instruction step, and the page says plainly that ingredients weren't
// tracked rather than inventing a fake list.
import { escapeHtml, formatAmount } from "./utils.js";

function buildRecipeHtml(meal) {
  const title = meal.name || "Meal";
  const description = meal.description || "";
  const keywords = [meal.prepMethod && meal.prepMethod !== "none" ? meal.prepMethod : null, meal.batchTag || null]
    .filter(Boolean)
    .join(", ");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: title,
    description: description || title,
    recipeIngredient: ["Ingredients weren't tracked in FitSync — add them here before saving to Paprika."],
    recipeInstructions: description || "No preparation notes recorded.",
    keywords,
    nutrition: {
      "@type": "NutritionInformation",
      calories: `${meal.macros?.kcal ?? 0} calories`,
      proteinContent: `${meal.macros?.protein ?? 0} g`,
      carbohydrateContent: `${meal.macros?.carbs ?? 0} g`,
      fatContent: `${meal.macros?.fat ?? 0} g`,
    },
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<script type="application/ld+json">${JSON.stringify(jsonLd, null, 2)}</script>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${keywords ? `<p><strong>Tags:</strong> ${escapeHtml(keywords)}</p>` : ""}
  <p>${escapeHtml(description || "No preparation notes recorded.")}</p>
  <h2>Ingredients</h2>
  <p><em>Not tracked in FitSync — edit this page (or the recipe once imported) to add them.</em></p>
  <h2>Nutrition (estimated)</h2>
  <ul>
    <li>${meal.macros?.kcal ?? 0} kcal</li>
    <li>${meal.macros?.protein ?? 0} g protein</li>
    <li>${meal.macros?.carbs ?? 0} g carbs</li>
    <li>${meal.macros?.fat ?? 0} g fat</li>
  </ul>
</body>
</html>`;
}

export function downloadRecipeHtml(meal) {
  const html = buildRecipeHtml(meal);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = (meal.name || "meal").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  a.href = url;
  a.download = `${slug || "meal"}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatIngredientLine(ing) {
  return [ing.amount ? formatAmount(ing.amount) : "", ing.unit, ing.name].filter(Boolean).join(" ") + (ing.prepNote ? `, ${ing.prepNote}` : "");
}

function toISODuration(totalMinutes) {
  if (!totalMinutes) return undefined;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `PT${h ? h + "H" : ""}${m ? m + "M" : ""}`;
}

// Full recipe export (Phase 6e) — unlike buildRecipeHtml above (which honestly
// admits meal-plan entries have no structured ingredients), a real recipe has
// real ingredients and numbered steps, so this produces a genuinely complete
// Paprika-importable page instead of a "fill this in yourself" placeholder.
function buildFullRecipeHtml(recipe, { imageDataUrl } = {}) {
  const title = recipe.title || "Recipe";
  const n = recipe.nutritionPerServing || {};
  const t = recipe.times || {};
  const keywords = [...(recipe.categories || []), recipe.prepMethod && recipe.prepMethod !== "none" ? recipe.prepMethod : null]
    .filter(Boolean)
    .join(", ");
  const ingredientLines = (recipe.ingredients || []).map(formatIngredientLine).filter(Boolean);
  const steps = recipe.steps || [];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: title,
    description: recipe.description || title,
    ...(recipe.baseServings ? { recipeYield: `${recipe.baseServings} servings` } : {}),
    recipeIngredient: ingredientLines.length ? ingredientLines : ["No ingredients recorded."],
    recipeInstructions: steps.length
      ? steps.map((s) => ({ "@type": "HowToStep", ...(s.title ? { name: s.title } : {}), text: s.text }))
      : [{ "@type": "HowToStep", text: "No steps recorded." }],
    ...(t.prepMin ? { prepTime: toISODuration(t.prepMin) } : {}),
    ...(t.cookMin ? { cookTime: toISODuration(t.cookMin) } : {}),
    ...(t.totalMin ? { totalTime: toISODuration(t.totalMin) } : {}),
    ...(keywords ? { keywords } : {}),
    ...(imageDataUrl ? { image: imageDataUrl } : {}),
    nutrition: {
      "@type": "NutritionInformation",
      calories: `${n.kcal || 0} calories`,
      proteinContent: `${n.protein || 0} g`,
      carbohydrateContent: `${n.carbs || 0} g`,
      fatContent: `${n.fat || 0} g`,
    },
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<script type="application/ld+json">${JSON.stringify(jsonLd, null, 2)}</script>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${keywords ? `<p><strong>Tags:</strong> ${escapeHtml(keywords)}</p>` : ""}
  ${recipe.description ? `<p>${escapeHtml(recipe.description)}</p>` : ""}
  ${imageDataUrl ? `<img src="${imageDataUrl}" alt="${escapeHtml(title)}" style="max-width:400px;">` : ""}
  <h2>Ingredients</h2>
  <ul>${ingredientLines.length ? ingredientLines.map((i) => `<li>${escapeHtml(i)}</li>`).join("") : "<li>No ingredients recorded.</li>"}</ul>
  <h2>Instructions</h2>
  <ol>${
    steps.length
      ? steps.map((s) => `<li>${s.title ? `<strong>${escapeHtml(s.title)}:</strong> ` : ""}${escapeHtml(s.text)}</li>`).join("")
      : "<li>No steps recorded.</li>"
  }</ol>
  <h2>Nutrition (per serving)</h2>
  <ul>
    <li>${n.kcal || 0} kcal</li>
    <li>${n.protein || 0} g protein</li>
    <li>${n.carbs || 0} g carbs</li>
    <li>${n.fat || 0} g fat</li>
  </ul>
</body>
</html>`;
}

export function downloadFullRecipeHtml(recipe, opts) {
  const html = buildFullRecipeHtml(recipe, opts);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = (recipe.title || "recipe").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  a.href = url;
  a.download = `${slug || "recipe"}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
