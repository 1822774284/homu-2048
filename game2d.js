// 平面 2048 的场景层：4×4 的 DOM 棋盘 + 滑动 / 合并 / 生成动画。
// 对外接口刻意与 game3d.js 对齐（onHud / go / undo / rebuild / setLimit / setActive / bestMove），
// 页面只管把当前维度的实现指过去，HUD、回退、音效、存档都不用分叉。
(function () {
  'use strict'

  const N = 4
  const MAX_HISTORY = 50   // 最多回退 50 步
  const ANIM = 110         // 滑动时长（与 CSS 的 transition 对齐）

  const TONES = {
    2: '#cbd5e1', 4: '#94a3b8', 8: '#7dd3fc', 16: '#38bdf8', 32: '#0ea5e9',
    64: '#2563eb', 128: '#6d28d9', 256: '#7c3aed', 512: '#a21caf',
    1024: '#db2777', 2048: '#fbbf24',
  }

  function createGame2d (container) {
    const qs = new URLSearchParams(location.search)
    // ?seed= 与 3D 同一套 Park-Miller 递推，方便按种子复现
    const rng = (() => {
      if (!qs.has('seed')) return Math.random
      let s = (parseInt(qs.get('seed'), 10) || 1) % 2147483647
      if (s <= 0) s += 2147483646
      return () => {
        s = (s * 16807) % 2147483647
        return (s - 1) / 2147483646
      }
    })()

    const model = makeEngine2d(N)

    /* ---------- 存档 ---------- */
    const store = (() => {
      try {
        localStorage.setItem('__homu_probe__', '1')
        localStorage.removeItem('__homu_probe__')
        return localStorage
      } catch { return null }
    })()
    const SAVE_KEY = 'homu3d.save2d.v1'
    const BEST_KEY = 'homu3d.best2d.v1'
    const MODE_KEY = 'homu3d.mode2d.v1'
    const MODES = [100, 200, 400, 0]
    // ?demo / ?bot / ?seed / ?sim 是一次性对局，不读档也不写档
    const noSave = qs.has('demo') || qs.has('bot') || qs.has('seed') || qs.has('sim')
    const noRestore = noSave || qs.has('fresh')
    const loadJSON = (k) => { if (!store) return null; try { return JSON.parse(store.getItem(k)) } catch { return null } }
    const saveJSON = (k, v) => { if (!store) return; try { store.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }
    let best = Math.max(0, Number(store && store.getItem(BEST_KEY)) || 0)

    // 平面版默认无限步：4×4 一局本来就要走几百步，100/200 的预算会把局截在半途。
    // 同样要先判 null——Number(null) 是 0，正好等于“无限”这个合法模式。
    const qLimit = qs.has('limit') ? Number(qs.get('limit')) : null
    const savedMode = store && store.getItem(MODE_KEY)
    let stepLimit = (qLimit !== null && MODES.includes(qLimit))
      ? qLimit
      : (savedMode !== null && MODES.includes(Number(savedMode)) ? Number(savedMode) : 0)

    /* ---------- 棋盘 DOM ---------- */
    const boardEl = document.createElement('div')
    boardEl.className = 'b2'
    const gridEl = document.createElement('div')
    gridEl.className = 'b2-grid'
    for (let i = 0; i < N * N; i++) {
      const slot = document.createElement('div')
      slot.className = 'b2-slot'
      gridEl.appendChild(slot)
    }
    const layerEl = document.createElement('div')
    layerEl.className = 'b2-tiles'
    boardEl.append(gridEl, layerEl)
    container.appendChild(boardEl)

    // 俯视角：?tilt=0 完全平铺，给 20~30 更立体（默认沿用 CSS 里的 22deg）
    const qsTilt = qs.has('tilt') ? Number(qs.get('tilt')) : NaN
    if (Number.isFinite(qsTilt)) boardEl.style.setProperty('--tilt', Math.max(0, Math.min(45, qsTilt)) + 'deg')
    // 方块抬升量跟着棋盘宽度走：小屏上 10px 会显得像悬空
    function boardMetrics () {
      const w = boardEl.offsetWidth || 520
      boardEl.style.setProperty('--lift', Math.max(4, Math.round(w * 0.02)) + 'px')
    }
    boardMetrics()
    addEventListener('resize', boardMetrics)

    const tiles = new Map()   // "x,y" -> element
    const key = (x, y) => `${x},${y}`

    function paintTile (el, value) {
      const label = value >= 2048 ? '吼姆' : String(value)
      el.textContent = label
      el.dataset.v = value >= 2048 ? '2048' : String(value)
      el.dataset.digits = String(label.length)
    }

    function addTile (x, y, value, pop) {
      const el = document.createElement('div')
      el.className = 'b2-tile'
      el.style.setProperty('--c', x)
      el.style.setProperty('--r', y)
      paintTile(el, value)
      layerEl.appendChild(el)
      tiles.set(key(x, y), el)
      if (pop) {
        el.classList.add('pop')
        setTimeout(() => el.classList.remove('pop'), 200)
      }
      return el
    }

    /** 按当前盘面重建全部方块；popKeys 里的格子会补一次弹出动画。 */
    function rebuild (popKeys) {
      for (const el of tiles.values()) el.remove()
      tiles.clear()
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const v = state.board[y][x]
          if (v) addTile(x, y, v, !!(popKeys && popKeys.has(key(x, y))))
        }
      }
    }

    /* ---------- 状态 ---------- */
    let history = []
    let state = model.newGame(rng)
    if (!noRestore) {
      const saved = loadJSON(SAVE_KEY)
      if (saved && validBoard(saved.board) && Number.isFinite(saved.score) && Number.isFinite(saved.steps)) {
        state = { board: saved.board, score: saved.score | 0, steps: saved.steps | 0, over: false }
        if (qLimit === null && MODES.includes(saved.limit)) stepLimit = saved.limit
        if (Array.isArray(saved.history)) {
          history = saved.history
            .filter((h) => h && validBoard(h.board) && Number.isFinite(h.score) && Number.isFinite(h.steps))
            .slice(-MAX_HISTORY)
        }
      }
    }
    let busy = false
    let active = false

    function validBoard (b) {
      return Array.isArray(b) && b.length === N && b.every((row) =>
        Array.isArray(row) && row.length === N && row.every((v) => Number.isInteger(v)))
    }

    function persist () {
      if (noSave) return
      if (state.over) { saveJSON(SAVE_KEY, null); return }
      saveJSON(SAVE_KEY, {
        board: state.board, score: state.score, steps: state.steps, limit: stepLimit,
        history: history.slice(-20),
      })
    }

    function syncHud () {
      if (api.onHud) {
        api.onHud({
          score: state.score, steps: state.steps, limit: stepLimit,
          peak: model.maxTile(state.board),
          best: Math.max(best, state.score),
          canUndo: history.length > 0,
          over: state.over,
          dim: '2d',
        })
      }
    }

    function noteBest () {
      if (state.score > best) {
        best = state.score
        if (!noSave) saveJSON(BEST_KEY, best)
      }
    }

    function setLimit (n) {
      if (!MODES.includes(n) || n === stepLimit) return
      stepLimit = n
      if (!noSave) saveJSON(MODE_KEY, n)
      state = model.newGame(rng)
      history = []
      persist()
      rebuild()
      syncHud()
    }

    function undo () {
      if (busy || !history.length) return false
      const prev = history.pop()
      state = { board: prev.board, score: prev.score, steps: prev.steps, over: false }
      if (window.HomuAudio) window.HomuAudio.undo()
      rebuild()
      persist()
      syncHud()
      return true
    }

    function restart () {
      state = model.newGame(rng)
      history = []
      persist()
      rebuild()
      syncHud()
    }

    /* ---------- 一步 ---------- */
    const ALIAS = { 'x-': 'left', 'x+': 'right', 'y-': 'up', 'y+': 'down' }

    function step (dir, animate = true) {
      dir = ALIAS[dir] || dir
      if (state.over || busy) return
      const result = model.moveDetailed(state.board, dir)
      if (!result.moved) return

      const sfx = window.HomuAudio
      if (sfx) {
        sfx.move()
        let order = 0
        for (const mo of result.motions) if (mo.merged) sfx.merge(mo.value, order++)
      }

      history.push({ board: model.clone(state.board), score: state.score, steps: state.steps })
      if (history.length > MAX_HISTORY) history.shift()

      state.board = result.board
      state.score += result.gained
      state.steps += 1
      const born = model.spawn(state.board, rng)
      state.over = (stepLimit > 0 && state.steps >= stepLimit) || !model.canMove(state.board)
      if (sfx && state.over) sfx.over()
      noteBest()

      if (!animate) {
        persist()
        rebuild()
        syncHud()
        return
      }

      busy = true
      // 先把现有方块滑到目标格；合并的两块叠到同一格并缩小，等动画结束整体重建
      for (const mo of result.motions) {
        for (const [x, y] of mo.from) {
          const el = tiles.get(key(x, y))
          if (!el) continue
          el.style.setProperty('--c', mo.to.x)
          el.style.setProperty('--r', mo.to.y)
          if (mo.merged) el.classList.add('merging')
        }
      }
      const popKeys = new Set()
      for (const mo of result.motions) if (mo.merged) popKeys.add(key(mo.to.x, mo.to.y))
      if (born) popKeys.add(key(born[0], born[1]))

      setTimeout(() => {
        rebuild(popKeys)
        busy = false
        persist()
        syncHud()
      }, ANIM + 20)
    }

    /* ---------- 输入 ---------- */
    const KEYS = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
      a: 'left', d: 'right', w: 'up', s: 'down', A: 'left', D: 'right', W: 'up', S: 'down',
    }

    addEventListener('keydown', (event) => {
      if (!active) return
      if (event.key === 'r' || event.key === 'R') { restart(); return }
      if (event.key === 'm' || event.key === 'M') {
        if (window.HomuAudio && api.onSound) api.onSound(window.HomuAudio.toggle())
        return
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault()
        undo()
        return
      }
      const dir = KEYS[event.key]
      if (!dir) return
      event.preventDefault()
      if (api.onKey) api.onKey(dir)
      step(dir)
    })

    /* ---------- 触屏 / 鼠标拖动 ---------- */
    // 手机上只有键盘的话 2D 根本没法玩：在棋盘上往某个方向滑 = 朝那个方向推。
    // 棋盘层整体 pointer-events:none 是为了不挡标题栏，所以这里把 .b2 单独接回来。
    let drag = null
    const SWIPE_MIN = 22
    boardEl.addEventListener('pointerdown', (e) => {
      if (!active || state.over) return
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId }
      try { boardEl.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    })
    boardEl.addEventListener('pointerup', (e) => {
      if (!drag) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      const id = drag.id
      drag = null
      try { boardEl.releasePointerCapture(id) } catch { /* ignore */ }
      if (Math.hypot(dx, dy) < SWIPE_MIN) return     // 轻点不算，避免误触
      const dir = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? 'right' : 'left')
        : (dy > 0 ? 'down' : 'up')
      if (api.onKey) api.onKey(dir)
      step(dir)
    })
    boardEl.addEventListener('pointercancel', () => { drag = null })

    addEventListener('beforeunload', persist)

    /* ---------- 求解器：4×4 贪心，够 ?bot / ?sim 用 ---------- */
    function evaluate2d (b) {
      let empties = 0
      let maxV = 0
      let maxAt = [0, 0]
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const v = b[y][x]
          if (!v) { empties++; continue }
          if (v > maxV) { maxV = v; maxAt = [x, y] }
        }
      }
      let score = empties * 250
      if (maxV) {
        const atCorner = (maxAt[0] === 0 || maxAt[0] === N - 1) && (maxAt[1] === 0 || maxAt[1] === N - 1)
        score += atCorner ? maxV * 1.6 : 0
      }
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const v = b[y][x]
          if (!v) continue
          // 相邻同值 +30；相邻差一档 -6，鼓励整片同色而不是东一块西一块
          if (x + 1 < N && b[y][x + 1]) {
            score += v === b[y][x + 1] ? 30 : -Math.abs(Math.log2(v) - Math.log2(b[y][x + 1])) * 6
          }
          if (y + 1 < N && b[y + 1][x]) {
            score += v === b[y + 1][x] ? 30 : -Math.abs(Math.log2(v) - Math.log2(b[y + 1][x])) * 6
          }
        }
      }
      return score
    }

    function bestMove () {
      let bestDir = null
      for (const dir of model.DIRS) {
        const r = model.move(state.board, dir)
        if (!r.moved) continue
        const v = evaluate2d(r.board) + r.gained * 0.12
        if (!bestDir || v > bestDir.value) bestDir = { dir, value: v }
      }
      return bestDir ? bestDir.dir : null
    }

    const api = {
      onHud: null,
      onKey: null,
      onSound: null,
      get state () { return state },
      get limit () { return stepLimit },
      get modes () { return MODES },
      go: step,
      undo,
      restart,
      rebuild: () => { rebuild(); syncHud() },
      setLimit,
      setActive (v) {
        active = !!v
        if (active) { rebuild(); syncHud() }
      },
      bestMove,
      resetView () {},
    }

    syncHud()
    return api
  }

  window.HomuGame2d = { createGame2d }
})()
