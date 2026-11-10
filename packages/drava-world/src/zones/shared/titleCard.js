import * as THREE from 'three';
import { FONT, canvasTexture, spacedText } from '../../util/textures.js';

/**
 * A still title card for one of a client model's screens (16:9): a red rule and kicker, a large
 * title, a line or two of body, a footer. `card`: { kicker, title, body, footer }. Returns a plane
 * `width` × `height` metres to set just in front of the model's screen face, drawn at full brightness.
 */
export function titleCard(card, width, height) {
  const W = 1600, H = 900;
  const { texture } = canvasTexture(W, H, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#0b0c10');
    g.addColorStop(1, '#170a0e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#E21D3E';
    ctx.fillRect(110, 250, 90, 8);
    ctx.fillStyle = '#FF4D63';
    ctx.font = `500 30px ${FONT.mono}`;
    spacedText(ctx, card.kicker.toUpperCase(), 110, 320, 4);
    ctx.fillStyle = '#F4F2EE';
    ctx.font = `700 ${card.title.length > 16 ? 96 : 128}px ${FONT.display}`;
    ctx.fillText(card.title, 104, 470);
    ctx.fillStyle = '#AEB5C1';
    ctx.font = `400 40px ${FONT.body}`;
    let line = '', y = 560;
    for (const word of (card.body ?? '').split(' ')) {
      if (ctx.measureText(`${line}${word} `).width > 1300 && line) { ctx.fillText(line.trim(), 110, y); line = ''; y += 56; }
      line += `${word} `;
    }
    if (line.trim()) ctx.fillText(line.trim(), 110, y);
    if (card.footer) {
      ctx.fillStyle = '#6E7685';
      ctx.font = `500 24px ${FONT.mono}`;
      spacedText(ctx, card.footer.toUpperCase(), 110, 820, 4);
    }
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  mesh.raycast = () => {};
  return mesh;
}
