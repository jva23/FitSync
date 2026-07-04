// Single recipe view + basic cooking mode: live servings scaling, tap-to-check
// ingredients, tap-to-highlight steps. Wake-lock and running timers are
// deferred to Phase 6e per RECIPES_MODULE_PLAN's own build order — this
// phase only needs the recipe to be genuinely cookable from, not hands-free.
import { getRecipe, saveRecipe, deleteRecipe, listRecipeImages, listRecipes, saveMealPlan } from "../db.js";
import { buildRecipeForm } from "../recipe-form.js";
import { formatAmount, scaleAmount, todayLocalDate, mondayOf, escapeHtml } from "../utils.js";
import { loadOrCreateMealPlan } from "../meal-plan-helpers.js";
import { showToast } from "../toast.js";

function confidenceMark(c) {
  if (c === "verified") return "✓ verified";
  if (c === "ai_estimate") return "~ estimate";
  return "? unknown";
}

function formatTimer(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `⏱ ${m}:${String(s).padStart(2, "0")}`;
}

export async function render(container, params) {
  const id = params?.[0];
  let recipe = id ? await getRecipe(id) : null;
  let images = recipe ? await listRecipeImages(recipe.id) : [];
  const allRecipes = await listRecipes();
  const allCategories = [...new Set(allRecipes.flatMap((r) => r.categories || []))].sort();

  let servings = recipe?.baseServings || 1;
  let editing = false;
  let addingToPlan = false;
  const checkedIngredients = new Set();
  let activeStepId = null;
  let photoObjectUrls = [];

  paint();

  function paint() {
    container.innerHTML = "";
    if (!recipe) {
      container.innerHTML = `<div class="empty-state"><p>Recipe not found.</p><button class="btn" id="back">Back to recipes</button></div>`;
      container.querySelector("#back").addEventListener("click", () => (location.hash = "#/recipes"));
      return;
    }
    if (editing) {
      container.appendChild(editForm());
      return;
    }
    container.appendChild(backLink());
    container.appendChild(headerCard());
    if (addingToPlan) container.appendChild(addToPlanCard());
    container.appendChild(servingsCard());
    container.appendChild(stepsCard());
    container.appendChild(nutritionCard());
    if (recipe.notes) container.appendChild(notesCard());
    if (images.length) container.appendChild(photosCard());
  }

  function backLink() {
    const btn = document.createElement("button");
    btn.className = "btn sm ghost";
    btn.textContent = "‹ Back to recipes";
    btn.addEventListener("click", () => (location.hash = "#/recipes"));
    return btn;
  }

  function editForm() {
    const slot = document.createElement("div");
    slot.appendChild(
      buildRecipeForm({
        recipe,
        allCategories,
        onCancel: () => {
          editing = false;
          paint();
        },
        onSave: async (draft) => {
          recipe = await saveRecipe(draft);
          servings = recipe.baseServings || 1;
          editing = false;
          showToast("Recipe updated", { type: "success" });
          paint();
        },
      })
    );
    return slot;
  }

  function headerCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    const t = recipe.times || {};
    wrap.innerHTML = `
      <h2>${escapeHtml(recipe.title)}</h2>
      ${recipe.description ? `<p>${escapeHtml(recipe.description)}</p>` : ""}
      <div class="row wrap">
        ${(recipe.categories || []).map((c) => `<span class="badge">${escapeHtml(c)}</span>`).join("")}
        ${recipe.prepMethod && recipe.prepMethod !== "none" ? `<span class="badge">${escapeHtml(recipe.prepMethod)}</span>` : ""}
        ${t.totalMin ? `<span class="badge">${t.totalMin} min total</span>` : ""}
        ${recipe.rating ? `<span class="badge">${"★".repeat(recipe.rating)}</span>` : ""}
        ${recipe.timesCooked ? `<span class="badge success">cooked ${recipe.timesCooked}×</span>` : ""}
      </div>
      ${recipe.batchYield ? `<p class="hint">${escapeHtml(recipe.batchYield)}</p>` : ""}
      <div class="row wrap">
        <button class="btn sm primary" id="add-to-plan">Add to plan</button>
        <button class="btn sm" id="mark-cooked">Mark as cooked</button>
        <button class="btn sm ghost" id="edit-recipe">Edit</button>
        <button class="btn sm danger" id="delete-recipe">Delete</button>
      </div>
    `;
    wrap.querySelector("#add-to-plan").addEventListener("click", () => {
      addingToPlan = !addingToPlan;
      paint();
    });
    wrap.querySelector("#mark-cooked").addEventListener("click", async () => {
      recipe = await saveRecipe({
        ...recipe,
        timesCooked: (recipe.timesCooked || 0) + 1,
        lastCookedAt: todayLocalDate(),
      });
      showToast("Nice — logged as cooked", { type: "success" });
      paint();
    });
    wrap.querySelector("#edit-recipe").addEventListener("click", () => {
      editing = true;
      paint();
    });
    wrap.querySelector("#delete-recipe").addEventListener("click", async () => {
      await deleteRecipe(recipe.id);
      showToast("Recipe deleted");
      location.hash = "#/recipes";
    });
    return wrap;
  }

  function addToPlanCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `
      <div class="section-title" style="margin:0;">Add to plan</div>
      <div class="row wrap">
        <div class="field" style="flex:1;min-width:140px;"><label>Day</label><input type="date" id="plan-date" /></div>
        <div class="field" style="flex:1;min-width:100px;"><label>Servings</label><input type="number" id="plan-servings" min="1" /></div>
      </div>
      <div class="field"><label>Batch tag (optional)</label><input type="text" id="plan-batch" placeholder="e.g. smoked-pork-0706" /></div>
      <div class="row">
        <button class="btn ghost" id="plan-cancel">Cancel</button>
        <button class="btn primary" id="plan-add" style="flex:1;">Add to day</button>
      </div>
    `;
    wrap.querySelector("#plan-date").value = todayLocalDate();
    wrap.querySelector("#plan-servings").value = recipe.baseServings || 1;

    wrap.querySelector("#plan-cancel").addEventListener("click", () => {
      addingToPlan = false;
      paint();
    });

    wrap.querySelector("#plan-add").addEventListener("click", async () => {
      const date = wrap.querySelector("#plan-date").value;
      if (!date) return;
      const planServings = Number(wrap.querySelector("#plan-servings").value) || recipe.baseServings || 1;
      const batchTag = wrap.querySelector("#plan-batch").value.trim();

      const plan = await loadOrCreateMealPlan(mondayOf(date));
      const day = plan.days.find((d) => d.date === date);
      if (!day) return;
      const n = recipe.nutritionPerServing || {};
      day.meals.push({
        name: recipe.title,
        description: recipe.description || "",
        recipeId: recipe.id,
        servings: planServings,
        macros: {
          kcal: Math.round((n.kcal || 0) * planServings),
          protein: Math.round((n.protein || 0) * planServings),
          carbs: Math.round((n.carbs || 0) * planServings),
          fat: Math.round((n.fat || 0) * planServings),
        },
        prepMethod: recipe.prepMethod || "none",
        batchTag,
      });
      await saveMealPlan(plan);
      addingToPlan = false;
      showToast(`Added to ${date}`, { type: "success" });
      paint();
    });

    return wrap;
  }

  function servingsCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `
      <div class="row between">
        <div class="section-title" style="margin:0;">Ingredients</div>
        <div class="stepper">
          <button type="button" id="serv-minus">−</button>
          <span class="num">${servings}</span>
          <button type="button" id="serv-plus">+</button>
        </div>
      </div>
      <div class="stack" id="ingredient-list"></div>
    `;
    wrap.querySelector("#serv-minus").addEventListener("click", () => {
      if (servings > 1) servings -= 1;
      paint();
    });
    wrap.querySelector("#serv-plus").addEventListener("click", () => {
      servings += 1;
      paint();
    });
    const list = wrap.querySelector("#ingredient-list");
    if (!recipe.ingredients?.length) {
      list.innerHTML = `<p class="hint">No ingredients recorded.</p>`;
    }
    for (const ing of recipe.ingredients || []) {
      const row = document.createElement("div");
      row.className = "row between";
      row.style.cursor = "pointer";
      const amount = ing.amount ? formatAmount(scaleAmount(ing.amount, recipe.baseServings || 1, servings)) : "";
      const checked = checkedIngredients.has(ing.id);
      const label = [amount, ing.unit, ing.name].filter(Boolean).join(" ") + (ing.prepNote ? `, ${ing.prepNote}` : "");
      row.innerHTML = `<span style="${checked ? "text-decoration:line-through;color:var(--text-faint);" : ""}">${escapeHtml(label)}</span>`;
      row.addEventListener("click", () => {
        if (checked) checkedIngredients.delete(ing.id);
        else checkedIngredients.add(ing.id);
        paint();
      });
      list.appendChild(row);
    }
    return wrap;
  }

  function stepsCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `<div class="section-title" style="margin:0;">Steps</div>`;
    if (!recipe.steps?.length) {
      wrap.innerHTML += `<p class="hint">No steps recorded.</p>`;
      return wrap;
    }
    recipe.steps.forEach((step, i) => {
      const row = document.createElement("div");
      const active = activeStepId === step.id;
      row.className = "card";
      row.style.background = active ? "var(--ember-dim)" : "var(--bg-elevated)";
      row.style.cursor = "pointer";
      row.innerHTML = `
        <div class="row between">
          <strong>${i + 1}. ${escapeHtml(step.title || "")}</strong>
          ${step.timerSeconds ? `<span class="badge">${formatTimer(step.timerSeconds)}</span>` : ""}
        </div>
        <p>${escapeHtml(step.text)}</p>
      `;
      row.addEventListener("click", () => {
        activeStepId = active ? null : step.id;
        paint();
      });
      wrap.appendChild(row);
    });
    return wrap;
  }

  function nutritionCard() {
    const wrap = document.createElement("div");
    wrap.className = "card";
    const n = recipe.nutritionPerServing || {};
    wrap.innerHTML = `
      <div class="section-title" style="margin:0;">Nutrition per serving <span class="hint">(${confidenceMark(n.confidence)})</span></div>
      <div class="row wrap">
        <span class="badge">${n.kcal || 0} kcal</span>
        <span class="badge">${n.protein || 0}g protein</span>
        <span class="badge">${n.carbs || 0}g carbs</span>
        <span class="badge">${n.fat || 0}g fat</span>
      </div>
    `;
    return wrap;
  }

  function notesCard() {
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `<div class="section-title" style="margin:0;">Notes</div><p>${escapeHtml(recipe.notes)}</p>`;
    return wrap;
  }

  function photosCard() {
    for (const url of photoObjectUrls) URL.revokeObjectURL(url);
    photoObjectUrls = [];
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `<div class="section-title" style="margin:0;">Photos</div><div class="row wrap" id="photo-row"></div>`;
    const row = wrap.querySelector("#photo-row");
    for (const img of images) {
      const url = URL.createObjectURL(img.blob);
      photoObjectUrls.push(url);
      const el = document.createElement("img");
      el.src = url;
      el.style.cssText = "width:100px;height:100px;object-fit:cover;border-radius:var(--radius-sm);";
      row.appendChild(el);
    }
    return wrap;
  }

  return () => {
    for (const url of photoObjectUrls) URL.revokeObjectURL(url);
  };
}
