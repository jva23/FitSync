// Shared create/edit/review form for the canonical recipe schema — used by
// the library's "Add Recipe" (Manual) flow, the post-extraction review step
// for the paste/photo/URL intake paths, and the recipe detail view's "Edit"
// button.
//
// All dynamic field values are set via DOM property assignment (`.value`),
// never interpolated into `value="..."` HTML attributes. Recipe content can
// now originate from a scraped web page or photo OCR, not just the owner's
// own typing, so treating it as trusted HTML would be a stored-XSS risk —
// property assignment never parses the string as markup, so it's safe
// regardless of what characters (quotes, angle brackets, etc.) it contains.
import { uid } from "./utils.js";
import { estimateRecipeNutrition } from "./ai-recipes.js";
import { showToast } from "./toast.js";
import { AiError } from "./ai.js";

const PREP_METHODS = ["grill", "smoker", "stove", "oven", "none", "mixed"];

export function buildRecipeForm({ recipe, allCategories = [], warnings = [], onSave, onCancel } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "card stack recipe-form";

  const categories = new Set(recipe?.categories || []);
  let prepMethod = recipe?.prepMethod || "none";
  let rating = recipe?.rating || null;
  const pendingPhotos = [];

  // Tracks the nutrition values/confidence this form currently "agrees with" —
  // either what the recipe already had, or the AI's last estimate. Saving
  // without changing these numbers keeps that confidence; changing any of
  // them (by hand) flips it to "verified".
  let nutritionBaseline = {
    kcal: recipe?.nutritionPerServing?.kcal || 0,
    protein: recipe?.nutritionPerServing?.protein || 0,
    carbs: recipe?.nutritionPerServing?.carbs || 0,
    fat: recipe?.nutritionPerServing?.fat || 0,
    confidence: recipe?.nutritionPerServing?.confidence || "unknown",
    assumptions: recipe?.nutritionPerServing?.assumptions || "",
  };

  wrap.innerHTML = `
    <div id="rf-warnings"></div>
    <div class="section-title" style="margin:0;">${recipe ? "Edit recipe" : "New recipe"}</div>
    <div class="field"><label>Title</label><input type="text" id="r-title" /></div>
    <div class="field"><label>Description</label><textarea id="r-desc"></textarea></div>
    <div class="field"><label>Base servings</label><input type="number" id="r-servings" min="1" /></div>
    <div class="field">
      <label>Categories</label>
      <div class="row wrap" id="rf-cat-suggestions"></div>
      <div class="row wrap" id="rf-cat-chips"></div>
      <input type="text" id="rf-cat-input" placeholder="Type a category, press Enter" />
    </div>
    <div class="field">
      <label>Prep method</label>
      <div class="row wrap" id="rf-prep-chips"></div>
    </div>
    <div class="row wrap">
      <div class="field" style="flex:1;min-width:80px;"><label>Prep min</label><input type="number" id="r-prepmin" /></div>
      <div class="field" style="flex:1;min-width:80px;"><label>Cook min</label><input type="number" id="r-cookmin" /></div>
      <div class="field" style="flex:1;min-width:80px;"><label>Total min</label><input type="number" id="r-totalmin" /></div>
    </div>
    <div class="field">
      <label>Ingredients</label>
      <div class="stack" id="rf-ingredient-rows"></div>
      <button type="button" class="btn sm" id="rf-add-ingredient">Add ingredient</button>
    </div>
    <div class="field">
      <label>Steps</label>
      <div class="stack" id="rf-step-rows"></div>
      <button type="button" class="btn sm" id="rf-add-step">Add step</button>
    </div>
    <div class="field">
      <label>Nutrition per serving <span class="hint" id="rf-nutrition-hint"></span></label>
      <p class="hint" id="rf-nutrition-assumptions"></p>
      <button type="button" class="btn sm" id="rf-estimate-nutrition">Estimate nutrition (AI)</button>
      <div class="row wrap">
        <input type="number" id="r-kcal" placeholder="kcal" style="flex:1;min-width:70px;" />
        <input type="number" id="r-protein" placeholder="protein g" style="flex:1;min-width:70px;" />
        <input type="number" id="r-carbs" placeholder="carbs g" style="flex:1;min-width:70px;" />
        <input type="number" id="r-fat" placeholder="fat g" style="flex:1;min-width:70px;" />
      </div>
    </div>
    <div class="field">
      <label>Rating</label>
      <div class="row wrap" id="rf-rating-chips"></div>
    </div>
    <div class="field"><label>Batch yield (optional)</label><input type="text" id="r-batch" placeholder="e.g. 1 pork shoulder ≈ 8 servings across 3 days" /></div>
    <div class="field"><label>Notes</label><textarea id="r-notes"></textarea></div>
    <div class="field"><label>Add photos</label><input type="file" id="r-photos" accept="image/*" multiple /></div>
    <div class="row">
      <button type="button" class="btn ghost" id="r-cancel">Cancel</button>
      <button type="button" class="btn primary" id="r-save" style="flex:1;">Save recipe</button>
    </div>
  `;

  // ---- Fill in dynamic values via property assignment (see file header) ----
  wrap.querySelector("#r-title").value = recipe?.title ?? "";
  wrap.querySelector("#r-desc").value = recipe?.description ?? "";
  wrap.querySelector("#r-servings").value = recipe?.baseServings ?? 4;
  wrap.querySelector("#r-prepmin").value = recipe?.times?.prepMin ?? "";
  wrap.querySelector("#r-cookmin").value = recipe?.times?.cookMin ?? "";
  wrap.querySelector("#r-totalmin").value = recipe?.times?.totalMin ?? "";
  wrap.querySelector("#r-batch").value = recipe?.batchYield ?? "";
  wrap.querySelector("#r-notes").value = recipe?.notes ?? "";

  // ---- Warnings from an AI extraction pass, surfaced at the top ----
  if (warnings.length) {
    const box = wrap.querySelector("#rf-warnings");
    box.style.cssText = "border:1px solid var(--warning);border-radius:var(--radius-sm);padding:12px;margin-bottom:4px;";
    const title = document.createElement("div");
    title.className = "section-title";
    title.style.cssText = "margin:0;color:var(--warning);";
    title.textContent = "Review before saving";
    box.appendChild(title);
    const ul = document.createElement("ul");
    ul.style.cssText = "margin:8px 0 0;padding-left:18px;color:var(--text-dim);";
    for (const w of warnings) {
      const li = document.createElement("li");
      li.textContent = w;
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  // ---- Categories: free-form tags with suggestions from the rest of the library ----
  const catChips = wrap.querySelector("#rf-cat-chips");
  const catSuggestions = wrap.querySelector("#rf-cat-suggestions");

  function renderCatChips() {
    catChips.innerHTML = "";
    for (const cat of categories) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip active";
      chip.textContent = `${cat} ✕`;
      chip.addEventListener("click", () => {
        categories.delete(cat);
        renderCatChips();
        renderSuggestions();
      });
      catChips.appendChild(chip);
    }
  }

  function renderSuggestions() {
    catSuggestions.innerHTML = "";
    for (const cat of allCategories.filter((c) => !categories.has(c))) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = cat;
      chip.addEventListener("click", () => {
        categories.add(cat);
        renderCatChips();
        renderSuggestions();
      });
      catSuggestions.appendChild(chip);
    }
  }
  renderCatChips();
  renderSuggestions();

  wrap.querySelector("#rf-cat-input").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const input = e.target;
    const val = input.value.trim().toLowerCase();
    if (val && !categories.has(val)) {
      categories.add(val);
      renderCatChips();
      renderSuggestions();
    }
    input.value = "";
  });

  // ---- Prep method (single select) ----
  const prepChipsWrap = wrap.querySelector("#rf-prep-chips");
  for (const method of PREP_METHODS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip selectable";
    chip.textContent = method;
    chip.setAttribute("aria-pressed", String(method === prepMethod));
    chip.addEventListener("click", () => {
      prepMethod = method;
      for (const c of prepChipsWrap.children) c.setAttribute("aria-pressed", "false");
      chip.setAttribute("aria-pressed", "true");
    });
    prepChipsWrap.appendChild(chip);
  }

  // ---- Rating (single select, tap again to clear) ----
  const ratingWrap = wrap.querySelector("#rf-rating-chips");
  for (let i = 1; i <= 5; i++) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip selectable";
    chip.textContent = "★".repeat(i);
    chip.setAttribute("aria-pressed", String(i === rating));
    chip.addEventListener("click", () => {
      rating = rating === i ? null : i;
      for (const c of ratingWrap.children) c.setAttribute("aria-pressed", "false");
      if (rating === i) chip.setAttribute("aria-pressed", "true");
    });
    ratingWrap.appendChild(chip);
  }

  // ---- Ingredients (repeatable rows) ----
  const ingredientRows = wrap.querySelector("#rf-ingredient-rows");
  function ingredientRowEl(ing = {}) {
    const row = document.createElement("div");
    row.className = "row wrap ingredient-row";
    row.innerHTML = `
      <input type="number" step="any" class="ing-amount" placeholder="amt" style="flex:1;min-width:60px;" />
      <input type="text" class="ing-unit" placeholder="unit" style="flex:1;min-width:70px;" />
      <input type="text" class="ing-name" placeholder="ingredient" style="flex:2;min-width:120px;" />
      <input type="text" class="ing-prep" placeholder="prep note" style="flex:2;min-width:100px;" />
      <button type="button" class="btn sm ghost remove-row">✕</button>
    `;
    row.querySelector(".ing-amount").value = ing.amount ?? "";
    row.querySelector(".ing-unit").value = ing.unit ?? "";
    row.querySelector(".ing-name").value = ing.name ?? "";
    row.querySelector(".ing-prep").value = ing.prepNote ?? "";
    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    return row;
  }
  for (const ing of recipe?.ingredients?.length ? recipe.ingredients : [{}]) {
    ingredientRows.appendChild(ingredientRowEl(ing));
  }
  wrap.querySelector("#rf-add-ingredient").addEventListener("click", () => ingredientRows.appendChild(ingredientRowEl()));

  // ---- Steps (repeatable rows) ----
  const stepRows = wrap.querySelector("#rf-step-rows");
  function stepRowEl(step = {}) {
    const row = document.createElement("div");
    row.className = "stack step-row";
    row.style.cssText = "border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;";
    row.innerHTML = `
      <div class="row wrap">
        <input type="text" class="step-title" placeholder="Step title (optional)" style="flex:2;min-width:120px;" />
        <input type="number" class="step-timer" placeholder="Timer sec" style="flex:1;min-width:90px;" />
        <button type="button" class="btn sm ghost remove-row">✕</button>
      </div>
      <textarea class="step-text" placeholder="Instructions"></textarea>
    `;
    row.querySelector(".step-title").value = step.title ?? "";
    row.querySelector(".step-timer").value = step.timerSeconds ?? "";
    row.querySelector(".step-text").value = step.text ?? "";
    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    return row;
  }
  for (const step of recipe?.steps?.length ? recipe.steps : [{}]) {
    stepRows.appendChild(stepRowEl(step));
  }
  wrap.querySelector("#rf-add-step").addEventListener("click", () => stepRows.appendChild(stepRowEl()));

  // ---- Nutrition: manual fields + on-demand AI estimate ----
  const kcalInput = wrap.querySelector("#r-kcal");
  const proteinInput = wrap.querySelector("#r-protein");
  const carbsInput = wrap.querySelector("#r-carbs");
  const fatInput = wrap.querySelector("#r-fat");
  kcalInput.value = nutritionBaseline.kcal || "";
  proteinInput.value = nutritionBaseline.protein || "";
  carbsInput.value = nutritionBaseline.carbs || "";
  fatInput.value = nutritionBaseline.fat || "";

  function refreshNutritionHint() {
    wrap.querySelector("#rf-nutrition-hint").textContent =
      `(currently ${nutritionBaseline.confidence} — editing a value and saving marks it verified)`;
    wrap.querySelector("#rf-nutrition-assumptions").textContent = nutritionBaseline.assumptions || "";
  }
  refreshNutritionHint();

  const estimateBtn = wrap.querySelector("#rf-estimate-nutrition");
  estimateBtn.addEventListener("click", async () => {
    const ingredients = [...ingredientRows.querySelectorAll(".ingredient-row")]
      .map((row) => ({
        amount: Number(row.querySelector(".ing-amount").value) || 0,
        unit: row.querySelector(".ing-unit").value.trim(),
        name: row.querySelector(".ing-name").value.trim(),
        prepNote: row.querySelector(".ing-prep").value.trim(),
      }))
      .filter((i) => i.name);
    if (ingredients.length === 0) {
      showToast("Add at least one ingredient first.");
      return;
    }
    const original = estimateBtn.textContent;
    estimateBtn.disabled = true;
    estimateBtn.textContent = "Estimating…";
    try {
      const title = wrap.querySelector("#r-title").value.trim();
      const baseServings = Number(wrap.querySelector("#r-servings").value) || 1;
      const result = await estimateRecipeNutrition({ title, baseServings, ingredients });
      kcalInput.value = result.nutritionPerServing.kcal;
      proteinInput.value = result.nutritionPerServing.protein;
      carbsInput.value = result.nutritionPerServing.carbs;
      fatInput.value = result.nutritionPerServing.fat;
      nutritionBaseline = { ...result.nutritionPerServing };
      refreshNutritionHint();
      showToast("Nutrition estimated", { type: "success" });
    } catch (err) {
      showToast(err instanceof AiError ? err.message : "Couldn't estimate nutrition — try again.", { type: "danger", duration: 6000 });
    } finally {
      estimateBtn.disabled = false;
      estimateBtn.textContent = original;
    }
  });

  // ---- Photos: queued as File objects, downscaled + saved by the caller after the recipe itself is saved ----
  wrap.querySelector("#r-photos").addEventListener("change", (e) => {
    pendingPhotos.push(...e.target.files);
  });

  wrap.querySelector("#r-cancel").addEventListener("click", () => onCancel && onCancel());

  wrap.querySelector("#r-save").addEventListener("click", () => {
    const title = wrap.querySelector("#r-title").value.trim();
    if (!title) return;

    const kcal = Number(kcalInput.value) || 0;
    const protein = Number(proteinInput.value) || 0;
    const carbs = Number(carbsInput.value) || 0;
    const fat = Number(fatInput.value) || 0;
    const hasNutrition = kcal || protein || carbs || fat;
    const matchesBaseline =
      kcal === (nutritionBaseline.kcal || 0) &&
      protein === (nutritionBaseline.protein || 0) &&
      carbs === (nutritionBaseline.carbs || 0) &&
      fat === (nutritionBaseline.fat || 0);
    const confidence = !hasNutrition ? "unknown" : matchesBaseline ? nutritionBaseline.confidence : "verified";
    const assumptions = matchesBaseline ? nutritionBaseline.assumptions : "";

    const prepMin = Number(wrap.querySelector("#r-prepmin").value) || undefined;
    const cookMin = Number(wrap.querySelector("#r-cookmin").value) || undefined;
    const totalMinInput = Number(wrap.querySelector("#r-totalmin").value) || undefined;

    const ingredients = [...ingredientRows.querySelectorAll(".ingredient-row")]
      .map((row) => ({
        id: uid(),
        amount: Number(row.querySelector(".ing-amount").value) || 0,
        unit: row.querySelector(".ing-unit").value.trim(),
        name: row.querySelector(".ing-name").value.trim(),
        prepNote: row.querySelector(".ing-prep").value.trim(),
      }))
      .filter((ing) => ing.name);

    const steps = [...stepRows.querySelectorAll(".step-row")]
      .map((row) => ({
        id: uid(),
        title: row.querySelector(".step-title").value.trim(),
        text: row.querySelector(".step-text").value.trim(),
        timerSeconds: Number(row.querySelector(".step-timer").value) || undefined,
      }))
      .filter((s) => s.text);

    const draft = {
      ...(recipe || {}),
      title,
      description: wrap.querySelector("#r-desc").value.trim(),
      source: recipe?.source || { type: "manual", importedAt: new Date().toISOString() },
      categories: [...categories],
      baseServings: Number(wrap.querySelector("#r-servings").value) || 1,
      ingredients,
      steps,
      prepMethod,
      times: {
        prepMin,
        cookMin,
        totalMin: totalMinInput || (prepMin || cookMin ? (prepMin || 0) + (cookMin || 0) : undefined),
      },
      nutritionPerServing: { kcal, protein, carbs, fat, confidence, assumptions },
      notes: wrap.querySelector("#r-notes").value.trim(),
      rating,
      batchYield: wrap.querySelector("#r-batch").value.trim(),
    };

    onSave && onSave(draft, pendingPhotos);
  });

  return wrap;
}
