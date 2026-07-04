// Recipe library: search/filter/sort, and the "+ Add Recipe" chooser. Only
// the Manual path is wired up in Phase 6a — From URL / From Photo /
// Paste-Import are Phase 6b (they need the AI extraction pipeline).
import { listRecipes, saveRecipe, listRecipeImages, saveRecipeImage } from "../db.js";
import { buildRecipeForm } from "../recipe-form.js";
import { showToast } from "../toast.js";

const PREP_FILTERS = ["all", "grill", "smoker", "stove", "oven", "none", "mixed"];
const SORTS = [
  { value: "recent", label: "Recently updated" },
  { value: "cooked", label: "Most cooked" },
  { value: "rating", label: "Highest rated" },
  { value: "title", label: "Title A-Z" },
];

// Downscales a photo client-side before it ever touches IndexedDB, so
// attaching a few phone photos doesn't blow through storage quota.
function downscaleImage(file, maxDim = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          resolve(blob);
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

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
  let showForm = false;

  paint();

  function paint() {
    container.innerHTML = "";
    container.appendChild(toolbar());
    if (showForm) container.appendChild(formSlot());
    container.appendChild(list());
  }

  function allCategories() {
    return [...new Set(recipes.flatMap((r) => r.categories || []))].sort();
  }

  function toolbar() {
    const wrap = document.createElement("div");
    wrap.className = "stack";
    wrap.innerHTML = `
      <input type="text" id="r-search" placeholder="Search title, ingredient, category..." value="${search}" />
      <div class="row wrap" id="cat-chips"></div>
      <div class="row wrap" id="prep-chips"></div>
      <select id="sort-select"></select>
      <div class="row wrap" id="add-chooser"></div>
    `;
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
      { label: "Manual", enabled: true },
      { label: "From URL", enabled: false },
      { label: "From Photo", enabled: false },
      { label: "Paste/Import", enabled: false },
    ];
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.className = opt.enabled ? "btn primary" : "btn ghost";
      btn.textContent = `+ ${opt.label}`;
      btn.addEventListener("click", () => {
        if (!opt.enabled) {
          showToast(`${opt.label} import is coming in a later phase — use Manual for now.`);
          return;
        }
        showForm = true;
        paint();
      });
      chooser.appendChild(btn);
    }

    return wrap;
  }

  function formSlot() {
    const slot = document.createElement("div");
    slot.appendChild(
      buildRecipeForm({
        recipe: null,
        allCategories: allCategories(),
        onCancel: () => {
          showForm = false;
          paint();
        },
        onSave: async (draft, pendingPhotos) => {
          const saved = await saveRecipe(draft);
          for (const file of pendingPhotos) {
            const blob = await downscaleImage(file);
            const existing = await listRecipeImages(saved.id);
            await saveRecipeImage({ recipeId: saved.id, blob, isPrimary: existing.length === 0 });
          }
          showToast("Recipe saved", { type: "success" });
          location.hash = `#/recipe/${saved.id}`;
        },
      })
    );
    return slot;
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
          showForm = true;
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
          <strong>${r.title}</strong>
          ${r.rating ? `<span class="hint">${"★".repeat(r.rating)}</span>` : ""}
        </div>
        ${r.description ? `<p>${r.description}</p>` : ""}
        <div class="row wrap">
          ${(r.categories || []).map((c) => `<span class="badge">${c}</span>`).join("")}
          ${r.prepMethod && r.prepMethod !== "none" ? `<span class="badge">${r.prepMethod}</span>` : ""}
          <span class="badge">${confidenceMark(n.confidence)} ${n.kcal || 0} kcal</span>
          ${r.timesCooked ? `<span class="badge success">cooked ${r.timesCooked}×</span>` : ""}
        </div>
      `;
      card.addEventListener("click", () => (location.hash = `#/recipe/${r.id}`));
      listEl.appendChild(card);
    }
  }
}
