import React, { useEffect, useMemo, useRef, useState } from "react";
import initSqlJs from "sql.js";

// ---------- Config ----------
const DIFFS = {
  Beginner: { rows: 9, cols: 9, mines: 10 },
  Intermediate: { rows: 16, cols: 16, mines: 40 },
  Expert: { rows: 16, cols: 30, mines: 99 },
};

const HIDDEN = 0, REVEALED = 1, FLAGGED = 2;
type Cell = { state: 0|1|2; mine: boolean; adj: number; };
type Cfg = { rows:number; cols:number; mines:number; };

// ---------- Utils ----------
function inBounds(r:number,c:number,R:number,C:number){ return r>=0&&r<R&&c>=0&&c<C; }
function neighbors(r:number,c:number,R:number,C:number){ const v:[number,number][]=[]; for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)if(dr||dc){const nr=r+dr,nc=c+dc; if(inBounds(nr,nc,R,C)) v.push([nr,nc]);} return v; }
function make2D<T>(R:number,C:number,fn:(r:number,c:number)=>T){ const g:T[][]=Array.from({length:R},(_,r)=>Array.from({length:C},(_,c)=>fn(r,c))); return g; }
function createEmptyBoard(cfg:Cfg){ return make2D<Cell>(cfg.rows,cfg.cols,()=>({state:HIDDEN,mine:false,adj:0})); }
function formatTime(s:number){ const m=String(Math.floor(s/60)).padStart(2,"0"); const ss=String(s%60).padStart(2,"0"); return `${m}:${ss}`; }
function mulberry32(a:number){ return function(){ let t=(a+=0x6D2B79F5); t=Math.imul(t^(t>>>15), t|1); t^= t + Math.imul(t^(t>>>7), t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }

const NUM_COLORS:Record<number,string>={1:"text-blue-600",2:"text-green-600",3:"text-red-600",4:"text-indigo-700",5:"text-rose-700",6:"text-teal-600",7:"text-gray-800",8:"text-gray-600"};

// --- Leaderboard mínimo (pegalo arriba de export default function App) ---
type Run = {
  ts: number;
  difficulty: string;
  seed: number;
  timeSec: number;
  result: "win" | "lose" | string;
  aiMoves?: number;
  aiType?: string;
  username?: string;
};

function getTopRuns(limit = 10, difficulty?: string): Run[] {
  try {
    const rows: Run[] = JSON.parse(localStorage.getItem("ms_runs") || "[]");
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

function Leaderboard(props: any) {
  const diff = props?.difficulty || "Beginner";
  const limit = props?.limit ?? 10;
  const rows = getTopRuns(limit, diff);
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
// --- fin Leaderboard mínimo ---

// ---------- App ----------
export default function App(){
  const [difficulty,setDifficulty]=useState<keyof typeof DIFFS>("Beginner");
  const cfg:Cfg = DIFFS[difficulty];
  const [seed,setSeed]=useState<number>(()=>Date.now());
  const [board,setBoard]=useState<Cell[][]>(()=>createEmptyBoard(cfg));
  const [alive,setAlive]=useState(true);
  const [won,setWon]=useState(false);
  const [firstClick,setFirstClick]=useState(true);
  const [flags,setFlags]=useState(0);
  const [seconds,setSeconds]=useState(0);
  const timerRef=useRef<number|undefined>(undefined);

  // IA
  const [aiRunning,setAiRunning]=useState(false);
  const [aiSpeed,setAiSpeed]=useState(120);
  const [aiMoves,setAiMoves]=useState(0);

  // User
  const [currentUser, setCurrentUser]=useState(()=> localStorage.getItem('ms_user') || '');
  useEffect(()=>{ try{ localStorage.setItem('ms_user', currentUser||''); }catch{} },[currentUser]);

  // SQLite
  const [dbReady,setDbReady]=useState(false);
  const [sqlError,setSqlError]=useState<string|null>(null);
  const dbRef=useRef<any>(null);

  // Difficulty changes -> soft reset
  useEffect(()=>{ softReset(); /* eslint-disable-next-line */ },[difficulty]);

  // Timer
  useEffect(()=>{
    if(!alive || won || firstClick) return;
    // @ts-ignore
    timerRef.current = window.setInterval(()=> setSeconds(s=>s+1), 1000);
    return ()=> clearInterval(timerRef.current);
  },[alive,won,firstClick]);

  // Stop IA if game ends
  useEffect(()=>{ if(!alive || won) setAiRunning(false); },[alive,won]);

  // Init SQLite
  useEffect(()=>{
    let cancelled=false;
    (async ()=>{
      try{
        const SQL = await initSqlJs({ locateFile:(f)=>`https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${f}` });
        if(cancelled) return;
        const db = new SQL.Database();
        db.exec(`PRAGMA journal_mode=MEMORY;`);
        db.exec(`CREATE TABLE IF NOT EXISTS runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER,
          difficulty TEXT,
          seed INTEGER,
          timeSec INTEGER,
          result TEXT,
          aiMoves INTEGER,
          aiType TEXT,
          username TEXT
        );`);
        dbRef.current=db;
        setDbReady(true);
      }catch(e:any){ setSqlError(String(e)); }
    })();
    return ()=>{ cancelled=true; }
  },[]);

  // Global API (optional)
  useEffect(()=>{
    // @ts-ignore
    window.minesweeperAPI = {
      getVisibleState: ()=> serializeVisible(board, cfg, won, alive),
      applyMove: (m:any)=> applyMoveFromAPI(m),
      getMeta: ()=> ({ difficulty, seed, rows: cfg.rows, cols: cfg.cols, mines: cfg.mines }),
      restart: (d?:string)=> { if(d && (d in DIFFS)) setDifficulty(d as any); resetGame(); }
    };
  },[board,cfg,difficulty,seed,alive,won]);

  // IA loop
  useEffect(()=>{
    if(!aiRunning) return;
    const id = window.setInterval(()=>{
      const vis = serializeVisible(board, cfg, won, alive);
      const next = computeNextMove(vis, {mode:'prob'});
      if(!next){ setAiRunning(false); return; }
      applyMoveFromAPI(next);
      setAiMoves(m=>m+1);
    }, Math.max(60, aiSpeed));
    return ()=> clearInterval(id);
  },[aiRunning,aiSpeed,board,won,alive]);

  // ---------- Game Logic ----------
  function placeMinesAvoiding(b:Cell[][], sr:number, sc:number){
    const R=cfg.rows,C=cfg.cols,M=cfg.mines;
    const banned = new Set<number>(); banned.add(sr*C+sc); for(const [nr,nc] of neighbors(sr,sc,R,C)) banned.add(nr*C+nc);
    const pool:number[]=[];
    for(let r=0;r<R;r++) for(let c=0;c<C;c++){ const id=r*C+c; if(!banned.has(id)) pool.push(id); }
    const rng = mulberry32(seed);
    for(let i=pool.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
    for(let k=0;k<Math.min(M,pool.length);k++){ const id=pool[k]; const r=Math.floor(id/C), c=id%C; b[r][c].mine=true; }
    for(let r=0;r<R;r++) for(let c=0;c<C;c++){ let cnt=0; for(const [nr,nc] of neighbors(r,c,R,C)) if(b[nr][nc].mine) cnt++; b[r][c].adj=cnt; }
  }
  function revealFlood(b:Cell[][], r:number,c:number){
    const R=cfg.rows,C=cfg.cols; const q:[number,number][]=[];
    const push=(rr:number,cc:number)=>{ if(!inBounds(rr,cc,R,C))return; const cell=b[rr][cc]; if(cell.state!==HIDDEN||cell.mine) return; cell.state=REVEALED; if(cell.adj===0) q.push([rr,cc]); };
    push(r,c);
    while(q.length){ const [cr,cc]=q.shift()!; for(const [nr,nc] of neighbors(cr,cc,R,C)) push(nr,nc); }
  }
  function countHidden(b:Cell[][]){ let h=0; for(let r=0;r<cfg.rows;r++) for(let c=0;c<cfg.cols;c++) if(b[r][c].state!==REVEALED) h++; return h; }
  function checkWin(b:Cell[][]){ const hidden=countHidden(b); if(hidden===cfg.mines){ setWon(true); setAlive(false); play("win"); saveRun({result:'win'}); } }
  function onReveal(r:number,c:number){ if(!alive) return; setBoard(prev=>{ const b=prev.map(row=>row.map(x=>({...x}))); const cell=b[r][c]; if(cell.state!==HIDDEN) return prev;
    if(firstClick){ placeMinesAvoiding(b,r,c); setFirstClick(false); }
    if(b[r][c].mine){ b[r][c].state=REVEALED; setAlive(false); setWon(false); play("boom"); saveRun({result:'lose'}); return revealAll(b); }
    revealFlood(b,r,c); play("reveal"); checkWin(b); return b; }); }
  function onFlag(r:number,c:number){ if(!alive) return; setBoard(prev=>{ const b=prev.map(row=>row.map(x=>({...x}))); const cell=b[r][c]; if(cell.state===REVEALED) return prev;
    if(cell.state===HIDDEN){ cell.state=FLAGGED; setFlags(f=>f+1); play("flag"); } else { cell.state=HIDDEN; setFlags(f=>f-1); play("unflag"); } return b; }); }
  function onChord(r:number,c:number){ if(!alive) return; setBoard(prev=>{ const b=prev.map(row=>row.map(x=>({...x}))); const cell=b[r][c]; if(cell.state!==REVEALED) return prev;
    const neigh=neighbors(r,c,cfg.rows,cfg.cols); const f=neigh.reduce((a,[nr,nc])=>a+(b[nr][nc].state===FLAGGED?1:0),0); if(f!==cell.adj) return prev;
    for(const [nr,nc] of neigh) if(b[nr][nc].state===HIDDEN){ if(b[nr][nc].mine){ b[nr][nc].state=REVEALED; setAlive(false); setWon(false); play("boom"); saveRun({result:'lose'}); return revealAll(b);} revealFlood(b,nr,nc); }
    play("reveal"); checkWin(b); return b; }); }
  function revealAll(b:Cell[][]){ for(let r=0;r<cfg.rows;r++) for(let c=0;c<cfg.cols;c++) if(b[r][c].mine) b[r][c].state=REVEALED; return b; }
  function resetGame(){ setSeed(Date.now()); setBoard(createEmptyBoard(cfg)); setAlive(true); setWon(false); setFirstClick(true); setFlags(0); setSeconds(0); setAiRunning(false); setAiMoves(0); play("reset"); }
  function softReset(){ setBoard(createEmptyBoard(cfg)); setAlive(true); setWon(false); setFirstClick(true); setFlags(0); setSeconds(0); setAiRunning(false); setAiMoves(0); }

  function serializeVisible(b:Cell[][], cfg:Cfg, won:boolean, alive:boolean){
    return b.map(row=> row.map(cell=>{
      if(cell.state===FLAGGED) return "F";
      if(cell.state===HIDDEN) return "H";
      if(cell.mine) return won?"*":cell.adj;
      return cell.adj;
    }));
  }
  function applyMoveFromAPI(move:any){ const {type,r,c}=move||{}; if(type==="reveal") onReveal(r,c); else if(type==="flag") onFlag(r,c); else if(type==="chord") onChord(r,c); }

  // ---------- Sounds ----------
  function play(id:string){ const el = document.getElementById(`sfx-${id}`) as HTMLAudioElement|null; if(el){ try{ el.currentTime=0; el.play(); }catch{} } }

  // ---------- Persistence ----------
  function saveRun({result}:{result:'win'|'lose'}){
    // LocalStorage
    try{
      const key='ms_runs';
      const prev = JSON.parse(localStorage.getItem(key)||'[]');
      const rec = {
        ts: Date.now(), difficulty, seed, timeSec: seconds, result,
        aiMoves, aiType: (aiMoves>0 ? 'prob' : 'human'), user: (currentUser||'')
      };
      prev.push(rec);
      localStorage.setItem(key, JSON.stringify(prev));
    }catch{}
    // SQLite
    try{
      if(dbReady && dbRef.current){
        const db = dbRef.current;
        try { db.exec("ALTER TABLE runs ADD COLUMN username TEXT;"); } catch(_){}
        const stmt = db.prepare(`INSERT INTO runs (ts,difficulty,seed,timeSec,result,aiMoves,aiType,username) VALUES (?,?,?,?,?,?,?,?);`);
        stmt.run([Date.now(), difficulty, seed, seconds, result, aiMoves, (aiMoves>0?'prob':'human'), (currentUser||'') ]);
        stmt.free();
      }
    }catch(e:any){ setSqlError(String(e)); }
  }
  function getTopRuns({limit=10, only='all'}:{limit?:number, only?:'all'|'ai'|'human'}={}){
    try{
      const rows = JSON.parse(localStorage.getItem('ms_runs')||'[]');
      const filtered = rows.filter((r:any)=> r.difficulty===difficulty && (only==='all' || (only==='ai' ? r.aiType!=='human' : r.aiType==='human')) );
      const ranked = filtered.sort((a:any,b:any)=> a.result!==b.result ? (a.result==='win'?-1:1) : (a.timeSec - b.timeSec));
      return ranked.slice(0,limit);
    }catch{ return []; }
  }
  function toCSV(rows:any[]){
    if(!rows||!rows.length) return "ts,difficulty,seed,timeSec,result,aiMoves,aiType,user\n";
    const head=["ts","difficulty","seed","timeSec","result","aiMoves","aiType","user"];
    const esc=(v:any)=>`"${String(v??"").replace(/"/g,'""')}"`;
    const lines = rows.map(r=> head.map(k=>esc(r[k])).join(","));
    return head.join(",")+"\n"+lines.join("\n");
  }
  function exportRuns(){ try{ const rows=JSON.parse(localStorage.getItem('ms_runs')||'[]'); const blob=new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='ms_runs.json'; a.click(); URL.revokeObjectURL(url);}catch{} }
  function exportRunsCSV(){ try{ const rows=JSON.parse(localStorage.getItem('ms_runs')||'[]'); const blob=new Blob([toCSV(rows)],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='ms_runs.csv'; a.click(); URL.revokeObjectURL(url);}catch{} }
  async function importRuns(file:File){ try{ const text=await file.text(); const arr=JSON.parse(text); const key='ms_runs'; const prev=JSON.parse(localStorage.getItem(key)||'[]'); localStorage.setItem(key, JSON.stringify(prev.concat(arr))); }catch{} }
  async function exportSqlite(){ try{ if(!dbReady||!dbRef.current) return; const data=dbRef.current.export(); const blob=new Blob([data],{type:'application/octet-stream'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='minesweeper.sqlite'; a.click(); URL.revokeObjectURL(url);}catch(e:any){ setSqlError(String(e)); } }
  async function importSqlite(file:File){ try{ const buf=new Uint8Array(await file.arrayBuffer()); const SQL=await initSqlJs({ locateFile:(f)=>`https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${f}` }); const newdb=new SQL.Database(buf); dbRef.current=newdb; setDbReady(true); }catch(e:any){ setSqlError(String(e)); } }

  // ---------- IA ----------
  function computeNextMove(vis:any[][], opts:{mode:'prob'|'det'}={mode:'prob'}){
    if(!vis || !vis.length) return null; const R=vis.length, C=vis[0].length;
    // Determinísticas
    for(let r=0;r<R;r++) for(let c=0;c<C;c++){
      const val=vis[r][c]; if(typeof val!=="number"||val===0) continue; const neigh=neighbors(r,c,R,C);
      let flags=0, hidden:[number,number][]=[]; for(const [nr,nc] of neigh){ const v=vis[nr][nc]; if(v==="F") flags++; else if(v==="H") hidden.push([nr,nc]); }
      if(hidden.length && flags===val){ const [nr,nc]=hidden[0]; return {type:'reveal', r:nr, c:nc}; }
      if(hidden.length && flags+hidden.length===val){ const [nr,nc]=hidden[0]; return {type:'flag', r:nr, c:nc}; }
    }
    const ded = subsetDeductions(vis); if(ded) return ded;
    const exact = exactFrontierMove(vis, 18); if(exact) return exact;
    if(opts.mode==='det'){ const cands:[number,number][]= []; for(let r=0;r<R;r++) for(let c=0;c<C;c++) if(vis[r][c]==='H') cands.push([r,c]); if(!cands.length) return null; const [rr,cc]=cands[Math.floor(Math.random()*cands.length)]; return {type:'reveal', r:rr, c:cc}; }
    return greedyProbabilistic(vis);
  }
  function subsetDeductions(vis:any[][]){
    const R=vis.length,C=vis[0].length;
    const numbered:[number,number][]= []; for(let r=0;r<R;r++) for(let c=0;c<C;c++) if(typeof vis[r][c]==='number'&&vis[r][c]>0) numbered.push([r,c]);
    const neighOf=(r:number,c:number)=>{const v:[number,number][]=[]; for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(dr||dc){const nr=r+dr,nc=c+dc; if(nr>=0&&nr<R&&nc>=0&&nc<C) v.push([nr,nc]);} return v;};
    const sets:{cells:Set<string>, need:number}[]=[];
    for(const [r,c] of numbered){ const neigh=neighOf(r,c); const cells:string[]=[]; let flags=0; for(const [nr,nc] of neigh){ const v=vis[nr][nc]; if(v==='H') cells.push(`${nr},${nc}`); else if(v==='F') flags++; } const need=vis[r][c]-flags; if(cells.length>0 && need>=0) sets.push({cells:new Set(cells), need}); }
    for(let i=0;i<sets.length;i++) for(let j=0;j<sets.length;j++) if(i!==j){ const A=sets[i], B=sets[j]; if(A.cells.size===0||B.cells.size===0) continue; let sub=true; for(const x of A.cells){ if(!B.cells.has(x)){ sub=false; break; } } if(!sub) continue; const diff:string[]=[]; for(const x of B.cells){ if(!A.cells.has(x)) diff.push(x); } if(!diff.length) continue; const nb=B.need - A.need; if(nb===diff.length && nb>0){ const [rr,cc]=diff[0].split(',').map(Number); return {type:'flag', r:rr, c:cc}; } if(B.need===A.need){ const [rr,cc]=diff[0].split(',').map(Number); return {type:'reveal', r:rr, c:cc}; } }
    return null;
  }
  function greedyProbabilistic(vis:any[][]){
    const R=vis.length,C=vis[0].length; const sums=Array.from({length:R},()=>Array(C).fill(0)); const counts=Array.from({length:R},()=>Array(C).fill(0));
    const hidden:[number,number][]= []; for(let r=0;r<R;r++) for(let c=0;c<C;c++) if(vis[r][c]==='H') hidden.push([r,c]); if(!hidden.length) return null;
    const neighOf=(r:number,c:number)=>{const v:[number,number][]=[]; for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(dr||dc){const nr=r+dr,nc=c+dc; if(nr>=0&&nr<R&&nc>=0&&nc<C) v.push([nr,nc]);} return v;};
    for(let r=0;r<R;r++) for(let c=0;c<C;c++){ const val=vis[r][c]; if(typeof val!=='number'||val===0) continue; const neigh=neighOf(r,c); let flags=0,h:[number,number][]=[]; for(const [nr,nc] of neigh){ const v=vis[nr][nc]; if(v==='F') flags++; else if(v==='H') h.push([nr,nc]); } const need=val-flags; if(h.length>0 && need>=0){ const contrib=Math.min(1,Math.max(0,need/h.length)); for(const [nr,nc] of h){ sums[nr][nc]+=contrib; counts[nr][nc]+=1; } } }
    let best:any=null, bp=Infinity, flag:any=null; for(const [r,c] of hidden){ const p = counts[r][c]>0 ? (sums[r][c]/counts[r][c]) : 0.5; if(p>=1) flag=flag||{type:'flag', r, c}; if(p<bp){ bp=p; best={type:'reveal', r, c}; } } return flag||best;
  }
  function exactFrontierMove(vis:any[][], maxFrontier=18){
    const R=vis.length, C=vis[0].length;
    const isHidden=(r:number,c:number)=>vis[r][c]==='H';
    const neighOf=(r:number,c:number)=>{const v:[number,number][]=[]; for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(dr||dc){const nr=r+dr,nc=c+dc; if(nr>=0&&nr<R&&nc>=0&&nc<C) v.push([nr,nc]);} return v;};
    const frontierSet=new Set<string>();
    for(let r=0;r<R;r++) for(let c=0;c<C;c++) if(typeof vis[r][c]==='number'){ for(const [nr,nc] of neighOf(r,c)) if(isHidden(nr,nc)) frontierSet.add(`${nr},${nc}`); }
    const frontier = [...frontierSet].map(s=>s.split(',').map(Number));
    if(frontier.length===0 || frontier.length>maxFrontier) return null;
    const index = new Map<string,number>(); frontier.forEach(([r,c],i)=> index.set(`${r},${c}`,i));
    const constraints:{vars:number[], need:number}[]=[];
    for(let r=0;r<R;r++) for(let c=0;c<C;c++) if(typeof vis[r][c]==='number'){ const neigh=neighOf(r,c); let flags=0; const vars:number[]=[]; for(const [nr,nc] of neigh){ const v=vis[nr][nc]; if(v==='F') flags++; else if(v==='H' && index.has(`${nr},${nc}`)) vars.push(index.get(`${nr},${nc}`)!); } const need=vis[r][c]-flags; if(vars.length>0) constraints.push({vars, need: Math.max(0, Math.min(need, vars.length))}); }
    if(!constraints.length) return null;
    const N=frontier.length; const assign = new Array(N).fill(-1); let solutions=0; const mineCount=new Array(N).fill(0);
    const varToCons:number[][] = Array.from({length:N},()=>[]); constraints.forEach((c,ci)=> c.vars.forEach(v=>varToCons[v].push(ci)));
    function ok(ci:number){ const {vars,need}=constraints[ci]; let s=0,u=0; for(const v of vars){ const a=assign[v]; if(a===1) s++; else if(a===-1) u++; } if(s>need) return false; if(s+u<need) return false; return true; }
    function pick(){ let best=-1,sc=1e9; for(let i=0;i<N;i++) if(assign[i]===-1){ const k=varToCons[i].length; if(k<sc){ sc=k; best=i; } } return best; }
    function dfs(){ const v=pick(); if(v===-1){ solutions++; for(let i=0;i<N;i++) if(assign[i]===1) mineCount[i]++; return; } for(const val of [0,1]){ assign[v]=val; let good=true; for(const ci of varToCons[v]) if(!ok(ci)){ good=false; break; } if(good) dfs(); assign[v]=-1; } }
    dfs(); if(solutions<=0) return null;
    let best:any=null, bp=Infinity, flag:any=null;
    for(let i=0;i<N;i++){ const [r,c]=frontier[i]; const p=mineCount[i]/solutions; if(p>=0.999) flag=flag||{type:'flag', r, c}; if(p<bp){ bp=p; best={type:'reveal', r, c}; } }
    return flag||best;
  }

  const remainingMines = Math.max(0, cfg.mines - flags);

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Minesweeper</h1>
          <div className="flex items-center gap-2">
            <input className="px-2 py-1 rounded border bg-white shadow-sm" placeholder="Usuario (opcional)" value={currentUser} onChange={e=>setCurrentUser(e.target.value)} />
            <select className="px-2 py-1 rounded border bg-white shadow-sm" value={difficulty} onChange={(e)=>setDifficulty(e.target.value as any)}>
              {Object.keys(DIFFS).map(k=> <option key={k} value={k}>{k}</option>)}
            </select>
            <button className="px-3 py-1 rounded-xl bg-gray-900 text-white shadow hover:opacity-90" onClick={resetGame}>
              {won?"🏆 Nuevo": alive? "🙂 Reset":"💥 Nuevo"}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat label="Minas" value={remainingMines.toString().padStart(3,"0")} />
          <Stat label="Tiempo" value={formatTime(seconds)} />
          <Stat label="Seed" value={String(seed).slice(-6)} />
          <Stat label="IA moves" value={String(aiMoves)} />
        </div>

        {/* Leaderboard */}
        <Leaderboard getTopRuns={getTopRuns} />

        {/* Board */}
        <BoardUI
          board={board}
          cfg={cfg}
          onCellClick={(e:any,r:number,c:number)=>{ e.preventDefault(); if(e.type==="click") onReveal(r,c); }}
          onCellContext={(e:any,r:number,c:number)=>{ e.preventDefault(); onFlag(r,c); }}
          onCellDoubleClick={(e:any,r:number,c:number)=>{ e.preventDefault(); onChord(r,c); }}
        />

        {/* IA Controls */}
        <div className="mt-4 rounded-2xl border bg-white shadow p-3 flex flex-wrap items-center gap-3">
          <button className={`px-3 py-1 rounded-xl text-white ${aiRunning?"bg-rose-600":"bg-blue-600"}`} onClick={()=>setAiRunning(v=>!v)}>
            {aiRunning?"⏸️ Pausa IA":"🤖 Jugar IA"}
          </button>
          <button className="px-3 py-1 rounded-xl bg-gray-200" onClick={()=>{ const next=computeNextMove(serializeVisible(board,cfg,won,alive)); if(next) applyMoveFromAPI(next); setAiMoves(m=>m+1); }}>Paso</button>
          <label className="text-sm text-gray-600">Velocidad IA: {aiSpeed}ms</label>
          <input type="range" min={60} max={1000} step={10} value={aiSpeed} onChange={(e)=>setAiSpeed(parseInt((e.target as HTMLInputElement).value))} />
        </div>

        {/* Data */}
        <div className="mt-3 rounded-2xl border bg-white shadow p-3 flex flex-wrap items-center gap-3">
          <button className="px-3 py-1 rounded-xl bg-gray-200" onClick={exportRuns}>Exportar runs</button>
          <button className="px-3 py-1 rounded-xl bg-gray-200" onClick={exportRunsCSV}>Exportar runs (CSV)</button>
          <label className="text-sm text-gray-600">Importar runs JSON
            <input type="file" accept="application/json" className="ml-2" onChange={(e)=>{const f=(e.target as HTMLInputElement).files?.[0]; if(f) importRuns(f);}} />
          </label>
          <button className="px-3 py-1 rounded-xl bg-gray-200" onClick={exportSqlite}>Exportar DB (.sqlite)</button>
          <label className="text-sm text-gray-600">Importar DB (.sqlite)
            <input type="file" accept="application/octet-stream,.sqlite" className="ml-2" onChange={(e)=>{const f=(e.target as HTMLInputElement).files?.[0]; if(f) importSqlite(f);}} />
          </label>
          {sqlError && <span className="text-sm text-rose-600">{sqlError}</span>}
        </div>

        <p className="mt-4 text-sm text-gray-600">Click izq: revelar · Click der: bandera · Doble click: chord</p>

        {won && <WinOverlay onClose={resetGame} time={formatTime(seconds)} difficulty={difficulty} />}

      </div>

      {/* SFX placeholders */}
      <audio id="sfx-reveal" src="" preload="auto" />
      <audio id="sfx-flag" src="" preload="auto" />
      <audio id="sfx-unflag" src="" preload="auto" />
      <audio id="sfx-boom" src="" preload="auto" />
      <audio id="sfx-win" src="" preload="auto" />
      <audio id="sfx-reset" src="" preload="auto" />
    </div>
  );
}

function Stat({label, value}:{label:string, value:string}){
  return (
    <div className="rounded-2xl border bg-white shadow p-3 flex items-center justify-between">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="font-mono text-xl">{value}</span>
    </div>
  );
}

function BoardUI({board,cfg,onCellClick,onCellContext,onCellDoubleClick}:{board:Cell[][], cfg:Cfg, onCellClick:any, onCellContext:any, onCellDoubleClick:any}){
  const gridStyle = useMemo(()=>({ gridTemplateColumns: `repeat(${cfg.cols}, minmax(0, 1fr))` }),[cfg.cols]);
  return (
    <div className="rounded-2xl border bg-white shadow p-2" onContextMenu={e=>e.preventDefault()}>
      <div className="grid gap-1" style={gridStyle}>
        {board.map((row,r)=> row.map((cell,c)=> (
          <CellUI key={`${r}-${c}`} cell={cell} onClick={(e:any)=>onCellClick(e,r,c)} onContextMenu={(e:any)=>onCellContext(e,r,c)} onDoubleClick={(e:any)=>onCellDoubleClick(e,r,c)} />
        )))}
      </div>
    </div>
  );
}

function CellUI({cell,onClick,onContextMenu,onDoubleClick}:{cell:Cell,onClick:any,onContextMenu:any,onDoubleClick:any}){
  const base = "aspect-square select-none rounded-md flex items-center justify-center text-lg font-semibold border border-gray-300 shadow-sm";
  if(cell.state===HIDDEN) return (<button className={base+" bg-gray-200 hover:bg-gray-300 active:translate-y-px"} onClick={onClick} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick} aria-label="hidden" />);
  if(cell.state===FLAGGED) return (<button className={base+" bg-yellow-200 hover:bg-yellow-300 active:translate-y-px"} onClick={onClick} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick} aria-label="flag">🚩</button>);
  if(cell.mine) return (<div className={base+" bg-rose-200"} aria-label="mine">💣</div>);
  const num = cell.adj;
  return (<div className={base+" bg-white "+(num?NUM_COLORS[num]:"text-transparent")} onDoubleClick={onDoubleClick} aria-label={num?String(num):"empty"}>{num||0}</div>);
}

function WinOverlay({onClose,time,difficulty}:{onClose:()=>void,time:string,difficulty:string}){
  const confetti = Array.from({length:60}).map((_,i)=>({
    id:i,left: Math.random()*100,delay: Math.random()*0.6,duration: 2 + Math.random()*1.5,rotate: Math.random()*360,char: ["🎉","🎊","✨","⭐","🎈"][Math.floor(Math.random()*5)]
  }));
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border">
        <h2 className="text-2xl font-bold text-center">¡Victoria! 🏆</h2>
        <p className="text-center mt-2 text-gray-700">Tiempo: <span className="font-mono">{time}</span> · Dificultad: {difficulty}</p>
        <div className="flex gap-3 mt-6 justify-center">
          <button className="px-4 py-2 rounded-xl bg-gray-900 text-white" onClick={onClose}>Jugar de nuevo</button>
        </div>
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {confetti.map(c=> (
            <span key={c.id} style={{ left: `${c.left}%`, animation: `fall ${c.duration}s linear ${c.delay}s forwards`, transform:`rotate(${c.rotate}deg)`, top: '-10%' }} className="absolute text-2xl">{c.char}</span>
          ))}
        </div>
      </div>
      <style>{`@keyframes fall{0%{transform:translateY(-10vh) rotate(0deg)}100%{transform:translateY(80vh) rotate(360deg)}}`}</style>
    </div>
  );
}
