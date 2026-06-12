// Sky dome rendered as a fullscreen-ish background gradient with a sun glow.
// Drawn first with depth write off so everything renders in front of it.
import { createProgram } from '../engine/shader.js';

const VS = `#version 300 es
// fullscreen triangle; reconstruct a view ray to color the sky by direction.
out vec2 vUV;
void main(){
  vec2 p = vec2((gl_VertexID==1)?3.0:-1.0, (gl_VertexID==2)?3.0:-1.0);
  vUV = p;
  gl_Position = vec4(p, 1.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 frag;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uFog;
void main(){
  // reconstruct world ray direction
  vec4 nh = uInvViewProj * vec4(vUV, 1.0, 1.0);
  vec3 wp = nh.xyz / nh.w;
  vec3 dir = normalize(wp - uCamPos);
  float up = clamp(dir.z, -1.0, 1.0);
  // gradient zenith->horizon->ground-fog
  vec3 col;
  if (up >= 0.0) {
    float t = pow(1.0 - up, 1.6);
    col = mix(uZenith, uHorizon, t);
  } else {
    float t = clamp(-up*3.0, 0.0, 1.0);
    col = mix(uHorizon, uFog, t);
  }
  // sun glow
  float s = max(dot(dir, normalize(uSunDir)), 0.0);
  col += vec3(1.0, 0.95, 0.8) * pow(s, 200.0) * 1.2;   // disk
  col += vec3(1.0, 0.9, 0.7) * pow(s, 8.0) * 0.18;     // halo
  frag = vec4(col, 1.0);
}`;

export class Sky {
  constructor(gl) {
    this.gl = gl;
    this.p = createProgram(gl, VS, FS);
    this.vao = gl.createVertexArray();
  }
  // invViewProj: Float32Array(16); camPos, sunDir: [3]
  draw(invViewProj, camPos, sunDir, palette) {
    const gl = this.gl, u = this.p.uniforms;
    gl.useProgram(this.p.prog);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(u.uInvViewProj, false, invViewProj);
    gl.uniform3fv(u.uCamPos, camPos);
    gl.uniform3fv(u.uSunDir, sunDir);
    gl.uniform3fv(u.uHorizon, palette.horizon);
    gl.uniform3fv(u.uZenith, palette.zenith);
    gl.uniform3fv(u.uFog, palette.fog);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }
}
