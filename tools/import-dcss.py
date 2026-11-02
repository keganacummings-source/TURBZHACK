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
TERRAIN = {
    "dcss-floor-cobble": "dngn/floor/rect_gray0.png",
    "dcss-floor-sand": "dngn/floor/sand1.png",
    "dcss-floor-dirt": "dngn/floor/dirt0.png",
    "dcss-floor-grass": "dngn/floor/grass/grass-dark0.png",
    "dcss-floor-marble": "dngn/floor/marble_floor1.png",
    "dcss-floor-ice": "dngn/floor/ice0.png",
    "dcss-floor-lair": "dngn/floor/lair0.png",
    "dcss-floor-crypt": "dngn/floor/crypt0.png",
    "dcss-floor-volcanic": "dngn/floor/volcanic_floor0.png",
    "dcss-wall-stone": "dngn/wall/stone_gray0.png",
    "dcss-wall-brick": "dngn/wall/brick_brown0.png",
    "dcss-wall-crypt": "dngn/wall/crypt0.png",
    "dcss-wall-ice": "dngn/wall/ice_block0.png",
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


def tile16(img: Image.Image) -> Image.Image:
    """Ground tiles are reduced whole, so their edges keep tiling."""
    return img.convert("RGBA").resize((SIZE, SIZE), Image.BOX)


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

    for group, whole in ((TERRAIN, True), (OBJECTS, False)):
        for name, rel in group.items():
            path = os.path.join(src, rel)
            if not os.path.exists(path):
                missing.append(f"{name} <- {rel}")
                continue
            img = Image.open(path)
            out = tile16(img) if whole else fit16(img)
            out.save(os.path.join(dest, f"{name}.png"), optimize=True)
            made.append(name)
            rows.append((name, rel))

    write_attribution(dest, rows)
    print(f"wrote {len(made)} sprites into {dest}")
    if missing:
        print("could not find (check the name in rltiles/):")
        for m in missing:
            print(f"  {m}")


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
