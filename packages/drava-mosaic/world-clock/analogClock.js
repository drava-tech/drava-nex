/**
 * A small analog clock face drawn as SVG after a clean wall-clock dial: a
 * pale face with bold black hour bars and fine grey minute ticks round the
 * edge, upright serif numerals 1–12, tapered black hour and minute hands, a
 * thin red seconds hand and a red pin at the centre, all casting a soft
 * shadow. Styled from style.css (.analog).
 *
 * `createAnalogClock()` returns { el, set(date, timeZone) }; `set` turns the
 * hands to that moment's time in the zone.
 */
const NS = "http://www.w3.org/2000/svg";
const formats = new Map(); // timeZone → its formatter, made once

function timeIn(date, timeZone) {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formats.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(date).map((p) => [p.type, Number(p.value)]));
  return [parts.hour, parts.minute, parts.second];
}

// Where a point `r` from the centre at `turn` (0–1, clockwise from 12) falls.
const at = (turn, r) => [100 + r * Math.sin(turn * 2 * Math.PI), 100 - r * Math.cos(turn * 2 * Math.PI)];

// Proportions measured off the reference dial, in units of a 200-unit face
// whose edge is at radius 99.
const NUMERAL_RADIUS = 71;

let face;
const FACE = () => (face ??= buildFace());

function buildFace() {
  const f = (v) => v.toFixed(2);
  // The ticks: a bold bar at each hour, a fine grey one at each minute.
  let ticks = "";
  for (let i = 0; i < 60; i++) {
    const hour = i % 5 === 0;
    const [x1, y1] = at(i / 60, hour ? 81 : 86);
    const [x2, y2] = at(i / 60, hour ? 93 : 92);
    ticks += `<line class="${hour ? "analog-hour-tick" : "analog-tick"}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
  }
  // Upright numerals inside the ticks.
  let numerals = "";
  for (let n = 1; n <= 12; n++) {
    const [x, y] = at(n / 12, NUMERAL_RADIUS);
    numerals += `<text class="analog-numeral" x="${f(x)}" y="${f(y)}">${n}</text>`;
  }
  return `
    <defs>
      <filter id="ID-soft" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="1.5" dy="2.5" stdDeviation="2" flood-color="#000" flood-opacity="0.22"/>
      </filter>
      <filter id="ID-hands" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="2.5" dy="4" stdDeviation="2.4" flood-color="#000" flood-opacity="0.35"/>
      </filter>
    </defs>
    <circle class="analog-face" cx="100" cy="100" r="98"/>
    <g filter="url(#ID-soft)">${ticks}${numerals}</g>
    <g filter="url(#ID-hands)">
      <polygon class="analog-hour" points="100,46 103.6,100 100,108 96.4,100"/>
      <polygon class="analog-minute" points="100,22 102.6,100 100,108 97.4,100"/>
      <polygon class="analog-second" points="100,18 100.9,100 100,118 99.1,100"/>
      <circle class="analog-pin" cx="100" cy="100" r="4.6"/>
      <circle class="analog-pin-red" cx="100" cy="100" r="3.2"/>
      <circle class="analog-pin-dot" cx="100" cy="100" r="1.3"/>
    </g>
  `;
}
let faces = 0; // so each clock's filter ids are its own

export function createAnalogClock() {
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("class", "analog");
  el.setAttribute("viewBox", "0 0 200 200");
  el.setAttribute("role", "img");
  el.innerHTML = FACE().replaceAll("ID-", `analog${++faces}-`);
  const hour = el.querySelector(".analog-hour");
  const minute = el.querySelector(".analog-minute");
  const second = el.querySelector(".analog-second");

  return {
    el,
    set(date, timeZone) {
      const [h, m, s] = timeIn(date, timeZone);
      hour.setAttribute("transform", `rotate(${((h % 12) + m / 60) * 30} 100 100)`);
      minute.setAttribute("transform", `rotate(${(m + s / 60) * 6} 100 100)`);
      second.setAttribute("transform", `rotate(${s * 6} 100 100)`);
      el.setAttribute("aria-label", `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    },
  };
}
