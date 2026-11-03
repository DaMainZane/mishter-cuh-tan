// MODULE: WebAudio sound effects (tones, dice roll, discard, your turn, victory fanfare) and the sound toggle | DEPENDS ON: client/icons, client/store | USED BY: client/actions, client/main, client/mapmenu, client/pieceui, client/presets, client/render/board, +7 more
import { soundOn, setSoundOn } from './store';
import { uiIcon } from './icons';

const audioCtx: AudioContext =
  typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)
    ? new (window.AudioContext || (window as any).webkitAudioContext)()
    : (null as any);

function ensureAudio(): boolean {
  if (!soundOn || !audioCtx) return false;
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return true;
  } catch (e) {
    return false;
  }
}

export function playTone(freq = 440, dur = 0.09, type: OscillatorType = 'sine', vol = 0.11): void {
  if (!ensureAudio()) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}

function playNoiseBurst(dur = 0.05, filterFreq = 1200, q = 2.0, vol = 0.12, delaySec = 0): void {
  if (!ensureAudio()) return;
  try {
    const startAt = audioCtx.currentTime + delaySec;
    const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.45));
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, startAt);
    filter.Q.setValueAtTime(q, startAt);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(vol, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start(startAt);
    noise.stop(startAt + dur);
  } catch (e) {}
}

function playPitchSweep(
  startFreq: number,
  endFreq: number,
  dur: number,
  type: OscillatorType = 'triangle',
  vol = 0.14,
  delaySec = 0
): void {
  if (!ensureAudio()) return;
  try {
    const t0 = audioCtx.currentTime + delaySec;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  } catch (e) {}
}

// Colonist-style rattling dice roll + 7 robber alert or normal chime
export function playDiceRollSound(sum?: number): void {
  if (!ensureAudio()) return;
  const taps = [0, 0.055, 0.115, 0.18, 0.25];
  taps.forEach((delay, idx) => {
    playNoiseBurst(0.04, 1500 + idx * 180, 3.0, 0.13, delay);
    playPitchSweep(320 + idx * 35, 170 + idx * 20, 0.045, 'triangle', 0.1, delay);
  });
  if (sum === 7) {
    // Menacing 7-rolled robber horn/thud
    playPitchSweep(220, 110, 0.34, 'sawtooth', 0.12, 0.3);
    playPitchSweep(165, 82.5, 0.38, 'triangle', 0.16, 0.32);
  } else {
    playPitchSweep(523.25, 659.25, 0.12, 'sine', 0.1, 0.3);
  }
}

// Warm two-note notification chime when the turn passes to you
export function playYourTurnSound(): void {
  if (!ensureAudio()) return;
  playPitchSweep(587.33, 587.33, 0.13, 'triangle', 0.15, 0);
  playPitchSweep(1174.66, 1174.66, 0.11, 'sine', 0.06, 0);
  playPitchSweep(880.0, 880.0, 0.24, 'triangle', 0.17, 0.1);
  playPitchSweep(1760.0, 1760.0, 0.18, 'sine', 0.06, 0.1);
}

// Crisp Colonist wooden block clack when placing a Road
export function playPlaceRoadSound(): void {
  if (!ensureAudio()) return;
  playNoiseBurst(0.045, 950, 2.5, 0.14, 0);
  playPitchSweep(290, 135, 0.085, 'triangle', 0.16, 0);
  playPitchSweep(580, 380, 0.06, 'sine', 0.08, 0.02);
}

// Splintering wood snap + water splash when a rickety bridge collapses on a 7 (T4f)
export function playBridgeCollapseSound(): void {
  if (!ensureAudio()) return;
  playNoiseBurst(0.065, 1350, 2.8, 0.16, 0);
  playPitchSweep(360, 110, 0.14, 'sawtooth', 0.12, 0.01);
  playNoiseBurst(0.14, 620, 1.4, 0.15, 0.09);
  playPitchSweep(190, 68, 0.22, 'triangle', 0.14, 0.08);
}

// Distinct ocean maelstrom splash vs shore surf crash when a shipwreck spawns (T9e)
export function playWreckSpawnSound(site: 'sea' | 'shore' = 'sea'): void {
  if (!ensureAudio()) return;
  if (site === 'sea') {
    playNoiseBurst(0.16, 540, 1.6, 0.15, 0);
    playPitchSweep(240, 92, 0.26, 'sine', 0.14, 0.02);
    playPitchSweep(330, 165, 0.18, 'triangle', 0.1, 0.11);
  } else {
    playNoiseBurst(0.18, 880, 1.8, 0.15, 0);
    playPitchSweep(310, 145, 0.18, 'triangle', 0.14, 0.03);
  }
}

// Warm Colonist wooden pop + two-note build chime when placing a Settlement
export function playPlaceSettlementSound(): void {
  if (!ensureAudio()) return;
  playNoiseBurst(0.05, 820, 2.2, 0.14, 0);
  playPitchSweep(220, 120, 0.09, 'triangle', 0.15, 0);
  playPitchSweep(440, 440, 0.1, 'triangle', 0.12, 0.03);
  playPitchSweep(659.25, 659.25, 0.15, 'triangle', 0.13, 0.1);
}

// Grand Colonist 3-note triad + stone thud when upgrading to a City
export function playPlaceCitySound(): void {
  if (!ensureAudio()) return;
  playNoiseBurst(0.06, 700, 2.0, 0.15, 0);
  playPitchSweep(392.0, 392.0, 0.11, 'triangle', 0.13, 0.02);
  playPitchSweep(523.25, 523.25, 0.12, 'triangle', 0.13, 0.09);
  playPitchSweep(783.99, 783.99, 0.22, 'triangle', 0.15, 0.16);
}

// Heavy Colonist bass thud when moving/placing the Robber on a tile
export function playPlaceRobberSound(): void {
  if (!ensureAudio()) return;
  playNoiseBurst(0.11, 360, 1.4, 0.18, 0);
  playPitchSweep(185, 58, 0.24, 'triangle', 0.2, 0);
  playPitchSweep(130, 48, 0.26, 'sawtooth', 0.09, 0.02);
}

// Card swipe whoosh + sting when a resource card is stolen
export function playStealCardSound(isVictim = false): void {
  if (!ensureAudio()) return;
  playNoiseBurst(0.09, 1800, 1.8, 0.14, 0);
  if (isVictim) {
    // Alert descending minor interval when YOUR card gets stolen
    playPitchSweep(415.3, 392.0, 0.12, 'sawtooth', 0.11, 0.02);
    playPitchSweep(311.13, 246.94, 0.22, 'triangle', 0.15, 0.12);
  } else {
    // Sneaky rising pluck when stealing a card
    playPitchSweep(330, 493.88, 0.11, 'triangle', 0.12, 0.03);
    playPitchSweep(587.33, 659.25, 0.13, 'sine', 0.1, 0.11);
  }
}

// Cascading card-slide sound when getting discarded or discarding cards on a 7
export function playDiscardSound(): void {
  if (!ensureAudio()) return;
  [0, 0.07, 0.14].forEach((d, i) => {
    playNoiseBurst(0.055, 1600 - i * 250, 2.0, 0.12, d);
    playPitchSweep(460 - i * 75, 280 - i * 50, 0.09, 'triangle', 0.11, d);
  });
}

// Cheerful Colonist card swap + double bell when completing a trade
export function playTradeSound(): void {
  if (!ensureAudio()) return;
  playNoiseBurst(0.06, 2000, 2.0, 0.1, 0);
  playPitchSweep(523.25, 587.33, 0.11, 'triangle', 0.12, 0.02);
  playPitchSweep(783.99, 880.0, 0.18, 'sine', 0.13, 0.11);
}

// Mystical card draw arpeggio when buying a Development Card
export function playBuyDevCardSound(): void {
  if (!ensureAudio()) return;
  playNoiseBurst(0.055, 2200, 2.2, 0.1, 0);
  const notes = [440, 554.37, 659.25, 880];
  notes.forEach((f, idx) => {
    playPitchSweep(f, f * 1.02, 0.12, 'triangle', 0.11, idx * 0.055);
  });
}

// Triumphant brass fanfare when claiming or stealing Longest Road / Largest Army
export function playAwardSound(isStolen = false): void {
  if (!ensureAudio()) return;
  playNoiseBurst(0.08, 900, 1.6, 0.14, 0);
  const notes = isStolen ? [392.0, 466.16, 587.33, 783.99] : [392.0, 493.88, 587.33, 783.99];
  notes.forEach((f, idx) => {
    playPitchSweep(f * 0.99, f, 0.22, 'triangle', 0.14, idx * 0.085);
    playPitchSweep(f * 0.5, f * 0.5, 0.24, 'sawtooth', 0.06, idx * 0.085);
  });
}

// Confetti pop + celebratory victory fanfare chord progression when a player reaches the VP threshold
export function playVictoryFanfareSound(): void {
  if (!ensureAudio()) return;
  // Dual confetti cannon pops
  playNoiseBurst(0.09, 1400, 1.5, 0.16, 0);
  playNoiseBurst(0.09, 1750, 1.6, 0.14, 0.18);
  // Rising C-major -> G -> C6 fanfare
  const fanfare: { freq: number; delay: number; dur: number; vol: number }[] = [
    { freq: 523.25, delay: 0.02, dur: 0.14, vol: 0.13 },
    { freq: 659.25, delay: 0.13, dur: 0.14, vol: 0.13 },
    { freq: 783.99, delay: 0.24, dur: 0.16, vol: 0.14 },
    { freq: 1046.5, delay: 0.37, dur: 0.42, vol: 0.16 },
    { freq: 783.99, delay: 0.37, dur: 0.42, vol: 0.1 },
    { freq: 659.25, delay: 0.37, dur: 0.42, vol: 0.09 }
  ];
  for (const n of fanfare) {
    playPitchSweep(n.freq * 0.995, n.freq, n.dur, 'triangle', n.vol, n.delay);
  }
}

export function toggleSound(): void {
  setSoundOn(!soundOn);
  document.getElementById('btnToggleSound')!.innerHTML = uiIcon(soundOn ? 'sound' : 'mute');
}

