// Everything TRAVIS says in the Welcome Zone, and the info cards for each exhibit.
// Edit the words here; the zone logic lives in WelcomeZone.js.

import { MEDIA_BASE } from '../../config.js';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export const LINES = {
  arrival: () => `${greeting()}. I am TRAVIS, White Tusker's own trained AI, and I will be your host today.`,
  arrivalHint: 'When you are ready, press Step inside. I will show you around.',
  idleHint: 'Press Step inside, or Enter, and I will show you around.',
  lookHint: 'Drag to look around  ·  Click a glowing ring, or press ← →, to move between stops',
  lookHintTouch: 'Drag to look around  ·  Tap a glowing ring or a stop below to move',
  // The flythrough when the visitor steps inside: one line per shot, in order
  // (the shots are TOUR in WelcomeZone.js). Each shot waits for its line to finish.
  tour: [
    'Welcome to the Experience Centre. This is Zone 1.',
    'First, the Holobox. Our CEO is waiting there.',
    'Our brand wall, for the work we are proud of.',
    'And our Mosaic, running live on the wall.',
    'Take your time, and follow the light.',
  ],
  brandWall: 'This is our brand wall. Press Play to watch our brand film.',
  brandFilmEnd: 'On the wall to your right, the Mosaic wall is next.',
  dataArt: [
    'This is our Mosaic, running live. It turns real data, like the weather, office attendance and flights overhead, into moving art.',
    'Click the wall to step up and use it. It works exactly as it does in your browser.',
    'When you are ready, the arrow at the bottom takes you on to Zone 2.',
  ],
  studioIn: 'It is all yours. Press Back to the room when you are done.',
  studioOut: 'When you are ready, the arrow at the bottom takes you on to Zone 2.',
  holoHint: 'This is the Holobox. Click it, and our CEO will join you.',
  ceoIntro: 'One moment. Our CEO would like to welcome you personally.',
  afterCeo: [
    'You will not just watch. You will take control, touch, build, and speak.',
    'Shall we begin? Follow the light to our brand wall.',
  ],
  welcomeBack: (from) => `Welcome back to Zone 1. ${from ? `That was ${from.name.replace(/^The /, 'the ')}. ` : ''}Take another look around, or use the arrows at the bottom to go on again.`,
  bridgeOnline: 'I am connected to the physical centre.',
};

// The CEO's welcome, spoken by the hologram in the Holobox.
// PLACEHOLDER: replace the caption name and the message with the CEO's own words.
export const CEO = {
  caption: 'CEO · White Tusker',
  message: [
    'Hello, and welcome to the White Tusker Experience Centre.',
    'We are architects of experiences. We design, build and run spaces where technology and storytelling meet.',
    'Everything you will see today is our own work, and every zone is something we can bring to your space.',
    'Enjoy the journey. TRAVIS will take it from here.',
  ],
};

// What plays on the brand wall (files in the R2 bucket, see MEDIA_BASE in config.js).
// idle: the still shown until the visitor plays the film. film: plays with sound, then
// the wall returns to the idle image. The slides run only until the idle image loads.
export const BRAND_REEL = {
  idle: `${MEDIA_BASE}/Untitled.png`,
  // Untitled.png holds two versions of the logo (colour above, grey below): show only the colour one.
  idleCrop: [0, 0, 1, 0.5],
  idleScale: 0.6,                 // logo size on the wall: 1 = as wide as the wall
  film: `${MEDIA_BASE}/brandfilm.mp4`,
  play: 'Play the brand film',
  stop: 'Stop the film',
  slides: [
    { kicker: 'White Tusker', title: 'Architects of Experiences' },
    { kicker: 'What we do', title: 'Experience centres', body: 'Spaces that tell a brand’s story, end to end.' },
    { kicker: 'What we do', title: 'Immersive technology', body: 'Screens, sensors and AI that respond to people.' },
    { kicker: 'What we do', title: 'Spatial storytelling', body: 'Stories you walk through, not just watch.' },
    { kicker: 'What we do', title: 'Corporate films', body: 'Stories on screen, made to be remembered.' },
    { kicker: 'White Tusker', title: 'We design experiences that move people.' },
  ],
};

// The Mosaic, live on the Mosaic wall. It runs in a real browser frame, so
// everything works as it does at this address. `viewport` is the page's window size
// in CSS pixels; the screen on the wall keeps the same 16:9 shape.
export const DATA_ART_STUDIO = {
  url: import.meta.env.VITE_DATA_ART_STUDIO_URL || 'https://data-art-studio.vercel.app/',
  viewport: [1920, 1080],
  label: 'Mosaic',
  use: 'Use the studio',
  back: 'Back to the room',
};

export const OBJECTIVES = [
  { id: 'enter', text: 'Step inside' },
  { id: 'holobox', text: 'Meet our CEO in the Holobox' },
  { id: 'brandwall', text: 'Watch our brand wall' },
  { id: 'dataart', text: 'Stop at the Mosaic wall' },
  { id: 'next', text: 'Continue to Zone 02' },
];

export const CARDS = {
  dataart: {
    id: 'dataart',
    kicker: 'Exhibit · Mosaic',
    title: 'Live data, rendered as art',
    body: 'White Tusker’s Mosaic, running live on an LED wall. Choose a data source (live weather, office attendance, flight traffic) and a style, and the data becomes a moving artwork. Click the wall to step up and use it.',
    client: 'Brand walls that turn a client’s own data (footfall, energy, flights, production) into a living artwork.',
  },
  brandwall: {
    id: 'brandwall',
    kicker: 'Exhibit · Brand wall',
    title: 'Our work, on the wall',
    body: 'An LED wall that rests on the White Tusker mark and plays our brand film on demand. It runs from the same Nex as every other screen in the centre.',
    client: 'Brand and showreel walls for HQs, lobbies and launches, updated as easily as a web page.',
  },
  holobox: {
    id: 'holobox',
    kicker: 'Exhibit · Holobox',
    title: 'A leader, in person',
    body: 'A life-size holographic display cabinet. Here our CEO appears in 3D to welcome you. The same cabinet can carry a presenter, an AI host like TRAVIS, or a product, and hand visitors on to the next zone.',
    client: 'AI hosts, virtual product reveals and remote presenters for lobbies, stores and exhibitions.',
  },
};
