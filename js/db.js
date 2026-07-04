// The ONLY file that touches IndexedDB. Every write stamps updatedAt/createdAt
// and emits a state event so views re-render from state, not ad-hoc DOM pokes.
import { openDB } from "https://cdn.jsdelivr.net/npm/idb@8/+esm";
import { emit, state } from "./state.js";
import { EXERCISE_SEED } from "./seed/exercises.js";

const DB_NAME = "fitsync";
const DB_VERSION = 3;

const STORES = [
  "profile",
  "settings",
  "equipment",
  "programs",
  "exercises",
  "workout_plans",
  "workout_logs",
  "meal_plans",
  "meal_logs",
  "ai_events",
  "meal_templates",
  "recipes",
  "recipe_images",
];

let dbPromise;

// Every store creation is guarded with `contains()` so this upgrade runs
// safely whether it's a fresh install (oldVersion 0) or an incremental bump
// from an existing v1 database — required since real user data already
// exists at v1 by the time meal_templates was added.
function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("profile")) db.createObjectStore("profile", { keyPath: "id" });
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
        if (!db.objectStoreNames.contains("equipment")) db.createObjectStore("equipment", { keyPath: "id" });
        if (!db.objectStoreNames.contains("programs")) db.createObjectStore("programs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("exercises")) db.createObjectStore("exercises", { keyPath: "id" });

        if (!db.objectStoreNames.contains("workout_plans")) {
          db.createObjectStore("workout_plans", { keyPath: "id" }).createIndex("weekISO", "weekISO");
        }
        if (!db.objectStoreNames.contains("workout_logs")) {
          db.createObjectStore("workout_logs", { keyPath: "id" }).createIndex("date", "date");
        }
        if (!db.objectStoreNames.contains("meal_plans")) {
          db.createObjectStore("meal_plans", { keyPath: "id" }).createIndex("weekISO", "weekISO");
        }
        if (!db.objectStoreNames.contains("meal_logs")) {
          db.createObjectStore("meal_logs", { keyPath: "id" }).createIndex("date", "date");
        }
        if (!db.objectStoreNames.contains("ai_events")) {
          db.createObjectStore("ai_events", { keyPath: "id" }).createIndex("timestamp", "timestamp");
        }
        if (!db.objectStoreNames.contains("meal_templates")) {
          db.createObjectStore("meal_templates", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("recipes")) {
          db.createObjectStore("recipes", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("recipe_images")) {
          db.createObjectStore("recipe_images", { keyPath: "id" }).createIndex("recipeId", "recipeId");
        }
      },
    });
  }
  return dbPromise;
}

function uuid() {
  return crypto.randomUUID();
}

function nowISO() {
  return new Date().toISOString();
}

async function putRecord(store, record) {
  const db = await getDB();
  const ts = nowISO();
  const stamped = {
    ...record,
    id: record.id || uuid(),
    createdAt: record.createdAt || ts,
    updatedAt: ts,
  };
  await db.put(store, stamped);
  return stamped;
}

async function deleteRecord(store, id) {
  const db = await getDB();
  await db.delete(store, id);
}

async function listRecords(store) {
  const db = await getDB();
  return db.getAll(store);
}

// ---- Profile (single record) ----
export async function getProfile() {
  const db = await getDB();
  return (await db.get("profile", "profile")) || null;
}

export async function saveProfile(profile) {
  const stamped = await putRecord("profile", { ...profile, id: "profile" });
  state.profile = stamped;
  emit("profile:changed", stamped);
  return stamped;
}

// ---- Settings (single record) ----
const DEFAULT_SETTINGS = {
  id: "settings",
  apiKey: "",
  units: "imperial",
  theme: "dark",
  notificationsEnabled: false,
  persistentStorage: false,
  lastExportAt: null,
  recipesMigrated: false,
};

export async function getSettings() {
  const db = await getDB();
  const s = await db.get("settings", "settings");
  return s || { ...DEFAULT_SETTINGS };
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial, id: "settings" };
  const stamped = await putRecord("settings", merged);
  state.settings = stamped;
  emit("settings:changed", stamped);
  return stamped;
}

// ---- Equipment ----
export async function listEquipment() {
  return listRecords("equipment");
}

export async function saveEquipment(item) {
  const stamped = await putRecord("equipment", item);
  state.equipment = await listEquipment();
  emit("equipment:changed", state.equipment);
  return stamped;
}

export async function deleteEquipment(id) {
  await deleteRecord("equipment", id);
  state.equipment = await listEquipment();
  emit("equipment:changed", state.equipment);
}

// ---- Programs ----
export async function listPrograms() {
  return listRecords("programs");
}

export async function saveProgram(item) {
  const stamped = await putRecord("programs", item);
  state.programs = await listPrograms();
  emit("programs:changed", state.programs);
  return stamped;
}

export async function deleteProgram(id) {
  await deleteRecord("programs", id);
  state.programs = await listPrograms();
  emit("programs:changed", state.programs);
}

// ---- Exercises ----
export async function listExercises() {
  return listRecords("exercises");
}

export async function saveExercise(item) {
  const stamped = await putRecord("exercises", {
    prs: [],
    ...item,
  });
  state.exercises = await listExercises();
  emit("exercises:changed", state.exercises);
  return stamped;
}

export async function deleteExercise(id) {
  await deleteRecord("exercises", id);
  state.exercises = await listExercises();
  emit("exercises:changed", state.exercises);
}

export async function seedExercisesIfEmpty() {
  const existing = await listExercises();
  if (existing.length > 0) return existing;
  const db = await getDB();
  const tx = db.transaction("exercises", "readwrite");
  const ts = nowISO();
  for (const ex of EXERCISE_SEED) {
    await tx.store.put({
      id: uuid(),
      createdAt: ts,
      updatedAt: ts,
      prs: [],
      notes: "",
      ...ex,
    });
  }
  await tx.done;
  state.exercises = await listExercises();
  emit("exercises:changed", state.exercises);
  return state.exercises;
}

// ---- Workout plans (one per weekISO) ----
export async function getWorkoutPlanByWeek(weekISO) {
  const db = await getDB();
  const all = await db.getAllFromIndex("workout_plans", "weekISO", weekISO);
  return all[0] || null;
}

export async function saveWorkoutPlan(plan) {
  const stamped = await putRecord("workout_plans", plan);
  emit("workout_plans:changed", stamped);
  return stamped;
}

export async function listWorkoutPlans() {
  return listRecords("workout_plans");
}

// ---- Workout logs (one per session; usually one per date) ----
export async function getWorkoutLogsByDate(date) {
  const db = await getDB();
  return db.getAllFromIndex("workout_logs", "date", date);
}

export async function saveWorkoutLog(log) {
  const stamped = await putRecord("workout_logs", log);
  emit("workout_logs:changed", stamped);
  return stamped;
}

// Most recent previously-logged performance for an exercise, so the logging
// screen can show "last time: 135 x 8" inline.
export async function getLastLogForExercise(exerciseId, beforeDate) {
  const db = await getDB();
  const all = await db.getAll("workout_logs");
  const matches = all
    .filter(
      (l) =>
        (!beforeDate || l.date < beforeDate) &&
        (l.exercises || []).some((e) => e.exerciseId === exerciseId)
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!matches.length) return null;
  const log = matches[0];
  const exercise = log.exercises.find((e) => e.exerciseId === exerciseId);
  return { date: log.date, exercise };
}

// ---- Meal plans (one per weekISO) ----
export async function getMealPlanByWeek(weekISO) {
  const db = await getDB();
  const all = await db.getAllFromIndex("meal_plans", "weekISO", weekISO);
  return all[0] || null;
}

export async function saveMealPlan(plan) {
  const stamped = await putRecord("meal_plans", plan);
  emit("meal_plans:changed", stamped);
  return stamped;
}

export async function deleteWorkoutPlan(id) {
  await deleteRecord("workout_plans", id);
  emit("workout_plans:changed", null);
}

export async function deleteMealPlan(id) {
  await deleteRecord("meal_plans", id);
  emit("meal_plans:changed", null);
}

export async function deleteMealLog(id) {
  await deleteRecord("meal_logs", id);
  emit("meal_logs:changed", null);
}

// ---- Meal logs (one per date) ----
export async function getMealLogByDate(date) {
  const db = await getDB();
  const all = await db.getAllFromIndex("meal_logs", "date", date);
  return all[0] || null;
}

export async function saveMealLog(log) {
  const stamped = await putRecord("meal_logs", log);
  emit("meal_logs:changed", stamped);
  return stamped;
}

// ---- Bulk reads for charts/dashboard ----
export async function listWorkoutLogs() {
  return listRecords("workout_logs");
}

export async function listMealLogs() {
  return listRecords("meal_logs");
}

// ---- Meal templates (save any logged/planned meal for reuse) ----
export async function listMealTemplates() {
  return listRecords("meal_templates");
}

export async function saveMealTemplate(template) {
  const stamped = await putRecord("meal_templates", template);
  emit("meal_templates:changed", stamped);
  return stamped;
}

export async function deleteMealTemplate(id) {
  await deleteRecord("meal_templates", id);
  emit("meal_templates:changed", null);
}

// ---- Recipes ----
export async function listRecipes() {
  return listRecords("recipes");
}

export async function getRecipe(id) {
  const db = await getDB();
  return (await db.get("recipes", id)) || null;
}

export async function saveRecipe(recipe) {
  const stamped = await putRecord("recipes", {
    categories: [],
    ingredients: [],
    steps: [],
    prepMethod: "none",
    times: {},
    nutritionPerServing: { kcal: 0, protein: 0, carbs: 0, fat: 0, confidence: "unknown" },
    notes: "",
    rating: null,
    timesCooked: 0,
    lastCookedAt: null,
    ...recipe,
  });
  emit("recipes:changed", stamped);
  return stamped;
}

export async function deleteRecipe(id) {
  const images = await listRecipeImages(id);
  const db = await getDB();
  const tx = db.transaction(["recipes", "recipe_images"], "readwrite");
  await tx.objectStore("recipes").delete(id);
  for (const img of images) await tx.objectStore("recipe_images").delete(img.id);
  await tx.done;
  emit("recipes:changed", null);
}

// ---- Recipe images (Blobs; kept in their own store so `recipes` stays lean) ----
export async function listRecipeImages(recipeId) {
  const db = await getDB();
  return db.getAllFromIndex("recipe_images", "recipeId", recipeId);
}

export async function saveRecipeImage(image) {
  const stamped = await putRecord("recipe_images", image);
  emit("recipe_images:changed", stamped);
  return stamped;
}

export async function deleteRecipeImage(id) {
  await deleteRecord("recipe_images", id);
  emit("recipe_images:changed", null);
}

// One-time migration: existing meal templates (Phase 5) become starter
// recipes so the owner's saved dishes appear in the new library after the
// upgrade, rather than leaving two disconnected "save a meal" concepts.
// Gated on settings.recipesMigrated (not "recipes store is empty") so it
// stays a true one-time migration even if the owner later deletes every
// recipe they've created since.
export async function migrateMealTemplatesToRecipes() {
  const settings = await getSettings();
  if (settings.recipesMigrated) return;
  const templates = await listMealTemplates();
  for (const tpl of templates) {
    await saveRecipe({
      title: tpl.name,
      description: tpl.description || "",
      source: { type: "manual", sourceName: "Migrated from meal template", importedAt: nowISO() },
      categories: [],
      baseServings: 1,
      ingredients: [],
      steps: [],
      prepMethod: tpl.prepMethod || "none",
      times: {},
      // Meal templates never recorded whether their macros were hand-typed
      // or came from an earlier AI estimate, so "unknown" is the honest
      // confidence here rather than presuming "verified".
      nutritionPerServing: {
        kcal: tpl.macros?.kcal || 0,
        protein: tpl.macros?.protein || 0,
        carbs: tpl.macros?.carbs || 0,
        fat: tpl.macros?.fat || 0,
        confidence: "unknown",
      },
      notes: "",
      rating: null,
      timesCooked: 0,
      lastCookedAt: null,
      batchYield: tpl.batchTag || "",
    });
  }
  await saveSettings({ recipesMigrated: true });
}

// ---- AI audit log (ai_events) ----
export async function saveAiEvent(event) {
  const stamped = await putRecord("ai_events", {
    timestamp: nowISO(),
    ...event,
  });
  emit("ai_events:changed", stamped);
  return stamped;
}

export async function listAiEvents() {
  const db = await getDB();
  const all = await db.getAllFromIndex("ai_events", "timestamp");
  return all.reverse();
}

export async function getLatestAiEvent() {
  const events = await listAiEvents();
  return events[0] || null;
}

// ---- Bootstrap: load everything into state once on startup ----
export async function loadAllIntoState() {
  const [profile, settings, equipment, programs, exercises] = await Promise.all([
    getProfile(),
    getSettings(),
    listEquipment(),
    listPrograms(),
    listExercises(),
  ]);
  state.profile = profile;
  state.settings = settings;
  state.equipment = equipment;
  state.programs = programs;
  state.exercises = exercises;
  await migrateMealTemplatesToRecipes();
  state.ready = true;
  emit("state:ready", state);
  return state;
}

// ---- Storage persistence ----
export async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  const granted = await navigator.storage.persist();
  await saveSettings({ persistentStorage: granted });
  return granted;
}

// ---- Export / Import (the backup story) ----
// recipe_images holds Blobs, which aren't JSON-serializable — round-trip
// them through data: URLs on the way out and back on the way in.
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataURL) {
  const res = await fetch(dataURL);
  return res.blob();
}

export async function exportAll({ includeApiKey = false } = {}) {
  const db = await getDB();
  const data = { exportedAt: nowISO(), version: DB_VERSION };
  for (const store of STORES) {
    const records = await db.getAll(store);
    data[store] =
      store === "recipe_images"
        ? await Promise.all(
            records.map(async (r) => (r.blob instanceof Blob ? { ...r, blob: await blobToDataURL(r.blob) } : r))
          )
        : records;
  }
  if (!includeApiKey) {
    data.settings = (data.settings || []).map((s) => ({ ...s, apiKey: "" }));
  }
  return data;
}

function validateImportShape(data) {
  if (!data || typeof data !== "object") return "File is not a valid export (not an object).";
  const hasAnyStore = STORES.some((s) => Array.isArray(data[s]));
  if (!hasAnyStore) return "File doesn't look like a FitSync export (no recognizable data).";
  for (const store of STORES) {
    if (data[store] !== undefined && !Array.isArray(data[store])) {
      return `Store "${store}" is malformed (expected a list).`;
    }
  }
  return null;
}

// Wipe-and-replace within one transaction. The current API key is preserved
// unless the import file explicitly includes one, since exports omit it by default.
export async function importAll(data) {
  const error = validateImportShape(data);
  if (error) throw new Error(error);

  // Convert recipe photo data: URLs back to Blobs before opening the
  // transaction below — awaiting a non-IndexedDB async op (fetch) partway
  // through an open IDB transaction risks the transaction auto-closing.
  const prepared = { ...data };
  if (Array.isArray(prepared.recipe_images)) {
    prepared.recipe_images = await Promise.all(
      prepared.recipe_images.map(async (rec) =>
        typeof rec.blob === "string" ? { ...rec, blob: await dataURLToBlob(rec.blob) } : rec
      )
    );
  }

  const db = await getDB();
  const previousSettings = await getSettings();

  const tx = db.transaction(STORES, "readwrite");
  await Promise.all(STORES.map((s) => tx.objectStore(s).clear()));
  for (const store of STORES) {
    const records = Array.isArray(prepared[store]) ? prepared[store] : [];
    for (const rec of records) {
      await tx.objectStore(store).put(rec);
    }
  }
  await tx.done;

  const importedSettings = await getSettings();
  if (!importedSettings.apiKey && previousSettings.apiKey) {
    await saveSettings({ apiKey: previousSettings.apiKey });
  }

  await loadAllIntoState();
  emit("data:imported", state);
  return state;
}
