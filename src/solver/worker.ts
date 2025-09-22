/// <reference lib="webworker" />
import {
  BenchmarkPayload,
  BenchmarkResult,
  ComputePayload,
  ComputeResult,
  ProbPayload,
  ProbResult,
  WorkerMessage,
} from "./types";
import { computeNext, greedyProb } from "./core";

declare const self: DedicatedWorkerGlobalScope;

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
    // Esqueleto simple: acá podrías simular partidas completas con tus generadores
    // Por ahora devolvemos estructura vacía para no bloquear UI.
    const res: BenchmarkResult = {
      kind: "benchmark",
      rows: data.seeds.map((s) => ({
        seed: s,
        win: false,
        timeMs: 0,
        moves: 0,
        exactSteps: 0,
        frontierMax: 0,
        visitedNodes: 0,
      })),
    };
    self.postMessage(res);
  }
};
