export type VisibleCell = "H" | "F" | number; // hidden, flag, number 0..8
export type VisibleBoard = VisibleCell[][];

export type ExplainStep = {
  rule: "det" | "subset" | "csp-exact" | "prob";
  cells: { r: number; c: number }[];     // afectadas por la regla
  details?: Record<string, unknown>;     // metadatos
};

export type NextMove =
  | { type: "reveal"; r: number; c: number; explain: ExplainStep }
  | { type: "flag"; r: number; c: number; explain: ExplainStep }
  | null;

export type ProbMap = number[][]; // misma forma que board, valores 0..1 para celdas 'H'

export type ComputePayload = {
  kind: "computeMove";
  board: VisibleBoard;
};

export type ProbPayload = {
  kind: "probMap";
  board: VisibleBoard;
};

export type BenchmarkPayload = {
  kind: "benchmark";
  seeds: number[];
  difficulty: string;
};

export type WorkerMessage = ComputePayload | ProbPayload | BenchmarkPayload;

export type ComputeResult = {
  kind: "computeMove";
  move: NextMove;
};

export type ProbResult = {
  kind: "probMap";
  probs: ProbMap;
  frontierSize: number; // celdas 'H' adyacentes a números
};

export type BenchmarkRow = {
  seed: number;
  win: boolean;
  timeMs: number;
  moves: number;
  exactSteps: number;
  frontierMax: number;
  visitedNodes: number;
};

export type BenchmarkResult = {
  kind: "benchmark";
  rows: BenchmarkRow[];
};
