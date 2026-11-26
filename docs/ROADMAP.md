# Roadmap

The plan is to prove the hard parts first. On a C64 those are smooth scrolling and getting enough moving
objects on screen, so the early milestones are about those and the game itself comes after.

Each item has a matching issue; this page is the overview.

The game's rules and look, with the numbers, are in the browser game's
[design document](https://github.com/mselin/gta-c64/blob/main/specs/design.md): the palette,
people, cars and walls, heat and the police, the title and the icon. The items below follow it, and its
"C64 notes" point out where the hardware forces a choice.

Each project stays in its own repository (.claude/CLAUDE.md, "Stay in this repository", #69). Notes on what changed in the
browser game come from its sessions when the owner asks, with links to the design document and the pull request.
How the C64 version does it is decided here. Where the design document is unclear, wrong or hard to follow on a
C64, that goes in an issue in mselin/gta-c64, and the browser game's sessions change it.

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
  - **Changed in the browser game: settling onto a street's line** (mselin/gta-c64#55, #87). A car someone is
    driving, let go of within about 11° of one of the eight ways (the axes and the diagonals), eases onto it and
    keeps to it, at most a sixth of its steering rate, so it reads as straightening up rather than a snap. The
    browser game also draws cars in 64 directions now. See "Settling on a straight line" under the design's
    [Handling](https://github.com/mselin/gta-c64/blob/main/specs/design.md#handling).

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
  - **Changed in the browser game: the driver of a car that is taken** (mselin/gta-c64#66) is thrown out at the
    door onto the ground, facing away from the car, and lies there as anyone knocked down does, 4 seconds, before
    getting up. A passer-by then runs from the player. The driver of a police car is a police officer, who
    carries on as the police do. The crime is the taking of the car, not a knock-down as well. See "Taking a car
    from its driver" under the design's
    [Cars](https://github.com/mselin/gta-c64/blob/main/specs/design.md#cars).
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
  then gets up and runs from the player for two seconds at twice their pace, as does anyone within 60. The player's
  arm goes out for 0.2 seconds with each punch, in eight frames drawn from the same figure, at `$0200` (the
  KERNAL's pages, unused once it is switched out). Punches, running people over and taking a car
  from its driver add heat (below). The knife and the gun are in (Pickups, below). Scooter riders are in:
  about one in seven of those who arrive (a random byte below 36), in light green, which no passer-by wears,
  at the scooter's speed (255/256 of a pixel a frame, 50 pixels a second, as near the design's 52 as a byte
  holds), standing on the deck the way they go in four frames of their own, and lying beside the scooter when
  knocked down; killed, they drop nothing (the design: they pay $0). The scooter is black, the design's grey
  being no colour a multicolour sprite has besides its own. Not yet: the design's "+$0 (PUBLIC SERVICE)",
  which the browser game floats over them. Still to come: the police. The design draws people about 12 pixels across in
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
  - **Changed in the browser game: skaters on classic** (mselin/gta-c64#89, #91). The riders on the pavements
    follow the difficulty (below, under Title screen): scooter riders on modern, skaters on classic. A skater has
    a light grey hoodie and stands side on across a cyan skateboard with black wheels, at 46 px/s. The two rider
    jobs, the news line and the title's greetings speak of skaters on classic. See "The riders" under
    "Difficulty" in the design's [Title screen and icon](https://github.com/mselin/gta-c64/blob/main/specs/design.md#title-screen-and-icon).
- Water: cars flood and sink, people swim (done, not yet tried on real hardware). The player's car wades,
  slower the deeper it is, floods once it is wholly in, and sinks in three colours, leaving the player swimming.
  It stops where it floods rather than drifting on, and it is out of the way from the moment it floods rather
  than once it is on the bottom. See the design's
  [Water](https://github.com/mselin/gta-c64/blob/main/specs/design.md#water).
  - **Fixed in the browser game:** getting out of the car in the very frame it floods stopped the game with an
    error, as the flood had already taken the player out of it. Now the player is simply left swimming
    (mselin/gta-c64#56).
  - **Changed in the browser game** (mselin/gta-c64#74):
    - Nobody shoots while swimming: the police in the water hold fire until they are out, as the player already
      could not shoot or fight there.
    - A fountain's water is its round pool, out to 13 pixels from its middle, just inside its black rim at 15.
      The corners of its 2 × 2 tiles outside the rim are plaza, so nobody swims on dry ground beside it.
    See "A fountain" under the design's
    [Water](https://github.com/mselin/gta-c64/blob/main/specs/design.md#water).
- Big Honk, the crime boss (done, not yet tried on real hardware): a goose who wanders The Moat, crossing a
  bridge now and then, and whom nothing hurts. A car that runs into him only makes him flap and run off. One
  multicolour sprite, shared through the multiplexer. Still to come: a honk when there is sound, and traffic
  stopping for him once it looks out for people.

## Milestone 3: the game

- Heat and police, by the design's rules: the heat levels and what each crime adds, the distances the police
  notice from, and the stolen police car (driving one where the police notice it raises the heat to 2).
  - **Heat** (started): points, kept in halves, at most 230; the levels from 8, 25, 60, 110 and 180, with their
    messages; it cools a level every 9 seconds with no police near, its points to that level's start, the time
    counted afresh with every crime (`status.add_heat`, `status.cooling`). The crimes the game has so far: a
    punch that lands 3, a stab or a kill 6, a shot 1.5, a car hit by one 1, taking a car from its driver 4.
    Still to come: ramming, and police cars (their crimes).
  - **The chase** (started, `src/police.asm`). With heat, up to min(5, heat) police cars, one every 2.2
    seconds: traffic cars marked in `police.cop`, white, at the fastest a traffic car goes (100 pixels a second
    where the design's do 188: a traffic car's speed is a byte), appearing where traffic does. While there is
    heat no other traffic appears: the traffic's five places are the police's. At a crossing a police car takes
    the way that closes the longer of its gaps to the player, across or down, else the other, else straight on;
    with no heat it drives as traffic does. A police car (not a wreck) within 150 pixels either way is near:
    then, with heat, the border flashes red and blue every 25 frames, and the heat does not cool. **Busted**
    (done): with heat, in a car slower than 12 pixels a second either way, a police car (not a wreck) within 24
    pixels either way, for 2 seconds on end. The police cars go, and the heat, the ammo, the knife and a fifth
    of the money; the car is left where it is; the player is on foot at the police station (where the browser
    game has it), with the message BUSTED. YOUR WEAPONS ARE NOW EVIDENCE (it cannot say how much was taken: the
    panel's messages are fixed). The frame it happens in draws the screen afresh and is late. With no game over
    yet, busted with no money changes nothing more. Still to come: officers on foot, the siren's sound, the
    stolen police car, patrol cars joining in (here every police car chases).
  - **The siren and the flashing border.** The border flashes red and blue (`$D020`, every 25 frames) only while
    the siren sounds: the police near, in play. It never flashes with nobody about, on the busted screen or
    while paused. The browser game got this wrong and kept flashing as long as there was any heat
    (mselin/gta-c64#18), so it is worth getting right from the start. See the design's "The siren".
  - **GAGGLE cameras** (mselin/gta-c64#53). The browser game now has surveillance cameras on poles at 17
    crossings. A crime one sees counts half again and brings the next police car at once. They also report
    speeding and fast driving on the pavement, and while one sees the player with heat, the heat does not cool.
    Ramming or shooting one sets off its alarm, which reports the tampering; then it goes dark until the city
    puts it back up. Each of these has its own status lines. See "GAGGLE cameras" under the design's
    [Heat and the police](https://github.com/mselin/gta-c64/blob/main/specs/design.md#heat-and-the-police).
  - **Changed in the browser game: the police helicopter** (mselin/gta-c64#83, #95). At heat 5 a police
    helicopter comes in from out of sight and follows the player over buildings and water, faster than any car, so
    it cannot be shaken off. It never lands, shoots or arrests: it lights the player up with a ring of yellow
    dots, and while it is overhead the heat does not cool. It leaves when the heat drops below 5 (the paint shop),
    and goes with the rest of the police when the player comes back from being wasted or busted. See "The police
    helicopter" under the design's [Heat and the police](https://github.com/mselin/gta-c64/blob/main/specs/design.md#heat-and-the-police).
  - **Changed in the browser game: the police and the pavement** (mselin/gta-c64#107). Driving faster than 15
    px/s on a pavement or plaza where a chasing car, a patrol car or an officer on foot notices the player is a
    crime of 4 points, at most every 3 seconds, with a line from the police ("OFFICER: THAT IS A SIDEWALK, NOT A
    SHORTCUT." and three more). See "The police and the pavement" under the same heading.
  - **Fixed in the browser game: the arrest count** (mselin/gta-c64#95). Boxed in (2 seconds) and an officer at
    the window (0.7 seconds) each have their own count, back to 0 the moment the player is free of it. One shared
    count that never went back used to leave a close escape a moment's touch from arrest. The design now
    describes the officer-at-the-window rule too.
  - **Changed in the browser game: the paint shop arrow** (mselin/gta-c64#80). With heat, at the wheel, a cyan
    arrow with an S at the edge of the view points to the paint shop, PAINT & PRAY, where the heat goes. The
    design now describes the paint shop itself as well. And the stolen police car's rise to heat 2 is no longer a
    crime a GAGGLE camera adds to (mselin/gta-c64#100).
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
  - **Changed in the browser game since:**
    - The car alarm has a status line, 7 seconds in, picked at random (mselin/gta-c64#50).
    - Emergency braking brakes to a full stop, even if the way clears; then the gas does nothing until the
      player lets go of it and presses again. It works reversing too, looking 1 car length behind, and going
      forward it looks at least 2 car lengths ahead (mselin/gta-c64#48).
    - Police cars never have lane assist or emergency braking, but every one has anti-theft, on the usual time,
      and a stolen police car's alarm says `CAR ALARM: WHAT DID YOU EXPECT?` (mselin/gta-c64#56). The notes
      above on which cars have what, and on emergency braking, were written before these changes.
    - Emergency braking comes to rest about 3 pixels short of what it brakes for, rather than a car length or two:
      it brakes no harder than it must, the faster the car the harder, measuring how far is left each frame
      (mselin/gta-c64#72).

    See the design's [Cursed driver assistance](https://github.com/mselin/gta-c64/blob/main/specs/design.md#cursed-driver-assistance).
  - **Changed in the browser game: modern only** (mselin/gta-c64#85). Cursed driver assistance, its car alarms
    and the GAGGLE cameras are now only on the modern difficulty; classic, where a visit starts, has none of them.
    See "Difficulty" under the design's [Title screen and icon](https://github.com/mselin/gta-c64/blob/main/specs/design.md#title-screen-and-icon).
- Jobs, starting with deliveries and the cult of 6-7.
- Pickups, money, getting arrested, the hospital. Pickups include the knife (a **K**, also dropped now and then
  by someone the player kills), and ammo stops at 99 so the panel always shows two digits.
  - **Pickups on the C64** (started, `src/pickups.asm`): twelve at once rather than the design's 34, the
    owner's choice for the frame time (34 made frames late on the long drive with traffic); each in the middle
    of a pavement, plaza or grass tile, never within 2 tiles of where the player starts (there is no hospital
    or police station yet), in the design's shares; taken within 11 pixels on foot or in the car, back 40 to
    70 seconds later somewhere else. Drawn as multicolour sprites through the multiplexer, bobbing a pixel: a
    12-pixel square in the kind's colour with a black edge and its letter in yellow or black, the shared
    sprite colours (the design's letter colours otherwise: a sprite has three). What each does is the design's;
    ammo only counts until there is a gun. With a knife, fire on foot is a stab, by the design's knife: the
    point 10 pixels ahead, one every 0.28 seconds, killing even someone already down, 6 heat (the arm goes out
    as for a punch: the blade's eight frames want sprite room there is not yet). Someone the player kills,
    run over or stabbed, drops cash 40 % of the time ($10 to $90) or a knife 8 % if the player has none,
    where they fell, for 20 seconds, blinking in the last 4: up to three at once (one more, with none free,
    is not dropped). A stab's reach is inside the pickup reach, so cash from a stab is in the player's
    pocket at once. With ammo, fire on foot is a shot, by the design's gun (`src/gun.asm`): one every 0.22
    seconds, a round less, 1.5 heat, and anyone within 110 runs for 4 seconds. The bullet, a 2 x 2 yellow
    sprite through the multiplexer, starts 5 pixels ahead and flies 4.8 pixels a frame for 0.55 seconds, three
    at most at once; it kills a passer-by within 3 pixels either way (6 heat, and what they drop), and is spent
    on a wall (not water) or on a car within 8 (1 heat). Out of ammo, fire is the knife or fists again. Not yet:
    the gun's frames (the arm goes out as for a punch), sparks, and a shot car's driver losing control.
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
  - **Changed in the browser game** (mselin/gta-c64#76): the police take the player's weapons, the knife and all
    the ammo, only when they are involved. They always do when they bust the player. They do when the player is
    wasted with the police about: a chasing car, a manned patrol car or an officer on foot who is not knocked
    down, within the distances they notice the player at. They do when an officer shoots the player dead, however
    far off. Wasted with no police about, in a crash or a car blowing up, the player keeps both. Before, the
    knife went however the player went down, and the ammo stayed whenever they were wasted. The busted line now
    ends YOUR WEAPONS ARE NOW "EVIDENCE", and when the police took them the hospital's ends THE POLICE KEPT YOUR
    WEAPONS AS "EVIDENCE". See "Wasted or busted" under the design's
    [Heat and the police](https://github.com/mselin/gta-c64/blob/main/specs/design.md#heat-and-the-police).
- The status panel (done, not yet tried on real hardware), by the design's
  [The status panel](https://github.com/mselin/gta-c64/blob/main/specs/design.md#the-status-panel), in place
  of the demo text (#44). Row 1: money, heat, health, the car while in one, and what fire does, `AMMO12`
  (two digits, as ammo stops at 99) or `KNIFE` or `FIST` in columns 34-39. Row 2: the job. Row 3: messages,
  or the election fund. The browser game's positions between character columns are rounded to whole ones,
  the car's bar is 24 pixels rather than 26, a message scrolls a character every 6 frames rather than 70
  pixels a second, and the part of a bar that is not filled is dark grey only in whole characters, as a
  character has one colour. Nothing changes the money, health or ammo yet (heat, above): what does sets
  `status.changed`, and row 1 is drawn again. The jobs (#9) fill row 2.
- Title screen, game-over and victory pictures.
  - **Changed in the browser game** (mselin/gta-c64#58): the title screen shows its text page for 10 seconds,
    then a sunset picture for 8, in turn: the owner's artwork with the SLEAZEBURG 64 logo, made C64-like, 320 ×
    180 in the 16 colours and double-wide pixels. The boot shows the same picture loading, a character row at a
    time while the border flashes, before READY. and RUN. See "The two pages" and "The boot" under the design's
    [Title screen and icon](https://github.com/mselin/gta-c64/blob/main/specs/design.md#title-screen-and-icon).
  - **The title page on the C64** (#11, `src/title-page.asm`): the game as shipped starts on the sunset
    picture, with PRESS FIRE TO COMMIT CRIMES blinking under it twice a second, until fire (held since the
    start, only once it has been let go). The browser game's picture (`assets/title-sunset.png`, a copy) is
    made a multicolour bitmap by `tools/picture.mjs`: 10 lines down a black screen, each 4 x 8 cell keeping
    black and its three most used colours (about 4 % of the pixels take the nearest of those), the text in
    the last character row in the font. It is packed, 8.8K, after the rest of the packed program file, and
    shown before anything is unpacked, from $c000 and $e000, which the game then writes over: it costs no
    memory in play. The owner chose this and a loading picture: `make` also writes a disk image,
    `build/sleazeburg64.d64`, whose first file, the loader (`src/loader.asm`), shows the same picture saying
    LOADING while the KERNAL loads the game, the second file, from the same drive. The web page still runs the
    `.prg` (its open-source ROMs cannot load a second file from a disk), and offers the disk to download. The browser game's text page and its taking turns with the picture are not
    copied: the C64's title page is the picture alone.
  - **Fixed in the browser game** (mselin/gta-c64#70): fire starts the game from the title screen, and fire
    also shoots, so a press still held when play began fired a shot at once, and the player started a bullet
    short. Now the press that starts the game is not a shot; fire shoots once let go of and pressed again.
  - **Changed in the browser game: the boot's pause** (mselin/gta-c64#78). Once the loading picture has all
    arrived, it stays 5 seconds before READY. and RUN and the title screen. See "The boot" under the design's
    [Title screen and icon](https://github.com/mselin/gta-c64/blob/main/specs/design.md#title-screen-and-icon).
  - **Changed in the browser game: a new picture** (mselin/gta-c64#105). The owner's new artwork: the car in it
    is now a purple supercar, which suits both difficulties. `assets/title-sunset.png` there is the new picture.
  - **Changed in the browser game: the difficulty** (mselin/gta-c64#85). The title screen has a setting, CLASSIC
    (where a visit starts) or MODERN, which D goes through on the title screen. More settings may come. Modern
    adds the cursed driver assistance, car alarms and GAGGLE cameras, and scooter riders instead of skaters. See
    "Difficulty" under the design's [Title screen and icon](https://github.com/mselin/gta-c64/blob/main/specs/design.md#title-screen-and-icon).

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
    - Later, in the browser game: tests that waited a fixed time for something to happen failed on slow
      runners, and now wait until it has (mselin/gta-c64#60). The handbrake test, driving down a street while
      random traffic appeared, failed now and then until it kept the street clear while it ran
      (mselin/gta-c64#64).
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
    (mselin/gta-c64#44, fixed in mselin/gta-c64#45). The upload is now named after the run's attempt, here as in the browser game, so
    re-running the failed job works. Running the workflow afresh on main (Actions, Build and test, Run
    workflow) works too.
  - **The browser game's icon is now the goose** (mselin/gta-c64#62): Big Honk in sunglasses and a gold chain on
    a sunset, in a circle, in the artwork's own colours, in place of the S. The play page's `site/index.html`
    names icons of its own, copies of the old S. See "Icon" under the design's
    [Title screen and icon](https://github.com/mselin/gta-c64/blob/main/specs/design.md#title-screen-and-icon).
  - **The title page on the C64** (#11, `src/title-page.asm`): the game as shipped starts on the sunset
    picture, with PRESS FIRE TO COMMIT CRIMES blinking under it twice a second, until fire (held since the
    start, only once it has been let go). The browser game's picture (`assets/title-sunset.png`, a copy) is
    made a multicolour bitmap by `tools/picture.mjs`: 10 lines down a black screen, each 4 x 8 cell keeping
    black and its three most used colours (about 4 % of the pixels take the nearest of those), the text in
    the last character row in the font. It is packed, 8.8K, after the rest of the packed program file, and
    shown before anything is unpacked, from $c000 and $e000, which the game then writes over: it costs no
    memory in play. The owner chose this and a loading picture: `make` also writes a disk image,
    `build/sleazeburg64.d64`, whose first file, the loader (`src/loader.asm`), shows the same picture saying
    LOADING while the KERNAL loads the game, the second file, from the same drive. The web page still runs the
    `.prg` (its open-source ROMs cannot load a second file from a disk), and offers the disk to download. The browser game's text page and its taking turns with the picture are not
    copied: the C64's title page is the picture alone.

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
