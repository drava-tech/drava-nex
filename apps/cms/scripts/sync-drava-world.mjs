// Copies the built Drava World (packages/drava-world/dist) into
// public/drava-world, where Next serves it as static files for the
// "drava-world" template's iframe. Same job as sync-drava-mosaic.mjs.
//
// Runs before `next dev` and `next build`. Turbo builds Drava World first
// (@platform/drava-world is a workspace dependency, and both tasks depend on
// ^build). The copy is generated output and gitignored.
//
// --optional: warn instead of failing when it hasn't been built, so
// `next dev` still starts on its own (the template then shows a 404 page).

import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../../packages/drava-world/dist");
const target = resolve(here, "../public/drava-world");
const optional = process.argv.includes("--optional");

if (!existsSync(resolve(source, "index.html"))) {
  const message =
    "[drava-world] packages/drava-world/dist is missing — run " +
    "`pnpm --filter @platform/drava-world build` first.";
  if (optional) {
    console.warn(message);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`[drava-world] synced ${source} → ${target}`);
