// 无头浏览器的交互回归：走 DevTools 协议发真按键、真点击，读 DOM 断言。
// 比 --virtual-time-budget 稳：不依赖虚拟时钟，也不会被 setInterval 卡死。
// 用法：EDGE=<浏览器路径> node probe-cdp.mjs [url]
//   默认打开本目录的 index.html（file://），可用环境变量 EDGE 指定 Chrome/Edge 可执行文件。
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CANDIDATES = [
  process.env.EDGE,
  process.env.CHROME,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
const EDGE = CANDIDATES.find((p) => existsSync(p))
if (!EDGE) {
  console.error('找不到浏览器。用 EDGE=<可执行文件路径> 指定（Chrome / Edge / Chromium 均可）。')
  process.exit(2)
}

// 默认打开本目录的 index.html，不写死任何绝对路径
const here = dirname(fileURLToPath(import.meta.url))
// lang=zh 钉住中文：无头浏览器的 navigator.language 是 en-US，不钉的话 38 项断言里的中文标题会先挂
const DEFAULT_URL = pathToFileURL(join(here, 'index.html')).href + '?fresh=1&lang=zh'
const URL_ARG = process.argv[2] || DEFAULT_URL
const BASE_URL = URL_ARG.split('?')[0]
const PORT = 9200 + Math.floor(Math.random() * 400)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = mkdtempSync(join(tmpdir(), 'edge-cdp-'))
// 先开空白页再导航：这样 Runtime.enable 在页面脚本执行之前就位，
// 加载期的未捕获异常才收得到（直接带 URL 启动会漏掉最前面那一批）
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  '--window-size=1000,1000', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })

const rows = []
const pageErrors = []
const check = (name, ok, detail) => { rows.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`) }

let ws
async function connect () {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* 还没起来 */ }
    await sleep(150)
  }
  throw new Error('DevTools 端口没起来')
}

let seq = 0
const pending = new Map()
function send (method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function evaluate (expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('eval 失败: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result?.value
}

async function key (keyName, code, vk) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
}

const KEYS = {
  left: ['ArrowLeft', 'ArrowLeft', 37],
  right: ['ArrowRight', 'ArrowRight', 39],
  up: ['ArrowUp', 'ArrowUp', 38],
  down: ['ArrowDown', 'ArrowDown', 40],
}

/** 真鼠标点击：走 Input.dispatchMouseEvent 打到坐标上，命中判定与真人一致；
 *  不能用 el.dispatchEvent——那样会绕过“谁在最上层”，遮罩挡住按钮也测不出来。 */
async function click (selector) {
  const rect = await evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } })()`)
  if (!rect || !rect.w) throw new Error(`点不到 ${selector}（不存在或尺寸为 0）`)
  const p = { x: Math.round(rect.x), y: Math.round(rect.y) }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...p })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...p })
  await sleep(150)
  return 'ok'
}

/** 这个位置最上层是不是它（或它的子元素）。遮罩盖住按钮时 elementFromPoint 会返回遮罩。 */
const hitTest = (selector) => evaluate(
  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'missing';
    const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top && (top === el || el.contains(top)) ? 'self' : 'covered-by:' + (top ? top.id || top.className || top.tagName : 'null') })()`)

/** 在某个元素上按住拖动（真鼠标坐标），用于滑动手势 */
async function drag (selector, dx, dy) {
  const r = await evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
      const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })()`)
  if (!r) throw new Error(`拖不到 ${selector}`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= 4; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: r.x + Math.round(dx * i / 4), y: r.y + Math.round(dy * i / 4), button: 'left', buttons: 1,
    })
    await sleep(16)
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + dx, y: r.y + dy, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(300)
}

const text = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)}) || {}).textContent`)

async function main () {
  const wsUrl = await connect()
  ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    // 页面里的未捕获异常：以前用 window.__errs 查，永远读到 0（没人往里写），等于没测
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      pageErrors.push(((d.exception && (d.exception.description || d.text)) || d.text || 'exception').split('\n')[0])
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: URL_ARG })
  // 等到页面脚本真正跑完（__homuApp 是内联脚本最后一行），而不是只等资源就位——
  // 走隧道/网络慢的时候，中间会有一段“脚本还没执行完”的空窗。
  for (let i = 0; i < 150; i++) {
    const ready = await evaluate('!!window.__homuApp && !!document.querySelector("body > canvas")')
    if (ready) break
    await sleep(100)
  }
  await sleep(300)

  // ---- 初始：3D ----
  check('默认是 3D', (await evaluate('document.body.dataset.dim')) === '3d')
  check('标题是立方体', (await text('#dimName')) === '立方体 3×3×3')
  check('六向按钮可见', (await evaluate(`getComputedStyle(document.querySelector('.pad-side')).display`)) !== 'none')
  check('2D 棋盘隐藏', (await evaluate(`getComputedStyle(document.getElementById('board2d')).display`)) === 'none')

  const t3 = await evaluate(`document.getElementById('steps').textContent`)
  let t3b = t3
  let dirUsed = 'left'
  for (const d of ['left', 'right', 'up', 'down']) {
    await key(...KEYS[d])
    await sleep(250)
    t3b = await evaluate(`document.getElementById('steps').textContent`)
    if (t3b !== t3) { dirUsed = d; break }
  }
  check('3D 键盘有效（步数变化）', t3b !== t3, `${t3} → ${t3b}`)
  check('3D 模式药丸 200 高亮', (await evaluate(`document.querySelector('.mode[data-limit="200"]').dataset.on`)) === '1')

  // 空闲时不该再渲染：等动画收尾，隔 0.7s 读两次 renders
  await sleep(600)
  const st0 = await evaluate(`__homuApp.game().stats()`)
  await sleep(700)
  const st1 = await evaluate(`__homuApp.game().stats()`)
  check('3D 空闲不再重绘', st1.renders === st0.renders, `renders ${st0.renders} → ${st1.renders}`)
  // 不能直接复用 dirUsed：那一步之后同方向可能已经推不动了（no-op 不触发动画 → 不重绘），
  // 所以换方向试到真的走了一步，再断言“重绘恢复”。
  const stepsBefore = await evaluate(`document.getElementById('steps').textContent`)
  let stepsAfter = stepsBefore
  for (const d of ['right', 'left', 'up', 'down']) {
    await key(...KEYS[d])
    await sleep(350)
    stepsAfter = await evaluate(`document.getElementById('steps').textContent`)
    if (stepsAfter !== stepsBefore) break
  }
  const st2 = await evaluate(`__homuApp.game().stats()`)
  check('3D 操作后恢复重绘', stepsAfter !== stepsBefore && st2.renders > st1.renders,
    `steps ${stepsBefore}→${stepsAfter}, renders ${st1.renders} → ${st2.renders}`)
  const t3c = stepsAfter

  // ---- 切到 2D ----
  check('点 2D 药丸', (await click('.dim[data-dim="2d"]')) === 'ok')
  await sleep(300)
  check('切到 2D', (await evaluate('document.body.dataset.dim')) === '2d')
  check('标题变平面', (await text('#dimName')) === '平面')
  check('六向按钮隐藏', (await evaluate(`getComputedStyle(document.querySelector('.pad-side')).display`)) === 'none')
  check('2D 棋盘显示', (await evaluate(`getComputedStyle(document.getElementById('board2d')).display`)) !== 'none')
  check('模式药丸是无限', (await evaluate(`document.querySelector('.mode[data-limit="0"]').dataset.on`)) === '1')
  check('2D 起始两块', (await evaluate(`document.querySelectorAll('.b2-tile').length`)) === 2)
  // 切到 2D 后 3D 画布必须真的收起来：否则会停着最后一帧透出来（three 给 canvas 写了内联 display:block）
  check('2D 下 3D 画布已隐藏', (await evaluate(`getComputedStyle(document.querySelector('body > canvas')).display`)) === 'none')
  check('2D 棋盘位置没有画布', (await evaluate(
    `(() => { const r = document.querySelector('.b2').getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el ? el.tagName : 'null' })()`)) !== 'CANVAS')
  // 平面棋盘是 fixed inset:0 的图层，不能盖住左上角的维度按钮——遮住就再也切不回 3D
  check('2D 下 3D 药丸没被盖住', (await hitTest('.dim[data-dim="3d"]')) === 'self', await hitTest('.dim[data-dim="3d"]'))
  check('2D 下模式药丸没被盖住', (await hitTest('.mode[data-limit="0"]')) === 'self', await hitTest('.mode[data-limit="0"]'))

  const s2 = await text('#steps')
  let s2b = s2
  for (const d of ['left', 'right', 'up', 'down']) {
    await key(...KEYS[d])
    await sleep(300)
    s2b = await text('#steps')
    if (s2b !== s2) break
  }
  check('2D 键盘有效（步数变化）', s2b !== s2, `${s2} → ${s2b}`)
  await sleep(150)
  // 2 块走一步：没合并是 3 块，合并了是 2 块，两种都合法
  check('2D 走一步后 2~3 块', (await evaluate(`document.querySelectorAll('.b2-tile').length`)) >= 2)

  // Ctrl+Z 回退：步数回到走之前的数值
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 })
  await sleep(250)
  check('2D 回退退回步数', (await text('#steps')) === s2, `${s2b} → ${await text('#steps')}`)

  // 滑动手势：手机上没有键盘，这是 2D 唯一的输入方式
  const sw0 = await text('#steps')
  let sw1 = sw0
  for (const [dx, dy] of [[-120, 0], [120, 0], [0, -120], [0, 120]]) {
    await drag('.b2', dx, dy)
    sw1 = await text('#steps')
    if (sw1 !== sw0) break
  }
  check('2D 滑动手势有效', sw1 !== sw0, `${sw0} → ${sw1}`)

  // ---- 切回 3D，步数应还是 3D 自己的 ----
  check('点 3D 药丸', (await click('.dim[data-dim="3d"]')) === 'ok')
  await sleep(300)
  check('切回 3D', (await evaluate('document.body.dataset.dim')) === '3d')
  const back = await text('#steps')
  check('3D 步数没被 2D 覆盖', back === t3c, `${back} vs ${t3c}`)
  check('3D 画布重新显示', (await evaluate(`getComputedStyle(document.querySelector('body > canvas')).display`)) !== 'none')
  check('3D 药丸高亮', (await evaluate(`document.querySelector('.dim[data-dim="3d"]').dataset.on`)) === '1')

  // ---- 第三档：4×4×4 ----
  await click('.dim[data-dim="3d4"]')
  await sleep(900)
  check('切到 4×4×4', (await evaluate('document.body.dataset.dim')) === '3d4')
  check('4×4×4 步数档位是 200/400/800/∞',
    (await evaluate(`[...document.querySelectorAll('.mode')].map(b => b.dataset.limit).join(',')`)) === '200,400,800,0')
  check('4×4×4 有独立画布', (await evaluate(`document.querySelectorAll('body > canvas').length`)) === 2)
  check('4×4×4 标题正确', (await text('#dimName')) === '立方体 4×4×4')
  await click('.dim[data-dim="3d"]')
  await sleep(500)
  check('切回 3×3×3 恢复档位',
    (await evaluate(`[...document.querySelectorAll('.mode')].map(b => b.dataset.limit).join(',')`)) === '100,200,400,0')

  // ---- 结算遮罩不能吃掉维度按钮：局终时也要点得回另一维 ----
  await evaluate(`document.getElementById('over').dataset.on = '1'`)
  check('结算遮罩下药丸仍可点', (await hitTest('.dim[data-dim="2d"]')) === 'self', await hitTest('.dim[data-dim="2d"]'))
  await evaluate(`document.getElementById('over').dataset.on = '0'`)

  // ---- 维度会被记住：切到 2D 后重载（不带 ?dim），仍应是 2D ----
  await click('.dim[data-dim="2d"]')
  await sleep(250)
  await send('Page.enable')
  await send('Page.navigate', { url: BASE_URL })
  await sleep(1500)
  check('重载后仍是 2D（维度已记住）', (await evaluate('document.body.dataset.dim')) === '2d')
  check('重载后 2D 药丸高亮', (await evaluate(`document.querySelector('.dim[data-dim="2d"]').dataset.on`)) === '1')
  check('重载后 2D 有棋盘方块', (await evaluate(`document.querySelectorAll('.b2-tile').length`)) >= 2)

  // ---- 语言：?lang=en 整页英文，点药丸切回中文（选择写进 localStorage）----
  await send('Page.navigate', { url: `${BASE_URL}?lang=en` })
  await sleep(1600)
  check('英文界面：维度名', (await text('#dimName')) === 'Flat', await text('#dimName'))
  check('英文界面：回退按钮', (await text('[data-act="undo"]')) === '↶ Undo')
  check('英文界面：语言药丸指向中文', (await text('#langBtn')) === '中文')
  await click('#langBtn')
  await sleep(1800)
  check('点药丸切回中文', (await text('#langBtn')) === 'EN' &&
    (await evaluate('document.documentElement.lang')) === 'zh-CN',
    `${await text('#langBtn')} / ${await evaluate('document.documentElement.lang')}`)

  // ---- 页面没报错 ----
  check('无未捕获错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
}

main()
  .catch((e) => rows.push('FAIL 运行中断: ' + e.message))
  .finally(async () => {
    console.log(rows.join('\n'))
    const failed = rows.filter((r) => r.startsWith('FAIL')).length
    console.log(`\n${rows.length} 项，${failed} 项失败`)
    try { ws && ws.close() } catch { /* ignore */ }
    child.kill()
    process.exit(failed ? 1 : 0)
  })
