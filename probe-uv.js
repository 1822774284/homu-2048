/* UV/法线体检：把 render3d.js 的 roundedBox 拉到 Node 里跑一遍，
 * 逐面统计 UV 覆盖范围与法线误差。
 *
 * 用法（node 不在 PATH 里时用绝对路径调用也行）：
 *   node probe-uv.js
 *
 * 关键指标：任意一面的 UV 跨度塌到 0，说明该面整面只采到一个纹素——
 * 数字贴图四周是面色、中心是笔画，于是那一面会被渲染成纯黑。
 * 2026-11-16 的“某些面纯黑”就是底面 ref 取成零向量导致的。
 */
const path = require('path')

global.THREE = require(path.join(__dirname, 'vendor', 'three.min.js'))
global.window = {}
require(path.join(__dirname, 'render3d.js'))
const { roundedBox } = global.window.HomuRender

const SIZE = 0.92, RADIUS = 0.17, SEG = 16
const FACE_NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z']
const perFace = 6 * SEG * SEG // 每面 index 数（SEG² 个四边形 × 6）

const geo = roundedBox(SIZE, RADIUS, SEG)
const pos = geo.attributes.position
const uv = geo.attributes.uv
const nor = geo.attributes.normal
const idx = geo.index.array

let failed = 0
console.log(`verts=${pos.count} tris=${idx.length / 3}`)

// 1) 逐面 UV 包围盒
for (let f = 0; f < 6; f++) {
  const seen = new Set()
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9
  for (let k = f * perFace; k < (f + 1) * perFace; k++) {
    const i = idx[k]
    if (seen.has(i)) continue
    seen.add(i)
    const u = uv.getX(i), v = uv.getY(i)
    u0 = Math.min(u0, u); u1 = Math.max(u1, u)
    v0 = Math.min(v0, v); v1 = Math.max(v1, v)
  }
  const du = u1 - u0, dv = v1 - v0
  const bad = du < 0.02 || dv < 0.02
  if (bad) failed++
  console.log(
    `${FACE_NAMES[f]}  u:[${u0.toFixed(3)},${u1.toFixed(3)}] (${du.toFixed(3)})` +
    `  v:[${v0.toFixed(3)},${v1.toFixed(3)}] (${dv.toFixed(3)})` +
    (bad ? '  <== UV 退化：整面只采一个纹素' : '')
  )
}

// 2) 法线：零长 / 反向 / 与解析法线（内盒最近点指向表面）的夹角
const half = Math.max(0.001, SIZE / 2 - RADIUS)
const v3 = new global.THREE.Vector3()
let zeroLen = 0, inward = 0, over15 = 0, worst = 0
for (let i = 0; i < pos.count; i++) {
  const n = v3.set(nor.getX(i), nor.getY(i), nor.getZ(i))
  const len = n.length()
  const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i)
  const ax = px - Math.max(-half, Math.min(half, px))
  const ay = py - Math.max(-half, Math.min(half, py))
  const az = pz - Math.max(-half, Math.min(half, pz))
  const al = Math.hypot(ax, ay, az) || 1
  const dot = (n.x * ax + n.y * ay + n.z * az) / (len * al)
  if (len < 0.5) zeroLen++
  if (dot < 0) inward++
  const deg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI
  if (deg > 15) over15++
  if (deg > worst) worst = deg
}
if (zeroLen || inward) failed++
console.log(`\n法线：零长 ${zeroLen} / 反向 ${inward} / 与解析法线夹角 >15° ${over15} 个顶点 / 最大 ${worst.toFixed(1)}°`)

console.log(failed ? `\nFAIL（${failed} 项）` : '\nPASS：六面 UV 均完整，法线无退化')
process.exit(failed ? 1 : 0)
