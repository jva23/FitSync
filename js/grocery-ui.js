// Grocery list card: aisle-grouped, consolidated, check-off with
// strikethrough. Manual items are typed in directly; recipe-derived items
// come from "Generate from recipes" (js/grocery.js) and get replaced
// wholesale each time that's clicked, without touching manual items or
// their checked state.
import { AISLES } from "./aisle.js";
import { regenerateGroceryList, normalizeGroceryList } from "./grocery.js";
import { setAisleOverride, listRecipes } from "./db.js";
import { uid } from "./utils.js";
import { showToast } from "./toast.js";

// `aisleOverrides` is a shared Map (from aisle.js's overridesToMap) — this
// function mutates it in place when the owner recategorizes an item, so the
// caller's copy stays in sync across repaints without a refetch.
export function buildGroceryCard(plan, persist, aisleOverrides) {
  plan.groceryList = normalizeGroceryList(plan.groceryList);

  const wrap = document.createElement("div");
  wrap.className = "card stack";
  wrap.innerHTML = `
    <div class="row between">
      <div class="section-title" style="margin:0;">Grocery list</div>
      <button class="btn sm" id="grocery-generate">Generate from recipes</button>
    </div>
    <div class="stack" id="grocery-groups"></div>
    <div class="row">
      <input type="text" id="grocery-item" placeholder="Add item" style="flex:1;" />
      <button class="btn sm" id="grocery-add">Add</button>
    </div>
  `;

  function render() {
    const groupsEl = wrap.querySelector("#grocery-groups");
    groupsEl.innerHTML = "";
    if (plan.groceryList.length === 0) {
      groupsEl.innerHTML = `<p class="hint">Nothing added yet.</p>`;
      return;
    }
    const byAisle = new Map();
    for (const item of plan.groceryList) {
      const aisle = item.aisle || "other";
      if (!byAisle.has(aisle)) byAisle.set(aisle, []);
      byAisle.get(aisle).push(item);
    }
    for (const aisle of AISLES) {
      const items = byAisle.get(aisle);
      if (!items || items.length === 0) continue;
      const section = document.createElement("div");
      section.className = "stack";
      const label = document.createElement("div");
      label.className = "hint";
      label.style.textTransform = "capitalize";
      label.textContent = aisle;
      section.appendChild(label);
      for (const item of items) section.appendChild(itemRow(item));
      groupsEl.appendChild(section);
    }
  }

  function itemRow(item) {
    const row = document.createElement("div");
    row.className = "row between";

    const label = document.createElement("span");
    label.textContent = item.text;
    label.style.cursor = "pointer";
    if (item.checked) label.style.cssText = "text-decoration:line-through;color:var(--text-faint);";
    label.addEventListener("click", async () => {
      item.checked = !item.checked;
      await persist();
      render();
    });
    row.appendChild(label);

    const controls = document.createElement("div");
    controls.className = "row";

    const aisleSelect = document.createElement("select");
    for (const a of AISLES) {
      const opt = document.createElement("option");
      opt.value = a;
      opt.textContent = a;
      opt.selected = a === (item.aisle || "other");
      aisleSelect.appendChild(opt);
    }
    aisleSelect.addEventListener("change", async (e) => {
      item.aisle = e.target.value;
      const key = (item.name || item.text).trim().toLowerCase();
      aisleOverrides.set(key, item.aisle);
      await setAisleOverride(item.name || item.text, item.aisle);
      await persist();
      render();
    });
    controls.appendChild(aisleSelect);

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn sm ghost";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      plan.groceryList = plan.groceryList.filter((i) => i.id !== item.id);
      await persist();
      render();
    });
    controls.appendChild(removeBtn);

    row.appendChild(controls);
    return row;
  }

  wrap.querySelector("#grocery-generate").addEventListener("click", async () => {
    const allRecipes = await listRecipes();
    const recipesById = new Map(allRecipes.map((r) => [r.id, r]));
    plan.groceryList = regenerateGroceryList(plan, recipesById, aisleOverrides);
    await persist();
    render();
    showToast("Grocery list updated from this week's recipes", { type: "success" });
  });

  wrap.querySelector("#grocery-add").addEventListener("click", async () => {
    const input = wrap.querySelector("#grocery-item");
    const value = input.value.trim();
    if (!value) return;
    plan.groceryList.push({
      id: uid(),
      text: value,
      name: value,
      aisle: aisleOverrides.get(value.trim().toLowerCase()) || "other",
      checked: false,
      source: "manual",
    });
    input.value = "";
    await persist();
    render();
  });

  render();
  return wrap;
}
