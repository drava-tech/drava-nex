// A Push display, /push/display.html: the replica of Push's /display page. Without a screen it
// asks for the pairing code the console shows (Screens → Pair display); with ?screen=<id> (the
// console's "Copy display link", or after pairing) it shows that screen full-window: what is
// pushed slides in from the side it was thrown from, a split screen shows its parts, a shared
// canvas the canvas. It tells the console it's online, and how its video is playing.

import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/600.css';
import '../app/cms.css';
import './push.css';
import { setPushState } from './board.js';

import { Mirror, esc, h, icon } from '../app/ui.js';
import { contentKey } from '../shared/state.js';
import { CODE_CHARS, loadPush, openPushChannel, resolvePush } from './state.js';

const SLIDE_MS = 1500;
const screenId = new URLSearchParams(location.search).get('screen');
const root = document.getElementById('app');
let state = loadPush();
setPushState(state);

const channel = openPushChannel((msg) => {
  if (msg?.type === 'state') { state = msg.state; setPushState(state); show(); }
  if (msg?.type === 'paired') paired?.(msg);
  if (msg?.type === 'video' && msg.screenId === screenId) command(msg.action, msg.value);
});
let paired = null;
let stage = null, front = null, key = null;   // the screen's stage, the layer on show, what it shows

if (screenId) playScreen();
else pairScreen();

/* ---------------------------------------------------------------- pairing */

function pairScreen() {
  root.innerHTML = `<div class="pdp-pair">
    <div class="pdp-brand"><span class="pdp-logo">${icon('Monitor', 'ico')}</span>Push</div>
    <div class="pdp-copy"><h1>Pair this display</h1><p>In the console, open Screens → Pair display, and type the code shown there.</p></div>
    <div class="pdp-code" role="group" aria-label="Pairing code">${Array.from({ length: 6 }, (_, i) => `<input maxlength="1" inputmode="text" autocomplete="off" aria-label="Character ${i + 1}" ${i ? '' : 'autofocus'}>`).join('')}</div>
    <div class="pdp-msg" aria-live="polite"></div></div>`;
  const boxes = [...root.querySelectorAll('.pdp-code input')];
  const msg = root.querySelector('.pdp-msg');
  boxes[0].focus();
  const submit = () => {
    const code = boxes.map((b) => b.value).join('').toUpperCase();
    if (code.length < 6) return;
    msg.innerHTML = `<span class="dim">${icon('LoaderCircle', 'ico sm spin')} Pairing…</span>`;
    boxes.forEach((b) => { b.disabled = true; });
    const fail = (text) => { msg.innerHTML = `<span class="err">${esc(text)}</span>`; boxes.forEach((b) => { b.disabled = false; b.value = ''; }); boxes[0].focus(); };
    const timer = setTimeout(() => fail("Couldn't reach the server. Check the network and try again."), 2500);
    paired = (m) => {
      if (m.code !== code) return;
      clearTimeout(timer);
      paired = null;
      if (m.screenId) location.search = `?screen=${encodeURIComponent(m.screenId)}`;
      else fail('That code is wrong or has expired. Ask for a new one.');
    };
    channel.post({ type: 'pair', code });
  };
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => {
      b.value = [...b.value.toUpperCase()].filter((c) => CODE_CHARS.includes(c)).join('').slice(-1);
      if (b.value && i < 5) boxes[i + 1].focus();
      submit();
    });
    b.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !b.value && i) boxes[i - 1].focus(); });
    b.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = [...(e.clipboardData.getData('text') ?? '').toUpperCase()].filter((c) => CODE_CHARS.includes(c)).slice(0, 6);
      text.forEach((c, j) => { boxes[j].value = c; });
      submit();
    });
  });
}

/* ---------------------------------------------------------------- showing a screen */

function playScreen() {
  root.innerHTML = '<div class="pdp-stage"></div>';
  stage = root.querySelector('.pdp-stage');
  channel.post({ type: 'hello', ids: [screenId], display: true });
  const beat = () => channel.post({ type: 'online', ids: [screenId] });
  beat();
  setInterval(beat, 2000);
  setInterval(reportVideo, 500);
  // Browsers only play sound after a tap: the first one lets a video with sound be heard.
  addEventListener('pointerdown', () => { if (front?.mirror.video) front.mirror.video.muted = !!front.r.muted; }, { once: true });
  show();
}

function show() {
  if (!stage) return;
  const s = state.screens.find((x) => x.id === screenId);
  if (!s) {
    stage.innerHTML = `<div class="pdp-pair"><div class="pdp-copy"><h1>This display was signed out</h1><p>Its screen was unpaired or deleted. Type a new code to pair it again.</p></div>
      <a class="pb lg" href="/drava-world/push/display.html">Pair this display</a></div>`;
    front = null; key = null;
    return;
  }
  const r = resolvePush(state, screenId);
  const k = contentKey(r);
  if (k === key) { if (front?.mirror.video) front.mirror.video.muted = !!r.muted; return; }
  key = k;
  const layer = h('<div class="pdp-layer"></div>');
  const mirror = new Mirror(layer, { sound: true });
  mirror.show(r);
  const old = front;
  front = { el: layer, mirror, r };
  stage.append(layer);
  if (old && r.kind !== 'idle' && r.kind !== 'blank') {
    layer.classList.add(`in-${s.enter ?? 'up'}`);
    old.el.classList.add('out');
    setTimeout(() => { old.mirror.destroy(); old.el.remove(); }, SLIDE_MS);
  } else if (old) { old.mirror.destroy(); old.el.remove(); }
}

function command(action, value) {
  const v = front?.mirror.video;
  if (!v) return;
  if (action === 'play') v.play().catch(() => {});
  if (action === 'pause') v.pause();
  if (action === 'restart') { v.currentTime = 0; v.play().catch(() => {}); }
  if (action === 'seek') v.currentTime = value;
  if (action === 'volume') { v.volume = value; v.muted = value === 0; }
  reportVideo();
}

function reportVideo() {
  const v = front?.mirror.video;
  if (!v) return;
  channel.post({ type: 'video-state', screenId, playing: !v.paused, time: v.currentTime, duration: v.duration || 0, muted: v.muted, volume: v.volume });
}
