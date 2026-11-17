/* 渲染层（WebGL / three.js）：圆角盒、数字纹理、自由轨道相机、可调参数。
 * 规则层在 engine3d.js，这里只负责把状态画出来。
 *
 * 圆角盒：位置圆角化 → 逐面 UV → 法线从焊接副本回填（平滑且无接缝）。
 */
(function () {
  'use strict'

  const clampAxis = (v, half) => Math.max(-half, Math.min(half, v))

  function weldedCopy (positions, index) {
    const map = new Map()
    const verts = []
    const remap = new Int32Array(positions.length / 3)
    for (let i = 0; i < positions.length / 3; i++) {
      const x = positions[i * 3]
      const y = positions[i * 3 + 1]
      const z = positions[i * 3 + 2]
      const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`
      let id = map.get(key)
      if (id === undefined) {
        id = verts.length / 3
        map.set(key, id)
        verts.push(x, y, z)
      }
      remap[i] = id
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geo.setIndex(Array.from(index, (i) => remap[i]))
    geo.computeVertexNormals()
    return geo
  }

  function roundedBox (size, radius, segments, vgrad) {
    const base = new THREE.BoxGeometry(size, size, size, segments, segments, segments)
    const src = base.attributes.position
    const srcNormal = base.attributes.normal
    const index = base.index.array
    const half = Math.max(0.001, size / 2 - radius)
    const perFace = (segments + 1) * (segments + 1)

    const positions = []
    const uvs = []
    const v = new THREE.Vector3()
    // 面内坐标向棱上聚拢：圆角只占面的一小块，均匀网格分到的段数太少
    const bias = 3.2
    const outerHalf = size / 2
    const remap = (x) => {
      const a = Math.max(-1, Math.min(1, x / outerHalf))
      const s = a < 0 ? -1 : 1
      const m = Math.abs(a)
      return s * (1 - Math.pow(1 - m, bias)) * outerHalf
    }

    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i)
      v.set(remap(v.x), remap(v.y), remap(v.z))
      const inner = new THREE.Vector3(clampAxis(v.x, half), clampAxis(v.y, half), clampAxis(v.z, half))
      const dir = v.clone().sub(inner)
      if (dir.lengthSq() > 1e-8) dir.normalize().multiplyScalar(radius)
      v.copy(inner).add(dir)
      positions.push(v.x, v.y, v.z)

      // 用面法线推导文字朝向：right = cross(ref, n)，up = cross(n, right)
      const nx = srcNormal.getX(i)
      const ny = srcNormal.getY(i)
      const nz = srcNormal.getZ(i)

      // ref 必须与该面不共线，否则 right 退化成零向量、整面 UV 塌到一个点。
      // BoxGeometry 的法线只有 ±X/±Y/±Z，所以按 ny 直接挑轴就够了：
      // 侧面取 +Y（数字正立）；顶面和底面法线就是 ±Y，只能沿 Z 取。
      let refX = 0
      let refY = 0
      let refZ = 0
      if (ny > 0.9) refZ = -1
      else if (ny < -0.9) refZ = 1
      else refY = 1
      // right = ref × n
      let rx = refY * nz - refZ * ny
      let ry = refZ * nx - refX * nz
      let rz = refX * ny - refY * nx
      let rl = Math.hypot(rx, ry, rz)
      if (rl < 1e-6) {
        // 兜底：换成与法线最不平行的坐标轴，这里只防以后改成非法线面
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz)
        const px = ax <= ay && ax <= az ? 1 : 0
        const py = !px && ay <= az ? 1 : 0
        const pz = !px && !py ? 1 : 0
        rx = py * nz - pz * ny
        ry = pz * nx - px * nz
        rz = px * ny - py * nx
        rl = Math.hypot(rx, ry, rz) || 1
      }
      const ux = rx / rl, uy = ry / rl, uz = rz / rl
      // up = n × right
      const upX = ny * uz - nz * uy
      const upY = nz * ux - nx * uz
      const upZ = nx * uy - ny * ux
      const u = v.x * ux + v.y * uy + v.z * uz
      const w = v.x * upX + v.y * upY + v.z * upZ
      uvs.push((u / size) * 0.88 + 0.5, (w / size) * 0.88 + 0.5)
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(Array.from(index))

    const smooth = weldedCopy(positions, index)
    const sp = smooth.attributes.position
    const sn = smooth.attributes.normal
    const normalAt = new Map()
    for (let i = 0; i < sp.count; i++) {
      const key = `${sp.getX(i).toFixed(5)},${sp.getY(i).toFixed(5)},${sp.getZ(i).toFixed(5)}`
      normalAt.set(key, [sn.getX(i), sn.getY(i), sn.getZ(i)])
    }
    const normals = []
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const p = geo.attributes.position
      const key = `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`
      const n = normalAt.get(key) || [0, 1, 0]
      normals.push(n[0], n[1], n[2])
    }
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))

    // 顶点色渐变：跨面连续，所以接缝不会断
    const strength = vgrad || 0
    const colors = new Float32Array(geo.attributes.position.count * 3)
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const y = geo.attributes.position.getY(i)
      const k = 1 - strength * 0.28 * (1 - (y / size + 0.5))
      colors[i * 3] = k
      colors[i * 3 + 1] = k
      colors[i * 3 + 2] = k
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    smooth.dispose()
    base.dispose()
    return geo
  }

  const texCache = new Map()

  /** 相对亮度，用来决定虚线框画深色还是浅色。 */
  function luma (hex) {
    const h = String(hex).replace('#', '')
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    const r = parseInt(n.slice(0, 2), 16) / 255
    const gg = parseInt(n.slice(2, 4), 16) / 255
    const b = parseInt(n.slice(4, 6), 16) / 255
    return 0.2126 * r + 0.7152 * gg + 0.0722 * b
  }

  function numberTexture (label, bg, fg, fontScale, stroke, grad, noise, dash, font) {
    const key = `${label}|${bg}|${fg}|${fontScale}|${stroke}|${grad}|${noise}|${dash || 0}|${font || ''}`
    if (texCache.has(key)) return texCache.get(key)
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const g = canvas.getContext('2d')
    g.fillStyle = bg
    g.fillRect(0, 0, size, size)
    if (grad > 0) {
      const grd = g.createLinearGradient(0, 0, 0, size)
      grd.addColorStop(0, `rgba(255,255,255,${0.32 * grad})`)
      grd.addColorStop(0.55, 'rgba(255,255,255,0)')
      grd.addColorStop(1, `rgba(0,0,0,${0.22 * grad})`)
      g.fillStyle = grd
      g.fillRect(0, 0, size, size)
    }
    if (noise > 0) {
      for (let i = 0; i < 2600; i++) {
        const x = Math.random() * size
        const y = Math.random() * size
        g.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${0.10 * noise})` : `rgba(0,0,0,${0.10 * noise})`
        g.fillRect(x, y, 2, 2)
      }
    }
    // 特殊块标记：内嵌虚线框。注意圆角盒的逐面 UV 只覆盖贴图 0.06~0.94，
    // 框画太靠边会被圆角吃掉，所以往里收。
    if (dash) {
      const inset = size * 0.13
      const rr = size * 0.12
      g.strokeStyle = luma(bg) > 0.45 ? 'rgba(11,18,32,0.72)' : 'rgba(255,255,255,0.88)'
      g.lineWidth = size * 0.034
      g.setLineDash([size * 0.06, size * 0.048])
      g.beginPath()
      if (g.roundRect) {
        g.roundRect(inset, inset, size - inset * 2, size - inset * 2, rr)
      } else {
        g.rect(inset, inset, size - inset * 2, size - inset * 2)
      }
      g.stroke()
      g.setLineDash([])
    }
    // 字号自适应：一个「2」可以很大，三个字符的「256」再按 122px 画就会顶到倒角上，
    // 圆角处的 UV 收缩会把笔画拧歪。字符越多缩得越多；汉字另算（近似全角）。
    const chars = [...label].length
    const cjk = /[\u2E80-\u9FFF\uF900-\uFAFF]/.test(label)
    let fit = chars <= 1 ? 1 : chars === 2 ? 0.9 : chars === 3 ? 0.72 : 0.6
    if (cjk) fit *= 0.8
    const px = Math.round(122 * fontScale * fit)
    g.font = `700 ${px}px ${font || '"Microsoft YaHei", system-ui, sans-serif'}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    // 用字形的实际上下缘居中，比固定 +6px 稳（换字体时不会上下跳）
    const m = g.measureText(label)
    const ascent = m.actualBoundingBoxAscent || px * 0.36
    const descent = m.actualBoundingBoxDescent || px * 0.12
    const cy = size / 2 + (ascent - descent) / 2
    if (stroke > 0) {
      g.lineWidth = stroke
      g.strokeStyle = fg
      g.strokeText(label, size / 2, cy)
    }
    g.fillStyle = fg
    g.fillText(label, size / 2, cy)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    texCache.set(key, tex)
    return tex
  }

  function makeOrbit (dom, camera, target) {
    const state = { theta: 0.62, phi: 1.06, radius: 9 }
    let onZoom = null
    const apply = () => {
      const { theta, phi, radius } = state
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.cos(theta)
      )
      camera.lookAt(target)
    }
    apply()

    let drag = null
    dom.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, theta: state.theta, phi: state.phi }
      dom.setPointerCapture(e.pointerId)
    })
    dom.addEventListener('pointermove', (e) => {
      if (!drag) return
      state.theta = drag.theta - (e.clientX - drag.x) * 0.008
      state.phi = Math.max(0.02, Math.min(Math.PI - 0.02, drag.phi - (e.clientY - drag.y) * 0.008))
      apply()
    })
    const end = (e) => {
      drag = null
      try { dom.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    dom.addEventListener('pointerup', end)
    dom.addEventListener('pointercancel', end)
    dom.addEventListener('wheel', (e) => {
      e.preventDefault()
      state.radius = Math.max(3, Math.min(30, state.radius + Math.sign(e.deltaY) * 0.5))
      apply()
      if (onZoom) onZoom(state.radius)
    }, { passive: false })

    return { apply, state, setOnZoom (fn) { onZoom = fn } }
  }

  /** 用一张竖向渐变当环境贴图，经 PMREM 处理后给材质做反射。 */
  function makeEnv (renderer, top, bottom) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 128
    const g = canvas.getContext('2d')
    const grd = g.createLinearGradient(0, 0, 0, 128)
    grd.addColorStop(0, top)
    grd.addColorStop(1, bottom)
    g.fillStyle = grd
    g.fillRect(0, 0, 256, 128)
    const tex = new THREE.CanvasTexture(canvas)
    tex.mapping = THREE.EquirectangularReflectionMapping
    tex.colorSpace = THREE.SRGBColorSpace
    const pmrem = new THREE.PMREMGenerator(renderer)
    const env = pmrem.fromEquirectangular(tex).texture
    pmrem.dispose()
    tex.dispose()
    return env
  }

  const TONE = {
    aces: () => THREE.ACESFilmicToneMapping,
    reinhard: () => THREE.ReinhardToneMapping,
    linear: () => THREE.LinearToneMapping,
    none: () => THREE.NoToneMapping,
  }

  function smoke (container, initial) {
    const cfg = Object.assign({
      // 形状
      radius: 0.26, size: 1.6, segments: 16,
      // 质感
      roughness: 0.42, metalness: 0.05, clearcoat: 0.25, clearcoatRough: 0.3, emissive: 0, flat: 0,
      sheen: 0.15, sheenColor: '#bae6fd', sheenRough: 0.6, iridescence: 0,
      // 环境与细节
      env: 1, envIntensity: 0.8, envTop: '#8ecbff', envBottom: '#0b1220',
      grad: 0, vgrad: 0.55, noise: 0.35, contact: 0.55,
      // 光照
      key: 2.2, hemi: 1.1, rim: 0.9,
      keyColor: '#ffffff', rimColor: '#7dd3fc', keyAz: 40, keyEl: 50, shadows: 0,
      // 画面
      exposure: 1.0, tone: 'aces', fov: 38, dist: 9, pageBg: '#0a1020',
      ground: 1, groundColor: '#111a2e',
      // 颜色与文字
      bg: '#38bdf8', fg: '#0b1220', label: '8', fontScale: 1, stroke: 0,
    }, initial || {})

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(innerWidth, innerHeight)
    renderer.toneMapping = TONE[cfg.tone]()
    renderer.toneMappingExposure = cfg.exposure
    renderer.shadowMap.enabled = cfg.shadows === 1
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(cfg.fov, innerWidth / innerHeight, 0.1, 200)
    const orbit = makeOrbit(renderer.domElement, camera, new THREE.Vector3(0, 0, 0))
    orbit.state.radius = cfg.dist
    orbit.apply()

    const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x0b1220, cfg.hemi)
    scene.add(hemi)
    const key = new THREE.DirectionalLight(cfg.keyColor, cfg.key)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -6
    key.shadow.camera.right = 6
    key.shadow.camera.top = 6
    key.shadow.camera.bottom = -6
    scene.add(key)
    const rim = new THREE.DirectionalLight(cfg.rimColor, cfg.rim)
    rim.position.set(-8, 2, -6)
    scene.add(rim)

    const material = new THREE.MeshPhysicalMaterial({
      map: numberTexture(cfg.label, cfg.bg, cfg.fg, cfg.fontScale, cfg.stroke),
      roughness: cfg.roughness,
      metalness: cfg.metalness,
      clearcoat: cfg.clearcoat,
      clearcoatRoughness: cfg.clearcoatRough,
      emissive: new THREE.Color(cfg.bg),
      emissiveIntensity: cfg.emissive,
      flatShading: cfg.flat === 1,      vertexColors: true,
      sheen: cfg.sheen,
      sheenColor: new THREE.Color(cfg.sheenColor),
      sheenRoughness: cfg.sheenRough,
      iridescence: cfg.iridescence,
      envMapIntensity: cfg.envIntensity,
    })
    let mesh = new THREE.Mesh(roundedBox(cfg.size, cfg.radius, cfg.segments, cfg.vgrad), material)
    mesh.castShadow = true
    scene.add(mesh)

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(cfg.groundColor), roughness: 0.92 })
    )
    ground.receiveShadow = true
    ground.position.y = -cfg.size / 2 - 0.28
    ground.visible = cfg.ground === 1
    scene.add(ground)

    // 接触阴影：一张径向渐变贴图，压在地面上
    const contactCanvas = document.createElement('canvas')
    contactCanvas.width = contactCanvas.height = 128
    const cg = contactCanvas.getContext('2d')
    const radial = cg.createRadialGradient(64, 64, 4, 64, 64, 64)
    radial.addColorStop(0, 'rgba(0,0,0,0.85)')
    radial.addColorStop(0.55, 'rgba(0,0,0,0.35)')
    radial.addColorStop(1, 'rgba(0,0,0,0)')
    cg.fillStyle = radial
    cg.fillRect(0, 0, 128, 128)
    const contactTex = new THREE.CanvasTexture(contactCanvas)
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, opacity: cfg.contact, depthWrite: false })
    )
    scene.add(contact)

    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(innerWidth, innerHeight)
    })

    function placeKey () {
      const az = THREE.MathUtils.degToRad(cfg.keyAz)
      const el = THREE.MathUtils.degToRad(cfg.keyEl)
      const r = 12
      key.position.set(r * Math.cos(el) * Math.sin(az), r * Math.sin(el), r * Math.cos(el) * Math.cos(az))
    }

    function rebuildGeometry () {
      const geo = roundedBox(cfg.size, Math.min(cfg.radius, cfg.size / 2 - 0.01), cfg.segments, cfg.vgrad)
      mesh.geometry.dispose()
      mesh.geometry = geo
      ground.position.y = -cfg.size / 2 - 0.28
    }

    let envMap = null
    function refreshEnv () {
      if (cfg.env !== 1) {
        scene.environment = null
        if (envMap) { envMap.dispose(); envMap = null }
        return
      }
      const next = makeEnv(renderer, cfg.envTop, cfg.envBottom)
      scene.environment = next
      if (envMap) envMap.dispose()
      envMap = next
    }

    function apply (patch) {
      const before = { envTop: cfg.envTop, envBottom: cfg.envBottom, env: cfg.env }
      Object.assign(cfg, patch || {})
      const oldMap = material.map
      material.map = numberTexture(cfg.label, cfg.bg, cfg.fg, cfg.fontScale, cfg.stroke, cfg.grad, cfg.noise)
      if (oldMap && oldMap !== material.map) oldMap.dispose()
      material.roughness = cfg.roughness
      material.metalness = cfg.metalness
      material.clearcoat = cfg.clearcoat
      material.clearcoatRoughness = cfg.clearcoatRough
      material.emissive.set(cfg.bg)
      material.emissiveIntensity = cfg.emissive
      material.flatShading = cfg.flat === 1
      material.sheen = cfg.sheen
      material.sheenColor.set(cfg.sheenColor)
      material.sheenRoughness = cfg.sheenRough
      material.iridescence = cfg.iridescence
      material.envMapIntensity = cfg.envIntensity
      material.needsUpdate = true
      if (before.envTop !== cfg.envTop || before.envBottom !== cfg.envBottom || before.env !== cfg.env) refreshEnv()

      hemi.intensity = cfg.hemi
      key.intensity = cfg.key
      key.color.set(cfg.keyColor)
      rim.intensity = cfg.rim
      rim.color.set(cfg.rimColor)
      placeKey()

      renderer.toneMapping = TONE[cfg.tone] ? TONE[cfg.tone]() : THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = cfg.exposure
      renderer.shadowMap.enabled = cfg.shadows === 1

      camera.fov = cfg.fov
      camera.updateProjectionMatrix()
      // 只有动了“相机距”才重置相机，否则滚轮缩放会被滑块抹掉
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'dist')) {
        orbit.state.radius = cfg.dist
        orbit.apply()
      }

      document.body.style.background = cfg.pageBg
      ground.visible = cfg.ground === 1
      ground.material.color.set(cfg.groundColor)
      contact.visible = cfg.contact > 0
      contact.material.opacity = cfg.contact
      const cs = cfg.size * 1.75
      contact.scale.set(cs, 1, cs)
      contact.position.y = -cfg.size / 2 - 0.27

      rebuildGeometry()
    }

    const loop = () => {
      requestAnimationFrame(loop)
      renderer.render(scene, camera)
    }
    loop()

    placeKey()
    apply({})

    orbit.setOnZoom((r) => {
      cfg.dist = Number(r.toFixed(1))
      if (api.onZoom) api.onZoom(cfg.dist)
    })

    const api = { cfg, apply, renderer, scene, camera, mesh, material, key, rim, hemi, ground, onZoom: null }
    return api
  }

  window.HomuRender = { smoke, roundedBox, numberTexture }
})()
