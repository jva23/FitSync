// Recipe-specific AI extraction: text paste, photo, and URL import paths
// (RECIPES_MODULE_PLAN §4). Returns { recipe: <canonical schema>, warnings }
// — a different envelope from ai.js's {rationale, actions} contract, since
// extraction produces a recipe draft for review, not a plan mutation.
import { callClaudeForJSON, SONNET_MODEL, HAIKU_MODEL } from "./ai.js";
import { blobToDataURL, uid } from "./utils.js";

const PREP_METHODS = ["grill", "smoker", "stove", "oven", "none", "mixed"];

const RECIPE_ENVELOPE_SPEC = `Respond with JSON only — no prose, no markdown fences — matching this envelope exactly:
{
  "recipe": {
    "title": "",
    "description": "",
    "baseServings": 4,
    "categories": ["short lowercase tags"],
    "ingredients": [{ "amount": 0, "unit": "", "name": "", "prepNote": "" }],
    "steps": [{ "title": "", "text": "", "timerSeconds": 0 }],
    "prepMethod": "grill|smoker|stove|oven|none|mixed",
    "times": { "prepMin": 0, "cookMin": 0, "totalMin": 0 },
    "nutritionPerServing": { "kcal": 0, "protein": 0, "carbs": 0, "fat": 0, "confidence": "ai_estimate", "assumptions": "one line of portion/estimate assumptions" },
    "notes": ""
  },
  "warnings": ["short strings — anything ambiguous, assumed, or missing from the source"]
}
Omit timerSeconds on steps with no explicit duration, and omit any of prepMin/cookMin/totalMin you can't determine, rather than guessing. Never invent ingredients or steps that aren't present in the source. If the source has no recipe at all, return "title": "" and explain why in "warnings".`;

const RECIPE_EXTRACTION_SYSTEM_PROMPT = `You are a recipe formatting assistant for a personal fitness/nutrition app. Convert the recipe you're given into the app's canonical schema: structure prose ingredient amounts into { amount, unit, name, prepNote } (e.g. "a couple cloves of garlic, minced" -> amount 2, unit "clove", name "garlic", prepNote "minced"). Detect any step with an explicit duration (e.g. "simmer 10 minutes") and set timerSeconds on it, in seconds. Estimate nutritionPerServing from the ingredients and servings, set confidence to "ai_estimate", and state your portion assumptions in one line. List anything ambiguous, missing, or assumed in "warnings" instead of silently guessing. ${RECIPE_ENVELOPE_SPEC}`;

const RECIPE_URL_SYSTEM_PROMPT = `${RECIPE_EXTRACTION_SYSTEM_PROMPT}

You have web_fetch tool access. Fetch the URL given in the user's message and prefer parsing the page's embedded schema.org/Recipe JSON-LD when present; otherwise extract from the visible page content. If the fetch fails or the page has no recipe, return "title": "" and explain why in "warnings".`;

const NUTRITION_ESTIMATE_SYSTEM_PROMPT = `You estimate per-serving nutrition for a recipe already in the app's canonical schema, from its ingredients and servings count. Be a reasonable, slightly conservative estimator and state your portion assumptions in one line. Respond with JSON only — no prose, no markdown fences:
{ "recipe": { "nutritionPerServing": { "kcal": 0, "protein": 0, "carbs": 0, "fat": 0, "confidence": "ai_estimate", "assumptions": "" } }, "warnings": [] }`;

export function normalizeRecipeDraft(raw, sourceOverride) {
  const r = raw || {};
  // Every ingredient/step needs a stable, unique id — the ingredient
  // checklist and step timers in recipe-detail.js key their state off it,
  // and a recipe created via the coach's save_recipe action (or a direct
  // canonical-JSON paste) never passes through recipe-form.js's own id
  // assignment, so this is the one place that's guaranteed to run first.
  // Preserve an id already present (e.g. re-importing an export) rather
  // than reassigning a fresh one.
  const ingredients = Array.isArray(r.ingredients)
    ? r.ingredients
        .map((i) => ({
          id: typeof i?.id === "string" && i.id ? i.id : uid(),
          amount: Number(i?.amount) || 0,
          unit: typeof i?.unit === "string" ? i.unit : "",
          name: typeof i?.name === "string" ? i.name.trim() : "",
          prepNote: typeof i?.prepNote === "string" ? i.prepNote : "",
        }))
        .filter((i) => i.name)
    : [];
  const steps = Array.isArray(r.steps)
    ? r.steps
        .map((s) => ({
          id: typeof s?.id === "string" && s.id ? s.id : uid(),
          title: typeof s?.title === "string" ? s.title : "",
          text: typeof s?.text === "string" ? s.text.trim() : "",
          timerSeconds: Number(s?.timerSeconds) || undefined,
        }))
        .filter((s) => s.text)
    : [];
  const n = r.nutritionPerServing || {};
  const kcal = Number(n.kcal) || 0;
  const protein = Number(n.protein) || 0;
  const carbs = Number(n.carbs) || 0;
  const fat = Number(n.fat) || 0;
  const hasNutrition = kcal || protein || carbs || fat;
  return {
    title: typeof r.title === "string" ? r.title.trim() : "",
    description: typeof r.description === "string" ? r.description : "",
    baseServings: Number(r.baseServings) > 0 ? Number(r.baseServings) : 4,
    categories: Array.isArray(r.categories) ? r.categories.filter((c) => typeof c === "string") : [],
    ingredients,
    steps,
    prepMethod: PREP_METHODS.includes(r.prepMethod) ? r.prepMethod : "none",
    times: {
      prepMin: Number(r.times?.prepMin) || undefined,
      cookMin: Number(r.times?.cookMin) || undefined,
      totalMin: Number(r.times?.totalMin) || undefined,
    },
    nutritionPerServing: {
      kcal,
      protein,
      carbs,
      fat,
      confidence: hasNutrition ? (n.confidence === "verified" ? "verified" : "ai_estimate") : "unknown",
      assumptions: typeof n.assumptions === "string" ? n.assumptions : "",
    },
    notes: typeof r.notes === "string" ? r.notes : "",
    ...(sourceOverride ? { source: sourceOverride } : {}),
  };
}

function normalizeResult(parsed, sourceOverride) {
  return {
    recipe: normalizeRecipeDraft(parsed?.recipe, sourceOverride),
    warnings: Array.isArray(parsed?.warnings) ? parsed.warnings.filter((w) => typeof w === "string") : [],
  };
}

async function blobToBase64(blob) {
  const dataUrl = await blobToDataURL(blob);
  return dataUrl.split(",")[1];
}

// Cheap, frequent path: pasted recipe text/markdown -> canonical recipe.
export async function extractRecipeFromText(text) {
  const messages = [{ role: "user", content: `Recipe source (pasted text):\n\n${text}` }];
  const parsed = await callClaudeForJSON(HAIKU_MODEL, RECIPE_EXTRACTION_SYSTEM_PROMPT, messages, { maxTokens: 2048 });
  return normalizeResult(parsed, { type: "claude_import", importedAt: new Date().toISOString() });
}

// One or more photos of a printed/handwritten recipe (front/back, a
// two-page spread) -> canonical recipe, via Claude vision.
export async function extractRecipeFromImages(blobs) {
  const images = await Promise.all(
    blobs.map(async (blob) => ({
      type: "image",
      source: { type: "base64", media_type: blob.type || "image/jpeg", data: await blobToBase64(blob) },
    }))
  );
  const messages = [
    {
      role: "user",
      content: [
        ...images,
        {
          type: "text",
          text: "Recipe source: photo(s) of a printed or handwritten recipe (may span multiple images, e.g. card front/back or a two-page spread). Extract the recipe.",
        },
      ],
    },
  ];
  const parsed = await callClaudeForJSON(SONNET_MODEL, RECIPE_EXTRACTION_SYSTEM_PROMPT, messages, { maxTokens: 3000 });
  return normalizeResult(parsed, { type: "photo", importedAt: new Date().toISOString() });
}

// A recipe URL -> canonical recipe, via Claude's server-side web_fetch tool.
// The URL must appear in the message text itself — the tool can only fetch
// URLs that have already appeared in the conversation.
export async function extractRecipeFromUrl(url) {
  const messages = [{ role: "user", content: `Fetch the recipe at this URL and extract it: ${url}` }];
  const parsed = await callClaudeForJSON(SONNET_MODEL, RECIPE_URL_SYSTEM_PROMPT, messages, {
    maxTokens: 3000,
    tools: [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 1, max_content_tokens: 50000 }],
  });
  return normalizeResult(parsed, { type: "web", url, importedAt: new Date().toISOString() });
}

// On-demand nutrition estimate for a recipe that already exists (the manual
// entry form's "Estimate nutrition" button) — takes the recipe as entered so
// far rather than re-extracting it from scratch.
export async function estimateRecipeNutrition(recipe) {
  const ingredientLines = (recipe.ingredients || [])
    .map((i) => `${i.amount || ""} ${i.unit || ""} ${i.name}${i.prepNote ? `, ${i.prepNote}` : ""}`.trim())
    .join("\n");
  const prompt = `Recipe: ${recipe.title || "(untitled)"}\nServings: ${recipe.baseServings || 1}\nIngredients:\n${
    ingredientLines || "(none listed)"
  }\n\nEstimate nutritionPerServing for this recipe.`;
  const messages = [{ role: "user", content: prompt }];
  const parsed = await callClaudeForJSON(HAIKU_MODEL, NUTRITION_ESTIMATE_SYSTEM_PROMPT, messages, { maxTokens: 512 });
  const n = parsed?.recipe?.nutritionPerServing || {};
  return {
    nutritionPerServing: {
      kcal: Number(n.kcal) || 0,
      protein: Number(n.protein) || 0,
      carbs: Number(n.carbs) || 0,
      fat: Number(n.fat) || 0,
      confidence: "ai_estimate",
      assumptions: typeof n.assumptions === "string" ? n.assumptions : "",
    },
    warnings: Array.isArray(parsed?.warnings) ? parsed.warnings.filter((w) => typeof w === "string") : [],
  };
}
