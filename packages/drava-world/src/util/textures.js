import * as THREE from 'three';

export const FONT = {
  display: '"Unbounded", "Arial Black", system-ui, sans-serif',
  body: '"Instrument Sans", "Segoe UI", system-ui, sans-serif',
  mono: '"JetBrains Mono", Consolas, ui-monospace, monospace',
};

/** A canvas-backed texture you can redraw later with .redraw(fn). */
export function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const api = {
    texture, canvas, ctx,
    redraw(fn) {
      ctx.clearRect(0, 0, width, height);
      fn(ctx, width, height);
      texture.needsUpdate = true;
    },
  };
  if (draw) api.redraw(draw);
  return api;
}

/** Draw text with letter spacing (uses ctx.letterSpacing where supported). */
export function spacedText(ctx, text, x, y, spacing = 0) {
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
    return;
  }
  let cx = x;
  const align = ctx.textAlign;
  if (align === 'center' || align === 'right') {
    const total = [...text].reduce((w, ch) => w + ctx.measureText(ch).width + spacing, -spacing);
    cx = align === 'center' ? x - total / 2 : x - total;
  }
  ctx.textAlign = 'left';
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; }
  ctx.textAlign = align;
}

/** A flat, transparent, unlit plane carrying canvas text. */
export function textPlane(width, height, pxWidth, draw, { opacity = 1, glow = 1 } = {}) {
  const pxHeight = Math.round((pxWidth * height) / width);
  const ct = canvasTexture(pxWidth, pxHeight, draw);
  const material = new THREE.MeshBasicMaterial({
    map: ct.texture, transparent: true, opacity, depthWrite: false,
    color: new THREE.Color(glow, glow, glow),
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.userData.canvas = ct;
  return mesh;
}

/** Procedural dark terrazzo for the floor. */
export function terrazzoTexture(size = 1024) {
  const { texture } = canvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#23262d';
    ctx.fillRect(0, 0, w, h);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const chips = ['#3a3f48', '#2d3139', '#4a4f58', '#1a1c21', '#5b5f66', '#6d5a48'];
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * w, y = rnd() * h, r = 0.6 + rnd() * rnd() * 5.5;
      ctx.fillStyle = chips[Math.floor(rnd() * chips.length)];
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.55 + rnd() * 0.45), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Dark acoustic wall cladding, one 1.2 m panel wide and the room's height tall (see wallUVs in
 * zones/shared/room.js): a shadow joint at the panel edge, a recessed black plinth at the floor
 * and a reveal at door-head height (3.5 m), the datum every wall lines up to.
 */
export function panelTexture(height = 5) {
  const W = 256, H = 1024, m = H / height;
  const { texture } = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#22262d';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1d2026';                          // the band over the datum, a shade darker
    ctx.fillRect(0, 0, W, H - 3.5 * m);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 420; i++) {                      // fine vertical grain of the fabric face
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(rnd() * W, 0, 1, H);
    }
    ctx.fillStyle = '#0c0d10';
    ctx.fillRect(0, 0, 3, H);                            // shadow joint
    ctx.fillStyle = '#2b3038';
    ctx.fillRect(3, 0, 1, H);                            // its lit edge
    ctx.fillStyle = '#0c0d10';
    ctx.fillRect(0, H - 3.5 * m - 2, W, 4);              // datum reveal
    ctx.fillStyle = '#08090b';
    ctx.fillRect(0, H - 0.12 * m, W, 0.12 * m);          // plinth
  });
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}
