// The Assembly Trainer (/assembly/): a replica of White Tusker's trainer page (index.html + app.js
// of the real one), on the screen over the Simulation Zone's bench. The page logic is the real
// app.js, ported as is: the debounces, the three screens, the step-done overlay, the frozen
// stats. What changes: /api/status and /api/reset are answered by backend.js (a stand-in for
// the real web_server + inference loop, fed by the bench's camera), the MJPEG <img> feed is a
// canvas the bench draws into (window.vecFeed), and <model-viewer> is ModelView (viewer.js).
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import './trainer.css';
import { TRAINER } from '../script.js';
import { Backend } from './backend.js';
import { ModelView } from './viewer.js';
import { sessionEvents, SessionReport, downloadCsv, postReport } from './report.js';

const T = TRAINER;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FEED = { w: 848, h: 480 };   // the real camera's frame

document.body.innerHTML = `
  <!-- Home screen -->
  <section id="screen-home" class="screen home">
    <h1 class="home-title">${esc(T.home.title)}</h1>
    <p class="home-subtitle">${esc(T.home.subtitle)}</p>
    <div class="home-preview"><canvas id="home-viewer" class="model-view" aria-label="Assembly animation preview"></canvas></div>
    <p class="home-hint">${esc(T.home.hint)}</p>
  </section>

  <!-- Trainer screen -->
  <section id="screen-trainer" class="screen trainer" hidden>
    <header class="trainer-header">
      <h1>${esc(T.title)}</h1>
      <button id="restart-btn" class="icon-btn-restart" aria-label="Start again">
        <svg viewBox="0 0 24 24"><path d="M20 11A8 8 0 1 0 18.6 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 5v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </header>

    <div class="trainer-top">
      <div class="step-number-tile" id="step-number-tile">1</div>
      <p class="instruction-text" id="instructions"></p>
      <div class="trainer-meta">
        <p class="meta-step" id="step-meta">Step 1 of ${T.states.length}</p>
        <p class="meta-time" id="time-lapsed">Time Lapsed - 00:00</p>
      </div>
    </div>

    <p class="mismatch-alert" id="mismatch-alert"></p>

    <div class="trainer-grid">
      <div class="feed-panel">
        <canvas id="video-feed" width="${FEED.w}" height="${FEED.h}" aria-label="Live camera feed"></canvas>
        <span class="panel-tag">Live Stream</span>

        <div class="step-done-overlay" id="step-done-overlay" hidden>
          <svg class="check-anim" viewBox="0 0 24 24"><path d="M4 12l6 6L20 6" fill="none" stroke="#6d5bd0" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <p class="step-done-text" id="step-done-text">Step is done</p>
          <p class="step-done-sub">${esc(T.stepDone)}</p>
        </div>
      </div>

      <div class="model-panel">
        <canvas id="viewer" class="model-view" aria-label="3D model for the current assembly step"></canvas>
        <p class="viewer-hint" id="viewer-hint" hidden>${esc(T.noModel)}</p>
        <span class="panel-tag">3D model Ref</span>
        <button id="view-reference-btn" class="btn-video-guide">
          ${esc(T.guide)}
          <svg viewBox="0 0 20 20"><path d="M4 10h11M11 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
  </section>

  <!-- Completed screen -->
  <section id="screen-complete" class="screen complete" hidden>
    <div class="complete-card">
      <div class="complete-icon">
        <svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <h1>${esc(T.complete.title)}</h1>
      <p class="complete-sub">${esc(T.complete.sub)}</p>
      <div class="stats-bar">
        <div class="stat">
          <span class="stat-icon">P</span>
          <div><p class="stat-label">Product Name</p><p class="stat-value" id="stat-product">-</p></div>
        </div>
        <div class="stat">
          <span class="stat-icon">
            <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="#fff" stroke-width="1.4"/><circle cx="10" cy="10" r="1.6" fill="#fff"/></svg>
          </span>
          <div><p class="stat-label">Accuracy</p><p class="stat-value" id="stat-accuracy">-</p></div>
        </div>
        <div class="stat">
          <span class="stat-icon">
            <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M10 6v4l3 2" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>
          </span>
          <div><p class="stat-label">Time Taken</p><p class="stat-value" id="stat-time">-</p></div>
        </div>
      </div>
      <p class="report-summary" id="report-summary"></p>
      <table class="report-table">
        <thead><tr><th>#</th><th>${esc(T.report.columns.step)}</th><th>${esc(T.report.columns.time)}</th><th>${esc(T.report.columns.mistakes)}</th></tr></thead>
        <tbody id="report-rows"></tbody>
      </table>
      <div class="complete-actions">
        <button id="download-csv-btn" class="btn btn-light">${esc(T.report.csv)}</button>
        <button id="restart-from-complete-btn" class="btn btn-dark">${esc(T.complete.again)}</button>
      </div>
    </div>
  </section>

  <!-- Hint modal: the real one plays a reference video; there is none yet, so it plays the
       step's own assembly animation. -->
  <div id="hint-modal" class="modal-overlay" hidden>
    <div class="modal">
      <p class="modal-title">${esc(T.stuck)}</p>
      <canvas id="reference-video" class="model-view"></canvas>
    </div>
  </div>`;

const $ = (id) => document.getElementById(id);
const backend = new Backend();

const POLL_MS = 500;
// A step only actually changes on the page once the backend has reported the same next_step
// for this many consecutive polls (the classifier's per-frame confidence is noisy).
const STEP_DEBOUNCE_POLLS = 2;

let started = false; // user clicked "Start Assembly" on the home screen
let currentScreen = null;
let lastModelSrc = null;

const UNSET = Symbol('unset');
let stableNextStep = UNSET;
let pendingStepKey = null;
let pendingStepCount = 0;

let stableMismatch = false;
let pendingMismatch = null;
let pendingMismatchCount = 0;

// Frozen at the moment assembly completes, so Time Taken and Accuracy stop changing.
let completedSnapshot = null;
// Once true, completion is terminal until an explicit restart.
let sessionCompleted = false;

// The session report, fed by three events (report.js): session_start, step_changed(stepIndex) and
// mistake(stepIndex, type). The build is frozen into finalReport when the last step is done.
const session = new SessionReport(T.states, { product: T.product, user: new URLSearchParams(location.search).get('user') });
let finalReport = null;
let currentIdx = null;       // the step the trainer is on (T.states.length: finished), to see it change
sessionEvents.on('session_start', () => { session.reset(); finalReport = null; currentIdx = null; });
sessionEvents.on('step_changed', (idx) => {
  session.stepChanged(idx);
  if (idx >= T.states.length) {
    finalReport = session.build();
    postReport(T.report.url, finalReport);
  }
});
sessionEvents.on('mistake', (idx) => session.mistake(idx));
// A wrong action the bench knows of at once (a part dropped before the first one is on): no debounce.
backend.onMistake = (type) => {
  const idx = currentIdx ?? 0;       // before the first poll after Start, it is still the first step
  if (started && !sessionCompleted && idx < T.states.length) sessionEvents.emit('mistake', idx, type);
};

function snapshotStats(data) {
  return {
    product_name: data.product_name,
    total_frames: data.total_frames,
    mismatch_frames: data.mismatch_frames,
    time_taken_s: data.session_started_at ? Date.now() / 1000 - data.session_started_at : null,
  };
}

function debounceMismatch(raw) {
  if (raw === stableMismatch) {
    pendingMismatch = null;
    pendingMismatchCount = 0;
    return stableMismatch;
  }
  if (raw === pendingMismatch) {
    pendingMismatchCount += 1;
  } else {
    pendingMismatch = raw;
    pendingMismatchCount = 1;
  }
  if (pendingMismatchCount >= STEP_DEBOUNCE_POLLS) {
    stableMismatch = raw;
    pendingMismatch = null;
    pendingMismatchCount = 0;
  }
  return stableMismatch;
}

function stepKeyOf(nextStep) {
  return nextStep ? String(nextStep.step) : '__complete__';
}

// { value, justChanged }: value is the debounced next_step (null: assembly complete),
// justChanged is true only on the poll where a new value was just committed.
function debounceNextStep(rawNextStep) {
  const key = stepKeyOf(rawNextStep);
  const stableKey = stableNextStep === UNSET ? null : stepKeyOf(stableNextStep);

  if (key === stableKey) {
    pendingStepKey = null;
    pendingStepCount = 0;
    return { value: stableNextStep, justChanged: false };
  }

  if (key === pendingStepKey) {
    pendingStepCount += 1;
  } else {
    pendingStepKey = key;
    pendingStepCount = 1;
  }

  const isFirstEverValue = stableNextStep === UNSET;
  if (isFirstEverValue || pendingStepCount >= STEP_DEBOUNCE_POLLS) {
    stableNextStep = rawNextStep;
    pendingStepKey = null;
    pendingStepCount = 0;
    return { value: stableNextStep, justChanged: !isFirstEverValue };
  }

  return { value: stableNextStep === UNSET ? null : stableNextStep, justChanged: false };
}

function showScreen(name) {
  if (currentScreen === name) return;
  currentScreen = name;
  $('screen-home').hidden = name !== 'home';
  $('screen-trainer').hidden = name !== 'trainer';
  $('screen-complete').hidden = name !== 'complete';
}

function formatElapsed(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function requestReset() {
  backend.reset();
  // A reset should feel instant, not wait out the debounce window.
  stableNextStep = UNSET;
  pendingStepKey = null;
  pendingStepCount = 0;
  stableMismatch = false;
  pendingMismatch = null;
  pendingMismatchCount = 0;
  completedSnapshot = null;
  sessionCompleted = false;
  sessionEvents.emit('session_start');
}

$('screen-home').addEventListener('click', () => {
  started = true;
  showScreen('trainer');
  requestReset();
});
$('restart-btn').addEventListener('click', requestReset);
$('restart-from-complete-btn').addEventListener('click', requestReset);
$('download-csv-btn').addEventListener('click', () => { if (finalReport) downloadCsv(finalReport); });

$('view-reference-btn').addEventListener('click', () => {
  $('hint-modal').hidden = false;
  if (lastModelSrc) reference.load('/drava-world/' + lastModelSrc);
});
$('hint-modal').addEventListener('click', (e) => {
  // Close on a click anywhere except the reference itself.
  if (e.target.id !== 'reference-video') $('hint-modal').hidden = true;
});

// Which materials glow at each step, so the trainee sees what they just attached (the real
// trainer's table: model-viewer can only light whole materials, so both sides' wheels glow).
// (The shafts share one material, so only the bolt and the screw can be lit.)
const HIGHLIGHT_MATERIALS = {
  'assembly/models/3.glb': ['Old silver high quality (old metal).004'],
  'assembly/models/4.glb': ['Old silver high quality (old metal).008'],
};
const HIGHLIGHT_EMISSIVE = [0.9, 0.55, 0.05];

const home = new ModelView($('home-viewer'), { spin: 40 });   // 40° a second
home.load('/drava-world/assembly/models/assembled.glb');
const viewer = new ModelView($('viewer'), { controls: true, spin: 45, background: '#f4f4f5' });
const reference = new ModelView($('reference-video'), { controls: true, background: '#f4f4f5' });

function applyHighlight() {
  const targets = HIGHLIGHT_MATERIALS[lastModelSrc];
  if (!targets) return;
  for (const material of viewer.materials) {
    if (targets.includes(material.name)) material.emissive?.setRGB(...HIGHLIGHT_EMISSIVE);
  }
}

$('viewer').addEventListener('load', () => {
  $('viewer-hint').hidden = true;
  applyHighlight();
});
$('viewer').addEventListener('error', () => {
  $('viewer-hint').hidden = false;
});

function poll() {
  render(backend.status());
  setTimeout(poll, POLL_MS);
}

function render(data) {
  const states = data.states || [];
  const { value: nextStep, justChanged } = debounceNextStep(data.next_step || null);

  if (!started) { report(null); return; } // the home screen shows a fixed animation, not live state

  const stepIdx = nextStep ? states.findIndex((s) => s.step === nextStep.step) : states.length;
  if (stepIdx !== currentIdx) {
    currentIdx = stepIdx;
    sessionEvents.emit('step_changed', stepIdx);
  }

  if (sessionCompleted) {
    showScreen('complete');
    updateCompleteScreen();
    report(null);
    return;
  }

  if (!nextStep) {
    if (justChanged) {
      // Freeze the stats at the actual moment of completion.
      completedSnapshot = snapshotStats(data);
      sessionCompleted = true;
      // The step-done overlay one last time over the live feed, then the completed screen.
      showStepDoneOverlay(states[states.length - 1]);
      setTimeout(() => { showScreen('complete'); updateCompleteScreen(); }, 1500);
    } else if (currentScreen !== 'trainer') {
      completedSnapshot = snapshotStats(data);
      sessionCompleted = true;
      showScreen('complete');
      updateCompleteScreen();
    }
    report(null);
    return;
  }

  showScreen('trainer');
  if (justChanged) {
    const idx = states.findIndex((s) => s.step === nextStep.step);
    showStepDoneOverlay(idx > 0 ? states[idx - 1] : null);
  }
  updateTrainerScreen(data, states, nextStep);
  report(nextStep);
}

function showStepDoneOverlay(doneState) {
  if (!doneState) return; // nothing "completed" before the very first step
  $('step-done-text').textContent = `${doneState.label} is done`;
  const overlay = $('step-done-overlay');
  overlay.hidden = false;
  setTimeout(() => { overlay.hidden = true; }, 1500);
}

function updateTrainerScreen(data, states, nextStep) {
  const idx = states.findIndex((s) => s.step === nextStep.step);
  $('step-number-tile').textContent = String(idx + 1);
  $('step-meta').textContent = `Step ${idx + 1} of ${states.length}`;
  $('instructions').textContent = nextStep.instructions || '';

  const wasMismatch = stableMismatch;
  const mismatch = debounceMismatch(Boolean(data.mismatch));
  if (mismatch && !wasMismatch) sessionEvents.emit('mistake', idx, 'out_of_order');   // the rising edge
  const alertEl = $('mismatch-alert');
  alertEl.classList.toggle('mismatch-alert--visible', mismatch);
  if (mismatch) alertEl.textContent = data.message;

  // The debounced step's model, not data.model, so the model doesn't jump on a flicker.
  if (nextStep.model && nextStep.model !== lastModelSrc) {
    lastModelSrc = nextStep.model;
    viewer.load('/drava-world/' + nextStep.model);
    $('viewer-hint').hidden = false; // re-shown until load/error fires
  }

  const startedAt = data.session_started_at;
  const elapsed = startedAt ? Date.now() / 1000 - startedAt : 0;
  $('time-lapsed').textContent = `Time Lapsed - ${formatElapsed(elapsed)}`;
}

function accuracyOf(snap) {
  const total = snap.total_frames || 0;
  const mismatches = snap.mismatch_frames || 0;
  return total > 0 ? Math.round(100 * (1 - mismatches / total)) : 100;
}

function updateCompleteScreen() {
  const snap = completedSnapshot || {};
  $('stat-product').textContent = snap.product_name || '-';
  $('stat-accuracy').textContent = `${accuracyOf(snap)}%`;
  $('stat-time').textContent = snap.time_taken_s != null ? `${snap.time_taken_s.toFixed(1)}s` : '-';
  if (finalReport && finalReport !== shownReport) renderReport(finalReport);
}

// The report's summary and its table of steps, from build().
let shownReport = null;
function renderReport(r) {
  shownReport = r;
  $('report-summary').textContent = T.report.summary(r.cleanSteps, r.totalSteps, r.mistakes);
  $('report-rows').innerHTML = r.steps.map((s, i) => `
    <tr class="${s.mistakes ? 'has-mistakes' : ''}">
      <td>${i + 1}</td>
      <td>${esc(s.label)}${s.builtAhead ? ` <span class="ahead-tag">${esc(T.report.ahead)}</span>` : ''}</td>
      <td>${s.seconds == null ? '-' : `${s.seconds.toFixed(1)}s`}</td>
      <td>${s.mistakes}</td>
    </tr>`).join('');
}

// What the trainer shows, for the bench (TRAVIS speaks to it): sent when it changes.
let reported = '';
function report(nextStep) {
  const status = {
    screen: currentScreen ?? 'home',
    step: nextStep ? String(nextStep.step) : null,
    mismatch: nextStep ? stableMismatch : false,
    result: completedSnapshot && { time: completedSnapshot.time_taken_s, accuracy: accuracyOf(completedSnapshot) },
  };
  const key = JSON.stringify(status);
  if (key === reported) return;
  reported = key;
  backend.report(status);
}

/* ---- the camera feed ---- */

// The bench draws each camera frame here (an ImageData), with the outline of the build area
// the camera watches (roi: corners in 0..1 of the frame), as the real feed draws its ROI.
const feed = $('video-feed').getContext('2d');
const frame = document.createElement('canvas');
window.vecFeed = (image, roi) => {
  if (frame.width !== image.width || frame.height !== image.height) Object.assign(frame, { width: image.width, height: image.height });
  frame.getContext('2d').putImageData(image, 0, 0);
  feed.drawImage(frame, 0, 0, FEED.w, FEED.h);
  if (!roi?.length) return;
  feed.strokeStyle = '#2bff2b';
  feed.lineWidth = 2;
  feed.beginPath();
  roi.forEach(([x, y], i) => feed[i ? 'lineTo' : 'moveTo'](x * FEED.w, y * FEED.h));
  feed.closePath();
  feed.stroke();
};

// Opening the page starts a fresh session, same as pressing restart.
showScreen('home');
requestReset();
poll();
