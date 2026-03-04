const ROOM_ADJECTIVES = ['swift', 'bright', 'calm', 'deep', 'quick', 'warm', 'bold', 'keen', 'neat', 'vast'];
const ROOM_NOUNS = ['note', 'page', 'doc', 'draft', 'memo', 'plan', 'idea', 'mark', 'text', 'code'];
const USER_NAMES = [
  'Alice', 'Bob', 'Charlie', 'Dana', 'Eve', 'Frank', 'Grace', 'Hank', 'Iris', 'Jack',
  'Kim', 'Leo', 'Maya', 'Nate', 'Olivia', 'Pete', 'Quinn', 'Ruby', 'Sam', 'Tara',
];
const USER_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b',
  '#6366f1', '#10b981', '#f43f5e', '#0ea5e9', '#a855f7',
];

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function generateRoomId() {
  return `${pickRandom(ROOM_ADJECTIVES)}-${pickRandom(ROOM_NOUNS)}-${Math.floor(Math.random() * 999)}`;
}

export function createRandomUser() {
  const color = pickRandom(USER_COLORS);

  return {
    color,
    colorLight: `${color}33`,
    name: pickRandom(USER_NAMES),
  };
}
