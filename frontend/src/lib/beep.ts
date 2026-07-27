let audioCtx: AudioContext | null = null;

/**
 * Must be called once from a user gesture (e.g. the "Démarrer" button
 * click) before beep() will reliably work - browsers block audio contexts
 * from starting without user interaction.
 */
export function initAudio(): void {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
}

/**
 * Bip "scanner de caisse" - son aigu, bref et net (type square wave ~2800Hz),
 * proche de celui des douchettes de supermarché (Honeywell/Symbol).
 */
export function beepSuccess(): void {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "square"; // plus "métallique"/net que sine, comme un vrai scanner
  osc.frequency.value = 2800;

  const now = audioCtx.currentTime;
  const duration = 0.08; // ~80ms, très bref

  // Attaque quasi instantanée puis coupure nette (pas de fondu doux)
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.25, now + 0.002);
  gain.gain.setValueAtTime(0.25, now + duration - 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.01);
}

/** Lower, shorter tone used for the "déjà scanné" case - distinguishable
 * from the success beep without being annoying since it fires rarely (only
 * transitions, not on every frame - see useScanLock). */
export function beepAlreadyScanned(): void {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = 400;
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.13);
}