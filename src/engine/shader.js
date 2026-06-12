// Shader program compilation + uniform/attribute location caching.
export function createProgram(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error('Program link failed: ' + log);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  // cache uniform & attribute locations
  const uniforms = {};
  const nU = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nU; i++) {
    const info = gl.getActiveUniform(prog, i);
    let name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(prog, name);
  }
  const attribs = {};
  const nA = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < nA; i++) {
    const info = gl.getActiveAttrib(prog, i);
    attribs[info.name] = gl.getAttribLocation(prog, info.name);
  }
  return { prog, uniforms, attribs };
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    gl.deleteShader(sh);
    throw new Error(`${kind} shader compile failed: ${log}`);
  }
  return sh;
}
