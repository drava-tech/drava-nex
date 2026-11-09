// A screen's display page, /cms/display.html?screen=<id>: the replica of the real Nex's
// /display/<screenId>. Full-screen, shows whatever the Nex assigns to that screen (a live
// whiteboard stroke by stroke), and tells the Nex it's online. Open it on a TV or in
// another tab next to the virtual centre.

import '@fontsource/geist-sans/300.css';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/700.css';
import { loadState, openChannel, resolveContent } from '../shared/state.js';
import { setBoard, syncBoards } from '../shared/render.js';
import { Mirror } from './ui.js';

const screenId = new URLSearchParams(location.search).get('screen') || 'vec-centre';
const mirror = new Mirror(document.getElementById('screen'), { sound: true });
let state = loadState();

function show() {
  syncBoards(state);
  mirror.show(resolveContent(state, state.screens.find((s) => s.id === screenId) ?? { id: screenId, content: null }));
  // The room's master volume (Environment → Audio) applies here too.
  const a = state.environment?.audio;
  if (mirror.video && a) { mirror.video.volume = a.volume / 100; if (!a.power || a.muted) mirror.video.muted = true; }
}

const channel = openChannel((msg) => {
  if (msg?.type === 'state') { state = msg.state; show(); }
  if (msg?.type === 'video' && msg.screenId === screenId) mirror.command(msg.action);
  if (msg?.type === 'board') setBoard(msg.screenId, msg.page);
});

show();
channel.post({ type: 'hello', ids: [screenId] });
const beat = () => channel.post({ type: 'online', ids: [screenId] });
beat();
setInterval(beat, 2000);

// Browsers only allow sound after a click: the first click anywhere unmutes a video that wants sound.
addEventListener('pointerdown', () => show(), { once: true });
