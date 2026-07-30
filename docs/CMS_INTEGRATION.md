# CMS Integration — Tuya Cloud IR (Node.js)

Control the Crabtree/Tuya Smart IR hub (2 ACs, TV, soundbar) **directly from your
CMS** by calling the Tuya cloud IR API. No Python, no repo — just two HTTP calls
signed with the Tuya credentials.

Every endpoint, body, and device ID below was verified live against the real hub.

---

## 1. What you need (get these from the site owner, securely)

| Value | Where it comes from | Sensitive |
|-------|--------------------|-----------|
| `TUYA_ACCESS_ID` | Tuya IoT project "Access ID / Client ID" | identifier |
| `TUYA_ACCESS_SECRET` | Tuya IoT project "Access Secret" | 🔴 **secret** |
| Base URL | region `in` → `https://openapi.tuyain.com` | no |

The Access ID/Secret belong to the Tuya IoT Cloud project the hub is linked to,
with the **"IR Control Hub Open Service"** API subscribed. Don't commit the
secret; load both from CMS env vars.

---

## 2. Auth — use the official SDK (don't hand-roll signing)

Tuya signs every request with an HMAC-SHA256 token flow. Reimplementing it is
error-prone, so use Tuya's official Node connector, which handles the token +
signing for you:

```bash
npm install @tuya/tuya-connector-nodejs
```

---

## 3. Drop-in module: `tuyaIR.js`

```js
// tuyaIR.js — Tuya cloud IR control for the CMS. Needs @tuya/tuya-connector-nodejs.
const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

const HUB = 'd7100900af2728b91bn2qw';

const tuya = new TuyaContext({
  baseUrl: 'https://openapi.tuyain.com',
  accessKey: process.env.TUYA_ACCESS_ID,
  secretKey: process.env.TUYA_ACCESS_SECRET,
});

async function call(path, body) {
  const res = await tuya.request({ method: 'POST', path, body });
  if (!res.success) throw new Error(`Tuya IR failed: ${res.msg} (code ${res.code})`);
  return res;
}

// --- AC: send the FULL state every time (the AC transmits its whole state) ---
// mode: cool0 heat1 auto2 fan3 dry4   wind: auto0 low1 mid2 high3
function acCommand(acRemoteId, { power, mode, temp, wind }) {
  return call(`/v2.0/infrareds/${HUB}/air-conditioners/${acRemoteId}/scenes/command`,
              { power, mode, temp, wind });
}

// --- TV / soundbar: one key press ---
function remoteKey(remoteId, categoryId, remoteIndex, key) {
  return call(`/v2.0/infrareds/${HUB}/remotes/${remoteId}/command`,
              { category_id: categoryId, remote_index: remoteIndex, key });
}

module.exports = { acCommand, remoteKey };
```

Usage:

```js
const { acCommand, remoteKey } = require('./tuyaIR');

// Air conditioner "Air" -> cool, 24°C, auto fan, ON
await acCommand('d7b14177089fe7d3f75rqe', { power: 1, mode: 0, temp: 24, wind: 0 });

// TV power, soundbar volume up
await remoteKey('d7d74af8f0b7a3a5c24ca6', 2, 692, 'Power');
await remoteKey('d746e7d41e962b00dd0jhl', 7, 417259975, 'Volume+');
```

> Not using Node? The same paths and JSON bodies work from any language — you
> just implement Tuya's request signature (or use a Tuya SDK for your language).

---

## 4. Device registry

Device IDs are identifiers, not secrets (useless without the signed credentials).

### Air conditioners — `acCommand(id, { power, mode, temp, wind })`
| Name | id | temp range |
|------|-----|-----------|
| Air | `d7b14177089fe7d3f75rqe` | 16–30 |
| Experience Center Hall AC | `d73ea59a396b84072boahv` | 16–30 |

`mode`: `cool`=0 `heat`=1 `auto`=2 `fan`=3 `dry`=4 · `wind`: `auto`=0 `low`=1 `mid`=2 `high`=3 · `power`: 0/1

### Remotes — `remoteKey(id, category_id, remote_index, key)`
| Name | id | category_id | remote_index | working keys |
|------|-----|-------------|--------------|--------------|
| TV | `d7d74af8f0b7a3a5c24ca6` | 2 | 692 | `Power` `Volume+` `Volume-` `Channel+` `Channel-` `Up` `Down` `Left` `Right` `OK` `Menu` |
| Soundbar | `d746e7d41e962b00dd0jhl` | 7 | 417259975 | `Volume+` `Volume-` `Play` `Pause` `Previous` `Next` |

Only the listed keys have IR codes in this hub's matched codebook — other keys
return "command or value not support". (TV `mute`/`source`/`input` and soundbar
`power` are not available; add them later via DIY-learning in the Smart Life app.)

---

## 5. Gotchas (read before you ship)

- **Hub must be online.** If the hub loses WiFi/power, every call returns
  `设备离线` / *device offline*. Surface this to the CMS user as "hub offline —
  check power/WiFi", not a raw error.
- **AC needs the full state each call.** There is no "just change temp" — the IR
  frame carries power+mode+temp+wind together. Track the current state per AC in
  the CMS and resend all four fields on every change (e.g. keep `{power,mode,temp,wind}`
  in the DB and mutate one field before sending).
- **Success shape:** `{ success: true, result: true }`. On failure, `success:false`
  with a `msg` — always check and surface `msg`.
- **Token** is cached and auto-refreshed by the SDK. If you hand-roll auth,
  tokens expire (~2h) — cache and refresh.
- **Latency:** each call is a round-trip to Tuya's cloud (~100–500 ms). Fine for
  button presses; don't spam.
- **Internet required** on both the hub and the CMS server — this is cloud IR,
  not local.

---

## 6. Quick self-test

```bash
TUYA_ACCESS_ID=xxx TUYA_ACCESS_SECRET=yyy node -e "
  const { remoteKey } = require('./tuyaIR');
  remoteKey('d746e7d41e962b00dd0jhl', 7, 417259975, 'Volume+')
    .then(r => console.log('ok', r.result))
    .catch(e => console.error(e.message));
"
```

If the soundbar volume goes up and it prints `ok true`, the integration works.
