// Sound, all synthesised with WebAudio: no audio files, no network. An engine hum that
// follows the car's speed, a two-tone police siren, gunfire, a punch thud, chimes for
// pickups and a short jingle when a mission pays. Everything is guarded, so the game still
// runs when audio is unavailable or the tab is muted.
export function createAudio() {
  let context = null;
  let master = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenHigh = false;
  let sirenTimer = 0;
  let muted = false;

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 50;
      engineOsc2 = context.createOscillator();
      engineOsc2.type = 'square';
      engineOsc2.frequency.value = 25;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineGain);
      engineOsc2.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      engineOsc2.start();
      sirenOsc = context.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 700;
      sirenGain = context.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      return true;
    } catch {
      return false;
    }
  }

  function unlock() {
    if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
  }

  function blip(frequency, duration, type, volume, when = 0) {
    if (!ensure() || muted) return;
    const start = context.currentTime + when;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  function noiseBurst(duration, volume, filterFreq) {
    if (!ensure() || muted) return;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
  }

  return {
    unlock,
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    get muted() {
      return muted;
    },
    /** Call every frame: engine follows speed, siren follows the wanted level. */
    update(dt, speed, wanted) {
      if (!context) return;
      sirenTimer -= dt;
      if (wanted > 0 && !muted) {
        if (sirenTimer <= 0) {
          sirenTimer = 0.45;
          sirenHigh = !sirenHigh;
          sirenOsc.frequency.value = sirenHigh ? 880 : 660;
        }
        sirenGain.gain.setTargetAtTime(0.05, context.currentTime, 0.1);
      } else {
        sirenGain.gain.setTargetAtTime(0, context.currentTime, 0.1);
      }
      const target = muted ? 0 : Math.min(0.09, Math.abs(speed) * 0.0022);
      engineGain.gain.setTargetAtTime(target, context.currentTime, 0.1);
      engineOsc.frequency.value = 45 + Math.abs(speed) * 4.5;
      engineOsc2.frequency.value = 22 + Math.abs(speed) * 2.2;
    },
    gunshot() {
      noiseBurst(0.12, 0.5, 1800);
    },
    punch() {
      noiseBurst(0.09, 0.35, 500);
    },
    chime() {
      blip(660, 0.12, 'sine', 0.25);
      blip(990, 0.18, 'sine', 0.25, 0.09);
    },
    jingle() {
      blip(523, 0.14, 'triangle', 0.3);
      blip(659, 0.14, 'triangle', 0.3, 0.12);
      blip(784, 0.14, 'triangle', 0.3, 0.24);
      blip(1046, 0.3, 'triangle', 0.3, 0.36);
    },
    busted() {
      blip(220, 0.4, 'sawtooth', 0.25);
      blip(165, 0.6, 'sawtooth', 0.25, 0.3);
    },
  };
}
