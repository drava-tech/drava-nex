// What TRAVIS says on the First floor, and its card. A room off the loop that belongs to Zone 02
// (SIDE_ZONES in config.js): not on the floor map, reached from the kiosk's live view ("Go there"),
// a button back to Zone 02. Its one screen (LAYOUTS.floor1 in src/zones/shared/ScreensZone.js) is
// run from the kiosk there, on either side of its switch (the Nex and the Grid).

export const LINES = {
  arrival: [
    'This is the first floor. Its screen is run from the kiosk in Zone 2, like every screen in the building.',
    'Push something to it from our Nex or the Grid, and it shows here. The button at the bottom right takes you back to Zone 2.',
  ],
  back: 'Back on the first floor.',
  pushed: 'This is the first floor screen you just pushed to, from the kiosk in Zone 2. One push, any floor.',
};

// The button back after the live view's "Go there" brought the visitor here.
export const BACK = 'Back to the kiosk';

export const CARD = {
  id: 'floor1-screen',
  kicker: 'Exhibit · First floor',
  title: 'Run from Zone 02',
  body: 'The first floor screen is a screen in both our Nex and the Grid, at the kiosk in Zone 2. Pick the first floor on either, push or throw something at it, and it lands here in milliseconds.',
  client: 'One Nex for every screen in a building: each floor listed on its own, every screen reachable from any kiosk.',
};
