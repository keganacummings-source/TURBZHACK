# Forms, anatomy, and traps

TURBZHACK's temporary forms, equipment rules, and one-shot pit traps are original
systems. They use broad roguelike conventions as references, not copied code,
assets, dialogue, or game text.

## Transformations

Press `v` to choose Dire Bear, River Serpent, Stonehide, or Wisp. Each form costs
15 mana, uses a turn, lasts 30 world turns, and changes combat stats and/or
resistance. Equipment in a form's blocked slots remains worn but is melded:
its bonuses are suspended until the form ends. Form duration, equipment, and
spent dungeon traps survive save/load.

## Species equipment

Octopodes have eight tentacle slots for rings and cannot wear body armor, gloves,
boots, cloaks, or shields. Naga cannot wear boots. Other species keep the normal
gear layout. The inventory labels Octopode ring positions by tentacle number.

## Tactical shoves and pits

Kick pushes a surviving adjacent target one tile away. Rooted targets resist;
large creatures and physical resistance raise the force needed to move a target;
occupied or solid destination tiles cause a collision instead of illegal
movement. Entering a visible spiked pit—by walking or forced movement—deals
physical damage, briefly roots the creature, and consumes the trap. Dungeon
floors seed passable pits away from stairs and the keeper's position.

## Mechanic references

- [Dungeon Crawl Stone Soup transformation and equipment melding](https://github.com/crawl/crawl/blob/21d07f7025c57460091d9d86259fad77b5aa0d05/crawl-ref/source/transform.cc)
- [NetHack source repository](https://github.com/NetHack/NetHack), including its polymorph, kicking, and monster movement systems.

These references informed the design only. TURBZHACK's implementation and
content are independently written.
