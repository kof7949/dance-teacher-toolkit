// Seeds default styles + skill checklist ONCE, the very first time the app runs on a device
// (i.e. only when the styles store is completely empty). After that, all edits — adding
// styles, adding/removing/reorganizing skills — go through the app itself, and are never
// overwritten by a future update. This intentionally does NOT re-seed on every code change,
// so real progress data recorded by the user is never wiped out.
const DEFAULT_STYLES = [
  { id: 'locking', label: 'Locking', emoji: '🔒' },
  { id: 'house', label: 'House', emoji: '🏠' },
];

const DEFAULT_SKILLS = [
  { style: 'locking', category: 'Foundations', skills: [
    'The Lock (freeze)', 'Pacing', 'Points', 'Wrist rolls', 'Scooby Doo', 'G.y.s.a. Five',
    'Lock Lock', 'Up Lock (Muscle Man)', 'Seek', 'Mega Wrist roll n Lock',
  ] },
  { style: 'locking', category: 'Vocabulary', skills: [
    'Scoobot', 'Skeeter Rabbit', 'Which-a-way', 'Scooby Walk', 'Locking Hand Shake', 'Stop and go',
    'Leo walk', 'Funky Guitar', 'Killing Roaches', 'Uncle Sam', 'Pimp walk', 'The Robot',
    'Camel Walk', 'Hitch Hike', 'Funky Chicken', 'Funky Broadway (Crab Walk+Lock)',
    'Water Gate (Set up + Up Lock)', 'Scooby Hop',
  ] },
  { style: 'locking', category: 'Power Moves', skills: ['Alpha', 'Half Split', 'Knee Drop'] },
  { style: 'locking', category: 'Musicality & Performance', skills: [
    'Hitting the pauses/breaks', 'Comedic character', 'Battle presence & energy', 'Soul Dance flavor',
  ] },
  { style: 'house', category: 'Foundations', skills: ['Basic Walking', 'Jacking', 'Basic footwork'] },
  { style: 'house', category: 'Vocabulary & Moves', skills: [
    'Chase', 'Pas de Bourée', 'Sidewalk', 'Roger Rabbit', 'Farmer', 'Jack Jumps', 'Spins & turns',
    'Criss Cross', 'Crossovers', 'Jack in the Box', 'Running man', 'Salsa Step', 'Stomp', 'Shuffle',
    'Snake', 'Set Up', 'Heel Toe', 'Heel Toe Hop', 'Train', 'Lotus', 'Gallop', 'Gallop Shuffle',
    'Gallop Shuffle Cross', 'Can Opener', 'Player', 'Scissors', 'Salsa Hop', 'Swirl', 'Crosswalk',
    'Lofty', 'Dolphin', 'The Skate', 'Spiderman Style', 'Tip Tap Toe', 'Diamond', 'Triangle',
    'Loose Legs', 'African Step', 'Pow Wow', 'Peter Paul', 'Crossroads', 'Jogs', 'Reverse Jogs',
    'Pivoting Pas de Bourée', 'Spongebob', 'Scribble Feet',
  ] },
  { style: 'house', category: 'Musicality & Flow', skills: [
    'Groove & flow to the beat', 'Level changes / floorwork', 'Freestyle / improvisation',
  ] },
];

const DEFAULT_CATEGORY_ORDER = [
  { id: 'locking', order: ['Foundations', 'Vocabulary', 'Power Moves', 'Musicality & Performance'] },
  { id: 'house', order: ['Foundations', 'Vocabulary & Moves', 'Musicality & Flow'] },
];

async function ensureSeedData() {
  const existingStyles = await DB.getAll('styles');
  if (existingStyles.length > 0) return;

  let styleOrder = 0;
  for (const s of DEFAULT_STYLES) {
    await DB.put('styles', { id: s.id, label: s.label, emoji: s.emoji, order: styleOrder++ });
  }

  let order = 0;
  for (const group of DEFAULT_SKILLS) {
    for (const name of group.skills) {
      await DB.put('skills', { id: DB.uid(), name, category: group.category, style: group.style, order: order++ });
    }
  }

  for (const c of DEFAULT_CATEGORY_ORDER) {
    await DB.put('categoryOrder', c);
  }
}

window.ensureSeedData = ensureSeedData;
