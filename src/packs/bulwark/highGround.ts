// MODULE: bulwark.high_ground addon (land inside a finished wall zone counts +1 elevation, through the generic `ext.elevationBonus` tides and rising sea read; a broken zone loses it; replaces the old Sea wall idea) | DEPENDS ON: packs/bulwark/walls, shared/index | USED BY: packs/bulwark/addons.generated, packs/bulwark/index
import type { AddonDef, Ctx } from '../../shared';
import { refreshZones } from './walls';

export const highGroundAddon: AddonDef = {
  id: 'bulwark.high_ground',
  name: 'High ground',
  description: 'Land inside a finished wall zone counts +1 elevation (up to 4, which no tide reaches). A broken zone loses it until repaired.',
  deps: ['bulwark.walls'],
  links: [
    { target: 'tile-state', kind: 'mechanic' },
    { target: 'bulwark.walls', kind: 'content' }
  ],
  register(api) {
    // The bonus itself is written by `syncZones` while this addon is on; this only brings it in at game start.
    api.hook('onGameStart', (ctx: Ctx) => {
      if (ctx.g.ext?.bulwark) refreshZones(ctx);
    });
  }
};
