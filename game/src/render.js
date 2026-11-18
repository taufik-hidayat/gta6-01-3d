// Drawing only: the world's state in, pixels out. A three.js scene of Teluk Bayu — roads,
// lit buildings, lamps, trees, cars, pedestrians and the player — with a third-person camera
// that follows the action and a full day-night cycle. Meshes are built once and reused; the
// frame only moves them. The HUD and the menus are DOM, not this file.
import * as THREE from 'three';
import { DAY, PALETTE, PED_COUNT, POLICE, TRAFFIC_COUNT, WORLD } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_WASTED = 'wasted';
export const SCREEN_DONE = 'done';

/** Two canvas textures for buildings: a mid-tone facade with windows drawn on it (the
 * colour map, so a block reads as a solid form even at dusk), and a black canvas carrying
 * only the lit windows (the emissive map, so at night the windows glow but the walls do
 * not). One shared texture for both jobs would either black out the walls or make the
 * whole building glow. */
function facadeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#7d828c';
  ctx.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 12; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const lit = Math.random() < 0.45;
      ctx.fillStyle = lit ? '#ffd27a' : '#232833';
      ctx.fillRect(8 + col * 20, 10 + row * 20, 13, 13);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function litWindowsTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 12; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      if (Math.random() >= 0.45) continue;
      ctx.fillStyle = '#ffd27a';
      ctx.fillRect(8 + col * 20, 10 + row * 20, 13, 13);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeCar(color, isPolice) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x10151c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 4.4), bodyMat);
  body.position.y = 0.55;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 2.2), glassMat);
  cabin.position.set(0, 1.15, -0.2);
  group.add(cabin);
  if (isPolice) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.28, 4.42), new THREE.MeshLambertMaterial({ color: PALETTE.policeTrim }));
    trim.position.y = 0.62;
    group.add(trim);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0a0a0a });
  for (const [wx, wz] of [[-1.05, 1.4], [1.05, 1.4], [-1.05, -1.4], [1.05, -1.4]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.38, wz);
    group.add(wheel);
  }
  // A dark disc under the car: a cheap contact shadow, no shadow maps needed.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.scale.set(1, 1.9, 1);
  group.add(shadow);
  return group;
}

function makePerson(shirtColor) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x23283a });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.36), shirt);
  torso.position.y = 1.05;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skin);
  head.position.y = 1.62;
  group.add(head);
  const legGeo = new THREE.BoxGeometry(0.24, 0.65, 0.26);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.16, 0.33, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.16, 0.33, 0);
  group.add(legR);
  const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.18);
  const armL = new THREE.Mesh(armGeo, shirt);
  armL.position.set(-0.42, 1.05, 0);
  group.add(armL);
  const armR = new THREE.Mesh(armGeo, shirt);
  armR.position.set(0.42, 1.05, 0);
  group.add(armR);
  return group;
}

export function createRenderer(canvas, city) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyDusk);
  scene.fog = new THREE.Fog(PALETTE.skyDusk, 130, 400);

  const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x3a3128, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.0);
  scene.add(sun);
  scene.add(sun.target);

  // Ground and roads.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.ground, WORLD.ground),
    new THREE.MeshLambertMaterial({ color: PALETTE.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const roadMat = new THREE.MeshLambertMaterial({ color: PALETTE.road });
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
  const lineMat = new THREE.MeshLambertMaterial({ color: PALETTE.roadLine });
  for (const road of WORLD.roads) {
    const stripX = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.ground, WORLD.roadHalf * 2), roadMat);
    stripX.rotation.x = -Math.PI / 2;
    stripX.position.set(0, 0.02, road);
    scene.add(stripX);
    const stripZ = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.roadHalf * 2, WORLD.ground), roadMat);
    stripZ.rotation.x = -Math.PI / 2;
    stripZ.position.set(road, 0.02, 0);
    scene.add(stripZ);
    const walkX = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.ground, 3.4), sidewalkMat);
    walkX.rotation.x = -Math.PI / 2;
    walkX.position.set(0, 0.03, road + WORLD.roadHalf + 1.7);
    scene.add(walkX);
    const walkZ = new THREE.Mesh(new THREE.PlaneGeometry(3.4, WORLD.ground), sidewalkMat);
    walkZ.rotation.x = -Math.PI / 2;
    walkZ.position.set(road + WORLD.roadHalf + 1.7, 0.03, 0);
    scene.add(walkZ);
    for (let t = -190; t <= 190; t += 12) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 5), lineMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(t, 0.04, road);
      scene.add(dash);
      const dashZ = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.5), lineMat);
      dashZ.rotation.x = -Math.PI / 2;
      dashZ.position.set(road, 0.04, t);
      scene.add(dashZ);
    }
  }

  // Buildings, each tinted by its colour, sharing one facade texture and one lit-window texture.
  const facade = facadeTexture();
  const litWindows = litWindowsTexture();
  const buildingMats = new Map();
  function buildingMaterial(color) {
    if (!buildingMats.has(color)) {
      buildingMats.set(color, new THREE.MeshLambertMaterial({
        color, map: facade, emissive: 0xffc46a, emissiveMap: litWindows, emissiveIntensity: 0,
      }));
    }
    return buildingMats.get(color);
  }
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const building of city.buildings) {
    const mesh = new THREE.Mesh(buildingGeo, buildingMaterial(building.color));
    mesh.scale.set(building.w, building.h, building.d);
    mesh.position.set(building.x, building.h / 2, building.z);
    scene.add(mesh);
    if (building.sign) {
      const signCanvas = document.createElement('canvas');
      signCanvas.width = 512;
      signCanvas.height = 96;
      const ctx = signCanvas.getContext('2d');
      ctx.fillStyle = '#101418';
      ctx.fillRect(0, 0, 512, 96);
      ctx.fillStyle = '#ffd27a';
      ctx.font = 'bold 56px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(building.sign, 256, 50);
      const signTexture = new THREE.CanvasTexture(signCanvas);
      signTexture.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(building.w * 0.9, 26), 4.5),
        new THREE.MeshBasicMaterial({ map: signTexture }),
      );
      sign.position.set(building.x, building.h + 2.4, building.z);
      // Face the nearest road.
      sign.lookAt(building.x + (building.x >= 0 ? 100 : -100), building.h + 2.4, building.z);
      scene.add(sign);
    }
  }

  // Trees and lamps.
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1.6, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: PALETTE.trunk });
  const topGeo = new THREE.ConeGeometry(1.6, 3.4, 8);
  const topMat = new THREE.MeshLambertMaterial({ color: PALETTE.tree });
  for (const tree of city.trees) {
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(tree.x, 0.8, tree.z);
    trunk.scale.setScalar(tree.s);
    scene.add(trunk);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.set(tree.x, 2.6 * tree.s, tree.z);
    top.scale.setScalar(tree.s);
    scene.add(top);
  }
  const lampPoleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.2, 6);
  const lampPoleMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
  const lampHeadGeo = new THREE.SphereGeometry(0.32, 8, 6);
  const lampHeadMat = new THREE.MeshLambertMaterial({ color: PALETTE.lamp, emissive: PALETTE.lamp, emissiveIntensity: 0 });
  const lampHeads = [];
  for (const lamp of city.lamps) {
    const pole = new THREE.Mesh(lampPoleGeo, lampPoleMat);
    pole.position.set(lamp.x, 2.6, lamp.z);
    scene.add(pole);
    const head = new THREE.Mesh(lampHeadGeo, lampHeadMat);
    head.position.set(lamp.x, 5.3, lamp.z);
    scene.add(head);
    lampHeads.push(head);
  }

  // Cars: one pooled group per car, hidden when the car is inactive.
  const carGroups = [];
  for (let index = 0; index < TRAFFIC_COUNT + 8; index += 1) {
    const group = makeCar(0x888888, false);
    group.visible = false;
    scene.add(group);
    carGroups.push(group);
  }
  const policeGroups = [];
  const policeLightBars = [];
  for (let index = 0; index < POLICE.maxCruisers + 2; index += 1) {
    const group = makeCar(PALETTE.policeBody, true);
    const barMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.5), barMat);
    bar.position.set(0, 1.55, -0.2);
    group.add(bar);
    group.visible = false;
    scene.add(group);
    policeGroups.push(group);
    policeLightBars.push(barMat);
  }

  // People: the player plus a pool of pedestrians.
  const playerGroup = makePerson(PALETTE.playerShirt);
  scene.add(playerGroup);
  const pedGroups = [];
  for (let index = 0; index < PED_COUNT; index += 1) {
    const group = makePerson(0x888888);
    group.visible = false;
    scene.add(group);
    pedGroups.push(group);
  }

  // The mission marker: a floating golden diamond over a beam of light.
  const marker = new THREE.Group();
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1),
    new THREE.MeshBasicMaterial({ color: 0xffd23a }),
  );
  diamond.position.y = 5;
  marker.add(diamond);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 30, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = 15;
  marker.add(beam);
  marker.visible = false;
  scene.add(marker);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
  const camState = { yaw: Math.PI / 2, orbit: 0, pitch: 0, titleAngle: 0 };
  const skyDay = new THREE.Color(PALETTE.skyDay);
  const skyDusk = new THREE.Color(PALETTE.skyDusk);
  const skyNight = new THREE.Color(PALETTE.skyNight);
  const skyColor = new THREE.Color();

  function resize(width, height) {
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }

  function updateDayNight(clockHours) {
    // Sun height: 6:00 rises, 12:00 noon, 18:00 sets.
    const sunAngle = ((clockHours - 6) / 12) * Math.PI;
    const sunHeight = Math.sin(sunAngle);
    const dayFactor = Math.max(0, Math.min(1, (sunHeight + 0.15) / 0.5));
    const duskFactor = Math.max(0, 1 - Math.abs(sunHeight) * 4);
    if (sunHeight > 0.12) skyColor.copy(skyDay).lerp(skyDusk, duskFactor);
    else if (sunHeight > -0.12) skyColor.copy(skyDusk);
    else skyColor.copy(skyNight).lerp(skyDusk, Math.max(0, 1 + sunHeight * 4));
    scene.background.copy(skyColor);
    scene.fog.color.copy(skyColor);
    // The night floor stays high enough to read by: a city at night is dark blue, not
    // black — the ground, roads and car shapes must still be visible at 21:00.
    hemi.intensity = 0.55 + dayFactor * 0.45;
    sun.intensity = 0.35 + dayFactor * 0.85;
    sun.color.setHSL(0.09, 0.7, 0.55 + dayFactor * 0.15);
    sun.position.set(Math.cos(sunAngle) * 120, Math.max(12, sunHeight * 140), 60);
    sun.target.position.set(0, 0, 0);
    const nightFactor = 1 - dayFactor;
    for (const material of buildingMats.values()) material.emissiveIntensity = nightFactor * 0.85;
    lampHeadMat.emissiveIntensity = nightFactor * 1.6;
    return nightFactor;
  }

  function draw(state, screen, elapsed, missionTarget) {
    const player = state.player;
    const nightFactor = updateDayNight(state.clockHours);

    // Hide every pooled car first: police and traffic share the same state pool, so a slot
    // that changes kind must not leave its old mesh standing.
    for (const group of carGroups) group.visible = false;
    for (const group of policeGroups) group.visible = false;

    // Cars.
    let policeIndex = 0;
    for (let index = 0; index < state.cars.length; index += 1) {
      const car = state.cars[index];
      if (!car.active) continue;
      if (car.kind === 'police') {
        const group = policeGroups[policeIndex % policeGroups.length];
        policeIndex += 1;
        group.visible = true;
        group.position.set(car.x, 0, car.z);
        group.rotation.y = car.heading;
        group.rotation.z = -car.slide * 0.12;
        policeLightBars[(policeIndex - 1) % policeLightBars.length].color.setHex(
          Math.floor(elapsed * 2.4) % 2 === 0 ? 0xff2222 : 0x2266ff,
        );
        continue;
      }
      const group = carGroups[index % carGroups.length];
      group.visible = true;
      // Repaint the body when the car's colour changed (stolen cars keep theirs).
      const body = group.children[0];
      if (body.material.color.getHex() !== car.color) body.material = new THREE.MeshLambertMaterial({ color: car.color });
      group.position.set(car.x, 0, car.z);
      group.rotation.y = car.heading;
      group.rotation.z = -car.slide * 0.12;
      if (index === player.car) {
        group.position.y = Math.sin(elapsed * 30) * 0.015 * Math.min(1, Math.abs(car.speed) / 20);
      }
    }

    // Pedestrians.
    for (let index = 0; index < state.peds.length; index += 1) {
      const ped = state.peds[index];
      const group = pedGroups[index];
      group.visible = ped.active;
      if (!ped.active) continue;
      const shirt = group.children[0];
      if (shirt.material.color.getHex() !== ped.color) shirt.material = new THREE.MeshLambertMaterial({ color: ped.color });
      group.position.set(ped.x, ped.state === 'down' ? 0.15 : 0, ped.z);
      group.rotation.y = ped.heading;
      group.rotation.x = ped.state === 'down' ? -Math.PI / 2 : 0;
      const bob = ped.state === 'walk' ? Math.sin(elapsed * 9 + index) * 0.06 : 0;
      group.position.y = ped.state === 'down' ? 0.15 : bob;
    }

    // The player on foot, with a walk bob and a lean into the run.
    playerGroup.visible = player.onFoot;
    if (player.onFoot) {
      playerGroup.position.set(player.x, player.speed > 0.5 ? Math.abs(Math.sin(elapsed * 11)) * 0.08 : 0, player.z);
      playerGroup.rotation.y = player.heading;
      playerGroup.rotation.x = player.speed > 8 ? 0.12 : 0;
    }

    // Mission marker.
    if (missionTarget) {
      marker.visible = true;
      marker.position.set(missionTarget.x, 0, missionTarget.z);
      diamond.position.y = 5 + Math.sin(elapsed * 2.5) * 0.7;
      diamond.rotation.y = elapsed * 1.5;
    } else {
      marker.visible = false;
    }

    // Camera.
    if (screen === SCREEN_TITLE) {
      camState.titleAngle += 0.0004;
      const radius = 150;
      camera.position.set(Math.sin(camState.titleAngle) * radius, 62, Math.cos(camState.titleAngle) * radius);
      camera.lookAt(0, 8, 0);
    } else {
      const targetYaw = player.heading + camState.orbit;
      let diff = targetYaw - camState.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      camState.yaw += diff * 0.06;
      const dist = player.onFoot ? 7 : 13;
      const height = player.onFoot ? 3.2 : 5.5;
      const backX = Math.sin(camState.yaw);
      const backZ = Math.cos(camState.yaw);
      camera.position.set(
        player.x - backX * dist,
        height + camState.pitch * 8,
        player.z - backZ * dist,
      );
      camera.lookAt(player.x + backX * 4, 1.6, player.z + backZ * 4);
    }

    renderer.render(scene, camera);
    void nightFactor;
  }

  return {
    draw,
    resize,
    addOrbit(delta) {
      camState.orbit += delta;
    },
    setPitch(value) {
      camState.pitch = value;
    },
    /** Point the camera at a heading at once (screenshot staging), instead of waiting
     * for the follow-cam lerp to catch up over frames that never happen in shot mode. */
    snapYaw(yaw) {
      camState.yaw = yaw;
    },
    /** The direction the camera looks along the ground, for movement and shooting. */
    cameraYaw() {
      return camState.yaw;
    },
  };
}
