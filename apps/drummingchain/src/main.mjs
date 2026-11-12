import { normalizeHit, deriveMetrics, localReceipt, newSecret, ROUND_MS } from './engine.mjs';

const $ = (id) => document.getElementById(id);
const stage = $('stage'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const video = $('camera');
const ui = {
  status: $('status'), statusText: $('statusText'), input: $('inputLabel'),
  clock: $('clock'), hits: $('hits'), spm: $('spm'), err: $('gridError'),
  tempo: $('tempo'), stageTempo: $('stageTempo'), tempoText: $('tempoText'),
  sensitivity: $('sensitivity'), sensitivityText: $('sensitivityText'),
  level: $('level'), levelText: $('levelText'), start: $('start'), stop: $('stop'),
  cam: $('camButton'), demo: $('demo'), exp: $('export'), events: $('events'),
  round: $('round'), evidence: $('evidence'), message: $('message'),
};
let audio = null, micStream = null, camStream = null, source = null, processor = null;
let demoTimer = null, captureStarted = 0, audioStart = 0, durationMs = 0;
let mode = 'idle', secret = '', events = [], flares = [], energy = 0;
let pad = { x: .5, y: .55, rx: .22, ry: .13 };
let exportedReceipt = null;

const timeFmt = (ms) => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const setMessage = (s) => ui.message.textContent = s;
function setStatus(s, live = false) {
  ui.status.classList.toggle('on', live);
  ui.statusText.textContent = s;
}
function uiMode(next) {
  mode = next;
  const active = next === 'mic' || next === 'demo';
  ui.start.disabled = active;
  ui.demo.disabled = active;
  ui.stop.disabled = !active;
  ui.exp.disabled = active || !events.length;
  ui.input.textContent = next === 'mic' ? 'MICROPHONE • UNVERIFIED' : next === 'demo' ? 'SIMULATED • NOT EVIDENCE' : 'NO LIVE SENSOR';
  ui.evidence.textContent = next === 'mic' ? 'LOCAL / UNSIGNED' : next === 'demo' ? 'SIMULATED' : 'LOCAL / UNSIGNED';
  setStatus(next === 'mic' ? 'MICROPHONE / LIVE' : next === 'demo' ? 'DEMO / SIMULATED' : next === 'idle' ? 'LOCAL / IDLE' : 'LOCAL / STOPPED', active);
}
function resetSession() {
  events = []; flares = []; exportedReceipt = null; durationMs = 0;
  captureStarted = performance.now();
  secret = newSecret();
  ui.events.innerHTML = '<div class="event">Listening for attacks…</div>';
  paintStats();
}
function recordHit(raw) {
  if (mode !== 'mic' && mode !== 'demo') return;
  try {
    const hit = normalizeHit(raw, events.length);
    // Ignore out-of-order worklet events; display and accounting use a single monotonic clock.
    if (events.length && hit.t_ms < events[events.length - 1].t_ms) return;
    if (hit.t_ms > 86_400_000) return;
    events.push(hit);
    flares.push({ start: performance.now(), power: hit.strength, seq: hit.seq });
    if (flares.length > 14) flares.shift();
    paintStats();
  } catch (error) { console.warn('Ignored malformed strike', error); }
}
function paintStats() {
  const metrics = deriveMetrics(events, durationMs, Number(ui.tempo.value));
  ui.hits.textContent = String(events.length).padStart(3, '0');
  ui.spm.textContent = metrics.observed_strokes_per_min === null ? '—' : String(Math.round(metrics.observed_strokes_per_min));
  ui.err.textContent = metrics.relative_grid_error_ms === null ? '—' : Math.round(metrics.relative_grid_error_ms) + 'ms';
  const n = Math.floor(Math.max(0, durationMs - 0.00001) / ROUND_MS);
  ui.round.textContent = String(n + 1).padStart(2, '0') + ' / ' + timeFmt(durationMs % ROUND_MS);
  ui.clock.textContent = timeFmt(durationMs);
  const recent = [...events].slice(-6).reverse();
  ui.events.replaceChildren();
  if (!recent.length) { ui.events.textContent = 'No strikes recorded yet.'; return; }
  for (const e of recent) {
    const row = document.createElement('div'); row.className = 'event';
    const t = document.createElement('span'); t.textContent = '#' + String(e.seq + 1).padStart(3, '0') + ' · ' + (e.t_ms / 1000).toFixed(2) + 's';
    const meta = document.createElement('b'); meta.textContent = e.source.toUpperCase() + ' / ' + Math.round(e.strength * 100) + '%';
    row.append(t, meta); ui.events.append(row);
  }
}

function sizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(stage.clientWidth * dpr);
  canvas.height = Math.round(stage.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function drawOverlay(now) {
  const w = stage.clientWidth, h = stage.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const x = pad.x * w, y = pad.y * h, rx = pad.rx * w, ry = pad.ry * h;
  ctx.save();
  ctx.setLineDash([6, 9]); ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(107,245,204,.46)';
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]); ctx.strokeStyle = 'rgba(107,245,204,.17)';
  ctx.beginPath(); ctx.moveTo(x - rx * .2, y); ctx.lineTo(x + rx * .2, y); ctx.moveTo(x, y - ry * .24); ctx.lineTo(x, y + ry * .24); ctx.stroke();
  flares = flares.filter((f) => now - f.start < 650);
  for (const f of flares) {
    const p = Math.min(1, (now - f.start) / 650);
    const alpha = (1 - p) * .85;
    ctx.beginPath(); ctx.ellipse(x, y, rx * (.24 + .83 * p), ry * (.24 + .83 * p), 0, 0, Math.PI * 2);
    ctx.lineWidth = (2.5 - p * 1.3) * (1 + f.power);
    ctx.strokeStyle = 'rgba(128,255,208,' + alpha.toFixed(3) + ')';
    ctx.shadowColor = '#73f3ca'; ctx.shadowBlur = 18; ctx.stroke();
  }
  ctx.restore();
  requestAnimationFrame(drawOverlay);
}
function tick() {
  if (mode === 'mic' || mode === 'demo') {
    durationMs = Math.max(0, performance.now() - captureStarted);
    paintStats();
  }
}
setInterval(tick, 175);
window.addEventListener('resize', sizeCanvas);
stage.addEventListener('pointerdown', (e) => {
  const bounds = stage.getBoundingClientRect();
  pad.x = Math.max(.16, Math.min(.84, (e.clientX - bounds.left) / bounds.width));
  pad.y = Math.max(.18, Math.min(.82, (e.clientY - bounds.top) / bounds.height));
});
ui.tempo.addEventListener('input', () => {
  ui.tempoText.textContent = ui.tempo.value + ' BPM';
  ui.stageTempo.textContent = ui.tempo.value;
  paintStats();
});
ui.sensitivity.addEventListener('input', () => {
  ui.sensitivityText.textContent = ui.sensitivity.value + '×';
  processor?.port.postMessage({ type: 'sensitivity', value: Number(ui.sensitivity.value) });
});

async function beginMic() {
  if (mode === 'mic' || mode === 'demo') return;
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
    setMessage('Microphone capture requires HTTPS or localhost and a browser with AudioWorklet support. You can still inspect the demo.');
    return;
  }
  ui.start.disabled = true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: 1
    }, video: false });
    audio = new AudioContext({ latencyHint: 'interactive' });
    await audio.audioWorklet.addModule(new URL('./onset-processor.js', import.meta.url));
    await audio.resume();
    source = audio.createMediaStreamSource(micStream);
    const highpass = audio.createBiquadFilter();
    highpass.type = 'highpass'; highpass.frequency.value = 160;
    processor = new AudioWorkletNode(audio, 'drum-onset-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const silent = audio.createGain(); silent.gain.value = 0;
    source.connect(highpass).connect(processor).connect(silent).connect(audio.destination);
    resetSession();
    audioStart = audio.currentTime;
    uiMode('mic');
    processor.port.postMessage({ type: 'sensitivity', value: Number(ui.sensitivity.value) });
    processor.port.onmessage = (e) => {
      if (mode !== 'mic') return;
      if (e.data.type === 'hit') {
        const elapsed = Math.max(0, (e.data.t_sec - audioStart) * 1000);
        recordHit({ tMs: elapsed, strength: e.data.strength, source: 'microphone', hand: 'unknown' });
      }
      if (e.data.type === 'level') {
        const rms = e.data.rms;
        energy = energy * .75 + rms * .25;
        ui.level.style.width = Math.min(100, Math.round(energy * 700)) + '%';
        ui.levelText.textContent = rms > e.data.threshold ? 'ATTACK' : 'LISTENING';
      }
    };
    setMessage('LIVE microphone capture. Click or tap the pad image to align the AR target. Stick-side, rebound and biomechanics are NOT inferred.');
  } catch (err) {
    await releaseAudio();
    uiMode('idle');
    setMessage('Could not start microphone: ' + (err?.message || 'permission or device unavailable') + '. Check browser permissions and HTTPS.');
  } finally { if (mode !== 'mic') ui.start.disabled = false; }
}
async function releaseAudio() {
  if (processor) processor.port.onmessage = null;
  try { source?.disconnect(); } catch {}
  try { processor?.disconnect(); } catch {}
  micStream?.getTracks().forEach((t) => t.stop());
  if (audio) await audio.close().catch(() => {});
  source = processor = micStream = audio = null;
  ui.level.style.width = '0%'; ui.levelText.textContent = 'OFF';
}
async function toggleCamera() {
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null; video.srcObject = null;
    stage.classList.remove('has-camera'); ui.cam.textContent = 'CAMERA';
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    video.srcObject = camStream;
    await video.play();
    stage.classList.add('has-camera');
    ui.cam.textContent = 'CAM OFF';
    setMessage('Camera only renders locally. Tap the actual practice pad on screen to move the augmented target. Video is never uploaded.');
  } catch (err) { setMessage('Camera not available: ' + (err?.message || 'permission denied') + '. Microphone mode still works.'); }
}
function beginDemo() {
  if (mode === 'mic' || mode === 'demo') return;
  resetSession(); uiMode('demo'); setMessage('SIMULATED HITS — visual demonstration only. Demo receipts are marked ineligible for evidence or rewards.');
  const pattern = [0, 0.15, 0.0, 0.26, -0.04, 0.05];
  let index = 0;
  demoTimer = setInterval(() => {
    const tMs = performance.now() - captureStarted;
    recordHit({ tMs, strength: Math.max(.12, .35 + pattern[index++ % pattern.length]), source: 'demo', hand: 'unknown' });
  }, 60_000 / Number(ui.tempo.value) / 2);
}
async function finish() {
  if (mode !== 'mic' && mode !== 'demo') return;
  durationMs = Math.max(0, performance.now() - captureStarted);
  if (demoTimer) clearInterval(demoTimer);
  demoTimer = null;
  await releaseAudio();
  uiMode('stopped'); paintStats();
  ui.exp.disabled = !events.length;
  setMessage('Stopped. Your data remains in this browser tab until you export. Close or reload to discard it.');
}
async function exportPractice() {
  if (!events.length || mode === 'mic' || mode === 'demo') return;
  // Only the user's local download includes raw events and the secret. A public
  // certificate would never contain both; share selectively.
  try {
    const receipt = await localReceipt({
      hits: events, durationMs, tempoBpm: Number(ui.tempo.value),
      sessionSecret: secret, createdUtc: new Date().toISOString(),
    });
    exportedReceipt = { receipt, private_event_log: events, local_secret: secret,
      advisory: 'PRIVATE EXPORT. Contains full hit log + secret. Do not publish the private_event_log or local_secret. UNSIGNED; no chain transaction.' };
    const blob = new Blob([JSON.stringify(exportedReceipt, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = href; a.download = 'drummingchain-practice-' + Date.now() + '.json';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 3000);
    setMessage('Downloaded PRIVATE practice evidence. No signature, third-party observation or chain settlement has occurred.');
  } catch (err) { setMessage('Export failed: ' + err.message); }
}
ui.start.addEventListener('click', beginMic);
ui.cam.addEventListener('click', toggleCamera);
ui.demo.addEventListener('click', beginDemo);
ui.stop.addEventListener('click', finish);
ui.exp.addEventListener('click', exportPractice);
window.addEventListener('pagehide', () => {
  if (demoTimer) clearInterval(demoTimer);
  micStream?.getTracks().forEach((t) => t.stop());
  camStream?.getTracks().forEach((t) => t.stop());
});
sizeCanvas(); requestAnimationFrame(drawOverlay); uiMode('idle'); paintStats();
