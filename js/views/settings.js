import {
  getSettings,
  saveSettings,
  exportAll,
  importAll,
  requestPersistentStorage,
  listEquipment,
  saveEquipment,
  deleteEquipment,
  listPrograms,
  saveProgram,
  deleteProgram,
  getProfile,
  saveProfile,
} from "../db.js";
import { showToast } from "../toast.js";
import { kgToLb, lbToKg } from "../utils.js";

export async function render(container) {
  const settings = await getSettings();
  const equipment = await listEquipment();
  const programs = await listPrograms();
  const profile = await getProfile();

  container.innerHTML = "";
  container.appendChild(profileSection(profile));
  container.appendChild(equipmentSection(equipment));
  container.appendChild(programsSection(programs));
  container.appendChild(apiKeySection(settings));
  container.appendChild(appearanceSection(settings));
  container.appendChild(await notificationsSection(settings));
  container.appendChild(await backupSection(settings));
  container.appendChild(linksSection());

  // ---- Profile ----
  function profileSection(profile) {
    const wrap = document.createElement("div");
    const lastWeight = profile?.weightLog?.length
      ? kgToLb(profile.weightLog[profile.weightLog.length - 1].kg).toFixed(1)
      : "";
    wrap.innerHTML = `
      <div class="section-title">Profile</div>
      <div class="card stack">
        <div class="field">
          <label for="p-age">Age</label>
          <input type="number" id="p-age" value="${profile?.age ?? ""}" />
        </div>
        <div class="field">
          <label for="p-height">Height (in)</label>
          <input type="number" id="p-height" value="${profile?.heightIn ?? ""}" />
        </div>
        <div class="field">
          <label for="p-weight">Current weight (lb)</label>
          <input type="number" id="p-weight" value="${lastWeight}" />
        </div>
        <div class="field">
          <label for="p-goals">Goals</label>
          <input type="text" id="p-goals" value="${profile?.goals ?? ""}" />
        </div>
        <div class="field">
          <label for="p-constraints">Injuries / constraints</label>
          <textarea id="p-constraints">${profile?.constraints ?? ""}</textarea>
        </div>
        <button class="btn primary" id="save-profile">Save profile</button>
      </div>
    `;
    wrap.querySelector("#save-profile").addEventListener("click", async () => {
      const weightLb = parseFloat(wrap.querySelector("#p-weight").value);
      const weightLog = profile?.weightLog ? [...profile.weightLog] : [];
      if (weightLb) {
        const today = new Date().toISOString().slice(0, 10);
        const last = weightLog[weightLog.length - 1];
        if (last && last.date === today) {
          last.kg = lbToKg(weightLb);
        } else {
          weightLog.push({ date: today, kg: lbToKg(weightLb) });
        }
      }
      await saveProfile({
        ...profile,
        age: wrap.querySelector("#p-age").value ? Number(wrap.querySelector("#p-age").value) : null,
        heightIn: wrap.querySelector("#p-height").value ? Number(wrap.querySelector("#p-height").value) : null,
        goals: wrap.querySelector("#p-goals").value.trim(),
        constraints: wrap.querySelector("#p-constraints").value.trim(),
        weightLog,
      });
      showToast("Profile saved", { type: "success" });
    });
    return wrap;
  }

  // ---- Equipment ----
  function equipmentSection(items) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="section-title">Equipment</div>`;
    const list = document.createElement("div");
    list.className = "stack";
    wrap.appendChild(list);

    function renderList() {
      list.innerHTML = "";
      if (items.length === 0) {
        list.innerHTML = `<div class="card"><p>No equipment added yet.</p></div>`;
      }
      for (const item of items) {
        const row = document.createElement("div");
        row.className = "card row between";
        row.innerHTML = `<span>${item.name} <span class="badge">${item.category}</span>${
          item.available === false ? ' <span class="badge warning">unavailable</span>' : ""
        }</span>`;
        const del = document.createElement("button");
        del.className = "btn sm ghost";
        del.textContent = "Remove";
        del.addEventListener("click", async () => {
          await deleteEquipment(item.id);
          items = items.filter((i) => i.id !== item.id);
          renderList();
        });
        row.appendChild(del);
        list.appendChild(row);
      }
    }
    renderList();

    const addForm = document.createElement("div");
    addForm.className = "card stack";
    addForm.innerHTML = `
      <div class="field">
        <label for="eq-name">Add equipment</label>
        <input type="text" id="eq-name" placeholder="e.g. Adjustable dumbbells 5-50lb" />
      </div>
      <div class="field">
        <label for="eq-cat">Category</label>
        <select id="eq-cat">
          <option value="barbell">Barbell</option>
          <option value="dumbbell">Dumbbell</option>
          <option value="machine">Machine</option>
          <option value="bodyweight">Bodyweight</option>
          <option value="cardio">Cardio</option>
          <option value="other">Other</option>
        </select>
      </div>
      <button class="btn sm" id="add-eq">Add</button>
    `;
    addForm.querySelector("#add-eq").addEventListener("click", async () => {
      const nameInput = addForm.querySelector("#eq-name");
      const name = nameInput.value.trim();
      if (!name) return;
      const category = addForm.querySelector("#eq-cat").value;
      const saved = await saveEquipment({ name, category, details: "", available: true });
      items.push(saved);
      nameInput.value = "";
      renderList();
    });
    wrap.appendChild(addForm);
    return wrap;
  }

  // ---- Programs ----
  function programsSection(items) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="section-title">Programs</div>`;
    const list = document.createElement("div");
    list.className = "stack";
    wrap.appendChild(list);

    function renderList() {
      list.innerHTML = "";
      if (items.length === 0) {
        list.innerHTML = `<div class="card"><p>No program set up yet.</p></div>`;
      }
      for (const item of items) {
        const row = document.createElement("div");
        row.className = "card row between";
        row.innerHTML = `<span>${item.name}${item.active ? ' <span class="badge success">active</span>' : ""}</span>`;
        const del = document.createElement("button");
        del.className = "btn sm ghost";
        del.textContent = "Remove";
        del.addEventListener("click", async () => {
          await deleteProgram(item.id);
          items = items.filter((i) => i.id !== item.id);
          renderList();
        });
        row.appendChild(del);
        list.appendChild(row);
      }
    }
    renderList();

    const addForm = document.createElement("div");
    addForm.className = "card stack";
    addForm.innerHTML = `
      <div class="field">
        <label for="pr-name">Add program</label>
        <input type="text" id="pr-name" placeholder="e.g. 5/3/1" />
      </div>
      <div class="field">
        <label for="pr-structure">Structure notes</label>
        <textarea id="pr-structure" placeholder="Days/week, split, progression"></textarea>
      </div>
      <button class="btn sm" id="add-pr">Add as active program</button>
    `;
    addForm.querySelector("#add-pr").addEventListener("click", async () => {
      const nameInput = addForm.querySelector("#pr-name");
      const name = nameInput.value.trim();
      if (!name) return;
      const structureNotes = addForm.querySelector("#pr-structure").value.trim();
      const saved = await saveProgram({ name, structureNotes, source: "", description: "", active: true });
      items.push(saved);
      nameInput.value = "";
      addForm.querySelector("#pr-structure").value = "";
      renderList();
    });
    wrap.appendChild(addForm);
    return wrap;
  }

  // ---- API key ----
  function apiKeySection(settings) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="section-title">Anthropic API Key</div>
      <div class="card stack">
        <p>Used directly from this device for AI features (Phase 4). Stored locally, never included in exports by default.</p>
        <div class="field">
          <label for="api-key">API key</label>
          <input type="password" id="api-key" value="${settings.apiKey || ""}" placeholder="sk-ant-..." autocomplete="off" />
        </div>
        <div class="row">
          <button class="btn primary" id="save-key">Save</button>
          <button class="btn ghost" id="clear-key">Clear</button>
        </div>
      </div>
    `;
    wrap.querySelector("#save-key").addEventListener("click", async () => {
      const value = wrap.querySelector("#api-key").value.trim();
      await saveSettings({ apiKey: value });
      showToast("API key saved", { type: "success" });
    });
    wrap.querySelector("#clear-key").addEventListener("click", async () => {
      wrap.querySelector("#api-key").value = "";
      await saveSettings({ apiKey: "" });
      showToast("API key cleared");
    });
    return wrap;
  }

  // ---- Appearance ----
  function appearanceSection(settings) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="section-title">Appearance</div>
      <div class="card row">
        <button class="chip selectable" id="theme-dark" aria-pressed="${settings.theme !== "light"}">Dark</button>
        <button class="chip selectable" id="theme-light" aria-pressed="${settings.theme === "light"}">Light</button>
      </div>
    `;
    async function setTheme(theme) {
      document.documentElement.setAttribute("data-theme", theme);
      await saveSettings({ theme });
      wrap.querySelector("#theme-dark").setAttribute("aria-pressed", String(theme === "dark"));
      wrap.querySelector("#theme-light").setAttribute("aria-pressed", String(theme === "light"));
    }
    wrap.querySelector("#theme-dark").addEventListener("click", () => setTheme("dark"));
    wrap.querySelector("#theme-light").addEventListener("click", () => setTheme("light"));
    return wrap;
  }

  // ---- Notifications ----
  // Best-effort: no push server here, so nudges only fire while the app is
  // open (checked on launch) — see js/nudges.js.
  async function notificationsSection(settings) {
    const wrap = document.createElement("div");
    const supported = "Notification" in window;
    const permission = supported ? Notification.permission : "unsupported";
    wrap.innerHTML = `
      <div class="section-title">Notifications</div>
      <div class="card stack">
        <p>Local nudges only (backup reminders, missed workouts) — checked when you open the app, not real push notifications.</p>
        <div class="row between">
          <span>Status</span>
          <span class="badge ${permission === "granted" ? "success" : permission === "denied" ? "warning" : ""}">${permission}</span>
        </div>
        ${
          supported && permission !== "denied"
            ? `<button class="btn sm" id="enable-notif">${settings.notificationsEnabled ? "Disable" : "Enable"} notifications</button>`
            : !supported
              ? `<p class="hint">Not supported in this browser.</p>`
              : `<p class="hint">Blocked at the browser level — re-enable it in your browser's site settings.</p>`
        }
      </div>
    `;
    const btn = wrap.querySelector("#enable-notif");
    if (btn) {
      btn.addEventListener("click", async () => {
        if (settings.notificationsEnabled) {
          await saveSettings({ notificationsEnabled: false });
          showToast("Notifications disabled");
          render(container);
          return;
        }
        const result = permission === "granted" ? "granted" : await Notification.requestPermission();
        if (result === "granted") {
          await saveSettings({ notificationsEnabled: true });
          showToast("Notifications enabled", { type: "success" });
        } else {
          showToast("Permission not granted", { type: "danger" });
        }
        render(container);
      });
    }
    return wrap;
  }

  // ---- Backup / storage ----
  async function backupSection(settings) {
    const wrap = document.createElement("div");
    let persisted = false;
    if (navigator.storage && navigator.storage.persisted) {
      persisted = await navigator.storage.persisted();
    }
    wrap.innerHTML = `
      <div class="section-title">Data & Backup</div>
      <div class="card stack">
        <div class="row between">
          <span>Persistent storage</span>
          <span class="badge ${persisted ? "success" : "warning"}">${persisted ? "granted" : "not granted"}</span>
        </div>
        ${persisted ? "" : `<button class="btn sm" id="request-persist">Request persistent storage</button>`}
        <hr />
        <p>Export everything to a JSON file — this is your backup. Import replaces all current data.</p>
        <button class="btn primary block" id="export-btn">Export data</button>
        <button class="btn block" id="import-btn">Import data</button>
        <input type="file" id="import-file" accept="application/json" style="display:none" />
      </div>
    `;

    const persistBtn = wrap.querySelector("#request-persist");
    if (persistBtn) {
      persistBtn.addEventListener("click", async () => {
        const granted = await requestPersistentStorage();
        showToast(granted ? "Persistent storage granted" : "Request denied by browser", {
          type: granted ? "success" : "danger",
        });
        render(container);
      });
    }

    wrap.querySelector("#export-btn").addEventListener("click", async () => {
      const data = await exportAll({ includeApiKey: false });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `fitsync-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      await saveSettings({ lastExportAt: new Date().toISOString() });
      showToast("Export downloaded", { type: "success" });
    });

    const fileInput = wrap.querySelector("#import-file");
    wrap.querySelector("#import-btn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const confirmed = confirm(
        "Importing will replace ALL current data with the contents of this file. This cannot be undone. Continue?"
      );
      if (!confirmed) {
        fileInput.value = "";
        return;
      }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await importAll(data);
        showToast("Import complete", { type: "success" });
        render(container);
      } catch (e) {
        showToast(`Import failed: ${e.message}`, { type: "danger", duration: 6000 });
      }
      fileInput.value = "";
    });

    return wrap;
  }

  function linksSection() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="section-title">Library</div>
      <div class="card row between">
        <span>Exercise Library</span>
        <button class="btn sm" id="go-exercises">Open</button>
      </div>
      <div class="card row between">
        <span>AI Activity</span>
        <button class="btn sm" id="go-ai-events">Open</button>
      </div>
    `;
    wrap.querySelector("#go-exercises").addEventListener("click", () => {
      location.hash = "#/exercises";
    });
    wrap.querySelector("#go-ai-events").addEventListener("click", () => {
      location.hash = "#/ai-events";
    });
    return wrap;
  }
}
