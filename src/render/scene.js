// Scene renderer: lit Phong-ish shading with distance fog, plus sky background.
// Holds the GL programs and the world meshes; draws everything each frame.

import { createProgram } from '../engine/shader.js';
import { resizeCanvas } from '../engine/gl.js';
import { mat4, vec3, quat } from '../math.js';
import { Terrain } from '../world/terrain.js';
import { Runway } from '../world/runway.js';
import { Sky } from '../world/sky.js';
import { AircraftModel } from './aircraft-mesh.js';

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormalMat;
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
void main(){
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  vColor = aColor;
  gl_Position = uViewProj * wp;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec3 vWorld;
out vec4 frag;
uniform vec3 uSunDir;     // toward sun
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform float uFogDensity;
void main(){
  vec3 N = normalize(vNormal);
  float diff = max(dot(N, normalize(uSunDir)), 0.0);
  // hemisphere ambient: sky above, ground below
  float hemi = 0.5 + 0.5 * N.z;
  vec3 ambient = mix(vec3(0.30,0.32,0.30), vec3(0.55,0.6,0.75), hemi);
  vec3 lit = vColor * (ambient + diff * vec3(1.0,0.97,0.9) * 0.9);
  // distance fog
  float dist = length(vWorld - uCamPos);
  float f = 1.0 - exp(-uFogDensity * dist);
  f = clamp(f, 0.0, 1.0);
  frag = vec4(mix(lit, uFogColor, f), 1.0);
}`;

export class Scene {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, VS, FS);
    this.terrain = new Terrain(gl);
    this.runway = new Runway(gl);
    this.sky = new Sky(gl);
    this.aircraft = new AircraftModel(gl);

    this.sunDir = vec3.normalize([0.4, 0.3, 0.85]);
    this.palette = {
      zenith: [0.18, 0.35, 0.62],
      horizon: [0.66, 0.76, 0.86],
      fog: [0.70, 0.78, 0.85],
    };
    this.fogDensity = 0.000035;

    this._model = mat4.create();
    this._normal = new Float32Array(9);
    this._vp = mat4.create();
    this._invVP = mat4.create();
  }

  // s: interpolated render state; camera built externally.
  render(camera, s, ctrl, propAngle) {
    const gl = this.gl;
    resizeCanvas(gl);
    const w = gl.canvas.width, h = gl.canvas.height;
    gl.viewport(0, 0, w, h);
    camera.setProjection(w / h);

    // view-projection
    mat4.multiply(this._vp, camera.proj, camera.view);
    invert(this._invVP, this._vp);

    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

    // sky background first
    this.sky.draw(this._invVP, camera.eye, this.sunDir, this.palette);

    // keep terrain window centered on aircraft
    this.terrain.rebuild(s.pos[0], s.pos[1]);

    gl.useProgram(this.prog.prog);
    const u = this.prog.uniforms;
    gl.uniformMatrix4fv(u.uViewProj, false, this._vp);
    gl.uniform3fv(u.uSunDir, this.sunDir);
    gl.uniform3fv(u.uCamPos, camera.eye);
    gl.uniform3fv(u.uFogColor, this.palette.fog);
    gl.uniform1f(u.uFogDensity, this.fogDensity);

    // terrain & runway (identity model)
    this._setModel(mat4.identity(this._model));
    this.terrain.draw();
    this._setModel(mat4.identity(this._model));
    this.runway.draw();

    // aircraft: model = T(pos) * R(q) * partLocal
    const acWorld = mat4.create();
    mat4.fromRotationTranslation(acWorld, s.q, s.pos);
    const tmp = mat4.create();
    const drawPart = (mesh, local) => {
      mat4.multiply(tmp, acWorld, local);
      this._setModel(tmp);
      mesh.draw();
    };
    // don't draw the aircraft in cockpit view (we're inside it)
    if (camera.mode !== 1) {
      this.aircraft.draw(drawPart, ctrl, propAngle);
    }
  }

  _setModel(m) {
    const gl = this.gl, u = this.prog.uniforms;
    gl.uniformMatrix4fv(u.uModel, false, m);
    mat4.normalFromMat4(this._normal, m);
    gl.uniformMatrix3fv(u.uNormalMat, false, this._normal);
  }
}

// 4x4 inverse (general). Used for sky ray reconstruction.
function invert(out, a) {
  const m = a;
  const inv = new Float32Array(16);
  inv[0] = m[5]*m[10]*m[15]-m[5]*m[11]*m[14]-m[9]*m[6]*m[15]+m[9]*m[7]*m[14]+m[13]*m[6]*m[11]-m[13]*m[7]*m[10];
  inv[4] = -m[4]*m[10]*m[15]+m[4]*m[11]*m[14]+m[8]*m[6]*m[15]-m[8]*m[7]*m[14]-m[12]*m[6]*m[11]+m[12]*m[7]*m[10];
  inv[8] = m[4]*m[9]*m[15]-m[4]*m[11]*m[13]-m[8]*m[5]*m[15]+m[8]*m[7]*m[13]+m[12]*m[5]*m[11]-m[12]*m[7]*m[9];
  inv[12] = -m[4]*m[9]*m[14]+m[4]*m[10]*m[13]+m[8]*m[5]*m[14]-m[8]*m[6]*m[13]-m[12]*m[5]*m[10]+m[12]*m[6]*m[9];
  inv[1] = -m[1]*m[10]*m[15]+m[1]*m[11]*m[14]+m[9]*m[2]*m[15]-m[9]*m[3]*m[14]-m[13]*m[2]*m[11]+m[13]*m[3]*m[10];
  inv[5] = m[0]*m[10]*m[15]-m[0]*m[11]*m[14]-m[8]*m[2]*m[15]+m[8]*m[3]*m[14]+m[12]*m[2]*m[11]-m[12]*m[3]*m[10];
  inv[9] = -m[0]*m[9]*m[15]+m[0]*m[11]*m[13]+m[8]*m[1]*m[15]-m[8]*m[3]*m[13]-m[12]*m[1]*m[11]+m[12]*m[3]*m[9];
  inv[13] = m[0]*m[9]*m[14]-m[0]*m[10]*m[13]-m[8]*m[1]*m[14]+m[8]*m[2]*m[13]+m[12]*m[1]*m[10]-m[12]*m[2]*m[9];
  inv[2] = m[1]*m[6]*m[15]-m[1]*m[7]*m[14]-m[5]*m[2]*m[15]+m[5]*m[3]*m[14]+m[13]*m[2]*m[7]-m[13]*m[3]*m[6];
  inv[6] = -m[0]*m[6]*m[15]+m[0]*m[7]*m[14]+m[4]*m[2]*m[15]-m[4]*m[3]*m[14]-m[12]*m[2]*m[7]+m[12]*m[3]*m[6];
  inv[10] = m[0]*m[5]*m[15]-m[0]*m[7]*m[13]-m[4]*m[1]*m[15]+m[4]*m[3]*m[13]+m[12]*m[1]*m[7]-m[12]*m[3]*m[5];
  inv[14] = -m[0]*m[5]*m[14]+m[0]*m[6]*m[13]+m[4]*m[1]*m[14]-m[4]*m[2]*m[13]-m[12]*m[1]*m[6]+m[12]*m[2]*m[5];
  inv[3] = -m[1]*m[6]*m[11]+m[1]*m[7]*m[10]+m[5]*m[2]*m[11]-m[5]*m[3]*m[10]-m[9]*m[2]*m[7]+m[9]*m[3]*m[6];
  inv[7] = m[0]*m[6]*m[11]-m[0]*m[7]*m[10]-m[4]*m[2]*m[11]+m[4]*m[3]*m[10]+m[8]*m[2]*m[7]-m[8]*m[3]*m[6];
  inv[11] = -m[0]*m[5]*m[11]+m[0]*m[7]*m[9]+m[4]*m[1]*m[11]-m[4]*m[3]*m[9]-m[8]*m[1]*m[7]+m[8]*m[3]*m[5];
  inv[15] = m[0]*m[5]*m[10]-m[0]*m[6]*m[9]-m[4]*m[1]*m[10]+m[4]*m[2]*m[9]+m[8]*m[1]*m[6]-m[8]*m[2]*m[5];
  let det = m[0]*inv[0]+m[1]*inv[4]+m[2]*inv[8]+m[3]*inv[12];
  if (det === 0) { mat4.identity(out); return out; }
  det = 1.0/det;
  for (let i=0;i<16;i++) out[i]=inv[i]*det;
  return out;
}
