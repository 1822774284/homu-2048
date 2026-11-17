// 调参面板：拖动标题移动，双击标题收起/展开。
(() => {
  const panel = document.getElementById('panel')
  const head = panel && panel.querySelector('h2')
  if (!head) return
  head.title = '拖动移动 · 双击收起'
  let drag = null
  head.addEventListener('pointerdown', (e) => {
    const r = panel.getBoundingClientRect()
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top }
    panel.style.right = 'auto'
    panel.style.left = r.left + 'px'
    panel.style.top = r.top + 'px'
    try { head.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  })
  head.addEventListener('pointermove', (e) => {
    if (!drag) return
    panel.style.left = (drag.left + e.clientX - drag.x) + 'px'
    panel.style.top = (drag.top + e.clientY - drag.y) + 'px'
  })
  const end = () => { drag = null }
  head.addEventListener('pointerup', end)
  head.addEventListener('pointercancel', end)
  head.addEventListener('dblclick', () => panel.classList.toggle('collapsed'))
})()
