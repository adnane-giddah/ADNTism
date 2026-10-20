// A beat schedule that is mathematics first and sound second. Beat n happens at start + n·60000/BPM (ms,
// performance.now() clock — the same clock as input event timestamps). Audible clicks are scheduled ahead
// on the audio clock from that schedule; a missed timer can delay a click, never move a beat.
import { sfx } from './audio';
import { beatTime } from './scoring';

export class Metronome {
  start = 0;
  bpm = 100;
  private next = 0;
  private timer = 0;
  private audible: (n: number) => boolean = () => true;
  private last = Infinity;

  get period() {
    return 60000 / this.bpm;
  }

  /** Beat n time in ms. */
  at(n: number) {
    return beatTime(this.start, n, this.bpm);
  }

  /** Fractional beat index at time t. */
  pos(t: number) {
    return (t - this.start) / this.period;
  }

  /** The beat closest to t and the signed error (ms, positive = after the beat). */
  nearest(t: number) {
    const n = Math.round(this.pos(t));
    return { n, err: t - this.at(n) };
  }

  /**
   * Run beats from `start` (ms). `audible(n)` decides which beats click; `last` is the final beat index
   * (Infinity = until stopped).
   */
  run(start: number, bpm: number, audible: (n: number) => boolean = () => true, last = Infinity) {
    this.stop();
    this.start = start;
    this.bpm = bpm;
    this.audible = audible;
    this.last = last;
    this.next = Math.max(0, Math.ceil(this.pos(performance.now())));
    this.pump();
    this.timer = window.setInterval(this.pump, 90);
  }

  private pump = () => {
    const now = performance.now();
    // Schedule every beat in the next 250 ms that hasn't been scheduled yet.
    while (this.next <= this.last && this.at(this.next) < now + 250) {
      const at = (this.at(this.next) - now) / 1000;
      if (at > -0.01 && this.audible(this.next)) sfx.pulse(Math.max(0, at));
      this.next++;
    }
    if (this.next > this.last) this.stop();
  };

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
  }
}
