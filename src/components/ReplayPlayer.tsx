import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Replay } from "../replay";

type Props = {
  open: boolean;
  onClose: () => void;
  replay: Replay | null;
  // callbacks que debe proveer App:
  applyMove: (m: Replay["moves"][number]) => void;
  resetToSeed: (difficulty: string, seed: number) => void;
};

export default function ReplayPlayer({ open, onClose, replay, applyMove, resetToSeed }: Props) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1); // 1x, 2x, 4x...
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!replay) return;
    // al abrir, reinicia tablero a misma seed/dif que el replay
    resetToSeed(replay.meta.difficulty, replay.meta.seed);
    setI(0);
    setPlaying(false);
  }, [open]);

  useEffect(() => {
    if (!playing || !replay) return;
    const step = () => {
      if (i >= replay.moves.length) {
        setPlaying(false);
        return;
      }
      applyMove(replay.moves[i]);
      setI((x) => x + 1);
      timer.current = window.setTimeout(step, Math.max(30, 250 / speed));
    };
    timer.current = window.setTimeout(step, 300 / speed);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [playing, i, replay, speed]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl p-4 w-full max-w-xl">
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-semibold">Reproductor de Replay</h3>
          <button className="text-sm px-2 py-1 rounded bg-slate-200" onClick={onClose}>Cerrar</button>
        </div>

        {!replay ? (
          <p className="text-sm text-gray-500">No hay replay cargado.</p>
        ) : (
          <>
            <div className="text-xs text-gray-600 mb-2">
              {replay.meta.difficulty} · seed {replay.meta.seed} · {replay.meta.result} · {(replay.meta.durationMs/1000).toFixed(1)}s · {replay.moves.length} jugadas
            </div>

            <div className="flex items-center gap-2 mb-2">
              <button
                className="px-3 py-1 rounded bg-emerald-600 text-white"
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? "Pausa" : "Play"}
              </button>
              <button
                className="px-3 py-1 rounded bg-slate-200"
                onClick={() => {
                  setPlaying(false);
                  if (i > 0 && replay) {
                    resetToSeed(replay.meta.difficulty, replay.meta.seed);
                    setI(0);
                  }
                }}
              >
                Reiniciar
              </button>
              <button
                className="px-3 py-1 rounded bg-slate-200"
                onClick={() => {
                  if (!replay) return;
                  if (i < replay.moves.length) {
                    applyMove(replay.moves[i]);
                    setI((x) => x + 1);
                  }
                }}
              >
                Paso ▶
              </button>
              <label className="text-sm flex items-center gap-2">
                Velocidad
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={speed}
                  onChange={(e) => setSpeed(parseInt(e.target.value))}
                />
                <span className="w-8">{speed}x</span>
              </label>
            </div>

            <div className="text-xs font-mono bg-gray-50 rounded p-2 max-h-40 overflow-auto">
              {replay.moves.slice(Math.max(0, i - 10), i + 1).map((m, idx) => (
                <div key={idx}>
                  t={m.t}ms · {m.by} · {m.type}({m.r},{m.c})
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
