// Weekly workout planner. One workout_plans record per weekISO holding 7 days.
import { getWorkoutPlanByWeek, saveWorkoutPlan } from "../db.js";
import { state } from "../state.js";
import { mondayOf, weekISOFromMonday, weekDays, formatWeekLabel, formatDayLabel, addDaysStr, todayLocalDate, isToday } from "../utils.js";
import { generateWeek, replanWeek, AiError } from "../ai.js";
import { validateActions, applyActions, logDiscardedProposal } from "../ai-actions.js";
import { showAiPreview } from "../ai-preview.js";
import { showToast } from "../toast.js";

export async function render(container) {
  let weekStart = mondayOf(todayLocalDate());
  let plan = await loadOrCreatePlan(weekStart);
  let openPickerDate = null;
  let aiBusy = false;

  paint();

  async function loadOrCreatePlan(monday) {
    const weekISO = weekISOFromMonday(monday);
    const existing = await getWorkoutPlanByWeek(weekISO);
    if (existing) return existing;
    return {
      weekISO,
      days: weekDays(monday).map((date) => ({
        date,
        focus: "",
        exercises: [],
        isRest: false,
        status: "planned",
      })),
      generatedBy: "manual",
      aiRationale: "",
    };
  }

  async function persist() {
    plan = await saveWorkoutPlan(plan);
  }

  function ownedCategories() {
    const owned = new Set(["bodyweight"]);
    for (const eq of state.equipment) {
      if (eq.available !== false) owned.add(eq.category);
    }
    return owned;
  }

  async function changeWeek(deltaDays) {
    weekStart = addDaysStr(weekStart, deltaDays);
    plan = await loadOrCreatePlan(weekStart);
    openPickerDate = null;
    paint();
  }

  async function repeatLastWeek() {
    const prevMonday = addDaysStr(weekStart, -7);
    const prevPlan = await getWorkoutPlanByWeek(weekISOFromMonday(prevMonday));
    if (!prevPlan) return;
    const days = weekDays(weekStart);
    plan.days = prevPlan.days.map((d, i) => ({
      date: days[i],
      focus: d.focus,
      exercises: d.exercises.map((e) => ({ ...e })),
      isRest: d.isRest,
      status: "planned",
    }));
    await persist();
    paint();
  }

  async function runAiFlow({ trigger, promptSummary, call, validateOpts }) {
    if (aiBusy) return;
    aiBusy = true;
    paint();
    try {
      const result = await call();
      const { valid, errors } = validateActions(result.actions, validateOpts);
      const decision = await showAiPreview({ rationale: result.rationale, valid, errors });
      if (decision === "applied") {
        await applyActions(valid, { trigger, promptSummary });
        showToast("AI changes applied", { type: "success" });
        plan = await loadOrCreatePlan(weekStart);
      } else {
        await logDiscardedProposal(trigger, promptSummary, result.actions);
        showToast("Discarded — nothing changed");
      }
    } catch (err) {
      showToast(err instanceof AiError ? err.message : "AI request failed — plan unchanged.", {
        type: "danger",
        duration: 6000,
      });
    } finally {
      aiBusy = false;
      paint();
    }
  }

  function aiActionsCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    const isCurrentWeek = weekStart === mondayOf(todayLocalDate());
    wrap.innerHTML = `
      <div class="section-title" style="margin:0;">AI planning</div>
      <div class="field">
        <input type="text" id="ai-note" placeholder="Optional note (e.g. traveling Thursday)" ${aiBusy ? "disabled" : ""} />
      </div>
      <div class="row wrap">
        <button class="btn" id="ai-generate" ${aiBusy ? "disabled" : ""}>${aiBusy ? "Thinking…" : "Generate this week"}</button>
        ${isCurrentWeek ? `<button class="btn" id="ai-replan" ${aiBusy ? "disabled" : ""}>${aiBusy ? "Thinking…" : "Replan remainder"}</button>` : ""}
      </div>
    `;
    wrap.querySelector("#ai-generate").addEventListener("click", () => {
      const note = wrap.querySelector("#ai-note").value.trim();
      runAiFlow({
        trigger: "manual_replan",
        promptSummary: `Generate week ${plan.weekISO}${note ? ` (${note})` : ""}`,
        call: () => generateWeek({ weekISO: plan.weekISO, note }),
        validateOpts: { allowedDates: new Set(weekDays(weekStart)), allowedWeekISO: plan.weekISO },
      });
    });
    const replanBtn = wrap.querySelector("#ai-replan");
    if (replanBtn) {
      replanBtn.addEventListener("click", () => {
        const note = wrap.querySelector("#ai-note").value.trim() || "Replan the rest of this week.";
        const currentMonday = mondayOf(todayLocalDate());
        runAiFlow({
          trigger: "manual_replan",
          promptSummary: `Replan remainder of ${plan.weekISO}: ${note}`,
          call: () => replanWeek(note),
          validateOpts: {
            allowedDates: new Set(weekDays(currentMonday)),
            allowedWeekISO: weekISOFromMonday(currentMonday),
          },
        });
      });
    }
    return wrap;
  }

  function paint() {
    container.innerHTML = "";
    container.appendChild(weekNav());
    container.appendChild(aiActionsCard());
    for (const day of plan.days) {
      container.appendChild(dayCard(day));
    }
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

    const allEmpty = plan.days.every((d) => d.exercises.length === 0 && !d.isRest);
    if (allEmpty) {
      const repeatBtn = document.createElement("button");
      repeatBtn.className = "btn sm ghost";
      repeatBtn.textContent = "Repeat last week";
      repeatBtn.addEventListener("click", repeatLastWeek);
      wrap.appendChild(repeatBtn);
    }
    return wrap;
  }

  function dayCard(day) {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    const today = isToday(day.date);
    wrap.innerHTML = `
      <div class="row between">
        <strong>${formatDayLabel(day.date)}${today ? ' <span class="badge">today</span>' : ""}</strong>
        <span class="badge ${day.status === "done" ? "success" : day.status === "missed" ? "warning" : ""}">${day.status}</span>
      </div>
      <div class="row">
        <input type="text" class="focus-input" placeholder="Focus (e.g. Upper push)" value="${day.focus}" ${day.isRest ? "disabled" : ""} style="flex:1;" />
        <button class="chip selectable rest-toggle" aria-pressed="${day.isRest}">Rest day</button>
      </div>
      <div class="stack ex-list"></div>
      <div class="picker-slot"></div>
      ${day.isRest ? "" : `<button class="btn sm add-ex-btn">Add exercise</button>`}
    `;

    wrap.querySelector(".focus-input").addEventListener("change", async (e) => {
      day.focus = e.target.value.trim();
      await persist();
    });

    wrap.querySelector(".rest-toggle").addEventListener("click", async () => {
      day.isRest = !day.isRest;
      if (day.isRest) day.exercises = [];
      await persist();
      paint();
    });

    const exList = wrap.querySelector(".ex-list");
    for (const ex of day.exercises) {
      exList.appendChild(exerciseRow(day, ex));
    }

    const addBtn = wrap.querySelector(".add-ex-btn");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        openPickerDate = openPickerDate === day.date ? null : day.date;
        paint();
      });
    }

    if (openPickerDate === day.date) {
      wrap.querySelector(".picker-slot").appendChild(exercisePicker(day));
    }

    return wrap;
  }

  function exerciseRow(day, ex) {
    const row = document.createElement("div");
    row.className = "card";
    row.style.background = "var(--bg-elevated)";
    row.innerHTML = `
      <div class="row between">
        <strong>${ex.name}</strong>
        <button class="btn sm ghost remove-ex">Remove</button>
      </div>
      <div class="row wrap" style="margin-top:8px;">
        <div class="field" style="flex:1;min-width:80px;">
          <label>Sets</label>
          <input type="number" class="f-sets" min="1" value="${ex.sets}" />
        </div>
        <div class="field" style="flex:1;min-width:80px;">
          <label>Reps</label>
          <input type="text" class="f-reps" value="${ex.reps}" />
        </div>
        <div class="field" style="flex:1;min-width:100px;">
          <label>Target weight</label>
          <input type="text" class="f-weight" value="${ex.targetWeight || ""}" placeholder="e.g. 135" />
        </div>
      </div>
      <div class="field">
        <label>Notes</label>
        <input type="text" class="f-notes" value="${ex.notes || ""}" />
      </div>
    `;
    row.querySelector(".remove-ex").addEventListener("click", async () => {
      day.exercises = day.exercises.filter((e) => e !== ex);
      await persist();
      paint();
    });
    row.querySelector(".f-sets").addEventListener("change", async (e) => {
      ex.sets = Number(e.target.value) || 1;
      await persist();
    });
    row.querySelector(".f-reps").addEventListener("change", async (e) => {
      ex.reps = e.target.value.trim();
      await persist();
    });
    row.querySelector(".f-weight").addEventListener("change", async (e) => {
      ex.targetWeight = e.target.value.trim();
      await persist();
    });
    row.querySelector(".f-notes").addEventListener("change", async (e) => {
      ex.notes = e.target.value.trim();
      await persist();
    });
    return row;
  }

  function exercisePicker(day) {
    const owned = ownedCategories();
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.style.background = "var(--bg-input)";
    wrap.innerHTML = `
      <div class="field">
        <input type="text" class="picker-search" placeholder="Search exercises..." />
      </div>
      <div class="row" style="margin-bottom:8px;">
        <label class="checkbox-row" style="min-height:auto;gap:6px;">
          <input type="checkbox" class="show-all" />
          <span class="hint">Show exercises outside your equipment</span>
        </label>
      </div>
      <div class="stack picker-results"></div>
    `;

    function renderResults() {
      const search = wrap.querySelector(".picker-search").value.toLowerCase();
      const showAll = wrap.querySelector(".show-all").checked;
      const results = wrap.querySelector(".picker-results");
      results.innerHTML = "";
      const matches = state.exercises
        .filter((ex) => showAll || (ex.equipmentCategories || []).some((c) => owned.has(c)))
        .filter((ex) => !search || ex.name.toLowerCase().includes(search))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 30);
      if (matches.length === 0) {
        results.innerHTML = `<p>No matches.</p>`;
        return;
      }
      for (const ex of matches) {
        const row = document.createElement("div");
        row.className = "row between";
        row.innerHTML = `<span>${ex.name}</span>`;
        const addBtn = document.createElement("button");
        addBtn.className = "btn sm";
        addBtn.textContent = "Add";
        addBtn.addEventListener("click", async () => {
          day.exercises.push({
            exerciseId: ex.id,
            name: ex.name,
            sets: 3,
            reps: "8-10",
            targetWeight: "",
            notes: "",
          });
          await persist();
          openPickerDate = null;
          paint();
        });
        row.appendChild(addBtn);
        results.appendChild(row);
      }
    }

    wrap.querySelector(".picker-search").addEventListener("input", renderResults);
    wrap.querySelector(".show-all").addEventListener("change", renderResults);
    renderResults();
    return wrap;
  }
}
