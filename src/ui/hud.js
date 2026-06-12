// 2D-canvas HUD overlay: artificial horizon with pitch ladder & roll arc,
// airspeed tape (kt), altitude tape (ft), heading tape, vertical speed,
// throttle/flaps/alpha/g readouts, stall warning, gamepad status, and
// crash/pause masks plus a help page.

import { quat } from '../math.js';

const MS_TO_KT = 1.94384;
const M_TO_FT = 3.28084;
const FPM = 196.850; // m/s -> ft/min

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.showHelp = false;
    this.blink = 0;
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
    this._readouts(s, ctrl, info);
    if (s.aoaWarn && !s.crashed) this._stallWarn(cx, cy);

    if (s.crashed) this._mask('CRASHED', 'Press R / X to reset to the runway', 'rgba(120,10,10,0.55)');
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

  _readouts(s, ctrl, info) {
    const ctx = this.ctx;
    ctx.font = '12px monospace'; ctx.textAlign = 'left';
    const lines = [
      `THR  ${(s.throttle * 100).toFixed(0)}%`,
      `FLAP ${[0, 10, 25][s.flapDetent]}°`,
      `VS   ${(s.vspeed * FPM).toFixed(0)} fpm`,
      `AOA  ${(s.alpha * 180 / Math.PI).toFixed(1)}°`,
      `G    ${s.gLoad.toFixed(1)}`,
      `TRIM ${(ctrl.pitchTrim * 100).toFixed(0)}%`,
    ];
    const x = 24, y0 = this.h - 24 - lines.length * 16;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x - 8, y0 - 16, 130, lines.length * 16 + 12);
    ctx.fillStyle = 'rgba(180,255,200,0.95)';
    lines.forEach((l, i) => ctx.fillText(l, x, y0 + i * 16));

    // bottom-right: input + gear/ground status
    ctx.textAlign = 'right';
    const rx = this.w - 24;
    const stat = [
      info.gamepad ? 'PAD: connected' : 'PAD: keyboard',
      s.onGround ? `GND (${s.nWheelOnGround}/3)` : 'AIRBORNE',
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
      ['Xbox Gamepad', ''],
      ['Left stick', 'Aileron / Elevator (fwd=down)'],
      ['LT / RT', 'Rudder left / right'],
      ['Right stick Y', 'Throttle (fwd=more)'],
      ['LB / RB', 'Throttle quick -/+'],
      ['A', 'Brakes'],
      ['B', 'Flaps   X: reset   Y: camera'],
      ['D-pad U/D', 'Pitch trim   Start: pause'],
    ];
    ctx.font = '14px monospace';
    let y = 96;
    for (const [k, v] of rows) {
      if (k === 'Keyboard' || k === 'Xbox Gamepad') { ctx.fillStyle = '#ffd86a'; ctx.font = 'bold 15px monospace'; }
      else { ctx.fillStyle = '#cfe'; ctx.font = '14px monospace'; }
      ctx.fillText(k, 60, y);
      ctx.fillStyle = '#aef'; ctx.fillText(v, 230, y);
      y += 20;
    }
    ctx.fillStyle = '#888'; ctx.fillText('Press H to close', 60, y + 16);
  }
}
