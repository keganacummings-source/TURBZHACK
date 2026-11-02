"""
Draws the 16x16 creature and class sprites.

There is no TURBZ source art for the people and the monsters, so these are
drawn here from a tiny shape language rather than left as coloured squares. They
are PLACEHOLDERS and they say so — the point of the built-in texture designer is
that you replace them one at a time without ever touching this file.

Each sprite is a handful of rows of characters, which keeps a creature's whole
design readable in one glance and easy to tweak:

    "." transparent     "o" outline (near-black)
    "a" main colour     "b" shade (darker)      "c" highlight (lighter)
    "d" accent          "e" eye / detail

    python3 tools/make-sprites.py assets/tiles16
"""
import os
import sys

from PIL import Image

SIZE = 16

# A humanoid: head, shoulders, body, legs. Used by both classes and by people.
HUMANOID = [
    "................",
    ".....oooooo.....",
    "....oaaaaaao....",
    "....oaeaaeao....",
    "....oaaaaaao....",
    ".....obbbbo.....",
    "...oodddddoo....",
    "..oadddddddao...",
    "..oadddddddao...",
    "..oaoddddddao...",
    "...oodddddoo....",
    "....obbbbbo.....",
    "....ob.o.bo.....",
    "....ob.o.bo.....",
    "...ooo.ooo......",
    "................",
]

# A low four-legged animal.
BEAST = [
    "................",
    "................",
    "................",
    "......oooo......",
    ".....oaaaao.....",
    "..oooaeaaeaooo..",
    ".oaaaaaaaaaaaao.",
    ".oaaaaaaaaaaaad.",
    ".obaaaaaaaaaabo.",
    ".oo.oo....oo.oo.",
    "..o..o....o..o..",
    "................",
    "................",
    "................",
    "................",
    "................",
]

# Something drifting and vague.
WISP = [
    "................",
    "......oooo......",
    ".....oaccao.....",
    "....oacccceo....",
    "....oaccccao....",
    "...oaaccccaao...",
    "...oaaaaaaaao...",
    "....oaaaaaao....",
    ".....oaaaao.....",
    "......oaao......",
    ".......oo.......",
    "......o..o......",
    ".....o....o.....",
    "................",
    "................",
    "................",
]

# A heavy, blocky thing.
GOLEM = [
    "................",
    "....oooooooo....",
    "...oabbbbbbao...",
    "...oaeaaaaeao...",
    "...oabbbbbbao...",
    "..ooaaaaaaaaoo..",
    ".oaaaaaaaaaaaao.",
    ".oabbbbbbbbbbao.",
    ".oaaaaaaaaaaaao.",
    ".oabbbbbbbbbbao.",
    ".ooaaaaaaaaaoo..",
    "...oaao..oaao...",
    "...oaao..oaao...",
    "..ooaaoo.oaaoo..",
    "..oaaaao.oaaao..",
    "................",
]

# id -> (shape, colours) where colours maps the letters above to RGB.
SPRITES = {
    # --- classes ---
    "witch":       (HUMANOID, {"a": (214, 178, 148), "b": (150, 116, 94), "c": (240, 220, 200),
                               "d": (92, 58, 132), "e": (60, 40, 30)}),
    "berserk":     (HUMANOID, {"a": (208, 164, 128), "b": (148, 104, 78), "c": (240, 210, 180),
                               "d": (150, 58, 44), "e": (50, 30, 24)}),
    "wanderer":    (HUMANOID, {"a": (200, 172, 148), "b": (140, 116, 96), "c": (235, 215, 195),
                               "d": (96, 104, 76), "e": (48, 36, 28)}),
    # --- creatures ---
    "rat":         (BEAST, {"a": (124, 120, 116), "b": (82, 78, 76), "c": (170, 168, 164),
                            "d": (190, 150, 150), "e": (220, 70, 60)}),
    "goblin":      (HUMANOID, {"a": (118, 152, 84), "b": (76, 102, 54), "c": (160, 190, 120),
                               "d": (92, 72, 52), "e": (230, 200, 60)}),
    "deer":        (BEAST, {"a": (158, 114, 72), "b": (112, 78, 48), "c": (198, 160, 118),
                            "d": (228, 214, 196), "e": (40, 28, 20)}),
    "ember-hound": (BEAST, {"a": (72, 44, 40), "b": (44, 26, 24), "c": (140, 60, 40),
                            "d": (240, 140, 50), "e": (255, 196, 70)}),
    "frost-imp":   (HUMANOID, {"a": (138, 182, 210), "b": (90, 128, 158), "c": (196, 226, 244),
                               "d": (54, 96, 140), "e": (230, 250, 255)}),
    "stone-golem": (GOLEM, {"a": (132, 128, 120), "b": (96, 92, 86), "c": (176, 172, 164),
                            "d": (70, 66, 62), "e": (120, 200, 220)}),
    "wisp":        (WISP, {"a": (118, 96, 168), "b": (70, 56, 104), "c": (186, 166, 230),
                           "d": (60, 48, 90), "e": (240, 230, 255)}),
}

OUTLINE = (22, 18, 26)


def draw(shape, colours):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(shape[:SIZE]):
        for x, ch in enumerate(row[:SIZE]):
            if ch == ".":
                continue
            rgb = OUTLINE if ch == "o" else colours.get(ch)
            if rgb is None:
                continue
            px[x, y] = (*rgb, 255)
    return img


def main(dest: str) -> None:
    os.makedirs(dest, exist_ok=True)
    for name, (shape, colours) in SPRITES.items():
        draw(shape, colours).save(os.path.join(dest, f"{name}.png"), optimize=True)
    print(f"wrote {len(SPRITES)} sprites into {dest}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "assets/tiles16")
