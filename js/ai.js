// AI client: prompt builders + the Anthropic Messages API call. Action
// validation/apply logic lives in ai-actions.js; snapshot building lives in
// ai-snapshot.js — kept separate so no single file creeps past ~400 lines.
import { getSettings, getMealPlanByWeek } from "./db.js";
import { buildSnapshot } from "./ai-snapshot.js";
import { mondayOf, weekISOFromMonday, todayLocalDate } from "./utils.js";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
export const SONNET_MODEL = "claude-sonnet-4-6";
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 60000;
// A full-week plan (7 workouts + 21 meals + recipes) is a long JSON document;
// it needs far more output room — and wall-clock time — than the 4000-token
// default, or the reply is cut off mid-JSON and can't be parsed.
const WEEK_MAX_TOKENS = 16000;
const WEEK_TIMEOUT_MS = 240000;

export class AiError extends Error {}

const ACTION_ENVELOPE_SPEC = `Respond with JSON only — no prose, no markdown fences — matching this envelope:
{
  "rationale": "2-4 sentences explaining the changes in plain language",
  "actions": [
    { "type": "replace_workout_day", "date": "YYYY-MM-DD", "focus": "Upper push", "exercises": [{ "exerciseName": "Incline DB Press", "sets": 4, "reps": "8-10", "targetWeight": "60 lb DBs", "notes": "" }] },
    { "type": "update_workout_day", "date": "YYYY-MM-DD", "changes": { "focus": "...", "addExercises": [], "removeExerciseNames": [], "setAdjustments": [] } },
    { "type": "mark_rest_day", "date": "YYYY-MM-DD", "reason": "..." },
    { "type": "set_meal_day", "date": "YYYY-MM-DD", "meals": [{ "name": "", "description": "", "recipeId": "optional — id of an owned recipe from the snapshot's RECIPE LIBRARY", "servings": 1, "macros": { "kcal": 0, "protein": 0, "carbs": 0, "fat": 0 }, "prepMethod": "grill|smoker|stove|oven|none", "batchTag": "optional-string" }] },
    { "type": "adjust_macro_targets", "weekISO": "YYYY-Www", "targets": { "kcal": 0, "protein": 0, "carbs": 0, "fat": 0 }, "reason": "" },
    { "type": "log_meal_estimate", "date": "YYYY-MM-DD", "name": "short label", "macros": { "kcal": 0, "protein": 0, "carbs": 0, "fat": 0 }, "confidence": "high|medium|low", "assumptions": "portion assumptions in one line" },
    { "type": "add_note", "text": "" },
    { "type": "save_recipe", "recipe": { "title": "", "description": "", "baseServings": 4, "categories": [], "ingredients": [{ "amount": 0, "unit": "", "name": "", "prepNote": "" }], "steps": [{ "title": "", "text": "", "timerSeconds": 0 }], "prepMethod": "grill|smoker|stove|oven|none|mixed", "nutritionPerServing": { "kcal": 0, "protein": 0, "carbs": 0, "fat": 0, "confidence": "ai_estimate", "assumptions": "" }, "notes": "" } }
  ]
}
Only emit actions for days/things that actually change — prefer minimal diffs. "actions" may be an empty array if nothing needs to change. When a set_meal_day meal sets recipeId, its macros are computed automatically from that recipe's nutritionPerServing x servings — the macros field is only a fallback used if the id turns out invalid, so give your best estimate there too but don't worry about matching it exactly.`;

export const PLANNING_SYSTEM_PROMPT = `You are a strength & nutrition coach for a single owner of this app. Plan ONLY with the equipment and program structure provided in the snapshot — never assume equipment that isn't listed as available. Respect stated injuries/constraints absolutely; never program around them. When generating meals, favor grill- and smoker-friendly, high-protein meals with Latin flavors (the owner cooks this way weekly), and use batchTag to link one prep across multiple days when it makes sense for batch-cooking.

Before inventing a new meal, check the RECIPE LIBRARY in the snapshot — if an owned recipe already fits the day (goals, available equipment/prep method, macros), reuse it via set_meal_day's recipeId + servings instead of reinventing it, and name it in your rationale (e.g. "Tuesday: your smoked pork shoulder tacos, 2 servings"). When you do invent something new that's worth keeping — a solid batch-cook idea, something that fits the owner's flavors and equipment well — propose it as a save_recipe action alongside the plan so it joins the library for future weeks.

Apply basic periodization awareness using the last 4 weeks of logs in the snapshot: if top-set weights or volume have been climbing for several consecutive weeks with no lighter week in between, consider proposing a deload (meaningfully reduced volume and/or intensity, e.g. -40-50% volume or a few weeks back on weight) rather than another progression, and say so explicitly in the rationale. Don't propose a deload just because one hasn't happened recently — only when the accumulated fatigue pattern actually suggests it.

${ACTION_ENVELOPE_SPEC}`;

export const MEAL_ESTIMATE_SYSTEM_PROMPT = `You estimate macros from a short natural-language food description for a fitness app. Be a reasonable, slightly conservative estimator — state your portion assumptions in one line. ${ACTION_ENVELOPE_SPEC}
For this task only emit a single "log_meal_estimate" action.`;

function stripFences(text) {
  return text.replace(/```json|```/g, "").trim();
}

// Models occasionally wrap the JSON in a sentence of prose. Try the whole
// string first, then fall back to the outermost {...} span.
function parseJSONLoose(text) {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw err;
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

// `tools` (optional) is passed straight through to the API for server tools
// like web_fetch. Those flows can interleave the tool call between text
// blocks (a preliminary "I'll fetch that" followed by the real answer after
// the fetch completes), so the *last* text block is Claude's actual answer —
// not content[0], which would grab the preliminary text instead.
export async function callClaude(model, systemPrompt, messages, options = {}) {
  return (await callClaudeRaw(model, systemPrompt, messages, options)).text;
}

async function callClaudeRaw(model, systemPrompt, messages, { maxTokens = 4000, tools, timeoutMs = TIMEOUT_MS } = {}) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new AiError("Add an API key in Settings to use AI features.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
        ...(tools ? { tools } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw new AiError("Request timed out — plan unchanged.");
    throw new AiError("No connection — plan unchanged.");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new AiError("API key rejected — check Settings.");
    throw new AiError(`AI request failed (${res.status}) — plan unchanged.`);
  }

  const data = await res.json();
  const textBlocks = (data.content || []).filter((b) => b.type === "text");
  return {
    text: textBlocks.length ? textBlocks[textBlocks.length - 1].text : "",
    truncated: data.stop_reason === "max_tokens",
  };
}

export async function callClaudeForJSON(model, systemPrompt, messages, options = {}) {
  let { text, truncated } = await callClaudeRaw(model, systemPrompt, messages, options);
  try {
    return parseJSONLoose(text);
  } catch {
    // A reply that hit the token ceiling will just be cut off again on retry.
    if (truncated) throw new AiError("The AI's reply was too long and got cut off — try again, or ask for a smaller change.");
    const retryMessages = [
      ...messages,
      { role: "assistant", content: text },
      {
        role: "user",
        content: "That wasn't valid JSON. Respond with ONLY the JSON object described in the system prompt — no prose, no markdown fences.",
      },
    ];
    ({ text, truncated } = await callClaudeRaw(model, systemPrompt, retryMessages, options));
    try {
      return parseJSONLoose(text);
    } catch {
      console.warn("Unparseable AI response:", text);
      throw new AiError(truncated
        ? "The AI's reply was too long and got cut off — try again, or ask for a smaller change."
        : "AI response wasn't understood — try again.");
    }
  }
}

function normalizeResult(parsed) {
  return {
    rationale: typeof parsed?.rationale === "string" ? parsed.rationale : "",
    actions: Array.isArray(parsed?.actions) ? parsed.actions : [],
  };
}

export async function generateWeek({ weekISO, note } = {}) {
  const targetWeek = weekISO || weekISOFromMonday(mondayOf(todayLocalDate()));
  const snapshot = await buildSnapshot({ weekISO: targetWeek, note });
  const instruction = `Generate a full workout and meal plan for week ${targetWeek}. If a plan already exists for it, treat this as a full regeneration; otherwise create a complete week from scratch.`;
  const messages = [{ role: "user", content: `${instruction}\n\n${snapshot}` }];
  const parsed = await callClaudeForJSON(SONNET_MODEL, PLANNING_SYSTEM_PROMPT, messages, {
    maxTokens: WEEK_MAX_TOKENS,
    timeoutMs: WEEK_TIMEOUT_MS,
  });
  return normalizeResult(parsed);
}

export async function replanWeek(trigger) {
  const weekISO = weekISOFromMonday(mondayOf(todayLocalDate()));
  const snapshot = await buildSnapshot({ weekISO, note: trigger });
  const instruction = `The owner needs the remainder of the current week (from today onward) revised. Trigger: ${trigger}. Only emit actions for days that need to change.`;
  const messages = [{ role: "user", content: `${instruction}\n\n${snapshot}` }];
  const parsed = await callClaudeForJSON(SONNET_MODEL, PLANNING_SYSTEM_PROMPT, messages, {
    maxTokens: 8000,
    timeoutMs: 120000,
  });
  return normalizeResult(parsed);
}

export async function weeklyReview() {
  const weekISO = weekISOFromMonday(mondayOf(todayLocalDate()));
  const snapshot = await buildSnapshot({ weekISO });
  const instruction = `Review the week that just happened. Give exactly ONE memorable observation with ONE recommended change in "rationale" — resist listing multiple insights. Only include an action if the recommendation implies a concrete plan or macro-target change; otherwise return an empty actions array.`;
  const messages = [{ role: "user", content: `${instruction}\n\n${snapshot}` }];
  const parsed = await callClaudeForJSON(SONNET_MODEL, PLANNING_SYSTEM_PROMPT, messages);
  return normalizeResult(parsed);
}

// history: array of {role: 'user'|'assistant', content: string} from this session only —
// the API is stateless, so we always prepend a fresh snapshot.
export async function coachChat(history, message) {
  const weekISO = weekISOFromMonday(mondayOf(todayLocalDate()));
  const snapshot = await buildSnapshot({ weekISO });
  const messages = [
    { role: "user", content: `Current state snapshot (for context, not something to repeat back):\n\n${snapshot}` },
    { role: "assistant", content: "Understood — I have the current state in mind. What would you like to talk about?" },
    ...history,
    { role: "user", content: message },
  ];
  const parsed = await callClaudeForJSON(SONNET_MODEL, PLANNING_SYSTEM_PROMPT, messages);
  return normalizeResult(parsed);
}

// Fast path: tiny prompt, no full snapshot, Haiku for latency.
export async function estimateMealMacros(text) {
  const weekISO = weekISOFromMonday(mondayOf(todayLocalDate()));
  const mealPlan = await getMealPlanByWeek(weekISO);
  const targets = mealPlan?.targets;
  const targetLine = targets
    ? `Owner's daily targets: ${targets.kcal} kcal, ${targets.protein}g protein, ${targets.carbs}g carbs, ${targets.fat}g fat.`
    : "Owner has no macro targets set.";
  const today = todayLocalDate();
  const prompt = `Food description: "${text}"\nDate: ${today}\n${targetLine}\nEstimate macros for this as a log_meal_estimate action.`;
  const messages = [{ role: "user", content: prompt }];
  const parsed = await callClaudeForJSON(HAIKU_MODEL, MEAL_ESTIMATE_SYSTEM_PROMPT, messages, { maxTokens: 1024 });
  return normalizeResult(parsed);
}
