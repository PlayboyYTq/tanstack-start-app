// Lightweight WebAudio sounds — no asset bundling required.
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

export function playMessageSound() {
  const c = getCtx();
  if (!c) return;
  try {
    const now = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, now);
    o.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    o.connect(g).connect(c.destination);
    o.start(now);
    o.stop(now + 0.27);
  } catch {
    // best-effort
  }
}

type LoopHandle = { stop: () => void };

function startLoopingTone(pattern: () => void, intervalMs: number): LoopHandle {
  pattern();
  const id = window.setInterval(pattern, intervalMs);
  return {
    stop: () => window.clearInterval(id),
  };
}

// Incoming-call ringtone — two-tone "bring bring" loop.
export function startRingtone(): LoopHandle {
  const c = getCtx();
  if (!c) return { stop: () => {} };
  const burst = () => {
    try {
      const now = c.currentTime;
      [0, 0.45].forEach((offset) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(520, now + offset);
        g.gain.setValueAtTime(0.0001, now + offset);
        g.gain.exponentialRampToValueAtTime(0.22, now + offset + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
        o.connect(g).connect(c.destination);
        o.start(now + offset);
        o.stop(now + offset + 0.4);
      });
    } catch {
      // ignore
    }
  };
  return startLoopingTone(burst, 2000);
}

// Outgoing-call ringback — single soft pulse loop.
export function startRingback(): LoopHandle {
  const c = getCtx();
  if (!c) return { stop: () => {} };
  const burst = () => {
    try {
      const now = c.currentTime;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(440, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.12, now + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      o.connect(g).connect(c.destination);
      o.start(now);
      o.stop(now + 0.65);
    } catch {
      // ignore
    }
  };
  return startLoopingTone(burst, 2500);
}
