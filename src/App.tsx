import React, { useEffect, useMemo, useRef, useState } from "react";
import type { VisibleBoard, NextMove, ProbMap, ExplainStep, BenchmarkResult, BenchmarkRow } from "./solver/types";
import initSqlJs, { type Database } from "sql.js";
import { ReplayRecorder, type Replay } from "./replay";
import ReplayPlayer from "./components/ReplayPlayer";
import BenchmarkModal from "./components/BenchmarkModal";

// Worker de IA (module)
const solverWorker = new Worker(new URL("./solver/worker.ts", import.meta.url), { type: "module" });

// -------------------- Juego: config y utilidades --------------------
const DIFFS = {
  Beginner: { rows: 9, cols: 9, mines: 10 },
  Intermediate: { rows: 16, cols: 16, mines: 40 },
  Expert: { rows: 16, cols: 30, mines: 99 },
};
type DiffKey = keyof typeof DIFFS;

const HIDDEN = 0,
  REVEALED = 1,
  FLAGGED = 2;

type Cell = { state: 0 | 1 | 2; mine: boolean; adj: number };
type Cfg = { rows: number; cols: number; mines: number };

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
function createEmptyBoard(cfg: Cfg) {
  return make2D<Cell>(cfg.rows, cfg.cols, () => ({ state: HIDDEN, mine: false, adj: 0 }));
}
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -------------------- SQLite (sql.js) helpers --------------------
type DBRun = {
  ts: number;
  difficulty: DiffKey;
  seed: number;
  result: "win" | "lose" | string;
  timeSec: number;
  aiType?: string;
  username?: string;
};

async function initDb(): Promise<Database | null> {
  try {
    const SQL1 = await initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
    const stored = localStorage.getItem("ms_db");
    const db = stored
      ? new SQL1.Database(Uint8Array.from(atob(stored), (c) => c.charCodeAt(0)))
      : new SQL1.Database();
    ensureSchema(db);
    return db;
  } catch (e) {
    console.warn("sql.js local wasm falló, intentando CDN…", e);
    try {
      const SQL2 = await initSqlJs({ locateFile: (f: string) => `https://sql.js.org/dist/${f}` });
      const stored = localStorage.getItem("ms_db");
      const db = stored
        ? new SQL2.Database(Uint8Array.from(atob(stored), (c) => c.charCodeAt(0)))
        : new SQL2.Database();
      ensureSchema(db);
      return db;
    } catch (e2) {
      console.error("No se pudo inicializar sql.js", e2);
      return null;
    }
  }
}

function ensureSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      difficulty TEXT NOT NULL,
      seed INTEGER NOT NULL,
      result TEXT NOT NULL,
      timeSec INTEGER NOT NULL,
      aiType TEXT,
      username TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_diff ON runs(difficulty);
    CREATE INDEX IF NOT EXISTS idx_runs_ts ON runs(ts);

    CREATE TABLE IF NOT EXISTS replays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      difficulty TEXT NOT NULL,
      seed INTEGER NOT NULL,
      result TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_replays_diff ON replays(difficulty);
    CREATE INDEX IF NOT EXISTS idx_replays_ts ON replays(ts);
  `);
}

function dbInsertRun(db: Database, run: DBRun) {
  const stmt = db.prepare(
    "INSERT INTO runs (ts, difficulty, seed, result, timeSec, aiType, username) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  stmt.run([run.ts, run.difficulty, run.seed, run.result, run.timeSec, run.aiType ?? null, run.username ?? null]);
  stmt.free?.();
}
function dbSelectTop(db: Database, diff: DiffKey, limit = 10): DBRun[] {
  const stmt = db.prepare(
    `SELECT ts, difficulty, seed, result, timeSec, aiType, username
     FROM runs WHERE difficulty = ? ORDER BY (result='win') DESC, timeSec ASC, ts DESC LIMIT ?`
  );
  const out: DBRun[] = [];
  stmt.bind([diff, limit]);
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    out.push({
      ts: row.ts,
      difficulty: row.difficulty,
      seed: row.seed,
      result: row.result,
      timeSec: row.timeSec,
      aiType: row.aiType ?? undefined,
      username: row.username ?? undefined,
    });
  }
  stmt.free?.();
  return out;
}
function dbInsertReplay(db: Database, replay: Replay) {
  const stmt = db.prepare(
    "INSERT INTO replays (ts, difficulty, seed, result, data) VALUES (?, ?, ?, ?, ?)"
  );
  stmt.run([
    replay.meta.startedAt,
    replay.meta.difficulty,
    replay.meta.seed,
    replay.meta.result,
    JSON.stringify(replay),
  ]);
  stmt.free?.();
}
function dbSelectRecentReplays(db: Database, limit = 10): Replay[] {
  const stmt = db.prepare(`SELECT data FROM replays ORDER BY ts DESC LIMIT ?`);
  const out: Replay[] = [];
  stmt.bind([limit]);
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    try {
      out.push(JSON.parse(row.data));
    } catch {}
  }
  stmt.free?.();
  return out;
}

function dbExportToLocalStorage(db: Database) {
  const binary = db.export();
  const b64 = btoa(String.fromCharCode.apply(null, Array.from(binary)));
  localStorage.setItem("ms_db", b64);
}

function downloadFile(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportSqlite(db: Database) {
  const binary = db.export();
  const blob = new Blob([binary], { type: "application/octet-stream" });
  downloadFile("minesweeper.sqlite", blob);
}
async function importSqlite(dbRef: React.MutableRefObject<Database | null>, file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const SQL = (await initSqlJs({ locateFile: () => "/sql-wasm.wasm" })) as any;
  const newDb = new SQL.Database(buf);
  ensureSchema(newDb);
  dbRef.current = newDb;
  dbExportToLocalStorage(newDb);
}

// -------------------- Leaderboard (SQLite o LocalStorage) --------------------
function getTopRunsLS(limit = 10, difficulty?: DiffKey): DBRun[] {
  try {
    const rows: any[] = JSON.parse(localStorage.getItem("ms_runs") || "[]");
    const filtered = difficulty ? rows.filter((r) => r.difficulty === difficulty) : rows;
    return filtered
      .sort((a, b) =>
        a.result !== b.result ? (a.result === "win" ? -1 : 1) : a.timeSec - b.timeSec
      )
      .slice(0, limit);
  } catch {
    return [];
  }
}
function Leaderboard({
  diff,
  db,
  limit = 10,
}: {
  diff: DiffKey;
  db: Database | null;
  limit?: number;
}) {
  const [rows, setRows] = useState<DBRun[]>([]);
  useEffect(() => {
    if (db) setRows(dbSelectTop(db, diff, limit));
    else setRows(getTopRunsLS(limit, diff));
  }, [db, diff, limit]);
  return (
    <div className="rounded-2xl border bg-white shadow p-3 mb-4">
      <h3 className="font-semibold mb-2">Leaderboard ({diff})</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">Sin registros aún.</p>
      ) : (
        <ul className="text-sm space-y-1">
          {rows.map((r, i) => (
            <li key={i} className="flex justify-between font-mono">
              <span>
                {r.result === "win" ? "🏆" : "💥"} {r.timeSec}s · {r.aiType || "human"}
              </span>
              <span>{new Date(r.ts).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------- App --------------------
export default function App() {
  const [diff, setDiff] = useState<DiffKey>("Beginner");
  const cfg = DIFFS[diff];

  const [seed, setSeed] = useState<number>(() => Date.now());
  const [board, setBoard] = useState<Cell[][]>(() => createEmptyBoard(cfg));
  const [alive, setAlive] = useState(true);
  const [won, setWon] = useState(false);
  const [firstClick, setFirstClick] = useState(true);
  const [flags, setFlags] = useState(0);
  const [seconds, setSeconds] = useState(0);

  // Explainable + Heatmap + Worker
  const [showExplain, setShowExplain] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [lastExplain, setLastExplain] = useState<ExplainStep | null>(null);
  const [probMap, setProbMap] = useState<ProbMap | null>(null);
  const [frontierSize, setFrontierSize] = useState(0);

  // SQLite
  const dbRef = useRef<Database | null>(null);
  const [dbReady, setDbReady] = useState(false);

  // Replays
  const recorderRef = useRef(new ReplayRecorder());
  const [replayOpen, setReplayOpen] = useState(false);
  const [currentReplay, setCurrentReplay] = useState<Replay | null>(null);

  // Benchmark
  const [benchOpen, setBenchOpen] = useState(false);
  const [benchRows, setBenchRows] = useState<BenchmarkRow[]>([]);
  const [benchRunning, setBenchRunning] = useState(false);
  const [benchN, setBenchN] = useState(50);

  // Reloj principal del juego
  useEffect(() => {
    const id = window.setInterval(() => {
      // Avanza el reloj solo si la partida está activa y no ha sido el primer clic
      if (alive && !won && !firstClick) setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [alive, won, firstClick]);

  // Asegurar estado inicial correcto al montar
  useEffect(() => {
    setAlive(true);
    setWon(false);
  }, []);

  // Inicializa la base de datos (sql.js) al cargar la app
  useEffect(() => {
    (async () => {
      const db = await initDb();
      dbRef.current = db;
      setDbReady(true);
    })();
  }, []);

  // Listener para mensajes del Web Worker de la IA
  useEffect(() => {
    const onMsg = (ev: MessageEvent<any>) => {
      const data = ev.data as ComputeResult | ProbResult | BenchmarkResult | any;

      // Recibe el siguiente movimiento calculado por la IA
      if (data?.kind === "computeMove") {
        const move: NextMove = (data as ComputeResult).move;
        if (move && showExplain) setLastExplain(move.explain);
        if (move) {
          const by = "ai" as const;
          if (move.type === "reveal") {
            recorderRef.current.push({ r: move.r, c: move.c, type: "reveal", by });
            onReveal(move.r, move.c);
          } else if (move.type === "flag") {
            recorderRef.current.push({ r: move.r, c: move.c, type: "flag", by });
            onFlag(move.r, move.c);
          }
        }
        // Recibe el mapa de probabilidades (heatmap)
      } else if (data?.kind === "probMap") {
        setProbMap((data as ProbResult).probs);
        setFrontierSize((data as ProbResult).frontierSize);
        // Recibe los resultados del benchmark
      } else if (data?.kind === "benchmark") {
        const rows = (data as BenchmarkResult).rows;
        setBenchRows(rows);
        setBenchRunning(false);
        setBenchOpen(true);
      }
    };
    solverWorker.addEventListener("message", onMsg);
    return () => solverWorker.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExplain]);

  // -------------------- Lógica de juego --------------------
  function placeMinesAvoiding(b: Cell[][], cfg: Cfg, seedNum: number, sr: number, sc: number) {
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

    const rng = mulberry32(seedNum);
    for (let i = pool.length - 1; i > 0; i++) {
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

  function revealAll(b: Cell[][]) {
    for (let r = 0; r < cfg.rows; r++)
      for (let c = 0; c < cfg.cols; c++) if (b[r][c].mine) b[r][c].state = REVEALED;
    return b;
  }

  function checkWin(b: Cell[][]) {
    let hidden = 0;
    for (let r = 0; r < cfg.rows; r++)
      for (let c = 0; c < cfg.cols; c++) if (b[r][c].state !== REVEALED) hidden++;
    if (hidden === cfg.mines) {
      setWon(true);
      setAlive(false);
      saveRun("win");
      const rep = recorderRef.current.end("win");
      saveReplay(rep);
    }
  }

  function saveReplay(rep: Replay) {
    if (dbRef.current) {
      dbInsertReplay(dbRef.current, rep);
      dbExportToLocalStorage(dbRef.current);
    }
    try {
      const arr = JSON.parse(localStorage.getItem("ms_replays") || "[]");
      arr.unshift(rep);
      localStorage.setItem("ms_replays", JSON.stringify(arr.slice(0, 20)));
    } catch {}
  }

  function onReveal(r: number, c: number) {
    if (!alive) return;
    recorderRef.current.push({ r, c, type: "reveal", by: "human" });

    setBoard((prev) => {
      const b = prev.map((row) => row.map((x) => ({ ...x })));
      if (firstClick) {
        placeMinesAvoiding(b, cfg, seed, r, c);
        setFirstClick(false);
      }
      const cell = b[r][c];
      if (cell.mine) {
        cell.state = REVEALED;
        setAlive(false);
        setWon(false);
        saveRun("lose");
        const rep = recorderRef.current.end("lose");
        saveReplay(rep);
        return revealAll(b);
      }
      if (cell.state !== HIDDEN) return prev;
      revealFlood(b, cfg, r, c);
      checkWin(b);
      return b;
    });
  }

  function onFlag(r: number, c: number) {
    if (!alive) return;
    recorderRef.current.push({ r, c, type: "flag", by: "human" });
    setBoard((prev) => {
      const b = prev.map((row) => row.map((x) => ({ ...x })));
      const cell = b[r][c];
      if (cell.state === REVEALED) return prev;
      if (cell.state === HIDDEN) {
        cell.state = FLAGGED;
        setFlags((f) => f + 1);
      } else {
        cell.state = HIDDEN;
        setFlags((f) => f - 1);
      }
      return b;
    });
  }

  function reset(newDiff?: DiffKey) {
    const d = newDiff || diff;
    const cfg2 = DIFFS[d];
    const nextSeed = Date.now();
    setDiff(d);
    setSeed(nextSeed);
    setBoard(createEmptyBoard(cfg2));
    setAlive(true);
    setWon(false);
    setFirstClick(true);
    setFlags(0);
    setSeconds(0);
    setLastExplain(null);
    setProbMap(null);
    setBenchOpen(false);
    setBenchRunning(false);
    recorderRef.current.begin(d, nextSeed);
  }

  function saveRun(result: "win" | "lose") {
    const run: DBRun = {
      ts: Date.now(),
      difficulty: diff,
      seed,
      timeSec: seconds,
      result,
      aiType: "human",
      username: "",
    };
    if (dbRef.current) {
      try {
        dbInsertRun(dbRef.current, run);
        dbExportToLocalStorage(dbRef.current);
      } catch (e) {
        console.warn("Fallo insert SQLite, fallback a LocalStorage", e);
      }
    }
    try {
      const key = "ms_runs";
      const prev: DBRun[] = JSON.parse(localStorage.getItem(key) || "[]");
      prev.push(run);
      localStorage.setItem(key, JSON.stringify(prev));
    } catch {}
  }

  function getVisibleBoard(): VisibleBoard {
    return board.map((row) =>
      row.map((cell) => {
        if (cell.state === FLAGGED) return "F";
        if (cell.state === HIDDEN) return "H";
        return cell.adj;
      })
    );
  }

  // -------------------- UI helpers --------------------
  const gridStyle = useMemo(
    () => ({ gridTemplateColumns: `repeat(${cfg.cols}, minmax(0,1fr))` }),
    [cfg.cols]
  );

  function runBenchmark() {
    if (benchRunning) return;
    // Genero N seeds determinísticas a partir del tiempo
    const base = Date.now();
    const seeds = Array.from({ length: benchN }, (_, i) => base + i * 17);
    setBenchRunning(true);
    solverWorker.postMessage({ kind: "benchmark", difficulty: diff, seeds });
  }

  // -------------------- Render --------------------
  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Minesweeper</h1>
            <select
              className="rounded-lg border px-2 py-1 text-sm"
              value={diff}
              onChange={(e) => reset(e.target.value as DiffKey)}
            >
              {Object.keys(DIFFS).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <span className="text-sm text-gray-600">⏱ {seconds}s</span>
            <span className="text-sm text-gray-600">
              🚩 {flags}/{cfg.mines}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <button
              className="px-3 py-1 rounded-xl bg-blue-600 text-white"
              onClick={() =>
                solverWorker.postMessage({ kind: "computeMove", board: getVisibleBoard() })
              }
              disabled={!alive || won}
              title="IA calcula y aplica un paso sin congelar la UI"
            >
              🤖 Paso (worker)
            </button>

            <label className="text-sm flex items-center gap-1">
              <input
                type="checkbox"
                checked={showExplain}
                onChange={(e) => setShowExplain(e.target.checked)}
              />
              Explicar IA
            </label>

            <label className="text-sm flex items-center gap-1">
              <input
                type="checkbox"
                checked={showHeatmap}
                onChange={(e) => {
                  setShowHeatmap(e.target.checked);
                  if (e.target.checked) {
                    solverWorker.postMessage({ kind: "probMap", board: getVisibleBoard() });
                  } else setProbMap(null);
                }}
              />
              Heatmap
            </label>

            <button
              className="px-3 py-1 rounded-xl bg-slate-200"
              onClick={() => solverWorker.postMessage({ kind: "probMap", board: getVisibleBoard() })}
              title="Recalcula las probabilidades sobre el estado visible"
            >
              Recalcular P()
            </button>

            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-700">N:</label>
              <input
                type="number"
                className="w-20 border rounded px-2 py-1 text-sm"
                min={5}
                max={500}
                value={benchN}
                onChange={(e) => setBenchN(Math.max(5, Math.min(500, parseInt(e.target.value || "0"))))}
                title="Cantidad de seeds a correr"
              />
              <button
                className={`px-3 py-1 rounded-xl ${benchRunning ? "bg-gray-300 text-gray-600" : "bg-emerald-600 text-white"}`}
                onClick={runBenchmark}
                disabled={benchRunning}
                title="Corre la IA en N seeds y muestra métricas"
              >
                {benchRunning ? "⏳ Benchmark…" : "🏁 Benchmark"}
              </button>
            </div>

            <button
              className="px-3 py-1 rounded-xl bg-gray-900 text-white"
              onClick={() => reset()}
              aria-label={won ? "Nueva partida" : alive ? "Reiniciar partida" : "Nueva partida"}
            >
              {won ? "🏆 Nuevo" : alive ? "🙂 Reset" : "💥 Nuevo"}
            </button>
          </div>
        </div>

        {/* Leaderboard (SQLite o LS) */}
        <Leaderboard diff={diff} db={dbRef.current} />

        {/* Export / Import DB y Replay */}
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            className="px-3 py-1 rounded-xl bg-emerald-600 text-white disabled:opacity-40"
            onClick={() => dbRef.current && exportSqlite(dbRef.current)}
            disabled={!dbReady || !dbRef.current}
            aria-label="Exportar base de datos en formato .sqlite"
          >
            ⬇️ Exportar DB (.sqlite)
          </button>

          <label className="px-3 py-1 rounded-xl bg-slate-200 cursor-pointer" aria-label="Importar base de datos">
            ⬆️ Importar DB
            <input
              type="file"
              className="hidden"
              accept=".sqlite,.db,application/octet-stream"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await importSqlite(dbRef, f);
              }}
            />
          </label>

          {/* Replays JSON */}
          <button
            className="px-3 py-1 rounded-xl bg-indigo-600 text-white"
            onClick={() => {
              let rep: Replay | null = null;
              if (dbRef.current) {
                const list = dbSelectRecentReplays(dbRef.current, 1);
                if (list.length) rep = list[0];
              }
              if (!rep) {
                try {
                  const arr = JSON.parse(localStorage.getItem("ms_replays") || "[]");
                  if (arr.length) rep = arr[0];
                } catch {}
              }
              if (!rep) return alert("No hay replays para exportar aún.");
              const blob = new Blob([JSON.stringify(rep, null, 2)], { type: "application/json" });
              downloadFile(`replay-${rep.meta.difficulty}-${rep.meta.seed}.json`, blob);
            }}
            aria-label="Exportar la última repetición en formato .json"
          >
            💾 Exportar Replay (.json)
          </button>

          <label className="px-3 py-1 rounded-xl bg-slate-200 cursor-pointer" aria-label="Importar repetición">
            📥 Importar Replay
            <input
              type="file"
              className="hidden"
              accept="application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const txt = await f.text();
                try {
                  const rep = JSON.parse(txt) as Replay;
                  setCurrentReplay(rep);
                  setReplayOpen(true);
                } catch {
                  alert("JSON inválido");
                }
              }}
            />
          </label>

          <button
            className="px-3 py-1 rounded-xl bg-purple-600 text-white"
            onClick={() => {
              let rep: Replay | null = null;
              if (dbRef.current) {
                const list = dbSelectRecentReplays(dbRef.current, 1);
                if (list.length) rep = list[0];
              }
              if (!rep) {
                try {
                  const arr = JSON.parse(localStorage.getItem("ms_replays") || "[]");
                  if (arr.length) rep = arr[0];
                } catch {}
              }
              if (!rep) return alert("No hay replays guardados.");
              setCurrentReplay(rep);
              setReplayOpen(true);
            }}
            aria-label="Ver la última repetición guardada"
          >
            ▶ Ver último Replay
          </button>
        </div>

        {/* Tablero */}
        <div className="relative z-10 rounded-2xl border bg-white shadow p-2" onContextMenu={(e) => e.preventDefault()}>
          <div className="grid gap-1" style={gridStyle}>
            {board.map((row, r) =>
              row.map((cell, c) => {
                const base =
                  "relative aspect-square select-none rounded-md flex items-center justify-center text-lg font-semibold border border-gray-300 shadow-sm";
                if (cell.state === HIDDEN) {
                  const p = showHeatmap && probMap ? probMap[r][c] : null;
                  const heat = p != null ? Math.min(1, Math.max(0, p)) : null;
                  const bg =
                    heat != null
                      ? `linear-gradient(rgba(255,0,0,${heat * 0.55}), rgba(255,0,0,${heat * 0.55}))`
                      : undefined;
                  return (
                    <button
                      key={r + "-" + c}
                      className={base + " bg-gray-200 hover:bg-gray-300"}
                      style={{ backgroundImage: bg }}
                      onClick={() => onReveal(r, c)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onFlag(r, c);
                      }}
                    >
                      {heat != null && (
                        <span className="absolute bottom-0.5 right-1 text-[10px] font-mono opacity-80">
                          {(heat * 100).toFixed(0)}%
                        </span>
                      )}
                    </button>
                  );
                }
                if (cell.state === FLAGGED)
                  return (
                    <button
                      key={r + "-" + c}
                      className={base + " bg-yellow-200 hover:bg-yellow-300"}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onFlag(r, c);
                      }}
                    >
                      🚩
                    </button>
                  );
                if (cell.mine) return <div key={r + "-" + c} className={base + " bg-rose-200"}>💣</div>;
                return (
                  <div key={r + "-" + c} className={base + " bg-white"}>
                    {cell.adj || 0}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Panel de explicación */}
        {showExplain && (
          <div className="mt-3 rounded-2xl border bg-white shadow p-3 text-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Explicación de la última jugada</h3>
              <span className="text-xs text-gray-500">Frontier: {frontierSize} celdas</span>
            </div>
            {!lastExplain ? (
              <p className="text-gray-500">Sin jugadas explicadas aún.</p>
            ) : (
              <pre className="mt-2 bg-gray-50 p-2 rounded text-xs overflow-auto">
{JSON.stringify(lastExplain, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* Reproductor de Replay */}
        <ReplayPlayer
          open={replayOpen}
          onClose={() => setReplayOpen(false)}
          replay={currentReplay}
          resetToSeed={(difficulty, seedNum) => {
            setDiff(difficulty as DiffKey);
            const cfg2 = DIFFS[difficulty as DiffKey];
            setSeed(seedNum);
            setBoard(createEmptyBoard(cfg2));
            setAlive(true);
            setWon(false);
            setFirstClick(true);
            setFlags(0);
            setSeconds(0);
            setLastExplain(null);
            setProbMap(null);
            recorderRef.current.begin(difficulty as DiffKey, seedNum);
          }}
          applyMove={(m) => {
            if (m.type === "reveal") onReveal(m.r, m.c);
            else if (m.type === "flag") onFlag(m.r, m.c);
          }}
        />

        {/* Modal Benchmark */}
        <BenchmarkModal open={benchOpen} onClose={() => setBenchOpen(false)} rows={benchRows} />
      </div>
    </div>
  );
}
