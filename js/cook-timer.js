// Tap-to-start/pause countdown timers for recipe steps.
//
// The host view (recipe-detail.js) fully rebuilds its DOM via innerHTML on
// every unrelated state change (toggling an ingredient, changing servings,
// etc.), so a running interval can't hold a reference to the button it
// started with — that node gets discarded on the next repaint. Instead each
// tick re-queries the live node by a stable id through the `container`
// passed in (which itself is never replaced, only its contents). Timer
// state lives in a Map scoped to one controller instance — call
// `createTimerController` fresh per view mount so navigating to a different
// recipe doesn't inherit another recipe's running timers.
export function createTimerController(container) {
  const timers = new Map(); // stepId -> { remaining, running, intervalId }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function applyState(btn, state) {
    if (state.remaining <= 0) {
      btn.textContent = "✓ done";
      btn.className = "badge success";
    } else {
      btn.textContent = `${state.running ? "⏸" : "⏱"} ${formatTime(state.remaining)}`;
      btn.className = "badge";
    }
  }

  function buildBadge(step, onComplete) {
    if (!step.timerSeconds) return null;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = `timer-${step.id}`;
    btn.className = "badge";
    btn.style.cssText = "border:none;cursor:pointer;";

    if (!timers.has(step.id)) {
      timers.set(step.id, { remaining: step.timerSeconds, running: false, intervalId: null });
    }
    const state = timers.get(step.id);
    applyState(btn, state);

    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // don't also toggle the step's highlight
      if (state.remaining <= 0) {
        state.remaining = step.timerSeconds;
        applyState(btn, state);
        return;
      }
      if (state.running) {
        clearInterval(state.intervalId);
        state.running = false;
        applyState(btn, state);
        return;
      }
      state.running = true;
      state.intervalId = setInterval(() => {
        state.remaining -= 1;
        const live = container.querySelector(`#timer-${step.id}`);
        if (state.remaining <= 0) {
          clearInterval(state.intervalId);
          state.running = false;
          state.remaining = 0;
          if (live) applyState(live, state);
          onComplete?.(step);
          return;
        }
        if (live) applyState(live, state);
      }, 1000);
      applyState(btn, state);
    });

    return btn;
  }

  function destroy() {
    for (const state of timers.values()) {
      if (state.intervalId) clearInterval(state.intervalId);
    }
    timers.clear();
  }

  return { buildBadge, destroy };
}
