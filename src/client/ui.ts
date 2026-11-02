// MODULE: small UI actions (theme switch, toast, victory confetti overlay) | DEPENDS ON: none | USED BY: client/actions, client/debug, client/main, client/mapmenu, client/pieceui, client/presets, +2 more

export function toggleTheme(): void {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch (e) { /* storage may be blocked */ }
}

let toastTimer: number | undefined;

// Replaces alert(): a quiet message at the bottom of the screen.
export function showToast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { if (el) el.style.display = 'none'; }, 3200);
}

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  angle: number;
  vAngle: number;
  tilt: number;
  vTilt: number;
  alpha: number;
}

let confettiRafId = 0;

export function clearVictoryConfetti(): void {
  if (confettiRafId) {
    cancelAnimationFrame(confettiRafId);
    confettiRafId = 0;
  }
  document.getElementById('confettiOverlay')?.remove();
}

export function triggerVictoryConfetti(winnerColor?: string): void {
  clearVictoryConfetti();
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'confettiOverlay';
  canvas.className = 'confetti-overlay';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }

  // Render at 1x CSS pixel resolution (max 1280px wide) so high-DPI screens never lag
  const scale = Math.min(1, 1280 / Math.max(1, window.innerWidth));
  canvas.width = Math.round(window.innerWidth * scale);
  canvas.height = Math.round(window.innerHeight * scale);

  const palette = [
    winnerColor || '#d9893b',
    '#d9893b',
    '#e2c56b',
    '#a9c27a',
    '#5f8a5a',
    '#c0674a',
    '#6ca6c4',
    '#f4f1ea'
  ];

  const pieces: ConfettiPiece[] = [];
  const spawnBurst = (originX: number, originY: number, count: number, spreadRad: number, baseAngle: number) => {
    for (let i = 0; i < count; i++) {
      const a = baseAngle + (Math.random() - 0.5) * spreadRad;
      const speed = (8 + Math.random() * 12) * scale;
      pieces.push({
        x: originX + (Math.random() - 0.5) * 24,
        y: originY + (Math.random() - 0.5) * 16,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 1.5 * scale,
        w: (7 + Math.random() * 6) * scale,
        h: (4 + Math.random() * 5) * scale,
        color: palette[i % palette.length],
        angle: Math.random() * Math.PI * 2,
        vAngle: (Math.random() - 0.5) * 0.14,
        tilt: Math.random() * Math.PI * 2,
        vTilt: 0.08 + Math.random() * 0.12,
        alpha: 1
      });
    }
  };

  const W = canvas.width;
  const H = canvas.height;
  spawnBurst(W * 0.15, H * 0.68, 28, 0.85, -Math.PI * 0.36);
  spawnBurst(W * 0.85, H * 0.68, 28, 0.85, -Math.PI * 0.64);
  spawnBurst(W * 0.5, H * 0.2, 24, Math.PI, -Math.PI * 0.5);

  const startTime = performance.now();
  const grav = 0.25 * scale;

  const tick = (now: number) => {
    const elapsed = now - startTime;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    let alive = 0;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.alpha <= 0.03 || p.y > H + 20) continue;
      alive++;

      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + grav;
      p.angle += p.vAngle;
      p.tilt += p.vTilt;
      if (elapsed > 1600) p.alpha -= 0.018;

      const cosA = Math.cos(p.angle);
      const sinA = Math.sin(p.angle);
      const tiltScale = Math.cos(p.tilt);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.setTransform(cosA, sinA, -sinA * tiltScale, cosA * tiltScale, p.x, p.y);
      ctx.fillRect(-p.w * 0.5, -p.h * 0.5, p.w, p.h);
    }

    if (alive > 0 && elapsed < 2800) {
      confettiRafId = requestAnimationFrame(tick);
    } else {
      clearVictoryConfetti();
    }
  };

  confettiRafId = requestAnimationFrame(tick);
}


