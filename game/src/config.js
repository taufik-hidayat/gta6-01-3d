// Every tuning number, colour and fixed place in one file. Teluk Bayu is a grid city:
// five avenues run each way, roads at -160, -80, 0, 80 and 160, blocks of 66 between them,
// and the whole playable square runs from -200 to 200. Nothing here touches the DOM or
// three.js, so the simulation can run headless in Node with these same numbers.
export const STEP = 1 / 60;

export const WORLD = {
  half: 200,
  ground: 440,
  roadHalf: 7,
  roads: [-160, -80, 0, 80, 160],
  block: 66,
};

export const DAY = {
  /** Clock starts at midday, so the first frames are bright daylight. */
  startHour: 12.0,
  /** Seconds for one full day-night cycle. */
  cycleSeconds: 960,
};

export const PLAYER = {
  radius: 0.6,
  walkSpeed: 6,
  runSpeed: 10.5,
  health: 100,
  punchRange: 2.4,
  punchDamage: 25,
  punchCooldown: 0.45,
  shootRange: 55,
  shootDamage: 34,
  shootCooldown: 0.28,
  ammoStart: 12,
  ammoMax: 36,
  /** Seconds a nearby cop needs the player slow before the bust lands. */
  bustSeconds: 1.4,
};

export const CAR = {
  radius: 2.3,
  accel: 15,
  brake: 30,
  maxSpeed: 38,
  maxReverse: 11,
  steerRate: 2.8,
  /** Steering bites less at speed, so fast corners feel like drifting, not turning on rails. */
  steerAtSpeed: 0.65,
  handbrakeGrip: 0.35,
  drag: 0.35,
};

export const TRAFFIC_COUNT = 14;
export const TRAFFIC = {
  speedMin: 9,
  speedMax: 13.5,
  followGap: 7,
  radius: 2.3,
};

export const PED_COUNT = 20;
export const PED = {
  walkMin: 1.2,
  walkMax: 2.1,
  fleeSpeed: 4.5,
  radius: 0.55,
};

export const POLICE = {
  maxCruisers: 5,
  chaseSpeed: 40,
  ramDamage: 8,
  ramCooldown: 1,
  /** Wanted stars at which cruisers start blocking roads ahead of the player. */
  roadblockStars: 3,
  spawnDistance: 90,
};

export const WANTED = {
  max: 5,
  stealCar: 1,
  hitPed: 2,
  shoot: 1,
  punchCop: 2,
  /** Seconds with no crime and no cruiser close before a star starts fading. */
  calmSeconds: 20,
  decaySeconds: 12,
};

/** Fixed places the story and the HUD point at. All of them sit on roads, so a car can reach them. */
export const PLACES = {
  mira: { x: 5, z: 5, label: "Mira" },
  safehouse: { x: -40, z: -154, label: "Rumah Aman" },
  policeStation: { x: 154, z: -120, label: "Kantor Polisi" },
  garage: { x: -154, z: 120, label: "Bengkel Darto" },
  warehouse: { x: 86, z: 120, label: "Gudang Pelabuhan" },
  pickup: { x: 150, z: -80, label: "Titik Jemput" },
};

/** Parked cars the player can steal without a chase (unless a cruiser is watching). */
export const PARKED_CARS = [
  { x: 16, z: -3.6, heading: 0, color: 0xd94f3d },
  { x: -16, z: 3.6, heading: Math.PI, color: 0x3d7dd9 },
  { x: 3.6, z: -16, heading: -Math.PI / 2, color: 0xe8c33a },
  { x: -150, z: 116.4, heading: Math.PI / 2, color: 0x7a4fd0 },
];

/** The three chained story missions. Pay adds up to $2,875, the same purse as the 2D game. */
export const MISSIONS = [
  {
    id: 'm1',
    title: 'Paket Kilat',
    giver: 'Mira',
    intro: 'Mira: "Raka, ada paket buat pelanggan di pelabuhan utara. Ambil di titik jemput, antar ke Rumah Aman. Jangan sampai ketahuan."',
    steps: [
      { kind: 'goto', place: 'pickup', text: 'Ambil paket di Titik Jemput' },
      { kind: 'goto', place: 'safehouse', text: 'Antar paket ke Rumah Aman' },
    ],
    pay: 500,
    outro: 'Paket sampai. Mira tersenyum: "Lancar. Ada kerjaan lebih besar nanti."',
  },
  {
    id: 'm2',
    title: 'Razia Besar',
    giver: 'Bang Darto',
    intro: 'Bang Darto: "Polisi lagi razia se-kota! Bintang tiga nempel di kamu. Kabur ke bengkelku — aku yang urus sisanya."',
    steps: [
      { kind: 'escape', place: 'garage', text: 'Kabur ke Bengkel Darto selagi diburu polisi' },
    ],
    pay: 800,
    wanted: 3,
    outro: 'Darto menepuk kap mobil: "Beres. Mereka nyari orang lain sekarang."',
  },
  {
    id: 'm3',
    title: 'Brankas Pelabuhan',
    giver: 'Mira',
    intro: 'Mira: "Terakhir, yang paling besar. Brankas di Gudang Pelabuhan. Ambil isinya, bawa ke Rumah Aman. Hati-hati — gudang dijaga."',
    steps: [
      { kind: 'grab', place: 'warehouse', text: 'Ambil isi brankas di Gudang Pelabuhan (tahan E)' },
      { kind: 'goto', place: 'safehouse', text: 'Bawa hasil ke Rumah Aman' },
    ],
    pay: 1575,
    wanted: 2,
    outro: 'Brankas kosong, kantong penuh. Teluk Bayu akhirnya punya raja baru.',
  },
];

export const STORY_TOTAL = MISSIONS.reduce((sum, mission) => sum + mission.pay, 0);

/** The warehouse safe: how long E must be held, and how close the player must stand. */
export const GRAB_SECONDS = 1.5;
export const GRAB_RADIUS = 8;

export const SAVE_KEY = 'teluk-bayu-3d.save.v1';

export const PALETTE = {
  skyDay: 0x87b5d9,
  skyDusk: 0xff9a5c,
  skyNight: 0x0b1026,
  ground: 0x3d3831,
  road: 0x35353a,
  roadLine: 0xd8c95a,
  sidewalk: 0x4a4640,
  building: [0x8a7f72, 0x6e7d8a, 0x9c8a6a, 0x7a6a80, 0x5f7285, 0xa08a7a],
  windowLit: 0xffd27a,
  windowDark: 0x1c2733,
  lamp: 0xffe6a8,
  tree: 0x2f6b3a,
  trunk: 0x5a4632,
  player: 0xe8b13a,
  playerShirt: 0x2f6fb2,
  pedShirt: [0xc65a4a, 0x4a9c6b, 0x8a6fc0, 0xd0a03a, 0x5a8a9c],
  policeBody: 0xe8e8e8,
  policeTrim: 0x1a2a44,
  taxiYellow: 0xe8c33a,
};
