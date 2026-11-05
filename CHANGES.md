# Dungeon generator revamp (DCSS-inspired)

Layouts are no longer a rigid NetHack-style room grid. Floor generation picks
from theme-weighted builders inspired by Crawl's `dgn-layouts`:

| Layout | Feel | Typical themes |
|--------|------|----------------|
| **trails** | Drunken corridor walks + rooms punched along them | jungle, crypt |
| **rooms** | Free-placed rooms joined with MST + loops | crypt, jungle |
| **caves** | Cellular automata + chambers | caves, swamp |
| **city** | Packed box rooms, streets, doors | mansion |

## DCSS-like details
- Corridor **trails** with length, turns, and intersections
- Rooms placed **freely** (not locked to a 3×N grid)
- **Door punches** on room walls (`dungeon-door` when present)
- **Octagon** room shape (Crawl octa_room)
- Cave **largest-component** cleanup so levels stay connected
- Swamp/jungle **water pools**
- Connectivity pass so every room is reachable
- Theme weights bias which layout you get; depth still scales density

API unchanged: `generateDungeon`, `Dungeon`, themes, stairs, boss floor.

```bash
npm run build:web
```
