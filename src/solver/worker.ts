/// <reference lib="webworker" />
import {
  BenchmarkPayload,
  BenchmarkResult,
  BenchmarkRow,
  ComputePayload,
  ComputeResult,
  ProbPayload,
  ProbResult,
  WorkerMessage,
  VisibleBoard,
} from "./types";
import { computeNext, greedyProb } from "./core";

declare const self: DedicatedWorkerGlobalScope;

/* ----------------------- Motor de simulación (interno) ----------------------- */
type CellState = 0 | 1 | 2; // HIDDEN, REVEALED, FLAGGED
const HIDDEN = 0,
  REVEALED = 1,
  FLAGGED = 2;

type Cell = { state: CellState; mine: boolean; adj: number };
type Cfg = { rows: number; cols: number; mines: number };

const DIFFS: Record<string, Cfg> = {
  Beginner: { rows: 9, cols: 9, mines: 10 },
  Intermediate: { rows: 16, cols: 16, mines: 40 },
  Expert: { rows: 16, cols: 30, mines: 99 },
};

function inBounds(r: number, c: number, R: number, C: number) {
  return r >= 0 && r < R && c >= 0 && c < C;
}
function neighbors(r: number, c: number, R: number, C: number) {
  const v: [number, number][] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      if (dr || dc) {
        const nr = r + dr,
          nc = c + dc;
        if (inBounds(nr, nc, R, C)) v.push([nr, nc]);
      }
  return v;
}
function make2D<T>(R: number, C: number, fn: (r: number, c: number) => T) {
  return Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => fn(r, c)));
}
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createEmptyBoard(cfg: Cfg) {
  return make2D<Cell>(cfg.rows, cfg.cols, () => ({ state: HIDDEN, mine: false, adj: 0 }));
}

function placeMinesAvoiding(b: Cell[][], cfg: Cfg, seed: number, sr: number, sc: number) {
  const R = cfg.rows,
    C = cfg.cols,
    M = cfg.mines;
  const banned = new Set<number>();
  banned.add(sr * C + sc);
  for (const [nr, nc] of neighbors(sr, sc, R, C)) banned.add(nr * C + nc);

  const pool: number[] = [];
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      const id = r * C + c;
      if (!banned.has(id)) pool.push(id);
    }

  const rng = mulberry32(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (let k = 0; k < Math.min(M, pool.length); k++) {
    const id = pool[k];
    const r = Math.floor(id / C),
      c = id % C;
    b[r][c].mine = true;
  }
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      let cnt = 0;
      for (const [nr, nc] of neighbors(r, c, R, C)) if (b[nr][nc].mine) cnt++;
      b[r][c].adj = cnt;
    }
}

function revealFlood(b: Cell[][], cfg: Cfg, r: number, c: number) {
  const R = cfg.rows,
    C = cfg.cols;
  const q: [number, number][] = [];
  const push = (rr: number, cc: number) => {
    if (!inBounds(rr, cc, R, C)) return;
    const cell = b[rr][cc];
    if (cell.state !== HIDDEN || cell.mine) return;
    cell.state = REVEALED;
    if (cell.adj === 0) q.push([rr, cc]);
  };
  push(r, c);
  while (q.length) {
    const [cr, cc] = q.shift()!;
    for (const [nr, nc] of neighbors(cr, cc, R, C)) push(nr, nc);
  }
}

function checkWin(b: Cell[][], cfg: Cfg) {
  let hidden = 0;
  for (let r = 0; r < cfg.rows; r++)
    for (let c = 0; c < cfg.cols; c++) if (b[r][c].state !== REVEALED) hidden++;
  return hidden === cfg.mines;
}

function toVisibleBoard(b: Cell[][]): VisibleBoard {
  return b.map((row) =>
    row.map((cell) => {
      if (cell.state === FLAGGED) return "F";
      if (cell.state === HIDDEN) return "H";
      return cell.adj;
    })
  );
}

function applyMove(b: Cell[][], cfg: Cfg, move: { type: "reveal" | "flag"; r: number; c: number }) {
  const cell = b[move.r][move.c];
  if (move.type === "flag") {
    if (cell.state === HIDDEN) cell.state = FLAGGED;
    else if (cell.state === FLAGGED) cell.state = HIDDEN;
    return { ok: true, hitMine: false };
  }
  // reveal
  if (cell.mine) {
    cell.state = REVEALED;
    return { ok: false, hitMine: true };
  }
  if (cell.state === HIDDEN) revealFlood(b, cfg, move.r, move.c);
  return { ok: true, hitMine: false };
}

/** Simula una partida completa con la IA actual (det → subset → probabilística). */
function simulateGame(cfg: Cfg, seed: number): BenchmarkRow {
  const b = createEmptyBoard(cfg);
  const t0 = performance.now();

  // Primer click seguro: el centro (o lo más cercano)
  const sr = Math.floor(cfg.rows / 2);
  const sc = Math.floor(cfg.cols / 2);
  placeMinesAvoiding(b, cfg, seed, sr, sc);
  let moves = 0;
  let exactSteps = 0; // cuenta jugadas det/subset como "exactas" (no prob)

  // primer reveal
  applyMove(b, cfg, { type: "reveal", r: sr, c: sc });
  moves++;

  // bucle principal
  while (true) {
    if (checkWin(b, cfg)) {
      const timeMs = Math.round(performance.now() - t0);
      return {
        seed,
        win: true,
        timeMs,
        moves,
        exactSteps,
        frontierMax: 0,
        visitedNodes: 0,
      };
    }
    const vis = toVisibleBoard(b);
    const mv = computeNext(vis);
    if (!mv) {
      // sin jugada clara; forzamos una revelación con mínima prob (greedy)
      const { probs } = greedyProb(vis);
      let best: { r: number; c: number; p: number } | null = null;
      for (let r = 0; r < cfg.rows; r++)
        for (let c = 0; c < cfg.cols; c++)
          if (vis[r][c] === "H") {
            const p = probs[r][c];
            if (!best || p < best.p) best = { r, c, p };
          }
      if (!best) {
        const timeMs = Math.round(performance.now() - t0);
        return { seed, win: false, timeMs, moves, exactSteps, frontierMax: 0, visitedNodes: 0 };
      }
      const res = applyMove(b, cfg, { type: "reveal", r: best.r, c: best.c });
      moves++;
      if (res.hitMine) {
        const timeMs = Math.round(performance.now() - t0);
        return { seed, win: false, timeMs, moves, exactSteps, frontierMax: 0, visitedNodes: 0 };
      }
      continue;
    } else {
      const res = applyMove(b, cfg, { type: mv.type, r: mv.r, c: mv.c });
      moves++;
      if (mv.explain?.rule === "det" || mv.explain?.rule === "subset") exactSteps++;
      if (res.hitMine) {
        const timeMs = Math.round(performance.now() - t0);
        return { seed, win: false, timeMs, moves, exactSteps, frontierMax: 0, visitedNodes: 0 };
      }
    }
  }
}

/* ----------------------- Mensajería del worker ----------------------- */

self.onmessage = (ev: MessageEvent<WorkerMessage>) => {
  const data = ev.data;
  if (data.kind === "computeMove") {
    const move = computeNext(data.board);
    const res: ComputeResult = { kind: "computeMove", move };
    self.postMessage(res);
  } else if (data.kind === "probMap") {
    const { probs, frontierSize } = greedyProb(data.board);
    const res: ProbResult = { kind: "probMap", probs, frontierSize };
    self.postMessage(res);
  } else if (data.kind === "benchmark") {
    const payload = data as BenchmarkPayload;
    const cfg = DIFFS[payload.difficulty] || DIFFS.Beginner;
    const rows: BenchmarkRow[] = [];
    for (const seed of payload.seeds) {
      rows.push(simulateGame(cfg, seed));
    }
    const res: BenchmarkResult = { kind: "benchmark", rows };
    self.postMessage(res);
  }
};
