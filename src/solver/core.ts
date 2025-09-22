import { ExplainStep, NextMove, ProbMap, VisibleBoard } from "./types";

function neighbors(r: number, c: number, R: number, C: number) {
  const v: [number, number][] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      if (dr || dc) {
        const nr = r + dr,
          nc = c + dc;
        if (nr >= 0 && nr < R && nc >= 0 && nc < C) v.push([nr, nc]);
      }
  return v;
}

/** Determinístico clásico */
export function deterministicMove(board: VisibleBoard): NextMove {
  const R = board.length,
    C = board[0].length;
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      const v = board[r][c];
      if (typeof v !== "number" || v === 0) continue;
      let flags = 0;
      const hidden: [number, number][] = [];
      for (const [nr, nc] of neighbors(r, c, R, C)) {
        const cell = board[nr][nc];
        if (cell === "F") flags++;
        else if (cell === "H") hidden.push([nr, nc]);
      }
      if (hidden.length === 0) continue;
      // Todas seguras
      if (flags === v) {
        const [rr, cc] = hidden[0];
        return {
          type: "reveal",
          r: rr,
          c: cc,
          explain: { rule: "det", cells: hidden.map(([x, y]) => ({ r: x, c: y })) },
        };
      }
      // Todas minas
      if (flags + hidden.length === v) {
        const [rr, cc] = hidden[0];
        return {
          type: "flag",
          r: rr,
          c: cc,
          explain: { rule: "det", cells: hidden.map(([x, y]) => ({ r: x, c: y })) },
        };
      }
    }
  return null;
}

/** Subset simple: si H(A) ⊆ H(B) comparamos necesidades */
export function subsetMove(board: VisibleBoard): NextMove {
  const R = board.length,
    C = board[0].length;
  type Node = { r: number; c: number; num: number; H: [number, number][]; F: number };
  const nodes: Node[] = [];
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      const v = board[r][c];
      if (typeof v !== "number" || v === 0) continue;
      let F = 0;
      const H: [number, number][] = [];
      for (const [nr, nc] of neighbors(r, c, R, C)) {
        const cell = board[nr][nc];
        if (cell === "F") F++;
        else if (cell === "H") H.push([nr, nc]);
      }
      if (H.length) nodes.push({ r, c, num: v, H, F });
    }

  // Busca A,B con H(A) ⊆ H(B)
  for (let i = 0; i < nodes.length; i++)
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const A = nodes[i],
        B = nodes[j];
      if (A.H.length === 0 || B.H.length === 0) continue;
      const setB = new Set(B.H.map(([x, y]) => `${x},${y}`));
      if (!A.H.every(([x, y]) => setB.has(`${x},${y}`))) continue;
      const needA = A.num - A.F;
      const needB = B.num - B.F;
      const diff = B.H.filter(([x, y]) => !A.H.find(([a, b]) => a === x && b === y)); // B\A
      if (diff.length === 0) continue;

      // Caso 1: iguales necesidades => B\A seguras
      if (needB === needA) {
        const [rr, cc] = diff[0];
        return {
          type: "reveal",
          r: rr,
          c: cc,
          explain: {
            rule: "subset",
            cells: diff.map(([x, y]) => ({ r: x, c: y })),
            details: { needA, needB, subset: "A⊆B" },
          },
        };
      }
      // Caso 2: need(B)-need(A) == |B\A| => B\A minas
      if (needB - needA === diff.length) {
        const [rr, cc] = diff[0];
        return {
          type: "flag",
          r: rr,
          c: cc,
          explain: {
            rule: "subset",
            cells: diff.map(([x, y]) => ({ r: x, c: y })),
            details: { needA, needB, subset: "A⊆B" },
          },
        };
      }
    }
  return null;
}

/** Probabilidades “greedy” por promedio de necesidades locales */
export function greedyProb(board: VisibleBoard): { probs: ProbMap; frontierSize: number } {
  const R = board.length,
    C = board[0].length;
  const sums = Array.from({ length: R }, () => Array(C).fill(0));
  const cnts = Array.from({ length: R }, () => Array(C).fill(0));
  const hidden: [number, number][] = [];

  const frontier = new Set<string>();
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++)
      if (board[r][c] === "H") {
        hidden.push([r, c]);
        for (const [nr, nc] of neighbors(r, c, R, C)) {
          if (typeof board[nr][nc] === "number" && board[nr][nc] as number > 0) {
            frontier.add(`${r},${c}`);
          }
        }
      }

  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      const v = board[r][c];
      if (typeof v !== "number" || v === 0) continue;
      let F = 0;
      const H: [number, number][] = [];
      for (const [nr, nc] of neighbors(r, c, R, C)) {
        const cell = board[nr][nc];
        if (cell === "F") F++;
        else if (cell === "H") H.push([nr, nc]);
      }
      const need = v - F;
      if (H.length > 0 && need >= 0) {
        const contrib = Math.min(1, Math.max(0, need / H.length));
        for (const [nr, nc] of H) {
          sums[nr][nc] += contrib;
          cnts[nr][nc] += 1;
        }
      }
    }

  const probs: ProbMap = Array.from({ length: R }, () => Array(C).fill(0.5));
  for (const [r, c] of hidden) {
    probs[r][c] = cnts[r][c] > 0 ? sums[r][c] / cnts[r][c] : 0.5;
  }
  return { probs, frontierSize: frontier.size };
}

/** Decide siguiente jugada: det → subset → prob */
export function computeNext(board: VisibleBoard): NextMove {
  const det = deterministicMove(board);
  if (det) return det;
  const sub = subsetMove(board);
  if (sub) return sub;

  const { probs } = greedyProb(board);
  let best: { r: number; c: number; p: number } | null = null;
  for (let r = 0; r < board.length; r++)
    for (let c = 0; c < board[0].length; c++)
      if (board[r][c] === "H") {
        const p = probs[r][c];
        if (!best || p < best.p) best = { r, c, p };
      }
  if (!best) return null;
  return {
    type: "reveal",
    r: best.r,
    c: best.c,
    explain: { rule: "prob", cells: [{ r: best.r, c: best.c }], details: { p: best.p } },
  };
}
