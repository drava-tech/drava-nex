import { Emitter } from '../util/Emitter.js';

/**
 * Optional live link to the physical TRAVIS system.
 *
 * TRAVIS already runs a WebSocket broadcast bridge (TRAVIS/bridge/ws_server.py,
 * port 8765). When it is running, this page listens to it, so the real
 * recognition camera can drive the virtual welcome. When it is not, the page
 * works on its own ("simulated" mode) and the visitor types their name.
 *
 * Messages understood (JSON, one per WebSocket message):
 *   { "task": "welcome_zone", "type": "visitor_recognised", "name": "Ananya", "returning": false }
 *   { "task": "welcome_zone", "type": "person_entered" }
 *   { "event": "person_entered" }        // presence_trigger.py payload shape
 *
 * Messages sent (so TRAVIS can react to the virtual visit):
 *   { "task": "welcome_zone", "cmd": "visitor_welcomed", "name": "...", "source": "virtual" }
 *   { "cmd": "ping" }                     // app-level heartbeat understood by ws_server.py
 *
 * Emits: 'status' ('connecting' | 'online' | 'offline' | 'off'), 'visitor' ({ name, returning }), 'presence'.
 */
export class Bridge extends Emitter {
  constructor(url, enabled = true) {
    super();
    this.url = url;
    this.enabled = enabled;
    this.status = enabled ? 'connecting' : 'off';
    this.ws = null;
    this.retryMs = 4000;
    this.lastVisitor = null;
    this.heartbeat = null;
    if (enabled) this.#connect();
  }

  #set(status) {
    if (status === this.status) return;
    this.status = status;
    this.emit('status', status);
  }

  #connect() {
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.#set('offline');
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retryMs = 4000;
      this.#set('online');
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => this.send({ cmd: 'ping' }), 15000);
    });
    ws.addEventListener('message', (e) => this.#onMessage(e.data));
    ws.addEventListener('close', () => {
      clearInterval(this.heartbeat);
      this.ws = null;
      this.#set('offline');
      // Back off gently; the venue machine may start TRAVIS after the page.
      setTimeout(() => this.#connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 1.6, 30000);
    });
    ws.addEventListener('error', () => { /* 'close' follows and handles retry */ });
  }

  #onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const type = msg.type || msg.event;
    const forUs = msg.task === 'welcome_zone' || msg.task === 'visitor' || msg.event;
    if (!forUs) return;
    if (type === 'visitor_recognised' && msg.name) {
      this.lastVisitor = { name: String(msg.name).slice(0, 32), returning: !!msg.returning, at: performance.now() };
      this.emit('visitor', this.lastVisitor);
    } else if (type === 'person_entered') {
      this.emit('presence', msg);
    }
  }

  /** A visitor TRAVIS recognised in the last `withinMs`, if any. */
  recentVisitor(withinMs = 90000) {
    const v = this.lastVisitor;
    return v && performance.now() - v.at < withinMs ? v : null;
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
    }
  }
}
