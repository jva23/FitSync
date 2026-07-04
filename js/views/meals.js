// Weekly meal planning: macro targets, per-day meals with batch-cook tagging,
// and a manual grocery list. Actual eating/logging happens on Today.
import { getMealPlanByWeek, saveMealPlan, listMealTemplates, saveMealTemplate, deleteMealTemplate } from "../db.js";
import { mondayOf, weekISOFromMonday, weekDays, formatWeekLabel, formatDayLabel, addDaysStr, todayLocalDate } from "../utils.js";
import { showToast } from "../toast.js";
import { downloadRecipeHtml } from "../recipe-export.js";

const PREP_METHODS = ["grill", "smoker", "stove", "oven", "none"];

export async function render(container) {
  let weekStart = mondayOf(todayLocalDate());
  let plan = await loadOrCreatePlan(weekStart);
  let templates = await listMealTemplates();
  let openAddDate = null;

  paint();

  async function loadOrCreatePlan(monday) {
    const weekISO = weekISOFromMonday(monday);
    const existing = await getMealPlanByWeek(weekISO);
    if (existing) return backfillDays(existing, monday);
    return {
      weekISO,
      targets: { kcal: 2200, protein: 180, carbs: 200, fat: 70 },
      days: weekDays(monday).map((date) => ({ date, meals: [] })),
      groceryList: [],
      generatedBy: "manual",
      aiRationale: "",
    };
  }

  // AI actions can create a plan doc with a partial/empty `days` array (e.g.
  // adjust_macro_targets on a brand-new week). Backfill any missing dates so
  // the view always has all 7 day cards.
  function backfillDays(plan, monday) {
    const byDate = new Map(plan.days.map((d) => [d.date, d]));
    plan.days = weekDays(monday).map((date) => byDate.get(date) || { date, meals: [] });
    return plan;
  }

  async function persist() {
    plan = await saveMealPlan(plan);
  }

  async function changeWeek(deltaDays) {
    weekStart = addDaysStr(weekStart, deltaDays);
    plan = await loadOrCreatePlan(weekStart);
    openAddDate = null;
    paint();
  }

  function paint() {
    container.innerHTML = "";
    container.appendChild(weekNav());
    container.appendChild(targetsCard());
    container.appendChild(templatesCard());
    container.appendChild(batchSummaryCard());
    for (const day of plan.days) {
      container.appendChild(dayCard(day));
    }
    container.appendChild(groceryCard());
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
      row.innerHTML = `<span>${tpl.name} <span class="hint">${tpl.macros.kcal} kcal</span></span>`;
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
      row.innerHTML = `
        <div class="row between">
          <strong>${meal.name}</strong>
          <button class="btn sm ghost remove-meal">Remove</button>
        </div>
        ${meal.description ? `<p>${meal.description}</p>` : ""}
        <div class="row wrap">
          <span class="badge">${meal.macros.kcal} kcal</span>
          <span class="badge">${meal.macros.protein}g protein</span>
          ${meal.prepMethod && meal.prepMethod !== "none" ? `<span class="badge">${meal.prepMethod}</span>` : ""}
          ${meal.batchTag ? `<span class="badge success">${meal.batchTag}</span>` : ""}
        </div>
        <div class="row wrap" style="margin-top:8px;">
          <button class="btn sm ghost save-template">Save as template</button>
          <button class="btn sm ghost export-recipe">Export recipe (HTML)</button>
        </div>
      `;
      row.querySelector(".remove-meal").addEventListener("click", async () => {
        day.meals.splice(i, 1);
        await persist();
        paint();
      });
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

  function groceryCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `
      <div class="section-title">Grocery list</div>
      <div class="stack" id="grocery-list"></div>
      <div class="row">
        <input type="text" id="grocery-item" placeholder="Add item" style="flex:1;" />
        <button class="btn sm" id="grocery-add">Add</button>
      </div>
    `;
    const list = wrap.querySelector("#grocery-list");
    if (plan.groceryList.length === 0) list.innerHTML = `<p class="hint">Nothing added yet.</p>`;
    plan.groceryList.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "row between";
      row.innerHTML = `<span>${item}</span>`;
      const del = document.createElement("button");
      del.className = "btn sm ghost";
      del.textContent = "Remove";
      del.addEventListener("click", async () => {
        plan.groceryList.splice(i, 1);
        await persist();
        paint();
      });
      row.appendChild(del);
      list.appendChild(row);
    });
    wrap.querySelector("#grocery-add").addEventListener("click", async () => {
      const input = wrap.querySelector("#grocery-item");
      const value = input.value.trim();
      if (!value) return;
      plan.groceryList.push(value);
      await persist();
      paint();
    });
    return wrap;
  }
}
