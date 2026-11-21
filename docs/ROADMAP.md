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
  - **The design's new handling** (mselin/gta-c64#31, #46; done, not yet tried on real hardware). Without the
    handbrake the car turns no sharper than its grip holds, so flat out it takes a wider line: from about 3.2
    pixels a frame on the road (163 px/s), with a table of the most turn for each speed, and sooner where the
    grip is less (braking, on grass, in the water). Grass slows the car as well as making it slide. See the
    design's [Handling](https://github.com/mselin/gta-c64/blob/main/specs/design.md#handling).

If 1b and 1c feel right on real hardware, the rest is a long list of known work.

## Milestone 2: a city with things in it

- A raster split so the status panel has its own colours (done with 1b: it had to be, to keep the panel still).
- The player on foot, and getting in and out of cars (done, not yet tried on real hardware). The design draws
  the player in a yellow jacket with a black and then a white outline, about 12 pixels across, so that it
  stands out: here a multicolour sprite in eight directions and the design's five walking poses, and two
  pictures swimming. Fire with the stick centred gets out of a slow car, and into the nearest car within
  reach, a passing one included. Still to come, with the things they need: the driver of a car that is taken
  (people), being hurt by cars (health), and something for fire to do away from a car (fists and weapons).
  The player's frames come from the design's figure (`tools/assets.mjs`), so fighting adds four more poses to
  them: the arm out with a gun, a fist or a knife, and lying knocked down.
- Traffic: a few cars following the lanes, drawn with a sprite multiplexer (done, not yet tried on real
  hardware: five cars, which is what the frame time allows beside the passers-by (six before them, the owner's
  choice); the multiplexer shares sprites 1-7 and the tests try it with sixteen). The player's car bounces off traffic, and wrecks a car it hits hard. By the design's
  [Car against car](https://github.com/mselin/gta-c64/blob/main/specs/design.md#car-against-car), crashes now go
  by each kind's weight (a table of shares for each pair of kinds), and a knock off a car's middle spins it,
  which can wait until there are crashes to spin (#46).
- Pedestrians (walking passers-by done, not yet tried on real hardware): up to four at once, multicolour sprites
  shared through the multiplexer rather than characters (the owner's choice: characters could only be grey and
  black), the player's figure in four directions and five poses in one of the design's eight shirt colours, with
  black outline and hair and yellow skin, the colours all multicolour sprites share. They appear out of sight on
  pavements and plazas, walk the pavements, plazas and grass, go once far off, and move only in a frame with
  time to spare (`src/people.asm`). Still to come: crossing roads, traffic stopping for them, being run over and
  knocked down (another picture), scooter riders and the police. The design draws people about 12 pixels across in
  chunky 2 × 2 pixels with a black outline, more than one character, and police officers in light blue with a
  white cap; passers-by never look like the player or the police. Walkers have five walking poses, arms and feet
  swinging opposite ways, a pose with the arm held out for a shot, a punch or a stab, and one lying knocked
  down. See the design's
  [People on foot](https://github.com/mselin/gta-c64/blob/main/specs/design.md#people-on-foot) and its C64 note
  on characters and sprites.
  - **The same figure as the player.** The player's frames in `tools/assets.mjs` already draw the design's
    figure, so passers-by and the police can reuse that code with their own colours.
  - **Memory is the limit.** A figure has nine poses in each direction it keeps: five walking, the arm out with
    a gun, a fist or a knife, and knocked down. Mirror images save some, as they do for the player. The handover
    notes say more sprite frames mean moving code out of the way, or keeping fewer frames.
- Water: cars flood and sink, people swim (done, not yet tried on real hardware). The player's car wades,
  slower the deeper it is, floods once it is wholly in, and sinks in three colours, leaving the player swimming.
  It stops where it floods rather than drifting on, and it is out of the way from the moment it floods rather
  than once it is on the bottom. See the design's
  [Water](https://github.com/mselin/gta-c64/blob/main/specs/design.md#water).
- Big Honk, the crime boss (done, not yet tried on real hardware): a goose who wanders The Moat, crossing a
  bridge now and then, and whom nothing hurts. A car that runs into him only makes him flap and run off. One
  multicolour sprite, shared through the multiplexer. Still to come: a honk when there is sound, and traffic
  stopping for him once it looks out for people.

## Milestone 3: the game

- Heat and police, by the design's rules: the heat levels and what each crime adds, the distances the police
  notice from, and the stolen police car (driving one where the police notice it raises the heat to 2).
  - **The siren and the flashing border.** The border flashes red and blue (`$D020`, every 25 frames) only while
    the siren sounds: the police near, in play. It never flashes with nobody about, on the busted screen or
    while paused. The browser game got this wrong and kept flashing as long as there was any heat
    (mselin/gta-c64#18), so it is worth getting right from the start. See the design's "The siren".
- Fighting on foot, by the design's
  [Fighting on foot](https://github.com/mselin/gta-c64/blob/main/specs/design.md#fighting-on-foot): fire uses
  the gun while there is ammo, then the knife if the player has one, otherwise fists. A punch knocks someone
  down for 4 seconds, for half a kill's heat; a police officer who is down cannot arrest, shoot or notice the
  player. A stab kills, and reaches farther. The panel shows `AMMO12`, then `KNIFE` or `FIST`.
- Jobs, starting with deliveries and the cult of 6-7.
- Pickups, money, getting arrested, the hospital. Pickups include the knife (a **K**, also dropped now and then
  by someone the player kills), and ammo stops at 99 so the panel always shows two digits.
  - **Never where the player appears.** No pickup lies within 32 pixels of the hospital or the police station,
    where the player starts and comes back. Both sit between two tile middles, 8 pixels from each, and the
    browser game used to let a pickup land there and be taken the moment the player appeared, in about 1 game
    in 27 (mselin/gta-c64#33). See the design's
    [Pickups](https://github.com/mselin/gta-c64/blob/main/specs/design.md#pickups): what there is, how often,
    what each does and what people drop.
  - **Banners that fit the screen.** BUSTED, FLATLINED and the job banners put big text across the middle of the
    screen with a line or more under it. By the design's
    [Banners](https://github.com/mselin/gta-c64/blob/main/specs/design.md#banners): a title of at most 19
    characters in double-size letters, and the text under it broken into even lines of at most 38 of the 40
    columns. The browser game used to let lines over 40 characters run off both sides (mselin/gta-c64#14). On
    the C64 the screen is 40 columns too, so the same limits hold.
- The status panel (done, not yet tried on real hardware), by the design's
  [The status panel](https://github.com/mselin/gta-c64/blob/main/specs/design.md#the-status-panel), in place
  of the demo text (#44). Row 1: money, heat, health, the car while in one, and what fire does, `AMMO12`
  (two digits, as ammo stops at 99) or `KNIFE` or `FIST` in columns 34-39. Row 2: the job. Row 3: messages,
  or the election fund. The browser game's positions between character columns are rounded to whole ones,
  the car's bar is 24 pixels rather than 26, a message scrolls a character every 6 frames rather than 70
  pixels a second, and the part of a bar that is not filled is dark grey only in whole characters, as a
  character has one colour. Nothing changes the money, heat, health or ammo yet: what does sets
  `status.changed`, and row 1 is drawn again. The jobs (#9) fill row 2.
- Title screen, game-over and victory pictures.

## Milestone 4: sound and polish

- Sound effects and an original tune, sharing the SID's three voices.
- Loading from disk for anything that does not fit in memory at once.
- NTSC support, if wanted.

## Alongside

- **Play it in a browser.** Run the `.prg` on a web page with a WebAssembly build of the VICE emulator, so the
  C64 version can be tried without hardware. Needs a look at which builds exist, how they are licensed and what
  they do about system ROMs. Once the emulator runs on our own page, that page should check the browser first,
  as the browser game does on its loading screen (its `js/compat.js`, described under "Only in the browser and
  desktop versions" in the design). It should say plainly when the emulator cannot run, and note what will not
  work, such as no sound or, on a phone, no full screen. For now the page links to VirtualC64 Web, which runs
  on its own site.

## What will not carry over from the browser game

- **The browser check.** The browser game checks the browser on its loading screen and says what is missing.
  A real C64 has no browser to check. The nearest thing here is the title screen's note on an NTSC machine
  (`src/title.asm`), which says the game is written for PAL; NTSC support is in milestone 4.

- **The radio.** The browser game streams tunes from the High Voltage SID Collection. On a real machine each
  tune brings its own player code at a fixed address, takes all three voices, and would have to be shipped on
  the disk, which is redistribution. The C64 version gets its own music instead. Two such tunes can be tried
  in private test builds (`make music`, see `music/README.md`), which is also how the music code gets written
  before there is an original tune.
- **Skid marks and other decals.** The browser game paints them onto the map. Character mode has nowhere cheap
  to put them.
- **Crowds.** The browser game simulates about fifty cars. Here it will be a handful.
