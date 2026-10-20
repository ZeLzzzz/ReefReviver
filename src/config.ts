// Every tunable number in the game lives here, so playtest tuning never touches game logic.
// Units: metres, seconds, radians. North is -Z.

export const config = {
  bay: {
    // The ROV's centre never goes further than this from the bay's centre (AC-4).
    boundaryRadius: 45,
    // Cliffs close the bay on every side (D-035); their jagged face never comes closer than boundaryRadius + 2.
    cliffRadius: 50,
    cliffJag: 3,
    cliffTop: 6,
    cliffBottom: -24,
    surfaceY: 0,
    floorDepth: -12,
    // The floor gets deeper toward the south by this much at the boundary.
    southSlope: 3,
    rockCount: 12,
    rockSeed: 7,
  },
  rov: {
    radius: 0.8,
    maxSpeed: 6,
    verticalSpeed: 3,
    // How fast velocity approaches the input; higher feels snappier, lower floatier.
    acceleration: 3,
    mouseSensitivity: 0.0025,
    minPitch: -1.1,
    maxPitch: 0.7,
    start: { x: 0, y: -6, z: 32, yaw: Math.PI },
  },
  camera: {
    fov: 70,
    distance: 6,
    height: 2,
    // Keeps the camera inside the water and off the floor and cliffs.
    surfaceGap: 0.3,
    floorGap: 0.5,
    titleOrbitSpeed: 0.05,
  },
  trash: {
    // D-012: about 40 items of plastic bottles, plastic bags and cans on the floor.
    count: 40,
    seed: 11,
    // Items stay inside this ring around the bay centre, apart from each other and from rocks.
    minRadius: 5,
    maxRadius: 40,
    spacing: 2.5,
    // How far the item's centre sits above the floor.
    restHeight: 0.15,
    // Kept clear of the start position and the station's deposit zone.
    clearOfStart: 6,
  },
  vacuum: {
    // Trash within this distance of the ROV and this angle around the aim direction (crosshair) can be sucked.
    range: 8,
    coneHalfAngle: 0.4,
    // A sucked item flies to the ROV in this time, then disappears into the tank.
    pullDuration: 0.45,
    // Seconds between two items starting to be sucked while the button is held.
    interval: 0.2,
  },
  tank: {
    capacity: 8,
  },
  station: {
    // The recycling station stands on the west side of the bay (D-011), clear of every rock.
    x: -24,
    z: 20,
    // Pressing E inside this circle (and under zoneHeight above the floor) deposits the tank.
    zoneRadius: 5,
    zoneHeight: 8,
    // The floor is levelled inside padRadius and blends back to the natural floor over padBlend.
    padRadius: 6.5,
    padBlend: 4,
    // Solid parts the ROV cannot pass through (D-041): the container body, and the beacon mast beside it.
    body: { radius: 1.6, height: 3.1 },
    mast: { dx: 1.1, dz: -0.5, radius: 0.35, height: 6.9 },
  },
  rewards: {
    scorePerTrash: 10,
    // D-014: 1 deposited trash = 1 material.
    materialPerTrash: 1,
  },
  phase1: {
    // Bloom threshold shown in the objective list (D-013).
    cleanTarget: 80,
    // Nets (and trapped animals) are built in REQ-003; the totals count toward cleanliness already.
    nets: 2,
    animals: 2,
  },
  hud: {
    noticeSeconds: 2.5,
    // How far from the screen edge the station marker stays, in pixels.
    markerMargin: 56,
  },
  water: {
    murky: { color: 0x55695c, fogNear: 2, fogFar: 24 },
    snowCount: 600,
  },
} as const;

export type Config = typeof config;
