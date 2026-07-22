import { connect, type MqttClient, type IClientPublishOptions } from 'mqtt';
import { DeviceTelemetry, IoTEvent, DeviceCommand } from '@platform/types';

type SubscriptionHandler = (topic: string, payload: Buffer) => void;

/** Converts an MQTT topic filter ('+' = one level, '#' = trailing levels) into a matcher regex. */
function topicFilterToRegex(filter: string): RegExp {
  const pattern = filter
    .split('/')
    .map((seg) => {
      if (seg === '#') return '.*';
      if (seg === '+') return '[^/]+';
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${pattern}$`);
}

export class MQTTDeviceManager {
  private brokerUrl: string;
  private client: MqttClient | null = null;
  private subscriptions: { pattern: RegExp; handler: SubscriptionHandler }[] = [];

  constructor(brokerUrl: string) {
    this.brokerUrl = brokerUrl;
  }

  public connect(): void {
    if (this.client) return; // idempotent — one client per process lifetime

    this.client = connect(this.brokerUrl, {
      clientId: `cms-api-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 5_000,
      connectTimeout: 10_000,
      keepalive: 60,
      clean: true,
    });

    this.client.on('connect', () => console.info(`[mqtt] connected → ${this.brokerUrl}`));
    this.client.on('reconnect', () => console.info('[mqtt] reconnecting…'));
    this.client.on('offline', () => console.warn('[mqtt] offline'));
    this.client.on('error', (err) => console.error('[mqtt] error:', err.message));
    this.client.on('message', (topic, payload) => {
      for (const { pattern, handler } of this.subscriptions) {
        if (pattern.test(topic)) handler(topic, payload);
      }
    });
    // No end() anywhere — the client must stay alive for the process lifetime.
  }

  /**
   * Subscribe to a topic filter and register a handler for messages matching it.
   * Multiple subscribe() calls share one underlying 'message' listener — each
   * incoming message is dispatched to every handler whose filter matches.
   */
  public subscribe(topicFilter: string, handler: SubscriptionHandler): void {
    if (!this.client) {
      throw new Error('MQTT client not initialized — call connect() first');
    }
    this.subscriptions.push({ pattern: topicFilterToRegex(topicFilter), handler });
    this.client.subscribe(topicFilter, (err) => {
      if (err) console.error(`[mqtt] subscribe failed for ${topicFilter}:`, err.message);
    });
  }

  public isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  /**
   * Generic publish. Resolves on broker ack (PUBACK for QoS 1). While offline,
   * mqtt.js queues the packet client-side and the promise stays pending until
   * reconnect — callers that need a bounded response must race a timeout.
   */
  public publishRaw(
    topic: string,
    payload: string,
    opts: IClientPublishOptions = {}
  ): Promise<void> {
    if (!this.client) {
      return Promise.reject(new Error('MQTT client not initialized — call connect() first'));
    }
    return this.client.publishAsync(topic, payload, opts).then(() => undefined);
  }

  public publishCommand(deviceId: string, command: DeviceCommand): void {
    console.info(`Publishing command ${command.action} to device ${deviceId}`);
  }

  public normalizeTelemetry(rawPayload: Buffer): DeviceTelemetry {
    console.info('Normalizing incoming device telemetry payload');
    const parsed = JSON.parse(rawPayload.toString());
    return {
      deviceId: parsed.deviceId || 'unknown',
      timestamp: parsed.timestamp || Date.now(),
      metrics: parsed.metrics || {}
    };
  }

  public normalizeEvent(rawPayload: Buffer): IoTEvent {
    console.info('Normalizing incoming IoT event');
    const parsed = JSON.parse(rawPayload.toString());
    return {
      eventId: parsed.eventId || 'unknown',
      deviceId: parsed.deviceId || 'unknown',
      topic: parsed.topic || 'default/topic',
      payload: parsed.payload,
      timestamp: parsed.timestamp || Date.now()
    };
  }
}
