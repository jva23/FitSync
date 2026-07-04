// Grocery aisle categorization: a seed keyword map plus learned per-name
// overrides (persisted in db.js's aisle_overrides store) that always win.
export const AISLES = [
  "produce",
  "meat",
  "dairy",
  "bakery",
  "pantry",
  "spices",
  "frozen",
  "beverages",
  "condiments",
  "other",
];

const SEED_KEYWORDS = {
  produce: [
    "onion", "garlic", "tomato", "pepper", "lime", "lemon", "cilantro", "avocado",
    "potato", "carrot", "celery", "lettuce", "spinach", "cabbage", "cucumber",
    "jalapeno", "jalapeño", "corn", "squash", "zucchini", "mushroom", "herb",
    "parsley", "basil", "scallion", "green onion",
  ],
  meat: [
    "chicken", "beef", "pork", "shoulder", "steak", "turkey", "bacon", "sausage",
    "ground beef", "ground turkey", "brisket", "ribs", "shrimp", "fish", "salmon",
    "entraña", "carne",
  ],
  dairy: ["cheese", "milk", "butter", "yogurt", "cream", "egg", "sour cream"],
  bakery: ["bread", "bun", "roll", "tortilla", "bagel"],
  pantry: [
    "flour", "sugar", "rice", "beans", "oil", "vinegar", "pasta", "broth", "stock",
    "can ", "canned", "quinoa", "oat", "cereal", "peanut butter", "honey",
  ],
  spices: [
    "salt", "pepper", "cumin", "paprika", "oregano", "chili powder", "garlic powder",
    "onion powder", "cinnamon", "spice", "seasoning", "bay leaf",
  ],
  frozen: ["frozen"],
  beverages: ["juice", "soda", "water", "coffee", "tea", "beer", "wine"],
  condiments: ["ketchup", "mustard", "mayo", "salsa", "hot sauce", "soy sauce", "bbq sauce", "dressing"],
};

export function guessAisle(name, overrides = new Map()) {
  const key = (name || "").trim().toLowerCase();
  if (overrides.has(key)) return overrides.get(key);
  for (const [aisle, keywords] of Object.entries(SEED_KEYWORDS)) {
    if (keywords.some((kw) => key.includes(kw))) return aisle;
  }
  return "other";
}

export function overridesToMap(records) {
  return new Map((records || []).map((r) => [r.name, r.aisle]));
}
