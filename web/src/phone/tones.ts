// Call progress tones synthesized with WebAudio (no audio assets needed).

const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

export class Tones {
  private ctx: AudioContext | null = null;
  private loop: number | undefined;
  private active: OscillatorNode[] = [];

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private play(freqs: number[], seconds: number, volume = 0.07, delay = 0): void {
    const ctx = this.context();
    const gain = ctx.createGain();
    const start = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.setValueAtTime(volume, start + seconds - 0.02);
    gain.gain.linearRampToValueAtTime(0, start + seconds);
    gain.connect(ctx.destination);
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + seconds);
      this.active.push(osc);
      osc.onended = () => {
        this.active = this.active.filter((o) => o !== osc);
      };
    }
  }

  /** Incoming call: double ring every 3 s. */
  startRingtone(): void {
    this.stop();
    const ring = () => {
      this.play([440, 480], 0.4, 0.09);
      this.play([440, 480], 0.4, 0.09, 0.6);
    };
    ring();
    this.loop = window.setInterval(ring, 3000);
  }

  /** Outgoing call waiting for answer. */
  startRingback(): void {
    this.stop();
    const tone = () => this.play([440, 480], 1.8, 0.05);
    tone();
    this.loop = window.setInterval(tone, 5000);
  }

  dtmf(digit: string): void {
    const pair = DTMF[digit];
    if (pair) this.play(pair, 0.12, 0.05);
  }

  hangup(): void {
    this.stop();
    this.play([480, 620], 0.25, 0.05);
    this.play([480, 620], 0.25, 0.05, 0.5);
  }

  stop(): void {
    window.clearInterval(this.loop);
    this.loop = undefined;
    for (const osc of this.active) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    }
    this.active = [];
  }
}
