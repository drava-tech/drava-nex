#!/usr/bin/env node
// Re-syncs packages/drava-mosaic from the standalone drava-mosaic repo
// (github.com/drava-tech/drava-mosaic), which is the source of truth, so a
// change made there never has to be made twice.
//
//   node tools/sync-drava-mosaic.mjs [mosaic path] [--ref <rev>] [--commit] [--watch]
//
//   mosaic path  the drava-mosaic checkout (default ../drava-mosaic)
//   --ref <rev>  copy that commit's files instead of the working tree
//   --commit     commit the result in drava-nex (must be on NEX_BRANCH), with
//                the mosaic commit's message; used by mosaic's post-commit hook
//   --watch      keep running and re-sync on every save in mosaic
//
// drava-mosaic's git hooks (.githooks/) run this on every commit and push
// drava-nex with it, so nex follows mosaic without anyone copying by hand.
//
// It mirrors every file mosaic tracks in git, except the ones nex owns
// (NEX_OWNED below), then re-applies the nex-only edits:
//   - fetches of api/wind, api/weather and api/attendance go to /api/drava-mosaic/*
//     (apps/api/src/routes/drava-mosaic.ts) instead of mosaic's Vercel functions;
//   - videos stream through /api/drava-mosaic/video?name=<file> instead of the
//     public R2 URL, so WebGL can read their frames same-origin;
//   - any .mp4 the pages name is added to VIDEO_NAMES in that route;
//   - mosaic's dependencies are copied into nex's package.json.
//
// If mosaic changes in a way these rules don't cover (a new R2 URL, a new API
// call, a new page), it stops with an error naming the file, rather than
// shipping a page that can't load.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nexRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(nexRoot, "packages/drava-mosaic");
const apiRoute = join(nexRoot, "apps/api/src/routes/drava-mosaic.ts");
const NEX_BRANCH = "sufiyan";
// What a sync may change in nex, and so what --commit commits.
const NEX_PATHS = ["packages/drava-mosaic", "apps/api/src/routes/drava-mosaic.ts", "pnpm-lock.yaml"];

const R2 = "https://pub-085468ffd2bd40868c645940c8033bb2.r2.dev";
const API_ROUTES = ["wind", "weather", "attendance"];
const PAGES = ["velocitymapping.html", "flight-garden/index.html", "world-clock/index.html"];

// Paths nex keeps its own version of (or doesn't need): never copied, never deleted.
const NEX_OWNED = [
  /^\./, // .gitignore, .githooks/, .github/, .vercel/ …
  /^api\//, // mosaic's Vercel functions; nex has its own Hono routes
  /^package(-lock)?\.json$/,
  /^vite\.config\.js$/,
  /^vercel\.json$/,
  /^(README|readme)/,
];
const isNexOwned = (path) => NEX_OWNED.some((re) => re.test(path));

// ---- Arguments ----------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const option = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args.splice(i, 2)[1];
};
const shouldCommit = flag("--commit");
const shouldWatch = flag("--watch");
const ref = option("--ref");
const mosaicRoot = resolve(args[0] ?? join(nexRoot, "../drava-mosaic"));

class SyncError extends Error {}
const fail = (message) => {
  throw new SyncError(message);
};
const git = (cwd, args, opts = {}) => execFileSync("git", args, { cwd, encoding: "utf8", ...opts });
const lsZ = (out) => out.split("\0").filter(Boolean);

// ---- Where mosaic's files come from ---------------------------------------

// The working tree (what's on disk now), or one commit's files.
const source = ref
  ? {
      list: () => lsZ(git(mosaicRoot, ["ls-tree", "-r", "-z", "--name-only", ref])),
      // --filters gives the bytes a checkout would, line endings included.
      read: (path) => execFileSync("git", ["cat-file", "--filters", `${ref}:${path}`],
        { cwd: mosaicRoot, maxBuffer: 256 * 1024 * 1024 }),
    }
  : {
      list: () => lsZ(git(mosaicRoot, ["ls-files", "-z"]))
        .filter((p) => existsSync(join(mosaicRoot, p))),
      read: (path) => readFileSync(join(mosaicRoot, path)),
    };

// ---- The sync ---------------------------------------------------------------

function sync() {
  if (!existsSync(join(mosaicRoot, ".git"))) {
    fail(`${mosaicRoot} isn't a drava-mosaic checkout.`);
  }
  const allFiles = source.list();
  if (!allFiles.includes("velocitymapping.html")) {
    fail(`${mosaicRoot} doesn't look like drava-mosaic (no velocitymapping.html).`);
  }

  // 1. Mirror the files (only rewriting ones whose bytes differ).
  const sourceFiles = allFiles.filter((p) => !isNexOwned(p));
  const sourceSet = new Set(sourceFiles);
  for (const path of sourceFiles) {
    const to = join(pkgDir, path);
    const bytes = source.read(path);
    if (existsSync(to) && readFileSync(to).equals(bytes)) continue;
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, bytes);
  }

  // Files mosaic deleted or renamed.
  const removed = lsZ(git(nexRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "packages/drava-mosaic"]))
    .map((p) => p.slice("packages/drava-mosaic/".length))
    .filter((p) => !isNexOwned(p) && !sourceSet.has(p) && existsSync(join(pkgDir, p)));
  for (const path of removed) rmSync(join(pkgDir, path), { force: true });

  // 2. Re-apply the nex-only edits.

  // Edits run on LF text; the file keeps whichever line endings it had.
  const editText = (path, edit) => {
    const file = join(pkgDir, path);
    const raw = readFileSync(file, "utf8");
    const crlf = raw.includes("\r\n");
    const before = crlf ? raw.replace(/\r\n/g, "\n") : raw;
    const after = edit(before);
    if (after !== before) writeFileSync(file, crlf ? after.replace(/\n/g, "\r\n") : after);
  };

  // An exact replacement that must apply; it's an error if mosaic changed the code around it.
  const exact = (path, from, to) => editText(path, (text) => {
    if (!text.includes(from)) {
      fail(`${path}: couldn't find the code to rewrite for nex:\n${from}\n` +
        "Mosaic changed it; update the rule in drava-nex/tools/sync-drava-mosaic.mjs.");
    }
    return text.replace(from, to);
  });

  // Flight Garden: no public bucket, and the API takes object names, not ids.
  exact("flight-garden/main.js",
    `const R2_PUBLIC_BASE = "${R2}";`,
    `const R2_PUBLIC_BASE = ""; // nex: empty, so every clip goes through /api/drava-mosaic/video.`);
  exact("flight-garden/main.js",
    `    if (R2_PUBLIC_BASE) {
      const path = VIDEO_PATHS[videoId];
      if (path) return R2_PUBLIC_BASE.replace(/\\/$/, "") + "/" + path;
    }
    return \`/api/garden-video?id=\${encodeURIComponent(videoId)}\`;`,
    `    const path = VIDEO_PATHS[videoId];
    if (R2_PUBLIC_BASE && path) return R2_PUBLIC_BASE.replace(/\\/$/, "") + "/" + path;
    // nex: the API serves object names (shared with the studio page), not ids.
    return \`/api/drava-mosaic/video?name=\${encodeURIComponent(path ?? videoId)}\`;`);

  // Studio: same-origin video stream, keyed by object name.
  exact("velocitymapping.html",
    `const VIDEO_BASE_URL = '${R2}/';`,
    `const VIDEO_BASE_URL = '/api/drava-mosaic/video?name='; // nex: the API streams videos same-origin so WebGL can read the frames.`);
  exact("velocitymapping.html",
    `return VIDEO_BASE_URL + src.replace(/^\\/+/, '');`,
    `return VIDEO_BASE_URL + encodeURIComponent(src.replace(/^\\/+/, '').split('?')[0]);`);

  const textFiles = sourceFiles.filter((p) => /\.(m?js|html|css)$/.test(p) && !p.startsWith("public/"));
  for (const path of textFiles) {
    editText(path, (text) => text
      // A full R2 URL to one clip, e.g. "…r2.dev/particle_fabric.mp4".
      .replace(new RegExp(`(["'\`])${R2.replace(/\./g, "\\.")}/([\\w.-]+\\.mp4)\\1`, "g"),
        (_, q, name) => `${q}/api/drava-mosaic/video?name=${name}${q}`)
      // Fetches of mosaic's functions: "api/wind", '../api/weather', "/api/attendance" …
      .replace(new RegExp(`(["'\`])(?:\\.\\.?/|/)?api/(${API_ROUTES.join("|")})\\b`, "g"),
        (_, q, route) => `${q}/api/drava-mosaic/${route}`)
      // Comments that name the Vercel function.
      .replace("via api/wind.js,", "via the nex API (/api/drava-mosaic/wind),"));
  }

  // Nothing may still point at the bucket or a Vercel function nex doesn't have.
  // /api/log is Flight Garden's best-effort error beacon (its failure is ignored).
  const vercelApi = /["'`](?:\.\.?\/|\/)?api\/(?!drava-mosaic\/|log\?)[\w-]+/;
  const leftovers = [];
  for (const path of textFiles) {
    readFileSync(join(pkgDir, path), "utf8").split(/\r?\n/).forEach((line, i) => {
      if (line.includes(R2) || vercelApi.test(line)) leftovers.push(`  ${path}:${i + 1}: ${line.trim()}`);
    });
  }
  if (leftovers.length) {
    fail("these lines still reach mosaic's R2 bucket or Vercel functions, which nex " +
      "doesn't serve. Add a rule to drava-nex/tools/sync-drava-mosaic.mjs (and a route to " +
      `apps/api/src/routes/drava-mosaic.ts if it's a new API):\n${leftovers.join("\n")}`);
  }

  // Every page must be a Vite input, or the build leaves it out.
  const newPages = sourceFiles
    .filter((p) => p.endsWith(".html") && !p.startsWith("public/") && !PAGES.includes(p));
  if (newPages.length) {
    fail(`new page(s) ${newPages.join(", ")}: add them to build.rollupOptions.input in ` +
      "packages/drava-mosaic/vite.config.js and to PAGES in tools/sync-drava-mosaic.mjs.");
  }

  // 3. Videos the API may stream.
  const videoNames = new Set();
  for (const path of textFiles) {
    for (const [name] of readFileSync(join(pkgDir, path), "utf8").matchAll(/[\w-]+\.mp4\b/g)) {
      videoNames.add(name);
    }
  }
  const routeText = readFileSync(apiRoute, "utf8");
  const listMatch = routeText.match(/const VIDEO_NAMES = new Set\(\[\r?\n([\s\S]*?)\]\);/);
  if (!listMatch) fail(`couldn't find VIDEO_NAMES in ${apiRoute}.`);
  const newVideos = [...videoNames].filter((n) => !listMatch[1].includes(`"${n}"`)).sort();
  if (newVideos.length) {
    const eol = routeText.includes("\r\n") ? "\r\n" : "\n";
    const added = newVideos.map((n) => `  "${n}",${eol}`).join("");
    writeFileSync(apiRoute, routeText.replace(listMatch[0], listMatch[0].replace("]);", `${added}]);`)));
  }

  // 4. Dependencies.
  const mosaicPkg = JSON.parse(source.read("package.json").toString("utf8"));
  const nexPkgPath = join(pkgDir, "package.json");
  const nexPkgRaw = readFileSync(nexPkgPath, "utf8");
  const nexPkg = JSON.parse(nexPkgRaw);
  for (const field of ["dependencies", "devDependencies"]) {
    if (mosaicPkg[field]) nexPkg[field] = mosaicPkg[field];
    else delete nexPkg[field];
  }
  const nexPkgNext = JSON.stringify(nexPkg, null, 2) + "\n";
  const depsChanged = nexPkgNext !== nexPkgRaw.replace(/\r\n/g, "\n");
  if (depsChanged) writeFileSync(nexPkgPath, nexPkgNext);

  return { files: sourceFiles.length, removed, newVideos, depsChanged };
}

// ---- Committing in nex --------------------------------------------------------

function nexBranch() {
  return git(nexRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
}

function commitInNex(depsChanged) {
  if (depsChanged) {
    execFileSync("pnpm", ["install", "--lockfile-only"], { cwd: nexRoot, stdio: "inherit", shell: true });
  }
  git(nexRoot, ["add", "-A", "--", ...NEX_PATHS]);
  if (!git(nexRoot, ["diff", "--cached", "--name-only", "--", ...NEX_PATHS]).trim()) {
    return null; // nex already matches
  }
  const rev = ref ?? "HEAD";
  const subject = git(mosaicRoot, ["log", "-1", "--format=%s", rev]).trim();
  const sha = git(mosaicRoot, ["rev-parse", "--short", rev]).trim();
  // Only these paths, so anything else staged in nex is left alone.
  git(nexRoot, ["commit", "-q", "-m", `sync Drava Mosaic: ${subject}`,
    "-m", `From drava-tech/drava-mosaic@${sha}.`, "--", ...NEX_PATHS]);
  return git(nexRoot, ["rev-parse", "--short", "HEAD"]).trim();
}

// ---- Run ------------------------------------------------------------------------

const log = (message) => console.log(`[sync-drava-mosaic] ${message}`);

function runOnce() {
  const result = sync();
  const parts = [`mirrored ${result.files} files from ${ref ? `drava-mosaic@${ref}` : mosaicRoot}`];
  if (result.removed.length) parts.push(`removed ${result.removed.join(", ")}`);
  if (result.newVideos.length) parts.push(`added to VIDEO_NAMES: ${result.newVideos.join(", ")}`);
  if (result.depsChanged && !shouldCommit) parts.push("dependencies changed: run `pnpm install` in drava-nex");
  log(parts.join("; "));
  return result;
}

try {
  if (shouldCommit) {
    const branch = nexBranch();
    if (branch !== NEX_BRANCH) {
      fail(`drava-nex is on '${branch}', not '${NEX_BRANCH}', so it wasn't touched. ` +
        `Check out ${NEX_BRANCH} there and run: pnpm sync:drava-mosaic --ref HEAD --commit`);
    }
  }
  const result = runOnce();
  if (shouldCommit) {
    const commit = commitInNex(result.depsChanged);
    log(commit ? `committed in drava-nex (${NEX_BRANCH}): ${commit}` : "drava-nex already matches");
  }
} catch (err) {
  if (!(err instanceof SyncError)) throw err;
  console.error(`[sync-drava-mosaic] ${err.message}`);
  if (!shouldWatch) process.exit(1);
}

if (shouldWatch) {
  log(`watching ${mosaicRoot} (Ctrl+C to stop)`);
  const ignored = /^(\.git|node_modules|dist|\.vercel)([\\/]|$)/;
  let timer;
  watch(mosaicRoot, { recursive: true }, (_, file) => {
    if (!file || ignored.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        runOnce();
      } catch (err) {
        if (!(err instanceof SyncError)) throw err;
        console.error(`[sync-drava-mosaic] ${err.message}`);
      }
    }, 300);
  });
}
