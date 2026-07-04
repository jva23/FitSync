// Weekly review ritual: adherence, volume, weight trend, then exactly ONE
// AI observation with a recommendation, flowing straight into next week's
// generation. The emotional core of the AI — a coach who watched the week.
import { getWorkoutPlanByWeek, getMealPlanByWeek, listWorkoutLogs, listMealLogs } from "../db.js";
import { state } from "../state.js";
import { makeChart, EMBER, EMBER_DIM } from "../charts.js";
import { mondayOf, weekISOFromMonday, weekDays, addDaysStr, todayLocalDate, kgToLb } from "../utils.js";
import { weeklyReview, generateWeek, AiError } from "../ai.js";
import { validateActions, applyActions, logDiscardedProposal } from "../ai-actions.js";
import { showAiPreview } from "../ai-preview.js";
import { showToast } from "../toast.js";

export async function render(container) {
  const weekStart = mondayOf(todayLocalDate());
  const weekISO = weekISOFromMonday(weekStart);
  const days = weekDays(weekStart);
  const nextWeekStart = addDaysStr(weekStart, 7);
  const nextWeekDays = weekDays(nextWeekStart);
  const nextWeekISO = weekISOFromMonday(nextWeekStart);
  const hasKey = Boolean(state.settings?.apiKey);

  const [plan, mealPlan, allWorkoutLogs, allMealLogs] = await Promise.all([
    getWorkoutPlanByWeek(weekISO),
    getMealPlanByWeek(weekISO),
    listWorkoutLogs(),
    listMealLogs(),
  ]);

  const charts = [];
  container.innerHTML = "";
  container.appendChild(adherenceCard());
  container.appendChild(volumeCard());
  container.appendChild(weightCard());
  container.appendChild(aiObservationCard());
  container.appendChild(generateNextWeekCard());

  return () => charts.forEach((c) => c.destroy());

  function adherenceCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `<div class="section-title" style="margin:0;">This week's adherence</div>`;

    if (plan) {
      const trainingDays = plan.days.filter((d) => !d.isRest && d.exercises.length > 0);
      const done = trainingDays.filter((d) => d.status === "done").length;
      wrap.innerHTML += `<p>Workouts: ${done} / ${trainingDays.length} done</p>`;
    } else {
      wrap.innerHTML += `<p class="hint">No workout plan this week.</p>`;
    }

    const logsThisWeek = allMealLogs.filter((l) => days.includes(l.date) && l.meals.length > 0);
    if (mealPlan && logsThisWeek.length > 0) {
      const avgKcal = Math.round(
        logsThisWeek.reduce((sum, l) => sum + l.meals.reduce((s, m) => s + (m.macros?.kcal || 0), 0), 0) /
          logsThisWeek.length
      );
      wrap.innerHTML += `<p>Meals: avg ${avgKcal} kcal/day logged (target ${mealPlan.targets.kcal})</p>`;
    } else {
      wrap.innerHTML += `<p class="hint">No meals logged this week.</p>`;
    }
    return wrap;
  }

  function volumeCard() {
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `<div class="section-title">Volume by muscle group</div>`;
    const volumeByGroup = new Map();
    for (const log of allWorkoutLogs.filter((l) => days.includes(l.date))) {
      for (const exercise of log.exercises || []) {
        const record = state.exercises.find((e) => e.id === exercise.exerciseId);
        if (!record) continue;
        const volume = (exercise.sets || [])
          .filter((s) => s.completed)
          .reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
        if (volume === 0) continue;
        for (const group of record.muscleGroups || []) {
          volumeByGroup.set(group, (volumeByGroup.get(group) || 0) + volume);
        }
      }
    }
    if (volumeByGroup.size === 0) {
      wrap.innerHTML += `<p class="hint">No completed sets logged this week.</p>`;
      return wrap;
    }
    const entries = [...volumeByGroup.entries()].sort((a, b) => b[1] - a[1]);
    const canvasWrap = document.createElement("div");
    canvasWrap.style.height = "180px";
    const canvas = document.createElement("canvas");
    canvasWrap.appendChild(canvas);
    wrap.appendChild(canvasWrap);
    charts.push(
      makeChart(canvas, {
        type: "bar",
        data: { labels: entries.map(([g]) => g), datasets: [{ data: entries.map(([, v]) => Math.round(v)), backgroundColor: EMBER }] },
        options: { plugins: { legend: { display: false } } },
      })
    );
    return wrap;
  }

  function weightCard() {
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `<div class="section-title">Weight trend</div>`;
    const log = state.profile?.weightLog || [];
    if (log.length < 2) {
      wrap.innerHTML += `<p class="hint">Not enough weigh-ins yet to show a trend.</p>`;
      return wrap;
    }
    const recent = log.slice(-8);
    const canvasWrap = document.createElement("div");
    canvasWrap.style.height = "180px";
    const canvas = document.createElement("canvas");
    canvasWrap.appendChild(canvas);
    wrap.appendChild(canvasWrap);
    charts.push(
      makeChart(canvas, {
        type: "line",
        data: {
          labels: recent.map((e) => e.date),
          datasets: [
            {
              data: recent.map((e) => Math.round(kgToLb(e.kg) * 10) / 10),
              borderColor: EMBER,
              backgroundColor: EMBER_DIM,
              tension: 0.25,
              fill: true,
            },
          ],
        },
        options: { plugins: { legend: { display: false } } },
      })
    );
    return wrap;
  }

  function aiObservationCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `<div class="section-title" style="margin:0;">Coach's observation</div>`;

    if (!hasKey) {
      wrap.innerHTML += `<p class="hint">Add an API key in Settings to get a weekly observation.</p>`;
      return wrap;
    }

    const body = document.createElement("div");
    body.innerHTML = `<p class="hint">Thinking…</p>`;
    wrap.appendChild(body);

    weeklyReview()
      .then((result) => {
        body.innerHTML = `<p>${result.rationale || "Nothing notable this week."}</p>`;
        if (result.actions.length > 0) {
          const btn = document.createElement("button");
          btn.className = "btn sm";
          btn.textContent = `Review ${result.actions.length} suggested change${result.actions.length === 1 ? "" : "s"}`;
          btn.addEventListener("click", async () => {
            const { valid, errors } = validateActions(result.actions, {
              allowedDates: new Set(days),
              allowedWeekISO: weekISO,
            });
            const decision = await showAiPreview({ rationale: result.rationale, valid, errors });
            if (decision === "applied") {
              await applyActions(valid, { trigger: "weekly_gen", promptSummary: "Weekly review recommendation" });
              showToast("Applied", { type: "success" });
            } else {
              await logDiscardedProposal("weekly_gen", "Weekly review recommendation", result.actions);
              showToast("Discarded");
            }
          });
          body.appendChild(btn);
        }
      })
      .catch((err) => {
        body.innerHTML = `<p class="hint">${err instanceof AiError ? err.message : "Couldn't get a review right now."}</p>`;
      });

    return wrap;
  }

  function generateNextWeekCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `
      <div class="section-title" style="margin:0;">Next week</div>
      <p>Generate next week's workout and meal plan from everything above.</p>
      <button class="btn primary block" id="gen-next" ${hasKey ? "" : "disabled"}>${hasKey ? "Generate next week" : "Add an API key to use this"}</button>
    `;
    const btn = wrap.querySelector("#gen-next");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Thinking…";
      try {
        const result = await generateWeek({ weekISO: nextWeekISO });
        const { valid, errors } = validateActions(result.actions, {
          allowedDates: new Set(nextWeekDays),
          allowedWeekISO: nextWeekISO,
        });
        const decision = await showAiPreview({ rationale: result.rationale, valid, errors });
        if (decision === "applied") {
          await applyActions(valid, { trigger: "weekly_gen", promptSummary: `Generate week ${nextWeekISO}` });
          showToast("Next week generated — check Plan", { type: "success" });
          location.hash = "#/plan";
        } else {
          await logDiscardedProposal("weekly_gen", `Generate week ${nextWeekISO}`, result.actions);
          showToast("Discarded");
        }
      } catch (err) {
        showToast(err instanceof AiError ? err.message : "AI request failed.", { type: "danger", duration: 6000 });
      } finally {
        btn.disabled = false;
        btn.textContent = "Generate next week";
      }
    });
    return wrap;
  }
}
