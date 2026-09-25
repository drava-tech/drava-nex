import { PvRecorder } from "@picovoice/pvrecorder-node";
import { pickDevice } from "./devices.js";

/**
 * Microphone capture: 16 kHz mono 16-bit PCM in fixed frames (30 ms = 480
 * samples by default — a frame size WebRTC VAD accepts). PvRecorder always
 * records at 16 kHz and resamples internally, so a Bluetooth headset running
 * at another native rate still yields the target format.
 */
export class Microphone {
  private recorder: PvRecorder | null = null;
  private running = false;

  constructor(
    private readonly frameLength: number,
    private readonly devicePreference: string[]
  ) {}

  /** Start capturing; calls onFrame for every frame until stop(). Returns the device name. */
  start(onFrame: (frame: Int16Array) => void, onError: (err: unknown) => void): string {
    const device = pickDevice(PvRecorder.getAvailableDevices(), this.devicePreference);
    this.recorder = new PvRecorder(this.frameLength, device.index);
    this.recorder.start();
    this.running = true;
    const selected = this.recorder.getSelectedDevice();

    void (async () => {
      while (this.running && this.recorder) {
        try {
          onFrame(await this.recorder.read());
        } catch (err) {
          if (this.running) onError(err);
          return;
        }
      }
    })();
    return selected;
  }

  stop(): void {
    this.running = false;
    try {
      this.recorder?.stop();
      this.recorder?.release();
    } catch {
      // already released
    }
    this.recorder = null;
  }
}
