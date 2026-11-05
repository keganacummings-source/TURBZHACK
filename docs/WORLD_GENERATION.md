# World generation

The overworld is generated in deterministic, named passes from the run seed:
landmass and climate fields, biome cleanup, ground/scenery, rivers, entrances,
villages, landmarks, and then a walkable road network. The continent keeps its
four-times-area dimensions. Climate noise is sampled at a larger scale and
small land-biome islands are smoothed, while coast and water shapes remain
separate.

Villages use larger bounded footprints and seeded green, crossroads, and market
layouts. Their existing trade-specific huts and stations remain usable. A
minimum-distance connection pass links the start and settlements over dry,
passable terrain without cutting diagonal corners through walls or water.

Each world also receives biome-appropriate ruins, watchtowers, shrines, and
waystations. Their ground tiles are ordinary terrain; some contain seeded items
stored in the game's normal loot/save system. Sites avoid villages and dungeon
entrances, and lair placement reserves their footprints. Discovered landmarks
appear in the world map's filter and feature index.

Dungeon room silhouettes vary among rectangular, chamfered, cross-shaped,
irregular cavern, and pillared layouts. The room centers and corridor graph stay
connected; the themed wall and floor tiles continue to use definitions already
in the game. The road tile likewise reuses the repository's dirt sprite. This
change imports no external art or audio.

The implementation was informed by public generation patterns in [Cataclysm:
DDA's overmap](https://github.com/CleverRaven/Cataclysm-DDA/blob/master/src/overmap.cpp),
[Dungeon Crawl Stone Soup's hyper-city layout](https://github.com/crawl/crawl/blob/b99354e34ec3aa7c24f045acec6bda2afd0b7eee/crawl-ref/source/dat/dlua/layout/hyper_city.lua),
and [Brogue CE's architect](https://github.com/tmewett/BrogueCE/blob/2241b429f5729264603bccef87ee8858646aa58a/src/brogue/Architect.c).
These are design references only; their source code and assets are not copied by
this generator update.
