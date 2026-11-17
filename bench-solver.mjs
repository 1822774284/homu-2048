// 求解器离线评测：固定 20 个种子 × 固定步数上限，同一套发牌序列复算。
// 用法：node bench-solver.mjs [steps] [variant]
//   steps   默认 200
//   variant 默认 page（直接用 solver3d.js 的 bestMove），也可以是 expecti / twoply 等对照实现
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
// 两个脚本都是浏览器写法：engine3d.js 末尾有 require.main 判断，solver3d.js 往 window 上挂。
// 给个假 module/require 再当 ES 模块执行，就能原样复用线上代码，不必维护第二份规则。
globalThis.window = globalThis
globalThis.module = { exports: {} }
globalThis.require = Object.assign((id) => null, { main: null })
const load = async (file) => {
  const src = readFileSync(join(ROOT, file), 'utf8')
  await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))
}
await load('engine3d.js')
await load('solver3d.js')

const makeEngine = globalThis.makeEngine
const base = globalThis.solver3d
const STEPS = Number(process.argv[2] || 200)
const VARIANT = process.argv[3] || 'page'

// 种子基：默认 1111（与既有基线对齐）；换 SEED_BASE 可做留出集验证，避免只对一组种子调参
const SEED_BASE = Number(process.env.SEED_BASE || 1111)
const SEEDS = Array.from({ length: 20 }, (_, i) => SEED_BASE * (i + 1))
// 棋盘边长：默认 3；N=4 跑 4×4×4 求解器
const N = Number(process.env.N || 3)
const specialChance = 0.06

function rngOf (seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

/* ---------- 对照实现 ---------- */

// 1) 纯评估（无 0.12 的得分权重），看分数权重到底有没有用
function vPlain (model, board) {
  let best = null
  for (const dir of model.DIRS) {
    const r = model.move(board, dir)
    if (!r.moved) continue
    const v = base.evaluate(r.board, model.N)
    if (!best || v > best.v) best = { dir, v }
  }
  return best ? best.dir : null
}

// 2) 期望值前沿：一步之后对“新块落在哪、是 2 还是 4”求期望。
//    特殊块不逐个枚举（占比小），按平均后的惩罚并入期望即可。
function vExpecti (model, board, opts = {}) {
  const W = opts.w ?? 0.12
  let best = null
  for (const dir of model.DIRS) {
    const r = model.move(board, dir)
    if (!r.moved) continue
    const empties = model.emptyCells(r.board)
    let sum = 0
    if (!empties.length) sum = base.evaluate(r.board, model.N)
    for (const [x, y, z] of empties) {
      for (const val of [2, 4]) {
        r.board[z][y][x] = val
        sum += base.evaluate(r.board, model.N)
        r.board[z][y][x] = 0
      }
    }
    const avg = empties.length ? sum / (empties.length * 2) : sum
    const v = avg + r.gained * W
    if (!best || v > best.v) best = { dir, v }
  }
  return best ? best.dir : null
}

// 3) 两段前沿：一步之后再让“对手”自由走一步（悲观/乐观各一半取折中）。
//    不枚举具体新块坐标，用“每个空格都长 2”的最坏假设逼近。
function vTwoPly (model, board) {
  let best = null
  for (const dir of model.DIRS) {
    const r = model.move(board, dir)
    if (!r.moved) continue
    const empties = model.emptyCells(r.board)
    let worst = Infinity
    let sum = 0
    let n = 0
    for (const [x, y, z] of empties) {
      r.board[z][y][x] = 2
      // 对手（新块）只影响后续可选走法，这里用“我方下一步最好结果”的上界
      let bestNext = -Infinity
      for (const d2 of model.DIRS) {
        const r2 = model.move(r.board, d2)
        if (!r2.moved) continue
        bestNext = Math.max(bestNext, base.evaluate(r2.board, model.N) + r2.gained * 0.12)
      }
      r.board[z][y][x] = 0
      if (bestNext < worst) worst = bestNext
      sum += bestNext
      n++
    }
    const v = n ? sum / n : base.evaluate(r.board, model.N)
    if (!best || v > best.v) best = { dir, v }
  }
  return best ? best.dir : null
}

// 4) 悲观版两段：新块落在最坏的那个空格，等价于“对手帮它选位置”
function vTwoPlyMin (model, board) {
  let best = null
  for (const dir of model.DIRS) {
    const r = model.move(board, dir)
    if (!r.moved) continue
    const empties = model.emptyCells(r.board)
    let worst = Infinity
    for (const [x, y, z] of empties) {
      r.board[z][y][x] = 2
      let bestNext = -Infinity
      for (const d2 of model.DIRS) {
        const r2 = model.move(r.board, d2)
        if (!r2.moved) continue
        bestNext = Math.max(bestNext, base.evaluate(r2.board, model.N) + r2.gained * 0.12)
      }
      r.board[z][y][x] = 0
      if (bestNext < worst) worst = bestNext
    }
    const v = empties.length ? worst : base.evaluate(r.board, model.N)
    if (!best || v > best.v) best = { dir, v }
  }
  return best ? best.dir : null
}

// 5) 两段 + 新块为 2 或 4 都算一遍（更接近真实发牌）
function vTwoPly24 (model, board) {
  let best = null
  for (const dir of model.DIRS) {
    const r = model.move(board, dir)
    if (!r.moved) continue
    const empties = model.emptyCells(r.board)
    let sum = 0
    let n = 0
    for (const [x, y, z] of empties) {
      for (const ghost of [2, 4]) {
        r.board[z][y][x] = ghost
        let bestNext = -Infinity
        for (const d2 of model.DIRS) {
          const r2 = model.move(r.board, d2)
          if (!r2.moved) continue
          bestNext = Math.max(bestNext, base.evaluate(r2.board, model.N) + r2.gained * 0.12)
        }
        r.board[z][y][x] = 0
        sum += bestNext
        n++
      }
    }
    const v = n ? sum / n : base.evaluate(r.board, model.N)
    if (!best || v > best.v) best = { dir, v }
  }
  return best ? best.dir : null
}

// 6) 均值与最坏折中：均值怕运气差，最坏太保守，各取一半
function vTwoPlyBlend (model, board) {
  let best = null
  for (const dir of model.DIRS) {
    const r = model.move(board, dir)
    if (!r.moved) continue
    const empties = model.emptyCells(r.board)
    let sum = 0; let worst = Infinity
    for (const [x, y, z] of empties) {
      r.board[z][y][x] = 2
      let bestNext = -Infinity
      for (const d2 of model.DIRS) {
        const r2 = model.move(r.board, d2)
        if (!r2.moved) continue
        bestNext = Math.max(bestNext, base.evaluate(r2.board, model.N) + r2.gained * 0.12)
      }
      r.board[z][y][x] = 0
      sum += bestNext
      if (bestNext < worst) worst = bestNext
    }
    const v = empties.length ? (sum / empties.length + worst) / 2 : base.evaluate(r.board, model.N)
    if (!best || v > best.v) best = { dir, v }
  }
  return best ? best.dir : null
}

const PICK = { page: base.bestMove, plain: vPlain, expecti: vExpecti, twoply: vTwoPly, twoplyMin: vTwoPlyMin, twoply24: vTwoPly24, twoplyBlend: vTwoPlyBlend }[VARIANT]
if (!PICK) throw new Error('unknown variant: ' + VARIANT)

/* ---------- 跑分 ---------- */

function playOne (seed) {
  const model = makeEngine(N, { specialChance, stepLimit: STEPS })
  const rnd = rngOf(seed)
  let state = model.newGame(rnd)
  let used = 0
  while (true) {
    const over = (STEPS > 0 && state.steps >= STEPS) || !model.canMove(state.board)
    if (over) break
    const dir = PICK(model, state.board)
    if (!dir) break
    const r = model.move(state.board, dir)
    state.board = r.board
    state.score += r.gained
    state.steps += 1
    used++
    model.spawn(state.board, rnd)
  }
  return { score: state.score, max: model.maxTile(state.board), steps: state.steps }
}

const t0 = performance.now()
const rows = SEEDS.map((seed) => ({ seed, ...playOne(seed) }))
const dt = performance.now() - t0
const scores = rows.map((r) => r.score).sort((a, b) => a - b)
const med = scores[Math.floor(scores.length / 2)]
const tileCount = {}
for (const r of rows) tileCount[r.max] = (tileCount[r.max] || 0) + 1

console.log(`${VARIANT} · ${STEPS} 步 · ${SEEDS.length} 局 · ${dt.toFixed(0)} ms`)
console.log(`中位 ${med} · 区间 ${scores[0]}–${scores[scores.length - 1]} · 均值 ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(0)}`)
console.log('最大块分布 ' + Object.entries(tileCount).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}×${v}`).join(' '))
console.log('逐局 ' + rows.map((r) => `${r.seed}:${r.score}/${r.max}`).join('  '))
