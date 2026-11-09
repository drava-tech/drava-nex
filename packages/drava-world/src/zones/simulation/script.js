// Everything TRAVIS says in Zone 04, the Simulation Zone, and the words of its one touch point:
// the Lab, a replica of White Tusker's Assembly Trainer (vision AI that watches a
// build on the bench through a camera and guides it step by step).
// Edit the words here; the logic is in SimulationZone.js, Workbench.js and trainer/.

export const LINES = {
  arrival: [
    'This is Zone 4, the Simulation Zone. On the bench is our Lab.',
    'A camera watches the bench, and our vision AI checks every step of the build as you go.',
  ],
  back: 'Back in Zone 4, the Simulation Zone.',
  at: 'Build the shaft assembly, one step at a time. Click the bench to start.',
  using: 'Tap the screen to begin, then drag each part from the tray onto the mat. The camera checks every step.',
  started: 'Step one. Place the shaft on the mat.',
  noChassis: 'Start with the first shaft. Everything else goes on it.',
  mismatch: 'The camera caught that. That part comes later. Click it to take it off.',
  done: ({ time, accuracy }) => `Built in ${time} seconds, with ${accuracy} percent accuracy. That is vision AI, training hands on the job.`,
  allDone: 'When you are ready, the arrow at the bottom takes you on to Zone 5, the Orca Zone.',
};

export const OBJECTIVES = [
  { id: 'assembly', text: 'Build the shaft assembly at the Lab' },
];

export const CARDS = {
  assembly: {
    id: 'assembly', kicker: 'Stop · Lab', title: 'The Lab',
    body: 'A camera over the bench and a vision AI that knows every part. The screen shows each step and its 3D model; the AI confirms each part as it goes on, flags one that goes on out of order, and times the build.',
    client: 'Factories, service centres and training academies that teach hands-on assembly.',
  },
};

// The bench: hover labels and the button (bottom right).
export const BENCH = {
  use: 'Use the simulator',
  back: 'Back to the room',
  screen: 'Lab',
  verb: 'Use',
  take: 'Drag onto the mat',
  remove: 'Drag off the mat',
  turn: 'Turn the assembly',
  hint: 'Drag each part from the tray onto the mat. Click the assembly to turn it; drag a part off the mat to take it off.',
};

// The Assembly Trainer itself (the page on the screen, /assembly/). The steps and their words
// are those of the real trainer (its /api/status); `seen` is the parts of the build.
export const TRAINER = {
  product: 'Shaft Assembly',
  title: 'Assembly Trainer',
  home: { title: 'Lab', subtitle: 'Master Assembly Skills Through Interactive Training', hint: 'Tap anywhere to begin' },
  noModel: 'No 3D model uploaded yet for this step.',
  guide: 'Video Guide',
  stuck: 'Still stuck - watch the step',
  stepDone: 'Moving forward to next step',
  complete: { title: 'Steps Completed', sub: 'Great job! You have successfully completed the steps', again: 'Start again' },
  // The report on the completed screen (and the file it can be saved as). url: where to POST it as JSON
  // when a build is finished ('' for nowhere).
  report: {
    url: '',
    csv: 'Download CSV',
    columns: { step: 'Step', time: 'Time', mistakes: 'Mistakes' },
    ahead: 'built ahead',
    summary: (clean, total, mistakes) => `${clean} of ${total} steps clean, ${mistakes} ${mistakes === 1 ? 'mistake' : 'mistakes'}`,
  },
  states: [
    { step: 1, label: 'Shaft', model: 'assembly/models/1.glb', requires: ['shaft1'],
      instructions: 'Place the Shaft on the mat so the camera can see it.' },
    { step: 2, label: 'Second Shaft', model: 'assembly/models/2.glb', requires: ['shaft1', 'shaft2'],
      instructions: 'Place another Shaft on the mat.' },
    { step: 3, label: 'Bolt', model: 'assembly/models/3.glb', requires: ['shaft1', 'shaft2', 'bolt'],
      instructions: 'Secure the two Shafts with the Bolt.' },
    { step: 4, label: 'Screw', model: 'assembly/models/4.glb', requires: ['shaft1', 'shaft2', 'bolt', 'screw'],
      instructions: 'Secure the Bolt with the Screw.' },
  ],
  tagLabels: {
    shaft1: 'first shaft', shaft2: 'second shaft', bolt: 'bolt', screw: 'screw',
  },
  // What the AI says (the amber banner) when it sees something it shouldn't yet.
  messages: {
    noCamera: 'camera doesn\'t look aimed at the build area',
    early: (part, step) => `The ${part} is on too early. Take it off and finish "${step}" first.`,
  },
};
