/**
 * @platform/db — Multi-subnet host resolver
 *
 * The `.250` box is reachable at different IPs depending on which Wi-Fi
 * extender node a device is associated with. Patches `dns.lookup` so the
 * hostname `cms-server` probes every IP in CMS_SERVER_HOSTS and resolves to
 * whichever one is actually reachable, instead of a single fixed IP.
 */

import dns from "dns";
import net from "net";

const HOSTNAME = "cms-server";
const PROBE_PORT = 5432;
const PROBE_TIMEOUT_MS = 800;

function probe(ip: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = net.connect({ host: ip, port: PROBE_PORT, timeout: PROBE_TIMEOUT_MS });
    const done = (ok: boolean) => {
      socket.destroy();
      resolvePromise(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

let resolvedIpPromise: Promise<string> | null = null;

async function resolveReachableIp(candidates: string[]): Promise<string> {
  for (const ip of candidates) {
    if (await probe(ip)) return ip;
  }
  return candidates[0] as string;
}

export function patchMultiHomeDns(): void {
  const candidates = (process.env["CMS_SERVER_HOSTS"] ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);

  if (candidates.length === 0) return;

  const originalLookup = dns.lookup;
  dns.lookup = function (this: any, hostname: string, options: any, callback: any) {
    let cb = callback;
    let opt = options;
    if (typeof options === "function") {
      cb = options;
      opt = {};
    }

    if (hostname === HOSTNAME) {
      if (!resolvedIpPromise) {
        resolvedIpPromise = resolveReachableIp(candidates);
      }
      resolvedIpPromise.then((ip) => {
        if (opt && opt.all) {
          cb(null, [{ address: ip, family: 4 }]);
        } else {
          cb(null, ip, 4);
        }
      });
      return;
    }

    return (originalLookup as any).call(this, hostname, options, cb);
  } as any;
}
