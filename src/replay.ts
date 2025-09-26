export type MoveType = "reveal" | "flag" | "chord" | "auto-reveal";

export type ReplayMove = {
  t: number;              // ms desde el inicio del run
  r: number;
  c: number;
  type: MoveType;
  by: "human" | "ai";
};

export type Replay = {
  schema: 1;
  meta: {
    startedAt: number;    // epoch ms
    durationMs: number;   // al finalizar
    difficulty: string;
    seed: number;
    result: "win" | "lose";
    aiType?: string;
    version?: string;
  };
  moves: ReplayMove[];
};

export class ReplayRecorder {
  private start = 0;
  private moves: ReplayMove[] = [];
  private meta = {
    startedAt: 0,
    durationMs: 0,
    difficulty: "",
    seed: 0,
    result: "lose" as "win" | "lose",
    aiType: undefined as string | undefined,
    version: "sprint6",
  };

  begin(difficulty: string, seed: number, aiType?: string) {
    this.start = performance.now();
    this.meta.startedAt = Date.now();
    this.meta.difficulty = difficulty;
    this.meta.seed = seed;
    this.meta.aiType = aiType;
    this.moves = [];
  }

  push(m: Omit<ReplayMove, "t">) {
    const t = Math.max(0, Math.round(performance.now() - this.start));
    this.moves.push({ ...m, t });
  }

  end(result: "win" | "lose") {
    this.meta.result = result;
    this.meta.durationMs = Math.max(0, Math.round(performance.now() - this.start));
    const rep: Replay = { schema: 1, meta: this.meta, moves: this.moves };
    return rep;
  }
}
