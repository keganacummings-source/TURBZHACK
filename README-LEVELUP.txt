TURBZHACK Level-Up Update
=========================

Drop these folders/files into your repo, overwriting the existing ones:

- src/engine/progress.ts     (CHOICES = 3, + 1/100 rare talent on normal levels)
- src/game.ts                (passes talentsTaken so rare talents are unique)
- src/ui/app.ts              (comment updates only)
- content/upgrades/          (entire folder — boosted existing talents + many new crazy and subtle ones)

What changed:
- Every level-up now offers exactly 3 choices.
- Milestone levels (every 5 levels) still offer only talents.
- On ordinary levels there is now a 1 in 100 chance that one of the three choices is a random unused talent.
- Existing talents were strengthened.
- Many new extreme talents and a set of more subtle ones were added.

After dropping the files, rebuild/serve as usual (npm run build:web && npm run serve).
