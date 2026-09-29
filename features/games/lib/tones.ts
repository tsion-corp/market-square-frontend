/*
  THE SOUND OF SIMON.

  Simon is a memory game with an audio channel: the tone is a second way to
  remember the sequence, and players lean on it more than they realise. A
  silent Simon is measurably harder, so this is part of the game rather than
  decoration.

  Built with an oscillator rather than audio files: five short tones as assets
  would be five network requests before a player can press anything, and the
  first round would play in silence while they loaded.

  EVERYTHING HERE FAILS QUIETLY. Audio is the most likely thing to be blocked,
  unavailable or asleep, and a game that throws because it could not beep is a
  broken game. Every call is guarded and returns nothing on failure.
*/

/** One tone per pad. A major pentatonic run, so a sequence is never dissonant
    however the pads fall — the real Simon's tones are chosen the same way. */
const PAD_HZ = [329.63, 261.63, 392.0, 440.0, 523.25];

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    // Safari needs the prefixed constructor; both are absent in a test runner.
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    context ??= new Ctor();
    return context;
  } catch {
    return null;
  }
}

/**
 * Wake the audio device on a real user gesture.
 *
 * Browsers start an AudioContext suspended and only allow it to resume inside
 * a genuine interaction. Called from the tap that starts a game, so the first
 * flash of the first round already has sound — without this the player hears
 * nothing until they press a pad, by which point the sequence is over.
 */
export function primeTones(): void {
  const ctx = audioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

/**
 * Play a pad's tone.
 *
 * Ramped rather than switched: a square edge on a gain node is an audible
 * click, and five clicks a second is what a cheap toy sounds like.
 */
export function playPadTone(pad: number, durationMs: number): void {
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return;
  const hz = PAD_HZ[pad];
  if (!hz) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = hz;

    const now = ctx.currentTime;
    const seconds = Math.max(0.05, durationMs / 1000);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.012);
    gain.gain.setValueAtTime(0.18, now + seconds - 0.03);
    gain.gain.linearRampToValueAtTime(0, now + seconds);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + seconds + 0.02);
  } catch {
    // A blocked or exhausted audio device must never interrupt a game.
  }
}

/** The buzz on a wrong pad — lower and detuned, so it reads as a mistake
    without a written message. */
export function playWrongTone(): void {
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 110;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  } catch {
    /* silent by design */
  }
}
