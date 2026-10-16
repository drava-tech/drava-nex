/**
 * A small analog clock face drawn as SVG after a fine watch dial: brushed
 * silver with a sunburst sheen, a minute track of little boxes round the
 * edge, raised black Roman numerals with polished edges facing the centre
 * and the company logo below XII,
 * black hour and minute hands, a thin red seconds hand, and AM or PM just
 * below the centre. Styled from style.css (.analog).
 *
 * `createAnalogClock()` returns { el, set(date, timeZone) }; `set` turns the
 * hands to that moment's time in the zone.
 */
import logoUrl from "./assets/logo.png";

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
// The numerals round the dial, each with its width: tall, narrow numerals
// whose widths follow the reference's.
const ROMAN = [["XII", 26], ["I", 7], ["II", 13], ["III", 20.5], ["IIII", 26], ["V", 20], ["VI", 23], ["VII", 26], ["VIII", 27.5], ["IX", 23.5], ["X", 20], ["XI", 22.5]];
const NUMERAL_RADIUS = 80.7;

// The company logo (cut from the reference dial, assets/logo.png), between
// XII and the centre.
const LOGO = `<image href="${logoUrl}" x="91.6" y="38" width="16.8" height="24"/>`;

/**
 * The brushed-silver dial, drawn once into an image: radial brushing that
 * catches the light bright at the top and bottom and dark at the sides, the
 * dark deepest near the centre and on the right, as on the reference dial
 * (its brightness was sampled round it), with fine radial scratches.
 */
function dialTexture() {
  const SIZE = 640;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(SIZE, SIZE);
  // Fine scratches: a little brightness noise that varies round the dial but
  // runs straight out along each radius.
  const scratches = Float32Array.from({ length: 2048 }, () => Math.random() - 0.5);
  const smooth = (a, b, x) => Math.min(Math.max((x - a) / (b - a), 0), 1);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const dx = (px + 0.5) / SIZE - 0.5;
      const dy = (py + 0.5) / SIZE - 0.5;
      const r = Math.hypot(dx, dy) * 2; // 0 at the centre, 1 at the edge
      if (r > 1) continue;
      const angle = Math.atan2(dx, -dy); // clockwise from 12
      const right = smooth(-0.35, 0.35, Math.sin(angle)); // 1 on the right half
      const mean = right * (166 + 22 * smooth(0.3, 0.9, r)) + (1 - right) * (168 + 52 * smooth(0.05, 0.6, r));
      const swing = right * (62 - 26 * smooth(0.3, 0.9, r)) + (1 - right) * (62 - 52 * smooth(0.05, 0.6, r));
      const k = Math.floor(((angle / (2 * Math.PI) + 1) % 1) * scratches.length);
      const v = mean + swing * Math.cos(2 * angle) + 9 * scratches[k] + 3 * (Math.random() - 0.5);
      const o = (py * SIZE + px) * 4;
      img.data[o] = img.data[o + 1] = v;
      img.data[o + 2] = v + 2;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

let face;
const FACE = () => (face ??= buildFace());

function buildFace() {
  const f = (v) => v.toFixed(2);
  // The minute track: a ring of little boxes between two lines.
  let track = "";
  for (let i = 0; i < 60; i++) {
    const [x1, y1] = at(i / 60, 92.1);
    const [x2, y2] = at(i / 60, 95.2);
    track += `<line class="analog-tick" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
  }
  // Roman numerals inside the track, each turned to face the centre: black
  // enamel in a polished silver frame with a fine dark edge.
  let roman = "";
  ROMAN.forEach((numeral, n) => {
    const [text, width] = numeral;
    const [x, y] = at(n / 12, NUMERAL_RADIUS);
    const attrs = `x="${f(x)}" y="${f(y)}" textLength="${width}" lengthAdjust="spacingAndGlyphs" transform="rotate(${n * 30} ${f(x)} ${f(y)})"`;
    roman += `<text class="analog-roman-edge" ${attrs}>${text}</text><text class="analog-roman" ${attrs}>${text}</text>`;
  });
  return `
    <defs>
      <filter id="ID-raised" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0.5" dy="1" stdDeviation="0.6" flood-color="#000" flood-opacity="0.3"/>
      </filter>
    </defs>
    <circle class="analog-rim" cx="100" cy="100" r="99"/>
    <image href="${dialTexture()}" x="4" y="4" width="192" height="192"/>
    <circle class="analog-track-inner" cx="100" cy="100" r="92.1"/>
    <circle class="analog-track" cx="100" cy="100" r="95.2"/>
    ${track}
    <g filter="url(#ID-raised)">${roman}</g>
    ${LOGO}
    <text class="analog-ampm" x="100" y="124"></text>
    <g filter="url(#ID-raised)">
      <line class="analog-hour" x1="100" y1="108" x2="100" y2="50"/>
      <line class="analog-minute" x1="100" y1="110" x2="100" y2="18"/>
      <line class="analog-second" x1="100" y1="120" x2="100" y2="14"/>
      <circle class="analog-pin" cx="100" cy="100" r="4.5"/>
    </g>
  `;
}
let faces = 0; // so each clock's gradient and filter ids are its own

export function createAnalogClock() {
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("class", "analog");
  el.setAttribute("viewBox", "0 0 200 200");
  el.setAttribute("role", "img");
  el.innerHTML = FACE().replaceAll("ID-", `analog${++faces}-`);
  const hour = el.querySelector(".analog-hour");
  const minute = el.querySelector(".analog-minute");
  const second = el.querySelector(".analog-second");
  const ampm = el.querySelector(".analog-ampm");

  return {
    el,
    set(date, timeZone) {
      const [h, m, s] = timeIn(date, timeZone);
      hour.setAttribute("transform", `rotate(${((h % 12) + m / 60) * 30} 100 100)`);
      minute.setAttribute("transform", `rotate(${(m + s / 60) * 6} 100 100)`);
      second.setAttribute("transform", `rotate(${s * 6} 100 100)`);
      ampm.textContent = h < 12 ? "AM" : "PM";
      el.setAttribute("aria-label", `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    },
  };
}
