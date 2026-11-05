export const DAY_TURNS = 100;
export const NIGHT_TURNS = 100;
export const DAY_NIGHT_CYCLE = DAY_TURNS + NIGHT_TURNS;
export const REST_COOLDOWN_TURNS = 100;

export type TimeOfDay = {
  phase: "day" | "night";
  turnInPhase: number;
};

/** Turn zero begins the first day; each phase lasts exactly 100 world ticks. */
export function timeOfDay(turn: number): TimeOfDay {
  const cycleTurn = ((turn % DAY_NIGHT_CYCLE) + DAY_NIGHT_CYCLE) % DAY_NIGHT_CYCLE;
  const phase = cycleTurn < DAY_TURNS ? "day" : "night";
  return {
    phase,
    turnInPhase: (phase === "day" ? cycleTurn : cycleTurn - DAY_TURNS) + 1,
  };
}
