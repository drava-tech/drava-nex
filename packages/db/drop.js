// Run via: node --env-file=../../.env drop.js  (from packages/db/)
import { Client } from 'pg';
import dns from 'dns';
import net from 'net';

function probe(ip, port) {
  return new Promise((resolvePromise) => {
    const socket = net.connect({ host: ip, port, timeout: 800 });
    const done = (ok) => { socket.destroy(); resolvePromise(ok); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function patchMultiHomeDns() {
  const candidates = (process.env.CMS_SERVER_HOSTS ?? '').split(',').map((ip) => ip.trim()).filter(Boolean);
  if (candidates.length === 0) return;

  let reachable = candidates[0];
  for (const ip of candidates) {
    if (await probe(ip, 5432)) { reachable = ip; break; }
  }

  const originalLookup = dns.lookup;
  dns.lookup = (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    if (hostname === 'cms-server') return cb(null, reachable, 4);
    return originalLookup(hostname, options, callback);
  };
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run via: node --env-file=../../.env drop.js');
  process.exit(1);
}

await patchMultiHomeDns();

const client = new Client({ connectionString: process.env.DATABASE_URL });
async function run() {
  await client.connect();
  await client.query('DROP TABLE IF EXISTS session CASCADE');
  console.log('Dropped session table');
  await client.end();
}
run().catch(console.error);
