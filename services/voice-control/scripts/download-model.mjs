// Downloads + unpacks the Vosk English model into ./models (gitignored).
// Uses Windows' built-in tar.exe (bsdtar, reads .zip) so no unzip dependency.
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MODEL = process.argv[2] ?? "vosk-model-small-en-us-0.15";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "models");
const target = join(root, MODEL);

if (existsSync(target)) {
  console.log(`Model already present: ${target}`);
  process.exit(0);
}
mkdirSync(root, { recursive: true });

const url = `https://alphacephei.com/vosk/models/${MODEL}.zip`;
const zip = join(root, `${MODEL}.zip`);
if (!existsSync(zip)) {
  console.log(`Downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  // Download to .part and rename, so an interrupted download is never reused.
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${zip}.part`));
  renameSync(`${zip}.part`, zip);
}

// Explicit System32 path: Git-for-Windows' GNU tar may shadow it on PATH, and
// it can't read .zip (and treats "J:\..." as a remote host).
const tar =
  process.platform === "win32" ? join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe") : "tar";
execFileSync(tar, ["-xf", zip, "-C", root], { stdio: "inherit" });
rmSync(zip);
console.log(`Model ready: ${target}`);
