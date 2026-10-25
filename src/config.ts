// Every tunable number in the game lives here, so playtest tuning never touches game logic.
// Units: metres, seconds, radians. North is -Z.

export const config = {
  // REQ-011: a bay about 300 m wide (D-061). The west is a shore where the floor rises to the surface and the land goes
  // on above it (D-071); on the north, east and south it is open sea (REQ-022, D-104), bounded by an invisible edge.
  bay: {
    surfaceY: 0,
    // The detailed terrain mesh covers this many metres each way from the bay's centre; the coarse mesh around it goes on
    // to `outerSize` (REQ-022), well beyond what the water's fog lets the player see from the dive area.
    halfSize: 165,
    outerSize: 407,
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
    // `landRise` per metre up to `landHeight`. Between z = -openHalf and openHalf the beach is open; both its ends are
    // closed by a rock headland (REQ-022, D-105).
    shore: { waterlineX: -132, wiggle: 5, shelfWidth: 30, shelfDepth: -10, blendWidth: 20, landRise: 0.35, landHeight: 5, openHalf: 100 },
    // REQ-022 (D-104, D-108): the dive area is a rounded square (a superellipse of this exponent `shape`) of `radius` from the
    // centre, bounded by an invisible edge: the submarine slows down over the last `slowBand` metres and stops at it, and
    // "Batas area penyelaman" shows for `messageSeconds`. Everything the game places (reefs, trash, rocks, sea life) keeps
    // `inset` metres inside it, plus its own margin. Outside it the floor drops away by `dropDepth` metres, from `dropFrom`
    // metres before the edge to `dropWidth` metres beyond it, into deep water that fades to blue.
    area: { radius: 147, shape: 4, inset: 13, slowBand: 14, messageSeconds: 2, dropFrom: 10, dropWidth: 110, dropDepth: 70 },
    // REQ-022 (D-105): a rock headland at each end of the west beach: a ridge from the cliff behind the beach out into the sea
    // along z = +-`z` from the cliff out to x = `tipX`, solid rock to `core` m of its middle line and falling to the sea over the
    // next `fall` m, `top` m above the surface at the cliff (a few metres of unevenness on top) and lower toward the tip. The
    // walkers stop at it.
    headland: { z: 122, tipX: -96, core: 12, fall: 12, top: 9 },
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
    // Large irregular rock outcrops, with sloping shoulders and broken ledges. Their rendered surface is also used
    // for collision and for grounding the coral and decoration.
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
    // The cave (REQ-014, D-064, D-074): a tunnel through the rock hill at (x, z), running east-west with a gentle S-bend.
    // Nothing else is placed within `clear` of (x, z). The tunnel is the gap in a rock massif that stands on the hill:
    // the massif is an oval mound `halfLength` x `halfWidth` (along x and z), `rise` metres above the tunnel floor at its
    // crown (flat out to `plateau` of the radius, `lumps` of unevenness), and its roof ends at the two mouths.
    cave: {
      x: 98,
      z: -88,
      clear: 30,
      halfLength: 27,
      halfWidth: 17,
      plateau: 0.42,
      rise: 7.2,
      lumps: 0.35,
      // The tunnel floor is level at this depth: the hill's floor is flattened to it for `floorHalf` metres each way
      // along the tunnel (and blended back to the natural floor over `floorBlend` metres), so the vehicle flies
      // through holding forward only.
      floorY: -9.4,
      floorHalf: 18.5,
      floorBlend: 6,
      // The tunnel's centre line sways sideways by up to `bend` metres. Its half-width and height are `halfWidth` and
      // `height`; in the middle chamber (about `chamberHalf` metres each way of the roof hole) they grow by the extras.
      tunnel: { bend: 1.6, bendPeriod: 36, halfWidth: 3.6, chamberHalfWidth: 2.2, height: 4.2, chamberHeight: 1.0, chamberHalf: 9 },
      // A mouth is where the rock above the tunnel is at least this thick (m) coming in from outside.
      mouthRoof: 0.5,
      // The hole in the roof over the middle of the tunnel: its radius is less than the vehicle's, so only light gets in.
      hole: { radius: 0.6 },
      // About 6 of the 60 pieces of trash lie on the tunnel floor: `groups` groups of `groupSize`, within `groupRadius`.
      trash: { groups: 2, groupSize: 3, groupRadius: 2.2, edgeGap: 4 },
      // Inside, the light and the water darken: sun and sky light fall to `light` of their level (the sky light turns
      // `sky`, a deep blue), the fog turns
      // `fogColor` and closes in to `fogFar`, and the marine snow thins to `snow`. `fade` is how fast (per second).
      dark: { light: 0.22, sky: 0x3f78b8, fogColor: 0x03121f, fogNear: 1, fogFar: 26, snow: 0.35, fade: 3 },
      // The light shaft from the hole: a spot light (colour, intensity, reach, half-angle in radians) and the glow.
      shaft: { color: 0x8fd6ff, intensity: 150, reach: 16, angle: 0.4, glow: 0xdff4ff },
      // The glow across each mouth, seen from inside: the daylight outside.
      mouthGlow: 0x7fc8f2,
      // The vehicle's headlamp at full power, and how fast it fades in or out (per second); it is lit while the
      // cave level at the vehicle is at least `lampOn`, and stays lit until it falls below `lampOff`.
      lamp: { intensity: 40, fade: 8, lampOn: 0.5, lampOff: 0.3 },
    },
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
    // REQ-018: grass on the land (D-097), from `fromInland` metres inland from the waterline to the foot of the cliff, at
    // most `maxHeight` tall and always green. The ground is cut into `spacing` squares; each holds a tuft of `bladesPerTuft`
    // blades with the chance `tuftChance`, the blades within `tuftRadius` of its centre.
    grass: {
      seed: 53,
      fromInland: 8,
      spacing: 0.5,
      tuftChance: 0.85,
      bladesPerTuft: 5,
      tuftRadius: 0.3,
      minHeight: 0.18,
      maxHeight: 0.5,
      // Metres across a blade's base, and how far (radians) a blade leans off upright.
      width: 0.09,
      lean: 0.25,
      // The ground may rise by no more than this per metre; the steep foot of the cliff is steeper.
      maxSlope: 0.5,
      // Clear of the shed's walls and the dock by `structureClear`, of the counter's zone ring by `counterClear` beyond the
      // ring, and of palm trunks and rocks by `obstacleClear`.
      structureClear: 0.8,
      counterClear: 0.5,
      obstacleClear: 0.2,
      // Each blade takes a shade between these two greens.
      shades: [0x3f7d2e, 0x8dbb4e],
      // The wind (AC-4): it bends each tip sideways by up to `amplitude` metres in a gust. A gust comes round every `period`
      // seconds, its waves are `waveLength` metres long, and the wind blows toward (x, z).
      sway: { amplitude: 0.06, period: 6, waveLength: 6, wind: { x: 0.8, z: 0.6 } },
    },
    // Above the water: the haze over the bay, which is also the sky's colour at the horizon (REQ-023 AC-1), and the sea
    // seen from above.
    sky: 0xcbe8f6,
    hazeNear: 80,
    hazeFar: 420,
    seaOpacity: 0.88,
  },
  // REQ-023 (D-106, D-108): the sky over the bay, seen only above the water. It runs from `zenith` overhead to the haze
  // colour (`land.sky`) at the horizon, with a sun and slowly drifting clouds.
  sky: {
    zenith: 0x2f77c9,
    // The blend from horizon to zenith follows (height)^curve: below 1 keeps the pale band at the horizon thin.
    curve: 0.55,
    sun: {
      // Where the sun is (the light above the water comes from here; under the water the light is steeper, as it is after
      // bending into the sea), the disc's angular radius in radians, and its colour.
      direction: { x: 70, y: 40, z: 28 },
      underwater: { x: 10, y: 30, z: 5 },
      radius: 0.03,
      color: 0xfff0c8,
    },
    clouds: {
      // How many cloud features fit across the sky (more is smaller), the share of the sky they cover, how soft their
      // edges are, and how fast they drift (noise units per second, toward x and z). The shaded side is `shade`.
      scale: 1.4,
      cover: 0.5,
      softness: 0.3,
      drift: { x: 0.0045, z: 0.0025 },
      shade: 0x93a9c4,
    },
    // The dome is this share of the camera's far distance away, so the whole of it is drawn.
    domeShare: 0.97,
  },
  // REQ-023: the shaded sea surface (D-106). Seen from above it has gentle waves, reflects the sky and glints in the sun;
  // from below it shows ripples of light. The waves are sums of sines in the fragment shader (no vertex moves).
  sea: {
    // Each wave: its wavelength in metres, the direction it travels in (radians), its steepest slope, and its speed in m/s.
    waves: [
      { length: 26, angle: 0.5, slope: 0.035, speed: 1.1 },
      { length: 12, angle: 1.9, slope: 0.04, speed: 0.8 },
      { length: 6.5, angle: -0.7, slope: 0.045, speed: 0.7 },
      { length: 3.4, angle: 2.8, slope: 0.04, speed: 0.6 },
      { length: 1.8, angle: 0.1, slope: 0.03, speed: 0.5 },
    ],
    // The sun's glint: the spread of the slopes it is seen in (wider is softer and broader) and how bright it is.
    glint: { spread: 0.07, intensity: 1.3 },
    // How much of the sky shows in the water's reflection (and of the glint) before the Bloom and after it.
    reflection: { murky: 0.5, clear: 1 },
    // Seen from below: the ripples of light (their size in metres and how bright they are).
    ripples: { size: 3, brightness: 0.55 },
  },
  rov: {
    radius: 0.8,
    maxSpeed: 6,
    verticalSpeed: 3,
    // How fast velocity approaches the input; higher feels snappier, lower floatier.
    acceleration: 3,
    mouseSensitivity: 0.0025,
    // REQ-024: at the surface the submarine floats with its centre this far under it, so the cockpit dome (its base
    // 0.5 m above the centre) is above the water. Near the surface it bobs gently, in the model only: the position,
    // and with it every collision, stays still. `reach` is how far below the floating height the bobbing fades in.
    floatDepth: 0.3,
    bob: { amplitude: 0.05, period: 4.4, roll: 0.025, pitch: 0.015, reach: 0.4 },
    minPitch: -1.1,
    maxPitch: 0.7,
    // Near the station on the west shore, facing east into the bay (D-071).
    start: { x: -96, y: -5, z: 8, yaw: Math.PI / 2 },
  },
  camera: {
    fov: 70,
    distance: 6,
    height: 2,
    // Keeps the camera off the floor. It may rise out of the water (REQ-024 AC-3).
    floorGap: 0.5,
    // REQ-024 AC-4: the view changes between under and above water only once the camera is this far past the waterline,
    // and back only once it is this far past it the other way, so it cannot flicker with the camera right at the surface.
    surfaceBand: 0.15,
    // REQ-011 AC-4: the camera stops this far short of a slope, rock or wall between it and the ROV, found by
    // stepping along that line by `step`.
    clearance: 0.4,
    step: 0.25,
    // REQ-014: with a wall right behind the vehicle the camera is pulled in to it; closer than this the hull is not drawn.
    hideVehicleBelow: 1.4,
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
    // REQ-017 (D-095, D-097): `count` of the items lie on the sand of the west beach instead, in `groups` (min to max)
    // groups of about the same size within `groupRadius`, from `minInland` to `maxInland` metres inland of the waterline
    // and at most `halfLength` m north or south of the beach's centre (z = 0). Groups stay `groupSpacing` apart and
    // items `spacing`. Kept `clearOfShed` from the shed's walls and the counter's zone, `clearOfDock` from the dock's
    // deck, `clearOfObstacles` from palms, rocks and bins. The player picks one up from `reach` m (on the ground), when
    // the crosshair passes within `aimRadius` of it; it lifts `liftHeight` m and shrinks away in `liftSeconds`.
    beach: {
      count: 8,
      groups: [3, 4],
      groupRadius: 1.8,
      groupSpacing: 25,
      spacing: 1.5,
      minInland: 1,
      maxInland: 7,
      halfLength: 85,
      clearOfShed: 1.5,
      clearOfDock: 1.5,
      clearOfObstacles: 1,
      reach: 3,
      aimRadius: 0.5,
      liftSeconds: 0.3,
      liftHeight: 0.9,
    },
    // REQ-025 (D-109, D-110): `count` of the items (bottles and bags only) float at the sea surface instead, in `groups`
    // (min to max) small groups within `groupRadius`, over water at least `minDepth` deep. Groups stay `groupSpacing` apart
    // and items `spacing`. One group (the first) lies within `nearShore` m of the west beach's waterline (its centre within
    // `nearShoreCentre`) and between z = ±`beachHalfLength`, so it is seen from the beach; `displayScale` makes each item
    // read at that distance. They keep `edgeMargin` m inside the dive area (clear of its slow-down band), `clearOfStart`
    // from the start, `clearOfDock` from the dock's deck, `clearOfHeadland` from the headlands' rock and `clearOfPark` from
    // anywhere the submarine can be left floating when the player goes ashore. An item floats half under water: its centre
    // is `sink` m under the surface, and its model bobs in place (`bob`: seconds per cycle, rise in metres, tilt in
    // radians), each item with a phase of its own; its position stays still.
    surface: {
      count: 8,
      groups: [2, 3],
      groupRadius: 3,
      groupSpacing: 30,
      spacing: 1.5,
      minDepth: 3,
      nearShore: 50,
      nearShoreCentre: 30,
      displayScale: 1.8,
      beachHalfLength: 80,
      edgeMargin: 6,
      clearOfStart: 8,
      clearOfDock: 4,
      clearOfHeadland: 4,
      clearOfPark: 4,
      sink: 0.03,
      bob: { period: 3.4, amplitude: 0.04, roll: 0.14, pitch: 0.1 },
    },
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
        // Radius used to keep the swimming animal out of rocks, slopes and the edge of the dive area.
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
    // and the trash; every spot has a level pad. REQ-019 (D-099): the seagrass spots lie on the shallow sand off the west
    // beach, 4.3 m deep, among the natural meadows (the reef belt starts at 7 m, so they keep clear of it).
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
      { x: -128, z: -77.6 },
      { x: -128.1, z: -45.3 },
      { x: -124.1, z: -8.5 },
      { x: -118.1, z: 32.5 },
      { x: -124.4, z: 67 },
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
    // REQ-019 AC-6: a natural seagrass meadow is scanned where the ray comes down to `meadowHeight` above the floor (about
    // the leaves' height) within `meadowReach` times the meadow's radius of its centre, so it works from directly above.
    meadowHeight: 0.3,
    meadowReach: 0.8,
  },
  // REQ-008: the end screen shows this many game seconds after the 7th entry, once its notice (2.5 s) has been read.
  end: {
    delay: 3,
  },
  // REQ-027 (D-111, D-113): the opening cinematic, played on the first Mulai after the page opens. It shows black bars at the
  // top and bottom (`letterbox`: each one's share of the screen's height, sliding in and out over `barSeconds`), hides the HUD
  // and takes the controls away; a click or Space skips (the screen fades out and back in over `skipFadeSeconds`, and the
  // control comes back at the darkest point). The camera merges into the follow camera over the last `blendSeconds`. A
  // caption fades in and out over `captionFadeSeconds`.
  cinematic: {
    letterbox: 0.12,
    barSeconds: 0.7,
    skipFadeSeconds: 0.5,
    blendSeconds: 1.4,
    captionFadeSeconds: 0.6,
    // The screen comes up from black over this long as the opening begins.
    openingFadeSeconds: 0.8,
    // The camera keeps this far (metres) from rock, the floor, the land and the buildings.
    clearance: 0.6,
    // The point the opening's camera looks at is this far (metres) ahead of it along its look direction.
    lookAhead: 14,
    // REQ-027 AC-1: about 22 s. `shots` are the seconds at which the aerial shot ends, the low glide ends and the camera
    // reaches the surface on its way down (the dive then runs to the end). `captions` are the three lines of narration, each
    // with the seconds it shows from and to. The group of floating trash nearest the west beach is the subject: the camera
    // starts `aerial.back` m out to sea from its waterline at `aerial.height` m, comes down to `glide.height` m over the
    // water `glide.pass` m from the group, and dives toward the submarine.
    opening: {
      duration: 22,
      shots: { aerial: 8, glide: 15.5, surface: 17 },
      captions: [
        { key: "cinematic.opening.1", from: 1.2, to: 6.8 },
        { key: "cinematic.opening.2", from: 8.6, to: 15 },
        { key: "cinematic.opening.3", from: 16.4, to: 21.2 },
      ],
      aerial: { back: 72, height: 34 },
      glide: { height: 2.4, pass: 9 },
    },
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
    // above the surface is land (west, and the headlands).
    cells: 80,
    depthBands: [-11, -15, -19],
    // Icon sizes in map units (the minimap is about 200 px wide at full size, so one unit is about one pixel).
    icon: { station: 8, site: 8, net: 6.5, trash: 2.6, rov: 12, sub: 7, mouth: 5.5 },
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
      color: 0x258eaf,
      // Thin haze and a long view: the far end of the fog moves out to 90 m.
      fogNear: 10,
      fogFar: 90,
      hemiSky: 0xb7e1ee,
      hemiIntensity: 1.35,
      sunIntensity: 2.2,
      snowOpacity: 0.25,
      surfaceColor: 0xb8e6f6,
    },
    coral: {
      // Fragments grow to this many times their size and blend to a pastel colour (AC-2). Each fragment takes
      // the next colour of this list, so the reef ends up multi-coloured (DESIGN).
      scale: 1.8,
      pastel: [0xd77c87, 0xc5a45d, 0x9f85bd, 0x79ada0, 0xd6c38b, 0x7d9caf],
      // Emissive glow at the end, as a share of the colour, so the coral stays bright in the shade.
      glow: 0.06,
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
  // REQ-013: the natural reef that recovers with the Bloom (D-068, D-074, D-086, D-089).
  nature: {
    // REQ-020: coral grows as colonies packed into a reef belt and patch reefs on the shallow hard ground (D-098, D-100 to
    // D-102). A colony is `minSize` to `maxSize` m (small ones are the most; `sizeSkew` > 1 makes them so) of one of four
    // shapes (branching, table, brain, finger; shares in `shapes`); neighbours sit no closer than `crowd` of their widths.
    // The belt lies along the edge of the shallow west shelf where the floor is `minDepth` to `maxDepth` m deep (the
    // seagrass is shallower), in stretches `gapPeriod` m long with sand between; it keeps `startClear` m from the start
    // (`attempts` tries). `patches` reefs grow on the arches' crowns, on boulder tops and on hill tops, `minWidth` to
    // `maxWidth` m wide. `porites` big heads stand as landmarks, `onBelt` of them on the belt (two ahead of the start, one on each side), `spacing` m apart. Each reef
    // is solid as blobs hugging its colonies, one per `cell` m square.
    coral: {
      seed: 23,
      minSize: 0.4,
      maxSize: 2.1,
      sizeSkew: 1.35,
      crowd: 0.76,
      shapes: [0.3, 0.25, 0.25, 0.2],
      belt: { minDepth: 7, maxDepth: 12.5, peakDepth: 10.6, spread: 2, cover: 1, startClear: 8.1, attempts: 60000, gapPeriod: 60 },
      patches: { count: 10, arches: 2, boulders: 4, minWidth: 6, maxWidth: 18 },
      porites: { count: 5, onBelt: 3, minRadius: 1.2, maxRadius: 2, spacing: 30 },
      cell: 3.5,
      maxSlope: 0.5,
    },
    // Their colour before the Bloom: bleached and dull. After it each cluster takes a colour of bloom.coral.pastel.
    pale: 0xd6d0c4,
    // REQ-019 (D-098, D-102): seagrass meadows on the shallow sand between the west beach and the reef, `count` of them,
    // 2 x radius (minRadius..maxRadius) across, strung along the open shore with their centres `centreDepth` metres deep.
    // Blades grow only between `minDepth` and `maxDepth` (thinning toward both ends) and not within `dockClear` of the
    // dock, nor `spotClear` of a planting spot: a patch stays bare sand until it is planted. A shoot is a tuft of 3-5
    // flat, blunt ribbon leaves (`leaf`, metres; `lean` is the most they tilt); where the water is shallower than
    // `enhalus.depth` some shoots are Enhalus clumps of wide, tall leaves. Under each meadow lies a sand tint of
    // `sand`. Sparse (`sparse` of the blades) and brown before the Bloom, all of them, taller and green after it. The
    // leaves sway in the current: the tip moves up to `sway.amplitude` of the leaf's length with a period of `sway.period`
    // seconds, a wave `sway.waveLength` long travelling along `sway.current`. Not plantable; scanning one opens the
    // seagrass entry (D-089).
    meadows: {
      count: 10,
      seed: 37,
      minRadius: 4,
      maxRadius: 8.5,
      centreDepth: { min: 3.2, max: 5.2 },
      minDepth: 1,
      maxDepth: 7,
      dockClear: 9,
      spotClear: 6,
      shootsPerSquareMetre: 15,
      leaf: { minHeight: 0.2, maxHeight: 0.35, width: 0.055, minLeaves: 4, maxLeaves: 6, lean: 0.55 },
      enhalus: { depth: 2.8, chance: 0.25, leaves: 5, minHeight: 0.6, maxHeight: 1, width: 0.11, lean: 0.35 },
      sparse: 0.3,
      brown: 0x8c7b4e,
      green: 0x4fae5a,
      sand: { brown: 0x5a5638, green: 0x45653a, opacityBefore: 0.6, opacityAfter: 0.85 },
      sway: { amplitude: 0.35, period: 4.5, waveLength: 12, current: { x: 1, z: 0.35 } },
    },
    // Decoration, passable (REQ-013 AC-4, REQ-021; D-074, D-098, D-102): tropical algae, barrel sponges and sea fans, each
    // where its kind grows. Per kind: how many (`count`), its size in metres (`size`: a range, a little bigger than real so it
    // reads from the camera) and the radius it covers per metre of size (`reach`). No kelp: it lives in cold seas (D-074).
    decor: {
      seed: 41,
      halimeda: { count: 30, size: [1, 1.2], reach: 0.25 },
      padina: { count: 24, size: [0.85, 1.15], reach: 0.2 },
      sargassum: { count: 16, size: [0.65, 1.2], reach: 0.3 },
      sponge: { count: 30, size: [0.4, 1.2], reach: 0.45 },
      fan: { count: 22, size: [1.15, 1.9], reach: 0.9 },
      // Algae grow on hard ground (a rock, a boulder's top, an arch) and on the shallow shelf in the west, from `shallow` m
      // down to `algaeDepth` m; sargassum only down to `sargassumDepth` m (AC-2).
      shallow: 1.5,
      algaeDepth: 12,
      sargassumDepth: 10,
      // Sponges grow on rocks, boulders and slopes from `spongeDepth` m down; sea fans on boulders, arches and slopes deeper
      // than `fanDepth` m (AC-3, AC-4).
      spongeDepth: 5,
      fanDepth: 10,
      // Hard ground is within `hardReach` m of a rock's or a boulder's edge, or of an arch's ring; a slope is steeper than `slope`.
      hardReach: 2.5,
      slope: 0.25,
      // Every sea fan faces this current, a yaw in radians (AC-4).
      current: 0.6,
      // A piece stays `clearOfTrash` m beyond its reach from the dive's trash, so it never covers an item (AC-6); and `gap` m
      // from the other pieces.
      clearOfTrash: 1,
      gap: 0.3,
      // Dull before the Bloom (AC-5); after it each piece takes a colour of its kind, by its seed.
      dull: 0x8f8a7c,
      colours: {
        halimeda: [0x5fae3f, 0x3f8f3a],
        padina: [0xeee6cc, 0xd9ccaa],
        sargassum: [0x8a6a34, 0x6b4c24],
        sponge: [0xb05ac8, 0xe08a3c, 0xd9c84a],
        fan: [0x8e5fd6, 0xc8455a],
      },
    },
    // Light rays from the surface after the Bloom (AC-3): this many shafts around the camera, within `spread` metres.
    rays: { count: 12, spread: 36, opacity: 0.1 },
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

  // REQ-026 (D-026, D-110): sound. Everything but the music is made in code with Web Audio. Volumes are 0..1 on the
  // sliders and become gains through `volumeCurve` (gain = volume ^ curve, so the middle of the slider is half as loud
  // to the ear, not half the signal).
  audio: {
    volume: { music: 0.6, effects: 0.8 },
    volumeCurve: 2,
    // Seconds of white noise in the one buffer every noise source loops (ambience, wind, the effects' hiss).
    noiseSeconds: 3,
    // Time constants (seconds) of the glides: `fast` for the sliders and M (they must feel immediate), `fade` for
    // pausing and unpausing (AC-7).
    fast: 0.03,
    fade: 0.3,
    // A tab or window that is not in front stops all sound; the context is suspended this many milliseconds later, once
    // the gain is down, so the browser can stop the audio thread.
    suspendDelayMs: 200,
    // AC-4: the one track, loaded with a path relative to the page (the build runs from any folder, D-053). `level` is its
    // gain at full volume. Before the Bloom a low-pass filter makes it sound heard through murky water: the cutoff goes
    // from `muffledHz` at clarity 0 to `clearHz` at clarity 1 (exponentially, as the ear hears pitch), following the
    // Bloom's clarity over its 6 s, then stays clear. `glide` smooths the filter. In the pause menu, the Logbook and
    // the end screen the music plays at `quiet` of its level (AC-7).
    music: { url: "assets/audio/Underwater-Ambient-Pad-isaiah658.ogg", level: 0.9, muffledHz: 600, clearHz: 18000, q: 0.7, glide: 0.2, quiet: 0.35 },
    // The effects' (and the ambience's) bus gain at full volume.
    effectsLevel: 0.8,
    effects: {
      // A sound is a list of layers, each starting `at` seconds in: a `tone` sweeps from `from` to `to` Hz (an
      // oscillator), a `noise` is the shared noise through a filter (type, `from` to `to` Hz, q). `gain` is the peak
      // and `attack` the rise in seconds; the fall is exponential to `dur`. `gap` is the shortest time between two plays
      // of the sound (a vacuum pulling many pieces at once is one clink), `jitter` the most the pitch varies by chance
      // (0.05 is 5 %), so a repeated sound is never the same twice.
      click: { gap: 0.04, jitter: 0.03, layers: [
        { kind: "tone", wave: "triangle", from: 1100, to: 700, dur: 0.07, gain: 0.5 },
        { kind: "noise", filter: "highpass", from: 4000, dur: 0.03, gain: 0.15 },
      ] },
      trashIn: { gap: 0.05, jitter: 0.08, layers: [
        { kind: "tone", wave: "sine", from: 400, to: 900, dur: 0.12, gain: 0.5 },
        { kind: "tone", wave: "triangle", from: 1800, dur: 0.06, at: 0.03, gain: 0.12 },
        { kind: "noise", filter: "bandpass", from: 1500, q: 1, dur: 0.06, gain: 0.15 },
      ] },
      tankFull: { gap: 0.5, layers: [
        { kind: "tone", wave: "triangle", from: 200, dur: 0.2, gain: 0.5 },
        { kind: "tone", wave: "triangle", from: 150, dur: 0.35, at: 0.22, gain: 0.5 },
      ] },
      netCut: { gap: 0.2, jitter: 0.04, layers: [
        { kind: "noise", filter: "highpass", from: 2500, to: 6000, q: 0.7, dur: 0.14, gain: 0.5 },
        { kind: "tone", wave: "triangle", from: 1400, to: 400, dur: 0.1, gain: 0.25 },
      ] },
      animalFreed: { gap: 0.5, layers: [
        { kind: "tone", wave: "triangle", from: 523, dur: 0.35, gain: 0.3 },
        { kind: "tone", wave: "triangle", from: 659, dur: 0.35, at: 0.09, gain: 0.3 },
        { kind: "tone", wave: "triangle", from: 784, dur: 0.35, at: 0.18, gain: 0.3 },
        { kind: "tone", wave: "triangle", from: 1047, dur: 0.6, at: 0.27, gain: 0.3 },
      ] },
      seedShot: { gap: 0.08, jitter: 0.05, layers: [
        { kind: "tone", wave: "sine", from: 700, to: 200, dur: 0.12, gain: 0.45 },
        { kind: "noise", filter: "bandpass", from: 2500, to: 800, q: 1.2, dur: 0.1, gain: 0.25 },
      ] },
      planted: { gap: 0.3, layers: [
        { kind: "tone", wave: "sine", from: 659, dur: 0.5, gain: 0.35 },
        { kind: "tone", wave: "sine", from: 988, dur: 0.6, at: 0.12, gain: 0.3 },
        { kind: "tone", wave: "sine", from: 1319, dur: 0.8, at: 0.24, gain: 0.25 },
      ] },
      frameInstall: { gap: 0.3, jitter: 0.03, layers: [
        { kind: "tone", wave: "triangle", from: 140, to: 70, dur: 0.25, gain: 0.6 },
        { kind: "noise", filter: "lowpass", from: 900, dur: 0.12, gain: 0.4 },
        { kind: "tone", wave: "sine", from: 880, dur: 0.3, at: 0.02, gain: 0.12 },
      ] },
      scanKnown: { gap: 0.4, layers: [{ kind: "tone", wave: "sine", from: 440, to: 330, dur: 0.15, gain: 0.3 }] },
      logbookEntry: { gap: 0.5, layers: [
        { kind: "tone", wave: "sine", from: 523, dur: 0.5, gain: 0.3 },
        { kind: "tone", wave: "sine", from: 659, dur: 0.5, at: 0.12, gain: 0.3 },
        { kind: "tone", wave: "sine", from: 784, dur: 0.5, at: 0.24, gain: 0.3 },
        { kind: "tone", wave: "sine", from: 1047, dur: 0.6, at: 0.36, gain: 0.3 },
        { kind: "tone", wave: "triangle", from: 1568, dur: 0.9, at: 0.36, gain: 0.12 },
      ] },
      deposit: { gap: 0.3, layers: [
        { kind: "tone", wave: "triangle", from: 1800, dur: 0.08, gain: 0.3 },
        { kind: "tone", wave: "triangle", from: 2300, dur: 0.08, at: 0.07, gain: 0.3 },
        { kind: "tone", wave: "triangle", from: 1600, dur: 0.08, at: 0.14, gain: 0.3 },
        { kind: "tone", wave: "triangle", from: 2000, dur: 0.14, at: 0.2, gain: 0.3 },
        { kind: "noise", filter: "lowpass", from: 1200, dur: 0.3, gain: 0.2 },
      ] },
      pickup: { gap: 0.1, jitter: 0.05, layers: [
        { kind: "noise", filter: "bandpass", from: 1800, q: 1, dur: 0.08, gain: 0.3 },
        { kind: "tone", wave: "sine", from: 600, to: 900, dur: 0.1, at: 0.05, gain: 0.3 },
      ] },
      footstepSand: { gap: 0.15, jitter: 0.15, layers: [{ kind: "noise", filter: "lowpass", from: 900, to: 300, q: 0.5, dur: 0.14, gain: 0.35, attack: 0.01 }] },
      footstepDock: { gap: 0.15, jitter: 0.1, layers: [
        { kind: "tone", wave: "sine", from: 150, to: 90, dur: 0.1, gain: 0.5 },
        { kind: "noise", filter: "bandpass", from: 700, q: 2, dur: 0.06, gain: 0.3 },
      ] },
      leaveSub: { gap: 0.5, layers: [
        { kind: "noise", filter: "bandpass", from: 1200, to: 300, q: 1, dur: 0.5, gain: 0.3 },
        { kind: "tone", wave: "triangle", from: 120, to: 60, dur: 0.3, at: 0.1, gain: 0.5 },
        { kind: "tone", wave: "sine", from: 740, dur: 0.15, gain: 0.1 },
      ] },
      boardSub: { gap: 0.5, layers: [
        { kind: "tone", wave: "triangle", from: 60, to: 120, dur: 0.3, gain: 0.5 },
        { kind: "noise", filter: "bandpass", from: 300, to: 1200, q: 1, dur: 0.5, at: 0.15, gain: 0.3 },
        { kind: "tone", wave: "sine", from: 740, dur: 0.15, at: 0.5, gain: 0.1 },
      ] },
      // The Bloom: a chord that builds over its 6 s, with a shimmer on top.
      bloom: { layers: [
        { kind: "tone", wave: "sine", from: 262, dur: 6.5, gain: 0.2, attack: 3 },
        { kind: "tone", wave: "sine", from: 392, dur: 5.5, at: 1, gain: 0.15, attack: 2 },
        { kind: "tone", wave: "sine", from: 523, dur: 4.5, at: 2, gain: 0.15, attack: 1.5 },
        { kind: "tone", wave: "sine", from: 659, dur: 3.5, at: 3, gain: 0.15, attack: 1.5 },
        { kind: "tone", wave: "sine", from: 784, dur: 2.5, at: 4, gain: 0.12, attack: 1 },
        { kind: "noise", filter: "highpass", from: 5000, to: 9000, dur: 6, gain: 0.06, attack: 3 },
      ] },
    },
    // The sounds held while the button is down. The vacuum: a motor hum (`humHz` through a low-pass at `humCutoff`)
    // under a rush of air (noise through a band-pass at `noiseHz`). The Scanner: a tone that rises from `baseHz` by
    // `rangeHz` as the scan fills, with a tremolo. `glide` is how fast they start and stop.
    loops: {
      vacuum: { noiseHz: 500, noiseQ: 1.2, noiseGain: 0.3, humHz: 70, humCutoff: 260, humGain: 0.22, glide: 0.08 },
      scan: { baseHz: 520, rangeHz: 900, gain: 0.12, tremoloHz: 9, tremoloDepth: 0.5, glide: 0.05 },
    },
    // Ambience (AC-2): `crossfade` is the time constant of the change between under water and above it. Under water: a
    // low rumble (noise through a low-pass at `cutoff`, swelling at `swellHz` by `depth`) and now and then up to `count`
    // bubbles, one burst every `gapMin`..`gapMax` seconds. Above: waves (a low-pass of noise that swells like a wave
    // every 1 / `swellHz` s) and wind (noise through a band-pass whose strength drifts at `gustHz`).
    ambience: {
      level: 0.6,
      crossfade: 0.5,
      under: {
        rumble: { cutoff: 110, gain: 0.55, swellHz: 0.11, depth: 0.25 },
        bubbles: { gapMin: 1.2, gapMax: 4, count: 4, spacing: 0.09, jitter: 0.35, layers: [{ kind: "tone", wave: "sine", from: 420, to: 760, dur: 0.1, gain: 0.12 }] },
      },
      above: {
        waves: { cutoff: 700, gain: 0.35, swellHz: 0.13, depth: 0.6 },
        wind: { hz: 620, q: 0.7, gain: 0.22, gustHz: 0.06, depth: 0.7 },
      },
    },
    // How far the player walks between two footsteps.
    footstepStride: 0.9,
  },
} as const;

export type Config = typeof config;
