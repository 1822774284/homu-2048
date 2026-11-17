// 3D 2048 规则层：N×N×N 立方，6 个方向，可开关特殊块与步数上限。
// 特殊块记作负数：-4 表示“特殊 4”。只能与同为特殊、且数值相同的块合并，合并后双双消失。
'use strict'

function makeEngine (N = 3, opts = {}) {
  const specialChance = opts.specialChance ?? 0.06
  const stepLimit = opts.stepLimit ?? 0

  function blank () {
    const b = []
    for (let z = 0; z < N; z++) {
      const layer = []
      for (let y = 0; y < N; y++) layer.push(new Array(N).fill(0))
      b.push(layer)
    }
    return b
  }

  function clone (b) {
    return b.map((layer) => layer.map((row) => row.slice()))
  }

  function cellsOf (b) {
    const out = []
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out.push(b[z][y][x])
    return out
  }

  function emptyCells (b) {
    const out = []
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!b[z][y][x]) out.push([x, y, z])
    return out
  }

  function linesOf (dir) {
    const axis = dir[0]
    const sign = dir[1] === '+' ? 1 : -1
    const lines = []
    for (let a = 0; a < N; a++) {
      for (let c = 0; c < N; c++) {
        const coords = []
        for (let i = 0; i < N; i++) {
          const k = sign > 0 ? N - 1 - i : i
          if (axis === 'x') coords.push([k, a, c])
          else if (axis === 'y') coords.push([a, k, c])
          else coords.push([a, c, k])
        }
        lines.push(coords)
      }
    }
    return lines
  }

  /** 特殊块只能与同类特殊块合并，合并后消失。 */
  function mergeValues (a, b) {
    if (!a || !b) return null
    if (a > 0 && b > 0) return a === b ? a * 2 : null
    if (a < 0 && b < 0) return a === b ? 'vanish' : null
    return null
  }

  function slide (line) {
    const nums = line.filter((v) => v)
    const out = []
    let gained = 0
    for (let i = 0; i < nums.length; i++) {
      const merged = mergeValues(nums[i], nums[i + 1])
      if (merged === 'vanish') {
        gained += Math.abs(nums[i]) * 2
        i++
      } else if (merged !== null) {
        out.push(merged)
        gained += merged
        i++
      } else {
        out.push(nums[i])
      }
    }
    while (out.length < N) out.push(0)
    return { line: out, gained }
  }

  function move (board, dir) {
    const b = clone(board)
    let gained = 0
    let moved = false
    for (const coords of linesOf(dir)) {
      const values = coords.map(([x, y, z]) => b[z][y][x])
      const { line, gained: g } = slide(values)
      gained += g
      for (let i = 0; i < N; i++) {
        const [x, y, z] = coords[i]
        if (b[z][y][x] !== line[i]) moved = true
        b[z][y][x] = line[i]
      }
    }
    return { board: b, gained, moved }
  }

  /** 与 move 相同的规则，但额外报告每个方块的来处与去处，供渲染层做动画。 */
  function moveDetailed (board, dir) {
    const b = clone(board)
    const motions = []
    let gained = 0
    let moved = false
    for (const coords of linesOf(dir)) {
      const items = coords
        .map((c, i) => ({ v: b[c[2]][c[1]][c[0]], i }))
        .filter((o) => o.v)
      const out = []
      for (let i = 0; i < items.length; i++) {
        const merged = mergeValues(items[i].v, items[i + 1] ? items[i + 1].v : 0)
        if (merged === 'vanish') {
          gained += Math.abs(items[i].v) * 2
          out.push({ from: [items[i].i, items[i + 1].i], value: 0 })
          i++
        } else if (merged !== null) {
          out.push({ from: [items[i].i, items[i + 1].i], value: merged })
          gained += merged
          i++
        } else {
          out.push({ from: [items[i].i], value: items[i].v })
        }
      }
      out.forEach((o, k) => {
        const [x, y, z] = coords[k]
        motions.push({
          from: o.from.map((idx) => coords[idx]),
          to: { x, y, z },
          value: o.value,
          merged: o.from.length === 2,
        })
        if (o.value !== b[z][y][x]) moved = true
        b[z][y][x] = o.value
      })
      // 清掉这一行剩下的格子（压缩后空出来的位置）
      for (let k = out.length; k < coords.length; k++) {
        const [x, y, z] = coords[k]
        if (b[z][y][x] !== 0) moved = true
        b[z][y][x] = 0
      }
    }
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (b[z][y][x] !== board[z][y][x]) moved = true
    }
    return { board: b, gained, moved, motions }
  }

  const DIRS = ['x+', 'x-', 'y+', 'y-', 'z+', 'z-']

  function canMove (b) {
    if (emptyCells(b).length) return true
    for (const dir of DIRS) if (move(b, dir).moved) return true
    return false
  }

  function spawn (b, rnd = Math.random) {
    const cells = emptyCells(b)
    if (!cells.length) return null
    const [x, y, z] = cells[Math.floor(rnd() * cells.length)]
    const special = specialChance > 0 && rnd() < specialChance
    const value = rnd() < 0.9 ? 2 : 4
    b[z][y][x] = special ? -value : value
    return [x, y, z]
  }

  function maxTile (b) {
    return Math.max(...cellsOf(b).map(Math.abs))
  }

  /** 新局：两块普通块；返回 { board, score, steps }。 */
  function newGame (rnd = Math.random) {
    const b = blank()
    spawn(b, rnd)
    spawn(b, rnd)
    return { board: b, score: 0, steps: 0 }
  }

  /** 走一步：返回新状态与是否结束。 */
  function step (state, dir, rnd = Math.random) {
    const r = move(state.board, dir)
    if (!r.moved) return { ...state, moved: false, over: false }
    const board = r.board
    spawn(board, rnd)
    const score = state.score + r.gained
    const steps = state.steps + 1
    const limitHit = stepLimit > 0 && steps >= stepLimit
    const over = limitHit || !canMove(board)
    return { board, score, steps, moved: true, over, limitHit }
  }

  /* ---------- 自检 ---------- */

  function selftest () {
    const rows = []
    const check = (name, actual, expected) => {
      const a = JSON.stringify(actual)
      const e = JSON.stringify(expected)
      rows.push(`${a === e ? 'PASS' : 'FAIL'} ${name} got=${a} want=${e}`)
    }

    const b1 = blank()
    b1[0][0][0] = 2; b1[0][0][1] = 2
    const r1 = move(b1, 'x+')
    check('x+ 合并到远端', [r1.board[0][0][0], r1.board[0][0][N - 1]], [0, 4])

    const b2 = blank()
    b2[0][0][0] = 4; b2[0][0][1] = -4
    check('普通与特殊不能合并', move(b2, 'x+').gained, 0)

    const b3 = blank()
    b3[0][0][0] = -4; b3[0][0][1] = -4
    const r3 = move(b3, 'x+')
    check('两个特殊 4 合并即消失', cellsOf(r3.board).filter((v) => v).length, 0)
    check('特殊块合并得分', r3.gained, 8)

    const b4 = blank()
    b4[0][0][0] = -2; b4[0][0][1] = -4
    check('特殊不同值不合并', move(b4, 'x+').gained, 0)

    const b5 = blank()
    b5[0][0][0] = 2; b5[0][0][1] = 2; b5[0][0][2] = 2
    check('三连只合一次', move(b5, 'x+').board[0][0][N - 1], 4)

    check('空盘无变化', move(blank(), 'x+').moved, false)
    check('任意轴都能移动', ['x+', 'y+', 'z+'].map((d) => move(b1, d).moved), [true, true, true])

    const st = newGame(() => 0.5)
    check('新局两块', cellsOf(st.board).filter((v) => v).length, 2)
    check('新局步数为 0', st.steps, 0)

    const e2 = makeEngine(N, { stepLimit: 1 })
    const s2 = e2.newGame(() => 0.4)
    const after = e2.step(s2, 'x+', () => 0.4)
    check('步数上限生效', after.over, true)
    check('步数计数', after.steps, 1)

    const e3 = makeEngine(4, { specialChance: 0 })
    check('4×4×4 生成 64 格', e3.blank().flat(2).length, 64)

    const failed = rows.filter((r) => r.startsWith('FAIL')).length
    rows.unshift(`selftest N=${N}: ${rows.length} cases, ${failed} failed`)
    return rows.join('\n')
  }

  return { N, blank, clone, cellsOf, emptyCells, move, moveDetailed, canMove, spawn, maxTile, newGame, step, selftest, DIRS }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { makeEngine }
if (typeof window !== 'undefined') window.makeEngine = makeEngine

// 浏览器里没有 require，这一行必须自己先判掉，否则每次打开页面都会抛一次 ReferenceError
if (typeof require !== 'undefined' && require.main === module) {
  const mode = process.argv[2] || 'test'
  if (mode === 'test') {
    console.log(makeEngine(3, { specialChance: 0.06, stepLimit: 200 }).selftest())
    console.log(makeEngine(4, { specialChance: 0.06, stepLimit: 400 }).selftest())
  }
}
