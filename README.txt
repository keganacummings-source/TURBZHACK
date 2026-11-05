Fixed src/game.ts

Removed the leftover this.tickDirective() call (and its comment).
That method was part of the Overlord/LLM system and no longer exists.

Replace src/game.ts with this version, then:
npm run typecheck
