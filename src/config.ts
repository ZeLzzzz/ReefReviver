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
  water: {
    murky: { color: 0x55695c, fogNear: 2, fogFar: 24 },
    snowCount: 600,
  },
} as const;

export type Config = typeof config;
