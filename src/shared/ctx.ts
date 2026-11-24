// MODULE: action context (state + registry + event/log emitters) | DEPENDS ON: shared/registry, shared/types | USED BY: shared/botGoals, shared/coreServices, shared/engine, shared/eventDeck, shared/history, shared/index, +7 more
import type { Registry } from './registry';
import type { GameState } from './types';

export interface GameEvent { type: string; data?: any }

/**
 * Standard events: log, phaseChanged, turnStarted, rolled, produced, goldEarned, built, revealed,
 * transferred {from,to,resource,amount,kind,secret?}, robberMoved, picked, discarded, devBought,
 * devPlayed, tradeProposed, tradeResponse, awardChanged, gameOver.
 * Sounds, animations and replay subscribe to these; rules never depend on them.
 */
export interface Ctx {
  g: GameState;
  reg: Registry;
  events: GameEvent[];
  emit(type: string, data?: any): void;
  log(text: string, color?: string | null): void;
}

export function makeCtx(g: GameState, reg: Registry): Ctx {
  const events: GameEvent[] = [];
  return {
    g,
    reg,
    events,
    emit(type, data) { events.push({ type, data }); },
    log(text, color = null) {
      g.log.push({ text, color });
      if (g.log.length > 80) g.log.shift();
    }
  };
}
