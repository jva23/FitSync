// Shared create/edit form for the canonical recipe schema (used by both the
// library's "Add Recipe" flow and the recipe detail view's "Edit" button).
// Reads all field values from the DOM at save time, matching how the rest of
// the app's forms (meals.js, exercises.js) work rather than mirroring every
// keystroke into a parallel JS model.
import { uid } from "./utils.js";

const PREP_METHODS = ["grill", "smoker", "stove", "oven", "none", "mixed"];

export function buildRecipeForm({ recipe, allCategories = [], onSave, onCancel } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "card stack recipe-form";

  const categories = new Set(recipe?.categories || []);
  let prepMethod = recipe?.prepMethod || "none";
  let rating = recipe?.rating || null;
  const pendingPhotos = [];

  wrap.innerHTML = `
    <div class="section-title" style="margin:0;">${recipe ? "Edit recipe" : "New recipe"}</div>
    <div class="field"><label>Title</label><input type="text" id="r-title" value="${recipe?.title ?? ""}" /></div>
    <div class="field"><label>Description</label><textarea id="r-desc">${recipe?.description ?? ""}</textarea></div>
    <div class="field"><label>Base servings</label><input type="number" id="r-servings" min="1" value="${recipe?.baseServings ?? 4}" /></div>
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
      <div class="field" style="flex:1;min-width:80px;"><label>Prep min</label><input type="number" id="r-prepmin" value="${recipe?.times?.prepMin ?? ""}" /></div>
      <div class="field" style="flex:1;min-width:80px;"><label>Cook min</label><input type="number" id="r-cookmin" value="${recipe?.times?.cookMin ?? ""}" /></div>
      <div class="field" style="flex:1;min-width:80px;"><label>Total min</label><input type="number" id="r-totalmin" value="${recipe?.times?.totalMin ?? ""}" /></div>
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
      <label>Nutrition per serving <span class="hint">(currently ${recipe?.nutritionPerServing?.confidence ?? "unknown"} — filling in any value and saving marks it verified)</span></label>
      <div class="row wrap">
        <input type="number" id="r-kcal" placeholder="kcal" value="${recipe?.nutritionPerServing?.kcal || ""}" style="flex:1;min-width:70px;" />
        <input type="number" id="r-protein" placeholder="protein g" value="${recipe?.nutritionPerServing?.protein || ""}" style="flex:1;min-width:70px;" />
        <input type="number" id="r-carbs" placeholder="carbs g" value="${recipe?.nutritionPerServing?.carbs || ""}" style="flex:1;min-width:70px;" />
        <input type="number" id="r-fat" placeholder="fat g" value="${recipe?.nutritionPerServing?.fat || ""}" style="flex:1;min-width:70px;" />
      </div>
    </div>
    <div class="field">
      <label>Rating</label>
      <div class="row wrap" id="rf-rating-chips"></div>
    </div>
    <div class="field"><label>Batch yield (optional)</label><input type="text" id="r-batch" value="${recipe?.batchYield ?? ""}" placeholder="e.g. 1 pork shoulder ≈ 8 servings across 3 days" /></div>
    <div class="field"><label>Notes</label><textarea id="r-notes">${recipe?.notes ?? ""}</textarea></div>
    <div class="field"><label>Add photos</label><input type="file" id="r-photos" accept="image/*" multiple /></div>
    <div class="row">
      <button type="button" class="btn ghost" id="r-cancel">Cancel</button>
      <button type="button" class="btn primary" id="r-save" style="flex:1;">Save recipe</button>
    </div>
  `;

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
      <input type="number" step="any" class="ing-amount" placeholder="amt" value="${ing.amount ?? ""}" style="flex:1;min-width:60px;" />
      <input type="text" class="ing-unit" placeholder="unit" value="${ing.unit ?? ""}" style="flex:1;min-width:70px;" />
      <input type="text" class="ing-name" placeholder="ingredient" value="${ing.name ?? ""}" style="flex:2;min-width:120px;" />
      <input type="text" class="ing-prep" placeholder="prep note" value="${ing.prepNote ?? ""}" style="flex:2;min-width:100px;" />
      <button type="button" class="btn sm ghost remove-row">✕</button>
    `;
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
        <input type="text" class="step-title" placeholder="Step title (optional)" value="${step.title ?? ""}" style="flex:2;min-width:120px;" />
        <input type="number" class="step-timer" placeholder="Timer sec" value="${step.timerSeconds ?? ""}" style="flex:1;min-width:90px;" />
        <button type="button" class="btn sm ghost remove-row">✕</button>
      </div>
      <textarea class="step-text" placeholder="Instructions">${step.text ?? ""}</textarea>
    `;
    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    return row;
  }
  for (const step of recipe?.steps?.length ? recipe.steps : [{}]) {
    stepRows.appendChild(stepRowEl(step));
  }
  wrap.querySelector("#rf-add-step").addEventListener("click", () => stepRows.appendChild(stepRowEl()));

  // ---- Photos: queued as File objects, downscaled + saved by the caller after the recipe itself is saved ----
  wrap.querySelector("#r-photos").addEventListener("change", (e) => {
    pendingPhotos.push(...e.target.files);
  });

  wrap.querySelector("#r-cancel").addEventListener("click", () => onCancel && onCancel());

  wrap.querySelector("#r-save").addEventListener("click", () => {
    const title = wrap.querySelector("#r-title").value.trim();
    if (!title) return;

    const kcal = Number(wrap.querySelector("#r-kcal").value) || 0;
    const protein = Number(wrap.querySelector("#r-protein").value) || 0;
    const carbs = Number(wrap.querySelector("#r-carbs").value) || 0;
    const fat = Number(wrap.querySelector("#r-fat").value) || 0;
    const hasNutrition = kcal || protein || carbs || fat;

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
      nutritionPerServing: { kcal, protein, carbs, fat, confidence: hasNutrition ? "verified" : "unknown" },
      notes: wrap.querySelector("#r-notes").value.trim(),
      rating,
      batchYield: wrap.querySelector("#r-batch").value.trim(),
    };

    onSave && onSave(draft, pendingPhotos);
  });

  return wrap;
}
