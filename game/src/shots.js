// The screenshot scenes behind ?shot=start|drive|chase|heist. Each one plays the real rules
// forward from a fresh world for a fixed number of steps, steered by a simple autopilot (drive
// the road grid toward the mission target, hold E at the safe), so the frame is what a short
// game really looks like and the same seed always gives the same frame.
import { PLACES, STEP } from './config.js';
import { nearestRoad } from './city.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const DRIVE_SECONDS = 18;
const CHASE_SECONDS = 14;
const HEIST_SECONDS = 8;

const IDLE = {
  fwd: 0, strafe: 0, run: false, handbrake: false,
  interact: false, interactHeld: false, punch: false, shoot: false,
};

function angleDiff(a, b) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** Step the world `seconds` long with no input. */
function idleFor(world, seconds, cameraYaw = 0) {
  for (let index = 0; index < seconds / STEP; index += 1) world.step(STEP, IDLE, cameraYaw);
}

/** Walk the player to a place by teleporting (shots only) and letting the rules notice. */
function walkTo(world, x, z) {
  world.state.player.x = x;
  world.state.player.z = z;
  idleFor(world, 0.5);
}

/** Enter the parked car beside the spawn: stand next to it and press E once. */
function enterParkedCar(world) {
  world.state.player.x = 14;
  world.state.player.z = -3.6;
  world.step(STEP, { ...IDLE, interact: true }, 0);
  idleFor(world, 0.5);
}

/**
 * A road-grid route from (x, z) to (tx, tz): Manhattan moves along avenues only, then a
 * short final leg onto the target, which always sits just off a road.
 */
function routeTo(x, z, tx, tz) {
  const points = [];
  const onEastWest = Math.abs(z - nearestRoad(z)) <= Math.abs(x - nearestRoad(x));
  const approachRoad = Math.abs(tz - nearestRoad(tz)) <= Math.abs(tx - nearestRoad(tx))
    ? { axis: 'x', road: nearestRoad(tz) }
    : { axis: 'z', road: nearestRoad(tx) };
  if (approachRoad.axis === 'x') {
    // Finish along the east-west road at z = approachRoad.road.
    const rx = nearestRoad(tx);
    if (onEastWest) points.push({ x: rx, z: nearestRoad(z) });
    else points.push({ x: nearestRoad(x), z: approachRoad.road });
    points.push({ x: rx, z: approachRoad.road });
    points.push({ x: tx, z: approachRoad.road });
  } else {
    // Finish along the north-south road at x = approachRoad.road.
    const rz = nearestRoad(tz);
    if (!onEastWest) points.push({ x: nearestRoad(x), z: rz });
    else points.push({ x: approachRoad.road, z: nearestRoad(z) });
    points.push({ x: approachRoad.road, z: rz });
    points.push({ x: approachRoad.road, z: tz });
  }
  points.push({ x: tx, z: tz });
  return points;
}

/** Drive a road-grid route for `seconds`, steering at the next waypoint. */
function driveRoute(world, waypoints, seconds) {
  let waypoint = 0;
  for (let index = 0; index < seconds / STEP; index += 1) {
    const player = world.state.player;
    const car = player.car >= 0 ? world.state.cars[player.car] : null;
    if (!car) return;
    const point = waypoints[Math.min(waypoint, waypoints.length - 1)];
    if (Math.hypot(point.x - player.x, point.z - player.z) < 6 && waypoint < waypoints.length - 1) {
      waypoint += 1;
    }
    const steer = Math.max(-1, Math.min(1, angleDiff(car.heading, Math.atan2(point.x - player.x, point.z - player.z)) * 2.5));
    // Brake before a sharp turn only when already moving fast; from a standstill, floor it
    // and steer — the hard-steering scrub tightens the turn, and creeping invites a ram.
    const turn = Math.abs(angleDiff(car.heading, Math.atan2(point.x - player.x, point.z - player.z)));
    const fwd = turn > 1.0 && Math.abs(car.speed) > 12 ? 0.3 : turn > 0.45 ? 0 : 1;
    world.step(STEP, { ...IDLE, fwd, strafe: steer }, car.heading);
  }
}

function stageStart(world) {
  world.reset();
  idleFor(world, START_SECONDS);
  return { screen: SCREEN_TITLE, elapsed: START_SECONDS };
}

/**
 * Turn the player's car to face the city centre, so the shot looks down a street lined
 * with buildings instead of out over the map edge: the drive ends at the east pickup and
 * the chase at the south-east corner, and both face open ground by default.
 */
function faceCityCentre(world) {
  const player = world.state.player;
  const car = player.car >= 0 ? world.state.cars[player.car] : null;
  if (!car) return;
  const heading = Math.atan2(0 - player.x, 0 - player.z);
  car.heading = heading;
  player.heading = heading;
}

function stageDrive(world) {
  world.reset();
  walkTo(world, PLACES.mira.x, PLACES.mira.z);
  enterParkedCar(world);
  const player = world.state.player;
  driveRoute(world, routeTo(player.x, player.z, PLACES.pickup.x, PLACES.pickup.z), DRIVE_SECONDS);
  faceCityCentre(world);
  return { screen: SCREEN_PLAY, elapsed: DRIVE_SECONDS };
}

function stageChase(world) {
  world.reset();
  // Play through the first mission by the book: Mira, pickup, safehouse — which opens
  // mission two and puts three stars on the player.
  walkTo(world, PLACES.mira.x, PLACES.mira.z);
  walkTo(world, PLACES.pickup.x, PLACES.pickup.z);
  walkTo(world, PLACES.safehouse.x, PLACES.safehouse.z);
  enterParkedCar(world);
  const player = world.state.player;
  driveRoute(world, routeTo(player.x, player.z, 160, 160), CHASE_SECONDS);
  faceCityCentre(world);
  // Frame the chase: pull the nearest cruiser up alongside the player's left, same
  // heading and speed, so the wanted level reads in the picture and not just the HUD.
  // It was already chasing; this only puts it where the camera can see it.
  const car = world.state.cars[player.car];
  let nearest = null;
  let nearestD = Infinity;
  for (const cruiser of world.state.cars) {
    if (!cruiser.active || cruiser.kind !== 'police') continue;
    const d = Math.hypot(cruiser.x - player.x, cruiser.z - player.z);
    if (d < nearestD) { nearestD = d; nearest = cruiser; }
  }
  if (nearest && car) {
    nearest.x = player.x - Math.cos(car.heading) * 7;
    nearest.z = player.z + Math.sin(car.heading) * 7;
    nearest.heading = car.heading;
    nearest.speed = car.speed;
  }
  return { screen: SCREEN_PLAY, elapsed: CHASE_SECONDS };
}

function stageHeist(world) {
  world.reset();
  // Night falls: jump the clock to 21:00, then play through to the final mission's safe.
  world.state.elapsed = ((21 - 17.5) / 24) * 480;
  walkTo(world, PLACES.mira.x, PLACES.mira.z);
  walkTo(world, PLACES.pickup.x, PLACES.pickup.z);
  walkTo(world, PLACES.safehouse.x, PLACES.safehouse.z);
  walkTo(world, PLACES.garage.x, PLACES.garage.z);
  // On foot at the warehouse, cracking the safe: hold E, so the marker stays on the job.
  walkTo(world, PLACES.warehouse.x + 4, PLACES.warehouse.z);
  for (let index = 0; index < 1.4 / STEP; index += 1) {
    world.step(STEP, { ...IDLE, interactHeld: true }, 0);
  }
  idleFor(world, HEIST_SECONDS - 1.4);
  return { screen: SCREEN_PLAY, elapsed: HEIST_SECONDS };
}

/**
 * Set `world` to the named scene (start, drive, chase or heist; any other name is start)
 * and return the screen to draw over it and the scene's elapsed time for animation.
 */
export function stageShot(name, world) {
  if (name === 'drive') return stageDrive(world);
  if (name === 'chase') return stageChase(world);
  if (name === 'heist') return stageHeist(world);
  return stageStart(world);
}
