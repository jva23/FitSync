// Shared propose -> review diff -> accept/reject overlay. The AI never
// mutates data before Apply — callers pass in already-validated actions and
// call applyActions() themselves only if this resolves "applied".
import { describeAction } from "./ai-actions.js";

export async function showAiPreview({ rationale, valid, errors }) {
  const lines = await Promise.all(valid.map((a) => describeAction(a)));

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ai-overlay";
    overlay.innerHTML = `
      <div class="ai-overlay-card">
        <div class="section-title" style="margin-top:0;">AI proposal</div>
        <p>${rationale || "No rationale given."}</p>
        <div class="stack ai-diff-list"></div>
        <div class="stack ai-error-list"></div>
        <div class="row" style="margin-top:16px;">
          <button class="btn ghost" id="ai-discard">Discard</button>
          <button class="btn primary" id="ai-apply" style="flex:1;" ${valid.length === 0 ? "disabled" : ""}>
            Apply${valid.length ? ` (${valid.length})` : ""}
          </button>
        </div>
      </div>
    `;

    const list = overlay.querySelector(".ai-diff-list");
    if (lines.length === 0) {
      list.innerHTML = `<p class="hint">Nothing to change.</p>`;
    }
    for (const line of lines) {
      const row = document.createElement("div");
      row.className = "card";
      row.style.background = "var(--bg-input)";
      row.textContent = line;
      list.appendChild(row);
    }

    const errList = overlay.querySelector(".ai-error-list");
    for (const err of errors) {
      const p = document.createElement("p");
      p.className = "hint";
      p.style.color = "var(--warning)";
      p.textContent = err;
      errList.appendChild(p);
    }

    document.body.appendChild(overlay);

    overlay.querySelector("#ai-apply").addEventListener("click", () => {
      overlay.remove();
      resolve("applied");
    });
    overlay.querySelector("#ai-discard").addEventListener("click", () => {
      overlay.remove();
      resolve("discarded");
    });
  });
}
