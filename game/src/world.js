// The game's rules and state, with no drawing and no browser in it: Raka on foot and in a
// car, traffic and pedestrians, police and the wanted level, the three story missions and
// combat. step() advances one fixed step and returns what happened as bit flags, so the
// caller can react without the world knowing about screens or sound. The camera yaw comes in
// from the caller: on-foot movement and shooting are relative to where the camera looks.
import {
  CAR, DAY, GRAB_RADIUS, GRAB_SECONDS, MISSIONS, PED, PED_COUNT, PLACES, PLAYER, POLICE, STEP, TRAFFIC, TRAFFIC_COUNT,
  WANTED, WORLD,
} from './config.js';
import { buildCity, clampToWorld, collideBuildings, nearestRoad, onRoad } from './city.js';
import { pick, range } from './random.js';

export const EVENT_PICKUP = 1;
export const EVENT_DELIVER = 2;
export const EVENT_MISSION = 4;
export const EVENT_STORY = 8;
export const EVENT_WASTED = 16;
export const EVENT_BUSTED = 32;
export const EVENT_SHOT = 64;
export const EVENT_PUNCH = 128;
export const EVENT_HIT_PED = 256;
export const EVENT_CRIME = 512;
export const EVENT_CAR_ENTER = 1024;
export const EVENT_CAR_EXIT = 2048;
export const EVENT_GRAB = 4096;

const TAU = Math.PI * 2;

function angleLerp(a, b, t) {
  let diff = (b - a) % TAU;
  if (diff > Math.PI) diff -= TAU;
  if (diff < -Math.PI) diff += TAU;
  return a + diff * t;
}

function angleTo(fromX, fromZ, toX, toZ) {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

function dist(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

export function createWorld(random) {
  const city = buildCity(random);

  const player = {
    x: 20, z: 6, heading: Math.PI / 2, onFoot: true, health: PLAYER.health,
    money: 0, ammo: PLAYER.ammoStart, wanted: 0, car: -1,
    punchCooldown: 0, shootCooldown: 0, bustTimer: 0, speed: 0,
    /** Seconds after a ram during which no cruiser can ram the player again. */
    ramImmune: 0,
  };

  const cars = [];
  for (let index = 0; index < TRAFFIC_COUNT + 8; index += 1) {
    cars.push({
      active: false, kind: 'traffic', x: 0, z: 0, heading: 0, speed: 0,
      color: 0x888888, route: 0, waypoint: 0, cruise: 11, ramCooldown: 0,
      blockTimer: 0, hp: 100, slide: 0,
    });
  }
  const peds = [];
  for (let index = 0; index < PED_COUNT; index += 1) {
    peds.push({
      active: false, x: 0, z: 0, heading: 0, speed: 0, color: 0x888888,
      axis: 'x', fixed: 0, dir: 1, state: 'walk', stateTimer: 0, hp: 50,
    });
  }

  const state = {
    player, cars, peds, city,
    clockHours: DAY.startHour, elapsed: 0,
    mission: { index: -1, step: 0, active: false, grab: 0, intro: '', outro: '' },
    storyDone: false,
    calmTimer: 0, decayTimer: 0, roadblockTimer: 0, roadblockOn: false,
    stats: { crimes: 0, carsStolen: 0, pedsHit: 0, shotsFired: 0, missionsDone: 0 },
  };

  function spawnTraffic() {
    let placed = 0;
    for (const car of cars) {
      if (placed >= TRAFFIC_COUNT) break;
      if (car.active) continue;
      const route = city.routes[placed % city.routes.length];
      const point = route[placed % route.length];
      car.active = true;
      car.kind = 'traffic';
      car.x = point.x;
      car.z = point.z;
      car.route = placed % city.routes.length;
      car.waypoint = (placed % route.length) + 1 < route.length ? (placed % route.length) + 1 : 0;
      car.heading = angleTo(point.x, point.z, route[car.waypoint].x, route[car.waypoint].z);
      car.speed = range(random, TRAFFIC.speedMin, TRAFFIC.speedMax);
      car.cruise = car.speed;
      car.color = pick(random, [0xd94f3d, 0x3d7dd9, 0xe8c33a, 0x7a4fd0, 0x4a9c6b, 0xc0c0c0, 0x2a2a2a]);
      placed += 1;
    }
    // Parked cars the player can steal.
    for (const spot of city.parkedCars) {
      const car = cars.find((candidate) => !candidate.active);
      if (!car) break;
      car.active = true;
      car.kind = 'parked';
      car.x = spot.x;
      car.z = spot.z;
      car.heading = spot.heading;
      car.speed = 0;
      car.cruise = 0;
      car.color = spot.color;
    }
  }

  function spawnPeds() {
    for (const ped of peds) {
      const road = pick(random, WORLD.roads);
      const along = range(random, -180, 180);
      const side = random() < 0.5 ? -1 : 1;
      ped.active = true;
      ped.axis = random() < 0.5 ? 'x' : 'z';
      if (ped.axis === 'x') {
        ped.z = road + side * 8.6;
        ped.x = along;
      } else {
        ped.x = road + side * 8.6;
        ped.z = along;
      }
      ped.dir = random() < 0.5 ? -1 : 1;
      ped.heading = ped.axis === 'x' ? (ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (ped.dir > 0 ? 0 : Math.PI);
      ped.speed = range(random, PED.walkMin, PED.walkMax);
      ped.color = pick(random, [0xc65a4a, 0x4a9c6b, 0x8a6fc0, 0xd0a03a, 0x5a8a9c]);
      ped.state = 'walk';
      ped.stateTimer = 0;
      ped.hp = 50;
    }
  }

  function reset() {
    player.x = 20;
    player.z = 6;
    player.heading = Math.PI / 2;
    player.onFoot = true;
    player.health = PLAYER.health;
    player.money = 0;
    player.ammo = PLAYER.ammoStart;
    player.wanted = 0;
    player.car = -1;
    player.punchCooldown = 0;
    player.shootCooldown = 0;
    player.bustTimer = 0;
    player.speed = 0;
    for (const car of cars) car.active = false;
    for (const ped of peds) ped.active = false;
    state.clockHours = DAY.startHour;
    state.elapsed = 0;
    state.mission = { index: -1, step: 0, active: false, grab: 0, intro: '', outro: '' };
    state.storyDone = false;
    state.calmTimer = 0;
    state.decayTimer = 0;
    state.roadblockTimer = 0;
    state.roadblockOn = false;
    state.stats = { crimes: 0, carsStolen: 0, pedsHit: 0, shotsFired: 0, missionsDone: 0 };
    spawnTraffic();
    spawnPeds();
  }

  function addWanted(amount, events) {
    if (amount <= 0) return events;
    player.wanted = Math.min(WANTED.max, player.wanted + amount);
    state.calmTimer = 0;
    state.decayTimer = 0;
    state.stats.crimes += 1;
    return events | EVENT_CRIME;
  }

  function nearestPoliceDistance() {
    let best = Infinity;
    for (const car of cars) {
      if (!car.active || car.kind !== 'police') continue;
      best = Math.min(best, dist(player.x, player.z, car.x, car.z));
    }
    return best;
  }

  /** The car the player could enter right now, or null. */
  function enterableCar() {
    let best = null;
    let bestDist = 4.5;
    for (let index = 0; index < cars.length; index += 1) {
      const car = cars[index];
      if (!car.active || car.kind === 'police') continue;
      if (car.kind === 'traffic' && car.speed > 2) continue;
      const d = dist(player.x, player.z, car.x, car.z);
      if (d < bestDist) {
        bestDist = d;
        best = index;
      }
    }
    return best;
  }

  function missionTarget() {
    const mission = state.mission;
    if (!mission.active || mission.index < 0) return null;
    const def = MISSIONS[mission.index];
    const step = def.steps[mission.step];
    if (!step) return null;
    return { ...PLACES[step.place], text: step.text, kind: step.kind };
  }

  function startMission(index) {
    const def = MISSIONS[index];
    state.mission = { index, step: 0, active: true, grab: 0, intro: def.intro, outro: '' };
    if (def.wanted) player.wanted = Math.max(player.wanted, def.wanted);
  }

  function completeMission(events) {
    const def = MISSIONS[state.mission.index];
    player.money += def.pay;
    player.ammo = Math.min(PLAYER.ammoMax, player.ammo + 12);
    state.stats.missionsDone += 1;
    state.mission.outro = def.outro;
    events |= EVENT_MISSION;
    if (state.mission.index >= MISSIONS.length - 1) {
      state.storyDone = true;
      state.mission.active = false;
      return events | EVENT_STORY;
    }
    startMission(state.mission.index + 1);
    return events;
  }

  function stepPlayerOnFoot(dt, input, cameraYaw) {
    const forwardX = Math.sin(cameraYaw);
    const forwardZ = Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw);
    const rightZ = -Math.sin(cameraYaw);
    let mx = forwardX * input.fwd + rightX * input.strafe;
    let mz = forwardZ * input.fwd + rightZ * input.strafe;
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      mx /= len;
      mz /= len;
      const targetHeading = Math.atan2(mx, mz);
      player.heading = angleLerp(player.heading, targetHeading, Math.min(1, dt * 12));
      const speed = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
      player.speed = speed;
      let nx = player.x + mx * speed * dt;
      let nz = player.z + mz * speed * dt;
      const fixed = collideBuildings(city, nx, nz, PLAYER.radius);
      nx = fixed.x;
      nz = fixed.z;
      const clamped = clampToWorld(nx, nz, 1);
      player.x = clamped.x;
      player.z = clamped.z;
    } else {
      player.speed = 0;
    }
  }

  function stepPlayerCar(dt, input, car) {
    const forwardX = Math.sin(car.heading);
    const forwardZ = Math.cos(car.heading);
    if (input.fwd > 0) car.speed += CAR.accel * input.fwd * dt;
    else if (input.fwd < 0) {
      if (car.speed > 0.5) car.speed -= CAR.brake * dt;
      else car.speed -= CAR.accel * 0.6 * dt;
    }
    if (input.handbrake) {
      car.speed -= car.speed * 0.9 * dt;
      car.slide = Math.min(1, car.slide + dt * 3);
    } else {
      car.slide = Math.max(0, car.slide - dt * 2);
    }
    car.speed -= car.speed * CAR.drag * dt;
    car.speed = Math.max(-CAR.maxReverse, Math.min(CAR.maxSpeed, car.speed));
    if (Math.abs(car.speed) < 0.05 && input.fwd === 0) car.speed = 0;
    const steerAuthority = (CAR.steerAtSpeed + (1 - CAR.steerAtSpeed) * (1 - Math.min(1, Math.abs(car.speed) / CAR.maxSpeed)))
      * (input.handbrake ? 1.5 : 1);
    const direction = car.speed >= 0 ? 1 : -1;
    // A car can still turn its wheels while creeping (30% authority at a standstill),
    // so a U-turn out of a dead end never needs a three-point shuffle.
    car.heading += input.strafe * CAR.steerRate * steerAuthority * direction * Math.min(1, 0.3 + Math.abs(car.speed) / 10) * dt;
    // Hard steering scrubs speed, so a sharp corner tightens instead of running wide.
    if (Math.abs(input.strafe) > 0.6 && Math.abs(car.speed) > 12) {
      car.speed -= car.speed * 0.6 * dt;
    }
    let nx = car.x + Math.sin(car.heading) * car.speed * dt;
    let nz = car.z + Math.cos(car.heading) * car.speed * dt;
    const fixed = collideBuildings(city, nx, nz, CAR.radius);
    if (fixed.pushed) car.speed *= 0.4;
    nx = fixed.x;
    nz = fixed.z;
    const clamped = clampToWorld(nx, nz, 3);
    if (clamped.x !== nx || clamped.z !== nz) car.speed *= 0.5;
    car.x = clamped.x;
    car.z = clamped.z;
    player.x = car.x;
    player.z = car.z;
    player.heading = car.heading;
    player.speed = Math.abs(car.speed);
    // Running a pedestrian over.
    for (const ped of peds) {
      if (!ped.active || ped.state === 'down') continue;
      if (dist(car.x, car.z, ped.x, ped.z) < CAR.radius + PED.radius && Math.abs(car.speed) > 3) {
        ped.state = 'down';
        ped.stateTimer = 6;
        ped.hp = 0;
        state.stats.pedsHit += 1;
        state.hitPed = true;
      }
    }
    void forwardX;
    void forwardZ;
  }

  function stepTraffic(dt) {
    for (const car of cars) {
      if (!car.active || car.kind !== 'traffic') continue;
      const route = city.routes[car.route % city.routes.length];
      const target = route[car.waypoint % route.length];
      // Slow down for anything ahead in the same lane.
      let blocked = false;
      for (const other of cars) {
        if (!other.active || other === car) continue;
        const dx = other.x - car.x;
        const dz = other.z - car.z;
        const ahead = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
        const side = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
        if (ahead > 0 && ahead < TRAFFIC.followGap && side < 3) {
          blocked = true;
          break;
        }
      }
      const wantedSpeed = blocked ? car.cruise * 0.35 : car.cruise;
      car.speed += (wantedSpeed - car.speed) * Math.min(1, dt * 2);
      const desired = angleTo(car.x, car.z, target.x, target.z);
      car.heading = angleLerp(car.heading, desired, Math.min(1, dt * 2.2));
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;
      if (dist(car.x, car.z, target.x, target.z) < 4) {
        car.waypoint = (car.waypoint + 1) % route.length;
      }
    }
  }

  function stepPeds(dt) {
    for (const ped of peds) {
      if (!ped.active) continue;
      if (ped.state === 'down') {
        ped.stateTimer -= dt;
        if (ped.stateTimer <= 0) {
          ped.state = 'flee';
          ped.stateTimer = 3;
          ped.hp = 50;
        }
        continue;
      }
      // Flee a fast car or a recent gunshot.
      const playerCar = player.car >= 0 ? cars[player.car] : null;
      const threatX = playerCar ? playerCar.x : player.x;
      const threatZ = playerCar ? playerCar.z : player.z;
      const threatSpeed = playerCar ? Math.abs(playerCar.speed) : player.speed;
      if (ped.state !== 'flee' && dist(ped.x, ped.z, threatX, threatZ) < 7 && threatSpeed > 8) {
        ped.state = 'flee';
        ped.stateTimer = 3;
      }
      if (ped.state === 'flee') {
        ped.stateTimer -= dt;
        const away = angleTo(threatX, threatZ, ped.x, ped.z);
        ped.heading = angleLerp(ped.heading, away, Math.min(1, dt * 6));
        ped.x += Math.sin(ped.heading) * PED.fleeSpeed * dt;
        ped.z += Math.cos(ped.heading) * PED.fleeSpeed * dt;
        const fixed = collideBuildings(city, ped.x, ped.z, PED.radius);
        ped.x = fixed.x;
        ped.z = fixed.z;
        const clamped = clampToWorld(ped.x, ped.z, 1);
        ped.x = clamped.x;
        ped.z = clamped.z;
        if (ped.stateTimer <= 0) ped.state = 'walk';
        continue;
      }
      ped.x += Math.sin(ped.heading) * ped.speed * dt;
      ped.z += Math.cos(ped.heading) * ped.speed * dt;
      // At an intersection, sometimes turn onto the crossing road.
      if (onRoad(ped.x, ped.z) && Math.abs(ped.x - nearestRoad(ped.x)) < 1 && Math.abs(ped.z - nearestRoad(ped.z)) < 1) {
        if (random() < dt * 0.5) {
          if (ped.axis === 'x') {
            ped.axis = 'z';
            ped.fixed = nearestRoad(ped.x);
            ped.x = ped.fixed + (random() < 0.5 ? -8.6 : 8.6);
            ped.dir = random() < 0.5 ? -1 : 1;
            ped.heading = ped.dir > 0 ? 0 : Math.PI;
          } else {
            ped.axis = 'x';
            ped.fixed = nearestRoad(ped.z);
            ped.z = ped.fixed + (random() < 0.5 ? -8.6 : 8.6);
            ped.dir = random() < 0.5 ? -1 : 1;
            ped.heading = ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          }
        }
      }
      const fixed = collideBuildings(city, ped.x, ped.z, PED.radius);
      ped.x = fixed.x;
      ped.z = fixed.z;
      const clamped = clampToWorld(ped.x, ped.z, 1);
      ped.x = clamped.x;
      ped.z = clamped.z;
    }
  }

  function spawnPolice() {
    const wantedCruisers = Math.min(player.wanted + 1, POLICE.maxCruisers);
    let active = 0;
    for (const car of cars) if (car.active && car.kind === 'police') active += 1;
    if (active >= wantedCruisers) return;
    const spot = cars.find((candidate) => !candidate.active);
    if (!spot) return;
    // Appear on a road a good distance away, so the chase visibly arrives.
    const angle = random() * TAU;
    let x = player.x + Math.sin(angle) * POLICE.spawnDistance;
    let z = player.z + Math.cos(angle) * POLICE.spawnDistance;
    x = nearestRoad(x);
    z = Math.max(-180, Math.min(180, z));
    if (Math.abs(x - player.x) < 40 && Math.abs(z - player.z) < 40) {
      x = player.x + (x >= player.x ? 90 : -90);
    }
    spot.active = true;
    spot.kind = 'police';
    spot.x = x;
    spot.z = z;
    spot.heading = angleTo(x, z, player.x, player.z);
    spot.speed = 0;
    spot.cruise = POLICE.chaseSpeed;
    spot.color = 0xe8e8e8;
    spot.ramCooldown = 0;
    spot.blockTimer = 0;
  }

  function stepPolice(dt, events) {
    if (player.wanted > 0) spawnPolice();
    // Roadblock: at three stars or more, two cruisers park across the road ahead.
    if (player.wanted >= POLICE.roadblockStars && !state.roadblockOn) {
      state.roadblockOn = true;
      state.roadblockTimer = 20;
      const aheadX = player.x + Math.sin(player.heading) * 26;
      const aheadZ = player.z + Math.cos(player.heading) * 26;
      const sideX = Math.cos(player.heading);
      const sideZ = -Math.sin(player.heading);
      let placed = 0;
      for (const car of cars) {
        if (placed >= 2 || car.active) continue;
        car.active = true;
        car.kind = 'police';
        car.x = aheadX + sideX * (placed === 0 ? -4 : 4);
        car.z = aheadZ + sideZ * (placed === 0 ? -4 : 4);
        car.heading = player.heading + Math.PI / 2;
        car.speed = 0;
        car.cruise = 0;
        car.color = 0xe8e8e8;
        car.blockTimer = 20;
        placed += 1;
      }
    }
    if (state.roadblockOn) {
      state.roadblockTimer -= dt;
      if (state.roadblockTimer <= 0 || player.wanted < POLICE.roadblockStars) state.roadblockOn = false;
    }
    for (const car of cars) {
      if (!car.active || car.kind !== 'police') continue;
      if (car.blockTimer > 0) {
        car.blockTimer -= dt;
        continue;
      }
      if (player.wanted === 0) {
        car.active = false;
        continue;
      }
      // Chase the player, aiming slightly ahead of where they are going.
      const lead = 0.6;
      const targetX = player.x + Math.sin(player.heading) * player.speed * lead;
      const targetZ = player.z + Math.cos(player.heading) * player.speed * lead;
      const desired = angleTo(car.x, car.z, targetX, targetZ);
      car.heading = angleLerp(car.heading, desired, Math.min(1, dt * 2.5));
      car.speed += (POLICE.chaseSpeed - car.speed) * Math.min(1, dt * 1.2);
      let nx = car.x + Math.sin(car.heading) * car.speed * dt;
      let nz = car.z + Math.cos(car.heading) * car.speed * dt;
      const fixed = collideBuildings(city, nx, nz, CAR.radius);
      if (fixed.pushed) car.speed *= 0.5;
      car.x = fixed.x;
      car.z = fixed.z;
      const clamped = clampToWorld(car.x, car.z, 3);
      car.x = clamped.x;
      car.z = clamped.z;
      // Ram the player on contact: damage, and shove them — never pin them in place. A
      // cruiser hitting Raka on foot hurts less than hitting his car: the shove throws him
      // clear, so one cruiser cannot chain-ram him to death. After any ram the player is
      // immune for a moment, so five cruisers cannot take turns holding the car still.
      car.ramCooldown -= dt;
      if (car.ramCooldown <= 0 && player.ramImmune <= 0
        && dist(car.x, car.z, player.x, player.z) < CAR.radius + PLAYER.radius + 0.4) {
        car.ramCooldown = POLICE.ramCooldown;
        player.ramImmune = 1.5;
        player.health -= player.onFoot ? 5 : POLICE.ramDamage;
        const awayX = player.x - car.x;
        const awayZ = player.z - car.z;
        const awayLen = Math.max(0.01, Math.hypot(awayX, awayZ));
        if (!player.onFoot && player.car >= 0) {
          const playerCar = cars[player.car];
          playerCar.x += (awayX / awayLen) * 1.5;
          playerCar.z += (awayZ / awayLen) * 1.5;
          playerCar.speed *= 0.7;
        } else {
          player.x += (awayX / awayLen) * 2;
          player.z += (awayZ / awayLen) * 2;
        }
        car.speed *= 0.6;
        if (player.health <= 0) {
          player.health = 0;
          events |= EVENT_WASTED;
        }
      }
    }
    return events;
  }

  function stepWanted(dt) {
    if (player.wanted === 0) return;
    const nearest = nearestPoliceDistance();
    if (nearest < 40) {
      state.calmTimer = 0;
      state.decayTimer = 0;
      return;
    }
    state.calmTimer += dt;
    if (state.calmTimer < WANTED.calmSeconds) return;
    state.decayTimer += dt;
    if (state.decayTimer >= WANTED.decaySeconds) {
      state.decayTimer = 0;
      player.wanted = Math.max(0, player.wanted - 1);
    }
  }

  function stepMissions(dt, input, events) {
    const mission = state.mission;
    if (!mission.active) {
      // Walk up to Mira to start the story.
      if (mission.index === -1 && dist(player.x, player.z, PLACES.mira.x, PLACES.mira.z) < 4) {
        startMission(0);
        events |= EVENT_PICKUP;
      }
      return events;
    }
    const def = MISSIONS[mission.index];
    const stepDef = def.steps[mission.step];
    if (!stepDef) return events;
    const place = PLACES[stepDef.place];
    const d = dist(player.x, player.z, place.x, place.z);
    if (stepDef.kind === 'goto' || stepDef.kind === 'escape') {
      if (d < 6) {
        mission.step += 1;
        events |= EVENT_DELIVER;
        if (mission.step >= def.steps.length) events = completeMission(events);
      }
    } else if (stepDef.kind === 'grab') {
      if (d < GRAB_RADIUS && input.interactHeld) {
        mission.grab += dt;
        if (mission.grab >= GRAB_SECONDS) {
          mission.grab = 0;
          mission.step += 1;
          events |= EVENT_GRAB;
          if (mission.step >= def.steps.length) events = completeMission(events);
        }
      } else {
        // Progress fades slowly, so the safe can be cracked in bursts between dodging cops.
        mission.grab = Math.max(0, mission.grab - dt * 0.5);
      }
    }
    return events;
  }

  function stepCombat(dt, input, cameraYaw, events) {
    player.punchCooldown -= dt;
    player.shootCooldown -= dt;
    if (!player.onFoot) return events;
    if (input.punch && player.punchCooldown <= 0) {
      player.punchCooldown = PLAYER.punchCooldown;
      events |= EVENT_PUNCH;
      const fx = Math.sin(player.heading);
      const fz = Math.cos(player.heading);
      let best = null;
      let bestDist = PLAYER.punchRange;
      for (const ped of peds) {
        if (!ped.active || ped.state === 'down') continue;
        const dx = ped.x - player.x;
        const dz = ped.z - player.z;
        const dd = Math.hypot(dx, dz);
        if (dd < bestDist && (dx * fx + dz * fz) / Math.max(dd, 0.001) > 0.3) {
          bestDist = dd;
          best = ped;
        }
      }
      if (best) {
        best.hp -= PLAYER.punchDamage;
        if (best.hp <= 0) {
          best.state = 'down';
          best.stateTimer = 6;
          best.hp = 0;
        }
        if (nearestPoliceDistance() < 50) events = addWanted(1, events);
      }
      // Punching a cruiser is a worse idea: it notices.
      for (const car of cars) {
        if (!car.active || car.kind !== 'police') continue;
        if (dist(player.x, player.z, car.x, car.z) < CAR.radius + 1.2) {
          events = addWanted(WANTED.punchCop, events);
          break;
        }
      }
    }
    if (input.shoot && player.shootCooldown <= 0 && player.ammo > 0) {
      player.shootCooldown = PLAYER.shootCooldown;
      player.ammo -= 1;
      state.stats.shotsFired += 1;
      events |= EVENT_SHOT;
      events = addWanted(WANTED.shoot, events);
      const dirX = Math.sin(cameraYaw);
      const dirZ = Math.cos(cameraYaw);
      let best = null;
      let bestDist = PLAYER.shootRange;
      let bestIsCop = false;
      for (const ped of peds) {
        if (!ped.active || ped.state === 'down') continue;
        const dx = ped.x - player.x;
        const dz = ped.z - player.z;
        const dd = Math.hypot(dx, dz);
        if (dd < bestDist && (dx * dirX + dz * dirZ) / Math.max(dd, 0.001) > 0.93) {
          bestDist = dd;
          best = ped;
          bestIsCop = false;
        }
      }
      for (const car of cars) {
        if (!car.active || car.kind !== 'police') continue;
        const dx = car.x - player.x;
        const dz = car.z - player.z;
        const dd = Math.hypot(dx, dz);
        if (dd < bestDist && (dx * dirX + dz * dirZ) / Math.max(dd, 0.001) > 0.93) {
          bestDist = dd;
          best = car;
          bestIsCop = true;
        }
      }
      if (best) {
        if (bestIsCop) {
          best.ramCooldown = 1;
          best.speed *= 0.2;
          events = addWanted(1, events);
        } else {
          best.hp -= PLAYER.shootDamage;
          if (best.hp <= 0) {
            best.state = 'down';
            best.stateTimer = 6;
            best.hp = 0;
          }
        }
      }
    }
    return events;
  }

  function stepCarEnterExit(input, events) {
    if (!input.interact) return events;
    if (player.onFoot) {
      const index = enterableCar();
      if (index === null) return events;
      const car = cars[index];
      player.onFoot = false;
      player.car = index;
      car.kind = car.kind === 'traffic' ? 'parked' : car.kind;
      state.stats.carsStolen += 1;
      events |= EVENT_CAR_ENTER;
      if (nearestPoliceDistance() < 50) events = addWanted(WANTED.stealCar, events);
    } else {
      const car = cars[player.car];
      const sideX = Math.cos(car.heading);
      const sideZ = -Math.sin(car.heading);
      const fixed = collideBuildings(city, car.x + sideX * 3.4, car.z + sideZ * 3.4, PLAYER.radius);
      player.x = fixed.x;
      player.z = fixed.z;
      player.onFoot = true;
      player.car = -1;
      player.speed = 0;
      // The car is not simulated while Raka is out of it, so it stops dead here instead of
      // keeping a frozen speed that would lurch forward on re-entry.
      car.speed = 0;
      events |= EVENT_CAR_EXIT;
    }
    return events;
  }

  function step(dt, input, cameraYaw) {
    let events = 0;
    state.elapsed += dt;
    state.clockHours = (DAY.startHour + (state.elapsed / DAY.cycleSeconds) * 24) % 24;
    player.ramImmune = Math.max(0, player.ramImmune - dt);

    if (player.onFoot) stepPlayerOnFoot(dt, input, cameraYaw);
    else if (player.car >= 0) stepPlayerCar(dt, input, cars[player.car]);

    // Car-to-car shoves, so traffic does not drive through the player's car. The player's
    // car shunts other cars aside instead of being stopped by them: ramming through traffic
    // is half the fun, and a chase must never pin the player in place.
    for (let a = 0; a < cars.length; a += 1) {
      const carA = cars[a];
      if (!carA.active) continue;
      for (let b = a + 1; b < cars.length; b += 1) {
        const carB = cars[b];
        if (!carB.active) continue;
        const dx = carB.x - carA.x;
        const dz = carB.z - carA.z;
        const d = Math.hypot(dx, dz);
        const min = CAR.radius * 2 - 0.6;
        if (d > 0.01 && d < min) {
          const push = (min - d) / 2;
          const nx = dx / d;
          const nz = dz / d;
          const aIsPlayer = a === player.car;
          const bIsPlayer = b === player.car;
          if (aIsPlayer || bIsPlayer) {
            // The other car takes the whole shove and gets knocked forward; the player's
            // car barely slows.
            const other = aIsPlayer ? carB : carA;
            const mine = aIsPlayer ? carA : carB;
            other.x += nx * push * (aIsPlayer ? 2 : -2);
            other.z += nz * push * (aIsPlayer ? 2 : -2);
            other.speed = Math.max(other.speed, Math.abs(mine.speed) * 0.4);
            mine.speed *= 0.9;
          } else {
            carA.x -= nx * push;
            carA.z -= nz * push;
            carB.x += nx * push;
            carB.z += nz * push;
            if (carA.kind !== 'police') carA.speed *= 0.7;
            if (carB.kind !== 'police') carB.speed *= 0.7;
          }
        }
      }
    }

    stepTraffic(dt);
    stepPeds(dt);
    events = stepPolice(dt, events);
    stepWanted(dt);
    events = stepMissions(dt, input, events);
    events = stepCombat(dt, input, cameraYaw, events);
    events = stepCarEnterExit(input, events);

    if (state.hitPed) {
      state.hitPed = false;
      events |= EVENT_HIT_PED;
      events = addWanted(WANTED.hitPed, events);
    }

    // Bust: slow and close to a cruiser for long enough.
    if (player.wanted > 0 && player.speed < 3) {
      if (nearestPoliceDistance() < 7) {
        player.bustTimer += dt;
        if (player.bustTimer >= PLAYER.bustSeconds) {
          player.bustTimer = 0;
          events |= EVENT_BUSTED;
        }
      } else {
        player.bustTimer = Math.max(0, player.bustTimer - dt);
      }
    } else {
      player.bustTimer = 0;
    }

    return events;
  }

  reset();

  return {
    state, city, reset, step,
    missionTarget,
    enterableCar,
    /** Respawn after being wasted: lose $100, wake up at the safehouse, clean slate. */
    respawn() {
      const lost = Math.min(100, player.money);
      player.money -= lost;
      player.health = PLAYER.health;
      player.wanted = 0;
      player.bustTimer = 0;
      player.onFoot = true;
      player.car = -1;
      player.x = PLACES.safehouse.x;
      player.z = PLACES.safehouse.z + 6;
      player.heading = 0;
      for (const car of cars) if (car.active && car.kind === 'police') car.active = false;
      return lost;
    },
    /** Release after a bust: the cops take $150 and the story continues. */
    release() {
      const lost = Math.min(150, player.money);
      player.money -= lost;
      player.wanted = 0;
      player.bustTimer = 0;
      player.x = PLACES.policeStation.x - 8;
      player.z = PLACES.policeStation.z;
      player.heading = Math.PI;
      player.onFoot = true;
      player.car = -1;
      for (const car of cars) if (car.active && car.kind === 'police') car.active = false;
      return lost;
    },
  };
}
