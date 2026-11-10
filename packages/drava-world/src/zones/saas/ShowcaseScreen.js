import * as THREE from 'three';
import { WebScreen } from '../../core/WebScreen.js';
import { FONT, canvasTexture, spacedText } from '../../util/textures.js';

const LEVEL = 0.86;         // the title card, under full white (as WallDisplay)
const SITE_LEAD = 8;        // seconds before the film ends that the live site starts loading

/**
 * One of the SaaS Zone's wall screens: a 16:9 LED screen in a thin bezel that plays a
 * product's film, then runs the product itself, live (a WebScreen over the same rectangle).
 *   state 'idle'   the title card (show.kicker, name, tagline)
 *         'intro'  the film is playing (playIntro())
 *         'live'   the film ended or was skipped: the site shows whenever update() allows it
 * No film, or one that won't load, goes straight to 'live'. With no url, 'live' keeps the
 * title card up with show.soon. onLive() fires once the screen goes live.
 */
export class ShowcaseScreen {
  /** bezel: false leaves out the frame (a screen set into a model that has its own). */
  constructor(engine, show, { width, height, bezel: framed = true }) {
    this.show = show;
    this.state = 'idle';
    const g = (this.group = new THREE.Group());

    const bezel = new THREE.Mesh(new THREE.BoxGeometry(width + 0.12, height + 0.12, 0.1), new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.5, metalness: 0.6 }));
    bezel.position.z = -0.055;
    if (framed) g.add(bezel);

    this.card = canvasTexture(1600, 900, (ctx, w, h) => this.#drawCard(ctx, w, h));
    this.material = new THREE.MeshBasicMaterial({ map: this.card.texture, color: new THREE.Color().setScalar(LEVEL) });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material);
    g.add(this.screen);
    this.hitTargets = [this.screen];

    if (show.url) {
      this.site = new WebScreen(engine, { url: show.url, width, height, viewport: show.viewport, title: show.name });
      this.site.group.position.z = 0.01;
      g.add(this.site.group);
    }
    // The film plays in the CSS layer too, like the Mosaic wall, not as a WebGL texture: it
    // shows exactly as filmed (no bloom, no tone mapping) and costs the GPU no texture uploads.
    if (show.video) {
      this.film = new WebScreen(engine, { url: show.video, tag: 'video', width, height, viewport: show.viewport, title: `${show.name} film` });
      this.film.group.position.z = 0.01;
      g.add(this.film.group);
      const v = (this.video = this.film.frame);
      Object.assign(v, { playsInline: true, preload: 'auto' });
      v.style.objectFit = 'contain';
      v.addEventListener('ended', () => this.#goLive());
      // The live site loads behind the film's last seconds, ready when it ends, but not at the
      // start: a whole web app booting while the film decodes made the film stutter.
      v.addEventListener('timeupdate', () => { if (v.duration - v.currentTime < SITE_LEAD) this.site?.load(); });
      v.addEventListener('error', () => { console.warn('[saas] film failed to load, going straight to the site:', show.video); this.#goLive(); });
    }
  }

  /** Play the film from the start (call it from a click or an arrival, so the browser allows sound). */
  async playIntro({ sound = true } = {}) {
    if (this.state === 'live') return;
    if (!this.film) { this.site?.load(); this.#goLive(); return; }
    this.film.load();
    const v = this.video;
    this.state = 'intro';
    v.currentTime = 0;
    v.muted = !sound;
    try {
      await v.play();
    } catch {
      v.muted = true;                                // the browser refused sound: play muted rather than not at all
      try { await v.play(); } catch (err) { if (this.state === 'intro') { console.warn('[saas] film failed to play:', err); this.#goLive(); } }
    }
  }

  /** The visitor walked away mid-film: back to the title card, to start over next time. */
  stopIntro() {
    if (this.state !== 'intro') return;
    this.video.pause();
    this.state = 'idle';
  }

  /** Skip the rest of the film. */
  skip() {
    if (this.state === 'intro') this.#goLive();
  }

  #goLive() {
    if (this.state === 'live') return;
    this.site?.load();                               // skipped early: load it now
    this.video?.pause();
    this.state = 'live';
    this.card.redraw((ctx, w, h) => this.#drawCard(ctx, w, h));
    this.onLive?.();
  }

  setSound(on) {
    if (this.video) this.video.muted = !on;
  }

  hide() {
    this.stopIntro();
    this.film?.hide();
    this.site?.hide();
  }

  /** allowed: the zone says the live page may show (the camera is at rest). Returns whether it shows. */
  update(dt, camera, { allowed }) {
    this.film?.update(dt, camera, { allowed: allowed && this.state === 'intro' });
    return this.site?.update(dt, camera, { allowed: allowed && this.state === 'live' }) ?? false;
  }

  #drawCard(ctx, w, h) {
    const s = this.show;
    const x = w * 0.08;
    ctx.fillStyle = '#07080B';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#8D96A6';
    ctx.font = `500 ${h * 0.04}px ${FONT.mono}`;
    spacedText(ctx, s.kicker.toUpperCase(), x, h * 0.38, 10);
    ctx.fillStyle = '#F2B544';
    ctx.fillRect(x, h * 0.42, w * 0.05, Math.max(3, h * 0.006));
    ctx.fillStyle = '#EEF0F3';
    ctx.font = `700 ${h * 0.14}px ${FONT.display}`;
    ctx.fillText(s.name, x, h * 0.6);
    ctx.fillStyle = '#C9CED6';
    ctx.font = `400 ${h * 0.05}px ${FONT.body}`;
    ctx.fillText(this.state === 'live' && !this.site ? s.soon ?? s.tagline : s.tagline, x, h * 0.7);
  }
}
