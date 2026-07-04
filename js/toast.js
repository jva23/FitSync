// Lightweight toast notifications, mounted in #toast-root.
export function showToast(message, { type = "", duration = 3500, action } = {}) {
  const root = document.getElementById("toast-root");
  if (!root) return;

  const el = document.createElement("div");
  el.className = `toast${type ? " " + type : ""}`;
  el.setAttribute("role", "status");

  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);

  if (action) {
    const btn = document.createElement("button");
    btn.className = "btn sm primary";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.onClick();
      el.remove();
    });
    el.appendChild(btn);
  }

  root.appendChild(el);
  if (!action || duration) {
    setTimeout(() => el.remove(), duration);
  }
  return el;
}
