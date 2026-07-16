import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { broadcastToCms } from '../ws/gateway.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AudioStatus {
  volume: number;
  muted: boolean;
  device: string;
}

class AudioService {
  private child: ChildProcess | null = null;
  private status: AudioStatus = {
    volume: 50,
    muted: false,
    device: 'Unknown Device',
  };
  private helperPath = '';

  constructor() {
    this.resolveHelperPath();
  }

  private resolveHelperPath() {
    // In dev: dist/services/audio.js -> ../../audio-helper/bin/Release/net9.0/audio-helper.exe
    // Let's resolve relative paths carefully.
    const paths = [
      path.resolve(__dirname, '../../audio-helper/bin/Release/net9.0/audio-helper.exe'),
      path.resolve(__dirname, '../../../audio-helper/bin/Release/net9.0/audio-helper.exe'),
      path.resolve(__dirname, '../../audio-helper/bin/Debug/net9.0/audio-helper.exe'),
      path.join(process.cwd(), 'audio-helper/bin/Release/net9.0/audio-helper.exe'),
      path.join(process.cwd(), 'apps/api/audio-helper/bin/Release/net9.0/audio-helper.exe'),
    ];

    for (const p of paths) {
      if (fs.existsSync(p)) {
        this.helperPath = p;
        break;
      }
    }

    if (!this.helperPath) {
      // Fallback to the standard Release bin folder path
      this.helperPath = paths[0] ?? '';
    }
  }

  public async start() {
    if (this.child) return;

    this.resolveHelperPath();

    // Build the helper if it doesn't exist
    if (!fs.existsSync(this.helperPath)) {
      console.info('[AudioService] Audio helper binary not found. Triggering dotnet build...');
      try {
        const helperDir = path.resolve(__dirname, '../../audio-helper');
        const { execSync } = await import('child_process');
        execSync('dotnet build -c Release', { cwd: helperDir, stdio: 'inherit' });
        this.resolveHelperPath();
      } catch (err) {
        console.error('[AudioService] Failed to compile audio-helper C# binary:', err);
      }
    }

    console.info(`[AudioService] Spawning audio-helper from: ${this.helperPath}`);
    
    try {
      this.child = spawn(this.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      console.error('[AudioService] Failed to spawn audio-helper child process:', err);
      return;
    }

    this.child.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const payload = JSON.parse(line.trim());
          if (payload.type === 'status') {
            this.status = {
              volume: payload.volume,
              muted: payload.muted,
              device: payload.device,
            };
            // Broadcast to all CMS clients via websocket
            broadcastToCms({
              type: 'AUDIO_STATUS_UPDATE' as any,
              ...this.status,
            } as any);
          }
        } catch {
          // Ignore non-JSON output
        }
      }
    });

    this.child.stderr?.on('data', (data) => {
      console.error(`[AudioService Helper Error]: ${data.toString().trim()}`);
    });

    this.child.on('close', (code) => {
      console.warn(`[AudioService] Audio helper exited with code ${code}. Restarting in 3 seconds...`);
      this.child = null;
      setTimeout(() => this.start(), 3000);
    });
  }

  public getStatus(): AudioStatus {
    return this.status;
  }

  public setVolume(volume: number) {
    this.sendCommand({ action: 'set-volume', value: volume });
  }

  public setMute(muted: boolean) {
    this.sendCommand({ action: 'set-mute', value: muted });
  }

  public toggleMute() {
    this.sendCommand({ action: 'toggle-mute' });
  }

  public incrementVolume(value: number = 5) {
    this.sendCommand({ action: 'increment', value });
  }

  public decrementVolume(value: number = 5) {
    this.sendCommand({ action: 'decrement', value });
  }

  private sendCommand(cmd: { action: string; value?: any }) {
    if (!this.child || !this.child.stdin || this.child.stdin.writableEnded) {
      console.warn('[AudioService] Stdin not writable, cannot send command. Restarting service...');
      this.start();
      return;
    }
    try {
      this.child.stdin.write(JSON.stringify(cmd) + '\n');
    } catch (err) {
      console.error('[AudioService] Error writing to helper stdin:', err);
    }
  }
}

export const audioService = new AudioService();
export default audioService;
