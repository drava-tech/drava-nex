import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

// Load environment variables from the nearest ancestor .env (local dev). This is
// a side-effect module and MUST be imported before @platform/db / ./lib/auth,
// which read process.env at import time. Keep its only imports to node builtins.
try {
  let currentDir = process.cwd();
  let foundEnvPath = '';
  while (true) {
    const checkPath = resolve(currentDir, '.env');
    if (existsSync(checkPath)) {
      foundEnvPath = checkPath;
      break;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  if (foundEnvPath) {
    const envContent = readFileSync(foundEnvPath, 'utf-8');
    for (const line of envContent.split(/\r?\n/)) {
      if (line.trim().startsWith('#') || !line.includes('=')) continue;
      const firstEq = line.indexOf('=');
      const key = line.slice(0, firstEq).trim();
      let val = line.slice(firstEq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  }
} catch (e) {
  console.warn('[api] Failed to load .env file:', e);
}
