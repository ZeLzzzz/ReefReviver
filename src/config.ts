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
    // REQ-003: kept clear of the ghost nets by this much.
    clearOfNets: 4,
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
  // REQ-003: the cutter (key 1) frees the animals trapped in ghost nets.
  cutter: {
    // The crosshair ray (from the camera along the aim) must hit a net no further than this from the ROV.
    range: 10,
    // D-012: holding the beam on a net this long cuts it.
    seconds: 2,
    // Cut nets shrink and sink away over this time.
    netFadeSeconds: 0.8,
  },
  // REQ-003: two ghost nets in the north half of the bay (D-012), each with one trapped animal (D-027).
  nets: {
    // D-030: score for freeing one animal.
    scorePerAnimal: 100,
    // A net is a dome on the floor. Width, height and length are its half-sizes; the animal is longer than the
    // net, so its head and tail stick out and stay visible, and aiming at them does not cut (AC-5).
    sites: [
      { species: "turtle", x: -9, z: -24, yaw: 0.6 },
      { species: "reefShark", x: 9, z: -33, yaw: -0.8 },
    ],
    species: {
      turtle: {
        netWidth: 1.5,
        netHeight: 1.3,
        netLength: 1.0,
        // Height of the body's centre above the floor.
        restHeight: 0.45,
        // Spheres along the body (metres from the centre along the heading) that stop the cutter ray and that
        // make up the animal: shell, head. The body lies inside the dome, so the net is always hit first.
        body: [
          { along: 0, radius: 0.5 },
          { along: 0.85, radius: 0.22 },
        ],
        // Radius used to keep the swimming animal out of rocks and cliffs.
        radius: 0.7,
        // While trapped it twists and shifts by up to this far inside the net (AC-6).
        struggle: 0.22,
        wanderSpeed: 0.9,
        fleeSpeed: 2.2,
        // Largest turn rate while wandering, radians per second.
        turnRate: 0.5,
      },
      reefShark: {
        netWidth: 1.4,
        netHeight: 1.5,
        netLength: 0.9,
        restHeight: 0.7,
        body: [
          { along: -1.0, radius: 0.22 },
          { along: -0.45, radius: 0.34 },
          { along: 0.15, radius: 0.42 },
          { along: 0.75, radius: 0.34 },
          { along: 1.25, radius: 0.22 },
        ],
        radius: 0.6,
        struggle: 0.2,
        wanderSpeed: 1.6,
        fleeSpeed: 3.2,
        turnRate: 0.7,
      },
    },
    // After the net is cut the animal swims straight away for this long, then wanders for good.
    fleeSeconds: 3,
    wander: {
      // Wandering animals steer back toward the centre beyond this distance from the bay's centre.
      keepInside: 36,
      // Preferred height above the floor, the lowest they go above it, and the highest y they go.
      height: 3.2,
      minAboveFloor: 1.5,
      maxY: -2.5,
      // Turn rate when something solid blocks the way, radians per second.
      blockedTurn: 2.5,
    },
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
  // REQ-004: reef frames, coral fragments and seagrass seeds.
  reef: {
    // D-014: three marked reef sites and two seagrass patches in the east part of the bay (x > 12), clear of the
    // station in the west, the rocks and the trash.
    frameSites: [
      { x: 22, z: 8 },
      { x: 31, z: -12 },
      { x: 25, z: 28 },
    ],
    seagrassPatches: [
      { x: 36, z: 10 },
      { x: 30, z: 20 },
    ],
    // 5 materials buy one frame (D-014).
    frameCost: 5,
    fragmentsPerFrame: 3,
    seedsPerPatch: 3,
    // Pressing E within this distance (on the ground plane) of an empty reef site installs a frame.
    interactRadius: 4,
    // D-030: score when a frame or a patch becomes planted.
    scorePerPlanted: 50,
    // The installed frame is a steel and concrete cage; a shot or the ROV touching this cylinder counts as touching the frame.
    frame: { radius: 1.5, height: 1.75 },
    // A seed that lands on the floor within this distance of a patch's centre is planted.
    patchRadius: 2.5,
    // Markers ignore the fog. The beam rises to this depth below the surface.
    markerTopDepth: 2.2,
  },
  seedLauncher: {
    // A shot flies from the ROV to the point under the crosshair, at this speed, and vanishes after this distance.
    speed: 28,
    range: 25,
    // Seconds between two shots while the button is held.
    interval: 0.4,
    // How far along the camera ray the crosshair target is searched, and the step of that search.
    aimDistance: 45,
    rayStep: 0.25,
    // Shots start this far ahead of the ROV's centre.
    muzzle: 0.9,
    // A moving shot is tested at least this often along its path, so it cannot skip through a frame.
    hitStep: 0.2,
  },
  hud: {
    noticeSeconds: 2.5,
    // How far from the screen edge the station marker stays, in pixels.
    markerMargin: 56,
    // At the bottom the marker stays above the tool panel and the notices.
    markerBottomMargin: 190,
  },
  // REQ-010: the minimap in the HUD (D-031, D-032). Drawn in map units: the bay fits a square `size` wide.
  minimap: {
    // D-031: remaining trash shows as dots only from this cleanliness (percent) on, so exploring still matters early on.
    trashFromCleanliness: 70,
    // The map is `size` x `size` units; north (-Z) is up. It shows the cliff circle plus this many metres around it.
    size: 200,
    margin: 2,
    // Icon sizes in map units (the minimap is about 200 px wide at full size, so one unit is about one pixel).
    icon: { station: 8, site: 8, net: 6.5, trash: 2.6, rov: 12 },
  },
  water: {
    murky: {
      color: 0x55695c,
      fogNear: 2,
      fogFar: 24,
      // REQ-005: the rest of the water's look, which the Bloom blends (lights, particles, surface).
      hemiSky: 0xcfe3d4,
      hemiIntensity: 1.6,
      sunIntensity: 1.2,
      snowOpacity: 0.7,
      surfaceColor: 0xa9c4b2,
    },
    snowCount: 600,
  },
  // REQ-005: the Bloom. The water goes from murky green-grey to clear tropical blue, the coral turns pastel and
  // grows, the seagrass grows tall, and sea life returns (D-015, D-038).
  bloom: {
    // The transition takes this long in game time (AC-1); pausing freezes it.
    seconds: 6,
    clear: {
      color: 0x38b0dc,
      // Thin haze and a long view: the far end of the fog moves out to 90 m.
      fogNear: 10,
      fogFar: 90,
      hemiSky: 0xd6f1ff,
      hemiIntensity: 2.0,
      sunIntensity: 1.6,
      snowOpacity: 0.25,
      surfaceColor: 0xb8e6f6,
    },
    coral: {
      // Fragments grow to this many times their size and blend to a pastel colour (AC-2). Each fragment takes
      // the next colour of this list, so the reef ends up multi-coloured (DESIGN).
      scale: 1.8,
      pastel: [0xff9ec0, 0xffb590, 0xc4aaff, 0x8fe6d9, 0xffe28c, 0xa9d8ff],
      // Emissive glow at the end, as a share of the colour, so the coral stays bright in the shade.
      glow: 0.22,
    },
    seagrass: {
      // Blades stretch to this many times their length, and thicken a little (AC-2).
      heightScale: 3.6,
      widthScale: 1.4,
      color: 0x47c46b,
      // Extra blades that grow out of nothing, so a sprout becomes a tuft.
      extraBlades: 5,
    },
  },
  // REQ-005 AC-3: the sea life that returns once the transition ends. Everything swims along a closed loop, an
  // ellipse around a centre: x/z are metres from the bay's centre, speed is radians per second along the loop.
  seaLife: {
    // New animals grow from nothing to full size over this time (no pop, no flash).
    appearSeconds: 2.5,
    // D-038: one anemone near each reef frame, with clownfish hovering around it.
    anemone: { dx: -2.6, dz: -1.4, height: 0.4 },
    clownfish: { perAnemone: 2, radiusX: 0.6, radiusZ: 0.45, hover: 0.35, bob: 0.08, speed: 1.2, size: 1.5 },
    // The decorative yellowtail school: not scannable (D-038).
    yellowtail: {
      count: 24,
      centre: { x: 6, z: 0 },
      radiusX: 24,
      radiusZ: 16,
      y: -5.5,
      speed: 0.12,
      // Each fish keeps within this of the school's loop: along it (radians), across it, and in height.
      spreadAlong: 0.07,
      spreadAcross: 1.5,
      spreadY: 1.2,
    },
    mantaRays: [
      { x: 4, z: -10, radiusX: 26, radiusZ: 18, y: -6.5, speed: 0.07, phase: 0, direction: 1 },
      { x: 8, z: 6, radiusX: 20, radiusZ: 24, y: -6.0, speed: 0.06, phase: 2.5, direction: -1 },
    ],
    dolphins: {
      count: 3,
      centre: { x: 4, z: -8 },
      radiusX: 28,
      radiusZ: 24,
      y: -2.7,
      bob: 0.5,
      speed: 0.13,
      spreadAlong: 0.09,
      spreadAcross: 1.6,
    },
    // The ROV, rocks and cliffs are never in the way, but the loops stay at least this far inside the bay boundary.
    edgeMargin: 5,
  },
} as const;

export type Config = typeof config;
