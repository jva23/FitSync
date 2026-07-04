// Router + bootstrapping. Registers the service worker, loads state from
// IndexedDB, then hands off to view modules based on the URL hash.
import { loadAllIntoState } from "./db.js";
import { state } from "./state.js";
import { ICONS } from "./icons.js";
import { showToast } from "./toast.js";
import { checkAndNotify } from "./nudges.js";

const TABS = [
  { route: "today", label: "Today", icon: "today" },
  { route: "plan", label: "Plan", icon: "plan" },
  { route: "meals", label: "Meals", icon: "meals" },
  { route: "progress", label: "Progress", icon: "progress" },
  { route: "coach", label: "Coach", icon: "coach" },
];

const VIEW_MODULES = {
  today: "./views/today.js",
  plan: "./views/plan.js",
  meals: "./views/meals.js",
  progress: "./views/progress.js",
  coach: "./views/coach.js",
  settings: "./views/settings.js",
  exercises: "./views/exercises.js",
  onboarding: "./views/onboarding.js",
  log: "./views/workout-log.js",
  review: "./views/review.js",
  "ai-events": "./views/ai-events.js",
};

const TITLES = {
  today: "Today",
  plan: "Plan",
  meals: "Meals",
  progress: "Progress",
  coach: "Coach",
  settings: "Settings",
  exercises: "Exercise Library",
  onboarding: "Welcome",
  log: "Log Workout",
  review: "Weekly Review",
  "ai-events": "AI Activity",
};

// Routes that hide the tab bar and swap the gear icon for a back button,
// so the screen commands full attention (most useful mid-workout).
const FOCUS_ROUTES = new Set(["log"]);

const viewEl = document.getElementById("view");
const tabbarEl = document.getElementById("tabbar");
const headerTitleEl = document.getElementById("header-title");
const gearBtn = document.getElementById("gear-btn");

function buildHeader() {
  gearBtn.innerHTML = ICONS.gear;
}

function buildTabbar() {
  tabbarEl.innerHTML = "";
  for (const tab of TABS) {
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.dataset.route = tab.route;
    btn.innerHTML = `${ICONS[tab.icon]}<span>${tab.label}</span>`;
    btn.addEventListener("click", () => {
      location.hash = `#/${tab.route}`;
    });
    tabbarEl.appendChild(btn);
  }
}

function setActiveTab(route) {
  for (const btn of tabbarEl.querySelectorAll(".tab")) {
    btn.classList.toggle("active", btn.dataset.route === route);
  }
}

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  const route = VIEW_MODULES[parts[0]] ? parts[0] : "today";
  return { route, params: parts.slice(1) };
}

let currentDestroy = null;

async function renderRoute() {
  let { route, params } = parseRoute();

  // First-run: force onboarding until a profile exists.
  if (!state.profile && route !== "onboarding") {
    route = "onboarding";
    params = [];
  }
  if (state.profile && route === "onboarding") {
    route = "today";
    params = [];
  }

  const isFocus = FOCUS_ROUTES.has(route);
  tabbarEl.style.display = route !== "onboarding" ? "flex" : "none";
  tabbarEl.style.visibility = isFocus ? "hidden" : "visible";
  gearBtn.style.display = route === "onboarding" ? "none" : "flex";
  gearBtn.innerHTML = isFocus ? ICONS.back : ICONS.gear;
  gearBtn.setAttribute("aria-label", isFocus ? "Back" : "Settings");
  headerTitleEl.textContent = TITLES[route] || "FitSync";
  setActiveTab(route);

  if (typeof currentDestroy === "function") {
    try {
      currentDestroy();
    } catch (e) {
      console.error(e);
    }
    currentDestroy = null;
  }

  viewEl.innerHTML = "";
  const mod = await import(VIEW_MODULES[route]);
  const result = await mod.render(viewEl, params);
  if (typeof result === "function") currentDestroy = result;
  viewEl.scrollTo(0, 0);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // Register directly rather than waiting for window "load" — by the time
  // boot() gets here the load event has often already fired, so that
  // listener would never run.
  (async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            showToast("Update available", {
              duration: 0,
              action: {
                label: "Reload",
                onClick: () => {
                  installing.postMessage({ type: "SKIP_WAITING" });
                  location.reload();
                },
              },
            });
          }
        });
      });
    } catch (e) {
      console.warn("Service worker registration failed", e);
    }
  })();
}

async function boot() {
  buildHeader();
  buildTabbar();
  gearBtn.addEventListener("click", () => {
    const { route } = parseRoute();
    location.hash = FOCUS_ROUTES.has(route) ? "#/today" : "#/settings";
  });
  window.addEventListener("hashchange", renderRoute);

  await loadAllIntoState();
  await renderRoute();

  registerServiceWorker();

  if (navigator.storage && navigator.storage.persisted) {
    const persisted = await navigator.storage.persisted();
    if (state.settings) state.settings.persistentStorage = persisted;
  }

  checkAndNotify().catch((e) => console.warn("Nudge check failed", e));
}

boot();
