"use server";

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const getConfigPath = () => {
  const configInApp = join(process.cwd(), "apps", "screens", "public", "config");
  return existsSync(configInApp)
    ? configInApp
    : join(process.cwd(), "..", "screens", "public", "config");
};

export async function readScreensJson() {
  const raw = await readFile(join(getConfigPath(), "screens.json"), "utf-8");
  return JSON.parse(raw);
}

export async function readContentsJson() {
  const raw = await readFile(join(getConfigPath(), "contents.json"), "utf-8");
  return JSON.parse(raw);
}

export async function writeScreensJson(data: object) {
  await writeFile(
    join(getConfigPath(), "screens.json"),
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

export async function writeContentsJson(data: object) {
  await writeFile(
    join(getConfigPath(), "contents.json"),
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}
