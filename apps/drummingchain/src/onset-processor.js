/* Audio-only onset estimator. Always unverified. Mono AudioWorklet; never sends PCM off-device. */
class DrumOnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.previous = 0;
    this.noise = 0.0015;
    this.lastHitSec = -10;
    this.frames = 0;
    this.armed = true;
    this.sensitivity = 3.5;
    this.port.onmessage = (e) => {
      if (e.data?.type === 'sensitivity') {
        const s = Number(e.data.value);
        if (Number.isFinite(s)) this.sensitivity = Math.max(2, Math.min(8, s));
      }
    };
  }
  process(inputs, outputs) {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < channel.length; i++) {
      sum += channel[i] * channel[i];
      peak = Math.max(peak, Math.abs(channel[i]));
    }
    const rms = Math.sqrt(sum / channel.length);
    const rise = Math.max(0, rms - this.previous);
    const t = currentTime;
    this.frames++;
    // Ambient baseline follows quiet input but will not immediately chase sharp drum strikes.
    if (rms < this.noise * 2) this.noise = this.noise * 0.995 + rms * 0.005;
    else this.noise = this.noise * 0.9999 + Math.min(rms, this.noise * 2) * 0.0001;
    const threshold = Math.max(0.003, this.noise * this.sensitivity);
    if (rms < threshold * 0.55) this.armed = true;
    if (this.frames % 18 === 0) this.port.postMessage({ type: 'level', rms, threshold });
    if (this.armed && t - this.lastHitSec >= 0.045 &&
        rms > threshold && rise > Math.max(0.0008, this.noise * 0.5) &&
        peak > threshold * 1.15) {
      this.lastHitSec = t;
      this.armed = false;
      const strength = Math.min(1, Math.max(0, (rms - threshold) / Math.max(0.01, threshold * 5)));
      this.port.postMessage({ type: 'hit', t_sec: t, strength, rms, peak });
    }
    this.previous = rms;
    // Let audio pass through only if a host actually connects output; UI connects to a muted gain.
    if (outputs[0]?.[0]) outputs[0][0].fill(0);
    return true;
  }
}
registerProcessor('drum-onset-processor', DrumOnsetProcessor);
