import React, { useMemo } from "react";
import type { BenchmarkRow } from "../solver/types";

export default function BenchmarkModal({
  open,
  onClose,
  rows,
}: {
  open: boolean;
  onClose: () => void;
  rows: BenchmarkRow[];
}) {
  const summary = useMemo(() => {
    if (!rows.length) return null;
    const wins = rows.filter((r) => r.win).length;
    const wr = (wins / rows.length) * 100;
    const avgTime = Math.round(rows.reduce((a, b) => a + b.timeMs, 0) / rows.length);
    const avgMoves = Math.round(rows.reduce((a, b) => a + b.moves, 0) / rows.length);
    const avgExact = Math.round(rows.reduce((a, b) => a + b.exactSteps, 0) / rows.length);
    return { wr, avgTime, avgMoves, avgExact, total: rows.length, wins };
  }, [rows]);

  function toCSV(rows: BenchmarkRow[]) {
    const head = ["seed", "win", "timeMs", "moves", "exactSteps", "frontierMax", "visitedNodes"];
    const body = rows.map((r) =>
      [r.seed, r.win ? 1 : 0, r.timeMs, r.moves, r.exactSteps, r.frontierMax, r.visitedNodes].join(",")
    );
    return [head.join(","), ...body].join("\n");
  }

  function downloadCsv() {
    const blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "benchmark.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Resultados del Benchmark</h3>
          <div className="flex gap-2">
            <button className="px-3 py-1 rounded bg-slate-200" onClick={downloadCsv}>
              Exportar CSV
            </button>
            <button className="px-3 py-1 rounded bg-slate-200" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>

        {!summary ? (
          <p className="text-sm text-gray-500">No hay datos.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
              <div className="rounded-lg border p-2">
                <div className="text-gray-500">Runs</div>
                <div className="text-lg font-semibold">{summary.total}</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-gray-500">Wins</div>
                <div className="text-lg font-semibold">{summary.wins}</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-gray-500">Win Rate</div>
                <div className="text-lg font-semibold">{summary.wr.toFixed(1)}%</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-gray-500">Tiempo medio</div>
                <div className="text-lg font-semibold">{summary.avgTime} ms</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-gray-500">Movimientos medios</div>
                <div className="text-lg font-semibold">{summary.avgMoves}</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-gray-500">Pasos exactos (medios)</div>
                <div className="text-lg font-semibold">{summary.avgExact}</div>
              </div>
            </div>

            <div className="max-h-80 overflow-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-2">Seed</th>
                    <th className="text-left p-2">Win</th>
                    <th className="text-left p-2">Time (ms)</th>
                    <th className="text-left p-2">Moves</th>
                    <th className="text-left p-2">Exact</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2 font-mono">{r.seed}</td>
                      <td className="p-2">{r.win ? "✅" : "❌"}</td>
                      <td className="p-2">{r.timeMs}</td>
                      <td className="p-2">{r.moves}</td>
                      <td className="p-2">{r.exactSteps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
