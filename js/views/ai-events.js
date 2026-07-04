// AI audit log: every applied or discarded proposal, traceable and — for
// the most recent applied batch — reversible in one tap.
import { listAiEvents } from "../db.js";
import { describeAction, undoLastAiEvent } from "../ai-actions.js";
import { showToast } from "../toast.js";

const TRIGGER_LABELS = {
  weekly_gen: "Weekly generation",
  manual_replan: "Manual replan",
  missed_workout: "Missed workout",
  low_readiness: "Low readiness",
  quick_log_meal: "Meal quick-log",
  meal_adjust: "Meal adjustment",
};

export async function render(container) {
  const events = await listAiEvents();

  container.innerHTML = "";
  if (events.length === 0) {
    container.innerHTML = `
      <div class="empty-state card">
        <h2>No AI activity yet</h2>
        <p>Every generated plan, replan, and quick-log estimate will show up here once you use an AI feature.</p>
      </div>
    `;
    return;
  }

  const latest = events[0];
  const canUndo = latest.accepted && !latest.undone && latest.inverseSnapshot;

  if (canUndo) {
    const undoCard = document.createElement("div");
    undoCard.className = "card row between";
    undoCard.innerHTML = `
      <span>Undo the last applied change?</span>
      <button class="btn sm danger" id="undo-btn">Undo last AI change</button>
    `;
    undoCard.querySelector("#undo-btn").addEventListener("click", async () => {
      try {
        await undoLastAiEvent();
        showToast("Reverted", { type: "success" });
        render(container);
      } catch (err) {
        showToast(err.message || "Couldn't undo.", { type: "danger" });
      }
    });
    container.appendChild(undoCard);
  }

  for (const event of events) {
    const card = document.createElement("div");
    card.className = "card stack";
    const when = new Date(event.timestamp).toLocaleString();
    card.innerHTML = `
      <div class="row between">
        <strong>${TRIGGER_LABELS[event.trigger] || event.trigger || "AI"}</strong>
        <span class="badge ${event.accepted ? "success" : ""}">${event.accepted ? (event.undone ? "undone" : "applied") : "discarded"}</span>
      </div>
      <p class="hint">${when}</p>
      ${event.promptSummary ? `<p>${event.promptSummary}</p>` : ""}
      <div class="stack action-lines"></div>
    `;
    const lines = card.querySelector(".action-lines");
    for (const action of event.actionsApplied || []) {
      const p = document.createElement("p");
      p.className = "hint";
      describeAction(action).then((text) => {
        p.textContent = text;
      });
      lines.appendChild(p);
    }
    container.appendChild(card);
  }
}
