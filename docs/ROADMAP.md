# Roadmap

The plan is to prove the hard parts first. On a C64 those are smooth scrolling and getting enough moving
objects on screen, so the early milestones are about those and the game itself comes after.

Each item has a matching issue; this page is the overview.

## Milestone 1: can it scroll and drive?

- **1a. City viewer** (done). The city drawn in character mode, moved a tile at a time with the joystick.
- **1b. Smooth scrolling** (done, not yet tried on real hardware). Eight-way pixel scrolling using the VIC
  fine-scroll registers and a second screen, with colour memory worked out after each swap ahead of the beam.
  Top speed 4 pixels a frame, one character every two frames, as fast as the browser game's sports car.
- **1c. A car you can drive.** One sprite with pre-rotated frames, steering and speed in fixed-point
  arithmetic, and collision with buildings. The view follows the car.

If 1b and 1c feel right on real hardware, the rest is a long list of known work.

## Milestone 2: a city with things in it

- A raster split so the status panel has its own colours (done with 1b: it had to be, to keep the panel still).
- The player on foot, and getting in and out of the car.
- Traffic: a few cars following the lanes, drawn with a sprite multiplexer.
- Pedestrians, drawn as characters rather than sprites.
- Water: cars flood and sink, people swim.

## Milestone 3: the game

- Heat and police.
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
