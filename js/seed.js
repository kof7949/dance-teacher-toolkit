// Seeds the default skill checklist ONCE, the very first time the app runs on a device
// (i.e. only when the skills store is completely empty). After that, all edits — adding,
// removing, or reorganizing skills — go through "Edit skill checklist" in the app itself,
// and are never overwritten by a future update. This intentionally does NOT re-seed on
// every code change, so real progress data recorded by the user is never wiped out.
const STYLE_META = {
  locking: { label: 'Locking', emoji: '🔒' },
  house: { label: 'House', emoji: '🏠' },
};

const DEFAULT_SKILLS = [
  { style: 'locking', category: 'Foundations', skills: ['The Lock (freeze)', 'Points', 'Wrist rolls', 'Scooby Doo'] },
  { style: 'locking', category: 'Vocabulary', skills: ['Skeeter Rabbit', 'Which-a-way', 'Stop and go', 'Leo walk', 'Uncle Sam', 'Pimp walk'] },
  { style: 'locking', category: 'Musicality & Performance', skills: ['Hitting the pauses/breaks', 'Comedic character', 'Battle presence & energy'] },
  { style: 'house', category: 'Foundations', skills: ['Jacking', 'Basic footwork'] },
  { style: 'house', category: 'Vocabulary & Moves', skills: [
    'Running man', 'Crossovers', 'Spins & turns',
    'Jack in the Box', 'Criss Cross', 'Jack Jumps', 'Stomp', 'Shuffle', 'Pas de Bourée', 'Sidewalk',
    'Salsa Step', 'Snake', 'Roger Rabbit', 'Set Up', 'Farmer', 'Gallop', 'Gallop Shuffle',
    'Gallop Shuffle Cross', 'Heel Toe', 'Heel Toe Hop', 'Can Opener', 'Player', 'Train', 'Scissors',
    'Lotus', 'Salsa Hop', 'Swirl', 'Chase', 'Loose Legs', 'African Step', 'Triangle', 'Diamond',
    'Crosswalk', 'Crossroads', 'Peter Paul', 'Pow Wow', 'Jogs', 'Reverse Jogs', 'Pivoting Pas de Bourée',
    'Spongebob', 'Scribble Feet', 'Lofty', 'Dolphin', 'Spiderman Style', 'Tip Tap Toe', 'The Skate',
  ] },
  { style: 'house', category: 'Musicality & Flow', skills: ['Groove & flow to the beat', 'Level changes / floorwork', 'Freestyle / improvisation'] },
];

async function ensureSeedData() {
  const existing = await DB.getAll('skills');
  if (existing.length > 0) return;

  let order = 0;
  for (const group of DEFAULT_SKILLS) {
    for (const name of group.skills) {
      await DB.put('skills', { id: DB.uid(), name, category: group.category, style: group.style, order: order++ });
    }
  }
}

window.STYLE_META = STYLE_META;
window.ensureSeedData = ensureSeedData;
