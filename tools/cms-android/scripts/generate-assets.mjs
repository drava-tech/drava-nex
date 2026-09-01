/**
 * Builds the source images in assets/ from the CMS logo, ready for
 * `npm run assets` to fan out into every Android density.
 *
 * apps/cms/public/Logo.png is a 2386x859 lockup: the green tusker glyph on the
 * left, then the "WHITE TUSKER" wordmark. The full lockup is far too wide to
 * read as a launcher icon, so:
 *
 *   - launcher icon  -> the glyph alone, cropped out of the lockup
 *   - splash screen  -> the full lockup, which has room to breathe
 *
 * The glyph is located by finding the bounding box of its green pixels rather
 * than by hard-coded coordinates, so a re-exported Logo.png with different
 * padding still crops correctly.
 */
import sharp from 'sharp';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const repoRoot = resolve(projectRoot, '../..');

const SOURCE = join(repoRoot, 'apps', 'cms', 'public', 'Logo.png');
const OUT = join(projectRoot, 'assets');

// Brand background — the top stop of the body gradient in apps/cms/src/app/layout.tsx.
const BG = { r: 0x01, g: 0x00, b: 0x1f, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const ICON = 1024;
const SPLASH = 2732;

// Fraction of the canvas the artwork occupies.
const ICON_ONLY = 0.62; // legacy square icon — unmasked, so it can run larger
// capacitor-assets already insets the adaptive foreground by 16.7% (down to the
// 72dp mask area), so this fraction is relative to that, not to the full 108dp
// canvas. 0.74 keeps this tall glyph inside the 66dp safe circle; going much
// higher clips its corners under a circular mask.
const FOREGROUND = 0.74;
const SPLASH_MARK = 0.34;

/** Bounding box of the glyph, found by its brand green. */
async function findGlyphBox() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, found = 0;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      // Brand green is a bright yellow-green: high green, low blue, never
      // blue-dominant. Excludes the white/grey wordmark and the transparency.
      if (a > 128 && g > 170 && b < 120 && g - b > 80 && g >= r) {
        found++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  if (found < 1000) {
    throw new Error(
      `generate-assets: found only ${found} green pixels in ${SOURCE} — the logo changed. ` +
        'Adjust the colour test in findGlyphBox(), or point SOURCE at a dedicated square mark.',
    );
  }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Square canvas of `size`, filled with the brand colour or left transparent. */
const canvas = (size, background) => ({
  create: { width: size, height: size, channels: 4, background },
});

/** Fit `artwork` to `fraction` of a `size` canvas and centre it. */
async function compose({ artwork, size, fraction, background, out }) {
  const overlay = await artwork
    .resize({ width: Math.round(size * fraction), height: Math.round(size * fraction), fit: 'inside' })
    .png()
    .toBuffer();

  await sharp(canvas(size, background))
    .composite([{ input: overlay, gravity: 'centre' }])
    .png()
    .toFile(join(OUT, out));

  console.log(`generate-assets: ${out} (${size}x${size})`);
}

const box = await findGlyphBox();
console.log(`generate-assets: glyph found at ${box.width}x${box.height} (${box.left},${box.top})`);

const glyph = () => sharp(SOURCE).extract(box);
// trim() so the fraction means the wordmark itself, not the export's padding.
const lockup = () => sharp(SOURCE).trim();

await compose({ artwork: glyph(), size: ICON, fraction: ICON_ONLY, background: BG, out: 'icon-only.png' });
await compose({ artwork: glyph(), size: ICON, fraction: FOREGROUND, background: TRANSPARENT, out: 'icon-foreground.png' });

await sharp(canvas(ICON, BG)).png().toFile(join(OUT, 'icon-background.png'));
console.log(`generate-assets: icon-background.png (${ICON}x${ICON})`);

// The CMS forces dark mode (forcedTheme="dark" in layout.tsx), so the light and
// dark splashes are deliberately identical — the app never renders light.
await compose({ artwork: lockup(), size: SPLASH, fraction: SPLASH_MARK, background: BG, out: 'splash.png' });
await compose({ artwork: lockup(), size: SPLASH, fraction: SPLASH_MARK, background: BG, out: 'splash-dark.png' });
