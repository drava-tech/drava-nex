import type { AudioStatus } from '@platform/types';
import { sendAudioCommand, getAudioStatus } from '../ws/gateway.js';

/**
 * System volume/mute control. The actual audio I/O (NAudio/WASAPI) can only
 * run natively on Windows — this API runs in a Linux container and can never
 * execute audio-helper.exe directly, so it delegates to the native bridge
 * (apps/api/audio-helper/bridge.mjs) over the WS gateway instead.
 */
class AudioService {
  // No-op — kept so the existing index.ts bootstrap call stays inert rather
  // than requiring a call-site change.
  public start() {}

  public getStatus(): AudioStatus {
    return getAudioStatus();
  }

  public setVolume(volume: number) {
    sendAudioCommand('set-volume', volume);
  }

  public setMute(muted: boolean) {
    sendAudioCommand('set-mute', muted);
  }

  public toggleMute() {
    sendAudioCommand('toggle-mute');
  }
}

export const audioService = new AudioService();
export default audioService;
