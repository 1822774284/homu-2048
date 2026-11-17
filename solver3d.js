// 3D 2048 的求解器：每步在 6 个方向里挑一个。
// 评估看空格、角位、平滑度与可合并对；决策用两段前瞻——
// 走一步之后，对“新块落在哪个空格、下一步还能走成什么样”取均值与最坏的折中。
// 挂到 window.solver3d，页面用 ?bot=1 时会自动调用。
// 离线评测：node bench-solver.mjs 200 twoplyBlend（对照页内实现用 page）
(function () {
  'use strict'

  const log2 = (v) => (v ? Math.log2(Math.abs(v)) : 0)
  const GAIN_W = 0.12          // 单步得分在评估里的权重：分是结果，不是目标

  function corners (N) {
    const out = []
    for (const x of [0, N - 1]) for (const y of [0, N - 1]) for (const z of [0, N - 1]) out.push([x, y, z])
    return out
  }

  function evaluate (b, N) {
    let empties = 0
    let maxV = 0
    let maxAt = [0, 0, 0]
    for (let z = 0; z < N; z++) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const v = b[z][y][x]
          if (!v) { empties++; continue }
          if (Math.abs(v) > maxV) { maxV = Math.abs(v); maxAt = [x, y, z] }
        }
      }
    }

    let score = empties * 260
    if (maxV) {
      const atCorner = corners(N).some(([x, y, z]) => x === maxAt[0] && y === maxAt[1] && z === maxAt[2])
      score += atCorner ? maxV * 1.6 : 0
    }

    const pair = (a, b) => {
      if (a && b) {
        // 普通块成对：合出高一档，+34
        if (a > 0 && a === b) score += 34
        // 特殊块成对：合并即双双消失、双倍计分、还腾出两格，比普通合更值
        else if (a < 0 && a === b) score += 62
        score -= Math.abs(log2(a) - log2(b)) * 6
      } else if (!a || !b) {
        score += 5
      }
    }

    for (let z = 0; z < N; z++) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          if (x + 1 < N) pair(b[z][y][x], b[z][y][x + 1])
          if (y + 1 < N) pair(b[z][y][x], b[z][y + 1][x])
          if (z + 1 < N) pair(b[z][y][x], b[z + 1][y][x])
        }
      }
    }
    return score
  }

  /** 一步之内的最好结果：对“新块出现在这个空格、且长成 2”的每一种情况，
   *  都算一遍我方下一步的最优值。返回 { mean, worst }。 */
  function replyRange (model, board) {
    const N = model.N
    const empties = model.emptyCells(board)
    let sum = 0
    let worst = Infinity
    for (const [x, y, z] of empties) {
      board[z][y][x] = 2
      let bestNext = -Infinity
      for (const d of model.DIRS) {
        const r = model.move(board, d)
        if (!r.moved) continue
        const v = evaluate(r.board, N) + r.gained * GAIN_W
        if (v > bestNext) bestNext = v
      }
      board[z][y][x] = 0
      sum += bestNext
      if (bestNext < worst) worst = bestNext
    }
    // 满盘且无空格：没有可发的新块，直接看当前局面
    if (!empties.length) {
      const v = evaluate(board, N)
      return { mean: v, worst: v }
    }
    return { mean: sum / empties.length, worst }
  }

  /** 两段前瞻 + 均值/最坏折中。
   *  只取均值会赌运气（新块恰好落在顺手的位置），只取最坏又过分保守、宁可少得分；
   *  实测两者的平均比任何一边都稳：200 步 20/20 局都能出 256。
   *  成本约 1.6 ms/步（27 格、6 方向），?bot 每 320 ms 走一步，占用不到 1%。 */
  function bestMove (model, board) {
    let best = null
    for (const dir of model.DIRS) {
      const r = model.move(board, dir)
      if (!r.moved) continue
      const { mean, worst } = replyRange(model, r.board)
      const value = (mean + worst) / 2
      if (!best || value > best.value) best = { dir, value }
    }
    return best ? best.dir : null
  }

  /** 单层贪心：只看一步之后的局面。留给对照/降级用，比 bestMove 快一个数量级。 */
  function bestMoveGreedy (model, board) {
    let best = null
    for (const dir of model.DIRS) {
      const r = model.move(board, dir)
      if (!r.moved) continue
      const value = evaluate(r.board, model.N) + r.gained * GAIN_W
      if (!best || value > best.value) best = { dir, value }
    }
    return best ? best.dir : null
  }

  if (typeof window !== 'undefined') window.solver3d = { evaluate, bestMove, bestMoveGreedy }
})()
