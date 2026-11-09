#!/usr/bin/env node
// Re-syncs packages/drava-world from the standalone drava-world repo
// (github.com/drava-tech/drava-world), which is the source of truth, so a
// change made there never has to be made twice. Same approach as
// tools/sync-drava-mosaic.mjs.
//
//   node tools/sync-drava-world.mjs [world path] [--ref <rev>] [--commit] [--watch]
//
//   world path   the drava-world checkout (default ../drava-world)
//   --ref <rev>  copy that commit's files instead of the working tree
//   --commit     commit the result in drava-nex (must be on NEX_BRANCH), with
//                the world commit's message; used by the post-commit hook
//   --watch      keep running and re-sync on every save in drava-world
//
// The git hooks in tools/githooks/drava-world run this on every drava-world
// commit and push drava-nex with it (turned on per clone, see that folder).
//
// It mirrors every file drava-world tracks in git, except the ones nex owns
// (NEX_OWNED below), then re-applies the nex-only edits. Nex serves Drava
// World under /drava-world/ (apps/cms/public/drava-world), not at the root as
// Vercel does, so:
//   - Vite builds it with base /drava-world/ (packages/drava-world/vite.config.js,
//     nex-owned), which covers the pages' <script>/<link> tags, CSS and
//     import.meta.env.BASE_URL;
//   - string paths in the code that start at the root and name one of its own
//     files or pages ("/zone1.glb", '/cms/logo.svg', "/assembly/") get the
//     /drava-world prefix;
//   - the zone router (/zone/<id>) and the trainer's '/' + model path are
//     rewritten exactly;
//   - drava-world's dependencies are copied into nex's package.json.
//
// If drava-world changes in a way these rules don't cover (a new page, a new
// way of building a root path, the router rewritten), it stops with an error
// naming the file, rather than shipping a page that can't load.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nexRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(nexRoot, "packages/drava-world");
const NEX_BRANCH = "sufiyan";
// What a sync may change in nex, and so what --commit commits.
const NEX_PATHS = ["packages/drava-world", "pnpm-lock.yaml"];

/** Where apps/cms serves the build; keep in step with packages/drava-world/vite.config.js. */
const BASE = "/drava-world/";
/** drava-world's pages, as its vite.config.js lists them; must match nex's vite.config.js. */
const PAGES = [
  "index.html",
  "cms/index.html",
  "cms/display.html",
  "push/index.html",
  "push/display.html",
  "assembly/index.html",
];

// Paths nex keeps its own version of (or doesn't need): never copied, never deleted.
const NEX_OWNED = [
  /^\./, // .gitignore, .env*, .agent/, .agents/, .gemini/, .gsd/, .vercel/ …
  /^package\.json$/,
  /^pnpm-(lock|workspace)\.yaml$/, // a nested workspace file would confuse nex's pnpm
  /^vite\.config\.js$/,
  /^vercel\.json$/,
  /^[^/]+\.(md|yaml|yml)$/i, // README, AGENTS, CLAUDE, model_capabilities …
  /^VERSION$/,
  /^(docs|scripts|adapters)\//, // notes, repo tooling, agent adapters: not part of the site
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
const worldRoot = resolve(args[0] ?? join(nexRoot, "../drava-world"));

class SyncError extends Error {}
const fail = (message) => {
  throw new SyncError(message);
};
const git = (cwd, args, opts = {}) => execFileSync("git", args, { cwd, encoding: "utf8", ...opts });
const lsZ = (out) => out.split("\0").filter(Boolean);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- Where drava-world's files come from ---------------------------------

// The working tree (what's on disk now), or one commit's files.
const source = ref
  ? {
      list: () => lsZ(git(worldRoot, ["ls-tree", "-r", "-z", "--name-only", ref])),
      // --filters gives the bytes a checkout would, line endings included.
      read: (path) => execFileSync("git", ["cat-file", "--filters", `${ref}:${path}`],
        { cwd: worldRoot, maxBuffer: 256 * 1024 * 1024 }),
    }
  : {
      list: () => lsZ(git(worldRoot, ["ls-files", "-z"]))
        .filter((p) => existsSync(join(worldRoot, p))),
      read: (path) => readFileSync(join(worldRoot, path)),
    };

// ---- The sync ---------------------------------------------------------------

function sync() {
  if (!existsSync(join(worldRoot, ".git"))) {
    fail(`${worldRoot} isn't a drava-world checkout.`);
  }
  const allFiles = source.list();
  if (!allFiles.includes("index.html") || !allFiles.includes("src/main.js")) {
    fail(`${worldRoot} doesn't look like drava-world (no index.html / src/main.js).`);
  }

  // Every page must be a Vite input in nex, or the build leaves it out.
  const worldVite = source.read("vite.config.js").toString("utf8");
  const worldPages = [...worldVite.matchAll(/['"]([\w./-]+\.html)['"]/g)].map((m) => m[1]).sort();
  const known = [...PAGES].sort();
  if (worldPages.join("|") !== known.join("|")) {
    fail(`drava-world's pages changed (its vite.config.js lists ${worldPages.join(", ")}). ` +
      "Update build.rollupOptions.input in packages/drava-world/vite.config.js, PAGES in " +
      "tools/sync-drava-world.mjs and the /drava-world rewrites in apps/cms/next.config.mjs to match.");
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

  // Files drava-world deleted or renamed.
  const removed = existsSync(pkgDir)
    ? lsZ(git(nexRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "packages/drava-world"]))
        .map((p) => p.slice("packages/drava-world/".length))
        .filter((p) => !isNexOwned(p) && !sourceSet.has(p) && existsSync(join(pkgDir, p)))
    : [];
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

  // An exact replacement that must apply; it's an error if drava-world changed the code around it.
  const exact = (path, from, to) => editText(path, (text) => {
    if (!text.includes(from)) {
      fail(`${path}: couldn't find the code to rewrite for nex:\n${from}\n` +
        "drava-world changed it; update the rule in drava-nex/tools/sync-drava-world.mjs.");
    }
    return text.replace(from, () => to); // a function, so "$" in `to` stays literal
  });

  // The zone router: / is the Welcome Zone, /zone/<id> the others.
  exact("src/main.js",
    "const zonePath = (id) => (id === 'welcome' ? '/' : `/zone/${id}`);",
    `const zonePath = (id) => (id === 'welcome' ? '${BASE}' : \`${BASE}zone/\${id}\`); // nex: served under ${BASE}`);
  exact("src/main.js",
    "location.pathname.match(/^\\/zone\\/([\\w-]+)\\/?$/)",
    `location.pathname.match(/^${escapeRe(BASE).replace(/\//g, "\\/")}zone\\/([\\w-]+)\\/?$/)`);
  // Root paths to drava-world's own files and pages: the top-level names in
  // public/ (served at the root) and the page folders.
  const roots = new Set();
  for (const p of sourceFiles) {
    if (p.startsWith("public/")) roots.add(p.split("/")[1]);
  }
  for (const page of PAGES) if (page.includes("/")) roots.add(page.split("/")[0]);
  const rootAlt = [...roots].map(escapeRe).sort((a, b) => b.length - a.length).join("|");
  const rootPath = new RegExp(`(["'\`])/(?=(?:${rootAlt})(?:[/"'\`?#]|$))`, "g");

  // A root path built from '/' plus a relative one, at the start of an
  // expression: load('/' + model), x = '/' + p, return '/' + p … (the trainer
  // does this for its step models). A '/' in the middle (a + '/' + b) joins
  // two parts and is left alone; the check below flags it for a look.
  const rootConcat = /([(=,:]\s*|\breturn\s+)(["'`])\/\2(\s*\+)/g;

  // A page folder on its own ("/cms/", '/assembly/') names that folder's
  // index.html. Point at the file: Next serves public/ by exact name and
  // redirects "/x/" to "/x", which resolves the page's relative paths against
  // the wrong folder (the trainer then shows no model).
  const pageDirs = [...new Set(PAGES.filter((p) => p.includes("/")).map((p) => p.split("/")[0]))];
  const pageDir = new RegExp(`(["'\`])${escapeRe(BASE)}(${pageDirs.map(escapeRe).join("|")})/\\1`, "g");

  const codeFiles = sourceFiles.filter((p) => p.startsWith("src/") && /\.(m?js|json)$/.test(p));
  for (const path of codeFiles) {
    editText(path, (text) => text
      .replace(rootPath, (_, q) => `${q}${BASE}`)
      .replace(rootConcat, (_, before, q, plus) => `${before}${q}${BASE}${q}${plus}`)
      .replace(pageDir, (_, q, dir) => `${q}${BASE}${dir}/index.html${q}`));
  }

  // Anything still building a root path some other way, or routing on the
  // address outside the zone router, wouldn't work under /drava-world/.
  const leftovers = [];
  const bareSlashConcat = /(["'`])\/\1\s*\+/; // '/' + something
  for (const path of codeFiles) {
    readFileSync(join(pkgDir, path), "utf8").split(/\r?\n/).forEach((line, i) => {
      const where = `  ${path}:${i + 1}: ${line.trim()}`;
      if (bareSlashConcat.test(line)) leftovers.push(where);
      else if (path !== "src/main.js" && /location\.pathname|["'`]\/zone\//.test(line)) leftovers.push(where);
    });
  }
  // Pages: Vite prefixes <script src> and <link href>; any other root link isn't.
  for (const page of PAGES) {
    readFileSync(join(pkgDir, page), "utf8").split(/\r?\n/).forEach((line, i) => {
      const stripped = line
        .replace(/<script[^>]*\bsrc="\/src\/[^"]*"[^>]*>/g, "")
        .replace(/<link[^>]*\bhref="\/[^"]*"[^>]*>/g, "");
      if (new RegExp(`(?:href|src|action)="/(?:${rootAlt})\\b`).test(stripped)) {
        leftovers.push(`  ${page}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  if (leftovers.length) {
    fail("these lines build a path from the site root in a way the nex rules don't cover, " +
      "so they'd break under /drava-world/. Add a rule to drava-nex/tools/sync-drava-world.mjs:\n" +
      leftovers.join("\n"));
  }

  // 3. Dependencies.
  const worldPkg = JSON.parse(source.read("package.json").toString("utf8"));
  const nexPkgPath = join(pkgDir, "package.json");
  const nexPkgRaw = readFileSync(nexPkgPath, "utf8");
  const nexPkg = JSON.parse(nexPkgRaw);
  for (const field of ["dependencies", "devDependencies"]) {
    if (worldPkg[field]) nexPkg[field] = worldPkg[field];
    else delete nexPkg[field];
  }
  const nexPkgNext = JSON.stringify(nexPkg, null, 2) + "\n";
  const depsChanged = nexPkgNext !== nexPkgRaw.replace(/\r\n/g, "\n");
  if (depsChanged) writeFileSync(nexPkgPath, nexPkgNext);

  return { files: sourceFiles.length, removed, depsChanged };
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
  const subject = git(worldRoot, ["log", "-1", "--format=%s", rev]).trim();
  const sha = git(worldRoot, ["rev-parse", "--short", rev]).trim();
  // Only these paths, so anything else staged in nex is left alone.
  git(nexRoot, ["commit", "-q", "-m", `sync Drava World: ${subject}`,
    "-m", `From drava-tech/drava-world@${sha}.`, "--", ...NEX_PATHS]);
  return git(nexRoot, ["rev-parse", "--short", "HEAD"]).trim();
}

// ---- Run ------------------------------------------------------------------------

const log = (message) => console.log(`[sync-drava-world] ${message}`);

function runOnce() {
  const result = sync();
  const parts = [`mirrored ${result.files} files from ${ref ? `drava-world@${ref}` : worldRoot}`];
  if (result.removed.length) parts.push(`removed ${result.removed.join(", ")}`);
  if (result.depsChanged && !shouldCommit) parts.push("dependencies changed: run `pnpm install` in drava-nex");
  log(parts.join("; "));
  return result;
}

try {
  if (shouldCommit) {
    const branch = nexBranch();
    if (branch !== NEX_BRANCH) {
      fail(`drava-nex is on '${branch}', not '${NEX_BRANCH}', so it wasn't touched. ` +
        `Check out ${NEX_BRANCH} there and run: pnpm sync:drava-world --ref HEAD --commit`);
    }
  }
  const result = runOnce();
  if (shouldCommit) {
    const commit = commitInNex(result.depsChanged);
    log(commit ? `committed in drava-nex (${NEX_BRANCH}): ${commit}` : "drava-nex already matches");
  }
} catch (err) {
  if (!(err instanceof SyncError)) throw err;
  console.error(`[sync-drava-world] ${err.message}`);
  if (!shouldWatch) process.exit(1);
}

if (shouldWatch) {
  log(`watching ${worldRoot} (Ctrl+C to stop)`);
  const ignored = /^(\.git|node_modules|dist|\.vercel)([\\/]|$)/;
  let timer;
  watch(worldRoot, { recursive: true }, (_, file) => {
    if (!file || ignored.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        runOnce();
      } catch (err) {
        if (!(err instanceof SyncError)) throw err;
        console.error(`[sync-drava-world] ${err.message}`);
      }
    }, 300);
  });
}
