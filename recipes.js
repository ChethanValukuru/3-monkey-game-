// Game content: ingredients that can sit on the shelf, and the recipes.
//
// Every recipe is an ordered list of steps. Step types:
//   add   -> dump a specific ingredient (by id) into the pot. This is the HARD
//            kind: the Blind cook can only grab jars by POSITION, and only the
//            Mute cook can see which position holds which ingredient. So the
//            position has to be relayed Mute -> Deaf -> Blind.
//   heat  -> set the stove to a target level (off/low/med/high).
//   stir  -> stir the pot a number of times.
//   serve -> finish the dish.

export const INGREDIENTS = {
  flour:  { id: 'flour',  label: 'Flour',  emoji: '🌾' },
  egg:    { id: 'egg',    label: 'Egg',    emoji: '🥚' },
  milk:   { id: 'milk',   label: 'Milk',   emoji: '🥛' },
  sugar:  { id: 'sugar',  label: 'Sugar',  emoji: '🍬' },
  butter: { id: 'butter', label: 'Butter', emoji: '🧈' },
  salt:   { id: 'salt',   label: 'Salt',   emoji: '🧂' },
  cocoa:  { id: 'cocoa',  label: 'Cocoa',  emoji: '🍫' },
  banana: { id: 'banana', label: 'Banana', emoji: '🍌' },
  cheese: { id: 'cheese', label: 'Cheese', emoji: '🧀' },
};

export const RECIPES = [
  {
    id: 'pancake',
    name: 'Fluffy Pancakes',
    emoji: '🥞',
    // ingredients that will be placed on the shelf (plus some decoys)
    shelf: ['flour', 'egg', 'milk', 'sugar', 'butter', 'salt'],
    steps: [
      { type: 'add',  ingredient: 'flour' },
      { type: 'add',  ingredient: 'egg' },
      { type: 'add',  ingredient: 'milk' },
      { type: 'add',  ingredient: 'sugar' },
      { type: 'stir', count: 3 },
      { type: 'heat', level: 'med' },
      { type: 'serve' },
    ],
  },
  {
    id: 'brownie',
    name: 'Chocolate Brownie',
    emoji: '🍫',
    shelf: ['flour', 'egg', 'sugar', 'butter', 'cocoa', 'salt', 'milk'],
    steps: [
      { type: 'add',  ingredient: 'butter' },
      { type: 'add',  ingredient: 'cocoa' },
      { type: 'add',  ingredient: 'sugar' },
      { type: 'add',  ingredient: 'egg' },
      { type: 'add',  ingredient: 'flour' },
      { type: 'stir', count: 4 },
      { type: 'heat', level: 'high' },
      { type: 'serve' },
    ],
  },
];

export const HEAT_LEVELS = ['off', 'low', 'med', 'high'];
