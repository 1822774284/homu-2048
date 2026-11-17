// 平面 2048 的规则层：N×N 方格，4 个方向，标准 2048 合并规则（一步只合一次）。
// 与 engine3d.js 保持同一套接口风格：move / moveDetailed / canMove / spawn / newGame / selftest。
// 坐标约定：board[y][x]，y=0 是最上面一行，x=0 是最左一列。
'use strict'

function makeEngine2d (N = 4) {
  const DIRS = ['left', 'right', 'up', 'down']

  function blank () {
    const b = []
    for (let y = 0; y < N; y++) b.push(new Array(N).fill(0))
    return b
  }

  function clone (b) {
    return b.map((row) => row.slice())
  }

  function cellsOf (b) {
    const out = []
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out.push(b[y][x])
    return out
  }

  function emptyCells (b) {
    const out = []
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!b[y][x]) out.push([x, y])
    return out
  }

  /** 每条线的坐标都按“目的地在前面”排：index 0 是这一行往这个方向推到底的位置。 */
  function linesOf (dir) {
    const lines = []
    for (let a = 0; a < N; a++) {
      const coords = []
      for (let i = 0; i < N; i++) {
        const k = N - 1 - i
        if (dir === 'left') coords.push([i, a])
        else if (dir === 'right') coords.push([k, a])
        else if (dir === 'up') coords.push([a, i])
        else coords.push([a, k])
      }
      lines.push(coords)
    }
    return lines
  }

  function mergeValues (a, b) {
    if (!a || !b) return null
    return a === b ? a * 2 : null
  }

  /** 标准 2048 滑动：一次移动里每个块只参与一次合并（三个相同的块 → 左边两个合，右边留下）。 */
  function slide (line) {
    const nums = line.filter((v) => v)
    const out = []
    let gained = 0
    for (let i = 0; i < nums.length; i++) {
      const merged = mergeValues(nums[i], nums[i + 1])
      if (merged !== null) {
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

  /** 与 moveDetailed 同一套规则，但只回报最终盘面（求解器用）。 */
  function move (board, dir) {
    const b = clone(board)
    let gained = 0
    let moved = false
    for (const coords of linesOf(dir)) {
      const values = coords.map(([x, y]) => b[y][x])
      const { line, gained: g } = slide(values)
      gained += g
      for (let i = 0; i < N; i++) {
        const [x, y] = coords[i]
        if (b[y][x] !== line[i]) moved = true
        b[y][x] = line[i]
      }
    }
    return { board: b, gained, moved }
  }

  /** 额外报告每个方块的来处与去处，供渲染层做滑动动画。 */
  function moveDetailed (board, dir) {
    const b = clone(board)
    const motions = []
    let gained = 0
    let moved = false
    for (const coords of linesOf(dir)) {
      const items = coords
        .map((c, i) => ({ v: b[c[1]][c[0]], i }))
        .filter((o) => o.v)
      const out = []
      for (let i = 0; i < items.length; i++) {
        const merged = mergeValues(items[i].v, items[i + 1] ? items[i + 1].v : 0)
        if (merged !== null) {
          out.push({ from: [items[i].i, items[i + 1].i], value: merged })
          gained += merged
          i++
        } else {
          out.push({ from: [items[i].i], value: items[i].v })
        }
      }
      out.forEach((o, k) => {
        const [x, y] = coords[k]
        motions.push({
          from: o.from.map((idx) => coords[idx]),
          to: { x, y },
          value: o.value,
          merged: o.from.length === 2,
        })
        if (o.value !== b[y][x]) moved = true
        b[y][x] = o.value
      })
      for (let k = out.length; k < coords.length; k++) {
        const [x, y] = coords[k]
        if (b[y][x] !== 0) moved = true
        b[y][x] = 0
      }
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (b[y][x] !== board[y][x]) moved = true
    }
    return { board: b, gained, moved, motions }
  }

  function canMove (b) {
    if (emptyCells(b).length) return true
    for (const dir of DIRS) if (move(b, dir).moved) return true
    return false
  }

  function spawn (b, rnd = Math.random) {
    const cells = emptyCells(b)
    if (!cells.length) return null
    const [x, y] = cells[Math.floor(rnd() * cells.length)]
    b[y][x] = rnd() < 0.9 ? 2 : 4
    return [x, y]
  }

  function maxTile (b) {
    return Math.max(...cellsOf(b))
  }

  function newGame (rnd = Math.random) {
    const b = blank()
    spawn(b, rnd)
    spawn(b, rnd)
    return { board: b, score: 0, steps: 0 }
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
    b1[0][0] = 2; b1[0][1] = 2
    check('向左合并', move(b1, 'left').board[0].slice(0, 2), [4, 0])

    const b2 = blank()
    b2[0][0] = 2; b2[0][1] = 2; b2[0][2] = 2
    check('三连只合一次', move(b2, 'left').board[0].slice(0, 3), [4, 2, 0])

    const b3 = blank()
    b3[0][0] = 4; b3[0][1] = 2
    check('不同值不合并', move(b3, 'left').board[0].slice(0, 2), [4, 2])

    const b4 = blank()
    b4[0][0] = 2; b4[1][0] = 2
    check('向上合并', [move(b4, 'up').board[0][0], move(b4, 'up').board[1][0]], [4, 0])

    const b5 = blank()
    b5[0][0] = 2; b5[1][0] = 2
    check('向下合并', [move(b5, 'down').board[N - 1][0], move(b5, 'down').board[N - 2][0]], [4, 0])

    const b6 = blank()
    b6[0][0] = 4; b6[0][1] = 2
    check('空盘不动', move(blank(), 'left').moved, false)
    check('满行不动', move(b6, 'left').moved, false)
    check('合并计分', move(b1, 'left').gained, 4)

    const b7 = blank()
    b7[0][0] = 2; b7[0][N - 1] = 2
    const r7 = moveDetailed(b7, 'left')
    check('滑动动画来处', r7.motions.filter((m) => m.merged).map((m) => m.from.length), [2])
    check('两段式合并位置', r7.motions[0].to, { x: 0, y: 0 })

    const st = newGame(() => 0.5)
    check('新局两块', cellsOf(st.board).filter((v) => v).length, 2)
    check('新局步数为 0', st.steps, 0)

    const e5 = makeEngine2d(5)
    check('5×5 生成 25 格', e5.blank().flat().length, 25)

    const failed = rows.filter((r) => r.startsWith('FAIL')).length
    rows.unshift(`selftest2d N=${N}: ${rows.length} cases, ${failed} failed`)
    return rows.join('\n')
  }

  return { N, blank, clone, cellsOf, emptyCells, move, moveDetailed, canMove, spawn, maxTile, newGame, selftest, DIRS }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { makeEngine2d }
if (typeof window !== 'undefined') window.makeEngine2d = makeEngine2d

if (typeof require !== 'undefined' && require.main === module) {
  console.log(makeEngine2d(4).selftest())
  console.log(makeEngine2d(5).selftest())
}
