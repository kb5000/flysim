// Simple interleaved-VAO mesh: position(3) + normal(3) + color(3).
// Provides helpers to build meshes from arrays and to upload dynamic data.

export class Mesh {
  constructor(gl, { positions, normals, colors, indices, dynamic = false }) {
    this.gl = gl;
    this.dynamic = dynamic;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const n = positions.length / 3;
    this.vertexCount = indices ? indices.length : n;
    this.indexed = !!indices;

    const usage = dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;

    this.pBuf = makeAttrib(gl, 0, 3, positions, usage);
    this.nBuf = makeAttrib(gl, 1, 3, normals || new Float32Array(n * 3), usage);
    this.cBuf = makeAttrib(gl, 2, 3, colors || fillColor(n, [0.8, 0.8, 0.8]), usage);

    if (indices) {
      this.iBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iBuf);
      const arr = (n > 65535) ? new Uint32Array(indices) : new Uint16Array(indices);
      this.indexType = (n > 65535) ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, usage);
    }
    gl.bindVertexArray(null);
  }

  // update positions/normals/colors in place (must match original counts)
  update({ positions, normals, colors }) {
    const gl = this.gl;
    if (positions) { gl.bindBuffer(gl.ARRAY_BUFFER, this.pBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions); }
    if (normals) { gl.bindBuffer(gl.ARRAY_BUFFER, this.nBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, normals); }
    if (colors) { gl.bindBuffer(gl.ARRAY_BUFFER, this.cBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors); }
  }

  draw(mode) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (this.indexed) {
      gl.drawElements(mode ?? gl.TRIANGLES, this.vertexCount, this.indexType, 0);
    } else {
      gl.drawArrays(mode ?? gl.TRIANGLES, 0, this.vertexCount);
    }
    gl.bindVertexArray(null);
  }

  destroy() {
    const gl = this.gl;
    gl.deleteBuffer(this.pBuf);
    gl.deleteBuffer(this.nBuf);
    gl.deleteBuffer(this.cBuf);
    if (this.iBuf) gl.deleteBuffer(this.iBuf);
    gl.deleteVertexArray(this.vao);
  }
}

function makeAttrib(gl, loc, size, data, usage) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data instanceof Float32Array ? data : new Float32Array(data), usage);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  return buf;
}

function fillColor(n, c) {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  return a;
}

// ---- geometry builders (return {positions,normals,colors,indices}) ----

// flat-shaded box of given half-extents centered at origin, single color.
export function boxGeometry(hx, hy, hz, color) {
  const faces = [
    // +X
    [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz], [1, 0, 0]],
    // -X
    [[-hx, hy, -hz], [-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-1, 0, 0]],
    // +Y
    [[hx, hy, -hz], [-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [0, 1, 0]],
    // -Y
    [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0]],
    // +Z
    [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz], [0, 0, 1]],
    // -Z
    [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz], [0, 0, -1]],
  ];
  return facesToGeometry(faces, color);
}

// Convert a list of quads [v0,v1,v2,v3,normal] to flat-shaded geometry.
export function facesToGeometry(faces, color) {
  const positions = [], normals = [], colors = [], indices = [];
  let vi = 0;
  for (const f of faces) {
    const [a, b, c, d, nrm] = f;
    const verts = [a, b, c, d];
    for (const v of verts) {
      positions.push(v[0], v[1], v[2]);
      normals.push(nrm[0], nrm[1], nrm[2]);
      colors.push(color[0], color[1], color[2]);
    }
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  }
  return { positions, normals, colors, indices };
}

// merge several geometry objects into one
export function mergeGeometry(parts) {
  const positions = [], normals = [], colors = [], indices = [];
  let base = 0;
  for (const p of parts) {
    positions.push(...p.positions);
    normals.push(...p.normals);
    colors.push(...p.colors);
    for (const idx of p.indices) indices.push(idx + base);
    base += p.positions.length / 3;
  }
  return { positions, normals, colors, indices };
}
