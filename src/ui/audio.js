// WebAudio engine sound (throttle-dependent) + stall warning beeper.
// Lazily created on first user gesture to satisfy autoplay policies.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.started = false;
  }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;

    // Engine: layered fundamentals with restrained high-frequency content.
    this.engGain = c.createGain(); this.engGain.gain.value = 0.0;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 480;
    this.lp.Q.value = 0.5;
    this.highCut = c.createBiquadFilter(); this.highCut.type = 'highshelf';
    this.highCut.frequency.value = 700; this.highCut.gain.value = -14;
    this.osc1 = c.createOscillator(); this.osc1.type = 'triangle';
    this.osc2 = c.createOscillator(); this.osc2.type = 'sine';
    this.subOsc = c.createOscillator(); this.subOsc.type = 'sine';
    this.osc1Gain = c.createGain(); this.osc1Gain.gain.value = 0.34;
    this.osc2Gain = c.createGain(); this.osc2Gain.gain.value = 0.25;
    this.subGain = c.createGain(); this.subGain.gain.value = 0.58;
    this.osc1.frequency.value = 70; this.osc2.frequency.value = 105;
    this.subOsc.frequency.value = 35;
    this.osc1.connect(this.osc1Gain).connect(this.lp);
    this.osc2.connect(this.osc2Gain).connect(this.lp);
    this.subOsc.connect(this.subGain).connect(this.lp);
    this.lp.connect(this.highCut).connect(this.engGain); this.engGain.connect(c.destination);
    this.osc1.start(); this.osc2.start(); this.subOsc.start();

    // stall beeper
    this.stallGain = c.createGain(); this.stallGain.gain.value = 0;
    this.stallOsc = c.createOscillator(); this.stallOsc.type = 'sine';
    this.stallOsc.frequency.value = 620;
    this.stallOsc.connect(this.stallGain); this.stallGain.connect(c.destination);
    this.stallOsc.start();

    this.started = true;
    this._t = 0;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // throttleFrac 0..1, rpmFrac approximated by spooled thrust, stall bool, dt
  update(s, dt) {
    if (!this.started || !this.ctx) return;
    this._t += dt;
    const t = this.ctx.currentTime;
    const quad = s.aircraftType === 'quad';
    const rpm = quad ? s.thrustState : 0.25 + 0.75 * s.thrustState;
    const base = quad ? 110 + rpm * 230 : 60 + rpm * 110;
    this.osc1.frequency.setTargetAtTime(base, t, 0.05);
    this.osc2.frequency.setTargetAtTime(base * 1.5, t, 0.05);
    this.subOsc.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    this.lp.frequency.setTargetAtTime(
      quad ? 520 + rpm * 1050 : 300 + rpm * 620,
      t,
      0.08
    );
    const vol = s.crashed ? 0 : (quad ? 0.12 * rpm : 0.055 + 0.12 * rpm);
    this.engGain.gain.setTargetAtTime(vol, t, 0.12);

    // stall beep: pulse on/off
    const beepOn = s.aoaWarn && !s.crashed && (Math.floor(this._t * 4) % 2 === 0);
    this.stallGain.gain.setTargetAtTime(beepOn ? 0.025 : 0, t, 0.04);
  }
}
