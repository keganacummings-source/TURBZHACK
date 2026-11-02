# Where the art comes from

## Dungeon Crawl Stone Soup

Sprites prefixed `dcss-`, `wpn-`, `arm-` and `itm-` are reduced to 16x16
from Crawl's tile SOURCES — the individual named files under
`crawl-ref/source/rltiles/`, not the packed atlases the game ships, which
cannot be sliced on a grid.

RLTiles, the tileset Crawl's art is built on, is public domain. The majority
of Crawl's own additions are CC0; its LICENSE notes the situation "may be
complex, especially for older pieces" and points at
<https://github.com/crawl/tiles>. The table below records the exact source
file for each sprite so any one of them can be checked.

No DCSS *code* is used in this project. Crawl's engine is GPL-2.0-or-later;
this engine is written from scratch and shares nothing with it.

| sprite | source file |
|---|---|
| `arm-boots` | `rltiles/item/armour/boots1.png` |
| `arm-buckler` | `rltiles/item/armour/shields/buckler1.png` |
| `arm-chain-mail` | `rltiles/item/armour/chain_mail1.png` |
| `arm-cloak` | `rltiles/item/armour/cloak1_leather.png` |
| `arm-gloves` | `rltiles/item/armour/glove1.png` |
| `arm-hat` | `rltiles/item/armour/headgear/hat1.png` |
| `arm-helm` | `rltiles/item/armour/headgear/helmet1.png` |
| `arm-leather` | `rltiles/item/armour/leather_armour1.png` |
| `arm-plate` | `rltiles/item/armour/plate1.png` |
| `arm-ring-mail` | `rltiles/item/armour/ring_mail1.png` |
| `arm-robe` | `rltiles/item/armour/robe1.png` |
| `arm-shield` | `rltiles/item/armour/shields/kite_shield1.png` |
| `dcss-floor-cobble` | `rltiles/dngn/floor/rect_gray0.png` |
| `dcss-floor-crypt` | `rltiles/dngn/floor/crypt0.png` |
| `dcss-floor-dirt` | `rltiles/dngn/floor/dirt0.png` |
| `dcss-floor-grass` | `rltiles/dngn/floor/grass/grass-dark0.png` |
| `dcss-floor-ice` | `rltiles/dngn/floor/ice0.png` |
| `dcss-floor-lair` | `rltiles/dngn/floor/lair0.png` |
| `dcss-floor-marble` | `rltiles/dngn/floor/marble_floor1.png` |
| `dcss-floor-sand` | `rltiles/dngn/floor/sand1.png` |
| `dcss-floor-volcanic` | `rltiles/dngn/floor/volcanic_floor0.png` |
| `dcss-wall-brick` | `rltiles/dngn/wall/brick_brown0.png` |
| `dcss-wall-crypt` | `rltiles/dngn/wall/crypt0.png` |
| `dcss-wall-ice` | `rltiles/dngn/wall/ice_block0.png` |
| `dcss-wall-stone` | `rltiles/dngn/wall/stone_gray0.png` |
| `itm-amulet` | `rltiles/item/amulet/amethyst.png` |
| `itm-gold` | `rltiles/item/gold/01.png` |
| `itm-potion` | `rltiles/item/potion/brilliant_blue.png` |
| `itm-potion-2` | `rltiles/item/potion/emerald.png` |
| `itm-potion-3` | `rltiles/item/potion/ruby.png` |
| `itm-ring` | `rltiles/item/ring/agate.png` |
| `itm-scroll` | `rltiles/item/scroll/i-blinking.png` |
| `itm-wand` | `rltiles/item/wand/gem_brass.png` |
| `wpn-axe` | `rltiles/item/weapon/war_axe1.png` |
| `wpn-club` | `rltiles/item/weapon/club.png` |
| `wpn-crossbow` | `rltiles/item/weapon/ranged/arbalest1.png` |
| `wpn-dagger` | `rltiles/item/weapon/dagger.png` |
| `wpn-greatsword` | `rltiles/item/weapon/greatsword1.png` |
| `wpn-longsword` | `rltiles/item/weapon/long_sword1.png` |
| `wpn-mace` | `rltiles/item/weapon/mace1.png` |
| `wpn-morningstar` | `rltiles/item/weapon/morningstar1.png` |
| `wpn-spear` | `rltiles/item/weapon/spear1.png` |
| `wpn-staff` | `rltiles/item/weapon/quarterstaff.png` |
| `wpn-staff-magic` | `rltiles/item/weapon/staff.png` |
| `wpn-sword` | `rltiles/item/weapon/short_sword1.png` |
| `wpn-whip` | `rltiles/item/weapon/bullwhip.png` |

## TURBZ

Everything else is from TURBZ: the ground tiles via `tools/make-tiles.py`,
and the creatures and the Ruinmage via `tools/make-sprites.py`.

## Fonts

Press Start 2P and VT323 are SIL Open Font License, loaded from Google
Fonts. Drop `press-start-2p.woff2` and `vt323.woff2` into `assets/fonts/`
to make the game self-contained.
