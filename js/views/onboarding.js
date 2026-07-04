// Guided first-run flow: profile -> equipment -> program. Only the profile
// step is required to exit onboarding; equipment/program can be added later
// from Settings, keeping friction low for a single owner setting this up once.
import { saveProfile, saveEquipment, saveProgram, seedExercisesIfEmpty, requestPersistentStorage } from "../db.js";
import { lbToKg } from "../utils.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const EQUIPMENT_PRESETS = [
  { name: "Barbell + Plates", category: "barbell" },
  { name: "Dumbbells", category: "dumbbell" },
  { name: "Adjustable Bench", category: "other" },
  { name: "Squat Rack", category: "other" },
  { name: "Pull-up Bar", category: "bodyweight" },
  { name: "Kettlebell", category: "other" },
  { name: "Cardio Machine", category: "cardio" },
];

export async function render(container) {
  await seedExercisesIfEmpty();
  await requestPersistentStorage().catch(() => {});

  let step = 0;
  const profileDraft = {
    age: "",
    heightIn: "",
    weightLb: "",
    goals: "",
    availability: [],
    constraints: "",
  };
  const equipmentDraft = []; // { name, category, details, available }
  const programDraft = { name: "", source: "", description: "", structureNotes: "" };

  paint();

  function paint() {
    container.innerHTML = "";
    container.appendChild(dots());
    if (step === 0) container.appendChild(profileStep());
    else if (step === 1) container.appendChild(equipmentStep());
    else container.appendChild(programStep());
  }

  function dots() {
    const wrap = document.createElement("div");
    wrap.className = "step-dots";
    for (let i = 0; i < 3; i++) {
      const s = document.createElement("span");
      if (i === step) s.className = "active";
      wrap.appendChild(s);
    }
    return wrap;
  }

  function profileStep() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <h2>Welcome. Let's set up your profile.</h2>
      <p>This grounds every plan the app builds for you. Skip anything you're unsure of — you can edit it later in Settings.</p>
      <div class="field">
        <label for="f-age">Age</label>
        <input type="number" id="f-age" inputmode="numeric" min="10" max="100" value="${profileDraft.age}" />
      </div>
      <div class="field">
        <label for="f-height">Height (inches)</label>
        <input type="number" id="f-height" inputmode="numeric" min="40" max="96" value="${profileDraft.heightIn}" />
      </div>
      <div class="field">
        <label for="f-weight">Current weight (lb)</label>
        <input type="number" id="f-weight" inputmode="decimal" min="60" max="600" value="${profileDraft.weightLb}" />
      </div>
      <div class="field">
        <label for="f-goals">Goals</label>
        <input type="text" id="f-goals" placeholder="e.g. strength + recomposition" value="${profileDraft.goals}" />
      </div>
      <div class="field">
        <label>Weekly availability</label>
        <div class="row wrap" id="f-days"></div>
      </div>
      <div class="field">
        <label for="f-constraints">Injuries / constraints</label>
        <textarea id="f-constraints" placeholder="e.g. left shoulder — avoid overhead press">${profileDraft.constraints}</textarea>
      </div>
      <button class="btn primary block" id="next-btn">Continue</button>
    `;
    const daysWrap = wrap.querySelector("#f-days");
    for (const day of DAYS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip selectable";
      chip.textContent = day;
      chip.setAttribute("aria-pressed", profileDraft.availability.includes(day));
      chip.addEventListener("click", () => {
        const pressed = chip.getAttribute("aria-pressed") === "true";
        chip.setAttribute("aria-pressed", String(!pressed));
        if (pressed) {
          profileDraft.availability = profileDraft.availability.filter((d) => d !== day);
        } else {
          profileDraft.availability.push(day);
        }
      });
      daysWrap.appendChild(chip);
    }

    wrap.querySelector("#next-btn").addEventListener("click", () => {
      profileDraft.age = wrap.querySelector("#f-age").value;
      profileDraft.heightIn = wrap.querySelector("#f-height").value;
      profileDraft.weightLb = wrap.querySelector("#f-weight").value;
      profileDraft.goals = wrap.querySelector("#f-goals").value.trim();
      profileDraft.constraints = wrap.querySelector("#f-constraints").value.trim();
      step = 1;
      paint();
    });
    return wrap;
  }

  function equipmentStep() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <h2>What equipment do you have?</h2>
      <p>Tap the presets you own, or add your own. This is a hard constraint on planning, so add anything specific (e.g. dumbbell range) later in Settings.</p>
      <div class="row wrap" id="presets"></div>
      <hr />
      <div class="section-title">Added</div>
      <div class="stack" id="added-list"></div>
      <hr />
      <div class="field">
        <label for="eq-name">Custom equipment name</label>
        <input type="text" id="eq-name" placeholder="e.g. Trap bar" />
      </div>
      <div class="field">
        <label for="eq-cat">Category</label>
        <select id="eq-cat">
          <option value="barbell">Barbell</option>
          <option value="dumbbell">Dumbbell</option>
          <option value="machine">Machine</option>
          <option value="bodyweight">Bodyweight</option>
          <option value="cardio">Cardio</option>
          <option value="other" selected>Other</option>
        </select>
      </div>
      <button class="btn sm" id="add-custom">Add</button>
      <div class="row" style="margin-top:24px;">
        <button class="btn ghost" id="back-btn">Back</button>
        <button class="btn primary" id="next-btn" style="flex:1;">Continue</button>
      </div>
    `;

    const presetsWrap = wrap.querySelector("#presets");
    for (const preset of EQUIPMENT_PRESETS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip selectable";
      chip.textContent = preset.name;
      const already = () => equipmentDraft.some((e) => e.name === preset.name);
      chip.setAttribute("aria-pressed", already());
      chip.addEventListener("click", () => {
        if (already()) {
          const idx = equipmentDraft.findIndex((e) => e.name === preset.name);
          equipmentDraft.splice(idx, 1);
        } else {
          equipmentDraft.push({ name: preset.name, category: preset.category, details: "", available: true });
        }
        renderAdded();
        chip.setAttribute("aria-pressed", already());
      });
      presetsWrap.appendChild(chip);
    }

    function renderAdded() {
      const list = wrap.querySelector("#added-list");
      list.innerHTML = "";
      if (equipmentDraft.length === 0) {
        list.innerHTML = `<p>Nothing added yet.</p>`;
        return;
      }
      for (const item of equipmentDraft) {
        const row = document.createElement("div");
        row.className = "row between card";
        row.innerHTML = `<span>${item.name} <span class="badge">${item.category}</span></span>`;
        const removeBtn = document.createElement("button");
        removeBtn.className = "btn sm ghost";
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", () => {
          const idx = equipmentDraft.indexOf(item);
          equipmentDraft.splice(idx, 1);
          renderAdded();
          const presetChip = [...presetsWrap.children].find((c) => c.textContent === item.name);
          if (presetChip) presetChip.setAttribute("aria-pressed", "false");
        });
        row.appendChild(removeBtn);
        list.appendChild(row);
      }
    }
    renderAdded();

    wrap.querySelector("#add-custom").addEventListener("click", () => {
      const nameInput = wrap.querySelector("#eq-name");
      const name = nameInput.value.trim();
      if (!name) return;
      const category = wrap.querySelector("#eq-cat").value;
      equipmentDraft.push({ name, category, details: "", available: true });
      nameInput.value = "";
      renderAdded();
    });

    wrap.querySelector("#back-btn").addEventListener("click", () => {
      step = 0;
      paint();
    });
    wrap.querySelector("#next-btn").addEventListener("click", () => {
      step = 2;
      paint();
    });
    return wrap;
  }

  function programStep() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <h2>Your training program</h2>
      <p>Optional — describe the program you're following. Skip this and add it later if you haven't decided yet.</p>
      <div class="field">
        <label for="p-name">Name</label>
        <input type="text" id="p-name" placeholder="e.g. 5/3/1, PPL, custom" />
      </div>
      <div class="field">
        <label for="p-source">Source</label>
        <input type="text" id="p-source" placeholder="e.g. book, coach, self-designed" />
      </div>
      <div class="field">
        <label for="p-desc">Description</label>
        <textarea id="p-desc" placeholder="Brief description"></textarea>
      </div>
      <div class="field">
        <label for="p-structure">Structure notes</label>
        <textarea id="p-structure" placeholder="Days/week, split, progression scheme"></textarea>
      </div>
      <div class="row" style="margin-top:24px;">
        <button class="btn ghost" id="back-btn">Back</button>
        <button class="btn primary block" id="finish-btn">Finish setup</button>
      </div>
    `;
    wrap.querySelector("#back-btn").addEventListener("click", () => {
      step = 1;
      paint();
    });
    wrap.querySelector("#finish-btn").addEventListener("click", async () => {
      programDraft.name = wrap.querySelector("#p-name").value.trim();
      programDraft.source = wrap.querySelector("#p-source").value.trim();
      programDraft.description = wrap.querySelector("#p-desc").value.trim();
      programDraft.structureNotes = wrap.querySelector("#p-structure").value.trim();
      await finish();
    });
    return wrap;
  }

  async function finish() {
    const weightLb = parseFloat(profileDraft.weightLb);
    await saveProfile({
      age: profileDraft.age ? Number(profileDraft.age) : null,
      heightIn: profileDraft.heightIn ? Number(profileDraft.heightIn) : null,
      weightLog: weightLb
        ? [{ date: new Date().toISOString().slice(0, 10), kg: lbToKg(weightLb) }]
        : [],
      goals: profileDraft.goals,
      availability: profileDraft.availability,
      constraints: profileDraft.constraints,
    });

    for (const item of equipmentDraft) {
      await saveEquipment(item);
    }

    if (programDraft.name) {
      await saveProgram({ ...programDraft, active: true });
    }

    location.hash = "#/today";
  }
}
