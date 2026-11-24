/**
 * Langton's ant, generalized to any number of cell states.
 *
 * Each character in the rule describes what the ant does on that state:
 *   R = turn right, L = turn left, N = keep going, U = turn around.
 *
 * Cells are stored row-major, with y increasing upwards.
 */

export const DIR_VECTORS = [
  [0, 1], // north
  [1, 0], // east
  [0, -1], // south
  [-1, 0], // west
];

const TURNS = { R: 1, L: -1, N: 0, U: 2 };
const PATCH_RADIUS = 10;
const MAX_SEEN = 180_000;
const MAX_HISTORY = 320_000;
const MAX_CYCLE_PATH = 5_000;

export const RULE_PRESETS = [
  { name: 'Classic', rule: 'RL', note: 'The original. Finds its 104-step highway.' },
  { name: 'Tight orbit', rule: 'RR', note: 'An 8-step box, almost immediately.' },
  { name: 'Slow burn', rule: 'LRRRRRLLR', note: 'Nine states. A 374-step loop at ~29k.' },
  { name: 'Needle', rule: 'RRL', note: 'An 18-step glide across the grid.' },
  { name: 'Weave', rule: 'RRRL', note: 'A 52-step drift with a longer fuse.' },
  { name: 'Wanderer', rule: 'LLRR', note: 'Four states. No early loop in sight.' },
];

export function normalizeRule(value) {
  const rule = String(value).toUpperCase().replace(/[^RLNU]/g, '');
  if (rule.length < 2) throw new Error('A rule needs at least 2 states.');
  if (rule.length > 10) throw new Error('Keep rules to 10 states or fewer.');
  return rule;
}

export function randomRule() {
  const length = 2 + Math.floor(Math.random() * 5);
  const bag = ['R', 'L', 'R', 'L', 'R', 'L', 'N', 'U'];
  let rule = '';
  for (let i = 0; i < length; i += 1) {
    rule += bag[Math.floor(Math.random() * bag.length)];
  }
  return rule;
}

export function turnName(letter) {
  return { R: 'right', L: 'left', N: 'straight', U: 'back' }[letter] ?? 'right';
}

export class LangtonAnt {
  constructor({ size = 451, rule = 'RL' } = {}) {
    if (size % 2 === 0) throw new Error('Grid size should be odd.');
    this.size = size;
    this.center = Math.floor(size / 2);
    this.cellCount = size * size;
    this.rule = normalizeRule(rule);
    this.stateCount = this.rule.length;

    this.cells = new Uint8Array(this.cellCount);
    this.visits = new Uint16Array(this.cellCount);
    this.hues = new Float32Array(this.cellCount);

    this.reset();
  }

  setRule(value) {
    const rule = normalizeRule(value);
    this.rule = rule;
    this.stateCount = rule.length;
    this.reset();
  }

  reset() {
    this.cells.fill(0);
    this.visits.fill(0);
    this.hues.fill(0);

    this.x = this.center;
    this.y = this.center;
    this.dir = 0;
    this.steps = 0;
    this.visited = 0;
    this.edgeReached = false;

    this.minX = this.x;
    this.maxX = this.x;
    this.minY = this.y;
    this.maxY = this.y;

    this.changed = new Set();
    this.history = [this.pack(this.x, this.y)];
    this.seen = new Map();
    this.cycle = null;
    this.detectionStopped = false;
    this.patchRadius = PATCH_RADIUS;
  }

  pack(x, y) {
    return y * this.size + x;
  }

  /**
   * Advance one tick. Returns false when the ant would leave the grid.
   */
  step() {
    if (this.edgeReached) return false;

    const idx = this.y * this.size + this.x;
    const state = this.cells[idx];
    const turn = TURNS[this.rule[state]] ?? 0;
    const nextDir = (this.dir + turn + 4) & 3;
    const [dx, dy] = DIR_VECTORS[nextDir];
    const nx = this.x + dx;
    const ny = this.y + dy;

    if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) {
      this.edgeReached = true;
      return false;
    }

    this.cells[idx] = (state + 1) % this.stateCount;
    if (this.visits[idx] === 0) this.visited += 1;
    if (this.visits[idx] < 65_535) this.visits[idx] += 1;

    // Broad rainbow bands travel through both time and space.
    this.hues[idx] =
      (this.steps * 0.00035 +
        this.x * 0.0024 +
        this.y * 0.0033) %
      1;

    this.changed.add(idx);

    this.dir = nextDir;
    this.x = nx;
    this.y = ny;
    this.steps += 1;

    if (nx < this.minX) this.minX = nx;
    if (nx > this.maxX) this.maxX = nx;
    if (ny < this.minY) this.minY = ny;
    if (ny > this.maxY) this.maxY = ny;

    this.history.push(this.pack(nx, ny));
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }

    this.detectCycle();
    return true;
  }

  drainChanged() {
    const changed = this.changed;
    this.changed = new Set();
    return changed;
  }

  hashPatch() {
    const r = PATCH_RADIUS;
    let h1 = 2166136261;
    let h2 = 0x9e3779b9;

    h1 = Math.imul(h1 ^ (this.dir + 1), 16777619);
    h2 = Math.imul(h2 ^ (this.dir + 1), 2246822519);

    for (let row = -r; row <= r; row += 1) {
      let cursor = (this.y + row) * this.size + (this.x - r);
      for (let col = -r; col <= r; col += 1) {
        const value = this.cells[cursor] + 1;
        h1 = Math.imul(h1 ^ value, 16777619);
        h2 = Math.imul(h2 ^ value, 2246822519);
        cursor += 1;
      }
    }

    return [h1 >>> 0, h2 >>> 0];
  }

  /**
   * Fingerprint a 21 x 21 neighbourhood around the ant. If the exact same
   * neighbourhood returns, we have found a local recurrence: the loop.
   */
  detectCycle() {
    if (this.cycle || this.detectionStopped || this.steps < 240) return;

    const r = PATCH_RADIUS;
    if (
      this.x < r ||
      this.y < r ||
      this.x >= this.size - r ||
      this.y >= this.size - r
    ) {
      return;
    }

    const [h1, h2] = this.hashPatch();
    const packed = this.seen.get(h1);

    if (packed === undefined) {
      this.seen.set(h1, h2 * 262_144 + this.steps);
      if (this.seen.size >= MAX_SEEN) this.detectionStopped = true;
      return;
    }

    const previousStep = packed % 262_144;
    const previousH2 = Math.floor(packed / 262_144);
    if (previousH2 !== h2) return; // 32-bit collision guard

    const period = this.steps - previousStep;
    if (period < 8) return;

    const previousCell = this.history[previousStep];
    if (previousCell === undefined) return;

    const previousX = previousCell % this.size;
    const previousY = Math.floor(previousCell / this.size);

    const path =
      period <= MAX_CYCLE_PATH
        ? this.history.slice(-(period + 1))
        : null;

    this.cycle = {
      period,
      driftX: this.x - previousX,
      driftY: this.y - previousY,
      foundAt: this.steps,
      startStep: previousStep,
      startX: previousX,
      startY: previousY,
      endX: this.x,
      endY: this.y,
      radius: r,
      path,
    };
    this.detectionStopped = true;
    this.seen.clear();
  }

  get status() {
    if (this.cycle) return 'found';
    if (this.edgeReached) return 'edge';
    if (this.detectionStopped) return 'exhausted';
    return 'scanning';
  }
}
