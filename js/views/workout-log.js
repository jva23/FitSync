// The most important screen in the app: fast in-gym logging. One exercise
// visible at a time, big touch targets, previous-session numbers inline,
// a rest timer that starts on set completion, and plate math for barbells.
// Every set completion autosaves so killing the tab mid-workout loses nothing.
import {
  getWorkoutPlanByWeek,
  saveWorkoutPlan,
  getWorkoutLogsByDate,
  saveWorkoutLog,
  getLastLogForExercise,
  saveExercise,
} from "../db.js";
import { state } from "../state.js";
import { showToast } from "../toast.js";
import { mondayOf, weekISOFromMonday, weekDays, todayLocalDate, formatDayLabel, plateMath } from "../utils.js";
import { replanWeek, AiError } from "../ai.js";
import { validateActions, applyActions, logDiscardedProposal } from "../ai-actions.js";
import { showAiPreview } from "../ai-preview.js";

const DEFAULT_REST_SECONDS = 90;
const WEIGHT_STEP = 2.5;

export async function render(container, params) {
  const date = params?.[0] || todayLocalDate();
  const weekStart = mondayOf(date);
  let plan = await getWorkoutPlanByWeek(weekISOFromMonday(weekStart));
  let day = plan?.days.find((d) => d.date === date) || null;

  const existingLogs = await getWorkoutLogsByDate(date);
  let log = existingLogs[0] || null;

  if (!log) {
    log = {
      date,
      startedAt: Date.now(),
      readiness: null,
      durationMin: null,
      notes: "",
      exercises: buildExercisesFromPlan(day),
    };
  }

  let phase = log.readiness !== null || existingLogs[0] ? "logging" : "readiness";
  let awaitingLightConfirm = false;
  let currentIndex = 0;
  let restRemaining = 0;
  let restTotal = DEFAULT_REST_SECONDS;
  let restInterval = null;
  let addPickerOpen = log.exercises.length === 0;

  paint();

  function destroy() {
    if (restInterval) clearInterval(restInterval);
  }

  async function persistLog() {
    log = await saveWorkoutLog(log);
  }

  function buildExercisesFromPlan(day) {
    if (!day || day.exercises.length === 0) return [];
    return day.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      name: e.name,
      plannedSets: e.sets || 3,
      plannedReps: e.reps,
      plannedTargetWeight: e.targetWeight,
      notes: e.notes || "",
      sets: Array.from({ length: e.sets || 3 }, () => ({
        weight: parseFloat(e.targetWeight) || null,
        reps: parseInt(e.reps, 10) || null,
        rpe: null,
        completed: false,
      })),
    }));
  }

  function startRestTimer(seconds) {
    if (restInterval) clearInterval(restInterval);
    restTotal = seconds;
    restRemaining = seconds;
    restInterval = setInterval(() => {
      restRemaining -= 1;
      if (restRemaining <= 0) {
        clearInterval(restInterval);
        restInterval = null;
      }
      renderRestBanner();
    }, 1000);
    renderRestBanner();
  }

  function renderRestBanner() {
    const el = container.querySelector("#rest-banner");
    if (!el) return;
    if (restRemaining <= 0 && !restInterval) {
      el.innerHTML = "";
      el.style.display = "none";
      return;
    }
    el.style.display = "flex";
    const mins = Math.floor(restRemaining / 60);
    const secs = String(restRemaining % 60).padStart(2, "0");
    el.innerHTML = `
      <span>Rest</span>
      <span class="num num-lg">${mins}:${secs}</span>
      <button class="btn sm ghost" id="rest-skip">Skip</button>
      <button class="btn sm ghost" id="rest-add15">+15s</button>
    `;
    el.querySelector("#rest-skip").addEventListener("click", () => {
      clearInterval(restInterval);
      restInterval = null;
      restRemaining = 0;
      renderRestBanner();
    });
    el.querySelector("#rest-add15").addEventListener("click", () => {
      restRemaining += 15;
      renderRestBanner();
    });
  }

  function paint() {
    container.innerHTML = "";
    if (phase === "readiness") {
      container.appendChild(readinessScreen());
      return;
    }
    container.appendChild(restBannerEl());
    renderRestBanner();
    if (addPickerOpen) {
      container.appendChild(adHocPicker());
      return;
    }
    if (log.exercises.length === 0) {
      container.innerHTML += `<div class="empty-state card"><p>No exercises yet.</p></div>`;
      addPickerOpen = true;
      paint();
      return;
    }
    container.appendChild(progressHeader());
    container.appendChild(exerciseCard(log.exercises[currentIndex]));
    container.appendChild(navRow());
  }

  function restBannerEl() {
    const el = document.createElement("div");
    el.id = "rest-banner";
    el.className = "card row";
    el.style.display = "none";
    el.style.justifyContent = "center";
    el.style.gap = "16px";
    el.style.borderColor = "var(--ember)";
    return el;
  }

  function readinessScreen() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";

    if (awaitingLightConfirm) {
      wrap.innerHTML = `
        <h2>${formatDayLabel(date)}${day?.focus ? " — " + day.focus : ""}</h2>
        <p>Readiness ${log.readiness}/5. Want a lighter version of today?</p>
        <div class="row">
          <button class="btn ghost" id="no-thanks">No, continue as planned</button>
          <button class="btn primary" id="get-lighter" style="flex:1;">Ask AI for a lighter session</button>
        </div>
      `;
      wrap.querySelector("#no-thanks").addEventListener("click", () => {
        awaitingLightConfirm = false;
        phase = "logging";
        paint();
      });
      wrap.querySelector("#get-lighter").addEventListener("click", requestLighterSession);
      return wrap;
    }

    wrap.innerHTML = `
      <h2>${formatDayLabel(date)}${day?.focus ? " — " + day.focus : ""}</h2>
      <p>How are you feeling? Optional — skip if you'd rather not think about it.</p>
      <div class="row wrap" id="readiness-row"></div>
      <button class="btn ghost" id="skip-readiness">Skip</button>
    `;
    const row = wrap.querySelector("#readiness-row");
    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement("button");
      btn.className = "chip selectable";
      btn.textContent = String(i);
      btn.addEventListener("click", async () => {
        log.readiness = i;
        await persistLog();
        if (i <= 2) {
          awaitingLightConfirm = true;
          paint();
        } else {
          phase = "logging";
          paint();
        }
      });
      row.appendChild(btn);
    }
    wrap.querySelector("#skip-readiness").addEventListener("click", () => {
      phase = "logging";
      paint();
    });
    return wrap;
  }

  async function requestLighterSession() {
    const trigger = "low_readiness";
    const promptSummary = `Lighter session requested for ${date} (readiness ${log.readiness}/5)`;
    try {
      const result = await replanWeek(
        `Low readiness (${log.readiness}/5) on ${date} — propose a scaled-down version of just today's session (fewer sets and/or lighter weight). Leave other days alone unless today's change requires it.`
      );
      const { valid, errors } = validateActions(result.actions, {
        allowedDates: new Set(weekDays(weekStart)),
        allowedWeekISO: weekISOFromMonday(weekStart),
      });
      const decision = await showAiPreview({ rationale: result.rationale, valid, errors });
      if (decision === "applied") {
        await applyActions(valid, { trigger, promptSummary });
        plan = await getWorkoutPlanByWeek(weekISOFromMonday(weekStart));
        day = plan?.days.find((d) => d.date === date) || null;
        log.exercises = buildExercisesFromPlan(day);
        await persistLog();
        showToast("Today's plan updated", { type: "success" });
      } else {
        await logDiscardedProposal(trigger, promptSummary, result.actions);
      }
    } catch (err) {
      showToast(err instanceof AiError ? err.message : "AI request failed.", { type: "danger", duration: 6000 });
    } finally {
      awaitingLightConfirm = false;
      phase = "logging";
      addPickerOpen = log.exercises.length === 0;
      currentIndex = 0;
      paint();
    }
  }

  function progressHeader() {
    const wrap = document.createElement("div");
    wrap.className = "row between";
    wrap.innerHTML = `<span class="section-title" style="margin:0;">Exercise ${currentIndex + 1} of ${log.exercises.length}</span>`;
    return wrap;
  }

  function exerciseCard(exercise) {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    const exMeta = state.exercises.find((e) => e.id === exercise.exerciseId);
    const isBarbell = exMeta?.equipmentCategories?.includes("barbell");

    wrap.innerHTML = `
      <h2>${exercise.name}</h2>
      ${exercise.plannedReps ? `<p>Planned: ${exercise.plannedSets ?? exercise.sets.length} × ${exercise.plannedReps}${exercise.plannedTargetWeight ? " @ " + exercise.plannedTargetWeight : ""}</p>` : ""}
      <div id="last-session"></div>
      <div class="stack" id="sets-list"></div>
      <button class="btn sm" id="add-set">Add set</button>
    `;

    getLastLogForExercise(exercise.exerciseId, date).then((last) => {
      const el = wrap.querySelector("#last-session");
      if (!el) return;
      if (!last) {
        el.innerHTML = `<p class="hint">No previous session logged.</p>`;
        return;
      }
      const summary = last.exercise.sets
        .filter((s) => s.completed)
        .map((s) => `${s.weight ?? "–"}×${s.reps ?? "–"}`)
        .join(", ");
      el.innerHTML = `<p class="hint">Last time (${last.date}): ${summary || "no completed sets"}</p>`;
    });

    const setsList = wrap.querySelector("#sets-list");
    exercise.sets.forEach((set, i) => setsList.appendChild(setRow(exercise, set, i, isBarbell)));

    wrap.querySelector("#add-set").addEventListener("click", async () => {
      const last = exercise.sets[exercise.sets.length - 1];
      exercise.sets.push({ weight: last?.weight ?? null, reps: last?.reps ?? null, rpe: null, completed: false });
      await persistLog();
      paint();
    });

    return wrap;
  }

  function setRow(exercise, set, index, isBarbell) {
    const row = document.createElement("div");
    row.className = "card";
    row.style.background = set.completed ? "var(--ember-dim)" : "var(--bg-elevated)";

    const plate = isBarbell && set.weight ? plateMath(set.weight) : null;

    row.innerHTML = `
      <div class="row between">
        <strong>Set ${index + 1}</strong>
        <button class="btn ${set.completed ? "primary" : ""} sm complete-btn" aria-pressed="${set.completed}">
          ${set.completed ? "Done ✓" : "Mark complete"}
        </button>
      </div>
      <div class="row wrap" style="margin-top:8px;">
        <div class="stepper">
          <button class="w-minus" aria-label="Decrease weight">−</button>
          <span class="num">${set.weight ?? "–"}</span>
          <button class="w-plus" aria-label="Increase weight">+</button>
        </div>
        <span class="hint">lb</span>
        <div class="stepper">
          <button class="r-minus" aria-label="Decrease reps">−</button>
          <span class="num">${set.reps ?? "–"}</span>
          <button class="r-plus" aria-label="Increase reps">+</button>
        </div>
        <span class="hint">reps</span>
      </div>
      ${plate ? `<p class="hint" style="margin-top:8px;">Plates/side: ${plate.plates.length ? plate.plates.join(" + ") : "none"}${plate.remainder ? ` (+${plate.remainder} short)` : ""}</p>` : ""}
    `;

    row.querySelector(".w-minus").addEventListener("click", async () => {
      set.weight = Math.max(0, (set.weight || 0) - WEIGHT_STEP);
      await persistLog();
      paint();
    });
    row.querySelector(".w-plus").addEventListener("click", async () => {
      set.weight = (set.weight || 0) + WEIGHT_STEP;
      await persistLog();
      paint();
    });
    row.querySelector(".r-minus").addEventListener("click", async () => {
      set.reps = Math.max(0, (set.reps || 0) - 1);
      await persistLog();
      paint();
    });
    row.querySelector(".r-plus").addEventListener("click", async () => {
      set.reps = (set.reps || 0) + 1;
      await persistLog();
      paint();
    });
    row.querySelector(".complete-btn").addEventListener("click", async () => {
      set.completed = !set.completed;
      await persistLog();
      if (set.completed) startRestTimer(restTotal);
      paint();
    });

    return row;
  }

  function navRow() {
    const wrap = document.createElement("div");
    wrap.className = "row";
    const isLast = currentIndex === log.exercises.length - 1;
    wrap.innerHTML = `
      <button class="btn ghost" id="prev-ex" ${currentIndex === 0 ? "disabled" : ""}>‹ Prev</button>
      <button class="btn ghost" id="add-ex-mid">Add exercise</button>
      ${isLast
        ? `<button class="btn primary" id="finish-btn" style="flex:1;">Finish workout</button>`
        : `<button class="btn primary" id="next-ex" style="flex:1;">Next exercise ›</button>`}
    `;
    wrap.querySelector("#prev-ex").addEventListener("click", () => {
      currentIndex = Math.max(0, currentIndex - 1);
      paint();
    });
    wrap.querySelector("#add-ex-mid").addEventListener("click", () => {
      addPickerOpen = true;
      paint();
    });
    const nextBtn = wrap.querySelector("#next-ex");
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        currentIndex = Math.min(log.exercises.length - 1, currentIndex + 1);
        paint();
      });
    }
    const finishBtn = wrap.querySelector("#finish-btn");
    if (finishBtn) {
      finishBtn.addEventListener("click", finishWorkout);
    }
    return wrap;
  }

  // A PR is a new all-time max weight lifted for an exercise, on any
  // completed set. Simple and legible rather than an estimated-1RM formula.
  async function detectAndSavePRs() {
    const hits = [];
    for (const exercise of log.exercises) {
      const bestSet = exercise.sets
        .filter((s) => s.completed && s.weight)
        .sort((a, b) => b.weight - a.weight || (b.reps || 0) - (a.reps || 0))[0];
      if (!bestSet) continue;

      const exerciseRecord = state.exercises.find((e) => e.id === exercise.exerciseId);
      if (!exerciseRecord) continue;

      const priorBest = (exerciseRecord.prs || []).reduce((max, p) => Math.max(max, p.weight), 0);
      if (bestSet.weight > priorBest) {
        const prs = [...(exerciseRecord.prs || []), { date, weight: bestSet.weight, reps: bestSet.reps }];
        await saveExercise({ ...exerciseRecord, prs });
        hits.push(`${exercise.name}: ${bestSet.weight} × ${bestSet.reps}`);
      }
    }
    return hits;
  }

  async function finishWorkout() {
    log.durationMin = Math.max(1, Math.round((Date.now() - log.startedAt) / 60000));
    await persistLog();
    if (day) {
      day.status = "done";
      await saveWorkoutPlan(plan);
    }
    const prHits = await detectAndSavePRs();
    for (const hit of prHits) {
      showToast(`New PR — ${hit}`, { type: "success", duration: 5000 });
    }
    showToast("Workout logged", { type: "success" });
    location.hash = "#/today";
  }

  function adHocPicker() {
    const owned = new Set(["bodyweight", ...state.equipment.filter((e) => e.available !== false).map((e) => e.category)]);
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `
      <h2>${log.exercises.length ? "Add another exercise" : "Build today's session"}</h2>
      <div class="field"><input type="text" class="picker-search" placeholder="Search exercises..." /></div>
      <div class="stack picker-results"></div>
      ${log.exercises.length ? `<button class="btn ghost" id="cancel-add">Cancel</button>` : ""}
    `;
    function renderResults() {
      const search = wrap.querySelector(".picker-search").value.toLowerCase();
      const results = wrap.querySelector(".picker-results");
      results.innerHTML = "";
      const matches = state.exercises
        .filter((ex) => (ex.equipmentCategories || []).some((c) => owned.has(c)))
        .filter((ex) => !search || ex.name.toLowerCase().includes(search))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 30);
      for (const ex of matches) {
        const row = document.createElement("div");
        row.className = "row between";
        row.innerHTML = `<span>${ex.name}</span>`;
        const btn = document.createElement("button");
        btn.className = "btn sm";
        btn.textContent = "Add";
        btn.addEventListener("click", async () => {
          log.exercises.push({
            exerciseId: ex.id,
            name: ex.name,
            plannedReps: "",
            plannedTargetWeight: "",
            notes: "",
            sets: Array.from({ length: 3 }, () => ({ weight: null, reps: null, rpe: null, completed: false })),
          });
          await persistLog();
          addPickerOpen = false;
          currentIndex = log.exercises.length - 1;
          paint();
        });
        row.appendChild(btn);
        results.appendChild(row);
      }
    }
    wrap.querySelector(".picker-search").addEventListener("input", renderResults);
    const cancelBtn = wrap.querySelector("#cancel-add");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        addPickerOpen = false;
        paint();
      });
    }
    renderResults();
    return wrap;
  }

  return destroy;
}
