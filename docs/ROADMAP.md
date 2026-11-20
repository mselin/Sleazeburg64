# Roadmap

The plan is to prove the hard parts first. On a C64 those are smooth scrolling and getting enough moving
objects on screen, so the early milestones are about those and the game itself comes after.

Each item has a matching issue; this page is the overview.

The game's rules and look, with the numbers, are in the browser game's
[design document](https://github.com/mselin/gta-c64/blob/main/specs/design.md): the palette,
people, cars and walls, heat and the police, the title and the icon. The items below follow it, and its
"C64 notes" point out where the hardware forces a choice.

## Milestone 1: can it scroll and drive?

- **1a. City viewer** (done). The city drawn in character mode, moved a tile at a time with the joystick.
- **1b. Smooth scrolling** (done, not yet tried on real hardware). Eight-way pixel scrolling using the VIC
  fine-scroll registers and a second screen, with colour memory worked out after each swap ahead of the beam.
  Top speed 4 pixels a frame, one character every two frames, as fast as the browser game's sports car.
- **1c. A car you can drive** (done, not yet tried on real hardware). One sprite in 16 directions, the
  browser game's handling in fixed point (including the slide), collision with buildings and trees, and the
  view following the car. Top speed 4 pixels a frame, as fast as the view can scroll.
  - **To check against the design's wall rules.** The browser game had a bug that let a car drive through a
    building, and now never lets one through: a car that hits a wall bounces back at 30% of its speed and,
    above 35 px/s (0.7 pixels a frame), takes damage; a car that only clips a corner slips up to 3 pixels past
    it; and a car found inside a wall is moved out to the nearest clear spot rather than left free to move.
    `src/car.asm` lets a car that is inside a wall move anywhere until it is out, which is the idea behind
    the browser bug, so it is worth checking that a car can never get there by driving.

If 1b and 1c feel right on real hardware, the rest is a long list of known work.

## Milestone 2: a city with things in it

- A raster split so the status panel has its own colours (done with 1b: it had to be, to keep the panel still).
- The player on foot, and getting in and out of the car. The design draws the player in a yellow jacket with a
  black and then a white outline, about 12 pixels across, so that it stands out.
- Traffic: a few cars following the lanes, drawn with a sprite multiplexer (done, not yet tried on real
  hardware: six cars, which is what the frame time allows; the multiplexer shares sprites 1-7 and the tests try
  it with sixteen). The player's car bounces off traffic, and wrecks a car it hits hard.
- Pedestrians, drawn as characters rather than sprites. The design now draws people about 12 pixels across in
  chunky 2 × 2 pixels with a black outline, more than one character, and police officers in light blue with a
  white cap; passers-by never look like the player or the police. Walkers have five walking poses, arms and feet
  swinging opposite ways, and a pose with the arm held out for a shot or a punch. See the design's
  [People on foot](https://github.com/mselin/gta-c64/blob/main/specs/design.md#people-on-foot) and its C64 note
  on characters and sprites.
- Water: cars flood and sink, people swim.

## Milestone 3: the game

- Heat and police, by the design's rules: the heat levels and what each crime adds, the distances the police
  notice from, and the stolen police car (driving one where the police notice it raises the heat to 2).
- Jobs, starting with deliveries and the cult of 6-7.
- Pickups, money, getting arrested, the hospital.
- Title screen, game-over and victory pictures.

## Milestone 4: sound and polish

- Sound effects and an original tune, sharing the SID's three voices.
- Loading from disk for anything that does not fit in memory at once.
- NTSC support, if wanted.

## Alongside

- **Play it in a browser.** Run the `.prg` on a web page with a WebAssembly build of the VICE emulator, so the
  C64 version can be tried without hardware. Needs a look at which builds exist, how they are licensed and what
  they do about system ROMs.

## What will not carry over from the browser game

- **The radio.** The browser game streams tunes from the High Voltage SID Collection. On a real machine each
  tune brings its own player code at a fixed address, takes all three voices, and would have to be shipped on
  the disk, which is redistribution. The C64 version gets its own music instead. Two such tunes can be tried
  in private test builds (`make music`, see `music/README.md`), which is also how the music code gets written
  before there is an original tune.
- **Skid marks and other decals.** The browser game paints them onto the map. Character mode has nowhere cheap
  to put them.
- **Crowds.** The browser game simulates about fifty cars. Here it will be a handful.
