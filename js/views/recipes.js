// Recipe library: search/filter/sort, and the "+ Add Recipe" chooser with
// all four intake paths (Manual, Paste/Import, From Photo, From URL) wired
// up as of Phase 6b.
import { listRecipes, saveRecipe, saveRecipeImage } from "../db.js";
import { buildRecipeForm } from "../recipe-form.js";
import { buildPastePanel, buildPhotoPanel, buildUrlPanel } from "../recipe-intake.js";
import { downscaleImage, escapeHtml } from "../utils.js";
import { showToast } from "../toast.js";

const PREP_FILTERS = ["all", "grill", "smoker", "stove", "oven", "none", "mixed"];
const SORTS = [
  { value: "recent", label: "Recently updated" },
  { value: "cooked", label: "Most cooked" },
  { value: "rating", label: "Highest rated" },
  { value: "title", label: "Title A-Z" },
];

function confidenceMark(c) {
  if (c === "verified") return "✓";
  if (c === "ai_estimate") return "~";
  return "?";
}

export async function render(container) {
  let recipes = await listRecipes();
  let search = "";
  let categoryFilter = "all";
  let prepFilter = "all";
  let sortBy = "recent";

  // mode: null (browsing) | "manual" | "paste" | "photo" | "url" (intake
  // panel showing) | "review" (extraction done, showing the editable form).
  let mode = null;
  let reviewDraft = null;
  let reviewWarnings = [];
  let reviewSourcePhotos = [];

  paint();

  function paint() {
    container.innerHTML = "";
    container.appendChild(toolbar());
    if (mode) container.appendChild(modeSlot());
    container.appendChild(list());
  }

  function allCategories() {
    return [...new Set(recipes.flatMap((r) => r.categories || []))].sort();
  }

  function toolbar() {
    const wrap = document.createElement("div");
    wrap.className = "stack";
    wrap.innerHTML = `
      <input type="text" id="r-search" placeholder="Search title, ingredient, category..." />
      <div class="row wrap" id="cat-chips"></div>
      <div class="row wrap" id="prep-chips"></div>
      <select id="sort-select"></select>
      <div class="row wrap" id="add-chooser"></div>
    `;
    wrap.querySelector("#r-search").value = search;
    wrap.querySelector("#r-search").addEventListener("input", (e) => {
      search = e.target.value.toLowerCase();
      renderList();
    });

    const catChipWrap = wrap.querySelector("#cat-chips");
    for (const cat of ["all", ...allCategories()]) {
      const chip = document.createElement("button");
      chip.className = "chip selectable";
      chip.textContent = cat === "all" ? "All categories" : cat;
      chip.setAttribute("aria-pressed", String(cat === categoryFilter));
      chip.addEventListener("click", () => {
        categoryFilter = cat;
        for (const c of catChipWrap.children) c.setAttribute("aria-pressed", "false");
        chip.setAttribute("aria-pressed", "true");
        renderList();
      });
      catChipWrap.appendChild(chip);
    }

    const prepChipWrap = wrap.querySelector("#prep-chips");
    for (const method of PREP_FILTERS) {
      const chip = document.createElement("button");
      chip.className = "chip selectable";
      chip.textContent = method === "all" ? "All prep" : method;
      chip.setAttribute("aria-pressed", String(method === prepFilter));
      chip.addEventListener("click", () => {
        prepFilter = method;
        for (const c of prepChipWrap.children) c.setAttribute("aria-pressed", "false");
        chip.setAttribute("aria-pressed", "true");
        renderList();
      });
      prepChipWrap.appendChild(chip);
    }

    const sortSelect = wrap.querySelector("#sort-select");
    for (const s of SORTS) {
      const opt = document.createElement("option");
      opt.value = s.value;
      opt.textContent = s.label;
      opt.selected = s.value === sortBy;
      sortSelect.appendChild(opt);
    }
    sortSelect.addEventListener("change", (e) => {
      sortBy = e.target.value;
      renderList();
    });

    const chooser = wrap.querySelector("#add-chooser");
    const options = [
      { label: "Manual", mode: "manual" },
      { label: "From URL", mode: "url" },
      { label: "From Photo", mode: "photo" },
      { label: "Paste/Import", mode: "paste" },
    ];
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.className = "btn primary";
      btn.textContent = `+ ${opt.label}`;
      btn.addEventListener("click", () => {
        mode = opt.mode;
        paint();
      });
      chooser.appendChild(btn);
    }

    return wrap;
  }

  function resetIntake() {
    mode = null;
    reviewDraft = null;
    reviewWarnings = [];
    reviewSourcePhotos = [];
  }

  function modeSlot() {
    const slot = document.createElement("div");

    if (mode === "manual") {
      slot.appendChild(reviewForm(null, []));
      return slot;
    }
    if (mode === "review") {
      slot.appendChild(reviewForm(reviewDraft, reviewWarnings));
      return slot;
    }

    const onExtracted = (recipe, warnings, sourcePhotos) => {
      reviewDraft = recipe;
      reviewWarnings = warnings;
      reviewSourcePhotos = sourcePhotos;
      mode = "review";
      paint();
    };
    const onCancel = () => {
      resetIntake();
      paint();
    };

    if (mode === "paste") slot.appendChild(buildPastePanel({ onExtracted, onCancel }));
    else if (mode === "photo") slot.appendChild(buildPhotoPanel({ onExtracted, onCancel }));
    else if (mode === "url") slot.appendChild(buildUrlPanel({ onExtracted, onCancel }));

    return slot;
  }

  function reviewForm(recipe, warnings) {
    return buildRecipeForm({
      recipe,
      allCategories: allCategories(),
      warnings,
      onCancel: () => {
        resetIntake();
        paint();
      },
      onSave: async (draft, pendingPhotos) => {
        const saved = await saveRecipe(draft);
        let primarySet = false;
        for (const blob of reviewSourcePhotos) {
          await saveRecipeImage({ recipeId: saved.id, blob, isPrimary: !primarySet });
          primarySet = true;
        }
        for (const file of pendingPhotos) {
          const blob = await downscaleImage(file);
          await saveRecipeImage({ recipeId: saved.id, blob, isPrimary: !primarySet });
          primarySet = true;
        }
        showToast("Recipe saved", { type: "success" });
        location.hash = `#/recipe/${saved.id}`;
      },
    });
  }

  function filtered() {
    return recipes
      .filter((r) => categoryFilter === "all" || (r.categories || []).includes(categoryFilter))
      .filter((r) => prepFilter === "all" || r.prepMethod === prepFilter)
      .filter((r) => {
        if (!search) return true;
        const haystack = [r.title, ...(r.categories || []), ...(r.ingredients || []).map((i) => i.name)]
          .join(" ")
          .toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => {
        if (sortBy === "cooked") return (b.timesCooked || 0) - (a.timesCooked || 0);
        if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
        if (sortBy === "title") return a.title.localeCompare(b.title);
        return (b.updatedAt || "").localeCompare(a.updatedAt || "");
      });
  }

  function list() {
    const listEl = document.createElement("div");
    listEl.className = "stack";
    listEl.id = "recipe-list";
    renderList(listEl);
    return listEl;
  }

  function renderList(el) {
    const listEl = el || container.querySelector("#recipe-list");
    if (!listEl) return;
    const items = filtered();
    listEl.innerHTML = "";
    if (items.length === 0) {
      listEl.innerHTML =
        recipes.length === 0
          ? `<div class="empty-state"><p>No recipes yet. Add your first one manually to get started.</p><button class="btn primary" id="empty-add">Add recipe</button></div>`
          : `<div class="empty-state"><p>No recipes match. Try a different filter or search.</p></div>`;
      const emptyAdd = listEl.querySelector("#empty-add");
      if (emptyAdd) {
        emptyAdd.addEventListener("click", () => {
          mode = "manual";
          paint();
        });
      }
      return;
    }
    for (const r of items) {
      const card = document.createElement("div");
      card.className = "card";
      card.style.cursor = "pointer";
      const n = r.nutritionPerServing || {};
      card.innerHTML = `
        <div class="row between">
          <strong>${escapeHtml(r.title)}</strong>
          ${r.rating ? `<span class="hint">${"★".repeat(r.rating)}</span>` : ""}
        </div>
        ${r.description ? `<p>${escapeHtml(r.description)}</p>` : ""}
        <div class="row wrap">
          ${(r.categories || []).map((c) => `<span class="badge">${escapeHtml(c)}</span>`).join("")}
          ${r.prepMethod && r.prepMethod !== "none" ? `<span class="badge">${escapeHtml(r.prepMethod)}</span>` : ""}
          <span class="badge">${confidenceMark(n.confidence)} ${n.kcal || 0} kcal</span>
          ${r.timesCooked ? `<span class="badge success">cooked ${r.timesCooked}×</span>` : ""}
        </div>
      `;
      card.addEventListener("click", () => (location.hash = `#/recipe/${r.id}`));
      listEl.appendChild(card);
    }
  }
}
