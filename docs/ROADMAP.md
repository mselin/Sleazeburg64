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
  time to spare (`src/people.asm`). The player's car going 30 pixels a second or more runs someone over: they lie
  flat in the design's knocked-down picture for four seconds, then are gone (no stain, which the city's characters
  cannot show, and no heat yet). They cross roads now and then (one time in ten when they pick a way), traffic stops
  for anyone on the road ahead of it, and cars are solid for them (below). Punches are in: with no gun yet the game starts
  with no ammo, fire on foot knocks down the passer-by in front (7 pixels ahead, within 7), who lies four seconds,
  then gets up and runs from the player for two seconds at twice their pace, as does anyone within 60. Still to
  come: the player's arm-out picture for a punch (sprite room), heat for it, the gun and knife, scooter riders
  and the police. The design draws people about 12 pixels across in
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
  - **Cars are solid for people on foot** (mselin/gta-c64#38; done for passers-by: the player and the police
    to come). The browser game let people walk through a
    stopped car and scooter riders ride through one. Now a car's body, its length and width turned with it,
    stops anyone on foot. A passer-by stops just short of it, waits 0.4 seconds, then steps sideways round its
    nearer end and carries on; with no way round, or after 3 seconds, they turn another way. The police and
    anyone fleeing go round the same way, the player slides along a car's side, and someone a car has stopped
    on can walk out from under it, but never into another car or a wall. See "Cars are solid for anyone on
    foot" in the design's
    [People on foot](https://github.com/mselin/gta-c64/blob/main/specs/design.md#people-on-foot). With five
    cars and four people here, that is at most twenty boxes to test a frame. On the C64 the passers-by test the
    traffic's boxes (traffic.bump's, 3 pixels larger for their feet) and a square round the player's car, and
    each walks every other frame, two frames' worth at a time, to keep within the frame time.
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
- Cursed driver assistance (#61), by the design's
  [Cursed driver assistance](https://github.com/mselin/gta-c64/blob/main/specs/design.md#cursed-driver-assistance)
  (mselin/gta-c64#42). Some cars have lane assist that now and then takes the wheel and swerves
  (`CURSED LANE ASSIST TOOK OVER`), emergency braking that stops for people and cars on the move every time but
  for things standing still only 35 % of the time (`EMERGENCY BRAKING ENGAGED`), or anti-theft. It works only
  while the player drives. Here each is a bit a car, set from `rnd` when the car appears, and the times are frames.
  - **Which cars.** Each car rolls for each of the three on its own when it appears: lane assist 20 %, emergency
    braking 25 %, anti-theft 20 %, sports cars twice as often. As random bytes: under 51, 64 and 51, or 102, 128
    and 102 for a sports car. Never the job's limo, nor the first car beside the hospital, so the first car the
    player takes is clean; never anti-theft in a police car. Nothing shows which a car has until it acts.
  - **Cursed lane assist.** After 6 to 14 seconds (300 to 700 frames, from `rnd`) of driving faster than 50 px/s
    (1 pixel a frame), it takes the wheel for 0.8 seconds (40 frames): hard one way, then every 10 frames hard one
    way or the other, changing its mind 2 times in 3 (a random byte under 171). Meanwhile the stick's left and
    right do nothing; up, down and fire still work. In `src/car.asm` that is `update` taking `turn` from the
    assist rather than the stick, so the swerve is held to the grip like any steering: flat out it is a sharp
    wiggle, not a spin. `CURSED LANE ASSIST TOOK OVER` is 28 characters, and a chime goes with it once there is
    sound.
  - **Emergency braking.** It looks out only from 154 (30 px/s), the speed `people.RUN_OVER` runs someone over
    at, so below it nobody can be hurt and there is nothing to look for. It looks as far ahead as the car needs
    to stop braking half as hard again as its own brakes (60 where `BRAKE` is 40), with 3 frames to notice and 4
    pixels to spare: flat out, at 4 pixels a frame, about 50 pixels. That is a table by speed, not a sum.
    - **What it looks at:** the few people about, each within the run-over distance (and a pixel) of the line
      the car drives along, which is two multiplications each with `cs`, the car's cosine and sine; the other
      cars' bodies; and walls, a character at a time, as walls are whole characters.
    - **What it sees:** people and cars on the move every time, and things standing still (parked cars and
      wrecks, someone lying down) only 35 % of the time: a random byte under 90, decided once for each thing.
      It keeps the slot it decided for until nothing has been ahead for 50 frames.
    - **Seen:** the car brakes at 60, whatever the stick says, until the way has been clear for 15 frames or it
      is down to 26, where down stops meaning brake (`BRAKING`).
    - In a frame that works out colour memory, which has the least time to spare, it can keep the last frame's
      answer, as the car already does for turning its picture. `EMERGENCY BRAKING ENGAGED` is 25 characters;
      three quick beeps go with it once there is sound.
  - **Anti-theft devices.** After 10 to 25 seconds with the player at the wheel, it stops the car for good. Never
    in a police car, once there are police.
    - **The time** counts only while the player drives the car, and does not start again when they get back in.
      In steps of 8 frames it is 63 to 156, so it fits a byte.
    - **Stopped for good:** the throttle does nothing, and down is held for the player until the car is under
      `BRAKING` (26). The stick still steers while it rolls. Once there is sound, the engine note stops too.
    - **The messages:** `ANTI-THEFT ENGAGED: ENGINE IMMOBILISED` (38 characters, inside row 3's 40). Getting back
      in, `THE IMMOBILISER SAYS NO`, and it still will not go.
    - **What travels with the car.** A car the player takes leaves the traffic's tables with its place, picture,
      speed and colour (`src/foot.asm`). Its assist bits go with those, as do a fourth bit for "stopped for good"
      and the byte of time left, and they go back into the tables when the player gets out. A stopped car stays
      in the place the tables keep for the player's last car, however far they go, as any car they leave does,
      until they leave another.
    - **The alarm** sounds for 20 seconds after it stops the car: a high note and a low one in turn, 12 or 13
      frames each, quieter the further away the player is. It takes a SID voice that long, so it waits for sound
      (milestone 4). With one voice there is one alarm: a second car stopped while the first still sounds takes
      it over.
    - **The lights.** The browser game flashes four hazard lights at the car's corners with the high note. Here,
      lit corners on the car's picture would double its frames in every direction. Flashing the car's own sprite
      colour yellow (7) instead costs no frames.
- Jobs, starting with deliveries and the cult of 6-7.
- Pickups, money, getting arrested, the hospital. Pickups include the knife (a **K**, also dropped now and then
  by someone the player kills), and ammo stops at 99 so the panel always shows two digits.
  - **Never where the player appears.** No pickup lies within 32 pixels of the hospital or the police station,
    where the player starts and comes back. Both sit between two tile middles, 8 pixels from each, and the
    browser game used to let a pickup land there and be taken the moment the player appeared, in about 1 game
    in 27 (mselin/gta-c64#33). See the design's
    [Pickups](https://github.com/mselin/gta-c64/blob/main/specs/design.md#pickups): what there is, how often,
    what each does and what people drop.
  - **As big as the city draws them** (mselin/gta-c64#40). Pickups and the job markers (J, P, X) are drawn at
    the city's scale, not the people's: a pickup is a square 8 city pixels across in its colour, with a black
    edge of 1 and its letter filling it, and a marker is a flashing square of 12 with its letter in a black
    middle of 10. For a while after the browser game drew the city 2×, it drew them their old size on screen,
    half as big beside the streets, and the markers lost their letter. The C64 version has one scale, so
    they are simply that size: about a character each, the edge spilling into the next. A letter in one
    colour on a square of another is two colours in one cell, which hires characters cannot do; how (multicolour
    characters, extended background colour or sprites) is the C64 version's choice.
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
  - **Tested in every engine.** The page's tests should run in Chromium, Firefox and WebKit (Safari's engine, and
    that of every browser on an iPhone), as the browser game's do (mselin/gta-c64#35). Its
    `tests/e2e/helpers.cjs` picks the engine from `SLEAZEBURG_BROWSER`. What that turned up, which applies
    here too:
    - Run them on macOS. It is the nearest CI has to Safari, and it has a sound device; on a Linux runner,
      Firefox's sound never starts.
    - Wait on the emulator's own clock, not on seconds. Headless browsers draw without a graphics card and run
      slow, so "hold the stick for half a second" is not the same distance everywhere.
    - WebKit's phone mode cannot go full screen, like an iPhone, and Firefox has no phone mode at all.
    - Real phones need a device cloud on top.
  - **An on-screen joystick of its own.** Once the emulator runs on our own page, phones need a joystick and a
    fire button on it. These parts of the browser game's touch spec apply as they stand:
    - targets at least 44 CSS pixels (FR-11);
    - full screen where the phone allows it (FR-13);
    - nothing over the game area on a phone held sideways (FR-15);
    - the turn-your-phone notice when held upright (FR-17).

    Steering by finger does not carry over: the game reads a joystick, and the page only stands in for one.
  - **Publishing it.** The play page goes up from the `pages` job in `.github/workflows/build.yml`, which gives
    the deploy three tries, as the browser game's does. When GitHub Pages fails all three, as in GitHub's outage
    of 25 November 2026, the deploy step says to re-run it later. A re-run used to upload the page a second time
    under the same name and then stop: "Multiple artifacts named github-pages were unexpectedly found"
    (mselin/gta-c64#44). The upload is now named after the run's attempt, here as in the browser game, so
    re-running the failed job works. Running the workflow afresh on main (Actions, Build and test, Run
    workflow) works too.

## What will not carry over from the browser game

- **The touch controls.** The browser game is played on a phone by holding a finger on the screen: you walk, or
  drive, towards it. Buttons fire, get in and out, and work the handbrake (`specs/touch-controls.md` there). A
  C64 is played with a joystick in port 2. On a phone, the play page opens VirtualC64 Web with its own on-screen
  joystick (`#touch=true`).

- **Choosing the scale.** The browser game draws the city 2 screen pixels to a city pixel by default, so that a
  person is nearer their real size beside a car, and lets the player switch between 1×, 2× and 3× (the design's
  [The scale](https://github.com/mselin/gta-c64/blob/main/specs/design.md#the-scale)). The C64 version has one
  scale, its own choice. At 2, cars would be expanded sprites and tiles 4 × 4 characters, but top speeds would
  halve at the same scroll rate. At 1, people stay as big as cars.

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
