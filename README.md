# Minesweeper IA

[![Build](https://img.shields.io/github/actions/workflow/status/lucianojacofsky/Minesweeper-Solver/ci.yml?branch=main)](https://github.com/lucianojacofsky/Minesweeper-Solver/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-18-blue)](https://react.dev/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)](https://www.typescriptlang.org/) [![Vite](https://img.shields.io/badge/Vite-5.x-646cff)](https://vitejs.dev/) [![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.x-38b2ac)](https://tailwindcss.com/) [![sql.js](https://img.shields.io/badge/sql.js-1.10-ff69b4)](https://sql.js.org/)

> Juego de **Buscaminas** (no consola) con **IA explicable, Heatmap, Replays, Benchmark en Web Worker y base de datos local** (sql.js). Pensado para experimentar estrategias de resolución y comparar tiempos entre humanos y la IA.

**Demo local rápida:** `npm i && npm run dev`

---

## ✨ Características

- **UI moderna** (React + Tailwind + Vite).
- **IA híbrida (Explainable)**:
  - Reglas **determinísticas** seguras (revelar/poner banderas).
  - Heurística **por subconjuntos** (A ⊆ B ⇒ deducciones).
  - Estimador **probabilístico “greedy”** como fallback.
  - Panel **“Explicar IA”** con la regla aplicada y celdas involucradas.
- **Heatmap de riesgo**: superpone `P(mina)` en celdas ocultas (recalculo on-demand).
- **Web Worker**:
  - Cálculo del **siguiente movimiento** sin bloquear la UI.
  - **Benchmark**: simula N partidas completas con la IA y devuelve métricas.
- **Replays**:
  - Graba cada movimiento (humano o IA) con tiempo relativo.
  - **Reproductor**: play/pausa, paso a paso y velocidad.
  - **Exportar/Importar** replays (`.json`).
- **Persistencia**:
  - **SQLite en navegador** con `sql.js` (export/import `.sqlite`).
  - Fallback en **LocalStorage**.
- **Leaderboard** por dificultad (mejores tiempos).
- **Overlay de victoria** (listo para enganchar **sonidos/tiles** en `public/`).

> Nota: en el benchmark actual los campos `frontierMax` y `visitedNodes` se dejan en 0 (se instrumentarán en el siguiente sprint junto con un solver CSP exacto de frontera).

---

## 🕹️ Controles

| Acción                 | Interacción                |
|-----------------------|----------------------------|
| Revelar               | Click izquierdo            |
| Poner/Quitar bandera  | Click derecho              |
| IA: Paso              | Botón **🤖 Paso (worker)** |
| Explicaciones IA      | Toggle **“Explicar IA”**   |
| Heatmap               | Toggle **“Heatmap”** + **Recalcular P()** |
| Reset / Nuevo         | Botón **Reset/Nuevo**      |
| Benchmark             | Elegir **N** y **🏁 Benchmark** |
| Replays               | **▶ Ver último**, **💾 Exportar**, **📥 Importar** |

---

## 📦 Requisitos

- **Node 18+** (recomendado 18 o 20)
- **PNPM / NPM / Yarn** (usa el que prefieras)
- **sql.js** instalado
- Copiar **`sql-wasm.wasm`** a `public/` (o usar CDN)

### Instalación

```bash
npm i
# si falta:
npm i sql.js -S
npm i -D @vitejs/plugin-react

# copia el wasm:
# Windows PowerShell:
copy node_modules\sql.js\dist\sql-wasm.wasm public\sql-wasm.wasm

# macOS/Linux:
cp node_modules/sql.js/dist/sql-wasm.wasm public/sql-wasm.wasm
```

---
## 🚀 Empezar

```bash
# Node 18+
npm i
npm run dev
# abre la URL que imprime Vite (http://localhost:5173)

# Build de producción
npm run build
npm run preview
```
## 🧠 IA (alto nivel)

Determinística:
Si flags == número ⇒ ocultas adyacentes son seguras.
Si flags + ocultas == número ⇒ ocultas adyacentes son minas.

CSP-lite (subsets):
Si ocultas(A) ⊆ ocultas(B):

need(B) - need(A) == |B\A| ⇒ B\A son minas.

need(B) == need(A) ⇒ B\A son seguras.

CSP exacto de frontera:
Construye restricciones solo sobre la frontera (ocultas junto a números), enumera asignaciones consistentes y obtiene probabilidad exacta para cada celda (umbral típico ≈ 18 celdas).

Probabilística greedy:
Si no hay deducciones, elige la celda con menor probabilidad estimada de ser mina.

## 🗂️ Estructura
```
src/
  App.tsx                      # UI principal (tablero, IA, heatmap, replays, benchmark)
  replay.ts                    # Tipos y grabador de replays (begin/push/end)
  components/
    ReplayPlayer.tsx           # Reproductor de replays
    BenchmarkModal.tsx         # Modal de resultados + export CSV
  solver/
    types.ts                   # Tipos compartidos (IA, probMap, benchmark)
    core.ts                    # Reglas det/subset + prob greedy
    worker.ts                  # IA en Worker + cálculo de prob + benchmark
public/
  sql-wasm.wasm                # (opcional) WASM de sql.js para modo offline
  # sonidos/tiles opcionales
```
## 💾 Datos y Exportación

- **SQLite (sql.js)**: DB en memoria del navegador.  
  - **Exportar DB** → descarga `minesweeper.sqlite`.  
  - **Importar DB** → carga un `.sqlite` exportado previamente.
- **Replays**:
  - Guardados en SQLite y **fallback** en LocalStorage.
  - Export/Import como **`.json`**.
- **Privacidad**: todo se almacena **localmente** en tu navegador.

---

## ⚙️ Configuración y personalización

- **Sonidos/Tiles**: pon tus archivos en `public/` y enlázalos desde la UI (o un pequeño gestor de `Audio()`).
- **Dificultades**: edita `DIFFS` en `App.tsx`.
- **Heurísticas**: ajusta reglas/ponderaciones en `src/solver/core.ts`.

---

## 🛠️ Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```
