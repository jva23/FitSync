// Weekly meal planning: macro targets, per-day meals (manual or pulled from
// the recipe library with auto-computed macros), batch-cook tagging, and a
// consolidated, aisle-grouped grocery list. Actual eating/logging happens on
// Today.
import { saveMealPlan, listMealTemplates, saveMealTemplate, deleteMealTemplate, listRecipes, listAisleOverrides } from "../db.js";
import { mondayOf, weekISOFromMonday, formatWeekLabel, formatDayLabel, addDaysStr, todayLocalDate, escapeHtml } from "../utils.js";
import { loadOrCreateMealPlan } from "../meal-plan-helpers.js";
import { overridesToMap } from "../aisle.js";
import { buildGroceryCard } from "../grocery-ui.js";
import { showToast } from "../toast.js";
import { downloadRecipeHtml } from "../recipe-export.js";

const PREP_METHODS = ["grill", "smoker", "stove", "oven", "none"];

export async function render(container) {
  let weekStart = mondayOf(todayLocalDate());
  let plan = await loadOrCreateMealPlan(weekStart);
  let templates = await listMealTemplates();
  let allRecipes = await listRecipes();
  const aisleOverrides = overridesToMap(await listAisleOverrides());
  let openAddDate = null;

  paint();

  async function persist() {
    plan = await saveMealPlan(plan);
  }

  async function changeWeek(deltaDays) {
    weekStart = addDaysStr(weekStart, deltaDays);
    plan = await loadOrCreateMealPlan(weekStart);
    openAddDate = null;
    paint();
  }

  function paint() {
    container.innerHTML = "";
    container.appendChild(recipeLibraryLink());
    container.appendChild(weekNav());
    container.appendChild(targetsCard());
    container.appendChild(templatesCard());
    container.appendChild(batchSummaryCard());
    for (const day of plan.days) {
      container.appendChild(dayCard(day));
    }
    container.appendChild(buildGroceryCard(plan, persist, aisleOverrides));
  }

  function recipeLibraryLink() {
    const wrap = document.createElement("div");
    wrap.className = "card row between";
    wrap.innerHTML = `
      <div>
        <div class="section-title" style="margin:0;">Recipe library</div>
        <p class="hint" style="margin:0;">Store, scale, and cook from full recipes.</p>
      </div>
      <button class="btn sm" id="open-recipes">Open</button>
    `;
    wrap.querySelector("#open-recipes").addEventListener("click", () => (location.hash = "#/recipes"));
    return wrap;
  }

  function weekNav() {
    const wrap = document.createElement("div");
    wrap.className = "card row between";
    wrap.innerHTML = `
      <button class="icon-btn" id="prev-week" aria-label="Previous week">‹</button>
      <strong>${formatWeekLabel(weekStart)}</strong>
      <button class="icon-btn" id="next-week" aria-label="Next week">›</button>
    `;
    wrap.querySelector("#prev-week").addEventListener("click", () => changeWeek(-7));
    wrap.querySelector("#next-week").addEventListener("click", () => changeWeek(7));
    return wrap;
  }

  function targetsCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    const t = plan.targets;
    wrap.innerHTML = `
      <div class="section-title">Macro targets</div>
      <div class="row wrap">
        <div class="field" style="flex:1;min-width:80px;"><label>kcal</label><input type="number" class="t-kcal" value="${t.kcal}" /></div>
        <div class="field" style="flex:1;min-width:80px;"><label>protein g</label><input type="number" class="t-protein" value="${t.protein}" /></div>
        <div class="field" style="flex:1;min-width:80px;"><label>carbs g</label><input type="number" class="t-carbs" value="${t.carbs}" /></div>
        <div class="field" style="flex:1;min-width:80px;"><label>fat g</label><input type="number" class="t-fat" value="${t.fat}" /></div>
      </div>
      <button class="btn sm" id="save-targets">Save targets</button>
    `;
    wrap.querySelector("#save-targets").addEventListener("click", async () => {
      plan.targets = {
        kcal: Number(wrap.querySelector(".t-kcal").value) || 0,
        protein: Number(wrap.querySelector(".t-protein").value) || 0,
        carbs: Number(wrap.querySelector(".t-carbs").value) || 0,
        fat: Number(wrap.querySelector(".t-fat").value) || 0,
      };
      await persist();
    });
    return wrap;
  }

  function templatesCard() {
    if (templates.length === 0) return document.createElement("div");
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `<div class="section-title" style="margin:0;">Meal templates</div>`;
    for (const tpl of templates) {
      const row = document.createElement("div");
      row.className = "row between";
      row.innerHTML = `<span>${escapeHtml(tpl.name)} <span class="hint">${tpl.macros.kcal} kcal</span></span>`;
      const del = document.createElement("button");
      del.className = "btn sm ghost";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        await deleteMealTemplate(tpl.id);
        templates = await listMealTemplates();
        paint();
      });
      row.appendChild(del);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function batchSummaryCard() {
    const tags = new Map();
    for (const day of plan.days) {
      for (const meal of day.meals) {
        if (!meal.batchTag) continue;
        if (!tags.has(meal.batchTag)) tags.set(meal.batchTag, []);
        tags.get(meal.batchTag).push(day.date);
      }
    }
    if (tags.size === 0) return document.createElement("div");
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `<div class="section-title">Batch preps this week</div>`;
    for (const [tag, dates] of tags) {
      const p = document.createElement("p");
      p.textContent = `${tag}: ${dates.map(formatDayLabel).join(", ")}`;
      wrap.appendChild(p);
    }
    return wrap;
  }

  function dayCard(day) {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `
      <strong>${formatDayLabel(day.date)}</strong>
      <div class="stack meal-list"></div>
      <div class="add-slot"></div>
      <button class="btn sm add-meal-btn">Add meal</button>
    `;
    const list = wrap.querySelector(".meal-list");
    if (day.meals.length === 0) list.innerHTML = `<p class="hint">No meals planned.</p>`;
    day.meals.forEach((meal, i) => {
      const row = document.createElement("div");
      row.className = "card";
      row.style.background = "var(--bg-elevated)";
      const recipe = meal.recipeId ? allRecipes.find((r) => r.id === meal.recipeId) : null;
      row.innerHTML = `
        <div class="row between">
          <strong>${escapeHtml(meal.name)}</strong>
          <button class="btn sm ghost remove-meal">Remove</button>
        </div>
        ${meal.description ? `<p>${escapeHtml(meal.description)}</p>` : ""}
        ${recipe ? `<p class="hint">From recipe: ${escapeHtml(recipe.title)} · ${meal.servings || recipe.baseServings} serving${(meal.servings || recipe.baseServings) === 1 ? "" : "s"}</p>` : ""}
        <div class="row wrap">
          <span class="badge">${meal.macros.kcal} kcal</span>
          <span class="badge">${meal.macros.protein}g protein</span>
          ${meal.prepMethod && meal.prepMethod !== "none" ? `<span class="badge">${escapeHtml(meal.prepMethod)}</span>` : ""}
          ${meal.batchTag ? `<span class="badge success">${escapeHtml(meal.batchTag)}</span>` : ""}
        </div>
        <div class="row wrap" style="margin-top:8px;">
          ${recipe ? `<button class="btn sm ghost open-recipe">Open recipe</button>` : ""}
          <button class="btn sm ghost save-template">Save as template</button>
          <button class="btn sm ghost export-recipe">Export recipe (HTML)</button>
        </div>
      `;
      row.querySelector(".remove-meal").addEventListener("click", async () => {
        day.meals.splice(i, 1);
        await persist();
        paint();
      });
      const openRecipeBtn = row.querySelector(".open-recipe");
      if (openRecipeBtn) {
        openRecipeBtn.addEventListener("click", () => (location.hash = `#/recipe/${meal.recipeId}`));
      }
      row.querySelector(".save-template").addEventListener("click", async () => {
        await saveMealTemplate({
          name: meal.name,
          description: meal.description,
          macros: meal.macros,
          prepMethod: meal.prepMethod,
          batchTag: "",
        });
        templates = await listMealTemplates();
        showToast("Saved as template", { type: "success" });
        paint();
      });
      row.querySelector(".export-recipe").addEventListener("click", () => downloadRecipeHtml(meal));
      list.appendChild(row);
    });

    const addBtn = wrap.querySelector(".add-meal-btn");
    addBtn.addEventListener("click", () => {
      openAddDate = openAddDate === day.date ? null : day.date;
      paint();
    });
    if (openAddDate === day.date) {
      wrap.querySelector(".add-slot").appendChild(mealForm(day));
    }
    return wrap;
  }

  function mealForm(day) {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.style.background = "var(--bg-input)";
    wrap.innerHTML = `
      ${allRecipes.length ? `
      <div class="field">
        <label>From your recipes</label>
        <div class="row wrap">
          <select class="m-recipe" style="flex:2;min-width:160px;">
            <option value="">Choose a recipe…</option>
          </select>
          <input type="number" class="m-recipe-servings" placeholder="servings" style="flex:1;min-width:80px;" value="1" min="1" />
        </div>
        <input type="text" class="m-recipe-batch" placeholder="Batch tag (optional) — same tag on another day = cooked once" />
        <button class="btn sm" id="add-from-recipe">Add</button>
      </div>
      <hr />` : ""}
      ${templates.length ? `<div class="field"><label>Templates</label><div class="row wrap template-chips"></div></div>` : ""}
      <div class="field"><label>Name</label><input type="text" class="m-name" placeholder="e.g. Smoked pork shoulder tacos" /></div>
      <div class="field"><label>Description</label><textarea class="m-desc"></textarea></div>
      <div class="row wrap">
        <input type="number" class="m-kcal" placeholder="kcal" style="flex:1;min-width:70px;" />
        <input type="number" class="m-protein" placeholder="protein g" style="flex:1;min-width:70px;" />
        <input type="number" class="m-carbs" placeholder="carbs g" style="flex:1;min-width:70px;" />
        <input type="number" class="m-fat" placeholder="fat g" style="flex:1;min-width:70px;" />
      </div>
      <div class="field">
        <label>Prep method</label>
        <div class="row wrap prep-chips"></div>
      </div>
      <div class="field"><label>Batch tag (optional)</label><input type="text" class="m-batch" placeholder="e.g. smoked-pork-0706" /></div>
      <button class="btn primary" id="save-meal">Add to day</button>
    `;
    let prepMethod = "none";

    const recipeSelect = wrap.querySelector(".m-recipe");
    if (recipeSelect) {
      for (const r of allRecipes) {
        const opt = document.createElement("option");
        opt.value = r.id;
        opt.textContent = r.title;
        recipeSelect.appendChild(opt);
      }
      wrap.querySelector("#add-from-recipe").addEventListener("click", async () => {
        const recipeId = recipeSelect.value;
        if (!recipeId) return;
        const recipe = allRecipes.find((r) => r.id === recipeId);
        if (!recipe) return;
        const servings = Number(wrap.querySelector(".m-recipe-servings").value) || recipe.baseServings || 1;
        const n = recipe.nutritionPerServing || {};
        day.meals.push({
          name: recipe.title,
          description: recipe.description || "",
          recipeId: recipe.id,
          servings,
          macros: {
            kcal: Math.round((n.kcal || 0) * servings),
            protein: Math.round((n.protein || 0) * servings),
            carbs: Math.round((n.carbs || 0) * servings),
            fat: Math.round((n.fat || 0) * servings),
          },
          prepMethod: recipe.prepMethod || "none",
          batchTag: wrap.querySelector(".m-recipe-batch").value.trim(),
        });
        await persist();
        openAddDate = null;
        paint();
        showToast(`${recipe.title} added — macros filled in automatically`, { type: "success" });
      });
    }

    const templateChipsWrap = wrap.querySelector(".template-chips");
    if (templateChipsWrap) {
      for (const tpl of templates) {
        const chip = document.createElement("button");
        chip.className = "chip";
        chip.textContent = tpl.name;
        chip.addEventListener("click", () => {
          wrap.querySelector(".m-name").value = tpl.name;
          wrap.querySelector(".m-desc").value = tpl.description || "";
          wrap.querySelector(".m-kcal").value = tpl.macros.kcal;
          wrap.querySelector(".m-protein").value = tpl.macros.protein;
          wrap.querySelector(".m-carbs").value = tpl.macros.carbs;
          wrap.querySelector(".m-fat").value = tpl.macros.fat;
          prepMethod = tpl.prepMethod || "none";
          for (const c of chipsWrap.children) {
            c.setAttribute("aria-pressed", String(c.textContent === prepMethod));
          }
        });
        templateChipsWrap.appendChild(chip);
      }
    }

    const chipsWrap = wrap.querySelector(".prep-chips");
    for (const method of PREP_METHODS) {
      const chip = document.createElement("button");
      chip.className = "chip selectable";
      chip.textContent = method;
      chip.setAttribute("aria-pressed", String(method === prepMethod));
      chip.addEventListener("click", () => {
        prepMethod = method;
        for (const c of chipsWrap.children) c.setAttribute("aria-pressed", "false");
        chip.setAttribute("aria-pressed", "true");
      });
      chipsWrap.appendChild(chip);
    }

    wrap.querySelector("#save-meal").addEventListener("click", async () => {
      const name = wrap.querySelector(".m-name").value.trim();
      if (!name) return;
      day.meals.push({
        name,
        description: wrap.querySelector(".m-desc").value.trim(),
        macros: {
          kcal: Number(wrap.querySelector(".m-kcal").value) || 0,
          protein: Number(wrap.querySelector(".m-protein").value) || 0,
          carbs: Number(wrap.querySelector(".m-carbs").value) || 0,
          fat: Number(wrap.querySelector(".m-fat").value) || 0,
        },
        prepMethod,
        batchTag: wrap.querySelector(".m-batch").value.trim(),
      });
      await persist();
      openAddDate = null;
      paint();
    });
    return wrap;
  }
}
