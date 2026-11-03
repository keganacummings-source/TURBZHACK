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
| `itm-amulet` | `rltiles/item/amulet/amethyst.png` |
| `itm-dust` | `rltiles/item/misc/misc_phial.png` |
| `itm-gem` | `rltiles/item/gem/dungeon_found_whole.png` |
| `itm-gold` | `rltiles/item/gold/01.png` |
| `itm-herb` | `rltiles/item/food/grape.png` |
| `itm-hide` | `rltiles/item/armour/animal_skin1.png` |
| `itm-ingot` | `rltiles/item/misc/misc_crystal.png` |
| `itm-meal` | `rltiles/item/food/bread_ration.png` |
| `itm-mushroom` | `rltiles/mon/fungi_plants/fungus1.png` |
| `itm-ore` | `rltiles/item/misc/misc_stone.png` |
| `itm-potion` | `rltiles/item/potion/brilliant_blue.png` |
| `itm-potion-2` | `rltiles/item/potion/emerald.png` |
| `itm-potion-3` | `rltiles/item/potion/ruby.png` |
| `itm-ring` | `rltiles/item/ring/agate.png` |
| `itm-scroll` | `rltiles/item/scroll/i-blinking.png` |
| `itm-stone` | `rltiles/item/weapon/ranged/stone.png` |
| `itm-wand` | `rltiles/item/wand/gem_brass.png` |
| `itm-wood` | `rltiles/dngn/trees/tree_fall3.png` |
| `mon-acid-blob` | `rltiles/mon/amorphous/acid_blob.png` |
| `mon-adder` | `rltiles/mon/animals/adder.png` |
| `mon-air-elemental` | `rltiles/mon/nonliving/air_elemental.png` |
| `mon-ashmaw` | `rltiles/mon/unique/serpent_of_hell-geh.png` |
| `mon-azure-jelly` | `rltiles/mon/amorphous/azure_jelly.png` |
| `mon-balrug` | `rltiles/mon/demons/balrug.png` |
| `mon-basilisk` | `rltiles/mon/animals/basilisk.png` |
| `mon-bat` | `rltiles/mon/animals/bat.png` |
| `mon-big-kobold` | `rltiles/mon/humanoids/kobold_brigand.png` |
| `mon-black-bear` | `rltiles/mon/animals/black_bear.png` |
| `mon-black-mamba` | `rltiles/mon/animals/black_mamba.png` |
| `mon-centaur` | `rltiles/mon/demihumanoids/taurs/centaur.png` |
| `mon-crimson-imp` | `rltiles/mon/demons/crimson_imp.png` |
| `mon-crocodile` | `rltiles/mon/animals/crocodile.png` |
| `mon-death-yak` | `rltiles/mon/animals/death_yak.png` |
| `mon-deep-troll` | `rltiles/mon/humanoids/deep_troll.png` |
| `mon-earth-elemental` | `rltiles/mon/nonliving/earth_elemental.png` |
| `mon-fire-elemental` | `rltiles/mon/nonliving/fire_elemental.png` |
| `mon-floating-eye` | `rltiles/mon/eyes/glass_eye.png` |
| `mon-gargoyle` | `rltiles/mon/nonliving/gargoyle.png` |
| `mon-ghoul` | `rltiles/mon/undead/ghoul.png` |
| `mon-gnoll` | `rltiles/mon/humanoids/gnoll.png` |
| `mon-goblin` | `rltiles/mon/humanoids/goblin.png` |
| `mon-hellion` | `rltiles/mon/demons/hellion.png` |
| `mon-hoarmother` | `rltiles/mon/unique/antaeus.png` |
| `mon-hobgoblin` | `rltiles/mon/humanoids/hobgoblin.png` |
| `mon-hog` | `rltiles/mon/animals/hog.png` |
| `mon-hollow-choir` | `rltiles/mon/unique/mnoleg.png` |
| `mon-hornet` | `rltiles/mon/animals/hornet.png` |
| `mon-hydra` | `rltiles/mon/undead/draugr/draugr_hydra4.png` |
| `mon-ice-beast` | `rltiles/mon/animals/ice_beast.png` |
| `mon-jackal` | `rltiles/mon/animals/jackal.png` |
| `mon-jelly` | `rltiles/mon/amorphous/jelly.png` |
| `mon-kobold` | `rltiles/mon/humanoids/kobold.png` |
| `mon-lich` | `rltiles/mon/undead/lich.png` |
| `mon-manticore` | `rltiles/mon/animals/manticore.png` |
| `mon-mother-of-dust` | `rltiles/mon/unique/khufu.png` |
| `mon-mummy` | `rltiles/mon/undead/mummy.png` |
| `mon-ogre` | `rltiles/mon/humanoids/ogre.png` |
| `mon-oklob-plant` | `rltiles/mon/fungi_plants/oklob_plant.png` |
| `mon-ooze` | `rltiles/mon/amorphous/rockslime.png` |
| `mon-orc` | `rltiles/mon/humanoids/orcs/orc.png` |
| `mon-orc-knight` | `rltiles/mon/humanoids/orcs/orc_knight.png` |
| `mon-orc-priest` | `rltiles/mon/humanoids/orcs/orc_priest.png` |
| `mon-orc-warrior` | `rltiles/mon/humanoids/orcs/orc_warrior.png` |
| `mon-phantom` | `rltiles/mon/undead/phantom.png` |
| `mon-polar-bear` | `rltiles/mon/animals/polar_bear.png` |
| `mon-rakshasa` | `rltiles/mon/demons/rakshasa.png` |
| `mon-rat` | `rltiles/mon/animals/rat.png` |
| `mon-redback` | `rltiles/mon/animals/redback.png` |
| `mon-river-rat` | `rltiles/mon/animals/green_rat.png` |
| `mon-sallowdeep` | `rltiles/mon/unique/tiamat_green.png` |
| `mon-scorpion` | `rltiles/mon/animals/scorpion.png` |
| `mon-shadow` | `rltiles/mon/undead/shadowghast.png` |
| `mon-shadow-imp` | `rltiles/mon/demons/shadow_imp.png` |
| `mon-skeleton` | `rltiles/mon/undead/draugr/draugr_humanoid_medium.png` |
| `mon-stonefather-urn` | `rltiles/mon/humanoids/giants/stone_giant.png` |
| `mon-troll` | `rltiles/mon/humanoids/troll.png` |
| `mon-two-headed-ogre` | `rltiles/mon/humanoids/two_headed_ogre.png` |
| `mon-ugly-thing` | `rltiles/mon/aberrations/ugly_thing.png` |
| `mon-vampire` | `rltiles/mon/undead/vampire.png` |
| `mon-vampire-bat` | `rltiles/mon/animals/vampire_bat.png` |
| `mon-wandering-mushroom` | `rltiles/mon/fungi_plants/wandering_mushroom.png` |
| `mon-warg` | `rltiles/mon/animals/warg.png` |
| `mon-white-imp` | `rltiles/mon/demons/white_imp.png` |
| `mon-wight` | `rltiles/mon/undead/wight.png` |
| `mon-wolf` | `rltiles/mon/animals/wolf.png` |
| `mon-wolf-spider` | `rltiles/mon/animals/wolf_spider.png` |
| `mon-wraith` | `rltiles/mon/undead/wraith.png` |
| `mon-yak` | `rltiles/mon/animals/yak.png` |
| `mon-ynoxinul` | `rltiles/mon/demons/ynoxinul.png` |
| `mon-zombie` | `rltiles/mon/undead/zombies/zombie_human.png` |
| `ovl-body-leather` | `rltiles/player/body/leather_armour.png` |
| `ovl-body-mail` | `rltiles/player/body/chainmail.png` |
| `ovl-body-plate` | `rltiles/player/body/bplate_metal1.png` |
| `ovl-body-robe` | `rltiles/player/body/robe_black.png` |
| `ovl-cloak` | `rltiles/player/cloak/brown.png` |
| `ovl-feet` | `rltiles/player/boots/mesh_black.png` |
| `ovl-hands` | `rltiles/player/gloves/glove_black.png` |
| `ovl-head-cap` | `rltiles/player/head/cap_black1.png` |
| `ovl-head-helm` | `rltiles/player/head/fhelm_gray3.png` |
| `ovl-shield` | `rltiles/player/hand2/kite_shield_kite1.png` |
| `ovl-weapon-axe` | `rltiles/player/hand1/war_axe.png` |
| `ovl-weapon-bow` | `rltiles/player/hand1/bow.png` |
| `ovl-weapon-dagger` | `rltiles/player/hand1/dagger.png` |
| `ovl-weapon-mace` | `rltiles/player/hand1/mace.png` |
| `ovl-weapon-polearm` | `rltiles/player/hand1/spear.png` |
| `ovl-weapon-staff` | `rltiles/player/hand1/quarterstaff.png` |
| `ovl-weapon-sword` | `rltiles/player/hand1/long_sword_slant.png` |
| `pc-coglin` | `rltiles/player/base/coglin.png` |
| `pc-deep-elf` | `rltiles/player/base/deep_elf_m.png` |
| `pc-demonspawn` | `rltiles/player/base/demonspawn_red_m.png` |
| `pc-draconian` | `rltiles/player/base/draconian_red.png` |
| `pc-formicid` | `rltiles/player/base/formicid.png` |
| `pc-gargoyle` | `rltiles/player/base/gargoyle_m.png` |
| `pc-ghoul` | `rltiles/player/base/ghoul_m.png` |
| `pc-gnoll` | `rltiles/player/base/gnoll_m.png` |
| `pc-hill-orc` | `rltiles/player/base/orc_m.png` |
| `pc-human` | `rltiles/player/base/human_m.png` |
| `pc-kobold` | `rltiles/player/base/kobold_m.png` |
| `pc-merfolk` | `rltiles/player/base/merfolk_m.png` |
| `pc-minotaur` | `rltiles/player/base/minotaur_m.png` |
| `pc-mummy` | `rltiles/player/base/mummy_m.png` |
| `pc-naga` | `rltiles/player/base/naga_green_m.png` |
| `pc-octopode` | `rltiles/player/base/octopode1.png` |
| `pc-oni` | `rltiles/player/base/oni_red_m.png` |
| `pc-revenant` | `rltiles/player/base/revenant.png` |
| `pc-spriggan` | `rltiles/player/base/spriggan_m.png` |
| `pc-tengu` | `rltiles/player/base/tengu_winged_m.png` |
| `pc-troll` | `rltiles/player/base/troll_m.png` |
| `pc-vine-stalker` | `rltiles/player/base/vine_stalker_green_m.png` |
| `t-ash` | `rltiles/dngn/floor/tomb0.png` |
| `t-bench` | `rltiles/dngn/shops/shop_general.png` |
| `t-campfire` | `rltiles/dngn/altars/makhleb_flame4.png` |
| `t-clay` | `rltiles/dngn/floor/limestone0.png` |
| `t-deep-water` | `rltiles/dngn/water/deep_water.png` |
| `t-dirt` | `rltiles/dngn/floor/dirt0.png` |
| `t-dungeon-door` | `rltiles/dngn/gateways/enter.png over dngn/floor/white_marble0.png` |
| `t-flagstone` | `rltiles/dngn/floor/limestone6.png` |
| `t-forge` | `rltiles/dngn/shops/shop_armour.png` |
| `t-grass` | `rltiles/dngn/floor/grass/grass0.png` |
| `t-grass-dry` | `rltiles/dngn/floor/sandstone_floor0.png` |
| `t-ice` | `rltiles/dngn/floor/icy_floor0.png` |
| `t-lava` | `rltiles/dngn/floor/lava00.png` |
| `t-marble` | `rltiles/dngn/floor/white_marble1.png` |
| `t-moss` | `rltiles/dngn/floor/moss0.png` |
| `t-mushroom` | `rltiles/mon/fungi_plants/fungus3.png` |
| `t-ore` | `rltiles/dngn/wall/crystal_wall01.png` |
| `t-sand` | `rltiles/dngn/floor/sand1.png` |
| `t-snow` | `rltiles/dngn/floor/salt3.png` |
| `t-stairs-down` | `rltiles/dngn/gateways/stone_stairs_down.png over dngn/floor/white_marble0.png` |
| `t-stairs-up` | `rltiles/dngn/gateways/stone_stairs_up.png over dngn/floor/white_marble0.png` |
| `t-stone` | `rltiles/dngn/floor/white_marble0.png` |
| `t-swamp` | `rltiles/dngn/floor/bog_green0.png` |
| `t-tree` | `rltiles/dngn/trees/tree1.png` |
| `t-tree-snow` | `rltiles/dngn/trees/tree_petrified1.png` |
| `t-voidgrass` | `rltiles/dngn/floor/crystal0.png` |
| `t-wall-clay` | `rltiles/dngn/wall/sandstone_wall0.png` |
| `t-wall-crypt` | `rltiles/dngn/wall/catacombs0.png` |
| `t-wall-hell` | `rltiles/dngn/wall/hell01.png` |
| `t-wall-marble` | `rltiles/dngn/wall/marble_wall1.png` |
| `t-wall-snow` | `rltiles/dngn/wall/ice_block0.png` |
| `t-wall-stone` | `rltiles/dngn/wall/stone_gray0.png` |
| `t-wall-wood` | `rltiles/dngn/wall/brick_brown0.png` |
| `t-water` | `rltiles/dngn/water/shallow_water.png` |
| `wpn-axe` | `rltiles/item/weapon/war_axe1.png` |
| `wpn-club` | `rltiles/item/weapon/club.png` |
| `wpn-crossbow` | `rltiles/item/weapon/ranged/arbalest1.png` |
| `wpn-dagger` | `rltiles/item/weapon/dagger.png` |
| `wpn-greatsword` | `rltiles/item/weapon/greatsword1.png` |
| `wpn-longsword` | `rltiles/item/weapon/long_sword1.png` |
| `wpn-mace` | `rltiles/item/weapon/mace1.png` |
| `wpn-morningstar` | `rltiles/item/weapon/morningstar1.png` |
| `wpn-pickaxe` | `rltiles/item/weapon/war_axe1.png` |
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
