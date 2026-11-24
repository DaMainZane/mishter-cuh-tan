// MODULE: pack list entry point | DEPENDS ON: packs/base/index, packs/bulwark/index, packs/fog/index, packs/gold/index, packs/tidebound/index, shared/index | USED BY: server/runtime
import type { Pack } from '../shared';
import { basePack } from './base';
import { bulwarkPack } from './bulwark';
import { fogPack } from './fog';
import { goldPack } from './gold';
import { tideboundPack } from './tidebound';

export { basePack, bulwarkPack, fogPack, goldPack, tideboundPack };

/** Every shipped pack in load order (base first, the others depend on it). */
export const allPacks: Pack[] = [basePack, goldPack, fogPack, tideboundPack, bulwarkPack];
