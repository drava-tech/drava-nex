# packages/iot/src — IoT Source Code

> **Contains:** The `MQTTDeviceManager` class — the single file that handles all MQTT communication.

---

## What Lives Here

```
packages/iot/src/          ← YOU ARE HERE
└── index.ts               → MQTTDeviceManager class (MQTT + normalization)
```

---

## File: `index.ts`

### Imports (Line 1)

```typescript
import { DeviceTelemetry, IoTEvent, DeviceCommand } from '@platform/types';
```

Pulls in the 3 IoT-related interfaces. These are the **output types** of this package — raw MQTT buffers go in, typed objects come out.

---

### Class Structure

```
MQTTDeviceManager
│
├── private brokerUrl: string          ← stored at construction
│
├── connect(): void
│     Current: console.info stub
│     Future:  mqtt.connect() + subscribe() + on('message')
│
├── publishCommand(deviceId, command)
│     Current: console.info stub
│     Future:  client.publish(topic, JSON.stringify(command))
│
├── normalizeTelemetry(rawPayload: Buffer): DeviceTelemetry
│     Works now: Buffer → JSON.parse → DeviceTelemetry
│
└── normalizeEvent(rawPayload: Buffer): IoTEvent
      Works now: Buffer → JSON.parse → IoTEvent
```

---

## How Data Enters and Exits

```
ENTRY POINT — connect() is called by apps/api/src/index.ts at startup:

  const mqttManager = new MQTTDeviceManager('mqtt://localhost:1883')
  mqttManager.connect()

DATA IN (future) — MQTT message arrives:
  client.on('message', (topic: string, payload: Buffer) => {
    // payload is raw bytes — e.g. { "deviceId": "s-001", "metrics": {...} }
  })

NORMALIZATION — convert raw Buffer → typed object:
  const telemetry: DeviceTelemetry = mqttManager.normalizeTelemetry(payload)
  // Output: { deviceId: 'screen-001', timestamp: 1748000000000, metrics: { motionDetected: true } }

  const event: IoTEvent = mqttManager.normalizeEvent(payload)
  // Output: { eventId: 'ev-abc', deviceId: 'screen-001', topic: 'platform/...', payload: {...} }

DATA OUT — commands go back to devices:
  mqttManager.publishCommand('screen-001', {
    commandId: 'cmd-001',
    deviceId: 'screen-001',
    action: 'play_content',
    payload: { playlistId: 'playlist-promo' },
    sentAt: Date.now()
  })
```

---

## What "Real-Time" Means Here

When the real MQTT connection is wired up:

```
Sensor fires at T+0ms
  └── Mosquitto receives at T+5ms (network)
  └── MQTTDeviceManager.on('message') fires at T+6ms
  └── normalizeTelemetry() runs at T+6.1ms (microseconds)
  └── Rule engine evaluates at T+7ms
  └── WebSocket push to screen at T+8ms
  └── Screen switches content at T+10ms

Total: ~10ms end-to-end — that's the "fraction of a second" you want
```
