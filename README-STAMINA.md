# Weapon Stamina by Weight

## Files to replace in your repo
- src/engine/weapons.ts
- src/game.ts

## What changed
Weapon swings now cost **stamina based on weight**.

Weight is computed from:
- Material weight (wood/bone light, iron default, etc.)
- Class scale (light weapons cheaper, heavy weapons cost more)
- Two-handed multiplier
- Class speed

Unarmed stays free. Heavy axes/polearms burn stamina fast so spam-swinging them is punished — players are pushed to swap weapon types during combat.

Item examine UI also shows "Stamina: X per swing" for weapons.

Rough costs (iron baseline):
- Dagger ~6-8
- Sword ~10-12
- Axe/Mace ~18-22
- Polearm / 2H ~22-30

(Stamina recovers 25/turn; typical pool 100-150.)
