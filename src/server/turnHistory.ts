// MODULE: Turn history recorder & round summarizer | DEPENDS ON: server/types, shared/index | USED BY: server/debug, server/game, server/types
import { currentPlayer } from '../shared';
import type { GameEvent } from '../shared';
import type { Room } from './types';

export interface TurnActionResource {
  resource: string;
  amount: number;
  sign?: '+' | '-' | '';
}

export interface TurnActionItem {
  category: 'roll' | 'produce' | 'build' | 'rob' | 'dev' | 'trade' | 'discard' | 'event' | 'award';
  icon: string;
  text: string;
  badge?: string;
  resources?: TurnActionResource[];
  piece?: string;
  devCard?: string;
  diceSum?: number;
  timestamp: number;
}

export interface PlayerTurnSummary {
  turnCount: number;
  playerId: string;
  playerName: string;
  playerAvatar: string;
  playerColor: string;
  isBot: boolean;
  actions: TurnActionItem[];
}

export interface RoundSummary {
  round: number; // 0 = Setup Phase, 1 = Round 1, etc.
  title: string;
  turns: PlayerTurnSummary[];
}

const RESOURCE_NAMES: Record<string, string> = {
  wood: 'Wood',
  brick: 'Brick',
  sheep: 'Sheep',
  wheat: 'Wheat',
  ore: 'Ore',
  gold: 'Gold',
  fish: 'Fish'
};

const TRADE_ACTIONS = new Set(['propose_trade', 'respond_trade', 'counter_trade', 'confirm_trade', 'cancel_trade']);

/** One engine log line (`g.log`): an announcement that may have no engine event of its own. */
export interface LogNote {
  text: string;
  color?: string | null;
}

// Per room: the last engine log line already folded into the turn history.
const seenLogLine = new WeakMap<Room, LogNote>();

/** Engine log lines added since the last call (all of them the first time), so the one merged Live Log can carry them. */
export function takeNewLogLines(room: Room): LogNote[] {
  const log = (room.game?.log ?? []) as LogNote[];
  const last = seenLogLine.get(room);
  const from = last ? log.lastIndexOf(last) + 1 : 0;
  if (log.length > 0) seenLogLine.set(room, log[log.length - 1]);
  return log.slice(from);
}

/**
 * Records key player actions, resource card changes, and engine events into structured round/turn summaries
 * for the unified Live Log & Turn History view.
 * `notes` are the engine log lines this action produced. A line is kept only when the action recorded nothing else,
 * because otherwise the recorded actions already say the same thing (this is what keeps the log one stream, not two).
 */
export function recordTurnHistory(
  room: Room,
  actingId: string,
  actionType: string,
  payload: any,
  events: GameEvent[],
  notes: LogNote[] = []
): void {
  const g = room.game;
  if (!g) return;

  // Answering or countering a trade is done by the other players, but the trade belongs to the turn of the player whose turn it is.
  const playerId =
    actionType === 'respond_trade' || actionType === 'counter_trade' ? (currentPlayer(g)?.id ?? actingId) : actingId;

  room.turnHistory = room.turnHistory || [];

  const isSetup = g.phase.startsWith('setup') || (g.turnCount || 0) === 0;
  const currentRound = isSetup ? 0 : Math.max(1, g.round || 1);
  const roundTitle = isSetup ? 'Setup Phase' : `Round ${currentRound}`;

  let roundSummary = room.turnHistory.find(r => r.round === currentRound);
  if (!roundSummary) {
    roundSummary = {
      round: currentRound,
      title: roundTitle,
      turns: []
    };
    room.turnHistory.push(roundSummary);
  }

  const p = g.players.find(x => x.id === playerId) || room.lobbyPlayers.find(x => x.id === playerId);
  const turnCount = g.turnCount || 0;

  let turnSummary: PlayerTurnSummary | undefined;
  let createdTurn = false;
  if (isSetup) {
    const existing = roundSummary.turns.filter(t => t.playerId === playerId);
    const latest = existing[existing.length - 1];
    const hasSettle = latest?.actions.some(a => a.category === 'build' && a.piece === 'settlement');
    const hasRoad = latest?.actions.some(a => a.category === 'build' && a.piece === 'road');
    if (!latest || (hasSettle && hasRoad && (actionType === 'placeSettlement' || actionType === 'buildSettlement' || (actionType === 'build' && payload?.piece === 'settlement')))) {
      turnSummary = {
        turnCount: 0,
        playerId,
        playerName: p?.name || 'Player',
        playerAvatar: p?.avatar || '👤',
        playerColor: p?.color || '#888',
        isBot: !!p?.isBot,
        actions: []
      };
      roundSummary.turns.push(turnSummary);
      createdTurn = true;
    } else {
      turnSummary = latest;
    }
  } else {
    turnSummary = roundSummary.turns.find(t => t.playerId === playerId && t.turnCount === turnCount);
    if (!turnSummary) {
      turnSummary = {
        turnCount,
        playerId,
        playerName: p?.name || 'Player',
        playerAvatar: p?.avatar || '👤',
        playerColor: p?.color || '#888',
        isBot: !!p?.isBot,
        actions: []
      };
      roundSummary.turns.push(turnSummary);
      createdTurn = true;
    }
  }

  const now = Date.now();
  const turn: PlayerTurnSummary = turnSummary;
  const actionsBefore = turn.actions.length;

  // A Knight is "open" from the moment it is played until the next roll: its robber move and steal belong to it.
  const knightOpen = (): boolean => {
    for (let i = turn.actions.length - 1; i >= 0; i--) {
      const a = turn.actions[i];
      if (a.category === 'roll' && a.icon === 'roll') return false;
      if (a.devCard === 'knight') return true;
    }
    return false;
  };
  // Year of Plenty is "open" for the two picks that follow it.
  const plentyOpen = (): boolean => {
    let picked = 0;
    for (let i = turn.actions.length - 1; i >= 0; i--) {
      const a = turn.actions[i];
      if (a.category === 'roll' && a.icon === 'roll') return false;
      if (a.devCard === 'yearOfPlenty') return picked < 2;
      if (a.text.startsWith('Year of Plenty: picked')) picked++;
    }
    return false;
  };
  let monopolyLogged = false;

  // Aggregate productions per player so every player's resource gains show with RS card icons
  const productionsByPlayer = new Map<string, Record<string, number>>();
  const bankGiveMap: Record<string, number> = {};
  const bankGetMap: Record<string, number> = {};
  const p2pGiveMap: Record<string, number> = {};
  const p2pGetMap: Record<string, number> = {};
  let p2pPartnerName = '';
  const discardByPlayer = new Map<string, Record<string, number>>();
  const monopolyMap: Record<string, number> = {};

  for (const ev of events) {
    const d = ev.data ?? {};
    switch (ev.type) {
      case 'rolled': {
        const sum = d.sum ?? (d.d1 + d.d2);
        const d1 = d.d1 ?? Math.floor(sum / 2);
        const d2 = d.d2 ?? (sum - d1);
        if (sum === 7) {
          turnSummary.actions.push({
            category: 'roll',
            icon: 'roll',
            diceSum: 7,
            badge: '7',
            text: 'Rolled 7 — Robber activated',
            timestamp: now
          });
        } else {
          turnSummary.actions.push({
            category: 'roll',
            icon: 'roll',
            diceSum: sum,
            badge: String(sum),
            text: `Rolled ${sum} (${d1} + ${d2})`,
            timestamp: now
          });
        }
        break;
      }

      case 'produced': {
        const pid = d.playerId || playerId;
        if (d.resource && d.amount > 0) {
          const map = productionsByPlayer.get(pid) || {};
          map[d.resource] = (map[d.resource] || 0) + d.amount;
          productionsByPlayer.set(pid, map);
        }
        break;
      }

      case 'built': {
        const piece = d.piece || payload?.piece || 'settlement';
        let text = 'Built piece';
        let badge = piece;
        if (piece === 'settlement') {
          text = isSetup ? 'Placed initial Settlement' : 'Built Settlement';
          badge = 'Settlement';
        } else if (piece === 'city') {
          text = 'Upgraded to City';
          badge = 'City';
        } else if (piece === 'road') {
          text = isSetup ? 'Placed initial Road' : 'Built Road';
          badge = 'Road';
        } else if (piece === 'bridge') {
          text = 'Built Bridge';
          badge = 'Bridge';
        } else if (piece === 'rickety_bridge') {
          text = 'Built Rickety Bridge';
          badge = 'Rickety Bridge';
        } else if (piece === 'net') {
          text = 'Placed Fishing Net';
          badge = 'Net';
        } else {
          text = `Built ${piece}`;
          badge = piece;
        }
        turnSummary.actions.push({
          category: 'build',
          icon: piece,
          piece,
          badge,
          text,
          timestamp: now
        });
        break;
      }

      case 'robberMoved': {
        // Bug 15: do not log "Moved Robber to hex #..." in the live log; only log who robbed who on steal.
        break;
      }

      case 'transferred': {
        const amt = Number(d.amount) || 1;
        const res = d.resource || '';
        if (d.kind === 'steal') {
          const victim = g.players.find(x => x.id === d.from);
          const victimName = victim?.name || d.from || 'player';
          turnSummary.actions.push({
            category: 'rob',
            icon: 'steal',
            badge: 'Rob',
            resources: [{ resource: 'mystery', amount: amt, sign: '+' }],
            text: knightOpen() ? `Knight stole from ${victimName}` : `Robbed from ${victimName}`,
            timestamp: now
          });
        } else if (d.kind === 'discard') {
          const discId = d.from || playerId;
          const map = discardByPlayer.get(discId) || {};
          const key = res || 'mystery';
          map[key] = (map[key] || 0) + amt;
          discardByPlayer.set(discId, map);
        } else if (d.kind === 'playerTrade') {
          const partnerId = d.from === playerId ? d.to : d.from;
          const partner = g.players.find(x => x.id === partnerId);
          if (partner?.name) p2pPartnerName = partner.name;
          if (res) {
            if (d.from === playerId) p2pGiveMap[res] = (p2pGiveMap[res] || 0) + amt;
            else p2pGetMap[res] = (p2pGetMap[res] || 0) + amt;
          }
        } else if (d.kind === 'bankTrade') {
          if (res) {
            if (d.from === playerId) bankGiveMap[res] = (bankGiveMap[res] || 0) + amt;
            else if (d.to === playerId) bankGetMap[res] = (bankGetMap[res] || 0) + amt;
          }
        } else if (d.kind === 'monopoly') {
          if (res) monopolyMap[res] = (monopolyMap[res] || 0) + amt;
        } else if (d.kind === 'pick' || d.kind === 'gold') {
          if (res) {
            turnSummary.actions.push({
              category: 'produce',
              icon: res,
              badge: `+${amt}`,
              resources: [{ resource: res, amount: amt, sign: '+' }],
              text: plentyOpen()
                ? `Year of Plenty: picked ${RESOURCE_NAMES[res] || res}`
                : `Picked ${RESOURCE_NAMES[res] || res}`,
              timestamp: now
            });
          }
        }
        break;
      }

      case 'devBought': {
        turnSummary.actions.push({
          category: 'dev',
          icon: 'dev',
          devCard: 'back',
          badge: 'Dev Card',
          text: 'Bought Development Card',
          timestamp: now
        });
        break;
      }

      case 'devPlayed': {
        const card = d.card || payload?.card || 'dev';
        let cardTitle = 'Development Card';
        if (card === 'knight') cardTitle = 'Knight';
        else if (card === 'roadBuilding') cardTitle = 'Road Building';
        else if (card === 'yearOfPlenty') cardTitle = 'Year of Plenty';
        else if (card === 'monopoly') cardTitle = 'Monopoly';
        let text = `Played ${cardTitle}`;
        let resources: TurnActionResource[] | undefined;
        if (card === 'monopoly') {
          // Which resource, and how many cards came in, are known from this action's own transfers.
          const grabs = events.filter(e => e.type === 'transferred' && e.data?.kind === 'monopoly');
          const res: string = payload?.resource || grabs[0]?.data?.resource || '';
          const taken = grabs
            .filter(e => !res || e.data?.resource === res)
            .reduce((s, e) => s + (Number(e.data?.amount) || 0), 0);
          if (res) text = `Played Monopoly on ${RESOURCE_NAMES[res] || res}${taken > 0 ? '' : ' (nothing taken)'}`;
          if (res && taken > 0) resources = [{ resource: res, amount: taken, sign: '+' }];
          monopolyLogged = true;
        } else if (card === 'roadBuilding') {
          text = 'Played Road Building (2 free roads)';
        }
        turnSummary.actions.push({
          category: 'dev',
          icon: card,
          devCard: card,
          badge: cardTitle,
          resources,
          text,
          timestamp: now
        });
        break;
      }

      case 'bridgeUpgraded': {
        turnSummary.actions.push({
          category: 'build',
          icon: 'bridge',
          piece: 'bridge',
          badge: 'Bridge',
          text: 'Upgraded Rickety Bridge to Bridge',
          timestamp: now
        });
        break;
      }

      case 'bridgeDemolished': {
        const resList: TurnActionResource[] = Object.entries((d.resources || {}) as Record<string, number>)
          .filter(([, n]) => n > 0)
          .map(([resource, amount]) => ({ resource, amount, sign: '+' as const }));
        turnSummary.actions.push({
          category: 'build',
          icon: 'bridge',
          piece: 'bridge',
          badge: 'Demolish',
          resources: resList.length > 0 ? resList : undefined,
          text: `Demolished ${d.piece === 'rickety_bridge' ? 'Rickety Bridge' : 'Bridge'}`,
          timestamp: now
        });
        break;
      }

      case 'harborUpgraded': {
        turnSummary.actions.push({
          category: 'build',
          icon: 'harbor',
          piece: 'harbor',
          badge: 'Harbor',
          text: 'Upgraded port city to 1:1 Harbor',
          timestamp: now
        });
        break;
      }

      case 'portUpgraded': {
        turnSummary.actions.push({
          category: 'build',
          icon: 'harbor',
          piece: 'harbor',
          badge: '2:1 Port',
          text: 'Raised 3:1 port to 2:1',
          timestamp: now
        });
        break;
      }

      case 'netPlaced': {
        turnSummary.actions.push({
          category: 'build',
          icon: 'net',
          piece: 'net',
          badge: 'Net',
          text: d.doubleCost ? 'Placed Fishing Net (2× cost)' : 'Placed Fishing Net',
          timestamp: now
        });
        break;
      }

      case 'seaFed': {
        turnSummary.actions.push({
          category: 'produce',
          icon: 'fish',
          badge: 'Feed Sea',
          resources: [{ resource: 'wheat', amount: 1, sign: '-' }],
          text: `Fed fishing ground on tile #${d.hexId}`,
          timestamp: now
        });
        break;
      }

      case 'techResearched': {
        const techName = d.name || d.techId || 'Tech';
        turnSummary.actions.push({
          category: 'dev',
          icon: 'tech',
          badge: 'Tech',
          text: `Researched ${techName}`,
          timestamp: now
        });
        break;
      }

      case 'pieceBroken': {
        const pieceLabel = d.piece === 'rickety_bridge' ? 'Rickety Bridge' : (d.piece || 'Piece');
        const owner = g.players.find(x => x.id === d.ownerId);
        turnSummary.actions.push({
          category: 'event',
          icon: 'bridge',
          piece: d.piece || 'bridge',
          badge: 'Collapsed',
          text: owner ? `${owner.name}'s ${pieceLabel} collapsed` : `${pieceLabel} collapsed`,
          timestamp: now
        });
        break;
      }

      case 'pirateSpawned': {
        turnSummary.actions.push({
          category: 'event',
          icon: 'pirate',
          badge: `Strength ${d.strength}`,
          text: `Pirate ship appeared on tile #${d.hexId}`,
          timestamp: now
        });
        break;
      }

      case 'pirateRobbed': {
        const victim = g.players.find(x => x.id === d.victimId);
        const n = Number(d.amount) || 0;
        turnSummary.actions.push({
          category: 'rob',
          icon: 'pirate',
          badge: n > 0 ? `-${n}` : 'Raid',
          resources: n > 0 ? [{ resource: 'mystery', amount: n, sign: '-' }] : undefined,
          text: n > 0
            ? `Pirates robbed ${victim?.name || 'a player'}`
            : `Pirates raided ${victim?.name || 'a player'} (no cards)`,
          timestamp: now
        });
        break;
      }

      case 'pirateFleeing': {
        turnSummary.actions.push({
          category: 'event',
          icon: 'pirate',
          badge: 'Fleeing',
          text: 'Pirate ship fled for open water',
          timestamp: now
        });
        break;
      }

      case 'pirateDriven': {
        const driver = g.players.find(x => x.id === d.playerId);
        const amt = Number(d.amount) || 0;
        turnSummary.actions.push({
          category: 'event',
          icon: 'pirate',
          badge: 'Pirate',
          resources: d.resource && amt > 0 ? [{ resource: d.resource, amount: amt, sign: '+' }] : undefined,
          text: `${driver?.name || 'Player'} drove off pirate (str ${d.strength})`,
          timestamp: now
        });
        break;
      }

      case 'awardChanged': {
        const name = d.award === 'longestRoad' ? 'Longest Road' : d.award === 'largestArmy' ? 'Largest Army' : d.award;
        const val = d.value ?? d.count;
        const winner = d.playerId ? g.players.find(x => x.id === d.playerId) : null;
        const prev = d.previousHolderId ? g.players.find(x => x.id === d.previousHolderId) : null;
        const text = d.playerId
          ? `${winner && winner.id !== playerId ? `${winner.name} claimed` : 'Claimed'} ${name}${val !== undefined ? ` (${val})` : ''}`
          : `${prev ? `${prev.name} lost` : 'Lost'} ${name}`;
        turnSummary.actions.push({
          category: 'award',
          icon: 'award',
          badge: name,
          text,
          timestamp: now
        });
        break;
      }

      case 'eventDrawn': {
        turnSummary.actions.push({
          category: 'event',
          icon: 'event',
          badge: d.title || 'Event',
          text: `Event: ${d.title}`,
          timestamp: now
        });
        break;
      }

      case 'gameOver': {
        const winner = g.players.find(x => x.id === d.winnerId);
        turnSummary.actions.push({
          category: 'award',
          icon: 'winner',
          badge: 'Winner',
          text: `${winner?.name || 'Player'} won the game!`,
          timestamp: now
        });
        break;
      }
    }
  }

  // Push consolidated production actions (actor first, then any other players who produced on this roll)
  const orderedProdPids = [
    ...(productionsByPlayer.has(playerId) ? [playerId] : []),
    ...[...productionsByPlayer.keys()].filter(id => id !== playerId)
  ];
  for (const pid of orderedProdPids) {
    const prodMap = productionsByPlayer.get(pid)!;
    const prodEntries = Object.entries(prodMap).filter(([, a]) => a > 0);
    if (prodEntries.length === 0) continue;
    const prodPlayer = g.players.find(x => x.id === pid);
    const total = prodEntries.reduce((s, [, a]) => s + a, 0);
    const resources: TurnActionResource[] = prodEntries.map(([resource, amount]) => ({
      resource,
      amount,
      sign: '+'
    }));
    const label = pid === playerId ? 'Produced' : `${prodPlayer?.name || 'Player'} got`;
    turnSummary.actions.push({
      category: 'produce',
      icon: prodEntries[0][0],
      badge: `+${total}`,
      resources,
      text: label,
      timestamp: now
    });
  }

  // Push consolidated discards
  for (const [discId, discMap] of discardByPlayer.entries()) {
    const entries = Object.entries(discMap).filter(([, a]) => a > 0);
    if (entries.length === 0) continue;
    const discPlayer = g.players.find(x => x.id === discId);
    const total = entries.reduce((s, [, a]) => s + a, 0);
    const resources: TurnActionResource[] = entries.map(([resource, amount]) => ({
      resource,
      amount,
      sign: '-'
    }));
    turnSummary.actions.push({
      category: 'discard',
      icon: entries[0][0],
      badge: `-${total}`,
      resources,
      text: `${discPlayer?.name || 'Player'} discarded`,
      timestamp: now
    });
  }

  // Push consolidated Bank Trade
  const bankGiveEntries = Object.entries(bankGiveMap);
  const bankGetEntries = Object.entries(bankGetMap);
  if (bankGiveEntries.length > 0 || bankGetEntries.length > 0) {
    const resources: TurnActionResource[] = [
      ...bankGiveEntries.map(([resource, amount]) => ({ resource, amount, sign: '-' as const })),
      ...bankGetEntries.map(([resource, amount]) => ({ resource, amount, sign: '+' as const }))
    ];
    turnSummary.actions.push({
      category: 'trade',
      icon: 'bank',
      badge: 'Bank',
      resources,
      text: 'Bank trade',
      timestamp: now
    });
  }

  // Push consolidated Player Trade
  const p2pGiveEntries = Object.entries(p2pGiveMap);
  const p2pGetEntries = Object.entries(p2pGetMap);
  if (p2pGiveEntries.length > 0 || p2pGetEntries.length > 0) {
    const resources: TurnActionResource[] = [
      ...p2pGiveEntries.map(([resource, amount]) => ({ resource, amount, sign: '-' as const })),
      ...p2pGetEntries.map(([resource, amount]) => ({ resource, amount, sign: '+' as const }))
    ];
    turnSummary.actions.push({
      category: 'trade',
      icon: 'trade',
      badge: 'Player Trade',
      resources,
      text: `Traded with ${p2pPartnerName || 'player'}`,
      timestamp: now
    });
  }

  // Push consolidated Monopoly
  for (const [res, amt] of Object.entries(monopolyMap)) {
    if (monopolyLogged || amt <= 0) continue;
    turnSummary.actions.push({
      category: 'dev',
      icon: 'monopoly',
      devCard: 'monopoly',
      badge: 'Monopoly',
      resources: [{ resource: res, amount: amt, sign: '+' }],
      text: `Monopolized ${RESOURCE_NAMES[res] || res}`,
      timestamp: now
    });
  }

  const recordedHere = turn.actions.length - actionsBefore;

  // If action was endTurn and no other actions happened this turn, log passed turn
  if ((actionType === 'endTurn' || actionType === 'end_turn') && turn.actions.length === 0) {
    turn.actions.push({
      category: 'roll',
      icon: 'pass',
      badge: 'Pass',
      text: 'Passed turn',
      timestamp: now
    });
  }

  // Announcements with no event of their own (turn order, tides, a bot taking a seat) join the same stream.
  // When the action recorded something, its lines say the same thing, so they are dropped. Trade chatter and robber moves stay out.
  const isRobberMove =
    actionType === 'move_robber' ||
    actionType === 'moveRobber' ||
    events.some(e => e?.type === 'robberMoved');
  if (recordedHere === 0 && !TRADE_ACTIONS.has(actionType) && !isRobberMove) {
    for (const n of notes) {
      const text = String(n?.text ?? '').trim();
      if (!text) continue;
      turn.actions.push({ category: 'event', icon: 'event', text, timestamp: now });
    }
  }

  // A turn that recorded nothing is not a turn (a player only answering a trade, say): do not leave an empty card behind.
  if (createdTurn && turn.actions.length === 0) {
    const idx = roundSummary.turns.indexOf(turn);
    if (idx >= 0) roundSummary.turns.splice(idx, 1);
  }
}
