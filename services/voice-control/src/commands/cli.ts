/**
 * Try the command engine without a microphone or the CMS:
 *   pnpm match "set the lights to fifty percent"
 * Prints the match (or why it was rejected) and the CMS request it would send.
 */
import { join } from "node:path";
import { loadConfig, SERVICE_ROOT } from "../config/config.js";
import { loadRegistry } from "./registry.js";
import { matchCommand } from "./matcher.js";
import { resolveCommand } from "./resolve.js";

const text = process.argv.slice(2).join(" ");
if (!text) {
  console.error('Usage: pnpm match "turn on the lights"');
  process.exit(1);
}

const config = loadConfig();
const registry = loadRegistry(join(SERVICE_ROOT, "config", "commands.json"));
const match = matchCommand(text, registry, config.matching);
console.log(JSON.stringify({ ...match, command: undefined }, null, 2));
if (match.ok) console.log(JSON.stringify(resolveCommand(match, config.defaults), null, 2));
