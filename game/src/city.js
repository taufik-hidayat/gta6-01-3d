// The city of Teluk Bayu as pure data: which blocks hold which buildings, where the lamps
// and trees stand, and the road loops the traffic follows. Everything is derived from the
// seed, so the same seed builds the same city in the browser and in the headless tests.
// No drawing here and no three.js: the renderer turns this data into meshes.
import { PALETTE, PARKED_CARS, PLACES, WORLD } from './config.js';
import { pick, range } from './random.js';

/** Is (x, z) on a road (within the asphalt, not counting the sidewalk)? */
export function onRoad(x, z) {
  const { roads, roadHalf } = WORLD;
  for (const road of roads) {
    if (Math.abs(x - road) <= roadHalf || Math.abs(z - road) <= roadHalf) return true;
  }
  return false;
}

/** The nearest road coordinate to `value` on one axis. */
export function nearestRoad(value) {
  let best = WORLD.roads[0];
  for (const road of WORLD.roads) {
    if (Math.abs(road - value) < Math.abs(best - value)) best = road;
  }
  return best;
}

/** Clamp a point inside the playable square. */
export function clampToWorld(x, z, margin = 2) {
  const limit = WORLD.half - margin;
  return { x: Math.max(-limit, Math.min(limit, x)), z: Math.max(-limit, Math.min(limit, z)) };
}

/**
 * Push a circle (x, z, radius) out of every building rectangle it overlaps. Returns true
 * when a push happened. Buildings are the only solid obstacles; roads stay open.
 */
export function collideBuildings(city, x, z, radius) {
  let pushed = false;
  for (const building of city.buildings) {
    const nearestX = Math.max(building.x - building.w / 2, Math.min(x, building.x + building.w / 2));
    const nearestZ = Math.max(building.z - building.d / 2, Math.min(z, building.z + building.d / 2));
    const dx = x - nearestX;
    const dz = z - nearestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;
    pushed = true;
    if (distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      x = nearestX + (dx / dist) * radius;
      z = nearestZ + (dz / dist) * radius;
    } else {
      // Dead centre of a building: shove out along the shorter axis.
      const pushX = building.w / 2 + radius - Math.abs(x - building.x);
      const pushZ = building.d / 2 + radius - Math.abs(z - building.z);
      if (pushX < pushZ) x = building.x + (x >= building.x ? 1 : -1) * (building.w / 2 + radius);
      else z = building.z + (z >= building.z ? 1 : -1) * (building.d / 2 + radius);
    }
  }
  return { x, z, pushed };
}

/** Build the city from a seed. Returns buildings, trees, lamps, routes and named places. */
export function buildCity(random) {
  const buildings = [];
  const trees = [];
  const lamps = [];
  const roads = WORLD.roads;

  // Landmark footprints first, so the seeded blocks never swallow them.
  const landmarks = [
    { key: 'safehouse', x: -40, z: -120, w: 30, d: 22, h: 10, color: 0x4a7a4a, sign: 'RUMAH AMAN' },
    { key: 'policeStation', x: 120, z: -120, w: 34, d: 24, h: 16, color: 0x2a4a7a, sign: 'POLISI' },
    { key: 'garage', x: -120, z: 120, w: 30, d: 24, h: 9, color: 0xb0702a, sign: 'BENGKEL DARTO' },
    { key: 'warehouse', x: 120, z: 120, w: 44, d: 30, h: 12, color: 0x7a5a3a, sign: 'GUDANG' },
  ];
  for (const landmark of landmarks) {
    buildings.push({ ...landmark, landmark: landmark.key });
  }

  // Seeded blocks: one to three boxes per block, kept clear of the landmarks.
  for (let i = 0; i < roads.length - 1; i += 1) {
    for (let j = 0; j < roads.length - 1; j += 1) {
      const cx = (roads[i] + roads[i + 1]) / 2;
      const cz = (roads[j] + roads[j + 1]) / 2;
      const count = 2 + Math.floor(random() * 3);
      for (let k = 0; k < count; k += 1) {
        // Try a few spots: a building that would swallow a landmark is moved, not dropped,
        // so the city stays dense.
        let placed = false;
        for (let attempt = 0; attempt < 3 && !placed; attempt += 1) {
          const w = range(random, 16, 30);
          const d = range(random, 16, 30);
          const x = cx + range(random, -14, 14);
          const z = cz + range(random, -14, 14);
          const h = range(random, 8, 42);
          let clear = true;
          for (const landmark of landmarks) {
            if (Math.abs(x - landmark.x) < (w + landmark.w) / 2 + 4 && Math.abs(z - landmark.z) < (d + landmark.d) / 2 + 4) {
              clear = false;
              break;
            }
          }
          if (!clear) continue;
          buildings.push({ x, z, w, d, h, color: pick(random, PALETTE.building), sign: null });
          placed = true;
        }
      }
      // A tree or two on the block's corners.
      if (random() < 0.8) {
        trees.push({ x: cx + range(random, -26, 26), z: cz + range(random, -26, 26), s: range(random, 0.8, 1.4) });
      }
    }
  }

  // Lamps line every avenue, both sides, every 40 units.
  for (const road of roads) {
    for (let t = -180; t <= 180; t += 40) {
      lamps.push({ x: road - 8.6, z: t });
      lamps.push({ x: t, z: road + 8.6 });
    }
  }

  // Traffic loops: rectangles around four spread-out blocks, plus two long avenue runs.
  const routes = [];
  const loopBlocks = [[0, 0], [1, 2], [2, 1], [3, 3]];
  for (const [bi, bj] of loopBlocks) {
    const x0 = roads[bi] + 2.4;
    const x1 = roads[bi + 1] - 2.4;
    const z0 = roads[bj] + 2.4;
    const z1 = roads[bj + 1] - 2.4;
    routes.push([
      { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 },
    ]);
  }
  routes.push([
    { x: -176, z: -80 + 2.4 }, { x: 176, z: -80 + 2.4 }, { x: 176, z: -80 - 2.4 }, { x: -176, z: -80 - 2.4 },
  ]);
  routes.push([
    { x: 80 + 2.4, z: -176 }, { x: 80 + 2.4, z: 176 }, { x: 80 - 2.4, z: 176 }, { x: 80 - 2.4, z: -176 },
  ]);

  return {
    buildings,
    trees,
    lamps,
    routes,
    places: PLACES,
    parkedCars: PARKED_CARS,
  };
}
