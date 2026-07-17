const DEFAULT_INTERVAL_MS = 1650;
const ALLOWED_SPEEDS = new Set([0.5, 1, 2]);

export async function loadGoldenFixture(url, fetcher = fetch) {
  const response = await fetcher(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Fixture request failed with HTTP ${response.status}.`);
  const fixture = await response.json();
  if (!fixture || (typeof fixture !== 'object' && !Array.isArray(fixture))) {
    throw new Error('Fixture response is not a JSON object.');
  }
  return fixture;
}

export class FixtureReplay {
  #events;
  #onEvent;
  #onRestart;
  #onChange;
  #timer = null;
  #cursor = 0;
  #speed = 1;
  #isPlaying = false;

  constructor(events, { onEvent, onRestart = () => {}, onChange = () => {} }) {
    if (!Array.isArray(events)) throw new TypeError('FixtureReplay events must be an array.');
    if (typeof onEvent !== 'function') throw new TypeError('FixtureReplay requires onEvent.');
    this.#events = [...events];
    this.#onEvent = onEvent;
    this.#onRestart = onRestart;
    this.#onChange = onChange;
  }

  get isPlaying() {
    return this.#isPlaying;
  }

  get hasNext() {
    return this.#cursor < this.#events.length;
  }

  get cursor() {
    return this.#cursor;
  }

  play() {
    if (this.#isPlaying || !this.hasNext) return;
    this.#isPlaying = true;
    this.#onChange();
    this.#schedule(0);
  }

  pause() {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#isPlaying = false;
    this.#onChange();
  }

  toggle() {
    if (this.#isPlaying) this.pause();
    else this.play();
  }

  next() {
    if (!this.hasNext) {
      this.pause();
      return false;
    }
    const accepted = this.#onEvent(this.#events[this.#cursor]);
    if (accepted === false) {
      this.pause();
      return false;
    }
    this.#cursor += 1;
    if (!this.hasNext) this.pause();
    else this.#onChange();
    return true;
  }

  restart() {
    this.pause();
    this.#cursor = 0;
    this.#onRestart();
    this.#onChange();
  }

  setSpeed(speed) {
    if (!ALLOWED_SPEEDS.has(speed)) throw new RangeError('Replay speed must be 0.5, 1, or 2.');
    this.#speed = speed;
    if (this.#isPlaying) {
      if (this.#timer !== null) clearTimeout(this.#timer);
      this.#schedule();
    }
    this.#onChange();
  }

  #schedule(delay = DEFAULT_INTERVAL_MS / this.#speed) {
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const advanced = this.next();
      if (advanced && this.#isPlaying && this.hasNext) this.#schedule();
    }, delay);
  }
}
