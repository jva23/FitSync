// Freeform coach chat, grounded in the current state snapshot on every turn
// (the API is stateless). History lives in memory only — no persistence,
// per the AI contract. Replies may include proposed actions to review/apply.
import { state } from "../state.js";
import { coachChat, AiError } from "../ai.js";
import { validateActions, applyActions, logDiscardedProposal } from "../ai-actions.js";
import { showAiPreview } from "../ai-preview.js";
import { showToast } from "../toast.js";

// Kept at module scope so the conversation survives navigating away and back
// within the same session, but never touches IndexedDB.
let history = [];

export async function render(container) {
  const hasKey = Boolean(state.settings?.apiKey);

  container.innerHTML = `
    <div class="stack" id="chat-log"></div>
    <div class="row" style="position:sticky; bottom:0; background:var(--bg); padding-top:8px;">
      <input type="text" id="chat-input" placeholder="${hasKey ? "Ask your coach..." : "Add an API key in Settings first"}" style="flex:1;" ${hasKey ? "" : "disabled"} />
      <button class="btn primary" id="chat-send" ${hasKey ? "" : "disabled"}>Send</button>
    </div>
  `;

  const log = container.querySelector("#chat-log");
  const input = container.querySelector("#chat-input");
  const sendBtn = container.querySelector("#chat-send");

  if (!hasKey) {
    log.innerHTML = `
      <div class="empty-state card">
        <h2>Coach needs an API key</h2>
        <p>Add your Anthropic API key in Settings to start chatting — everything else in the app still works without it.</p>
        <button class="btn primary" id="go-settings">Add API Key</button>
      </div>
    `;
    log.querySelector("#go-settings").addEventListener("click", () => (location.hash = "#/settings"));
    return;
  }

  if (history.length === 0) {
    log.innerHTML = `
      <div class="empty-state card">
        <h2>Talk to your coach</h2>
        <p>Grounded in your current profile, equipment, and recent logs. Ask about training, nutrition, or say what's changed — it can propose plan updates you review before anything changes.</p>
      </div>
    `;
  } else {
    for (const turn of history) renderBubble(turn);
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });

  function renderBubble({ role, content, actions }) {
    if (log.querySelector(".empty-state")) log.innerHTML = "";
    const bubble = document.createElement("div");
    bubble.className = "card";
    bubble.style.background = role === "user" ? "var(--bg-elevated)" : "var(--bg-card)";
    bubble.style.borderColor = role === "user" ? "var(--border)" : "var(--ember-dim)";
    bubble.innerHTML = `<p style="margin:0;">${content}</p>`;
    if (actions?.length) {
      const btn = document.createElement("button");
      btn.className = "btn sm";
      btn.style.marginTop = "8px";
      btn.textContent = `Review ${actions.length} proposed change${actions.length === 1 ? "" : "s"}`;
      btn.addEventListener("click", () => reviewActions(actions));
      bubble.appendChild(btn);
    }
    log.appendChild(bubble);
    log.scrollIntoView({ block: "end" });
    return bubble;
  }

  async function reviewActions(actions) {
    const { valid, errors } = validateActions(actions);
    const decision = await showAiPreview({ rationale: "Proposed from coach chat.", valid, errors });
    if (decision === "applied") {
      await applyActions(valid, { trigger: "manual_replan", promptSummary: "Coach chat proposal" });
      showToast("Changes applied", { type: "success" });
    } else {
      await logDiscardedProposal("manual_replan", "Coach chat proposal", actions);
      showToast("Discarded");
    }
  }

  async function send() {
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    input.disabled = true;
    sendBtn.disabled = true;

    history.push({ role: "user", content: message });
    renderBubble({ role: "user", content: message });

    const thinking = document.createElement("div");
    thinking.className = "card hint";
    thinking.textContent = "Thinking…";
    log.appendChild(thinking);
    log.scrollIntoView({ block: "end" });

    try {
      // Strip our display-only `actions` field before sending history back to
      // the API — it only ever expects {role, content} per message.
      const apiHistory = history.slice(0, -1).map(({ role, content }) => ({ role, content }));
      const result = await coachChat(apiHistory, message);
      thinking.remove();
      history.push({ role: "assistant", content: result.rationale, actions: result.actions });
      renderBubble({ role: "assistant", content: result.rationale || "(no response)", actions: result.actions });
    } catch (err) {
      thinking.remove();
      const msg = err instanceof AiError ? err.message : "Something went wrong — try again.";
      renderBubble({ role: "assistant", content: msg });
      history.pop();
    } finally {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
}
