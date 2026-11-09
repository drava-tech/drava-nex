// Every zone, by id (the ids in ZONES, config.js). main.js builds a zone the first time
// the visitor goes there. Zones without their own class yet are empty rooms.
import { WelcomeZone } from './welcome/WelcomeZone.js';
import { CmsZone } from './cms/CmsZone.js';
import { ObjectsZone } from './objects/ObjectsZone.js';
import { SaasZone } from './saas/SaasZone.js';
import { SimulationZone } from './simulation/SimulationZone.js';
import { ImmersiveZone } from './immersive/ImmersiveZone.js';
import { ScreensZone } from './shared/ScreensZone.js';
import * as floor1 from './floor1/script.js';
import * as floor2 from './floor2/script.js';

// The rooms of screens Zone 02's Nex and Grid push to: a floor each.
const SCREENS = { floor1, floor2 };

export function createZone(id, app) {
  if (id === 'welcome') return new WelcomeZone(app);
  if (id === 'cms') return new CmsZone(app);
  if (id === 'objects') return new ObjectsZone(app);
  if (id === 'saas') return new SaasZone(app);
  if (id === 'simulation') return new SimulationZone(app);
  if (id === 'immersive') return new ImmersiveZone(app);
  if (SCREENS[id]) return new ScreensZone(app, id, SCREENS[id]);
  throw new Error(`Unknown zone: ${id}`);
}
