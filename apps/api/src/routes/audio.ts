import { Hono } from 'hono';
import { z } from 'zod';
import { audioService } from '../services/audio.js';

export const audioRouter = new Hono();

// GET /audio/status
audioRouter.get('/status', (c) => {
  return c.json(audioService.getStatus());
});

// POST /audio/volume
const volumeSchema = z.object({
  volume: z.number().min(0).max(100),
});

audioRouter.post('/volume', async (c) => {
  try {
    const body = await c.req.json();
    const result = volumeSchema.safeParse(body);
    if (!result.success) {
      return c.json({ success: false, error: 'Invalid volume value' }, 400);
    }
    audioService.setVolume(result.data.volume);
    return c.json(audioService.getStatus());
  } catch (err) {
    return c.json({ success: false, error: 'Malformed JSON payload' }, 400);
  }
});

// POST /audio/mute
audioRouter.post('/mute', (c) => {
  audioService.setMute(true);
  return c.json(audioService.getStatus());
});

// POST /audio/unmute
audioRouter.post('/unmute', (c) => {
  audioService.setMute(false);
  return c.json(audioService.getStatus());
});

// POST /audio/toggle-mute
audioRouter.post('/toggle-mute', (c) => {
  audioService.toggleMute();
  return c.json(audioService.getStatus());
});

export default audioRouter;
