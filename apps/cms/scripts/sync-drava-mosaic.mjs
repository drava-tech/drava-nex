// Copies the built Drava Mosaic (packages/drava-mosaic/dist) into
// public/drava-mosaic, where Next serves it as static files for the
// "drava-mosaic" template's iframe.
//
// Runs before `next dev` and `next build`. Turbo builds the studio first
// (@platform/drava-mosaic is a workspace dependency, and both tasks depend
// on ^build). The copy is generated output and gitignored.
//
// --optional: warn instead of failing when the studio hasn't been built, so
// `next dev` still starts on its own (the template then shows a 404 page).

import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../../packages/drava-mosaic/dist");
const target = resolve(here, "../public/drava-mosaic");
const optional = process.argv.includes("--optional");

if (!existsSync(resolve(source, "velocitymapping.html"))) {
  const message =
    "[drava-mosaic] packages/drava-mosaic/dist is missing — run " +
    "`pnpm --filter @platform/drava-mosaic build` first.";
  if (optional) {
    console.warn(message);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`[drava-mosaic] synced ${source} → ${target}`);
