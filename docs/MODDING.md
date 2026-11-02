# Adding things to TURBZHACK

Everything in this game is a file. There is no registration step, no list to
add your thing to, and no engine code to touch. Drop a file in the right folder
and it is in the game.

```
content/
  classes/      who you can be
  enemies/      what lives out there
  spells/       what costs mana
  abilities/    what costs stamina (punch and kick live here)
  statuses/     burning, frozen, and whatever you invent
  enchantments/ lasting modifiers on a thing
  items/        what you can carry
  tiles/        what the ground is made of
```

**The file name is the id.** `content/enemies/goblin.json` is the goblin, and
other files refer to it as `"goblin"`. You can override that with an explicit
`"id"`, but you almost never want to.

After adding a file, run `node tools/index-content.mjs content` — or just use
`npm run serve`, which does it on every reload. (A web page cannot list a
folder, so the loader needs an index. That is the only reason it exists.)

---

## Your first enemy

`content/enemies/bog-lurker.json`:

```json
{
  "name": "Bog Lurker",
  "about": "Waits in the water with only its eyes showing.",
  "pools": { "hp": -40, "mana": -50 },
  "armour": 2,
  "resist": { "cold": 0.5, "fire": 1.5 },
  "ai": "melee",
  "speed": 90,
  "sight": 5,
  "abilities": ["slash"],
  "biomes": ["swamp"],
  "depth": { "min": 0, "max": 4 },
  "weight": 15,
  "xp": 22
}
```

That is the whole thing. Reload and bog lurkers are in the mires.

Every number is optional except `name`. `pools` is **added to the base**
100 HP / 100 stamina / 50 mana, so `-40` means 60 HP. Leave out `biomes` and it
can appear anywhere its depth allows.

`ai` is one of:

| | |
|---|---|
| `melee` | closes the distance and hits you. The default. |
| `caster` | keeps its distance and casts |
| `wander` | ignores you unless you hit it |
| `skittish` | runs away |

`speed` is energy per turn against your 100 — 140 acts about half again as
often as you, 60 rather less than once.

---

## Your first spell

`content/spells/shock.json`:

```json
{
  "name": "Shock",
  "mana": 9,
  "damage": 14,
  "kind": "shock",
  "range": 5,
  "target": "beam",
  "applies": ["stunned"],
  "cooldown": 2,
  "say": "{caster} lets go a crack of lightning."
}
```

`target` is `actor` (one creature), `self`, `beam` (everything in a line), or
`burst` (everything within `radius` of the target).

`kind` decides what resists it: `physical`, `fire`, `cold`, `shock`, `poison`,
`pure`. A creature's `resist` is a multiplier — `0` is immune, `0.5` halves it,
`2` doubles it, and anything not listed is `1`.

To give it to the Witch, add `"shock"` to her `spells` list in
`content/classes/witch.json`.

---

## Your first status

Statuses are what make a spell more than a number. `content/statuses/stunned.json`:

```json
{
  "name": "Stunned",
  "turns": 2,
  "preventsAction": true,
  "breakChance": 0.35,
  "messages": {
    "applied": "{name} reels!",
    "broke": "{name} shakes it off.",
    "ended": "{name} recovers."
  }
}
```

A status can do three things, in any combination:

- **stop the bearer acting** — `preventsAction`
- **damage it every turn** — `tick`
- **change its stats** — `modify`, for `armour` and `speed`

`breakChance` is rolled at the start of each of the bearer's turns, *before*
the duration counts down, so a status can end on the turn it was applied.

### How `tick` scales

This is the one piece worth understanding properly. Burning is defined as:

```json
"tick": { "kind": "fire", "percent": 0.25, "of": "sourceDamage" }
```

`of` is what the percentage is taken from:

| `of` | meaning |
|---|---|
| `sourceDamage` | a quarter of **the hit that caused it** — the default |
| `maxHp` | a quarter of the victim's maximum health |
| `currentHp` | a quarter of what it has left |

Use `"amount": 6` instead for a flat number. Ticks ignore armour, because the
fire is already inside.

---

## Your first class

`content/classes/warden.json`:

```json
{
  "name": "Warden",
  "blurb": "Slow, heavy, and very hard to put down.",
  "pools": { "hp": 60, "stamina": 20, "mana": -30 },
  "armour": 6,
  "resist": { "physical": 0.7 },
  "spells": [],
  "abilities": ["punch", "kick"],
  "items": ["hide-wrap"]
}
```

It appears on the class-select screen immediately.

---

## Drawing it

Press **`t`** in game for the texture designer. Draw your 16×16 sprite, name it
after the `sprite` in your content file (which defaults to the id), download the
PNG, and put it in `assets/tiles16/`.

Until you draw it, the game shows a flat colour derived from the name — on
purpose, so you can see at a glance what still needs art.

To edit an existing sprite, type its name and press **Load existing**.

---

## When something is wrong

Nothing fails silently. A broken file is skipped, the rest of the game still
loads, and you get a screen naming the file and the field:

```
[error] base:content/enemies/bog-lurker.json: "speed" is 0, which is outside 1..Infinity
[warn]  base:content/classes/witch.json: "spells" points at "shock", which is not a file in content/spells/
```

An **error** means that file was skipped. A **warn** means it loaded but
something it refers to is missing — usually a typo, or a file you have not
written yet.

`npm test` checks the whole content folder the same way, so you can catch it
before you even open the game.

---

## Replacing something instead of adding to it

Content sources are layered, and later ones win on id. A mod folder that
contains its own `enemies/goblin.json` replaces the base goblin entirely,
without touching the original file. Point the loader at it in
`src/ui/app.ts`:

```ts
const reg = await loadContent([
  { base: "content", name: "base" },
  { base: "mods/harder", name: "harder" },
]);
```

## Turning something off without deleting it

```json
{ "name": "Goblin", "enabled": false }
```

It stays in your folder and stays out of the game.

---

## Your first upgrade

Level-ups offer spells *and* permanent stat upgrades, and both come out of
content files. `content/upgrades/keen-eye.json`:

```json
{
  "name": "Keen Eye",
  "about": "You see the opening before it opens.",
  "modify": { "accuracy": 8, "evasion": 2 },
  "weight": 9
}
```

`modify` can raise any of `might`, `focus`, `accuracy`, `evasion`, `armour`,
`hpMax`, `staminaMax`, `manaMax`. Values are **added**, so negatives make a
trade — `{"focus": 7, "hpMax": -15}` is a real option in the base game.

`weight` is relative commonness in the roll; 10 is the default.

## Spell tiers

A spell's `tier` (1–5) decides how early it can be offered. Tier 1 shows up
from level 1, and each further tier unlocks every three levels, so:

| tier | first offered around |
|---|---|
| 1 | level 1 |
| 2 | level 4 |
| 3 | level 7 |
| 4 | level 10 |
| 5 | level 13 |

Leave it out and it defaults to 1. A spell with a tier above 5 can never be
offered at all, which `npm test` will tell you about.

## Writing a `say` line

The player is called "You" and everything else is named, so one template has to
serve both persons. Put the verb's ending in a token:

```json
"say": "{caster} punch{es} {target}."
```

gives *"You punch Wolf."* and *"Goblin punches you."* Use `{s}` for verbs that
take a plain s — `bite{s}`, `hurl{s}` — and `{es}` for the rest. There is a
test that every `say` in the content folder has one, because without it you get
"You punches Goblin."
