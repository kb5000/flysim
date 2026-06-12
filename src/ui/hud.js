// 2D-canvas HUD overlay: artificial horizon with pitch ladder & roll arc,
// airspeed tape (kt), altitude tape (ft), heading tape, vertical speed,
// throttle/flaps/alpha/g readouts, stall warning, gamepad status, and
// crash/pause masks plus a help page.

import { quat } from '../math.js';
import { RUNWAY } from '../sim/state.js';
import { groundHeight } from '../world/terrain.js';

const MS_TO_KT = 1.94384;
const M_TO_FT = 3.28084;
const FPM = 196.850; // m/s -> ft/min
const MAP_SIZE = 180;
const MAP_SPAN = 5000;
const MAP_GRID = 45;

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.showHelp = false;
    this.blink = 0;
    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.width = MAP_GRID;
    this.mapCanvas.height = MAP_GRID;
    this.mapCenter = [Infinity, Infinity];
    this.mapTrail = [];
    this.mapTrailTimer = 0;
    this.lastMapType = '';
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    }
    this.dpr = dpr; this.w = w; this.h = h;
  }

  draw(s, ctrl, info, dt) {
    this.resize();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.blink += dt;

    const cx = this.w / 2, cy = this.h / 2;
    const [roll, pitch, heading] = quat.toEuler(s.q);

    this._horizon(cx, cy, roll, pitch);
    this._speedTape(cx, cy, s.ias * MS_TO_KT);
    this._altTape(cx, cy, s.altitude * M_TO_FT);
    this._headingTape(cx, heading);
    this._minimap(s, heading, dt);
    this._readouts(s, ctrl, info);
    if (s.aoaWarn && !s.crashed) this._stallWarn(cx, cy);

    if (s.crashed) this._mask('CRASHED', 'Press R / D-pad Right to reset to the runway', 'rgba(120,10,10,0.55)');
    else if (info.paused) this._mask('PAUSED', 'Press P / Start to resume', 'rgba(0,0,0,0.5)');
    if (this.showHelp) this._help();
  }

  _horizon(cx, cy, roll, pitch) {
    const ctx = this.ctx;
    const pxPerDeg = 7;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-roll);
    const pitchOff = (pitch * 180 / Math.PI) * pxPerDeg;
    ctx.translate(0, pitchOff);

    // ground/sky reference is just the ladder; keep clean HUD style (green lines)
    ctx.strokeStyle = 'rgba(120,255,140,0.9)';
    ctx.fillStyle = 'rgba(120,255,140,0.9)';
    ctx.lineWidth = 1.5;
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    for (let d = -90; d <= 90; d += 10) {
      if (d === 0) continue;
      const y = -d * pxPerDeg;
      if (Math.abs(y) > this.h * 0.7) continue;
      const half = d > 0 ? 60 : 45;
      ctx.beginPath();
      ctx.moveTo(-half, y); ctx.lineTo(-20, y);
      ctx.moveTo(20, y); ctx.lineTo(half, y);
      ctx.stroke();
      ctx.fillText(String(d), half + 4, y + 4);
      ctx.fillText(String(d), -half - 22, y + 4);
    }
    // horizon line
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-160, 0); ctx.lineTo(-30, 0);
    ctx.moveTo(30, 0); ctx.lineTo(160, 0); ctx.stroke();
    ctx.restore();

    // fixed aircraft reference (waterline)
    ctx.strokeStyle = 'rgba(255,210,60,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy); ctx.lineTo(cx - 12, cy);
    ctx.lineTo(cx, cy + 10);
    ctx.lineTo(cx + 12, cy); ctx.lineTo(cx + 40, cy);
    ctx.stroke();

    // roll arc + pointer
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(120,255,140,0.8)';
    ctx.lineWidth = 1.5;
    const R = 150;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const rad = (a - 90) * Math.PI / 180;
      const x0 = Math.cos(rad) * R, y0 = Math.sin(rad) * R;
      const len = (a % 30 === 0) ? 12 : 7;
      const x1 = Math.cos(rad) * (R - len), y1 = Math.sin(rad) * (R - len);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    // roll pointer (rotates with roll)
    ctx.rotate(-roll);
    ctx.fillStyle = 'rgba(255,210,60,0.95)';
    ctx.beginPath();
    ctx.moveTo(0, -R + 2); ctx.lineTo(-7, -R + 16); ctx.lineTo(7, -R + 16); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _tapeBox(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(120,255,140,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  _speedTape(cx, cy, kt) {
    const ctx = this.ctx;
    const x = cx - 200, w = 54, h = 220;
    const y = cy - h / 2;
    this._tapeBox(x, y, w, h);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = 'rgba(180,255,200,0.9)';
    ctx.strokeStyle = 'rgba(180,255,200,0.6)';
    ctx.font = '11px monospace'; ctx.textAlign = 'right';
    const span = 80; // kt visible
    for (let v = Math.floor((kt - span / 2) / 10) * 10; v <= kt + span / 2; v += 10) {
      if (v < 0) continue;
      const yy = cy + (kt - v) * (h / span);
      ctx.beginPath(); ctx.moveTo(x + w - 8, yy); ctx.lineTo(x + w, yy); ctx.stroke();
      ctx.fillText(String(v), x + w - 12, yy + 4);
    }
    ctx.restore();
    // current value box
    ctx.fillStyle = 'rgba(255,210,60,0.95)';
    ctx.fillRect(x - 6, cy - 12, w + 6, 24);
    ctx.fillStyle = '#000'; ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center';
    ctx.fillText(kt.toFixed(0), x + w / 2, cy + 5);
    ctx.fillStyle = 'rgba(180,255,200,0.9)'; ctx.font = '10px monospace';
    ctx.fillText('IAS kt', x + w / 2, y - 6);
  }

  _altTape(cx, cy, ft) {
    const ctx = this.ctx;
    const w = 60, h = 220, x = cx + 200 - w + 54;
    const y = cy - h / 2;
    this._tapeBox(x, y, w, h);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = 'rgba(180,255,200,0.9)';
    ctx.strokeStyle = 'rgba(180,255,200,0.6)';
    ctx.font = '11px monospace'; ctx.textAlign = 'left';
    const span = 800;
    for (let v = Math.floor((ft - span / 2) / 100) * 100; v <= ft + span / 2; v += 100) {
      const yy = cy + (ft - v) * (h / span);
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 8, yy); ctx.stroke();
      ctx.fillText(String(v), x + 12, yy + 4);
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,210,60,0.95)';
    ctx.fillRect(x, cy - 12, w + 6, 24);
    ctx.fillStyle = '#000'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
    ctx.fillText(ft.toFixed(0), x + w / 2, cy + 5);
    ctx.fillStyle = 'rgba(180,255,200,0.9)'; ctx.font = '10px monospace';
    ctx.fillText('ALT ft', x + w / 2, y - 6);
  }

  _headingTape(cx, heading) {
    const ctx = this.ctx;
    const deg = heading * 180 / Math.PI;
    const w = 320, h = 26, x = cx - w / 2, y = 14;
    this._tapeBox(x, y, w, h);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = 'rgba(180,255,200,0.9)';
    ctx.strokeStyle = 'rgba(180,255,200,0.6)';
    ctx.font = '11px monospace'; ctx.textAlign = 'center';
    const pxPerDeg = 3;
    for (let d = Math.floor(deg - 60); d <= deg + 60; d += 10) {
      const dd = ((d % 360) + 360) % 360;
      const xx = cx + (d - deg) * pxPerDeg;
      ctx.beginPath(); ctx.moveTo(xx, y + h - 8); ctx.lineTo(xx, y + h); ctx.stroke();
      let lbl = String(dd);
      if (dd === 0) lbl = 'N'; else if (dd === 90) lbl = 'E';
      else if (dd === 180) lbl = 'S'; else if (dd === 270) lbl = 'W';
      ctx.fillText(lbl, xx, y + 14);
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,210,60,0.95)';
    ctx.beginPath(); ctx.moveTo(cx, y + h); ctx.lineTo(cx - 6, y + h + 8); ctx.lineTo(cx + 6, y + h + 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#000'; ctx.fillRect(cx - 18, y, 36, 14);
    ctx.fillStyle = 'rgba(255,210,60,0.95)'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
    ctx.fillText(((deg % 360 + 360) % 360).toFixed(0).padStart(3, '0'), cx, y + 11);
  }

  _minimap(s, heading, dt) {
    const x = 18, y = 18, size = MAP_SIZE;
    const snap = 500;
    const centerX = Math.round(s.pos[0] / snap) * snap;
    const centerY = Math.round(s.pos[1] / snap) * snap;
    if (centerX !== this.mapCenter[0] || centerY !== this.mapCenter[1]) {
      this.mapCenter = [centerX, centerY];
      this._rebuildMap();
    }

    if (s.aircraftType !== this.lastMapType) {
      this.mapTrail = [];
      this.lastMapType = s.aircraftType;
    }
    this.mapTrailTimer += dt;
    let last = this.mapTrail[this.mapTrail.length - 1];
    if (last && Math.hypot(s.pos[0] - last[0], s.pos[1] - last[1]) > MAP_SPAN * 0.4) {
      this.mapTrail = [];
      last = null;
    }
    if (this.mapTrailTimer >= 0.25
      || !last
      || Math.hypot(s.pos[0] - last[0], s.pos[1] - last[1]) > 50) {
      this.mapTrail.push([s.pos[0], s.pos[1]]);
      if (this.mapTrail.length > 160) this.mapTrail.shift();
      this.mapTrailTimer = 0;
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(3,10,13,0.82)';
    ctx.fillRect(x - 4, y - 4, size + 8, size + 25);
    ctx.drawImage(this.mapCanvas, x, y, size, size);
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();

    const toMap = (wx, wy) => [
      x + size * (0.5 + (wx - this.mapCenter[0]) / MAP_SPAN),
      y + size * (0.5 - (wy - this.mapCenter[1]) / MAP_SPAN),
    ];

    // Runway.
    const [r0x, r0y] = toMap(RUNWAY.origin[0], RUNWAY.origin[1]);
    const [r1x, r1y] = toMap(RUNWAY.origin[0], RUNWAY.origin[1] + RUNWAY.length);
    ctx.strokeStyle = 'rgba(235,235,225,0.9)';
    ctx.lineWidth = Math.max(2, RUNWAY.width / MAP_SPAN * size);
    ctx.beginPath(); ctx.moveTo(r0x, r0y); ctx.lineTo(r1x, r1y); ctx.stroke();

    // Recent ground track.
    if (this.mapTrail.length > 1) {
      ctx.strokeStyle = 'rgba(90,220,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < this.mapTrail.length; i++) {
        const [px, py] = toMap(this.mapTrail[i][0], this.mapTrail[i][1]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Aircraft marker, heading 0 points north/up.
    const [px, py] = toMap(s.pos[0], s.pos[1]);
    ctx.translate(px, py);
    ctx.rotate(heading);
    ctx.fillStyle = s.aircraftType === 'quad' ? '#65eaff' : '#ffd84f';
    ctx.strokeStyle = '#091014';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(150,255,185,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, y - 0.5, size + 1, size + 1);
    ctx.fillStyle = 'rgba(210,255,225,0.9)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('N', x + size / 2 - 3, y + 11);
    ctx.fillText('MAP  5 km', x + 4, y + size + 15);
  }

  _rebuildMap() {
    const ctx = this.mapCanvas.getContext('2d');
    const image = ctx.createImageData(MAP_GRID, MAP_GRID);
    const data = image.data;
    for (let py = 0; py < MAP_GRID; py++) {
      for (let px = 0; px < MAP_GRID; px++) {
        const wx = this.mapCenter[0] + ((px + 0.5) / MAP_GRID - 0.5) * MAP_SPAN;
        const wy = this.mapCenter[1] + (0.5 - (py + 0.5) / MAP_GRID) * MAP_SPAN;
        const h = groundHeight(wx, wy);
        const color = mapTerrainColor(h);
        const i = (py * MAP_GRID + px) * 4;
        data[i] = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
        data[i + 3] = 235;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  _readouts(s, ctrl, info) {
    const ctx = this.ctx;
    ctx.font = '12px monospace'; ctx.textAlign = 'left';
    const lines = s.aircraftType === 'quad'
      ? [
          'MODEL QUAD',
          `THR   ${(s.throttle * 100).toFixed(0)}%`,
          `VS    ${(s.vspeed * FPM).toFixed(0)} fpm`,
          `SPEED ${(s.V * MS_TO_KT).toFixed(0)} kt`,
          `LOAD  ${s.gLoad.toFixed(1)}`,
        ]
      : [
          'MODEL FIXED',
          `THR  ${(s.throttle * 100).toFixed(0)}%`,
          `FLAP ${[0, 10, 25][s.flapDetent]}°`,
          `VS   ${(s.vspeed * FPM).toFixed(0)} fpm`,
          `AOA  ${(s.alpha * 180 / Math.PI).toFixed(1)}°`,
          `G    ${s.gLoad.toFixed(1)}`,
          `TRIM ${(ctrl.pitchTrim * 100).toFixed(0)}%`,
        ];
    if (ctrl.parkingBrake) lines.push('PARK BRAKE');
    const x = 24, y0 = this.h - 24 - lines.length * 16;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x - 8, y0 - 16, 130, lines.length * 16 + 12);
    ctx.fillStyle = 'rgba(180,255,200,0.95)';
    lines.forEach((l, i) => ctx.fillText(l, x, y0 + i * 16));

    // bottom-right: input + gear/ground status
    ctx.textAlign = 'right';
    const rx = this.w - 24;
    const stat = [
      info.gamepad ? `PAD: ${shortName(info.inputName)}` : 'INPUT: keyboard',
      s.onGround ? `GND (${s.nWheelOnGround}/${s.aircraftType === 'quad' ? 4 : 3})` : 'AIRBORNE',
      `AGL ${(s.agl * M_TO_FT).toFixed(0)} ft`,
    ];
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(rx - 150, this.h - 24 - stat.length * 16, 158, stat.length * 16 + 10);
    ctx.fillStyle = info.gamepad ? 'rgba(140,255,160,0.95)' : 'rgba(255,230,140,0.95)';
    stat.forEach((l, i) => ctx.fillText(l, rx, this.h - 24 - (stat.length - 1 - i) * 16));

    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(200,220,230,0.6)';
    ctx.fillText('H: help', this.w - 24, 30);
  }

  _stallWarn(cx, cy) {
    if (Math.floor(this.blink * 4) % 2 === 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,60,40,0.95)';
    ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center';
    ctx.fillText('STALL', cx, cy - 120);
  }

  _mask(title, sub, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText(title, this.w / 2, this.h / 2 - 10);
    ctx.font = '18px sans-serif';
    ctx.fillText(sub, this.w / 2, this.h / 2 + 30);
  }

  _help() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#cfe'; ctx.textAlign = 'left';
    ctx.font = 'bold 22px monospace';
    ctx.fillText('FlySim — Controls', 60, 60);
    const rows = [
      ['', ''],
      ['Keyboard', ''],
      ['Arrow L/R', 'Aileron (roll)'],
      ['Arrow U/D', 'Elevator (Down=pull up)'],
      ['A / D', 'Rudder left / right'],
      ['W / S', 'Throttle up / down'],
      ['[ / ]', 'Pitch trim'],
      ['F', 'Flaps cycle (0/10/25)'],
      ['B', 'Brakes'],
      ['C', 'Cycle camera'],
      ['R', 'Reset to runway'],
      ['P', 'Pause   H: this help'],
      ['', ''],
      ['Xbox Gamepad (MSFS 2020 layout)', ''],
      ['Left stick', 'Aileron / Elevator (pull=up)'],
      ['Right stick', 'Look around'],
      ['LT / RT', 'Rudder left / right'],
      ['A / B (hold)', 'Throttle increase / decrease'],
      ['X (hold)', 'Brakes'],
      ['RB + R-stick', 'Pitch trim (pull = nose up)'],
      ['D-pad U/D', 'Flaps retract / extend'],
      ['D-pad L', 'Parking brake'],
      ['Y', 'Reset view   View: camera'],
      ['Menu', 'Pause   D-pad R: reset'],
    ];
    ctx.font = '14px monospace';
    let y = 96;
    for (const [k, v] of rows) {
      if (k === 'Keyboard' || k.startsWith('Xbox Gamepad')) { ctx.fillStyle = '#ffd86a'; ctx.font = 'bold 15px monospace'; }
      else { ctx.fillStyle = '#cfe'; ctx.font = '14px monospace'; }
      ctx.fillText(k, 60, y);
      ctx.fillStyle = '#aef'; ctx.fillText(v, 230, y);
      y += 20;
    }
    ctx.fillStyle = '#888'; ctx.fillText('Press H to close', 60, y + 16);
  }
}

function shortName(name) {
  return name.length > 24 ? `${name.slice(0, 21)}...` : name;
}

function mapTerrainColor(height) {
  if (height < 20) return [48, 79, 45];
  if (height < 100) return [66, 91, 48];
  if (height < 200) return [91, 83, 61];
  if (height < 280) return [116, 105, 91];
  return [196, 202, 205];
}
