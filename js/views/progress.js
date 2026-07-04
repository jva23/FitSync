// Dashboard + charts: this week at a glance, then lift progression,
// bodyweight trend, weekly volume per muscle group, and macro adherence.
import { getWorkoutPlanByWeek, getMealPlanByWeek, listWorkoutLogs, listMealLogs } from "../db.js";
import { state } from "../state.js";
import { makeChart, EMBER, EMBER_DIM } from "../charts.js";
import {
  mondayOf,
  weekISOFromMonday,
  weekDays,
  formatDayLabel,
  todayLocalDate,
  kgToLb,
} from "../utils.js";

export async function render(container) {
  const weekStart = mondayOf(todayLocalDate());
  const weekISO = weekISOFromMonday(weekStart);
  const days = weekDays(weekStart);
  const today = todayLocalDate();

  const [plan, mealPlan, allWorkoutLogs, allMealLogs] = await Promise.all([
    getWorkoutPlanByWeek(weekISO),
    getMealPlanByWeek(weekISO),
    listWorkoutLogs(),
    listMealLogs(),
  ]);

  const charts = [];
  container.innerHTML = "";
  container.appendChild(reviewLinkCard());
  container.appendChild(dashboardCard());
  container.appendChild(prsCard());
  container.appendChild(bodyweightCard());
  container.appendChild(volumeCard());
  container.appendChild(macroCard());
  container.appendChild(liftProgressionCard());

  return () => charts.forEach((c) => c.destroy());

  function reviewLinkCard() {
    const wrap = document.createElement("div");
    wrap.className = "card row between";
    wrap.innerHTML = `
      <span>Ready to close out the week?</span>
      <button class="btn sm primary" id="go-review">Weekly Review</button>
    `;
    wrap.querySelector("#go-review").addEventListener("click", () => (location.hash = "#/review"));
    return wrap;
  }

  // ---- This week at a glance ----
  function dashboardCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `<div class="section-title">This week</div>`;

    if (!plan) {
      wrap.innerHTML += `<p>No workout plan yet this week — head to Plan to build one.</p>`;
    } else {
      const trainingDays = plan.days.filter((d) => !d.isRest && d.exercises.length > 0);
      const done = trainingDays.filter((d) => d.status === "done").length;
      const missed = trainingDays.filter((d) => d.status !== "done" && d.date < today).length;
      const remaining = trainingDays.length - done - missed;
      wrap.innerHTML += `
        <div class="row wrap">
          <span class="badge success">${done} done</span>
          <span class="badge">${remaining} remaining</span>
          ${missed ? `<span class="badge warning">${missed} missed</span>` : ""}
        </div>
      `;
    }

    const loggedDays = days.filter((d) => d <= today);
    const logsThisWeek = allMealLogs.filter((l) => loggedDays.includes(l.date) && l.meals.length > 0);
    if (mealPlan && logsThisWeek.length > 0) {
      const avgKcal = Math.round(
        logsThisWeek.reduce((sum, l) => sum + l.meals.reduce((s, m) => s + (m.macros?.kcal || 0), 0), 0) /
          logsThisWeek.length
      );
      wrap.innerHTML += `<p>Avg logged: ${avgKcal} kcal / day (target ${mealPlan.targets.kcal})</p>`;
    }

    const weightLog = state.profile?.weightLog || [];
    if (weightLog.length >= 2) {
      const latest = weightLog[weightLog.length - 1];
      const prev = weightLog[weightLog.length - 2];
      const deltaLb = kgToLb(latest.kg) - kgToLb(prev.kg);
      const sign = deltaLb > 0 ? "+" : "";
      wrap.innerHTML += `<p>Weight: ${kgToLb(latest.kg).toFixed(1)} lb (${sign}${deltaLb.toFixed(1)} lb)</p>`;
    }

    return wrap;
  }

  // ---- Recent PRs ----
  function prsCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `<div class="section-title">Recent PRs</div>`;
    const all = state.exercises
      .flatMap((ex) => (ex.prs || []).map((pr) => ({ ...pr, name: ex.name })))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8);
    if (all.length === 0) {
      wrap.innerHTML += `<p class="hint">No PRs yet — they're detected automatically when you finish a workout.</p>`;
      return wrap;
    }
    for (const pr of all) {
      const row = document.createElement("div");
      row.className = "row between";
      row.innerHTML = `<span>${pr.name}</span><span class="num">${pr.weight} × ${pr.reps}</span>`;
      wrap.appendChild(row);
    }
    return wrap;
  }

  // ---- Bodyweight trend ----
  function bodyweightCard() {
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `<div class="section-title">Bodyweight trend</div>`;
    const log = state.profile?.weightLog || [];
    if (log.length < 2) {
      wrap.innerHTML += `<p class="hint">Log weight a couple more times in Settings to see a trend.</p>`;
      return wrap;
    }
    const canvasWrap = document.createElement("div");
    canvasWrap.style.height = "200px";
    const canvas = document.createElement("canvas");
    canvasWrap.appendChild(canvas);
    wrap.appendChild(canvasWrap);
    charts.push(
      makeChart(canvas, {
        type: "line",
        data: {
          labels: log.map((e) => e.date),
          datasets: [
            {
              label: "Weight (lb)",
              data: log.map((e) => Math.round(kgToLb(e.kg) * 10) / 10),
              borderColor: EMBER,
              backgroundColor: EMBER_DIM,
              tension: 0.25,
              fill: true,
            },
          ],
        },
      })
    );
    return wrap;
  }

  // ---- Weekly volume per muscle group ----
  function volumeCard() {
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `<div class="section-title">Volume by muscle group (this week)</div>`;
    const volumeByGroup = new Map();
    const logsThisWeek = allWorkoutLogs.filter((l) => days.includes(l.date));
    for (const log of logsThisWeek) {
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
      wrap.innerHTML += `<p class="hint">Log some completed sets this week to see volume by muscle group.</p>`;
      return wrap;
    }
    const entries = [...volumeByGroup.entries()].sort((a, b) => b[1] - a[1]);
    const canvasWrap = document.createElement("div");
    canvasWrap.style.height = "220px";
    const canvas = document.createElement("canvas");
    canvasWrap.appendChild(canvas);
    wrap.appendChild(canvasWrap);
    charts.push(
      makeChart(canvas, {
        type: "bar",
        data: {
          labels: entries.map(([g]) => g),
          datasets: [{ label: "Volume (lb × reps)", data: entries.map(([, v]) => Math.round(v)), backgroundColor: EMBER }],
        },
        options: { plugins: { legend: { display: false } } },
      })
    );
    return wrap;
  }

  // ---- Macro adherence ----
  function macroCard() {
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `<div class="section-title">Macro adherence (this week)</div>`;
    const kcalByDay = days.map((date) => {
      const log = allMealLogs.find((l) => l.date === date);
      return log ? log.meals.reduce((s, m) => s + (m.macros?.kcal || 0), 0) : 0;
    });
    if (kcalByDay.every((k) => k === 0)) {
      wrap.innerHTML += `<p class="hint">No meals logged this week yet.</p>`;
      return wrap;
    }
    const canvasWrap = document.createElement("div");
    canvasWrap.style.height = "220px";
    const canvas = document.createElement("canvas");
    canvasWrap.appendChild(canvas);
    wrap.appendChild(canvasWrap);
    const datasets = [{ type: "bar", label: "kcal logged", data: kcalByDay, backgroundColor: EMBER }];
    if (mealPlan) {
      datasets.push({
        type: "line",
        label: "target",
        data: days.map(() => mealPlan.targets.kcal),
        borderColor: "#a89e91",
        borderDash: [6, 4],
        pointRadius: 0,
      });
    }
    charts.push(
      makeChart(canvas, {
        type: "bar",
        data: { labels: days.map(formatDayLabel), datasets },
      })
    );
    return wrap;
  }

  // ---- Lift progression per exercise ----
  function liftProgressionCard() {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    wrap.innerHTML = `<div class="section-title">Lift progression</div>`;

    const loggedExerciseIds = new Set(allWorkoutLogs.flatMap((l) => (l.exercises || []).map((e) => e.exerciseId)));
    const options = state.exercises
      .filter((e) => loggedExerciseIds.has(e.id))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (options.length === 0) {
      wrap.innerHTML += `<p class="hint">Log a workout to start tracking lift progression.</p>`;
      return wrap;
    }

    const select = document.createElement("select");
    for (const ex of options) {
      const opt = document.createElement("option");
      opt.value = ex.id;
      opt.textContent = ex.name;
      select.appendChild(opt);
    }
    wrap.appendChild(select);

    const canvasWrap = document.createElement("div");
    canvasWrap.style.height = "220px";
    const canvas = document.createElement("canvas");
    canvasWrap.appendChild(canvas);
    wrap.appendChild(canvasWrap);

    let chartInstance = null;

    function drawFor(exerciseId) {
      if (chartInstance) {
        chartInstance.destroy();
        charts.splice(charts.indexOf(chartInstance), 1);
      }
      const points = allWorkoutLogs
        .filter((l) => (l.exercises || []).some((e) => e.exerciseId === exerciseId))
        .map((l) => {
          const entry = l.exercises.find((e) => e.exerciseId === exerciseId);
          const completed = (entry.sets || []).filter((s) => s.completed && s.weight);
          const topWeight = completed.length ? Math.max(...completed.map((s) => s.weight)) : null;
          return { date: l.date, weight: topWeight };
        })
        .filter((p) => p.weight !== null)
        .sort((a, b) => a.date.localeCompare(b.date));

      chartInstance = makeChart(canvas, {
        type: "line",
        data: {
          labels: points.map((p) => p.date),
          datasets: [
            {
              label: "Top set weight (lb)",
              data: points.map((p) => p.weight),
              borderColor: EMBER,
              backgroundColor: EMBER_DIM,
              tension: 0.15,
              fill: true,
            },
          ],
        },
      });
      charts.push(chartInstance);
    }

    select.addEventListener("change", () => drawFor(select.value));
    drawFor(options[0].id);

    return wrap;
  }
}
