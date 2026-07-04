// UI panels for the three AI-assisted recipe intake paths (paste/photo/URL).
// Each panel collects raw input, calls the matching ai-recipes.js extractor,
// and hands the normalized draft + warnings back to the caller, which is
// responsible for showing the review form (recipe-form.js) and saving.
import { extractRecipeFromText, extractRecipeFromImages, extractRecipeFromUrl, normalizeRecipeDraft } from "./ai-recipes.js";
import { downscaleImage } from "./utils.js";
import { showToast } from "./toast.js";
import { AiError } from "./ai.js";

function withLoading(btn, label, fn) {
  return async () => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try {
      await fn();
    } catch (err) {
      showToast(err instanceof AiError ? err.message : "That didn't work — try again.", { type: "danger", duration: 6000 });
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  };
}

// Paste/Import: accepts pasted canonical recipe JSON (validated + used
// directly, e.g. re-importing an export or a Claude-formatted recipe from a
// separate chat), arbitrary pasted recipe text/markdown (routed through the
// Haiku extraction prompt), or a .json file with either.
export function buildPastePanel({ onExtracted, onCancel }) {
  const wrap = document.createElement("div");
  wrap.className = "card stack";
  wrap.innerHTML = `
    <div class="section-title" style="margin:0;">Paste or import a recipe</div>
    <p class="hint">Paste recipe text/markdown, or canonical recipe JSON (e.g. from a Claude chat) — it's recognized automatically. A .json file works too.</p>
    <textarea id="paste-text" placeholder="Paste a recipe here..." style="min-height:160px;"></textarea>
    <div class="field"><label>Or import a .json file</label><input type="file" id="paste-file" accept=".json,application/json" /></div>
    <div class="row">
      <button type="button" class="btn ghost" id="paste-cancel">Cancel</button>
      <button type="button" class="btn primary" id="paste-go" style="flex:1;">Import</button>
    </div>
  `;

  wrap.querySelector("#paste-cancel").addEventListener("click", () => onCancel());

  wrap.querySelector("#paste-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    wrap.querySelector("#paste-text").value = await file.text();
  });

  const goBtn = wrap.querySelector("#paste-go");
  goBtn.addEventListener(
    "click",
    withLoading(goBtn, "Importing…", async () => {
      const text = wrap.querySelector("#paste-text").value.trim();
      if (!text) return;
      let directJson = null;
      try {
        directJson = JSON.parse(text);
      } catch {
        directJson = null;
      }
      if (directJson && typeof directJson === "object" && (directJson.title || directJson.ingredients)) {
        const source = directJson.source || { type: "claude_import", importedAt: new Date().toISOString() };
        onExtracted(normalizeRecipeDraft(directJson, source), [], []);
        return;
      }
      const { recipe, warnings } = await extractRecipeFromText(text);
      onExtracted(recipe, warnings, []);
    })
  );

  return wrap;
}

// From Photo: one or more photos of a printed/handwritten recipe. Photos are
// downscaled before both the vision call and (on save) attaching them to the
// recipe, so the originals used for extraction end up saved with it per
// RECIPES_MODULE_PLAN §3.3 ("keep the original photo(s) attached").
export function buildPhotoPanel({ onExtracted, onCancel }) {
  const wrap = document.createElement("div");
  wrap.className = "card stack";
  wrap.innerHTML = `
    <div class="section-title" style="margin:0;">Import from photo</div>
    <p class="hint">Photograph a printed or handwritten recipe. Multiple photos (front/back, a two-page spread) are combined into one extraction.</p>
    <input type="file" id="photo-files" accept="image/*" multiple capture="environment" />
    <div class="row">
      <button type="button" class="btn ghost" id="photo-cancel">Cancel</button>
      <button type="button" class="btn primary" id="photo-go" style="flex:1;">Extract recipe</button>
    </div>
  `;

  wrap.querySelector("#photo-cancel").addEventListener("click", () => onCancel());

  const goBtn = wrap.querySelector("#photo-go");
  goBtn.addEventListener(
    "click",
    withLoading(goBtn, "Extracting…", async () => {
      const files = [...wrap.querySelector("#photo-files").files];
      if (files.length === 0) return;
      const blobs = await Promise.all(files.map((f) => downscaleImage(f)));
      const { recipe, warnings } = await extractRecipeFromImages(blobs);
      onExtracted(recipe, warnings, blobs);
    })
  );

  return wrap;
}

// From URL: a client-only PWA can't fetch arbitrary sites directly (CORS),
// so this routes through Claude's server-side web_fetch tool instead of any
// client-side scraping.
export function buildUrlPanel({ onExtracted, onCancel }) {
  const wrap = document.createElement("div");
  wrap.className = "card stack";
  wrap.innerHTML = `
    <div class="section-title" style="margin:0;">Import from URL</div>
    <p class="hint">Fetches the page and extracts the recipe (needs a network connection and an API key in Settings).</p>
    <input type="text" id="url-input" placeholder="https://example.com/recipe" />
    <div class="row">
      <button type="button" class="btn ghost" id="url-cancel">Cancel</button>
      <button type="button" class="btn primary" id="url-go" style="flex:1;">Extract recipe</button>
    </div>
    <p class="hint">If this fails, paste the recipe text instead via Paste/Import.</p>
  `;

  wrap.querySelector("#url-cancel").addEventListener("click", () => onCancel());

  const goBtn = wrap.querySelector("#url-go");
  goBtn.addEventListener(
    "click",
    withLoading(goBtn, "Fetching…", async () => {
      const url = wrap.querySelector("#url-input").value.trim();
      if (!url) return;
      const { recipe, warnings } = await extractRecipeFromUrl(url);
      onExtracted(recipe, warnings, []);
    })
  );

  return wrap;
}
