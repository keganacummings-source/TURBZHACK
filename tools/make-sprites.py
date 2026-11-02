"""
Cuts the creature and character sprites out of the TURBZ sheets.

Two sources, and they need completely different treatment:

  creatures_roguelike.png  — already a 16x16 grid. Cut a cell and you are done.
                             This is the whole bestiary.

  class_warriors.png       — 32x44 character frames on a magenta chroma key,
                             laid out as 4 walk frames x 4 facings per class.
                             The RuinMage lives at (384, 1056).

The character needs real work to become a 16x16 tile:

  1. The magenta key becomes transparent. It is keyed, not alpha, so a plain
     convert leaves a magenta box.
  2. The frame is cropped to what is actually drawn. The 32x44 cell is mostly
     empty space above the head, and scaling the whole cell makes a character
     who occupies a third of their own tile.
  3. It is fitted into 16x16 by its LONGEST side, so the proportions survive.
     A 22x38 figure squashed to 16x16 is a different character.

    python3 tools/make-sprites.py <turbz-public/sprites> assets/tiles16
"""
import os
import sys

from PIL import Image

SIZE = 16
MAGENTA = (255, 0, 255)

# --- the bestiary, as cells of creatures_roguelike.png --------------------
# sprite id -> (row, column). Every enemy file's `sprite` must be a key here
# or it falls back to a flat colour, which scripts/art.test.mts checks for.
CREATURES = {
    # beasts
    "rat": (1, 0),
    "dire-rat": (1, 1),
    "boar": (1, 2),
    "tusker": (1, 3),
    "wolf": (1, 5),
    "winter-wolf": (1, 4),
    # goblinoids
    "goblin": (2, 0),
    "goblin-brute": (2, 1),
    "goblin-archer": (2, 3),
    "goblin-shaman": (2, 4),
    "orc": (3, 0),
    "orc-veteran": (3, 1),
    "orc-warlord": (3, 2),
    # crawlers and fliers
    "spider": (4, 1),
    "giant-spider": (4, 3),
    "bat": (4, 4),
    "blood-bat": (4, 5),
    # armoured things
    "sentinel": (5, 0),
    "iron-sentinel": (5, 1),
    "ember-knight": (5, 2),
    "ember-lord": (5, 3),
    "tide-knight": (5, 4),
    "frost-elemental": (5, 6),
    "storm-elemental": (5, 7),
    # the restless
    "skeleton": (6, 0),
    "skeleton-captain": (6, 3),
    "cultist": (6, 4),
    "reaper": (6, 5),
    "ghost": (7, 0),
    "wraith": (7, 3),
    "spore-ghost": (7, 2),
    # oozes and small things
    "green-ooze": (8, 0),
    "red-ooze": (8, 1),
    "blue-ooze": (8, 2),
    "gold-ooze": (8, 3),
    "ember-imp": (8, 4),
    "kobold": (8, 5),
    "snow-fowl": (8, 6),
    # people who are not trying to kill you
    "wanderer": (0, 0),
    "pilgrim": (0, 1),
    "hunter": (0, 3),
    "guard": (0, 6),
}

# --- the player, from class_warriors.png ----------------------------------
# Block origin, then the facing row to take. Row 2 is front-on: it has a face,
# which is the only row that reads as a character at 16 pixels.
CLASS_BLOCKS = {
    "ruinmage": {"origin": (384, 1056), "row": 2, "frame": 0},
}
CELL_W, CELL_H = 32, 44


def dekey(img: Image.Image) -> Image.Image:
    """Magenta -> transparent. The sheets are chroma-keyed, not alpha."""
    img = img.convert("RGBA")
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            # A tolerance, because the sheet has a few near-magenta pixels at
            # the edges where it was scaled at some point.
            if a == 0 or (r > 230 and g < 40 and b > 230):
                px[x, y] = (0, 0, 0, 0)
    return img


def fit16(img: Image.Image) -> Image.Image:
    """
    Crop to what is drawn, then fit into 16x16 by the longest side.

    Fitting by the longest side rather than stretching to the box is what keeps
    a tall robed figure tall. The result is centred horizontally and sat on the
    bottom edge, so characters stand on their tile instead of floating.
    """
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


def main(src: str, dest: str) -> None:
    if not os.path.isdir(src):
        raise SystemExit(f"source folder not found: {src}")
    os.makedirs(dest, exist_ok=True)
    made, missing = [], []

    # --- the bestiary ----------------------------------------------------
    sheet_path = os.path.join(src, "creatures_roguelike.png")
    if os.path.exists(sheet_path):
        sheet = dekey(Image.open(sheet_path))
        for name, (row, col) in CREATURES.items():
            cell = sheet.crop((col * SIZE, row * SIZE, col * SIZE + SIZE, row * SIZE + SIZE))
            if not cell.getbbox():
                missing.append(f"{name} (cell {row},{col} is empty)")
                continue
            cell.save(os.path.join(dest, f"{name}.png"), optimize=True)
            made.append(name)
    else:
        missing.append("creatures_roguelike.png — the whole bestiary")

    # --- the player ------------------------------------------------------
    class_path = os.path.join(src, "class_warriors.png")
    if os.path.exists(class_path):
        classes = Image.open(class_path)
        for name, spec in CLASS_BLOCKS.items():
            ox, oy = spec["origin"]
            x = ox + spec["frame"] * CELL_W
            y = oy + spec["row"] * CELL_H
            frame = dekey(classes.crop((x, y, x + CELL_W, y + CELL_H)))
            fit16(frame).save(os.path.join(dest, f"{name}.png"), optimize=True)
            made.append(name)
    else:
        missing.append("class_warriors.png — the player")

    print(f"wrote {len(made)} sprites into {dest}")
    if missing:
        print("could not make:")
        for m in missing:
            print(f"  {m}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "assets/tiles16")
