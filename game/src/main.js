// Boot and the one loop: input is read once per frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is there.
// The game moves between six screens: title, play, paused, busted, wasted and story done.
//
// ?seed=N fixes the city, the traffic and the pedestrians. ?shot=start|drive|chase|heist
// (with &seed=N) stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { GRAB_RADIUS, GRAB_SECONDS, MISSIONS, PLAYER, SAVE_KEY, STEP, STORY_TOTAL, WORLD } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld, EVENT_BUSTED, EVENT_DELIVER, EVENT_GRAB, EVENT_HIT_PED, EVENT_MISSION,
  EVENT_PICKUP, EVENT_PUNCH, EVENT_SHOT, EVENT_STORY, EVENT_WASTED,
} from './world.js';
import {
  ACTION_CONFIRM, ACTION_INTERACT, ACTION_MUTE, ACTION_PAUSE, ACTION_PUNCH, ACTION_RETRY,
  ACTION_SHOOT, createInput,
} from './input.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_DONE, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WASTED } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

/** The empty sim input: no keys, no clicks, used for the title screen's ambient city. */
const IDLE_INPUT = {
  fwd: 0, strafe: 0, run: false, handbrake: false,
  interact: false, interactHeld: false, punch: false, shoot: false,
};

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas, world.city);
const audio = createAudio();

const $ = (id) => document.getElementById(id);
const hud = {
  money: $('hud-money'), stars: $('hud-stars'), clock: $('hud-clock'),
  health: $('hud-health-fill'), healthText: $('hud-health-text'), ammo: $('hud-ammo'),
  speed: $('hud-speed'), objective: $('hud-objective'), prompt: $('hud-prompt'),
  toast: $('hud-toast'), map: $('hud-map'),
};
const screens = {
  title: $('screen-title'), pause: $('screen-pause'), busted: $('screen-busted'),
  wasted: $('screen-wasted'), done: $('screen-done'),
};
const mapCtx = hud.map.getContext('2d');

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw);
    if (typeof save.money !== 'number' || typeof save.missionsDone !== 'number') return null;
    return save;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: world.state.player.money,
      missionsDone: world.state.stats.missionsDone,
      storyDone: world.state.storyDone,
    }));
  } catch {
    // Storage can be off (private windows): the save then lasts this visit only.
  }
}

function showScreen(name) {
  for (const [key, element] of Object.entries(screens)) {
    element.classList.toggle('hidden', key !== name);
  }
  $('hud').classList.toggle('hidden', name === 'title' || name === 'done');
}

function formatClock(hours) {
  const hour = Math.floor(hours) % 24;
  const minute = Math.floor((hours % 1) * 60);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function drawMinimap() {
  const size = 180;
  const scale = size / (WORLD.half * 2 + 20);
  const toMap = (value) => (value + WORLD.half + 10) * scale;
  mapCtx.clearRect(0, 0, size, size);
  mapCtx.fillStyle = 'rgba(10, 14, 20, 0.82)';
  mapCtx.fillRect(0, 0, size, size);
  // Roads.
  mapCtx.fillStyle = '#5a5f6a';
  for (const road of WORLD.roads) {
    mapCtx.fillRect(0, toMap(road) - 3, size, 6);
    mapCtx.fillRect(toMap(road) - 3, 0, 6, size);
  }
  // Buildings.
  mapCtx.fillStyle = '#2c313c';
  for (const building of world.city.buildings) {
    mapCtx.fillRect(toMap(building.x - building.w / 2), toMap(building.z - building.d / 2), building.w * scale, building.d * scale);
  }
  // Mission target.
  const target = world.missionTarget();
  if (target) {
    const pulse = 5 + Math.sin(performance.now() / 300) * 2;
    mapCtx.fillStyle = '#ffd23a';
    mapCtx.beginPath();
    mapCtx.arc(toMap(target.x), toMap(target.z), pulse, 0, Math.PI * 2);
    mapCtx.fill();
  }
  // Traffic cars as white dots, police as flashing blue/red.
  for (const car of world.state.cars) {
    if (!car.active) continue;
    if (car.kind === 'police') {
      mapCtx.fillStyle = Math.floor(performance.now() / 250) % 2 === 0 ? '#ff4444' : '#4488ff';
    } else {
      mapCtx.fillStyle = '#e8e8e8';
    }
    mapCtx.fillRect(toMap(car.x) - 2, toMap(car.z) - 2, 4, 4);
  }
  // The player, an arrow pointing where they face.
  const player = world.state.player;
  mapCtx.save();
  mapCtx.translate(toMap(player.x), toMap(player.z));
  mapCtx.rotate(Math.atan2(Math.sin(player.heading), Math.cos(player.heading)) + Math.PI);
  mapCtx.fillStyle = '#ffd23a';
  mapCtx.beginPath();
  mapCtx.moveTo(0, -7);
  mapCtx.lineTo(5, 5);
  mapCtx.lineTo(-5, 5);
  mapCtx.closePath();
  mapCtx.fill();
  mapCtx.restore();
}

let toastTimer = 0;
function toast(message, seconds = 4) {
  hud.toast.textContent = message;
  hud.toast.classList.remove('hidden');
  toastTimer = seconds;
}

function updateHud() {
  const player = world.state.player;
  hud.money.textContent = `$${player.money.toLocaleString('en-US')}`;
  hud.stars.textContent = '★'.repeat(player.wanted) + '☆'.repeat(5 - player.wanted);
  hud.stars.classList.toggle('hot', player.wanted > 0);
  hud.clock.textContent = formatClock(world.state.clockHours);
  hud.health.style.width = `${Math.max(0, player.health)}%`;
  hud.healthText.textContent = `${Math.max(0, Math.ceil(player.health))} HP`;
  hud.ammo.textContent = `🔫 ${player.ammo}`;
  const carSpeed = player.car >= 0 ? world.state.cars[player.car].speed : 0;
  const speedKmh = Math.round(Math.abs(player.onFoot ? player.speed : carSpeed) * 3.6);
  hud.speed.textContent = player.onFoot ? '' : `${speedKmh} km/h`;
  const target = world.missionTarget();
  const mission = world.state.mission;
  if (world.state.storyDone) {
    hud.objective.textContent = `Cerita selesai — $${STORY_TOTAL.toLocaleString('en-US')} diraih.`;
  } else if (target) {
    const def = MISSIONS[mission.index];
    hud.objective.textContent = `${def.title} · ${target.text}`;
  } else if (mission.index === -1) {
    hud.objective.textContent = 'Temui Mira di persimpangan (penanda kuning) untuk mulai.';
  } else {
    hud.objective.textContent = '';
  }
  const enterable = player.onFoot ? world.enterableCar() : null;
  if (enterable !== null) {
    hud.prompt.textContent = 'E — Masuk Mobil';
    hud.prompt.classList.remove('hidden');
  } else if (!player.onFoot) {
    hud.prompt.textContent = 'E — Keluar Mobil';
    hud.prompt.classList.remove('hidden');
  } else if (target && target.kind === 'grab' && Math.hypot(player.x - target.x, player.z - target.z) < GRAB_RADIUS) {
    hud.prompt.textContent = `Tahan E — Membuka brankas… ${Math.round((mission.grab / GRAB_SECONDS) * 100)}%`;
    hud.prompt.classList.remove('hidden');
  } else {
    hud.prompt.classList.add('hidden');
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  if (scene.screen !== SCREEN_TITLE) {
    // Gameplay shots: hide the title overlay and show the HUD over the staged game.
    screens.title.classList.add('hidden');
    $('hud').classList.remove('hidden');
  }
  // The heist shot stages Raka face-to-face with the warehouse wall; swing the camera
  // to the side so the judge sees him, the safe marker beam, and the warehouse together.
  const orbit = name === 'heist' ? 1.25 : 0;
  if (orbit) renderer.addOrbit(orbit);
  // Shot mode paints only two frames, far too few for the follow-cam lerp to catch up:
  // point the camera at the staged heading at once.
  if (scene.screen !== SCREEN_TITLE) renderer.snapYaw(world.state.player.heading + orbit);
  updateHud();
  drawMinimap();
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.elapsed, world.missionTarget());
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  const saved = readSave();
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();
  let saveTimer = 0;

  function resize() {
    renderer.resize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);
  resize();

  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset();
    if (saved && saved.missionsDone > 0 && !saved.storyDone) {
      world.state.player.money = saved.money;
      toast(`Save dimuat: $${saved.money} dan ${saved.missionsDone} misi selesai. Temui Mira lagi.`);
    }
    accumulator = 0;
    screen = SCREEN_PLAY;
    showScreen('play');
    announce('Playing. Meet Mira at the yellow marker.');
  }

  function toBusted() {
    screen = SCREEN_BUSTED;
    showScreen('busted');
    audio.busted();
    announce('Busted by the police.');
  }

  function toWasted() {
    screen = SCREEN_WASTED;
    showScreen('wasted');
    audio.busted();
    announce('Wasted.');
  }

  function toDone() {
    screen = SCREEN_DONE;
    showScreen('done');
    $('done-total').textContent = `$${world.state.player.money.toLocaleString('en-US')}`;
    announce('Story complete.');
  }

  function handleEvents(events) {
    if (events & EVENT_SHOT) audio.gunshot();
    if (events & EVENT_PUNCH) audio.punch();
    if (events & EVENT_PICKUP) {
      audio.chime();
      toast(world.state.mission.intro, 6);
    }
    if (events & EVENT_DELIVER) audio.chime();
    if (events & EVENT_GRAB) audio.chime();
    if (events & EVENT_HIT_PED) toast('Kamu menabrak pejalan kaki! Polisi mengejarmu.', 3);
    if (events & EVENT_MISSION) {
      audio.jingle();
      const outro = world.state.mission.outro;
      if (outro) toast(outro, 6);
      writeSave();
    }
    if (events & EVENT_STORY) toDone();
    else if (events & EVENT_WASTED) toWasted();
    else if (events & EVENT_BUSTED) toBusted();
  }

  function stepSim(actions) {
    const simInput = {
      fwd: input.fwd(),
      strafe: input.strafe(),
      run: input.run(),
      handbrake: input.run(),
      interact: Boolean(actions & ACTION_INTERACT),
      interactHeld: input.interactHeld(),
      punch: Boolean(actions & ACTION_PUNCH),
      shoot: Boolean(actions & ACTION_SHOOT),
    };
    audio.unlock();
    const events = world.step(STEP, simInput, renderer.cameraYaw());
    handleEvents(events);
    audio.update(STEP, world.state.player.speed, world.state.player.wanted);
    saveTimer += STEP;
    if (saveTimer > 10) {
      saveTimer = 0;
      writeSave();
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) hud.toast.classList.add('hidden');
    }
    const actions = input.takeActions();
    renderer.addOrbit(input.takeOrbit());
    renderer.setPitch(input.cameraPitch());
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      toast(muted ? 'Suara mati (M).' : 'Suara hidup (M).', 2);
    }

    if (screen === SCREEN_TITLE) {
      // The city lives behind the title: traffic rolls, pedestrians walk.
      accumulator += dt;
      while (accumulator >= STEP) {
        world.step(STEP, IDLE_INPUT, renderer.cameraYaw());
        accumulator -= STEP;
      }
      if (actions & ACTION_CONFIRM) startGame();
      renderer.draw(world.state, SCREEN_TITLE, now / 1000, null);
      return;
    }

    if (screen === SCREEN_PLAY) {
      accumulator += dt;
      let first = true;
      while (accumulator >= STEP) {
        stepSim(first ? actions : 0);
        accumulator -= STEP;
        first = false;
        if (screen !== SCREEN_PLAY) break;
      }
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
        showScreen('pause');
        announce('Paused.');
      }
    } else if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        showScreen('play');
        announce('Playing.');
      }
    } else if (screen === SCREEN_WASTED || screen === SCREEN_BUSTED || screen === SCREEN_DONE) {
      if (actions & (ACTION_CONFIRM | ACTION_RETRY)) {
        if (screen === SCREEN_WASTED) {
          const lost = world.respawn();
          toast(lost > 0 ? `Kamu bangun di Rumah Aman. Kehilangan $${lost}.` : 'Kamu bangun di Rumah Aman.', 4);
        }
        if (screen === SCREEN_BUSTED) {
          const lost = world.release();
          toast(lost > 0 ? `Polisi melepasmu dengan denda $${lost}.` : 'Polisi melepasmu.', 4);
        }
        if (screen === SCREEN_DONE) world.reset();
        screen = SCREEN_PLAY;
        showScreen('play');
        announce('Playing.');
      }
    }

    if (screen !== SCREEN_TITLE) {
      updateHud();
      drawMinimap();
      renderer.draw(world.state, SCREEN_PLAY, now / 1000, world.missionTarget());
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      showScreen('pause');
      announce('Paused.');
    }
  });

  // A small read-only handle for automated playtests: position, mission, screen.
  window.__teluk = {
    world,
    screen: () => screen,
    player: () => ({ ...world.state.player }),
    mission: () => ({ ...world.state.mission }),
    // The true movement basis: on-foot movement is camera-relative, and the camera
    // yaw chases the player's heading with a short lag, so heading alone misleads.
    cameraYaw: () => renderer.cameraYaw(),
  };

  showScreen('title');
  announce('Teluk Bayu 3D. Press Enter or click Start to play.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
