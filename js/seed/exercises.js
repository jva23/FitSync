// Seed exercise library: ~60 common exercises tagged by equipment category and muscle group.
// equipmentCategories values match equipment.category enum: barbell | dumbbell | machine | bodyweight | cardio | other
export const EXERCISE_SEED = [
  // Barbell
  { name: "Barbell Back Squat", muscleGroups: ["quads", "glutes", "core"], equipmentCategories: ["barbell"], notes: "" },
  { name: "Barbell Front Squat", muscleGroups: ["quads", "core"], equipmentCategories: ["barbell"], notes: "" },
  { name: "Barbell Deadlift", muscleGroups: ["hamstrings", "glutes", "back"], equipmentCategories: ["barbell"], notes: "" },
  { name: "Romanian Deadlift", muscleGroups: ["hamstrings", "glutes"], equipmentCategories: ["barbell"], notes: "" },
  { name: "Barbell Bench Press", muscleGroups: ["chest", "triceps", "shoulders"], equipmentCategories: ["barbell"], notes: "" },
  { name: "Incline Barbell Bench Press", muscleGroups: ["chest", "shoulders", "triceps"], equipmentCategories: ["barbell"], notes: "" },
  { name: "Barbell Overhead Press", muscleGroups: ["shoulders", "triceps"], equipmentCategories: ["barbell"], notes: "" },
  { name: "Barbell Row", muscleGroups: ["back", "biceps"], equipmentCategories: ["barbell"], notes: "" },
  { name: "Barbell Hip Thrust", muscleGroups: ["glutes", "hamstrings"], equipmentCategories: ["barbell"], notes: "" },
  { name: "Barbell Curl", muscleGroups: ["biceps", "forearms"], equipmentCategories: ["barbell"], notes: "" },

  // Dumbbell
  { name: "Dumbbell Bench Press", muscleGroups: ["chest", "triceps", "shoulders"], equipmentCategories: ["dumbbell"], notes: "" },
  { name: "Incline Dumbbell Press", muscleGroups: ["chest", "shoulders", "triceps"], equipmentCategories: ["dumbbell"], notes: "" },
  { name: "Dumbbell Chest Fly", muscleGroups: ["chest"], equipmentCategories: ["dumbbell"], notes: "" },
  { name: "Dumbbell Shoulder Press", muscleGroups: ["shoulders", "triceps"], equipmentCategories: ["dumbbell"], notes: "" },
  { name: "Dumbbell Lateral Raise", muscleGroups: ["shoulders"], equipmentCategories: ["dumbbell"], notes: "" },
  { name: "Dumbbell Row", muscleGroups: ["back", "biceps"], equipmentCategories: ["dumbbell"], notes: "" },
  { name: "Dumbbell Romanian Deadlift", muscleGroups: ["hamstrings", "glutes"], equipmentCategories: ["dumbbell"], notes: "" },
  { name: "Dumbbell Goblet Squat", muscleGroups: ["quads", "glutes"], equipmentCategories: ["dumbbell"], notes: "" },
  { name: "Dumbbell Walking Lunge", muscleGroups: ["quads", "glutes"], equipmentCategories: ["dumbbell"], notes: "" },
  { name: "Dumbbell Bulgarian Split Squat", muscleGroups: ["quads", "glutes"], equipmentCategories: ["dumbbell"], notes: "" },
  { name: "Dumbbell Curl", muscleGroups: ["biceps", "forearms"], equipmentCategories: ["dumbbell"], notes: "" },
  { name: "Dumbbell Skull Crusher", muscleGroups: ["triceps"], equipmentCategories: ["dumbbell"], notes: "" },

  // Machine / Cable
  { name: "Lat Pulldown", muscleGroups: ["back", "biceps"], equipmentCategories: ["machine"], notes: "" },
  { name: "Seated Cable Row", muscleGroups: ["back", "biceps"], equipmentCategories: ["machine"], notes: "" },
  { name: "Leg Press", muscleGroups: ["quads", "glutes"], equipmentCategories: ["machine"], notes: "" },
  { name: "Leg Extension", muscleGroups: ["quads"], equipmentCategories: ["machine"], notes: "" },
  { name: "Seated Leg Curl", muscleGroups: ["hamstrings"], equipmentCategories: ["machine"], notes: "" },
  { name: "Chest Press Machine", muscleGroups: ["chest", "triceps"], equipmentCategories: ["machine"], notes: "" },
  { name: "Shoulder Press Machine", muscleGroups: ["shoulders", "triceps"], equipmentCategories: ["machine"], notes: "" },
  { name: "Cable Tricep Pushdown", muscleGroups: ["triceps"], equipmentCategories: ["machine"], notes: "" },
  { name: "Cable Face Pull", muscleGroups: ["shoulders", "back"], equipmentCategories: ["machine"], notes: "" },
  { name: "Smith Machine Squat", muscleGroups: ["quads", "glutes"], equipmentCategories: ["machine"], notes: "" },

  // Bodyweight
  { name: "Push-Up", muscleGroups: ["chest", "triceps", "core"], equipmentCategories: ["bodyweight"], notes: "" },
  { name: "Pull-Up", muscleGroups: ["back", "biceps"], equipmentCategories: ["bodyweight"], notes: "" },
  { name: "Chin-Up", muscleGroups: ["back", "biceps"], equipmentCategories: ["bodyweight"], notes: "" },
  { name: "Dip", muscleGroups: ["chest", "triceps"], equipmentCategories: ["bodyweight"], notes: "" },
  { name: "Bodyweight Squat", muscleGroups: ["quads", "glutes"], equipmentCategories: ["bodyweight"], notes: "" },
  { name: "Walking Lunge", muscleGroups: ["quads", "glutes"], equipmentCategories: ["bodyweight"], notes: "" },
  { name: "Bodyweight Bulgarian Split Squat", muscleGroups: ["quads", "glutes"], equipmentCategories: ["bodyweight"], notes: "" },
  { name: "Glute Bridge", muscleGroups: ["glutes", "hamstrings"], equipmentCategories: ["bodyweight"], notes: "" },
  { name: "Plank", muscleGroups: ["core"], equipmentCategories: ["bodyweight"], notes: "" },
  { name: "Hanging Leg Raise", muscleGroups: ["core"], equipmentCategories: ["bodyweight"], notes: "" },
  { name: "Inverted Row", muscleGroups: ["back", "biceps"], equipmentCategories: ["bodyweight"], notes: "" },
  { name: "Burpee", muscleGroups: ["full_body", "cardio"], equipmentCategories: ["bodyweight"], notes: "" },

  // Cardio
  { name: "Treadmill Run", muscleGroups: ["cardio"], equipmentCategories: ["cardio"], notes: "" },
  { name: "Stationary Bike", muscleGroups: ["cardio"], equipmentCategories: ["cardio"], notes: "" },
  { name: "Rowing Machine", muscleGroups: ["cardio", "back", "core"], equipmentCategories: ["cardio"], notes: "" },
  { name: "Jump Rope", muscleGroups: ["cardio", "calves"], equipmentCategories: ["cardio"], notes: "" },
  { name: "Stair Climber", muscleGroups: ["cardio", "quads", "glutes"], equipmentCategories: ["cardio"], notes: "" },
  { name: "Elliptical", muscleGroups: ["cardio"], equipmentCategories: ["cardio"], notes: "" },
  { name: "Incline Treadmill Walk", muscleGroups: ["cardio", "glutes"], equipmentCategories: ["cardio"], notes: "" },
  { name: "Assault Bike", muscleGroups: ["cardio", "full_body"], equipmentCategories: ["cardio"], notes: "" },

  // Other (kettlebell, bands, sleds, etc.)
  { name: "Kettlebell Swing", muscleGroups: ["glutes", "hamstrings", "core"], equipmentCategories: ["other"], notes: "" },
  { name: "Kettlebell Goblet Squat", muscleGroups: ["quads", "glutes"], equipmentCategories: ["other"], notes: "" },
  { name: "Resistance Band Pull-Apart", muscleGroups: ["shoulders", "back"], equipmentCategories: ["other"], notes: "" },
  { name: "TRX Row", muscleGroups: ["back", "biceps"], equipmentCategories: ["other"], notes: "" },
  { name: "Farmer's Carry", muscleGroups: ["forearms", "core", "full_body"], equipmentCategories: ["other"], notes: "" },
  { name: "Sled Push", muscleGroups: ["quads", "glutes", "full_body"], equipmentCategories: ["other"], notes: "" },
  { name: "Battle Ropes", muscleGroups: ["shoulders", "core", "cardio"], equipmentCategories: ["other"], notes: "" },
  { name: "Medicine Ball Slam", muscleGroups: ["core", "full_body"], equipmentCategories: ["other"], notes: "" },
];
