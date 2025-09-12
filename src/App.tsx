import React, { useMemo, useState } from "react";

const DIFFS = { Beginner:{rows:9, cols:9, mines:10} };
const HIDDEN=0, REVEALED=1, FLAGGED=2;
type Cell = { state:0|1|2; mine:boolean; adj:number; };
type Cfg = { rows:number; cols:number; mines:number; };

function inBounds(r:number,c:number,R:number,C:number){ return r>=0&&r<R&&c>=0&&c<C; }
function neighbors(r:number,c:number,R:number,C:number){ const v:[number,number][]=[]; for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)if(dr||dc){const nr=r+dr,nc=c+dc; if(inBounds(nr,nc,R,C)) v.push([nr,nc]);} return v; }
function make2D<T>(R:number,C:number,fn:(r:number,c:number)=>T){ return Array.from({length:R},(_,r)=>Array.from({length:C},(_,c)=>fn(r,c))); }
function createEmptyBoard(cfg:Cfg){ return make2D<Cell>(cfg.rows,cfg.cols,()=>({state:HIDDEN,mine:false,adj:0})); }
function mulberry32(a:number){ return function(){ let t=(a+=0x6D2B79F5); t=Math.imul(t^(t>>>15), t|1); t^= t + Math.imul(t^(t>>>7), t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }

export default function App(){
  const cfg=DIFFS.Beginner;
  const [seed,setSeed]=useState<number>(()=>Date.now());
  const [board,setBoard]=useState<Cell[][]>(()=>createEmptyBoard(cfg));
  const [alive,setAlive]=useState(true);
  const [won,setWon]=useState(false);
  const [firstClick,setFirstClick]=useState(true);
  const [flags,setFlags]=useState(0);

  function placeMinesAvoiding(b:Cell[][], sr:number, sc:number){
    const R=cfg.rows,C=cfg.cols,M=cfg.mines;
    const banned=new Set<number>(); banned.add(sr*C+sc); for(const [nr,nc] of neighbors(sr,sc,R,C)) banned.add(nr*C+nc);
    const pool:number[]=[]; for(let r=0;r<R;r++) for(let c=0;c<C;c++){ const id=r*C+c; if(!banned.has(id)) pool.push(id); }
    const rng=mulberry32(seed); for(let i=pool.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
    for(let k=0;k<Math.min(M,pool.length);k++){ const id=pool[k]; const r=Math.floor(id/C), c=id%C; b[r][c].mine=true; }
    for(let r=0;r<R;r++) for(let c=0;c<C;c++){ let cnt=0; for(const [nr,nc] of neighbors(r,c,R,C)) if(b[nr][nc].mine) cnt++; b[r][c].adj=cnt; }
  }
  function revealFlood(b:Cell[][], r:number,c:number){
    const R=cfg.rows,C=cfg.cols; const q:[number,number][]=[];
    const push=(rr:number,cc:number)=>{ if(!inBounds(rr,cc,R,C))return; const cell=b[rr][cc]; if(cell.state!==HIDDEN||cell.mine) return; cell.state=REVEALED; if(cell.adj===0) q.push([rr,cc]); };
    push(r,c); while(q.length){ const [cr,cc]=q.shift()!; for(const [nr,nc] of neighbors(cr,cc,R,C)) push(nr,nc); }
  }
  function revealAll(b:Cell[][]){ for(let r=0;r<cfg.rows;r++) for(let c=0;c<cfg.cols;c++) if(b[r][c].mine) b[r][c].state=REVEALED; return b; }
  function countHidden(b:Cell[][]){ let h=0; for(let r=0;r<cfg.rows;r++) for(let c=0;c<cfg.cols;c++) if(b[r][c].state!==REVEALED) h++; return h;}
  function checkWin(b:Cell[][]){ let hidden=0; for(let r=0;r<cfg.rows;r++) for(let c=0;c<cfg.cols;c++) if(b[r][c].state!==REVEALED) hidden++; if(hidden===cfg.mines){ setWon(true); setAlive(false); } }

  function onReveal(r:number,c:number){
    if(!alive) return;
    setBoard(prev=>{
      const b=prev.map(row=>row.map(x=>({...x})));
      if(firstClick){ placeMinesAvoiding(b,r,c); setFirstClick(false); }
      if(b[r][c].mine){ b[r][c].state=REVEALED; setAlive(false); setWon(false); return revealAll(b); }
      const cell=b[r][c]; if(cell.state!==HIDDEN) return prev; revealFlood(b,r,c); checkWin(b); return b;
    });
  }
  function onFlag(r:number,c:number){
    if(!alive) return;
    setBoard(prev=>{
      const b=prev.map(row=>row.map(x=>({...x})));
      const cell=b[r][c]; if(cell.state===REVEALED) return prev;
      if(cell.state===HIDDEN){ cell.state=FLAGGED; setFlags(f=>f+1); } else { cell.state=HIDDEN; setFlags(f=>f-1); }
      return b;
    });
  }
  function reset(){ setSeed(Date.now()); setBoard(createEmptyBoard(cfg)); setAlive(true); setWon(false); setFirstClick(true); setFlags(0); }

  const gridStyle = useMemo(()=>({gridTemplateColumns:`repeat(${cfg.cols}, minmax(0,1fr))`}),[cfg.cols]);
  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Minesweeper</h1>
          <button className="px-3 py-1 rounded-xl bg-gray-900 text-white" onClick={reset}>{won?"🏆 Nuevo": alive? "🙂 Reset":"💥 Nuevo"}</button>
        </div>
        <div className="rounded-2xl border bg-white shadow p-2" onContextMenu={(e)=>e.preventDefault()}>
          <div className="grid gap-1" style={gridStyle}>
            {board.map((row,r)=> row.map((cell,c)=> {
              const base="aspect-square select-none rounded-md flex items-center justify-center text-lg font-semibold border border-gray-300 shadow-sm";
              if(cell.state===HIDDEN) return (<button key={r+'-'+c} className={base+' bg-gray-200 hover:bg-gray-300'} onClick={()=>onReveal(r,c)} onContextMenu={(e)=>{e.preventDefault();onFlag(r,c);}}/>);
              if(cell.state===FLAGGED) return (<button key={r+'-'+c} className={base+' bg-yellow-200 hover:bg-yellow-300'} onContextMenu={(e)=>{e.preventDefault();onFlag(r,c);}}>🚩</button>);
              if(cell.mine) return (<div key={r+'-'+c} className={base+' bg-rose-200'}>💣</div>);
              return (<div key={r+'-'+c} className={base+' bg-white'}>{cell.adj||0}</div>);
            }))}
          </div>
        </div>
      </div>
    </div>
  );
}
