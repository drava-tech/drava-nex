// Everything TRAVIS says in Zone 06, the World Zone, and what the room shows.
// Edit the words here; the logic is in ImmersiveZone.js, the room in OceanRoom.js, the ocean in
// Ocean.js and sealife.js. Everything here is buildable as a real room (see CARDS.room).

export const LINES = {
  arrival: [
    'This is Zone 6, the World Zone. Every wall, the ceiling and the floor here are screens. Welcome to the ocean.',
    'The walls are touch screens too. Tap the glass, and point at anything swimming past.',
  ],
  back: 'Back in Zone 6, the World Zone.',
  atRoom: 'The ocean is drawn for where you stand, so it has real depth: move, and the animals near the glass slide past the ones far away. Look up for the whale shark. Tap the walls, and switch the ocean to midnight up top.',
  floor: 'The floor follows you. In the real room, a sensor above watches where people walk.',
  touch: 'The glass answers your hand. The nearest shoals come to see what touched it.',
  discover: (s) => `${s.name}. ${s.fact}`,
  discovered: 'Three animals found. The walls know what swims behind them, so every touch can tell a story.',
  night: 'Midnight. No sun down here, so the sea makes its own light. Touch the glass, or the water at your feet, and the plankton glows.',
  day: 'And back to the sunlit reef.',
  exit: 'The waterfall falls on the way out. Step through it, and you are back where we started.',
  recap: (v) => [
    `Here is your visit. You walked through ${v.zones} of our six zones.`,
    ...(v.found ? [`On these walls, you discovered ${v.found === 1 ? 'one animal' : `${v.found} animals`}.`] : []),
    ...(v.memento ? [`At the memento wall, you reached for the ${v.memento.toLowerCase()}.`] : []),
    ...(v.award ? [`You placed the ${v.award} award on the reader.`] : []),
    ...(v.product ? [`You lifted the ${v.product.toLowerCase()}.`] : []),
    'In the real centre, your wristband carries all of this, so we can send it to you after your visit.',
    'Thank you for visiting White Tusker. The waterfall door takes you back to the Welcome Zone.',
  ],
  allDone: 'That is the World Zone. When you are ready, the door under the waterfall leads back to where we started.',
};

export const OBJECTIVES = [
  { id: 'touch', text: 'Touch the glass' },
  { id: 'discover', text: 'Discover three animals on the walls' },
  { id: 'night', text: 'Switch the ocean to Midnight' },
  { id: 'floor', text: 'Touch the water on the floor' },
  { id: 'recap', text: 'See your visit' },
];

export const DISCOVER_GOAL = 3;

export const CARDS = {
  room: {
    id: 'room', kicker: 'Stop · The ocean room', title: 'A room made of screens',
    body: 'Fine-pitch LED on all four walls and the ceiling, and an LED floor, run by a real-time engine. A tracking camera follows the visitor and the ocean is redrawn for their eyes, so the walls become windows with real depth. LiDAR along the walls reads every touch: the glass ripples, the fish come, and anything you point at gets its story on the wall. The exit wall plays a waterfall that lands on a stone lintel over the door. A sensor above watches the floor.',
    client: 'Brand experiences, launches, museums and sales centres that want visitors inside the story.',
  },
};

// The room's controls (ImmersiveZone builds them over the view while the visitor is at the sweet spot).
export const DOCK = {
  recap: 'Your visit',
  hide: 'Back to the ocean',
  hint: 'Tap the glass · Point at the animals · Look up',
};

// The switch in the top bar: the ocean's mood.
export const MOODS = {
  label: 'Ocean',
  options: [{ id: 'reef', label: 'Sunlit reef' }, { id: 'midnight', label: 'Midnight' }],
};

// What the walls tell about each animal (a panel on the wall beside it). Keys are the ocean's kinds.
export const PANEL_TEXT = {
  kicker: 'Discover',
  stats: { size: 'Size', depth: 'Depth', diet: 'Eats' },
  footer: 'Tap another animal · the panel clears by itself',
};

export const SPECIES = {
  whale: {
    name: 'Whale shark', latin: 'Rhincodon typus', size: 'Up to 18 m', depth: 'Surface to 1,900 m', diet: 'Plankton',
    fact: 'The biggest fish in the sea, and harmless. Its spots are as unique as a fingerprint.',
  },
  reef: {
    name: 'Grey reef shark', latin: 'Carcharhinus amblyrhynchos', size: 'Up to 2.5 m', depth: 'Surface to 280 m', diet: 'Reef fish, squid',
    fact: 'It hunts mostly at night, and arches its back as a warning before it charges.',
  },
  manta: {
    name: 'Reef manta ray', latin: 'Mobula alfredi', size: 'Up to 5 m across', depth: 'Mostly the top 100 m', diet: 'Zooplankton',
    fact: 'It has one of the largest brains of any fish, and visits cleaning stations on the reef.',
  },
  turtle: {
    name: 'Green sea turtle', latin: 'Chelonia mydas', size: 'Shell up to 1.5 m', depth: 'Usually under 40 m', diet: 'Seagrass, algae',
    fact: 'Females swim back to the beach where they hatched to lay their eggs, sometimes thousands of kilometres away.',
  },
  sardines: {
    name: 'Sardines', latin: 'Sardinops sagax', size: 'Up to 30 cm', depth: 'Surface to 200 m', diet: 'Plankton',
    fact: 'A shoal of millions moves as one. Pressed by hunters, it pulls into a tight bait ball.',
  },
  fusiliers: {
    name: 'Fusiliers', latin: 'Caesio', size: 'Up to 40 cm', depth: 'Reefs to 60 m', diet: 'Zooplankton',
    fact: 'Fast blue and yellow schools that feed in open water by day and shelter in the reef at night.',
  },
  anthias: {
    name: 'Sea goldies', latin: 'Pseudanthias squamipinnis', size: 'Up to 15 cm', depth: 'Reefs to 55 m', diet: 'Zooplankton',
    fact: 'They live in harems. If the male dies, the largest female changes sex and takes his place.',
  },
  jacks: {
    name: 'Bigeye trevally', latin: 'Caranx sexfasciatus', size: 'Up to 1.2 m', depth: 'Surface to 140 m', diet: 'Fish, crustaceans',
    fact: 'By day they circle in slow silver tornadoes of hundreds. At night they split up to hunt.',
  },
  jelly: {
    name: 'Moon jellyfish', latin: 'Aurelia aurita', size: 'Bell up to 40 cm', depth: 'Surface waters', diet: 'Plankton',
    fact: 'No brain, no heart, no bones, and almost all water. The four rings in its bell are its gonads.',
  },
};

// The recap the left wall shows (the finale): where you went, and what you chose.
export const RECAP = {
  kicker: 'Your visit',
  title: 'Thank you for visiting',
  found: (n) => `${n} ${n === 1 ? 'animal' : 'animals'} discovered`,
  zonesTitle: 'Zones you walked through',
  choicesTitle: 'What you chose',
  none: 'Nothing chosen yet: try the Orca Zone.',
  memento: 'Reached for',
  award: 'Placed on the reader',
  product: 'Lifted',
  footer: 'In the real centre, your wristband carries your visit, and we send it to you afterwards.',
};
