import { state } from "../state.js";
import {
  getWorkoutPlanByWeek,
  saveWorkoutPlan,
  getMealPlanByWeek,
  getMealLogByDate,
  saveMealLog,
  listMealTemplates,
  saveMealTemplate,
} from "../db.js";
import { showToast } from "../toast.js";
import { kgToLb, mondayOf, weekISOFromMonday, todayLocalDate, ozToMl, mlToOz } from "../utils.js";
import { estimateMealMacros, AiError } from "../ai.js";
import { validateActions, applyActions } from "../ai-actions.js";

const WATER_STEP_OZ = 8;

export async function render(container) {
  const date = todayLocalDate();
  const weekStart = mondayOf(date);
  const plan = await getWorkoutPlanByWeek(weekISOFromMonday(weekStart));
  const day = plan?.days.find((d) => d.date === date) || null;
  const mealPlan = await getMealPlanByWeek(weekISOFromMonday(weekStart));
  const plannedMeals = mealPlan?.days.find((d) => d.date === date) || null;

  let mealLog = (await getMealLogByDate(date)) || { date, meals: [], water: 0 };
  const templates = await listMealTemplates();

  container.innerHTML = "";
  container.appendChild(profileCard());
  container.appendChild(workoutCard());
  container.appendChild(mealsCard());
  container.appendChild(waterCard());

  function profileCard() {
    const wrap = document.createElement("div");
    const profile = state.profile;
    const lastWeight = profile?.weightLog?.length
      ? kgToLb(profile.weightLog[profile.weightLog.length - 1].kg).toFixed(1)
      : null;
    wrap.className = "card";
    wrap.innerHTML = `
      <div class="section-title">Welcome back</div>
      ${profile?.goals ? `<p>Goal: ${profile.goals}</p>` : ""}
      ${lastWeight ? `<p class="num num-lg">${lastWeight}<span style="font-size:0.9rem;color:var(--text-faint);"> lb</span></p>` : ""}
    `;
    return wrap;
  }

  function workoutCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";

    if (!plan) {
      wrap.innerHTML = `
        <h2>No workout planned yet</h2>
        <p>Head to Plan to build this week, or just start an ad-hoc session.</p>
        <div class="row">
          <button class="btn" id="go-plan">Open Plan</button>
          <button class="btn primary" id="start-adhoc" style="flex:1;">Start ad-hoc workout</button>
        </div>
      `;
      wrap.querySelector("#go-plan").addEventListener("click", () => (location.hash = "#/plan"));
      wrap.querySelector("#start-adhoc").addEventListener("click", () => (location.hash = `#/log/${date}`));
      return wrap;
    }

    if (day?.isRest) {
      wrap.innerHTML = `<h2>Rest day</h2><p>Nothing scheduled today. Recover well.</p>`;
      return wrap;
    }

    if (!day || day.exercises.length === 0) {
      wrap.innerHTML = `
        <h2>No workout planned for today</h2>
        <p>Add exercises to today in Plan, or start an ad-hoc session.</p>
        <div class="row">
          <button class="btn" id="go-plan">Open Plan</button>
          <button class="btn primary" id="start-adhoc" style="flex:1;">Start ad-hoc workout</button>
        </div>
      `;
      wrap.querySelector("#go-plan").addEventListener("click", () => (location.hash = "#/plan"));
      wrap.querySelector("#start-adhoc").addEventListener("click", () => (location.hash = `#/log/${date}`));
      return wrap;
    }

    if (day.status === "done") {
      wrap.innerHTML = `
        <div class="row between">
          <h2>${day.focus || "Workout"}</h2>
          <span class="badge success">done</span>
        </div>
        <button class="btn sm ghost" id="edit-log">Edit log</button>
      `;
      wrap.querySelector("#edit-log").addEventListener("click", () => (location.hash = `#/log/${date}`));
      return wrap;
    }

    wrap.innerHTML = `
      <h2>${day.focus || "Today's workout"}</h2>
      <p>${day.exercises.length} exercise${day.exercises.length === 1 ? "" : "s"} planned</p>
      <div class="row">
        <button class="btn ghost" id="close-planned">Close as planned</button>
        <button class="btn primary" id="start-workout" style="flex:1;">Start Workout</button>
      </div>
    `;
    wrap.querySelector("#start-workout").addEventListener("click", () => (location.hash = `#/log/${date}`));
    wrap.querySelector("#close-planned").addEventListener("click", async () => {
      day.status = "done";
      await saveWorkoutPlan(plan);
      showToast("Day closed as planned", { type: "success" });
      render(container);
    });
    return wrap;
  }

  function macroTotals() {
    return mealLog.meals.reduce(
      (acc, m) => ({
        kcal: acc.kcal + (m.macros?.kcal || 0),
        protein: acc.protein + (m.macros?.protein || 0),
        carbs: acc.carbs + (m.macros?.carbs || 0),
        fat: acc.fat + (m.macros?.fat || 0),
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }

  function wireNaturalLanguageLog(wrap) {
    const resultSlot = wrap.querySelector("#nl-result");
    let pendingEstimate = null;

    wrap.querySelector("#nl-estimate").addEventListener("click", async () => {
      const input = wrap.querySelector("#nl-food");
      const text = input.value.trim();
      if (!text) return;
      const btn = wrap.querySelector("#nl-estimate");
      btn.disabled = true;
      btn.textContent = "Estimating…";
      try {
        const result = await estimateMealMacros(text);
        const { valid, errors } = validateActions(result.actions);
        const action = valid.find((a) => a.type === "log_meal_estimate");
        if (!action) throw new Error(errors[0] || "Could not estimate macros — try rephrasing.");
        pendingEstimate = action;
        renderConfirmCard();
      } catch (err) {
        showToast(err instanceof AiError ? err.message : err.message, { type: "danger", duration: 6000 });
      } finally {
        btn.disabled = false;
        btn.textContent = "Estimate with AI";
      }
    });

    function renderConfirmCard() {
      resultSlot.innerHTML = `
        <div class="card stack" style="background:var(--bg-input);">
          <div class="row between">
            <strong>${pendingEstimate.name}</strong>
            <span class="badge ${pendingEstimate.confidence === "high" ? "success" : pendingEstimate.confidence === "low" ? "warning" : ""}">${pendingEstimate.confidence} confidence</span>
          </div>
          ${pendingEstimate.assumptions ? `<p class="hint">${pendingEstimate.assumptions}</p>` : ""}
          <div class="row wrap">
            <input type="number" id="pe-kcal" value="${pendingEstimate.macros.kcal}" style="flex:1;min-width:70px;" />
            <input type="number" id="pe-protein" value="${pendingEstimate.macros.protein}" style="flex:1;min-width:70px;" />
            <input type="number" id="pe-carbs" value="${pendingEstimate.macros.carbs}" style="flex:1;min-width:70px;" />
            <input type="number" id="pe-fat" value="${pendingEstimate.macros.fat}" style="flex:1;min-width:70px;" />
          </div>
          <div class="row">
            <button class="btn ghost" id="pe-cancel">Cancel</button>
            <button class="btn primary" id="pe-log" style="flex:1;">Log it</button>
          </div>
        </div>
      `;
      resultSlot.querySelector("#pe-cancel").addEventListener("click", () => {
        pendingEstimate = null;
        resultSlot.innerHTML = "";
      });
      resultSlot.querySelector("#pe-log").addEventListener("click", async () => {
        pendingEstimate.macros = {
          kcal: Number(resultSlot.querySelector("#pe-kcal").value) || 0,
          protein: Number(resultSlot.querySelector("#pe-protein").value) || 0,
          carbs: Number(resultSlot.querySelector("#pe-carbs").value) || 0,
          fat: Number(resultSlot.querySelector("#pe-fat").value) || 0,
        };
        await applyActions([pendingEstimate], { trigger: "quick_log_meal", promptSummary: pendingEstimate.name });
        showToast("Meal logged", { type: "success" });
        render(container);
      });
    }
  }

  function mealsCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    const totals = macroTotals();
    const targets = mealPlan?.targets;
    wrap.innerHTML = `
      <div class="section-title">Today's meals</div>
      ${plannedMeals?.meals?.length ? `<p class="hint">Planned: ${plannedMeals.meals.map((m) => m.name).join(", ")}</p>` : ""}
      <div class="stack" id="meal-list"></div>
      <p class="num">${Math.round(totals.kcal)} kcal${targets ? ` / ${targets.kcal}` : ""} · ${Math.round(totals.protein)}g protein${targets ? ` / ${targets.protein}g` : ""}</p>
      <div class="field">
        <label>What did you eat?</label>
        <input type="text" id="nl-food" placeholder="e.g. leftover entraña, two eggs, a tortilla" />
      </div>
      <button class="btn primary block" id="nl-estimate">Estimate with AI</button>
      <div id="nl-result"></div>
      <hr />
      <div class="section-title" style="margin-top:0;">Or log manually</div>
      ${templates.length ? `<div class="row wrap" id="today-template-chips"></div>` : ""}
      <div class="field">
        <input type="text" id="meal-name" placeholder="Meal name" />
      </div>
      <div class="row wrap">
        <input type="number" id="meal-kcal" placeholder="kcal" style="flex:1;min-width:70px;" />
        <input type="number" id="meal-protein" placeholder="protein g" style="flex:1;min-width:70px;" />
        <input type="number" id="meal-carbs" placeholder="carbs g" style="flex:1;min-width:70px;" />
        <input type="number" id="meal-fat" placeholder="fat g" style="flex:1;min-width:70px;" />
      </div>
      <button class="btn block" id="log-meal">Log meal</button>
    `;

    wireNaturalLanguageLog(wrap);

    const templateChipsWrap = wrap.querySelector("#today-template-chips");
    if (templateChipsWrap) {
      for (const tpl of templates) {
        const chip = document.createElement("button");
        chip.className = "chip";
        chip.textContent = tpl.name;
        chip.addEventListener("click", () => {
          wrap.querySelector("#meal-name").value = tpl.name;
          wrap.querySelector("#meal-kcal").value = tpl.macros.kcal;
          wrap.querySelector("#meal-protein").value = tpl.macros.protein;
          wrap.querySelector("#meal-carbs").value = tpl.macros.carbs;
          wrap.querySelector("#meal-fat").value = tpl.macros.fat;
        });
        templateChipsWrap.appendChild(chip);
      }
    }

    const list = wrap.querySelector("#meal-list");
    if (mealLog.meals.length === 0) {
      list.innerHTML = `<p class="hint">Nothing logged yet today.</p>`;
    }
    mealLog.meals.forEach((m, i) => {
      const row = document.createElement("div");
      row.className = "stack";
      row.innerHTML = `
        <div class="row between">
          <span>${m.name} <span class="hint">${m.macros.kcal} kcal</span></span>
          <div class="row">
            <button class="btn sm ghost save-tpl">Save as template</button>
            <button class="btn sm ghost remove-meal">Remove</button>
          </div>
        </div>
      `;
      row.querySelector(".remove-meal").addEventListener("click", async () => {
        mealLog.meals.splice(i, 1);
        mealLog = await saveMealLog(mealLog);
        render(container);
      });
      row.querySelector(".save-tpl").addEventListener("click", async () => {
        await saveMealTemplate({ name: m.name, description: "", macros: m.macros, prepMethod: "none", batchTag: "" });
        showToast("Saved as template", { type: "success" });
      });
      list.appendChild(row);
    });

    wrap.querySelector("#log-meal").addEventListener("click", async () => {
      const name = wrap.querySelector("#meal-name").value.trim();
      if (!name) return;
      const macros = {
        kcal: Number(wrap.querySelector("#meal-kcal").value) || 0,
        protein: Number(wrap.querySelector("#meal-protein").value) || 0,
        carbs: Number(wrap.querySelector("#meal-carbs").value) || 0,
        fat: Number(wrap.querySelector("#meal-fat").value) || 0,
      };
      mealLog.meals.push({ name, macros, source: "manual" });
      mealLog = await saveMealLog(mealLog);
      render(container);
    });

    return wrap;
  }

  function waterCard() {
    const wrap = document.createElement("div");
    wrap.className = "card row between";
    const oz = Math.round(mlToOz(mealLog.water || 0));
    wrap.innerHTML = `
      <div>
        <div class="section-title" style="margin:0;">Water</div>
        <span class="num num-lg">${oz}<span style="font-size:0.9rem;color:var(--text-faint);"> oz</span></span>
      </div>
      <div class="row">
        <button class="btn sm" id="water-add">+${WATER_STEP_OZ}oz</button>
        <button class="btn sm ghost" id="water-reset">Reset</button>
      </div>
    `;
    wrap.querySelector("#water-add").addEventListener("click", async () => {
      mealLog.water = (mealLog.water || 0) + ozToMl(WATER_STEP_OZ);
      mealLog = await saveMealLog(mealLog);
      render(container);
    });
    wrap.querySelector("#water-reset").addEventListener("click", async () => {
      mealLog.water = 0;
      mealLog = await saveMealLog(mealLog);
      render(container);
    });
    return wrap;
  }
}
