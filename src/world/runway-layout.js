// Deterministic chunk-based runway placement. Chunks are generated on demand:
// a given chunk either always contains one runway or never does, so streaming
// remains stable while the world is effectively unbounded.
import { RUNWAY } from '../sim/state.js';

export const RUNWAY_CHUNK_SIZE = 4000;
export const RUNWAY_CHANCE = 0.18;
const MAX_RUNWAY_LENGTH = 1200;
const cache = new Map();

function hash(ix, iy, salt = 0) {
  let h = Math.imul(ix ^ 0x6d2b79f5, 0x27d4eb2d);
  h ^= Math.imul(iy ^ 0x1b873593, 0x85ebca6b);
  h ^= Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 0x100000000;
}

export function runwayForChunk(ix, iy) {
  const key = `${ix},${iy}`;
  if (cache.has(key)) return cache.get(key);
  if (ix === 0 && iy === 0) {
    cache.set(key, RUNWAY);
    return RUNWAY;
  }
  if (hash(ix, iy, 0) >= RUNWAY_CHANCE) {
    cache.set(key, null);
    return null;
  }

  const margin = 700;
  const span = RUNWAY_CHUNK_SIZE - margin * 2;
  const runway = {
    chunk: [ix, iy],
    origin: [
      ix * RUNWAY_CHUNK_SIZE + margin + hash(ix, iy, 1) * span,
      iy * RUNWAY_CHUNK_SIZE + margin + hash(ix, iy, 2) * span,
      0,
    ],
    heading: hash(ix, iy, 3) * Math.PI,
    length: 720 + hash(ix, iy, 4) * (MAX_RUNWAY_LENGTH - 720),
    width: 32 + hash(ix, iy, 5) * 10,
  };
  cache.set(key, runway);
  return runway;
}

export function runwaysInRadius(x, y, radius) {
  const reach = radius + MAX_RUNWAY_LENGTH;
  const minI = Math.floor((x - reach) / RUNWAY_CHUNK_SIZE);
  const maxI = Math.floor((x + reach) / RUNWAY_CHUNK_SIZE);
  const minJ = Math.floor((y - reach) / RUNWAY_CHUNK_SIZE);
  const maxJ = Math.floor((y + reach) / RUNWAY_CHUNK_SIZE);
  const result = [];
  for (let j = minJ; j <= maxJ; j++) {
    for (let i = minI; i <= maxI; i++) {
      const runway = runwayForChunk(i, j);
      if (!runway) continue;
      const cx = runway.origin[0] + Math.sin(runway.heading) * runway.length * 0.5;
      const cy = runway.origin[1] + Math.cos(runway.heading) * runway.length * 0.5;
      if (Math.hypot(cx - x, cy - y) <= reach) result.push(runway);
    }
  }
  return result;
}

export function runwaysNearPoint(x, y, margin) {
  return runwaysInRadius(x, y, margin + MAX_RUNWAY_LENGTH);
}
