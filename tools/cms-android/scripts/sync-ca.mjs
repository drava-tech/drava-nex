/**
 * Keeps the Android shell in sync with the CMS deployment. Run before every
 * `cap sync` (npm run sync does this for you).
 *
 * 1. Copies the mkcert root CA from infra/nginx/certs/rootCA.crt into the
 *    Android project as a raw resource, so the APK trusts the LAN cert with no
 *    warning interstitial. Copied rather than committed twice by hand, so the
 *    two can never drift when the cert is rotated.
 * 2. Rewrites SERVER_URL in www/index.html (the offline fallback page) to match
 *    server.url in capacitor.config.ts, for the same reason.
 * 3. Prints the leaf cert's expiry, because an expired cert breaks the app on
 *    every installed device at once and the failure looks like a network fault.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const repoRoot = resolve(projectRoot, '../..');

const CERTS_DIR = join(repoRoot, 'infra', 'nginx', 'certs');
const ROOT_CA_SRC = join(CERTS_DIR, 'rootCA.crt');
const LEAF_SRC = join(CERTS_DIR, 'fullchain.pem');
const RAW_DIR = join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'raw');
const ROOT_CA_DEST = join(RAW_DIR, 'ec_cms_root_ca.crt');

const CONFIG = join(projectRoot, 'capacitor.config.ts');
const FALLBACK = join(projectRoot, 'www', 'index.html');

function fail(msg) {
  console.error(`sync-ca: ${msg}`);
  process.exit(1);
}

// ─── 1. Root CA → res/raw ────────────────────────────────────────────────────
if (!existsSync(ROOT_CA_SRC)) fail(`root CA not found at ${ROOT_CA_SRC}`);

if (!existsSync(join(projectRoot, 'android'))) {
  console.warn('sync-ca: android/ not present yet — run `npx cap add android` first.');
} else {
  mkdirSync(RAW_DIR, { recursive: true });
  const ca = readFileSync(ROOT_CA_SRC);
  const changed = !existsSync(ROOT_CA_DEST) || !readFileSync(ROOT_CA_DEST).equals(ca);
  if (changed) {
    writeFileSync(ROOT_CA_DEST, ca);
    console.log('sync-ca: updated res/raw/ec_cms_root_ca.crt');
  } else {
    console.log('sync-ca: res/raw/ec_cms_root_ca.crt already current');
  }
}

// ─── 2. server.url → offline fallback page ───────────────────────────────────
const configSrc = readFileSync(CONFIG, 'utf8');
const urlMatch = configSrc.match(/^\s*url:\s*['"]([^'"]+)['"]/m);
if (!urlMatch) fail('could not read server.url from capacitor.config.ts');
const serverUrl = urlMatch[1];

const fallbackSrc = readFileSync(FALLBACK, 'utf8');
const patched = fallbackSrc.replace(
  /var SERVER_URL = '[^']*';/,
  `var SERVER_URL = '${serverUrl}';`,
);
if (patched !== fallbackSrc) {
  writeFileSync(FALLBACK, patched);
  console.log(`sync-ca: offline page now points at ${serverUrl}`);
}

// ─── 3. Cert expiry warning ──────────────────────────────────────────────────
if (existsSync(LEAF_SRC)) {
  const leaf = new X509Certificate(readFileSync(LEAF_SRC));
  const daysLeft = Math.floor((new Date(leaf.validTo) - Date.now()) / 86_400_000);
  console.log(`sync-ca: server cert valid to ${leaf.validTo} (${daysLeft} days)`);
  console.log(`sync-ca: cert SANs — ${leaf.subjectAltName}`);
  if (daysLeft < 60) {
    console.warn('sync-ca: WARNING — cert expires soon. Regenerate with mkcert, then rebuild this APK.');
  }
  const host = new URL(serverUrl).hostname;
  if (!String(leaf.subjectAltName ?? '').includes(host)) {
    console.warn(`sync-ca: WARNING — ${host} is not a SAN on the server cert; the app will show a TLS error.`);
  }
}
