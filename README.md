# Minesweeper IA

[![Build](https://img.shields.io/github/actions/workflow/status/YOUR_GITHUB_USER/YOUR_REPO/ci.yml?branch=main)](https://github.com/YOUR_GITHUB_USER/YOUR_REPO/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-18-blue)](https://react.dev/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)](https://www.typescriptlang.org/) [![Vite](https://img.shields.io/badge/Vite-5.x-646cff)](https://vitejs.dev/) [![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.x-38b2ac)](https://tailwindcss.com/) [![sql.js](https://img.shields.io/badge/sql.js-1.10-ff69b4)](https://sql.js.org/)

> Juego de **Buscaminas** (no consola) con **IA híbrida** y **base de datos local** (sql.js). Pensado para experimentar estrategias de resolución y comparar tiempos entre humanos y la IA.

**Demo local rápida:** `npm i && npm run dev`

---

## ✨ Características

- UI moderna (React + Tailwind).
- **IA híbrida:**
  - Reglas **determinísticas** (seguras/banderas).
  - **CSP-lite por subconjuntos** (A ⊆ B ⇒ deducciones).
  - **CSP exacto de frontera** (backtracking + poda) para fronteras pequeñas; calcula **probabilidades exactas** por celda.
  - Heurística **probabilística greedy** como fallback.
- **Persistencia**:
  - LocalStorage + **SQLite en navegador** (sql.js).
  - Exportar/Importar **runs** (JSON/CSV) y **DB** (`.sqlite`).
- **Leaderboard** por dificultad y tipo (Humano/IA).
- **Overlay de victoria** + hooks para **sonidos**.
- **API opcional** para integraciones: `window.minesweeperAPI.*`.

---

## 🕹️ Controles

| Acción               | Interacción                    |
|---------------------|--------------------------------|
| Revelar             | Click izquierdo                |
| Poner/quitar bandera| Click derecho                  |
| Chord (revela borde)| Doble click sobre número       |
| IA: Jugar/Pausa     | Botón **🤖 Jugar IA / ⏸️ Pausa** |
| IA: Paso            | Botón **Paso**                 |
| IA: Velocidad       | Slider **ms**                  |

---

## 🚀 Empezar

```bash
# Node 18+
npm i
npm run dev
# abre la URL que imprime Vite

Build de producción:

npm run build && npm run preview

🧠 IA (alto nivel)

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

🗂️ Estructura
src/
  App.tsx            # UI principal, lógica de juego, IA y persistencia
  index.css
  main.tsx
public/
  # coloca sonidos/tiles aquí (opcional)

💾 Datos y Exportación

LocalStorage: guarda runs para leaderboard.

SQLite (sql.js): DB en memoria (export/import .sqlite desde la UI).

Export/Import:

Runs JSON / CSV

Base .sqlite

Privacidad: todo se guarda localmente en tu navegador; no se envía a servidores.

⚙️ Configuración

Sonidos/tiles: agrega tus archivos a public/ y enlázalos en los <audio id="sfx-..."> del componente.

sql.js offline:
Copia node_modules/sql.js/dist/sql-wasm.wasm a public/sql-wasm.wasm y cambia:

// en App.tsx (locateFile):
locateFile: () => '/sql-wasm.wasm'

🔌 API opcional
// disponible en window (cuando la app está montada)
window.minesweeperAPI.getVisibleState()  // matriz visible (H/F/número)
window.minesweeperAPI.applyMove({ type:'reveal'|'flag'|'chord', r, c })
window.minesweeperAPI.getMeta()          // { difficulty, seed, rows, cols, mines }
window.minesweeperAPI.restart('Expert')  // reinicia y opcionalmente cambia dificultad
