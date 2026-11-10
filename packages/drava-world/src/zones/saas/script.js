// Everything TRAVIS says in Zone 03, the SaaS Zone, and what its two screens show.
// Edit the words here; the logic is in SaasZone.js and ShowcaseScreen.js.
import { MEDIA_BASE } from '../../config.js';

export const LINES = {
  arrival: [
    'This is Zone 3, the SaaS Zone. Two of our own products, live on the walls.',
    'Core, our ERP, is on your left. Our Care is on your right. Each one starts with a short film, then it is yours to try.',
  ],
  back: 'Back in Zone 3, the SaaS Zone.',
  live: {
    trava: 'That is Core. It is live on the screen now. Click it, and try it yourself.',
    hms: 'That is our Care. It is live on the screen now. Click it, and try it yourself.',
  },
  soon: 'The live demo opens on this screen soon.',
  using: 'It is all yours. Back to the room, or Escape, when you are done.',
  // Once both products have been tried: the way on (this room has no doors).
  onward: (next) => `When you are ready, the arrow at the bottom takes you on to Zone ${Number(next.n)}, the ${next.short} Zone.`,
};

export const OBJECTIVES = [
  { id: 'trava', text: 'Try Core on the left screen' },
  { id: 'hms', text: 'Try the Care on the right screen' },
];

// The two screens. Each plays `video` first, then runs `url` live (a real web page).
// The films are in the R2 bucket (MEDIA_BASE). No film (or one that won't load) goes straight
// to the site; no url leaves the title card up with `soon` once the film ends.
export const SHOWCASES = {
  trava: {
    kicker: 'SaaS · ERP',
    name: 'Core',
    tagline: 'Projects, tasks and teams, in one place.',
    video: `${MEDIA_BASE}/trava-intro.mp4`,
    url: 'https://tusker-managment.vercel.app/',
    viewport: [1600, 900],
    play: 'Play the film',
    skip: 'Skip the film',
    use: 'Use Core',
    back: 'Back to the room',
  },
  hms: {
    kicker: 'SaaS · Care',
    name: 'Care',
    tagline: 'Our Care, live.',
    video: `${MEDIA_BASE}/hms-intro.mp4`,
    url: 'https://hospital-management-system-mu-pied.vercel.app/',
    soon: 'Live demo coming soon.',
    viewport: [1600, 900],
    play: 'Play the film',
    skip: 'Skip the film',
    use: 'Use the Care',
    back: 'Back to the room',
  },
};

export const CARDS = {
  trava: {
    id: 'trava', kicker: 'Screen · Core', title: 'Core',
    body: 'White Tusker’s own ERP. Watch the film, then click the screen to use the real Core, live, just as our teams do.',
    client: 'Project-led businesses that want projects, tasks and reports in one system.',
  },
  hms: {
    id: 'hms', kicker: 'Screen · Care', title: 'Care',
    body: 'Watch the film, then click the screen to use the Care, live.',
    client: 'To be written.',
  },
};
