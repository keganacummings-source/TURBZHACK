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

### The two classes

**Witch** — 80 HP, 80 stamina, 100 mana. Fire to break things down over time,
freeze to buy the turns you need. Punches when the mana runs out, and it will.

**Berserk** — 140 HP, 200 stamina, 10 mana. Enough stamina to kick every turn
for eight turns straight. The spell list is decoration.

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

The tiles are your TURBZ New Texture set reduced to 16×16 by box averaging —
nearest-neighbour threw away three pixels in four and turned the dithering to
noise. Re-run it whenever the source art changes:

```bash
python3 tools/make-tiles.py ../path-to/MapAssets/NewTex assets/tiles16
```

The creature and class sprites are placeholders drawn by
`tools/make-sprites.py`. Replace them one at a time with the in-game designer.
