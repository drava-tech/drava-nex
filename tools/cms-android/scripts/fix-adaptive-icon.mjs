/**
 * Post-processes what `capacitor-assets generate --android` writes for the
 * adaptive (API 26+) launcher icon. Run automatically by `npm run assets`.
 *
 * Two corrections:
 *
 * 1. The generator sets the <background> layer to the icon-background PNG
 *    inset by 16.7%, which leaves the outer margin of the 108dp adaptive canvas
 *    transparent. That margin is exactly what a launcher reveals when it scales
 *    or parallaxes the icon, so the brand square would show torn edges. A flat
 *    <color> background has no such margin and is what the platform expects.
 *
 * 2. It leaves @color/ic_launcher_background at the default #FFFFFF, which is
 *    unused once (1) is applied — but would flash white if anything else
 *    referenced it. Set it to the brand navy.
 *
 * Idempotent: safe to run repeatedly.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const res = resolve(here, '..', 'android', 'app', 'src', 'main', 'res');

// Keep in step with BG in generate-assets.mjs and the body gradient in
// apps/cms/src/app/layout.tsx.
const BRAND = '#01001F';

const ADAPTIVE = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" />
    </foreground>
</adaptive-icon>
`;

const COLOR = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BRAND}</color>
</resources>
`;

let touched = 0;

for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  const p = join(res, 'mipmap-anydpi-v26', name);
  if (!existsSync(p)) continue;
  if (readFileSync(p, 'utf8') !== ADAPTIVE) {
    writeFileSync(p, ADAPTIVE);
    console.log(`fix-adaptive-icon: rewrote mipmap-anydpi-v26/${name}`);
    touched++;
  }
}

const colorPath = join(res, 'values', 'ic_launcher_background.xml');
if (existsSync(colorPath) && readFileSync(colorPath, 'utf8') !== COLOR) {
  writeFileSync(colorPath, COLOR);
  console.log(`fix-adaptive-icon: ic_launcher_background -> ${BRAND}`);
  touched++;
}

if (touched === 0) console.log('fix-adaptive-icon: already current');
