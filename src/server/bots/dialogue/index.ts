// MODULE: bot dialogue entry (engine events -> chat lines, game start, replies to human chat) | DEPENDS ON: packs/base/constants, server/bots/dialogue/context, server/bots/dialogue/engine, server/bots/dialogue/types, server/runtime, server/types, +1 more | USED BY: server/bots/dialogue
//
// Every trigger here uses public information only (see context.ts). A steal never passes the stolen card on,
// a discard only passes the count, and a dev card purchase never passes the card type.
import { ownersOnHex, totalCards } from '../../../shared';
import type { GameEvent, GameState, PlayerState } from '../../../shared';
import { CITY, ROAD, SETTLEMENT } from '../../../packs/base/constants';
import { registry } from '../../runtime';
import type { Room } from '../../types';
import { buildCtx, publicStanding } from './context';
import type { CtxExtra } from './context';
import { memoryOf, resetMemory, speak } from './engine';
import type { Speaker } from './engine';
import type { DialogueEvent } from './types';

function pickOf<T>(list: T[]): T | undefined {
  return list.length > 0 ? list[Math.floor(Math.random() * list.length)] : undefined;
}

function countVertices(g: GameState, owner: string, type: string): number {
  let n = 0;
  for (const v of g.board.vertices) if (v.piece && v.piece.owner === owner && v.piece.type === type) n++;
  return n;
}

function countEdges(g: GameState, owner: string, type: string): number {
  let n = 0;
  for (const e of g.board.edges) if (e.piece && e.piece.owner === owner && e.piece.type === type) n++;
  return n;
}

function hasPieces(g: GameState, owner: string): boolean {
  return g.board.vertices.some(v => v.piece?.owner === owner);
}

/** Posts bot chat for the engine events of one successful action. Called by game.ts after every dispatch. */
export function emitBotDialogue(room: Room, actorId: string, actionType: string, events: GameEvent[]): void {
  const g = room.game;
  if (!g) return;
  const mem = memoryOf(room);

  // Bookkeeping first, so it also runs in games without bots (a bot can take over later).
  for (const ev of events) {
    const d = ev.data ?? {};
    if ((ev.type === 'tradeProposed' || ev.type === 'tradeCountered') && d.tradeId !== undefined) {
      mem.trades.set(d.tradeId, d.playerId);
      if (mem.trades.size > 200) mem.trades.delete(mem.trades.keys().next().value as number);
    }
  }

  const bots = g.players.filter(p => p.isBot);
  const byId = (id: unknown): PlayerState | undefined => g.players.find(p => p.id === id);
  const botById = (id: unknown): PlayerState | undefined => {
    const p = byId(id);
    return p?.isBot ? p : undefined;
  };
  const say = (who: Speaker | undefined, event: DialogueEvent, extra: CtxExtra = {}): boolean => {
    if (!who) return false;
    const speaker: Speaker = who;
    return speak(room, speaker, event, () => buildCtx(room, speaker, extra));
  };

  const finish = (): void => {
    // The award holders as of now: the next action's `awardChanged` compares against them to find who lost it.
    mem.awards = { ...g.awards };
    for (const ev of events) if (ev.type === 'tradeCancelled' && ev.data?.tradeId !== undefined) mem.trades.delete(ev.data.tradeId);
  };

  if (bots.length > 0) {
    const cancelled = events.some(e => e.type === 'tradeCancelled');

    for (const ev of events) {
      const d = ev.data ?? {};

      switch (ev.type) {
        case 'gameOver': {
          const winner = byId(d.playerId);
          if (winner?.isBot) say(winner, 'botWins');
          else if (winner) say(pickOf(bots), 'otherWins', { other: winner });
          finish();
          return;
        }

        case 'rolled': {
          const roller = byId(d.playerId);
          if (d.sum === 7) {
            if (roller?.isBot) say(roller, 'rollSeven');
            // Card counts are public, so a bot over the limit can groan about someone else's seven.
            const heavy = bots.filter(b => b.id !== roller?.id && totalCards(b) > g.rules.discardLimit);
            say(pickOf(heavy), 'otherSeven');
          } else if (d.sum === 6 || d.sum === 8) {
            const producedFor = new Set(events.filter(e => e.type === 'produced').map(e => e.data?.playerId));
            const lucky = bots.filter(b => producedFor.has(b.id));
            if (lucky.length > 0) say(pickOf(lucky), 'goodRoll', { sum: d.sum });
            else say(pickOf(bots.filter(b => hasPieces(g, b.id))), 'noProduction', { sum: d.sum });
          }
          break;
        }

        case 'discarded':
          say(botById(d.playerId), 'discard', { n: d.count });
          break;

        case 'robberMoved': {
          const hex = g.board.hexes[d.to];
          const mover = byId(d.playerId);
          if (!hex || !mover) break;
          const opposing = ownersOnHex(g, hex).filter(id => id !== mover.id).map(byId).filter((p): p is PlayerState => !!p);
          if (mover.isBot && opposing.length > 0) {
            const { leaderId } = publicStanding(g);
            const leader = opposing.find(p => p.id === leaderId);
            if (leader) say(mover, 'robberLeader', { other: leader });
            else if (hex.number) say(mover, 'robberNumber', { other: pickOf(opposing), number: hex.number });
          }
          const hitBots = opposing.filter(p => p.isBot);
          if (hitBots.length > 0) say(pickOf(hitBots), 'robbedOn', { other: mover });
          break;
        }

        case 'transferred': {
          if (d.kind !== 'steal') break;
          // Only the two names are used. d.resource is deliberately never read.
          const victim = byId(d.from);
          const thief = byId(d.to);
          if (!(victim?.isBot && say(victim, 'robbed', { other: thief })) && thief?.isBot) {
            say(thief, 'steal', { other: victim });
          }
          break;
        }

        case 'built': {
          const bot = botById(d.playerId);
          if (!bot) break;
          if (d.piece === CITY) {
            say(bot, 'city');
          } else if (d.piece === SETTLEMENT && !d.upgrade) {
            // The two opening settlements are not worth a comment.
            if (countVertices(g, bot.id, SETTLEMENT) + countVertices(g, bot.id, CITY) >= 3) say(bot, 'settlement');
          } else if (d.piece === ROAD && countEdges(g, bot.id, ROAD) >= 3) {
            say(bot, 'road');
          }
          break;
        }

        case 'netPlaced': {
          // A net is a tile action (`place_net`), so it has its own event instead of `built`.
          say(botById(d.playerId), 'netBuilt');
          break;
        }

        case 'portUpgraded': {
          if (d.level === 2) say(botById(d.playerId), 'harborBuilt');
          break;
        }

        case 'pieceBroken': {
          if (d.piece === 'rickety_bridge') say(botById(d.ownerId), 'bridgeCollapsed');
          break;
        }

        case 'tideChanged': {
          const risen: number[] = Array.isArray(d.risen) ? d.risen : [];
          if (risen.length === 0) break;
          const hitOwners = new Set<string>();
          for (const hexId of risen) {
            const hex = g.board.hexes[hexId];
            if (!hex) continue;
            for (const o of ownersOnHex(g, hex)) hitOwners.add(o);
          }
          const hitBots = bots.filter(b => hitOwners.has(b.id));
          if (hitBots.length > 0) say(pickOf(hitBots), 'tideFlood');
          break;
        }

        case 'risingSeaDrowned': {
          const hex = g.board.hexes[d.hexId];
          if (!hex) break;
          const hitOwners = new Set(ownersOnHex(g, hex));
          const hitBots = bots.filter(b => hitOwners.has(b.id));
          if (hitBots.length > 0) say(pickOf(hitBots), 'tideFlood');
          break;
        }

        case 'wreckClaimed': {
          // Only the claiming player is read; d.resource and d.bonus are deliberately ignored.
          say(botById(d.playerId), 'wreckClaimed');
          break;
        }

        case 'pirateRobbed': {
          // Only the raided player (victimId) is read; stolen resources are never read.
          say(botById(d.victimId), 'pirateRaid');
          break;
        }

        case 'pirateDriven': {
          // Only the player who drove the pirate off is read; d.resource is deliberately ignored.
          say(botById(d.playerId), 'pirateDriven');
          break;
        }

        case 'devBought':
          say(botById(d.playerId), 'devBought');
          break;

        case 'devPlayed': {
          const bot = botById(d.playerId);
          if (!bot) break;
          if (d.card === 'knight') {
            say(bot, 'knight', { n: bot.stats.knightsPlayed });
          } else if (d.card === 'monopoly') {
            // The resource is public: everyone sees what moved. With nothing moved there is no resource to name.
            const moved = events.filter(e => e.type === 'transferred' && e.data?.kind === 'monopoly');
            const total = moved.reduce((sum, e) => sum + (Number(e.data?.amount) || 0), 0);
            say(bot, 'monopoly', moved.length > 0 ? { res: moved[0].data?.resource, n: total } : {});
          } else if (d.card === 'yearOfPlenty') {
            say(bot, 'yearOfPlenty');
          } else if (d.card === 'roadBuilding') {
            say(bot, 'roadBuilding');
          }
          break;
        }

        case 'awardChanged': {
          const holder = byId(d.playerId);
          const previous = byId(mem.awards[d.award]);
          const award = registry.awards.get(d.award)?.name ?? String(d.award);
          if (holder?.isBot) say(holder, 'awardWon', { award });
          if (previous?.isBot && previous.id !== holder?.id) say(previous, 'awardLost', { award, other: holder });
          break;
        }

        case 'tradeProposed':
          say(botById(d.playerId), 'tradeOffer');
          break;

        case 'tradeCountered':
          say(botById(d.playerId), 'tradeCounter', { other: byId(d.toId) });
          break;

        case 'tradeResponse': {
          const responder = botById(d.playerId);
          const proposer = byId(mem.trades.get(d.tradeId));
          if (d.decision === 'accepted') {
            say(responder, 'tradeAccept', { other: proposer });
          } else if (d.decision === 'declined') {
            // The offer was closed because everyone said no: its owner (a bot) has the better line.
            if (cancelled && proposer?.isBot) say(proposer, 'tradeNoTakers');
            if (responder) {
              const { vps, leaderId } = publicStanding(g);
              const proposerIsLeader =
                !!proposer && proposer.id === leaderId && (vps.get(proposer.id) ?? 0) >= Math.ceil(g.rules.vpToWin / 2);
              say(responder, proposerIsLeader ? 'tradeDeclineLeader' : 'tradeDecline', { other: proposer });
            }
          }
          break;
        }

        case 'revealed': {
          const revealer = byId(d.playerId);
          const bot = revealer?.isBot ? revealer : pickOf(bots);
          if (bot) say(bot, 'fogReveal', { number: d.number, other: revealer && revealer.id !== bot.id ? revealer : undefined });
          break;
        }
      }
    }

    // A bot completed a trade by confirming it.
    if (actionType === 'confirm_trade') say(botById(actorId), 'tradeAccept');

    // The bank ran dry (public). One announcement per resource until it has cards again.
    for (const ev of events) {
      if (ev.type !== 'transferred' || ev.data?.from !== 'bank') continue;
      const res: string = ev.data.resource;
      if (g.bank[res] === 0 && !mem.announced.has(`bank:${res}`)) {
        if (say(botById(ev.data.to) ?? pickOf(bots), 'bankEmpty', { res })) mem.announced.add(`bank:${res}`);
      }
    }
    for (const res of Object.keys(g.bank)) if (g.bank[res] > 0) mem.announced.delete(`bank:${res}`);

    // Score race: one VP from winning, or a human close to winning. Public VP only, each said once per game.
    if (events.some(e => e.type === 'built' || e.type === 'awardChanged' || e.type === 'devPlayed')) {
      const { vps } = publicStanding(g);
      const win = g.rules.vpToWin;
      for (const bot of bots) {
        const key = `one:${bot.id}`;
        if (win - (vps.get(bot.id) ?? 0) === 1 && !mem.announced.has(key) && say(bot, 'oneVpLeft')) mem.announced.add(key);
      }
      for (const human of g.players.filter(p => !p.isBot)) {
        const vp = vps.get(human.id) ?? 0;
        const key = `close:${human.id}`;
        if (vp >= Math.ceil(win * 0.7) && vp < win && !mem.announced.has(key) && say(pickOf(bots), 'humanClose', { other: human })) {
          mem.announced.add(key);
        }
      }
    }
  }

  finish();
}

/** Called once when a game starts: a clean memory, a greeting, and a comment on a big or island map. */
export function emitGameStartDialogue(room: Room): void {
  resetMemory(room);
  const g = room.game;
  if (!g) return;
  const bots = g.players.filter(p => p.isBot);
  const first = pickOf(bots);
  if (!first) return;

  speak(room, first, 'gameStart', () => buildCtx(room, first));

  const traits = buildCtx(room, first).facts.traits;
  const mapEvent: DialogueEvent | null = traits.includes('islands') ? 'islands' : traits.includes('large') ? 'largeMap' : null;
  const second = pickOf(bots.filter(b => b.id !== first.id));
  if (mapEvent && second) speak(room, second, mapEvent, () => buildCtx(room, second));
}

const GREETING = /^\s*(hi|hello|hey|yo|sup|hiya|howdy)\b/i;
const GG = /\b(gg|good game|well played|wp)\b/i;
const THANKS = /\b(thanks|thank you|thx|ty)\b/i;
const LAUGH = /\b(lol|lmao|haha+|hehe+)\b/i;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Short canned replies to words in human chat. Works in the lobby and in a game, never answers anything about the
 * game state, is off in Quiet mode, and is rate limited (one reply per 12 seconds, plus the normal room gap).
 */
export function reactToChat(room: Room, senderId: string, text: string): void {
  const level = room.settings?.botChat ?? 'normal';
  if (level === 'off' || level === 'quiet') return;

  // Players in a game, lobby players otherwise: both have id, name, avatar, color, difficulty and isBot.
  const roster: any[] = room.game ? room.game.players : room.lobbyPlayers;
  const sender = roster.find(p => p.id === senderId);
  if (!sender || sender.isBot) return;
  const bots: Speaker[] = roster.filter(p => p.isBot);
  if (bots.length === 0) return;

  const said = String(text ?? '').trim();
  if (!said) return;

  const named = bots.find(b => new RegExp(`\\b${escapeRe(b.name.replace(/\s*\(Bot\)$/, ''))}\\b`, 'i').test(said));
  let event: DialogueEvent | null = null;
  if (named) event = 'chatName';
  else if (GREETING.test(said)) event = 'chatHello';
  else if (GG.test(said)) event = 'chatGg';
  else if (THANKS.test(said)) event = 'chatThanks';
  else if (LAUGH.test(said)) event = 'chatLol';
  if (!event) return;

  const bot = named ?? pickOf(bots)!;
  speak(room, bot, event, () => buildCtx(room, bot), { reply: true });
}
