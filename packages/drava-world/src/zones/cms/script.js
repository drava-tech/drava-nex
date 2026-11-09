// Everything TRAVIS says in Zone 02, the Nex Zone, and its switch, objectives and info cards.
// Edit the words here; the zone logic lives in CmsZone.js. The Nex itself (the kiosk's pages)
// is in app/, the Grid in push/, and their screens and media in shared/seed.js.

export const LINES = {
  arrival: [
    'This is Zone 2, the Nex Zone. One kiosk, three screens on the wall in front of you, and the room itself, all run from that kiosk.',
    'Step up to it and take control. The switch at the top turns it from our Nex to the Grid.',
  ],
  back: 'Back in Zone 2, the Nex Zone. The kiosk is still yours.',
  kioskIn: {
    cms: 'This is our Nex, the one that runs every screen in the centre. Assign something to a screen, or drag it onto one in Broadcast, and watch the walls. Pick the first or second floor, and it reaches the screens on those floors too.',
    canvas: 'This is the Grid. Drag something from the library onto the canvas, then throw it toward a screen. The floors along the top put another floor’s screen on the edges.',
  },
  // The first time the switch turns the kiosk to each.
  switched: {
    cms: 'Back to our Nex. The three screens show what it assigns again.',
    canvas: 'Now the same kiosk and the same three screens run the Grid. Throw something onto a screen.',
  },
  firstAssign: 'Live on the screen already. That is the same push our Nex makes to every screen in a centre.',
  publishAll: 'All three screens, in one move.',
  upload: 'Your file is in the library now. Push it to a screen.',
  lights: 'The lights in this room answer the Nex too. Dim them or colour them, and the whole room follows, from the same Environment page that runs our real centre.',
  whiteboard: 'Every stroke, live on the screen. Draw on the kiosk, and the room sees it as you go.',
  welcome: 'The Welcome Trigger saw you come in, and the centre screen greeted you.',
  lock: 'That is the glass door you came in by. The Nex unlocks it, and it locks itself again after five seconds.',
  climate: 'The air conditioning answers the Nex too. Watch the display, and the room starts to follow.',
  audio: 'Your video has its sound now. Choose the screen it plays from, and the volume, in the bar along the foot of the Nex.',
  kioskOut: 'When you are ready, the arrow at the bottom takes you on to Zone 3.',
  canvasCard: 'On the canvas. Now throw it toward a screen on the left, the right or the top.',
  canvasPush: 'Thrown, and on the screen. Anyone at the canvas can do the same, together, on the same screens.',
  backKiosk: 'Back at the kiosk, right where you left it. Push to any floor again.',
  remote: 'That went to another floor entirely. There it is, live, from right here. Go there whenever you like.',
};

// The switch in the top bar: what the one kiosk and its three screens run.
export const MODES = {
  label: 'What the kiosk runs',
  options: [
    { id: 'cms', label: 'Nex' },
    { id: 'canvas', label: 'Grid' },
  ],
  verb: { cms: 'Use the Nex', canvas: 'Use the Grid' },
};

// The live view: a screen on another floor, shown from the kiosk after a push to it (LiveView.js).
export const LIVE = { live: 'Live', go: 'Go there', close: 'Close live view' };

export const OBJECTIVES = [
  { id: 'kiosk', text: 'Step up to the kiosk' },
  { id: 'assign', text: 'Put something on a screen from the Nex' },
  { id: 'all', text: 'Publish to all three screens' },
  { id: 'canvas', text: 'Switch to the Grid' },
  { id: 'canvasPush', text: 'Throw something onto a screen' },
  { id: 'remote', text: 'Push to a screen on another floor' },
  { id: 'next', text: 'Continue to Zone 03 · SaaS' },
];

export const CARDS = {
  cms: {
    id: 'cms',
    kicker: 'Exhibit · Nex',
    title: 'One Nex, every screen',
    body: 'White Tusker’s own Nex, running on the kiosk. Publish experiences and media to any of the three screens, or to the first and second floors (pick the floor, then the screen), queue a set of files, draw on a whiteboard that appears live on a screen, and run the room itself from Environment: its lights, air conditioning, sound and the glass entrance door. Every change goes live around you in milliseconds.',
    client: 'One Nex to run every screen across a centre, a campus or a network of sites, from a kiosk, a tablet or a desk.',
  },
  canvas: {
    id: 'canvas',
    kicker: 'Exhibit · Grid',
    title: 'Throw it onto the wall',
    body: 'The same kiosk and the same three screens, as a shared canvas. Drag media onto it, write on it with the pen, and throw a card toward a screen on the left, the right or the top: it slides onto that screen from the side you threw it. Hold the canvas and throw it, and the whole canvas goes up.',
    client: 'Meeting rooms, briefing centres and launches where a team builds the story together, live on the room’s screens.',
  },
  screens: {
    id: 'screens',
    kicker: 'Exhibit · Three screens',
    title: 'Three screens, one story',
    body: 'Three LED screens across the front wall, left, centre and right, facing the kiosk. Each is its own display, so they can show one thing together or three things at once, from the Nex or from the Grid.',
    client: 'Multi-screen rooms for lobbies, briefing centres and launches, run from one kiosk.',
  },
};
