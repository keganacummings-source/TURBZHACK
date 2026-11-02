"""
Builds the 16x16 tile set from the 32x32 TURBZ New Texture art.

TURBZHACK is a 16x16 game — that is what gives it NetHack's density, where you
can see a whole room at once — but the art it is meant to look like was drawn at
32x32 (and 64x64 for trees). So each source tile is reduced by half.

Downscaling pixel art is a real decision, not a detail:

  - BOX averaging, not nearest-neighbour. Nearest throws away three of every
    four pixels, so a tile's dithering and outlines turn to noise. Averaging
    keeps the tile's overall colour and reads correctly at the smaller size.
  - Alpha is kept and NOT averaged into the colour, or every sprite with a
    transparent edge gets a dark halo.
  - 64x64 scenery (trees, portals) reduces to 16x16 as well, so a tree is one
    tile here rather than the two-by-two it is in TURBZ.

Re-runnable: it only ever reads the source folder and writes the output folder,
so it can be run again whenever the TURBZ art changes.

    python3 tools/make-tiles.py <turbz-NewTex-folder> assets/tiles16
"""
import os
import sys

from PIL import Image

SIZE = 16

# TURBZHACK tile id  ->  TURBZ NewTex file name
MAP = {
    # ground
    "grass": "grass.png",
    "grass-dry": "grass_dry.png",
    "dirt": "dirt_floor.png",
    "sand": "sand.png",
    "snow": "snow.png",
    "ice": "ice.png",
    "stone": "stone_floor.png",
    "clay": "claystone.png",
    "swamp": "swamp_floor.png",
    "ash": "hell_floor.png",
    "voidgrass": "voidgrass.png",
    "wood-floor": "wood_floor.png",
    # walls and scenery
    "wall-stone": "stone_wall.png",
    "wall-wood": "wood_wall.png",
    "wall-clay": "claystone_wall.png",
    "wall-snow": "snow_wall.png",
    "tree": "tree_plains.png",
    "tree-snow": "tree_snow.png",
    "mushroom": "mushroom.png",
    "ore": "ore_node.png",
    # liquids
    "water": "water.png",
    "deep-water": "deep_water.png",
    "lava": "lava.png",
    # ways in and out
    "stairs-down": "portal.png",
    "stairs-up": "portal.png",
    "dungeon-door": "arena.png",
}

# Sprites that are not tiles: the player classes and the creatures. These are
# placeholders drawn by tools/make-sprites.py, not TURBZ art.
PLACEHOLDER_SPRITES = [
    "witch", "berserk",
    "rat", "goblin", "frost-imp", "ember-hound", "deer", "wanderer",
    "stone-golem", "wisp",
]


def reduce_tile(img: Image.Image) -> Image.Image:
    """Half-size (or quarter, for 64px art) with box averaging, alpha intact."""
    img = img.convert("RGBA")
    # Resize colour and alpha together; Pillow's BOX filter already handles
    # premultiplication correctly for RGBA, which is why it is used rather than
    # resizing the bands separately.
    return img.resize((SIZE, SIZE), Image.BOX)


def main(src: str, dest: str) -> None:
    if not os.path.isdir(src):
        raise SystemExit(f"source folder not found: {src}")
    os.makedirs(dest, exist_ok=True)

    made, missing = [], []
    for tile_id, filename in MAP.items():
        path = os.path.join(src, filename)
        if not os.path.exists(path):
            missing.append(f"{tile_id} <- {filename}")
            continue
        out = reduce_tile(Image.open(path))
        out.save(os.path.join(dest, f"{tile_id}.png"), optimize=True)
        made.append(tile_id)

    print(f"wrote {len(made)} tiles into {dest}")
    if missing:
        print("missing source art (these tiles will fall back to a flat colour):")
        for m in missing:
            print(f"  {m}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "assets/tiles16")
