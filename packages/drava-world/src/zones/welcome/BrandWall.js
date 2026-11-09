import * as THREE from 'three';
import { WebScreen } from '../../core/WebScreen.js';
import { FONT, canvasTexture, spacedText, textPlane } from '../../util/textures.js';

const SLIDE_SECONDS = 6;
const FADE_SECONDS = 0.9;
const IDLE_LEVEL = 0.6;    // the idle image is mostly white: keep it well under the bloom threshold (0.82) or the wall glares (default)

/**
 * The brand wall: an LED wall that plays White Tusker's work.
 *  - Idle: reel.idle, a still image (the brand logo), shown until the visitor plays the film.
 *    reel.idleCrop ([x, y, w, h] as fractions of the image, from the top left) shows only part of it;
 *    reel.idleScale (0..1) draws it smaller than a full fit, centred on its own background.
 *  - Film: playFilm() plays reel.film with sound, then fades back to the idle image.
 *  - Until the idle image has loaded (or if it can't), an animated reel of brand slides
 *    (reel.slides) crossfades over a moving brand-coloured ground.
 * The wall is 16:9, the film's shape. The image and the film are fitted inside it, centred
 * and keeping their shape; any space left is filled with the image's own background (idle)
 * or black (film). The idle image on another origin (the R2 bucket) must send CORS headers,
 * or WebGL can't draw it. The film plays in the CSS layer (a WebScreen), like the data art
 * wall's studio: exactly as filmed, no bloom or tone mapping. update()'s `allowed` says when
 * nothing stands between it and the camera.
 * Same bezel, size and ticker style as the Mosaic wall.
 * idleLevel: the idle image's brightness (where there's no bloom, as bright as the screen it's on).
 * bezel: false for a wall that already has its own frame (a screen in a room model).
 * ticker: false for no "now playing" line under the wall.
 */
export class BrandWall {
  constructor({ engine, width = 11, height = 3.8, reel, idleLevel = IDLE_LEVEL, bezel = true, ticker = true }) {
    this.engine = engine;
    this.width = width;
    this.height = height;
    this.reel = reel;
    const g = (this.group = new THREE.Group());

    if (bezel) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.16, height + 0.16, 0.14), new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.5, metalness: 0.6 }));
      frame.position.z = -0.075;
      g.add(frame);
    }

    const texW = 2400, texH = Math.round(texW * height / width);
    this.slides = reel.slides.map((slide, i) => canvasTexture(texW, texH, (ctx, w, h) => this.#drawSlide(ctx, w, h, slide, i)).texture);
    this.index = 0;
    this.clock = 0;

    this.uniforms = {
      uTime: { value: 0 },
      uWarm: { value: 0 },
      uAspect: { value: width / height },
      uA: { value: this.slides[0] },
      uB: { value: this.slides[1 % this.slides.length] },
      uMix: { value: 0 },
      uZoomA: { value: 1 },
      uZoomB: { value: 1 },
      uIdle: { value: null },
      uIdleAspect: { value: 16 / 9 },
      uIdleCrop: { value: new THREE.Vector4(...(reel.idleCrop ?? [0, 0, 1, 1])) },
      uIdleScale: { value: reel.idleScale ?? 1 },
      uIdleOn: { value: 0 },
    };
    this.idleOn = 0;
    this.playing = false;
    this.screen = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uWarm, uAspect, uMix, uZoomA, uZoomB, uIdleAspect, uIdleOn;
          uniform vec4 uIdleCrop;
          uniform float uIdleScale;
          uniform sampler2D uA, uB, uIdle;
          varying vec2 vUv;
          float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
            return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
          float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
          vec4 slide(sampler2D tex, float zoom){ return texture2D(tex, (vUv - vec2(0.3, 0.5)) / zoom + vec2(0.3, 0.5)); }
          // Fit a picture inside the wall, centred, keeping its shape; outside it, the pad colour.
          // crop: x, y, w, h of the picture to use, as fractions from its top left.
          // scale: 1 fills the wall's width or height; smaller draws it smaller, centred.
          vec3 fitted(sampler2D tex, float aspect, vec3 pad, vec4 crop, float scale){
            vec2 uv = (vUv - 0.5) / scale;
            if (aspect > uAspect) uv.y *= aspect / uAspect; else uv.x *= uAspect / aspect;
            uv += 0.5;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return pad;
            return texture2D(tex, vec2(crop.x + uv.x * crop.z, 1.0 - (crop.y + (1.0 - uv.y) * crop.w))).rgb;
          }
          void main(){
            vec3 col = vec3(0.0);
            if (uIdleOn < 0.999) {
              // Moving ground: deep charcoal, with a warm gold drift.
              vec2 p = vec2(vUv.x * uAspect, vUv.y);
              float t = uTime * 0.04;
              float f = fbm(p * 0.9 + vec2(t, t * 0.3) + fbm(p * 1.7 - t));
              vec3 ground = mix(vec3(0.005, 0.006, 0.007), vec3(0.035, 0.037, 0.04), f);
              float gold = smoothstep(0.55, 0.9, fbm(p * 0.6 - vec2(t * 1.3, 0.0)));
              ground += vec3(0.35, 0.22, 0.05) * gold * 0.12;
              // A light sweep, like a stage light crossing the wall.
              float sweep = exp(-pow(abs(vUv.x - fract(uTime * 0.05) * 1.5 + 0.25) * 5.0, 2.0));
              ground += vec3(0.8) * sweep * 0.05;
              vec4 a = slide(uA, uZoomA), b = slide(uB, uZoomB);
              vec4 s = mix(a, b, uMix);
              col = mix(ground, s.rgb * 0.82, s.a); // under full white, so the glow doesn't smear the type
            }
            if (uIdleOn > 0.001) {
              vec3 bg = texture2D(uIdle, vec2(0.004, 0.5)).rgb;    // the image's own background fills the sides
              col = mix(col, fitted(uIdle, uIdleAspect, bg, uIdleCrop, uIdleScale) * ${idleLevel.toFixed(2)}, uIdleOn);
            }
            col *= mix(0.6, 1.0, uWarm);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    g.add(this.screen);

    this.ticker = textPlane(width, 0.22, 3000, (ctx, w, h) => {
      ctx.textBaseline = 'middle';
      ctx.font = `500 ${h * 0.5}px ${FONT.mono}`;
      const items = [['● NOW PLAYING', '#F2B544'], ['WHITE TUSKER · BRAND WALL', '#C9CED6'], ['ARCHITECTS OF EXPERIENCES', '#8D96A6']];
      let x = w * 0.01;
      for (const [text, color] of items) {
        ctx.fillStyle = color;
        spacedText(ctx, text, x, h / 2, 6);
        x += ctx.measureText(text).width + text.length * 6 + w * 0.035;
      }
    });
    this.ticker.position.set(0, -height / 2 - 0.28, 0.01);
    if (ticker) g.add(this.ticker);

    this.spill = new THREE.RectAreaLight(0xcfe9ff, 1, width, height);
    this.spill.position.set(0, 0, 0.05);
    this.spill.rotation.y = Math.PI; // area lights emit along -z; the screen faces +z
    g.add(this.spill);

    this.hitTargets = [this.screen];
    if (reel.idle) this.#loadIdle(reel.idle);
  }

  #loadIdle(src) {
    new THREE.TextureLoader().setCrossOrigin('anonymous').load(src, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      this.uniforms.uIdle.value = tex;
      const [, , cw, ch] = this.reel.idleCrop ?? [0, 0, 1, 1];
      this.uniforms.uIdleAspect.value = (tex.image.width * cw) / (tex.image.height * ch);
      this.idleReady = true;
      this.onIdleLoaded?.(tex);
    }, undefined, () => console.warn('[brand wall] idle image failed to load, showing the slide reel:', src));
  }

  /** Start fetching the film so it plays straight away when asked. */
  preload() {
    if (this.film || !this.reel.film) return;
    this.film = new WebScreen(this.engine, { url: this.reel.film, tag: 'video', width: this.width, height: this.height, viewport: [1920, 1080], title: 'Brand film' });
    this.film.group.position.z = 0.01;
    this.group.add(this.film.group);
    const video = (this.video = this.film.frame);
    Object.assign(video, { playsInline: true, preload: 'auto' });
    video.style.objectFit = 'contain';               // its own shape, black either side
    video.addEventListener('ended', () => this.stopFilm());
    this.film.load();
  }

  /** Play the film from the start (call it from a click, so the browser allows sound). */
  async playFilm({ sound = true } = {}) {
    if (!this.reel.film) return false;
    this.preload();
    const video = this.video;
    video.currentTime = 0;
    video.muted = !sound;
    try {
      await video.play();
    } catch {
      video.muted = true; // the browser refused sound: play muted rather than not at all
      try { await video.play(); } catch (err) { console.warn('[brand wall] film failed to play:', err); return false; }
    }
    this.playing = true;
    return true;
  }

  /** Stop the film and fade back to the idle image. */
  stopFilm() {
    if (!this.playing) return;
    this.playing = false;
    this.video.pause();
    this.onFilmEnd?.();
  }

  setSound(on) {
    if (this.video) this.video.muted = !on;
  }

  /** Leaving the zone: stop the film and take it off the wall at once. */
  hide() {
    this.stopFilm();
    this.film?.hide();
  }

  #drawSlide(ctx, w, h, slide, i) {
    ctx.clearRect(0, 0, w, h);
    const x = w * 0.06;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FBFAF5';
    ctx.font = `500 ${h * 0.045}px ${FONT.mono}`;
    spacedText(ctx, slide.kicker.toUpperCase(), x, h * 0.3, 10);
    ctx.fillStyle = '#F2B544';
    ctx.fillRect(x, h * 0.34, w * 0.05, Math.max(3, h * 0.006));

    ctx.fillStyle = '#F3F4F6';
    ctx.font = `700 ${h * 0.12}px ${FONT.display}`;
    const lines = this.#wrap(ctx, slide.title, w * 0.62);
    lines.forEach((line, n) => ctx.fillText(line, x, h * 0.5 + n * h * 0.14));
    if (slide.body) {
      ctx.fillStyle = '#C9CED6';
      ctx.font = `400 ${h * 0.05}px ${FONT.body}`;
      ctx.fillText(slide.body, x, h * 0.5 + lines.length * h * 0.14 + h * 0.02);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8D96A6';
    ctx.font = `500 ${h * 0.035}px ${FONT.mono}`;
    spacedText(ctx, `${String(i + 1).padStart(2, '0')} / ${String(this.reel.slides.length).padStart(2, '0')}`, w * 0.95, h * 0.9, 6);
  }

  #wrap(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
    return lines;
  }

  /** camera, allowed: the film shows only while the zone says nothing stands in front of it. */
  update(dt, t, { warm, camera, allowed }) {
    const u = this.uniforms;
    u.uTime.value = t;
    u.uWarm.value += (warm - u.uWarm.value) * Math.min(1, dt * 1.5);
    this.spill.intensity = 0.6 + 1.4 * u.uWarm.value;
    this.film?.update(dt, camera, { allowed: allowed && this.playing });

    // Crossfade: slides → idle image once it has loaded.
    this.idleOn += ((this.idleReady ? 1 : 0) - this.idleOn) * Math.min(1, dt * 2);
    u.uIdleOn.value = this.idleOn > 0.998 ? 1 : this.idleOn;
    if (u.uIdleOn.value >= 1 || this.slides.length < 2) return;

    // Each slide holds, pushes in slowly, then crossfades into the next.
    this.clock += dt;
    // Zoom runs from the moment a slide starts fading in, so it carries on smoothly after the swap.
    const push = (since) => 1 + 0.04 * Math.max(0, since) / SLIDE_SECONDS;
    u.uZoomA.value = push(this.clock + FADE_SECONDS);
    u.uZoomB.value = push(this.clock - (SLIDE_SECONDS - FADE_SECONDS));
    const fade = (this.clock - (SLIDE_SECONDS - FADE_SECONDS)) / FADE_SECONDS;
    u.uMix.value = THREE.MathUtils.smoothstep(fade, 0, 1);
    if (this.clock >= SLIDE_SECONDS) {
      this.clock -= SLIDE_SECONDS;
      this.index = (this.index + 1) % this.slides.length;
      u.uA.value = this.slides[this.index];
      u.uB.value = this.slides[(this.index + 1) % this.slides.length];
      u.uMix.value = 0;
    }
  }
}
