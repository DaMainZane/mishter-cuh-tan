// MODULE: awards (Longest Road, Largest Army) | DEPENDS ON: packs/base/longestRoad, shared/index | USED BY: packs/base/index
import type { PackApi } from '../../shared';
import { longestRoadFor } from './longestRoad';

export function registerAwards(api: PackApi): void {
  api.award({
    id: 'longestRoad',
    name: 'Longest Road',
    vp: 2,
    min: 5,
    metric: (ctx, player) => longestRoadFor(ctx, player.id),
    recomputeOn: ['build']
  });

  api.award({
    id: 'largestArmy',
    name: 'Largest Army',
    vp: 2,
    min: 3,
    metric: (_ctx, player) => player.stats.knightsPlayed || 0,
    recomputeOn: ['play_dev']
  });
}
