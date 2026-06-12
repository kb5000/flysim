// Deterministic value-noise FBM for terrain heightfield.
// Hash-based gradient-free value noise with smoothstep interpolation.

function hash2(ix, iy) {
  // integer hash -> [0,1)
  let h = ix * 374761393 + iy * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}

function smooth(t) { return t * t * (3 - 2 * t); }

export function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const v00 = hash2(ix, iy);
  const v10 = hash2(ix + 1, iy);
  const v01 = hash2(ix, iy + 1);
  const v11 = hash2(ix + 1, iy + 1);
  const ux = smooth(fx), uy = smooth(fy);
  const a = v00 + (v10 - v00) * ux;
  const b = v01 + (v11 - v01) * ux;
  return a + (b - a) * uy;
}

// Fractal Brownian motion: several octaves of value noise.
export function fbm(x, y, octaves = 5, lacunarity = 2.0, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm; // ~[0,1]
}
