"use server";

import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const CONFIG_PATH = join(
  process.cwd(),
  "..",
  "screens",
  "public",
  "config"
);

export async function readScreensJson() {
  const raw = await readFile(join(CONFIG_PATH, "screens.json"), "utf-8");
  return JSON.parse(raw);
}

export async function readContentsJson() {
  const raw = await readFile(join(CONFIG_PATH, "contents.json"), "utf-8");
  return JSON.parse(raw);
}

export async function writeScreensJson(data: object) {
  await writeFile(
    join(CONFIG_PATH, "screens.json"),
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

export async function writeContentsJson(data: object) {
  await writeFile(
    join(CONFIG_PATH, "contents.json"),
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}
