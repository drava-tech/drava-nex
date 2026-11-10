// Everything TRAVIS says in Zone 05, the Orca Zone, and what each exhibit shows.
// Edit the words here; the logic is in ObjectsZone.js and the exhibit files next to it.
// SAMPLE: the shoe details and the table's content are placeholders. The shoes are the client's
// concept colourways (the model's credits: Materials Variants Shoe, © 2021 Shopify, CC BY 4.0),
// not real retail products.

export const LINES = {
  arrival: [
    'This is Zone 5, the Orca Zone. Here, the room knows which object you reach for, lift, tag or place.',
    'On the left, one product wall that recognises a shoe three ways. On the right, a tangible table.',
  ],
  back: 'Back in Zone 5, the Orca Zone.',
  at: {
    products: 'One wall, three ways to recognise a shoe. Pick one with the switch at the top: pressure, LiDAR or RFID. Then choose a shoe.',
    table: 'This is our tangible table. Click it to look from above, then place the discs on it.',
  },
  // The first time each method recognises a shoe.
  done: {
    pressure: (s) => `You lifted the ${s.colour.toLowerCase()} one. Its shelf is a pressure pad: it felt the shoe go, and the kiosk opened it.`,
    lidar: (s) => `No tag, no touch. The LiDAR sensor saw your hand reach for the ${s.colour.toLowerCase()} one.`,
    rfid: (s) => `The ${s.colour.toLowerCase()} one is on the reader. Its tag says exactly which shoe it is.`,
  },
  // The first time the switch turns to each method.
  method: {
    pressure: 'Pressure. Every shelf is a pad that feels its shoe. Lift one off.',
    lidar: 'LiDAR. A sensor above the niches watches the air in front of them. Reach toward a shoe and hold.',
    rfid: 'RFID. Every shoe carries a tag. Place one on the reader in front of the wall.',
  },
  chosen: (s) => `There it is: the ${s.colour.toLowerCase()} one, lifted out for you. The kiosk and the wall work as one.`,
  kioskIn: 'Choose a colourway. The wall will show it to you.',
  tableIn: 'Drag a disc from the side onto the table. Each one opens its own window.',
  tablePlace: (d) => `${d.name}. The table recognised the disc and opened its content right beside it, and on the screen above. Turn the disc, and its window turns with it. Then try the zoom disc.`,
  tableZoom: 'Turn it one way to zoom in, the other way to zoom out. The table reads the angle of the disc.',
  allDone: 'That is Orca: pressure, LiDAR, RFID and a tangible table. When you are ready, Zone 6 is next.',
  // The way on (this room has no doors): the arrow in the bar at the bottom.
  onward: (next) => `When you are ready, the arrow at the bottom takes you on to Zone ${Number(next.n)}, the ${next.short} Zone.`,
};

// The switch in the top bar at the product wall: how the wall recognises a shoe.
export const METHODS = {
  label: 'Recognise by',
  options: [
    { id: 'pressure', label: 'Pressure' },
    { id: 'lidar', label: 'LiDAR' },
    { id: 'rfid', label: 'RFID' },
  ],
  verb: { pressure: 'Lift', lidar: 'Reach for', rfid: 'Place on the reader' },
  reader: 'RFID READER',
};

export const OBJECTIVES = [
  { id: 'pressure', text: 'Lift a shoe off its pressure pad' },
  { id: 'lidar', text: 'Reach for a shoe: LiDAR, no touch' },
  { id: 'rfid', text: 'Place a shoe on the RFID reader' },
  { id: 'kiosk', text: 'Choose a colourway on the kiosk' },
  { id: 'table', text: 'Place a disc on the tangible table' },
  { id: 'next', text: 'Continue to Zone 06 · World' },
];

export const CARDS = {
  products: {
    id: 'products', kicker: 'Exhibit · Orca', title: 'One wall, three sensors',
    body: 'Six colourways in six lit niches and a kiosk beside them. The switch at the top picks how the wall knows which shoe you mean: a pressure pad under each shoe (lift it), a LiDAR sensor watching the air in front of the niches (reach toward it, no touch), or an RFID tag in each shoe (place it on the reader). The kiosk opens the shoe it recognised.',
    client: 'Flagship stores, launches and showrooms where the product starts the conversation.',
  },
  table: {
    id: 'table', kicker: 'Exhibit · Tangible table', title: 'The tangible table',
    body: 'A touch table that recognises the discs placed on it, where they are and which way they are turned. Each disc opens its own content beside it, and the content turns as you turn the disc; the zoom disc zooms as you turn it. The screen above shows what is open.',
    client: 'Sales centres, master plans and product configurators that several people explore together.',
  },
};

// The product wall, in the model's order (top row, then bottom). colour: the colourway's name;
// hex / swoosh: its colours on the kiosk.
export const SHOES = {
  brand: 'NIKE',
  title: 'Find your next move.',
  sub: 'Choose a colourway. Explore the details.',
  explorer: 'PRODUCT EXPLORER',
  start: 'SELECT A SHOE TO BEGIN',
  footer: 'WHITE TUSKER',
  back: 'All colourways',
  putBack: 'Put it back',
  sizes: ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11'],
  // How the kiosk knew which shoe: by the method on the switch (METHODS), or chosen on the kiosk.
  how: {
    pressure: (n) => `Pressure pad · lifted from niche ${n}`,
    lidar: (n) => `LiDAR · reached for niche ${n} · no touch`,
    rfid: (n) => `RFID · tag 04:5A:2${n.slice(-1)} read`,
    chosen: (n) => `Chosen on the kiosk · niche ${n}`,
  },
  concept: 'Concept colourway · display study',
  items: [
    { colour: 'White', hex: '#D8DCDC', swoosh: '#22303A', features: ['Breathable knit upper', 'Soft foam midsole', 'Everyday trainer'] },
    { colour: 'Midnight', hex: '#253240', swoosh: '#F4F2EA', features: ['Tonal knit upper', 'Responsive foam', 'City to studio'] },
    { colour: 'Red', hex: '#C2392E', swoosh: '#F4F2EA', features: ['Bold knit upper', 'Grippy rubber outsole', 'Built for speed'] },
    { colour: 'Blue', hex: '#245F9A', swoosh: '#F4F2EA', features: ['Lightweight upper', 'Cushioned heel', 'Long-run comfort'] },
    { colour: 'Olive', hex: '#7A8670', swoosh: '#F4F2EA', features: ['Earth-tone knit', 'Trail-ready outsole', 'All-day wear'] },
    { colour: 'Sand', hex: '#C2A57C', swoosh: '#22303A', features: ['Warm neutral knit', 'Plush foam midsole', 'Easy everyday style'] },
  ],
};
export const shoeName = (s) => `Concept runner · ${s.colour}`;

// The tangible table. One disc zooms; the others open their own window. Four at most.
// pins: points on the content's map, x and y from -1 to 1.
export const TABLE = {
  back: 'Back to the room',
  hint: 'Drag a disc onto the table  ·  Drag a disc\'s outer ring (or scroll over it) to turn it',
  idle: 'Place a disc on the table',
  discs: [
    { id: 'zoom', name: 'Zoom', kind: 'zoom', color: '#FBFAF5' },
    { id: 'projects', name: 'Projects', kind: 'content', color: '#F2B544',
      card: { title: 'Our projects', body: 'Experience centres we have designed and built.', pins: [[-0.6, -0.45, 'Aerospace campus'], [0.6, -0.45, 'Energy pavilion'], [-0.6, 0.45, 'Heritage gallery'], [0.6, 0.45, 'Retail flagship']] } },
    { id: 'services', name: 'Services', kind: 'content', color: '#9FB8D6',
      card: { title: 'What we do', body: 'From the first sketch to running the space.', pins: [[-0.5, -0.4, 'Architecture'], [0.5, -0.4, 'Immersive tech'], [-0.5, 0.4, 'Storytelling'], [0.5, 0.4, 'Corporate films']] } },
    { id: 'tech', name: 'Technology', kind: 'content', color: '#E8A06A',
      card: { title: 'Our technology', body: 'The systems behind every zone.', pins: [[0, -0.5, 'TRAVIS'], [-0.6, 0.2, 'Nex'], [0.6, 0.2, 'Core'], [0, 0.55, 'Sensors']] } },
  ],
};

// The 85" screen above the table: what the discs on the glass have opened.
export const TABLE_SCREEN = {
  kicker: 'TANGIBLE TABLE',
  idle: { title: ['Every object', 'opens a story.'], sub: 'Place a disc on the table.' },
  open: 'OPEN ON THE TABLE',
  zoom: (z) => `ZOOM ${z.toFixed(2)}×`,
};
