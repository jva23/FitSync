// Exports a single meal as a standalone HTML page with schema.org Recipe
// JSON-LD, which Paprika's importer recognizes. Our data model only tracks
// a name/description/macros (no structured ingredient list or numbered
// steps), so this is honest best-effort: the description becomes the one
// instruction step, and the page says plainly that ingredients weren't
// tracked rather than inventing a fake list.
import { escapeHtml } from "./utils.js";

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
