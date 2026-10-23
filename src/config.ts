// Every tunable number in the game lives here, so playtest tuning never touches game logic.
// Units: metres, seconds, radians. North is -Z.

export const config = {
  // REQ-011: a bay about 300 m wide (D-061). Rock walls close it on the north, east and south (D-062), the west is
  // a shore where the floor rises to the surface and the land goes on above it (D-071).
  bay: {
    surfaceY: 0,
    // The terrain mesh covers this many metres each way from the bay's centre; nothing is ever further out.
    halfSize: 165,
    // The rolling floor between the hills and valleys.
    baseDepth: -16,
    // Hill tops flatten out toward this depth and never rise above it (D-071: about 8 m down).
    hillCap: -8,
    // Round hills and valleys: height or depth at the centre, falling smoothly to nothing at `radius`.
    hills: [
      { x: -62, z: -72, radius: 26, height: 8 },
      { x: -18, z: 42, radius: 22, height: 7 },
      { x: 28, z: -24, radius: 28, height: 8 },
      // The hill the cave will go through (REQ-014).
      { x: 98, z: -88, radius: 26, height: 9 },
      { x: 82, z: 62, radius: 28, height: 7 },
      { x: -58, z: 98, radius: 20, height: 6 },
      { x: 112, z: 8, radius: 18, height: 6 },
      { x: -12, z: -112, radius: 20, height: 6 },
      { x: -70, z: -10, radius: 14, height: 5 },
    ],
    valleys: [
      { x: -28, z: -22, radius: 24, depth: 8 },
      { x: 58, z: 18, radius: 22, depth: 7 },
      { x: 28, z: 102, radius: 30, depth: 8 },
      { x: 42, z: -100, radius: 22, depth: 7 },
      { x: -40, z: 70, radius: 16, depth: 5 },
      { x: 110, z: -40, radius: 16, depth: 6 },
    ],
    // The west shore: the waterline wanders around `waterlineX`; the floor rises to it over `shelfWidth` from
    // `shelfDepth`, and blends into the rolling floor over `blendWidth` further out. Inland the land rises by
    // `landRise` per metre up to `landHeight`. Between z = -openHalf and openHalf no rock wall closes the shore.
    shore: { waterlineX: -132, wiggle: 5, shelfWidth: 30, shelfDepth: -10, blendWidth: 20, landRise: 0.35, landHeight: 5, openHalf: 100 },
    // The rock wall on a rounded square (a superellipse of this exponent) about `radius` from the centre: it rises
    // from the floor to `top` over `width` metres, with a face that juts in and out by up to `jag`.
    wall: { radius: 147, width: 13, top: 8, jag: 5, shape: 4 },
    // The wooden dock (REQ-016): from landX on the beach out to seaX, halfWidth either side of z, its deck deckY above
    // the surface. Nothing else is placed within `clear` of (x, z).
    dock: { x: -124, z: 8, clear: 8, landX: -130, seaX: -116, halfWidth: 1.3, deckY: 0.9 },
    // Things that stand on the floor (station, reef sites, nets) get a level pad of this radius, blended back
    // to the natural floor over `padBlend`.
    padRadius: 4,
    padBlend: 3,
    // Small rocks scattered over the floor.
    rockCount: 55,
    rockSeed: 7,
    // Big flat-topped rocks in two tiers: the lower one `radius` wide and 60% of `height` tall, the upper one
    // narrower on top of it.
    boulders: [
      { x: -45, z: -50, radius: 7, height: 5 },
      { x: 5, z: 30, radius: 6, height: 4 },
      { x: 45, z: 5, radius: 8, height: 6 },
      { x: 88, z: 35, radius: 6, height: 5 },
      { x: -20, z: -85, radius: 7, height: 5 },
      { x: 60, z: 95, radius: 7, height: 5 },
      { x: 112, z: 72, radius: 6, height: 4 },
      { x: -82, z: 62, radius: 6, height: 4 },
      { x: 35, z: -68, radius: 6, height: 5 },
      { x: 95, z: -20, radius: 7, height: 5 },
    ],
    // Rock arches: half a ring standing on the floor, `radius` to the middle of its rock, `tube` thick, turned so
    // the opening faces along (sin yaw, cos yaw). The ROV passes under them (REQ-011 AC-3).
    arches: [
      { x: 10, z: -55, yaw: 0.4, radius: 6, tube: 1.5 },
      { x: -50, z: 50, yaw: -0.9, radius: 5, tube: 1.3 },
    ],
    // Kept free of rocks and trash for the cave (REQ-014).
    cave: { x: 98, z: -88, clear: 30 },
  },
  // REQ-015: going ashore on the west shore and walking about on the land (D-079, D-080, D-081, D-084). The player's
  // vehicle is a crewed mini submarine (D-070); in the code it is still called the ROV.
  land: {
    // "Tekan E untuk naik ke darat" shows within this many metres of the waterline, on the open beach only.
    ashoreRange: 10,
    // The submarine is left floating alongside the beach where the water is this deep; the player stands this far
    // inland from the waterline (further if that spot is not walkable).
    parkDepth: 2.3,
    landingInland: 3,
    // Walking: speed, eye height, how deep the player can wade, the steepest rise per metre they can climb, and the
    // body's radius against trees and rocks.
    walkSpeed: 4,
    eyeHeight: 1.6,
    wadeDepth: 0.5,
    maxSlope: 0.9,
    radius: 0.35,
    minPitch: -1.3,
    maxPitch: 1.2,
    // "Tekan E untuk masuk kapal selam" shows within this distance of the submarine, on the ground plane.
    boardRange: 3.5,
    // The screen fades out and in over this time when the player gets in or out.
    fadeSeconds: 0.4,
    // How high the parked submarine floats: its centre this far under the surface.
    floatDepth: 0.3,
    // The land ends in a cliff at the west, rising from cliffX over cliffWidth by cliffHeight.
    cliffX: -150,
    cliffWidth: 8,
    cliffHeight: 12,
    // The submarine parks at least this far to the side of the dock, never under it (REQ-016).
    dockGap: 2.5,
    // Coconut palms (height in metres, lean toward the sea in radians) and rocks on the land (D-081).
    palms: [
      { x: -141, z: -72, height: 7, lean: 0.2 },
      { x: -144, z: -50, height: 8, lean: 0.12 },
      { x: -139, z: -33, height: 6.5, lean: 0.25 },
      { x: -146, z: -18, height: 7.5, lean: 0.1 },
      { x: -143, z: 38, height: 7, lean: 0.18 },
      { x: -140, z: 55, height: 6, lean: 0.28 },
      { x: -146, z: 70, height: 8, lean: 0.1 },
    ],
    rocks: [
      { x: -140, z: -60, radius: 1.2 },
      { x: -147, z: -38, radius: 1.6 },
      { x: -142, z: 46, radius: 1 },
      { x: -145, z: 62, radius: 1.4 },
    ],
    // Above the water: the sky, the light haze over the bay, and the sea seen from above.
    sky: 0x9fd6f2,
    hazeNear: 80,
    hazeFar: 420,
    seaOpacity: 0.88,
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
    // Near the station on the west shore, facing east into the bay (D-071).
    start: { x: -96, y: -5, z: 8, yaw: Math.PI / 2 },
  },
  camera: {
    fov: 70,
    distance: 6,
    height: 2,
    // Keeps the camera inside the water and off the floor.
    surfaceGap: 0.3,
    floorGap: 0.5,
    // REQ-011 AC-4: the camera stops this far short of a slope, rock or wall between it and the ROV, found by
    // stepping along that line by `step`.
    clearance: 0.4,
    step: 0.25,
    // Far enough to see the fog-free markers across the whole bay.
    far: 450,
    titleOrbitSpeed: 0.05,
  },
  trash: {
    // D-066: about 60 items of plastic bottles, plastic bags and cans, lying in small groups.
    count: 60,
    seed: 11,
    // Groups of `groupSize` items (the last may be smaller) within `groupRadius` of the group's centre; group
    // centres stay `groupSpacing` apart. Items keep `spacing` from each other.
    groupSize: 5,
    groupRadius: 4,
    groupSpacing: 16,
    spacing: 1.5,
    // How far the item's centre sits above the floor.
    restHeight: 0.15,
    // Items lie in water at least `minDepth` deep, on floor that rises no more than `maxSlope` per metre.
    minDepth: 4,
    maxSlope: 0.6,
    // Kept clear of the start position and the station's deposit zone.
    clearOfStart: 8,
    // REQ-003: kept clear of the ghost nets by this much, and of the reef sites and seagrass patches.
    clearOfNets: 4,
    clearOfSites: 5,
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
    // D-072: the station is on the shore, so trips are longer than in the small bay.
    capacity: 12,
  },
  // REQ-016: the recycling shed on the land, near the dock (D-078, D-081); there is no station under water any more.
  // x/z is the shed's centre. On foot, E inside the counter's zone deposits the tank (REQ-002 AC-3).
  station: {
    x: -145,
    z: 8,
    // Walls: half-sizes along x and z, and height. The player cannot walk through them.
    halfX: 2.5,
    halfZ: 3.4,
    height: 3.2,
    // The counter is in the east wall, facing the sea; its zone is a circle on the ground in front of it.
    zoneRadius: 2.2,
    zoneDx: 4.3,
    // The ground is levelled inside padRadius and blends back to the natural ground over padBlend.
    padRadius: 6.5,
    padBlend: 4,
    // The beacon mast on the roof, seen from the sea; the HUD marker points at its lantern.
    mast: { dx: -1.4, dz: -2.3, height: 7.5 },
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
  // REQ-003: two ghost nets (D-012), each with one trapped animal (D-027), out in the bay (REQ-011).
  nets: {
    // D-030: score for freeing one animal.
    scorePerAnimal: 100,
    // A net is a dome on the floor. Width, height and length are its half-sizes; the animal is longer than the
    // net, so its head and tail stick out and stay visible, and aiming at them does not cut (AC-5).
    // Net 0 traps the turtle and net 1 the reef shark; REQ-012 puts them on two of these spots each dive.
    kinds: ["turtle", "reefShark"],
    spots: [
      { x: -40, z: 30, yaw: 0.6 },
      { x: 60, z: -50, yaw: -0.8 },
      { x: -75, z: -50, yaw: 1.4 },
      { x: 15, z: 40, yaw: -0.3 },
      { x: 95, z: 10, yaw: 2.2 },
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
        // Radius used to keep the swimming animal out of rocks, slopes and the rock wall.
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
      keepInside: 105,
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
    // D-014: three marked reef sites and two seagrass patches in every dive.
    frames: 3,
    patches: 2,
    // REQ-012: each dive picks them from these spots (D-063, D-074), spread over the bay, clear of the shore, the rocks
    // and the trash; every spot has a level pad. The seagrass spots lie on the sand of the valleys.
    frameSpots: [
      { x: -5, z: 5 },
      { x: 70, z: -10 },
      { x: 25, z: 70 },
      { x: -70, z: 25 },
      { x: -30, z: -75 },
      { x: 60, z: -75 },
      { x: 100, z: 40 },
      { x: -25, z: 100 },
    ],
    patchSpots: [
      { x: -30, z: -25 },
      { x: 30, z: 100 },
      { x: 55, z: 20 },
      { x: -40, z: 70 },
      { x: 40, z: -100 },
    ],
    // AC-5: the spots picked for one dive cover at least this many quarters of the bay (out of 4).
    spreadQuarters: 3,
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
  // REQ-006: the Scanner (key 4) opens Logbook entries once the Bloom is over (D-016).
  scanner: {
    // The crosshair ray (from the camera along the aim) must hit a target no further than this from the ROV.
    range: 14,
    // D-016: holding the aim on a target this long scans it.
    seconds: 1.5,
    // The ray is tested against a sphere this big (metres) around each target, a little more than the thing itself,
    // so a swimming animal is fair to follow with the crosshair.
    radius: { turtle: 0.9, reefShark: 1.2, clownfish: 0.6, mantaRay: 1.8, dolphin: 1.5, coral: 1.9, seagrass: 2.2 },
    // The sphere of a planted frame or seagrass patch is centred this far above the floor.
    coralHeight: 1,
    seagrassHeight: 0.9,
  },
  // REQ-008: the end screen shows this many game seconds after the 7th entry, once its notice (2.5 s) has been read.
  end: {
    delay: 3,
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
    // The map is `size` x `size` units; north (-Z) is up. It shows `extent` metres each way from the bay's centre.
    size: 200,
    extent: 150,
    // REQ-011 AC-6: hills and valleys are shaded in `cells` x `cells` squares by the depth of the floor; floor
    // above the surface is land (west) or rock wall.
    cells: 80,
    depthBands: [-11, -15, -19],
    // Icon sizes in map units (the minimap is about 200 px wide at full size, so one unit is about one pixel).
    icon: { station: 8, site: 8, net: 6.5, trash: 2.6, rov: 12, sub: 7 },
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
      centre: { x: 0, z: 0 },
      radiusX: 70,
      radiusZ: 55,
      y: -5,
      speed: 0.042,
      // Each fish keeps within this of the school's loop: along it (radians), across it, and in height.
      spreadAlong: 0.025,
      spreadAcross: 1.5,
      spreadY: 1.2,
    },
    // REQ-011 AC-7: the loops cross the whole bay, high enough to clear the hill tops, rocks and arches.
    mantaRays: [
      { x: 10, z: -20, radiusX: 75, radiusZ: 60, y: -5.65, speed: 0.024, phase: 0, direction: 1 },
      { x: 20, z: 15, radiusX: 65, radiusZ: 80, y: -5.7, speed: 0.022, phase: 2.5, direction: -1 },
    ],
    dolphins: {
      count: 3,
      centre: { x: 10, z: -10 },
      radiusX: 90,
      radiusZ: 80,
      y: -2.7,
      bob: 0.5,
      speed: 0.04,
      spreadAlong: 0.028,
      spreadAcross: 1.6,
    },
  },
} as const;

export type Config = typeof config;
