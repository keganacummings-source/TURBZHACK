"""
Pulls sprites out of Dungeon Crawl Stone Soup's tile SOURCES.

The first version of this sliced the shipped atlases (main.png, floor.png and
friends) on a 32x32 grid. That was wrong: the atlases are built by a packer, so
a cell boundary only lines up by accident, and every sprite came out with its
neighbours bleeding in around the edges.

The right source is `rltiles/` in the crawl repository — the individual tile
files the atlases are BUILT FROM, each one its own PNG with a real name:

    crawl-ref/source/rltiles/item/weapon/dagger.png
    crawl-ref/source/rltiles/item/armour/plate1.png
    crawl-ref/source/rltiles/dngn/floor/...

No slicing, no guessing, and the file name says what the thing is.

    git clone --depth 1 --filter=blob:none --sparse https://github.com/crawl/crawl
    cd crawl && git sparse-checkout set crawl-ref/source/rltiles

    python3 tools/import-dcss.py <.../rltiles> assets/tiles16

Everything is reduced to 16x16 by BOX averaging — nearest-neighbour throws away
three pixels in four and turns the dithering and outlines into noise. Items are
cropped to their own content first and fitted by the longest side, so a tall
sword stays tall instead of being squashed into the box; ground tiles are
reduced whole, because cropping one would trim the edge pixels that make it
tile seamlessly.

LICENSING. RLTiles — the base this art comes from — is public domain, and the
majority of Crawl's own additions are CC0. Crawl's LICENSE notes the situation
"may be complex, especially for older pieces", so ATTRIBUTION.md records the
exact source file for every sprite imported. No DCSS *code* is used anywhere in
this project; Crawl's engine is GPL-2.0-or-later and this engine shares nothing
with it.
"""
import os
import sys

from PIL import Image

SIZE = 16

# sprite id -> path under rltiles/
#
# Ids are ours, not Crawl's: they name what the thing is FOR in this game.
# Ground tiles go in TERRAIN (reduced whole); everything else is an object.
# Crawl's dungeon floors are painted for a dark dungeon, so the obvious
# name is often the wrong file: rect_gray0 ("stone") is near-black, frozen0
# ("snow") is navy, and volcanic_floor0 ("ash") is blood red. An overworld is
# lit, so these pick from the families that are actually bright in the source
# art — salt, limestone, marble, icy_floor — and the names below describe the
# TILE, not the Crawl feature it was drawn for.
TERRAIN = {
    # --- ground ---------------------------------------------------------
    "t-grass": "dngn/floor/grass/grass0.png",
    "t-grass-dry": "dngn/floor/sandstone_floor0.png",
    "t-dirt": "dngn/floor/dirt0.png",
    "t-sand": "dngn/floor/sand1.png",
    "t-snow": "dngn/floor/salt3.png",
    "t-ice": "dngn/floor/icy_floor0.png",
    "t-stone": "dngn/floor/white_marble0.png",
    "t-clay": "dngn/floor/limestone0.png",
    "t-swamp": "dngn/floor/bog_green0.png",
    "t-ash": "dngn/floor/tomb0.png",
    "t-voidgrass": "dngn/floor/crystal0.png",
    # Crawl has no wooden floor at all, so village interiors are flagstones
    # rather than floorboards, and the tile is named for what it shows.
    "t-flagstone": "dngn/floor/limestone6.png",
    "t-moss": "dngn/floor/moss0.png",
    "t-marble": "dngn/floor/white_marble1.png",
    # --- walls ----------------------------------------------------------
    "t-wall-stone": "dngn/wall/stone_gray0.png",
    "t-wall-wood": "dngn/wall/brick_brown0.png",
    "t-wall-clay": "dngn/wall/sandstone_wall0.png",
    "t-wall-snow": "dngn/wall/ice_block0.png",
    "t-wall-crypt": "dngn/wall/catacombs0.png",
    "t-wall-hell": "dngn/wall/hell01.png",
    "t-wall-marble": "dngn/wall/marble_wall1.png",
    # --- liquids --------------------------------------------------------
    "t-water": "dngn/water/shallow_water.png",
    "t-deep-water": "dngn/water/deep_water.png",
    "t-lava": "dngn/floor/lava00.png",
    # --- scenery (whole tiles, they fill their cell) ---------------------
    "t-tree": "dngn/trees/tree1.png",
    "t-tree-snow": "dngn/trees/tree_petrified1.png",
    "t-mushroom": "dngn/trees/mangrove1.png",
    "t-ore": "dngn/wall/crystal_wall01.png",
    # --- ways through ---------------------------------------------------
    "t-stairs-down": "dngn/gateways/stone_stairs_down.png",
    "t-stairs-up": "dngn/gateways/stone_stairs_up.png",
    "t-dungeon-door": "dngn/gateways/enter.png",
}

OBJECTS = {
    # ---- weapons ------------------------------------------------------
    "wpn-dagger": "item/weapon/dagger.png",
    "wpn-sword": "item/weapon/short_sword1.png",
    "wpn-longsword": "item/weapon/long_sword1.png",
    "wpn-greatsword": "item/weapon/greatsword1.png",
    "wpn-axe": "item/weapon/war_axe1.png",
    "wpn-mace": "item/weapon/mace1.png",
    "wpn-club": "item/weapon/club.png",
    "wpn-morningstar": "item/weapon/morningstar1.png",
    "wpn-spear": "item/weapon/spear1.png",
    "wpn-whip": "item/weapon/bullwhip.png",
    "wpn-staff": "item/weapon/quarterstaff.png",
    "wpn-staff-magic": "item/weapon/staff.png",
    "wpn-crossbow": "item/weapon/ranged/arbalest1.png",
    # ---- armour -------------------------------------------------------
    "arm-robe": "item/armour/robe1.png",
    "arm-leather": "item/armour/leather_armour1.png",
    "arm-ring-mail": "item/armour/ring_mail1.png",
    "arm-chain-mail": "item/armour/chain_mail1.png",
    "arm-plate": "item/armour/plate1.png",
    "arm-buckler": "item/armour/shields/buckler1.png",
    "arm-shield": "item/armour/shields/kite_shield1.png",
    "arm-helm": "item/armour/headgear/helmet1.png",
    "arm-hat": "item/armour/headgear/hat1.png",
    "arm-gloves": "item/armour/glove1.png",
    "arm-boots": "item/armour/boots1.png",
    "arm-cloak": "item/armour/cloak1_leather.png",
    # ---- carried ------------------------------------------------------
    "itm-potion": "item/potion/brilliant_blue.png",
    "itm-potion-2": "item/potion/emerald.png",
    "itm-potion-3": "item/potion/ruby.png",
    "itm-scroll": "item/scroll/i-blinking.png",
    "itm-ring": "item/ring/agate.png",
    "itm-amulet": "item/amulet/amethyst.png",
    "itm-wand": "item/wand/gem_brass.png",
    "itm-gold": "item/gold/01.png",
}


# --- the player, one sprite per species (player/base/) -------------------
#
# Crawl draws a player as a doll: a base body with equipment layered on top.
# This game draws one 16x16 sprite, so it takes the base and nothing else —
# at this size the layers would be mud anyway, and what you are wearing is on
# the gear screen.
SPECIES = {
    "pc-human": "player/base/human_m.png",
    "pc-deep-elf": "player/base/deep_elf_m.png",
    "pc-hill-orc": "player/base/orc_m.png",
    "pc-minotaur": "player/base/minotaur_m.png",
    "pc-troll": "player/base/troll_m.png",
    "pc-gargoyle": "player/base/gargoyle_m.png",
    "pc-draconian": "player/base/draconian_red.png",
    "pc-kobold": "player/base/kobold_m.png",
    "pc-demonspawn": "player/base/demonspawn_red_m.png",
    "pc-formicid": "player/base/formicid.png",
    "pc-merfolk": "player/base/merfolk_m.png",
    "pc-spriggan": "player/base/spriggan_m.png",
    "pc-tengu": "player/base/tengu_winged_m.png",
    "pc-vine-stalker": "player/base/vine_stalker_green_m.png",
    "pc-octopode": "player/base/octopode1.png",
    "pc-mummy": "player/base/mummy_m.png",
    "pc-naga": "player/base/naga_green_m.png",
    "pc-ghoul": "player/base/ghoul_m.png",
    "pc-gnoll": "player/base/gnoll_m.png",
    "pc-oni": "player/base/oni_red_m.png",
    "pc-coglin": "player/base/coglin.png",
    "pc-revenant": "player/base/revenant.png",
}

# --- the bestiary (mon/) -------------------------------------------------
MONSTERS = {
    # beasts
    "mon-rat": "mon/animals/rat.png",
    "mon-river-rat": "mon/animals/green_rat.png",
    "mon-bat": "mon/animals/bat.png",
    "mon-vampire-bat": "mon/animals/vampire_bat.png",
    "mon-jackal": "mon/animals/jackal.png",
    "mon-wolf": "mon/animals/wolf.png",
    "mon-warg": "mon/animals/warg.png",
    "mon-black-bear": "mon/animals/black_bear.png",
    "mon-polar-bear": "mon/animals/polar_bear.png",
    "mon-hog": "mon/animals/hog.png",
    "mon-yak": "mon/animals/yak.png",
    "mon-death-yak": "mon/animals/death_yak.png",
    "mon-adder": "mon/animals/adder.png",
    "mon-black-mamba": "mon/animals/black_mamba.png",
    "mon-scorpion": "mon/animals/scorpion.png",
    "mon-wolf-spider": "mon/animals/wolf_spider.png",
    "mon-redback": "mon/animals/redback.png",
    "mon-hornet": "mon/animals/hornet.png",
    "mon-crocodile": "mon/animals/crocodile.png",
    "mon-basilisk": "mon/animals/basilisk.png",
    "mon-manticore": "mon/animals/manticore.png",
    "mon-hydra": "mon/undead/draugr/draugr_hydra4.png",
    # goblinoids and people
    "mon-goblin": "mon/humanoids/goblin.png",
    "mon-hobgoblin": "mon/humanoids/hobgoblin.png",
    "mon-gnoll": "mon/humanoids/gnoll.png",
    "mon-orc": "mon/humanoids/orcs/orc.png",
    "mon-orc-warrior": "mon/humanoids/orcs/orc_warrior.png",
    "mon-orc-priest": "mon/humanoids/orcs/orc_priest.png",
    "mon-orc-knight": "mon/humanoids/orcs/orc_knight.png",
    "mon-ogre": "mon/humanoids/ogre.png",
    "mon-two-headed-ogre": "mon/humanoids/two_headed_ogre.png",
    "mon-troll": "mon/humanoids/troll.png",
    "mon-deep-troll": "mon/humanoids/deep_troll.png",
    "mon-centaur": "mon/demihumanoids/taurs/centaur.png",
    "mon-kobold": "mon/humanoids/kobold.png",
    "mon-big-kobold": "mon/humanoids/kobold_brigand.png",
    # undead
    "mon-skeleton": "mon/undead/draugr/draugr_humanoid_medium.png",
    "mon-zombie": "mon/undead/zombies/zombie_human.png",
    "mon-wight": "mon/undead/wight.png",
    "mon-wraith": "mon/undead/wraith.png",
    "mon-phantom": "mon/undead/phantom.png",
    "mon-shadow": "mon/undead/shadowghast.png",
    "mon-vampire": "mon/undead/vampire.png",
    "mon-lich": "mon/undead/lich.png",
    "mon-mummy": "mon/undead/mummy.png",
    "mon-ghoul": "mon/undead/ghoul.png",
    # demons and the strange
    "mon-crimson-imp": "mon/demons/crimson_imp.png",
    "mon-white-imp": "mon/demons/white_imp.png",
    "mon-shadow-imp": "mon/demons/shadow_imp.png",
    "mon-ynoxinul": "mon/demons/ynoxinul.png",
    "mon-balrug": "mon/demons/balrug.png",
    "mon-hellion": "mon/demons/hellion.png",
    "mon-rakshasa": "mon/demons/rakshasa.png",
    # oozes, fungi, elementals
    "mon-jelly": "mon/amorphous/jelly.png",
    "mon-azure-jelly": "mon/amorphous/azure_jelly.png",
    "mon-acid-blob": "mon/amorphous/acid_blob.png",
    "mon-ooze": "mon/amorphous/rockslime.png",
    "mon-fire-elemental": "mon/nonliving/fire_elemental.png",
    "mon-ice-beast": "mon/nonliving/jade_crystal_ice.png",
    "mon-air-elemental": "mon/nonliving/air_elemental.png",
    "mon-earth-elemental": "mon/nonliving/earth_elemental.png",
    "mon-gargoyle": "mon/nonliving/gargoyle.png",
    "mon-ugly-thing": "mon/aberrations/ugly_thing.png",
    # eyes and plants
    "mon-floating-eye": "mon/eyes/glass_eye.png",
    "mon-wandering-mushroom": "mon/fungi_plants/wandering_mushroom.png",
    "mon-oklob-plant": "mon/fungi_plants/oklob_plant.png",
}


def fit16(img: Image.Image) -> Image.Image:
    """Crop to what is drawn, then fit into 16x16 by the longest side."""
    img = img.convert("RGBA")
    box = img.getbbox()
    if not box:
        return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    art = img.crop(box)
    scale = min(SIZE / art.width, SIZE / art.height)
    w = max(1, round(art.width * scale))
    h = max(1, round(art.height * scale))
    art = art.resize((w, h), Image.BOX)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.alpha_composite(art, ((SIZE - w) // 2, SIZE - h))
    return out


# The darkest a ground tile may be, as a mean of its RGB channels.
#
# Crawl draws its floors inside a lit dungeon and leans on the renderer to
# brighten what the player can see, so several of them — bog_green, moss, the
# volcanic floors — are near-black as files. Dropped unchanged into a daylit
# overworld they read as holes in the map rather than as ground. Anything below
# this is lifted up to it.
GROUND_FLOOR_LUMA = 52


def lift(img: Image.Image, floor: int = GROUND_FLOOR_LUMA) -> Image.Image:
    """
    Raise a too-dark ground tile to a readable brightness, keeping its colour.

    The scale is applied to all three channels equally, so the hue and the
    texture's contrast survive; only the exposure changes. A tile already above
    the floor is returned untouched, which is most of them.
    """
    px = [p for p in img.getdata() if p[3] > 0]
    if not px:
        return img
    mean = sum(p[0] + p[1] + p[2] for p in px) / (3 * len(px))
    if mean >= floor or mean <= 0:
        return img
    k = floor / mean
    out = [
        (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), a)
        for (r, g, b, a) in img.getdata()
    ]
    lifted = Image.new("RGBA", img.size)
    lifted.putdata(out)
    return lifted


def tile16(img: Image.Image) -> Image.Image:
    """Ground tiles are reduced whole, so their edges keep tiling."""
    return lift(img.convert("RGBA").resize((SIZE, SIZE), Image.BOX))


#
# Tiles that Crawl draws ON TOP of a floor, and what to put under them here.
#
# A gateway in Crawl is a doorway sprite with transparent corners, composited
# over whatever floor the dungeon happens to use. This renderer draws one sprite
# per cell, so dropped in unchanged those corners show the page background and
# the entrance looks like a tear in the map. Standing them on a stone threshold
# both fills the cell and reads correctly in every biome: a worked stone step
# at the mouth of a dungeon is exactly what should be there.
#
UNDER = {
    "t-dungeon-door": "t-stone",
    "t-stairs-down": "t-stone",
    "t-stairs-up": "t-stone",
}


def on_threshold(art: Image.Image, base_path: str) -> Image.Image:
    """Composite a cut-out feature over a reduced copy of a ground tile."""
    base = tile16(Image.open(base_path))
    base.alpha_composite(art)
    return base


def main(src: str, dest: str) -> None:
    if not os.path.isdir(src):
        raise SystemExit(
            f"rltiles folder not found: {src}\n"
            "Clone it with:\n"
            "  git clone --depth 1 --filter=blob:none --sparse https://github.com/crawl/crawl\n"
            "  cd crawl && git sparse-checkout set crawl-ref/source/rltiles"
        )
    os.makedirs(dest, exist_ok=True)
    made, missing, rows = [], [], []

    for group, whole in ((TERRAIN, True), (OBJECTS, False), (SPECIES, False), (MONSTERS, False)):
        for name, rel in group.items():
            path = os.path.join(src, rel)
            if not os.path.exists(path):
                missing.append(f"{name} <- {rel}")
                continue
            img = Image.open(path)
            out = tile16(img) if whole else fit16(img)
            if name in UNDER:
                out = on_threshold(out, os.path.join(src, TERRAIN[UNDER[name]]))
                rows.append((name, f"{rel} over {TERRAIN[UNDER[name]]}"))
            else:
                rows.append((name, rel))
            out.save(os.path.join(dest, f"{name}.png"), optimize=True)
            made.append(name)

    removed = sweep(dest, set(made))
    write_attribution(dest, rows)
    print(f"wrote {len(made)} sprites into {dest}")
    if removed:
        print(f"removed {len(removed)} sprites this importer no longer makes:")
        for r in removed:
            print(f"  {r}")
    if missing:
        print("could not find (check the name in rltiles/):")
        for m in missing:
            print(f"  {m}")


#
# Any file with one of these prefixes belongs to this importer, so if it is not
# in the current catalogue it is left over from an older run and must go.
# Without this, renaming a sprite leaves the old one behind, the art folder
# slowly fills with things nothing references, and ATTRIBUTION.md stops being
# a true record of what is there — which the tests check, and which is the
# whole point of having it.
#
OURS = ("dcss-", "t-", "wpn-", "arm-", "itm-", "mon-", "pc-")


def sweep(dest: str, keep: set) -> list:
    gone = []
    for f in sorted(os.listdir(dest)):
        if not f.endswith(".png"):
            continue
        name = f[:-4]
        if not name.startswith(OURS) or name in keep:
            continue
        os.remove(os.path.join(dest, f))
        gone.append(name)
    return gone


def write_attribution(dest: str, rows) -> None:
    """Record the exact source file for every imported sprite."""
    # Repo root, not beside the art: it is a document about the project, and
    # burying it inside assets/ is where nobody reads it.
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ATTRIBUTION.md")
    lines = [
        "# Where the art comes from",
        "",
        "## Dungeon Crawl Stone Soup",
        "",
        "Sprites prefixed `dcss-`, `wpn-`, `arm-` and `itm-` are reduced to 16x16",
        "from Crawl's tile SOURCES — the individual named files under",
        "`crawl-ref/source/rltiles/`, not the packed atlases the game ships, which",
        "cannot be sliced on a grid.",
        "",
        "RLTiles, the tileset Crawl's art is built on, is public domain. The majority",
        "of Crawl's own additions are CC0; its LICENSE notes the situation \"may be",
        "complex, especially for older pieces\" and points at",
        "<https://github.com/crawl/tiles>. The table below records the exact source",
        "file for each sprite so any one of them can be checked.",
        "",
        "No DCSS *code* is used in this project. Crawl's engine is GPL-2.0-or-later;",
        "this engine is written from scratch and shares nothing with it.",
        "",
        "| sprite | source file |",
        "|---|---|",
    ]
    for name, rel in sorted(rows):
        lines.append(f"| `{name}` | `rltiles/{rel}` |")
    lines += [
        "",
        "## TURBZ",
        "",
        "Everything else is from TURBZ: the ground tiles via `tools/make-tiles.py`,",
        "and the creatures and the Ruinmage via `tools/make-sprites.py`.",
        "",
        "## Fonts",
        "",
        "Press Start 2P and VT323 are SIL Open Font License, loaded from Google",
        "Fonts. Drop `press-start-2p.woff2` and `vt323.woff2` into `assets/fonts/`",
        "to make the game self-contained.",
    ]
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "assets/tiles16")
