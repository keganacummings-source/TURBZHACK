# TURBZHACK

A NetHack-like with the TURBZ look. A pregenerated continent you cross on foot,
procedural dungeons scattered across it to descend, and one turn at a time.

Every enemy, spell, class, enchantment, status and tile is **its own file**.
Adding one is writing a file — there is no registration step and no engine code
to touch. See [docs/MODDING.md](docs/MODDING.md).

## Running it

```bash
npm install        # typescript, and nothing else
npm run build:web  # tsc, index the content, stage it into dist-web/
npm run serve      # http://localhost:8099
```

While working on the game, `npm run build` alone is enough — `build:web` also
stages `dist-web/`, which is what the installer packages.

Open it in a browser and pick a class. `npm run serve` regenerates the content
index on every request, so adding an enemy file is: save it, reload.

> Opening `index.html` straight off disk will not work — browsers refuse to
> `fetch` the content folder from a `file://` page. Use `npm run serve`.

## The Windows .exe

Push a tag and GitHub Actions builds it:

```bash
git tag v0.1.0 && git push --tags
```

The workflow runs the tests, builds the web game into `dist-web/`, wraps that
with Tauri and attaches the installer to a release. It is the same code either
way — the native shell only opens a window and points it at the game.

`dist-web/` exists because Tauri bundles whatever `frontendDist` points at, and
pointing it at the repository root is refused: it would pack `node_modules` and
Tauri's own `target/` into the installer. `scripts/package.test.mts` checks that
and the icon set locally, so a packaging mistake fails in seconds rather than
ten minutes into a Windows runner.

## Playing

Arrow keys, `hjklyubn`, or the numpad. **Walk into a creature to attack it.**
Walk onto a dungeon mouth or a staircase to use it.

| | |
|---|---|
| `z` | Punch — 5 damage, free |
| `x` | Kick — 10 damage, 25 stamina |
| `c` | Staff strike — 8 damage, 10 stamina |
| `i` | Pack and gear |
| `g` | Pick up what you are standing on |
| `1` `2` `3` | Cast a spell |
| `.` or space | Wait a turn |
| `m` | Overview map, showing only what you have seen |
| `t` | Texture designer |
| `?` | Keys |

## The rules

| | |
|---|---|
| Base stats | 100 HP, 100 stamina, 50 mana |
| Stamina | +25 every turn, to everyone |
| Health | nothing for 10 turns after being hurt, then it comes back |
| Moving | one turn, eight directions |
| Burning | a quarter of the hit that lit you, every turn, through armour |
| Frozen | cannot act, even chance to break out each turn |

The world only moves when you do. A refused action — walking into a wall,
casting with no mana — does not pass the turn to the monsters.

Every one of those numbers is a test in `scripts/rules.test.mts`, and most of
them live in a content file you can change.

### The Ruinmage

One class, and it is the only one. 90 HP, 80 stamina, 120 mana, and a spell
list of exactly two: **Spark** and **Frost Touch**. Everything else you take
from the world.

### Gear

Weapons, armour, rings and amulets lie about the world and come off the things
you kill. Ten slots — weapon, off-hand, body, head, hands, feet, cloak, two
rings, amulet — and almost everything is a trade:

| | |
|---|---|
| Plate Armour | +12 armour, −10% dodge, −5% hit, −3 focus |
| Greatsword | 20 damage, −6% hit, −3% dodge |
| Ruin Staff | 9 damage, +5 focus |

**What you are holding is what you swing.** Walking into something attacks it
with the weapon in your hand, or your fist if it is empty.

`i` opens the pack. Totals are recomputed from scratch every time anything
changes, so taking a sword off can never leave part of it behind.

### Levelling

Kill things, earn experience, and every level **rolls five options and you take
one**. Some are spells you do not know yet; some are permanent upgrades to your
own numbers. Two runs of the same class end up nothing alike, which is the
point of there only being one.

| stat | what it does |
|---|---|
| **might** | added to every ability — punch, kick, staff |
| **focus** | added to every spell |
| **accuracy** | your chance to hit, before the target's evasion |
| **evasion** | subtracted from an attacker's accuracy |

Abilities roll to hit; **spells always land**. That split is why `accuracy` is
worth taking and why mana is worth spending.

The roll never offers a spell you already know, never repeats itself, and only
offers spells whose tier you have reached — so a level-2 roll is not full of
Firestorm, and a level-15 one is not full of Spark. It is also deterministic
from the seed, so there is nothing to reroll.

Both pools are content files: `content/spells/` and `content/upgrades/`.

## How it is built

No dependencies but TypeScript. No bundler, no framework, no runtime libraries.

```
src/engine/    rules: turns, combat, statuses, field of view, RNG
src/content/   the mod loader and its validation
src/world/     the continent and the dungeons
src/render/    canvas drawing
src/ui/        the browser shell and the texture designer
content/       every thing in the game, one file each
assets/tiles16 16x16 art
scripts/       tests — `node --test`, no framework
src-tauri/     the native shell: a window, and nothing else
tools/         dev server, content indexer, art pipeline
```

The engine never touches the DOM, which is why the tests can play whole runs
headlessly: start a class, walk, fight, descend, die.

```bash
npm test
```

### The art

**Terrain, creatures and the Ruinmage come from TURBZ.** **Weapons, armour and
items come from Dungeon Crawl Stone Soup.**

**Tiles** are the New Texture set reduced to 16×16 by box averaging —
nearest-neighbour threw away three pixels in four and turned the dithering to
noise.

**Creatures** are cut straight out of `creatures_roguelike.png`, which is
already a 16×16 grid, so they are the original pixels untouched. **The
Ruinmage** comes off `class_warriors.png`: the magenta key is removed, the
frame is cropped to what is actually drawn, and it is fitted into 16×16 by its
longest side so a tall robed figure stays tall.

```bash
python3 tools/make-tiles.py   ../TURBZ/public/MapAssets/NewTex assets/tiles16
python3 tools/make-sprites.py ../TURBZ/public/sprites          assets/tiles16

# DCSS needs its tile SOURCES, not the atlases the game ships — those are
# packed, so they cannot be sliced on a grid.
git clone --depth 1 --filter=blob:none --sparse https://github.com/crawl/crawl
cd crawl && git sparse-checkout set crawl-ref/source/rltiles && cd ..
python3 tools/import-dcss.py crawl/crawl-ref/source/rltiles assets/tiles16
```

All three are re-runnable, so when you redraw something you re-run them. Or
draw straight over any of it with the in-game designer on `t`.

RLTiles, which Crawl's art is built on, is public domain, and most of Crawl's
own additions are CC0 — but its LICENSE says the situation "may be complex for
older pieces", so [ATTRIBUTION.md](ATTRIBUTION.md) records the exact source
file behind every imported sprite. **No DCSS code is used anywhere here**;
Crawl's engine is GPL and this one shares nothing with it.

### The look

The palette and the two typefaces are TURBZ's: warm near-black, bone text, gold
for anything that matters, blood red for anything that hurts. Press Start 2P
and VT323 load from Google Fonts. Without them the game falls back to the
system monospace and resizes itself to suit — which is what you will see
offline, and it is laid out to work.

To make it self-contained, drop `press-start-2p.woff2` and `vt323.woff2` into
`assets/fonts/` and add an `@font-face` for each at the top of
`src/ui/style.css`.
