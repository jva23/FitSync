import { listExercises, saveExercise, deleteExercise } from "../db.js";

const CATEGORIES = ["barbell", "dumbbell", "machine", "bodyweight", "cardio", "other"];
const MUSCLE_GROUPS = [
  "chest", "back", "shoulders", "biceps", "triceps", "forearms",
  "quads", "hamstrings", "glutes", "calves", "core", "full_body", "cardio",
];

export async function render(container) {
  let exercises = await listExercises();
  let categoryFilter = "all";
  let search = "";
  let editingId = null;

  paint();

  function paint() {
    container.innerHTML = "";
    container.appendChild(toolbar());
    container.appendChild(list());
  }

  function toolbar() {
    const wrap = document.createElement("div");
    wrap.className = "stack";
    wrap.innerHTML = `
      <input type="text" id="search" placeholder="Search exercises..." value="${search}" />
      <div class="row wrap" id="cat-chips"></div>
      <button class="btn primary block" id="add-btn">${editingId ? "Cancel edit" : "Add exercise"}</button>
      <div id="form-slot"></div>
    `;
    wrap.querySelector("#search").addEventListener("input", (e) => {
      search = e.target.value.toLowerCase();
      renderList();
    });
    const chipWrap = wrap.querySelector("#cat-chips");
    for (const cat of ["all", ...CATEGORIES]) {
      const chip = document.createElement("button");
      chip.className = "chip selectable";
      chip.textContent = cat === "all" ? "All" : cat;
      chip.setAttribute("aria-pressed", String(cat === categoryFilter));
      chip.addEventListener("click", () => {
        categoryFilter = cat;
        for (const c of chipWrap.children) c.setAttribute("aria-pressed", "false");
        chip.setAttribute("aria-pressed", "true");
        renderList();
      });
      chipWrap.appendChild(chip);
    }
    wrap.querySelector("#add-btn").addEventListener("click", () => {
      if (editingId) {
        editingId = null;
        paint();
      } else {
        openForm(wrap.querySelector("#form-slot"), null);
      }
    });
    return wrap;
  }

  function openForm(slot, exercise) {
    editingId = exercise?.id || "new";
    slot.innerHTML = "";
    slot.appendChild(exerciseForm(exercise));
  }

  function exerciseForm(exercise) {
    const wrap = document.createElement("div");
    wrap.className = "card stack";
    const selectedMuscles = new Set(exercise?.muscleGroups || []);
    const selectedCats = new Set(exercise?.equipmentCategories || []);

    wrap.innerHTML = `
      <div class="field">
        <label for="ex-name">Name</label>
        <input type="text" id="ex-name" value="${exercise?.name ?? ""}" />
      </div>
      <div class="field">
        <label>Equipment</label>
        <div class="row wrap" id="ex-cats"></div>
      </div>
      <div class="field">
        <label>Muscle groups</label>
        <div class="row wrap" id="ex-muscles"></div>
      </div>
      <div class="field">
        <label for="ex-notes">Notes</label>
        <textarea id="ex-notes">${exercise?.notes ?? ""}</textarea>
      </div>
      <div class="row">
        <button class="btn primary" id="save-ex">Save</button>
        ${exercise ? `<button class="btn danger" id="delete-ex">Delete</button>` : ""}
      </div>
    `;

    const catWrap = wrap.querySelector("#ex-cats");
    for (const cat of CATEGORIES) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip selectable";
      chip.textContent = cat;
      chip.setAttribute("aria-pressed", String(selectedCats.has(cat)));
      chip.addEventListener("click", () => {
        if (selectedCats.has(cat)) selectedCats.delete(cat);
        else selectedCats.add(cat);
        chip.setAttribute("aria-pressed", String(selectedCats.has(cat)));
      });
      catWrap.appendChild(chip);
    }

    const muscleWrap = wrap.querySelector("#ex-muscles");
    for (const m of MUSCLE_GROUPS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip selectable";
      chip.textContent = m;
      chip.setAttribute("aria-pressed", String(selectedMuscles.has(m)));
      chip.addEventListener("click", () => {
        if (selectedMuscles.has(m)) selectedMuscles.delete(m);
        else selectedMuscles.add(m);
        chip.setAttribute("aria-pressed", String(selectedMuscles.has(m)));
      });
      muscleWrap.appendChild(chip);
    }

    wrap.querySelector("#save-ex").addEventListener("click", async () => {
      const name = wrap.querySelector("#ex-name").value.trim();
      if (!name) return;
      const saved = await saveExercise({
        ...(exercise || {}),
        name,
        equipmentCategories: [...selectedCats],
        muscleGroups: [...selectedMuscles],
        notes: wrap.querySelector("#ex-notes").value.trim(),
      });
      exercises = exercise
        ? exercises.map((e) => (e.id === saved.id ? saved : e))
        : [...exercises, saved];
      editingId = null;
      paint();
    });

    const deleteBtn = wrap.querySelector("#delete-ex");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        await deleteExercise(exercise.id);
        exercises = exercises.filter((e) => e.id !== exercise.id);
        editingId = null;
        paint();
      });
    }
    return wrap;
  }

  function filtered() {
    return exercises
      .filter((e) => categoryFilter === "all" || (e.equipmentCategories || []).includes(categoryFilter))
      .filter((e) => !search || e.name.toLowerCase().includes(search))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function list() {
    const listEl = document.createElement("div");
    listEl.className = "stack";
    listEl.id = "ex-list";
    renderList(listEl);
    return listEl;
  }

  function renderList(el) {
    const listEl = el || container.querySelector("#ex-list");
    if (!listEl) return;
    const items = filtered();
    listEl.innerHTML = "";
    if (items.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><p>No exercises match. Try a different filter or add one.</p></div>`;
      return;
    }
    for (const ex of items) {
      const row = document.createElement("div");
      row.className = "card";
      const cats = (ex.equipmentCategories || []).map((c) => `<span class="badge">${c}</span>`).join(" ");
      const muscles = (ex.muscleGroups || []).join(", ");
      row.innerHTML = `
        <div class="row between">
          <strong>${ex.name}</strong>
          <button class="btn sm ghost" data-edit="${ex.id}">Edit</button>
        </div>
        <p style="margin-top:6px;">${muscles || "&nbsp;"}</p>
        <div class="row wrap">${cats}</div>
      `;
      row.querySelector("[data-edit]").addEventListener("click", () => {
        const slot = container.querySelector("#form-slot");
        openForm(slot, ex);
      });
      listEl.appendChild(row);
    }
  }
}
