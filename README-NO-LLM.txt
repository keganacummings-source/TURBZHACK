TURBZHACK — LLM / Puck / Overlord fully removed
================================================

Drop these files over your existing repo (overwrite).

Removed:
- src/llm/           (delete this folder entirely)
- All Overlord / Puck / Ollama code from:
  - src/game.ts
  - src/ui/app.ts
  - src/ui/input.ts
  - tools/serve.mjs
  - package.json (removed setup-llm and serve:overlord scripts)
  - README.md (removed the Puck section)
  - src-tauri/capabilities/default.json (removed ollama shell permissions)

The game now has no LLM dependency. Focus is on the normal play and the .exe build.

After dropping the files:
1. Delete the src/llm folder if it still exists.
2. npm run build:web
3. For the .exe: tag and push as before, or use your normal Tauri build.
