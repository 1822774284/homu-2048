/* 立体 2048 的场景层，N 可配（3 → 3×3×3，4 → 4×4×4）。
 * 规则：engine3d.js；渲染：three.js（本地 vendor）；外观：舰长调定的参数。 */
(function () {
  'use strict'

  const DEFAULT_N = 3
  const SPACING = 1.25
  const TILE = 0.92        // 方块边长（世界单位）
  const RADIUS = 0.17      // 圆角

  const LOOK = {
    roughness: 0.22, metalness: 0.04,
    clearcoat: 0.63, clearcoatRough: 0.13,
    sheen: 0.1, sheenRough: 0.25, iridescence: 0.13,
    envIntensity: 0.8, exposure: 1.0,
    bg: '#38bdf8', fg: '#0b1220', stroke: 2, fontScale: 1,
    // 数字字体：微软雅黑的重心偏宽、笔画带肉，放在圆角方块上显笨；
    // Segoe UI 的数字更均匀，1024 这种四位也不会顶到倒角。
    font: '"Segoe UI", system-ui, sans-serif',
  }

  const TONES = {
    2: '#cbd5e1', 4: '#94a3b8', 8: '#7dd3fc', 16: '#38bdf8', 32: '#0ea5e9',
    64: '#2563eb', 128: '#6d28d9', 256: '#7c3aed', 512: '#a21caf',
    1024: '#db2777', 2048: '#fbbf24',
  }

  function cellKey (x, y, z) { return `${x},${y},${z}` }

  function createGame (container, opts) {
    const cfg = Object.assign({}, LOOK, opts || {})
    // 棋盘边长：3 → 3×3×3（27 格），4 → 4×4×4（64 格）。
    // 4×4×4 方块数是 2.4 倍，分段降到 12、层间距收紧一点，否则画面顶出屏幕、三角形也翻倍。
    const N = Math.max(2, Math.min(5, Math.round(opts && opts.n) || DEFAULT_N))
    const SEGMENTS = N >= 4 ? 12 : 16
    const EXPLODE_GAP = N >= 4 ? 1.2 : 1.35
    // ?seed=123 固定发牌序列。只喂给规则层，不去改全局 Math.random——
    // three 建对象时会用 Math.random 生成 UUID，全局改写会把序列搅乱，
    // 结果就是同一个 seed 在页面和离线复算里发牌不一致。
    const rng = (() => {
      const q = new URLSearchParams(location.search)
      if (!q.has('seed')) return Math.random
      let s = (parseInt(q.get('seed'), 10) || 1) % 2147483647
      if (s <= 0) s += 2147483646
      return () => {
        s = (s * 16807) % 2147483647
        return (s - 1) / 2147483646
      }
    })()

    /* ---------- 渲染器与场景 ---------- */
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(innerWidth, innerHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = cfg.exposure
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200)

    // 轨道相机：位置由 (yaw, pitch) 定，up 也由它们算出来——
    // 这样越过 ±90° 时镜头是连续翻过去的，不会突然翻转。
    // 不能用固定的 up=(0,1,0)：z 轴与 up 共线时 lookAt 的 right 轴会反向，
    // 画面瞬间转 180°（拖到顶/底时“直接变方向”）。
    const TARGET = new THREE.Vector3(0, 0, 0)
    let camRadius = N >= 4 ? 13.5 : 11
    let manualZoom = false      // 用户滚轮缩放过之后，不再被自动 fitRadius 覆盖
    let explode = EXPLODE_GAP   // 分层间距（fitRadius 会用到，必须早于第一次 applyCam）
    const cam = { yaw: 0.62, pitch: 0.6 }
    // 视角可由查询串固定，便于按角度复现（?yaw=0.62&pitch=-0.6&radius=11）
    {
      const q = new URLSearchParams(location.search)
      const num = (k) => (q.has(k) && isFinite(+q.get(k)) ? +q.get(k) : null)
      const qy = num('yaw'), qp = num('pitch'), qr = num('radius')
      if (qy !== null) cam.yaw = qy
      if (qp !== null) cam.pitch = qp
      if (qr !== null) camRadius = qr
    }
    let apiRef = null

    // 按需渲染：只有“有动画”或“画面被弄脏”时才真正 draw。
    // 声明必须早于第一次 applyCam()——否则落到 let 的暂时性死区。
    let dirty = true
    let renders = 0
    function requestRender () { dirty = true }

    // ?debug=1：左下角实时显示 yaw/pitch/radius，方便按角度报问题
    let debugEl = null
    if (new URLSearchParams(location.search).has('debug')) {
      debugEl = document.createElement('div')
      debugEl.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:20;' +
        'font:12px/1.55 ui-monospace,Consolas,monospace;color:#7dd3fc;' +
        'background:rgba(10,16,32,.82);padding:4px 9px;border-radius:8px;' +
        'border:1px solid rgba(125,211,252,.35);pointer-events:none;white-space:pre'
      document.body.appendChild(debugEl)
    }
    const deg = (r) => `${(r * 180 / Math.PI).toFixed(1)}°`

    /** 按当前屏幕比例算出“刚好装下整个棋盘”的机位距离。
     *  固定公式算不准：棋盘是斜着看的立方体，投影宽度随 yaw 变化，
     *  所以直接拿八个角投影到 NDC，迭代反推距离；再对 4 个 yaw 取最坏值，
     *  这样在手机上转视角也不会把方块顶出屏幕。 */
    const fitCam = new THREE.PerspectiveCamera(38, 1, 0.1, 200)
    function maxExtent (radius, yaw, shift) {
      const cp = Math.cos(cam.pitch)
      const sp = Math.sin(cam.pitch)
      const cy = Math.cos(yaw)
      const sy = Math.sin(yaw)
      fitCam.fov = camera.fov
      fitCam.aspect = camera.aspect
      fitCam.updateProjectionMatrix()
      fitCam.position.set(radius * cp * sy, radius * sp, radius * cp * cy)
      fitCam.up.set(-sp * sy, cp, -sp * cy)
      fitCam.lookAt(TARGET.x, TARGET.y + shift, TARGET.z)
      fitCam.updateMatrixWorld()
      const half = (N - 1) / 2
      const hx = half * SPACING + TILE * 0.75
      const hy = half * SPACING * explode + TILE * 0.75
      let m = 0
      for (const x of [-hx, hx]) {
        for (const y of [-hy, hy]) {
          for (const z of [-hx, hx]) {
            const p = new THREE.Vector3(x, y, z).project(fitCam)
            m = Math.max(m, Math.abs(p.x), Math.abs(p.y))
          }
        }
      }
      return m
    }
    function fitRadius () {
      const shift = targetShift()
      const portrait = camera.aspect < 1
      const target = portrait ? 0.90 : 0.94   // 占屏幕比例，留边给阴影与描边
      // 竖屏时转视角会让投影宽度变化很大，按 4 个绝对朝向取最坏值（绝对角度 → 转动时机位不会忽大忽小）
      const yaws = portrait ? [0, Math.PI / 4, Math.PI / 2, Math.PI * 0.75] : [cam.yaw]
      let worst = 6
      for (const yaw of yaws) {
        let r = 14
        for (let i = 0; i < 3; i++) {
          const m = maxExtent(r, yaw, shift)
          r = Math.min(46, Math.max(6, r * (m / target)))
        }
        worst = Math.max(worst, r)
      }
      return worst
    }
    // 竖屏上标题栏占掉顶部一截，把看的目标点抬高一点，棋盘就整体下移
    const targetShift = () => (camera.aspect < 0.8 ? 0.55 : 0)

    function applyCam () {
      const cp = Math.cos(cam.pitch)
      const sp = Math.sin(cam.pitch)
      const cy = Math.cos(cam.yaw)
      const sy = Math.sin(cam.yaw)
      if (!manualZoom) camRadius = fitRadius()
      camera.position.set(camRadius * cp * sy, camRadius * sp, camRadius * cp * cy)
      // up = 绕 Y 转 yaw、绕 X 转 -pitch 之后的 (0,1,0)，恒与视线垂直且单位长。
      // |pitch| < 90° 时它与 lookAt 配 (0,1,0) 的结果完全一致，只有过极点才不同。
      camera.up.set(-sp * sy, cp, -sp * cy)
      camera.lookAt(TARGET.x, TARGET.y + targetShift(), TARGET.z)
      camera.updateMatrixWorld()
      if (debugEl) debugEl.textContent = `yaw ${deg(cam.yaw)}  pitch ${deg(cam.pitch)}  r ${camRadius.toFixed(1)}`
      if (apiRef && apiRef.onAxes) apiRef.onAxes(axesScreen())
      requestRender()
    }
    function axesScreen () {
      camera.updateMatrixWorld()
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
      const out = {}
      for (const [name, vec] of Object.entries({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] })) {
        const v = new THREE.Vector3(vec[0], vec[1], vec[2]).transformDirection(camera.matrixWorldInverse)
        out[name] = { x: v.x, y: -v.y }
      }
      return out
    }

    applyCam()
    scene.add(new THREE.HemisphereLight(0xe8f3ff, 0x2b3f5c, 1.15))
    const key = new THREE.DirectionalLight(0xffffff, 1.7)
    key.position.set(6, 9, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x7dd3fc, 0.8)
    rim.position.set(-7, 3, -6)
    scene.add(rim)

    // 跟随相机的补光：从观察者方向照过去，转到下方也不会一片黑
    const headLight = new THREE.DirectionalLight(0xffffff, 2.0)
    headLight.position.set(0, 0, 0)
    camera.add(headLight)
    scene.add(camera)
    scene.add(new THREE.AmbientLight(0xa9c4e0, 0.7))

    // 环境贴图：竖向渐变
    const envCanvas = document.createElement('canvas')
    envCanvas.width = 256
    envCanvas.height = 128
    const eg = envCanvas.getContext('2d')
    const grd = eg.createLinearGradient(0, 0, 0, 128)
    grd.addColorStop(0, '#8ecbff')
    grd.addColorStop(1, '#0b1220')
    eg.fillStyle = grd
    eg.fillRect(0, 0, 256, 128)
    const envTex = new THREE.CanvasTexture(envCanvas)
    envTex.mapping = THREE.EquirectangularReflectionMapping
    envTex.colorSpace = THREE.SRGBColorSpace
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromEquirectangular(envTex).texture
    pmrem.dispose()

    /* ---------- 几何与材质 ---------- */
    const geo = HomuRender.roundedBox(TILE, RADIUS, SEGMENTS)
    const matCache = new Map()
    // explode 必须早于第一次 applyCam()（fitRadius 要按分层高度算距离），所以提到前面声明

    function materialFor (value) {
      const abs = Math.abs(value)
      // 特殊块（负数）与普通块同值同色，靠贴图上的虚线框区分，所以缓存键要带上这个标志
      const special = value < 0 ? 1 : 0
      const key = `${abs}|${special}`
      if (matCache.has(key)) return matCache.get(key)
      const tone = TONES[abs] || '#fbbf24'
      const mat = new THREE.MeshPhysicalMaterial({
        map: HomuRender.numberTexture(abs >= 2048 ? '吼姆' : String(abs), tone, cfg.fg, cfg.fontScale, cfg.stroke, 0, 0, special, cfg.font),
        roughness: abs >= 512 ? Math.max(0.08, cfg.roughness - 0.1) : cfg.roughness,
        metalness: cfg.metalness,
        clearcoat: abs >= 512 ? 0.9 : cfg.clearcoat,
        clearcoatRoughness: cfg.clearcoatRough,
        sheen: cfg.sheen,
        sheenRoughness: cfg.sheenRough,
        iridescence: abs >= 512 ? 0.35 : cfg.iridescence,
        envMapIntensity: cfg.envIntensity,
        emissive: new THREE.Color(tone),
        emissiveIntensity: abs >= 512 ? 0.12 : 0,
      })
      matCache.set(key, mat)
      return mat
    }

    // 空格提示。「虚格」画什么，直接决定这堆方块看起来贵不贵、有没有空间感：
    //   solid  半透明实心盒（默认 0.07）—— 舰长最终选定的样子，最轻、不抢戏
    //   tray   浅凹槽：浅色底 + 深色四壁 —— 有内壁明暗，但更"实"、存在感偏重
    //   pads   每格一块水平地板面 —— 干净但只有一层平面，缺体积
    //   line   每格 12 条棱 —— 27 个盒子叠投影，线条密到发乱
    //   frame  只画外层大立方体的 12 条棱 —— 极简，但中间没有分格
    //   hybrid frame + pads
    // 用 ?ghostmode=solid|tray|pads|line|frame|hybrid 切换，?ghost= 调浓度，?ghost=0 隐藏。
    const qsGhost = new URLSearchParams(location.search)
    const GHOST_MODES = ['line', 'solid', 'pads', 'tray', 'frame', 'hybrid']
    const ghostMode = GHOST_MODES.includes((qsGhost.get('ghostmode') || '').toLowerCase())
      ? qsGhost.get('ghostmode').toLowerCase()
      : 'solid'
    const ghostOpacity = (() => {
      const v = qsGhost.has('ghost') ? Number(qsGhost.get('ghost')) : NaN
      if (Number.isFinite(v)) return Math.max(0, Math.min(0.6, v))
      return { line: 0.22, solid: 0.07, pads: 0.20, tray: 0.20, frame: 0.25, hybrid: 0.16 }[ghostMode]
    })()
    const ghostSeg = (() => {
      const v = qsGhost.has('ghostseg') ? Math.round(Number(qsGhost.get('ghostseg'))) : NaN
      return Number.isFinite(v) ? Math.max(1, Math.min(12, v)) : 1
    })()
    const ghostColor = (() => {
      const v = qsGhost.get('ghostcolor')
      return v && /^[0-9a-f]{6}$/i.test(v) ? parseInt(v, 16) : 0x9fc4e8
    })()
    // 实心盒用单面：双面会把盒子的背面也画一遍，等效浓度翻倍（和改前的观感对不上）
    const ghostMat = new THREE.MeshBasicMaterial({
      color: ghostColor, transparent: true, opacity: ghostOpacity, depthWrite: false,
    })
    // 地板面/凹槽底是平面，得双面才不至于从下往上看时消失
    const ghostPlaneMat = new THREE.MeshBasicMaterial({
      color: ghostColor, transparent: true, opacity: ghostOpacity, depthWrite: false,
      side: THREE.DoubleSide,
    })
    const ghostLineMat = new THREE.LineBasicMaterial({
      color: ghostColor, transparent: true, opacity: ghostOpacity, depthWrite: false,
    })
    // 凹槽用实体材质：壁面吃灯光，明暗不同才有“深度”
    const trayColor = (() => {
      const v = qsGhost.get('traycolor')
      return v && /^[0-9a-f]{6}$/i.test(v) ? parseInt(v, 16) : 0x142036
    })()
    const ghostTrayMat = new THREE.MeshStandardMaterial({
      color: trayColor, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
    })
    const ghostGeo = ghostSeg > 1
      ? HomuRender.roundedBox(TILE, RADIUS, ghostSeg)
      : new THREE.BoxGeometry(TILE, TILE, TILE)
    const ghostDummy = new THREE.Object3D()
    const ghostObjs = []

    function clearGhostObjs () {
      for (const o of ghostObjs) {
        scene.remove(o)
        o.geometry.dispose()
      }
      ghostObjs.length = 0
    }
    function addLines (pts) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      const o = new THREE.LineSegments(g, ghostLineMat)
      o.frustumCulled = false
      scene.add(o)
      ghostObjs.push(o)
    }
    /** 27 个方块的 12 条棱，按当前分层间距烘焙成一份几何。 */
    function cellLinePoints () {
      const src = new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE, TILE, TILE))
      const s = src.attributes.position.array
      const out = []
      for (let z = 0; z < N; z++) {
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            const p = worldPos(x, y, z)
            for (let i = 0; i < s.length; i += 3) out.push(s[i] + p.x, s[i + 1] + p.y, s[i + 2] + p.z)
          }
        }
      }
      src.dispose()
      return out
    }
    /** 包住整个 3×3×3 的外层立方体，只画 12 条棱。 */
    function frameLinePoints () {
      const half = (N - 1) / 2
      const w = 2 * (half * SPACING + TILE / 2)
      const h = 2 * (half * SPACING * explode + TILE / 2)
      const src = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, w))
      const arr = Array.from(src.attributes.position.array)
      src.dispose()
      return arr
    }
    /** 每格一块水平地板面：没有竖直面，投影不会叠出线网。 */
    function addPads () {
      const g = new THREE.PlaneGeometry(TILE * 0.94, TILE * 0.94)
      g.rotateX(-Math.PI / 2)
      const mesh = new THREE.InstancedMesh(g, ghostPlaneMat, N * N * N)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      let i = 0
      for (let z = 0; z < N; z++) {
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            const p = worldPos(x, y, z)
            ghostDummy.position.set(p.x, p.y - TILE * 0.5 - 0.02, p.z)
            ghostDummy.updateMatrix()
            mesh.setMatrixAt(i++, ghostDummy.matrix)
          }
        }
      }
      mesh.instanceMatrix.needsUpdate = true
      scene.add(mesh)
      ghostObjs.push(mesh)
    }

    /** 一个只有底和四壁的浅盒（口朝上），当“凹槽”用。底用浅色透光片、壁用深色实体，
     *  壁面吃灯光后比底暗，斜看时槽口有明确的内壁阴影——这是平面地板给不出的深度。 */
    function trayGeometry (size, depth) {
      const h = size / 2
      const y0 = -TILE * 0.5 - 0.02 - depth   // 槽底
      const y1 = -TILE * 0.5 - 0.02           // 槽口
      const pos = []
      const quad = (a, b, c, d) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d) }
      quad([-h, y0, h], [h, y0, h], [h, y0, -h], [-h, y0, -h])          // 底（6 顶点）
      quad([-h, y0, h], [h, y0, h], [h, y1, h], [-h, y1, h])            // 前壁
      quad([h, y0, -h], [-h, y0, -h], [-h, y1, -h], [h, y1, -h])        // 后壁
      quad([h, y0, h], [h, y0, -h], [h, y1, -h], [h, y1, h])            // 右壁
      quad([-h, y0, -h], [-h, y0, h], [-h, y1, h], [-h, y1, -h])        // 左壁
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.computeVertexNormals()
      g.addGroup(0, 6, 0)     // 底 → 浅色面
      g.addGroup(6, 24, 1)    // 四壁 → 深色实体
      return g
    }
    function addTrays () {
      const g = trayGeometry(TILE * 0.96, 0.13)
      const mesh = new THREE.InstancedMesh(g, [ghostPlaneMat, ghostTrayMat], N * N * N)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      let i = 0
      for (let z = 0; z < N; z++) {
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            ghostDummy.position.copy(worldPos(x, y, z))
            ghostDummy.updateMatrix()
            mesh.setMatrixAt(i++, ghostDummy.matrix)
          }
        }
      }
      mesh.instanceMatrix.needsUpdate = true
      scene.add(mesh)
      ghostObjs.push(mesh)
    }
    function addSolidBoxes () {
      const mesh = new THREE.InstancedMesh(ghostGeo, ghostMat, N * N * N)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      let i = 0
      for (let z = 0; z < N; z++) {
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            ghostDummy.position.copy(worldPos(x, y, z))
            ghostDummy.updateMatrix()
            mesh.setMatrixAt(i++, ghostDummy.matrix)
          }
        }
      }
      mesh.instanceMatrix.needsUpdate = true
      scene.add(mesh)
      ghostObjs.push(mesh)
    }

    function layoutGhosts () {
      clearGhostObjs()
      if (ghostOpacity <= 0) return
      if (ghostMode === 'solid') addSolidBoxes()
      else if (ghostMode === 'pads') addPads()
      else if (ghostMode === 'tray') addTrays()
      else if (ghostMode === 'frame') addLines(frameLinePoints())
      else if (ghostMode === 'hybrid') { addLines(frameLinePoints()); addPads() }
      else addLines(cellLinePoints())
    }
    layoutGhosts()

    /* ---------- 坐标 ---------- */

    function worldPos (x, y, z) {
      const half = (N - 1) / 2
      return new THREE.Vector3(
        (x - half) * SPACING,
        (z - half) * SPACING * explode,
        (y - half) * SPACING
      )
    }

    /* ---------- 存档 ---------- */
    const store = (() => {
      try {
        localStorage.setItem('__homu_probe__', '1')
        localStorage.removeItem('__homu_probe__')
        return localStorage
      } catch { return null }          // file:// 下被禁或配额满时静默降级
    })()
    // 存档按边长分家：3×3×3 沿用旧键（老存档还能读），4×4×4 用独立键，
    // 否则 27 格盘面会被当成 64 格读进去，局面直接错乱。
    const SUFFIX = N === 3 ? '' : String(N)
    const SAVE_KEY = `homu3d.save${SUFFIX}.v1`
    const BEST_KEY = `homu3d.best${SUFFIX}.v1`
    const MODE_KEY = `homu3d.mode${SUFFIX}.v1`
    // 64 格一局要比 27 格走得久，200 步打不满，所以 4×4×4 的档位整体上移
    const MODES = N >= 4 ? [200, 400, 800, 0] : [100, 200, 400, 0]   // 0 = 无限
    const qs = new URLSearchParams(location.search)
    // ?demo / ?bot / ?seed 是复现用的一次性对局，既不读旧档也不写档；
    // ?fresh 只表示“不要恢复上次的局面”，照常覆盖存档。
    const noSave = qs.has('demo') || qs.has('bot') || qs.has('seed') || qs.has('sim')
    const noRestore = noSave || qs.has('fresh')
    const loadJSON = (k) => { if (!store) return null; try { return JSON.parse(store.getItem(k)) } catch { return null } }
    const saveJSON = (k, v) => { if (!store) return; try { store.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }
    let best = Math.max(0, Number(store && store.getItem(BEST_KEY)) || 0)

    // 模式：?limit= 优先（便于复现/测试），否则读存档，默认 200
    const qLimit = qs.has('limit') ? Number(qs.get('limit')) : null
    // 注意：localStorage 没存过时 getItem 是 null，而 Number(null) 正好是 0（无限模式），
    // 直接拿来判断会让全新浏览器默认落在无限而不是 README 写的 200，所以要先判 null。
    const savedMode = store && store.getItem(MODE_KEY)
    let stepLimit = (qLimit !== null && MODES.includes(qLimit))
      ? qLimit
      : (savedMode !== null && MODES.includes(Number(savedMode)) ? Number(savedMode) : 200)
    // 引擎也拿到步数上限；不过页面用的是 moveDetailed 自己结算，
    // 结束判定以页面里的 stepLimit 为准（两处一致）。
    const model = makeEngine(N, { specialChance: 0.06, stepLimit })

    const validBoard = (b) => Array.isArray(b) && b.length === N && b.every((layer) =>
      Array.isArray(layer) && layer.length === N && layer.every((row) =>
        Array.isArray(row) && row.length === N && row.every((v) => Number.isInteger(v))))

    /* ---------- 状态 ---------- */
    const MAX_HISTORY = 50        // 最多回退 50 步
    let history = []              // 每步之前的局面快照，供回退
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
    const tiles = new Map() // key -> { mesh, x, y, z, value }
    let anims = []
    let busy = false
    // 页面切到平面模式时会被置 false：键盘不再响应、也不再白渲染一个看不见的场景
    let active = true

    function persist () {
      if (noSave) return
      if (state.over) { saveJSON(SAVE_KEY, null); return }
      saveJSON(SAVE_KEY, {
        board: state.board, score: state.score, steps: state.steps, limit: stepLimit,
        history: history.slice(-20),
      })
    }

    /** 换模式：直接开新局，回退历史一并清空（跨模式回退没有意义）。 */
    function setLimit (n) {
      if (!MODES.includes(n) || n === stepLimit) return
      stepLimit = n
      if (!noSave) saveJSON(MODE_KEY, n)
      state = model.newGame(rng)
      history = []
      persist()
      rebuild()
    }

    /** 回退一步：恢复上一步之前的局面，步数分数一并回退。 */
    function undo () {
      if (busy || !history.length) return false
      const prev = history.pop()
      state = { board: prev.board, score: prev.score, steps: prev.steps, over: false }
      if (window.HomuAudio) window.HomuAudio.undo()
      rebuild()
      persist()
      return true
    }

    function noteBest () {
      if (state.score > best) {
        best = state.score
        if (!noSave) saveJSON(BEST_KEY, best)
      }
    }

    function addTile (x, y, z, value, pop) {
      const mesh = new THREE.Mesh(geo, materialFor(value))
      mesh.position.copy(worldPos(x, y, z))
      scene.add(mesh)
      const tile = { mesh, x, y, z, value }
      tiles.set(cellKey(x, y, z), tile)
      if (pop) {
        mesh.scale.setScalar(0.6)
        anims.push({ mesh, from: 0.6, to: 1, t: 0, dur: 150, scaleOnly: true })
      }
      return tile
    }

    function rebuild () {
      for (const t of tiles.values()) scene.remove(t.mesh)
      tiles.clear()
      anims = []
      for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const v = state.board[z][y][x]
        if (v) addTile(x, y, z, v, false)
      }
      syncHud()
      requestRender()
    }

    function syncHud () {
      if (api.onHud) {
        const flat = state.board.flat(2)
        api.onHud({
          score: state.score, steps: state.steps, limit: stepLimit,
          peak: Math.max(0, ...flat.map((v) => Math.abs(v))),
          best: Math.max(best, state.score),
          canUndo: history.length > 0,
          over: state.over,
        })
      }
    }

    /* ---------- 一步 ---------- */
    function step (dir, animate = true) {
      if (state.over) return
      if (busy) return
      const result = model.moveDetailed(state.board, dir)
      if (!result.moved) return

      // 音效：先一声滑动，再按合并次数补音（同一步多次合并按 order 错开）
      const sfx = window.HomuAudio
      if (sfx) {
        sfx.move()
        let order = 0
        for (const mo of result.motions) {
          if (!mo.merged) continue
          if (mo.value === 0) sfx.vanish()
          else sfx.merge(mo.value, order++)
        }
      }

      // 记住这一步之前的局面，回退用（只留最近 MAX_HISTORY 步）
      history.push({ board: model.clone(state.board), score: state.score, steps: state.steps })
      if (history.length > MAX_HISTORY) history.shift()

      state.board = result.board
      state.score += result.gained
      state.steps += 1
      const born = model.spawn(state.board, rng)
      state.over = (stepLimit > 0 && state.steps >= stepLimit) || !model.canMove(state.board)
      if (sfx && state.over) sfx.over()
      noteBest()

      if (!animate) { persist(); rebuild(); return }

      busy = true
      const duration = 140
      // 先按快照解析每块的去向：同一格里可能“有块离开、有块进来”，
      // 直接改 Map 会让旧块脱管（看起来就是停在原地不动）。
      const snapshot = new Map(tiles)
      const next = new Map()
      const mergePairs = []

      for (const mo of result.motions) {
        const srcs = mo.from.map(([x, y, z]) => snapshot.get(cellKey(x, y, z))).filter(Boolean)
        const target = worldPos(mo.to.x, mo.to.y, mo.to.z)
        if (srcs.length === 2) {
          // 合并：进来的那块滑过去并缩小，避免与另一块穿模
          const [keeper, incoming] = srcs
          anims.push({ mesh: incoming.mesh, from: incoming.mesh.position.clone(), to: target, t: 0, dur: duration, toScale: 0.55 })
          anims.push({ mesh: keeper.mesh, from: keeper.mesh.position.clone(), to: target, t: 0, dur: duration, toScale: 0.7 })
          mergePairs.push({ mo, target, srcs })
        } else if (srcs.length === 1) {
          const tile = srcs[0]
          tile.x = mo.to.x; tile.y = mo.to.y; tile.z = mo.to.z
          next.set(cellKey(tile.x, tile.y, tile.z), tile)
          anims.push({ mesh: tile.mesh, from: tile.mesh.position.clone(), to: target, t: 0, dur: duration })
        }
      }
      tiles.clear()
      for (const [k, v] of next) tiles.set(k, v)

      // 合并结算：滑到位后删两块、出新块，缩放带一点回弹
      setTimeout(() => {
        for (const { mo, target, srcs } of mergePairs) {
          for (const s of srcs) scene.remove(s.mesh)
          if (mo.value !== 0) {
            const mesh = new THREE.Mesh(geo, materialFor(mo.value))
            mesh.position.copy(target)
            mesh.scale.setScalar(0.55)
            scene.add(mesh)
            tiles.set(cellKey(mo.to.x, mo.to.y, mo.to.z), { mesh, x: mo.to.x, y: mo.to.y, z: mo.to.z, value: mo.value })
            anims.push({ mesh, from: 0.55, to: 1, t: 0, dur: 170, scaleOnly: true, ease: 'back' })
          }
        }
        if (born) addTile(born[0], born[1], born[2], state.board[born[2]][born[1]][born[0]], true)
        busy = false
        persist()
        syncHud()      }, duration + 10)
    }

    /* ---------- 动画循环 ---------- */
    // 按需渲染：只有“有动画”或“有人把画面弄脏”时才真正 draw。
    // 以前是无条件每帧渲染——静止不动时 144Hz 屏也在每秒画 144 次，纯烧电。
    let last = performance.now()
    let fpsAcc = 0
    let fpsN = 0
    function loop (now) {
      const dt = Math.min(60, now - last)
      last = now
      for (const a of anims) {
        a.t += dt
        const k = Math.min(1, a.t / a.dur)
        const e = 1 - Math.pow(1 - k, 3)
        const eb = a.ease === 'back' ? 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2) : e
        if (a.scaleOnly) {
          a.mesh.scale.setScalar(a.from + (a.to - a.from) * eb)
        } else {
          a.mesh.position.lerpVectors(a.from, a.to, e)
          if (a.toScale !== undefined) {
            const s0 = 1
            a.mesh.scale.setScalar(s0 + (a.toScale - s0) * e)
          }
        }
      }
      anims = anims.filter((a) => a.t < a.dur)
      if (anims.length) dirty = true          // 动画期间每帧都要重画
      if (active && dirty) {
        renderer.render(scene, camera)
        renders++
        dirty = false
      }
      if (debugEl) {
        fpsAcc += dt
        fpsN += 1
        if (fpsAcc >= 500) {
          const info = renderer.info.render
          debugEl.textContent = `yaw ${deg(cam.yaw)}  pitch ${deg(cam.pitch)}  r ${camRadius.toFixed(1)}\n` +
            `${(1000 / (fpsAcc / fpsN)).toFixed(0)} fps · ${info.calls} draw · ${info.triangles} tris` +
            ` · ${renders} renders`
          fpsAcc = 0
          fpsN = 0
        }
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)

    /* ---------- 输入 ---------- */
    const DIRS = {
      ArrowLeft: 'x-', ArrowRight: 'x+', ArrowDown: 'y-', ArrowUp: 'y+',
      a: 'x-', d: 'x+', s: 'y-', w: 'y+', A: 'x-', D: 'x+', S: 'y-', W: 'y+',
      q: 'z-', e: 'z+', Q: 'z-', E: 'z+',
    }

    /** 视角复位：回到默认机位（并交还给自动适配）。V 键和底部按钮共用。 */
    function resetView () {
      cam.yaw = 0.62
      cam.pitch = 0.6
      manualZoom = false
      camRadius = N >= 4 ? 13.5 : 11
      applyCam()
    }

    addEventListener('keydown', (event) => {
      if (!active) return
      if (event.key === 'r' || event.key === 'R') {
        state = model.newGame(rng)
        history = []
        persist()
        rebuild()
        return
      }
      if (event.key === 'm' || event.key === 'M') {
        // 静音开关
        if (window.HomuAudio && apiRef && apiRef.onSound) apiRef.onSound(window.HomuAudio.toggle())
        return
      }
      if (event.key === 'v' || event.key === 'V') {
        resetView()
        return
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault()
        undo()
        return
      }
      if (event.key === 'l' || event.key === 'L') {
        explode = explode > 1 ? 1 : EXPLODE_GAP
        layoutGhosts()      // 实例化后没有单独的 mesh 可挪，重算一次矩阵
        rebuild()
        return
      }
      const dir = DIRS[event.key]
      if (!dir) return
      event.preventDefault()
      if (api.onKey) api.onKey(dir)
      step(dir)
    })

    /* ---------- 指针：鼠标拖动转视角；触摸单指滑动推块、双指拖动转视角 ---------- */
    const pointers = new Map()
    let mouseDrag = null
    let swipe = null

    /** 把一次滑动映射到“屏幕上最接近的那个世界方向”。
     *  手机上没有方向键概念，玩家只知道“往那边滑”，所以按当前机位的投影来挑方向。 */
    function pushBySwipe (dx, dy) {
      const len = Math.hypot(dx, dy)
      if (len < 1) return
      const ux = dx / len
      const uy = dy / len
      const proj = axesScreen()
      let best = null
      for (const dir of model.DIRS) {
        const axis = dir[0]
        const sign = dir[1] === '+' ? 1 : -1
        const p = proj[axis]
        const vx = p.x * sign
        const vy = p.y * sign
        const l = Math.hypot(vx, vy)
        if (l < 0.15) continue           // 这根轴几乎正对镜头，屏幕上没有方向可言
        const cos = (ux * vx + uy * vy) / l
        if (!best || cos > best.cos) best = { dir, cos }
      }
      if (!best || best.cos < 0.45) return
      if (api.onKey) api.onKey(best.dir)
      step(best.dir)
    }

    renderer.domElement.addEventListener('pointerdown', (e) => {
      if (!active) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try { renderer.domElement.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      if (e.pointerType === 'mouse') {
        mouseDrag = { x: e.clientX, y: e.clientY }
        return
      }
      // 单指：先记成滑动候选；第二根手指一进来就改判为“转视角”
      swipe = pointers.size === 1
        ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }
        : null
    })

    renderer.domElement.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const isMouse = e.pointerType === 'mouse'
      if (!isMouse && pointers.size < 2) return   // 单指触摸留给滑动，不转视角
      const k = isMouse ? 0.007 : 0.005
      cam.yaw -= (e.clientX - prev.x) * k
      cam.pitch += (e.clientY - prev.y) * k
      // 折进 (-π, π]，一次大位移也能落回区间（一次加减不够）
      cam.pitch = Math.atan2(Math.sin(cam.pitch), Math.cos(cam.pitch))
      applyCam()
    })

    const end = (e) => {
      pointers.delete(e.pointerId)
      try { renderer.domElement.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      if (e.pointerType === 'mouse') { mouseDrag = null; return }
      if (!swipe || swipe.id !== e.pointerId) return
      const dx = e.clientX - swipe.x
      const dy = e.clientY - swipe.y
      const dt = performance.now() - swipe.t
      swipe = null
      if (Math.hypot(dx, dy) >= 26 && dt < 700) pushBySwipe(dx, dy)
    }
    renderer.domElement.addEventListener('pointerup', end)
    renderer.domElement.addEventListener('pointercancel', end)
    renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault()
      manualZoom = true
      camRadius = Math.max(5, Math.min(26, camRadius + Math.sign(e.deltaY) * 0.6))
      applyCam()
    }, { passive: false })
    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(innerWidth, innerHeight)
      // 旋转屏幕 / 拉窗口：重新按比例适配机位（用户手动缩放过就尊重用户）
      applyCam()
    })

    const api = {
      onHud: null,
      onAxes: null,
      onKey: null,
      onSound: null,
      axesScreen,
      get state () { return state },
      go: step,
      rebuild,
      undo,
      resetView,
      setLimit,
      get limit () { return stepLimit },
      get modes () { return MODES },
      setActive (v) {
        active = !!v
        // three 建画布时自己写了 canvas.style.display = 'block'（内联样式），
        // 光靠 CSS 的 body[data-dim="2d"] > canvas 盖不住它——切走以后会留一帧旧画面透出来。
        // 这里直接把画布收起来/放回去，唯一权威来源是这段代码。
        renderer.domElement.style.display = active ? 'block' : 'none'
        if (active) {
          syncHud()
          renderer.render(scene, camera)
          renders++
          dirty = false
        }
      },
      // 调试用：renders 只增不减，用来验证“空闲时真的不再画”
      stats: () => ({ renders, draws: renderer.info.render.calls, tris: renderer.info.render.triangles }),
      setExplode (v) { explode = v; rebuild() },
      bestMove: () => (window.solver3d ? window.solver3d.bestMove(model, state.board) : null),
    }

    apiRef = api
    addEventListener('beforeunload', persist)
    rebuild()
    applyCam()
    return api
  }

  window.HomuGame = { createGame }
})()
