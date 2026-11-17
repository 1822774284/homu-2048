/* 音效层：全部用 Web Audio 现场合成，不依赖任何音频文件。
 * 目标是“解压向”的软音色：短促的敲击 + 一点点混响尾，避开方波那种刺的声音。
 * 音高走小调五声，同时响两三个合并音也不会打架。
 */
(function () {
  'use strict'

  const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24] // 小调五声音阶（半音）
  const ROOT = 220                                          // A3

  /** 建一套音色引擎，挂到 ctx 的 dest 上。离线渲染测试也走同一个函数。 */
  function engine (ctx, dest) {
    const out = ctx.createGain()
    out.gain.value = 0.9
    out.connect(dest || ctx.destination)

    // 0.45s 衰减噪声当脉冲响应，给声音一点“房间”，尾巴软
    const irLen = Math.max(1, Math.floor(ctx.sampleRate * 0.45))
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c)
      for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.4)
    }
    const verb = ctx.createConvolver()
    verb.buffer = ir
    const wet = ctx.createGain()
    wet.gain.value = 0.2
    verb.connect(wet)
    wet.connect(out)

    // 一份共用噪声缓冲，滑音/敲击的“沙”用它
    const nLen = Math.max(1, Math.floor(ctx.sampleRate * 0.4))
    const noiseBuf = ctx.createBuffer(1, nLen, ctx.sampleRate)
    const nd = noiseBuf.getChannelData(0)
    for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1

    function tone (at, freq, gain, dur, type) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = type || 'sine'
      osc.frequency.setValueAtTime(freq, at)
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      osc.connect(g)
      g.connect(out)
      g.connect(verb)
      osc.start(at)
      osc.stop(at + dur + 0.03)
      return osc
    }

    function noise (at, dur, gain, hi, lo, q) {
      const src = ctx.createBufferSource()
      src.buffer = noiseBuf
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.value = q || 0.9
      bp.frequency.setValueAtTime(hi, at)
      bp.frequency.exponentialRampToValueAtTime(Math.max(60, lo), at + dur)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      src.connect(bp)
      bp.connect(g)
      g.connect(out)
      g.connect(verb)
      src.start(at)
      src.stop(at + dur + 0.03)
    }

    /** 合并：音高跟着块的大小走，越大越高；连击时靠 order 错开一点点。 */
    function merge (value, order) {
      const t = ctx.currentTime + 0.004 + (order || 0) * 0.035
      const lv = Math.max(1, Math.round(Math.log2(Math.max(2, Math.abs(value || 2)))))
      const idx = Math.min(PENTA.length - 1, Math.max(0, lv - 1))
      const f = ROOT * Math.pow(2, PENTA[idx] / 12)
      tone(t, f, 0.3, 0.38, 'sine')
      tone(t, f * 2, 0.1, 0.26, 'triangle')
      tone(t, f * 3.01, 0.05, 0.18, 'sine')   // 轻微非谐，听着更像“敲”而不是“电子音”
      noise(t, 0.05, 0.05, f * 6, f * 3, 1.4) // 起音的一点沙
    }

    /** 滑动：一声音高快速下坠的闷响，像棋子落到木盘上。
     *  之前是“高频气流 + 940Hz 亮音”，噪声像纸摩擦、亮音像电子表按键，听感很差。 */
    function glide (at, f0, f1, gain, dur) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(f0, at)
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), at + dur * 0.7)
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      osc.connect(g)
      g.connect(out)
      g.connect(verb)
      osc.start(at)
      osc.stop(at + dur + 0.03)
    }

    /** 无合并时的移动音（含落块）：一声木头感的闷敲。 */
    function move () {
      const t = ctx.currentTime + 0.003
      glide(t, 215, 138, 0.17, 0.12)          // 主体：低频下坠，木头/陶土的“咚”
      glide(t, 430, 300, 0.05, 0.07)          // 一层薄泛音，给它“实心”的感觉
      noise(t, 0.02, 0.055, 2100, 900, 1.6)   // 只留 20ms 的起音“嗒”，不做长气流
    }

    /** 特殊块对消：三个上行短音，像“噗”地散开。 */
    function vanish () {
      const t = ctx.currentTime + 0.004
      tone(t, 620, 0.12, 0.13, 'sine')
      tone(t + 0.05, 830, 0.1, 0.15, 'sine')
      tone(t + 0.1, 1108, 0.08, 0.18, 'triangle')
      noise(t, 0.16, 0.05, 3800, 1200, 0.6)
    }

    /** 局终：两声下行，收得慢一点。 */
    function over () {
      const t = ctx.currentTime + 0.01
      tone(t, 392, 0.16, 0.4, 'sine')
      tone(t + 0.16, 261.6, 0.18, 0.7, 'sine')
      tone(t + 0.16, 523.2, 0.05, 0.5, 'triangle')
    }

    /** 回退：短促下滑，有点“倒带”的意思。 */
    function undo () {
      const t = ctx.currentTime + 0.004
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(520, t)
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.16)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
      osc.connect(g)
      g.connect(out)
      g.connect(verb)
      osc.start(t)
      osc.stop(t + 0.24)
    }

    /** 界面轻点。 */
    function click () {
      const t = ctx.currentTime + 0.002
      tone(t, 760, 0.06, 0.05, 'sine')
      noise(t, 0.03, 0.04, 4200, 2200, 1.2)
    }

    return { merge, move, glide, vanish, over, undo, click, tone, noise, node: out, verb }
  }

  /* ---------- 页面用的单例 ---------- */
  let ctx = null
  let live = null
  let enabled = true
  try { enabled = localStorage.getItem('homu3d.sound.v1') !== '0' } catch { /* ignore */ }

  function unlock () {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!ctx) {
      if (!AC) return null
      ctx = new AC()
      live = engine(ctx, ctx.destination)
    }
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }
  // 浏览器不允许无手势出声：第一次按键/点击时把上下文点亮
  addEventListener('pointerdown', unlock, { passive: true })
  addEventListener('keydown', unlock)

  function play (name, ...args) {
    if (!enabled) return
    if (!unlock() || !live) return
    try { live[name](...args) } catch { /* 声音不该影响玩法 */ }
  }

  window.HomuAudio = {
    engine,
    get enabled () { return enabled },
    toggle () {
      enabled = !enabled
      try { localStorage.setItem('homu3d.sound.v1', enabled ? '1' : '0') } catch { /* ignore */ }
      if (enabled) play('click')
      return enabled
    },
    merge: (v, i) => play('merge', v, i),
    move: () => play('move'),
    vanish: () => play('vanish'),
    over: () => play('over'),
    undo: () => play('undo'),
    click: () => play('click'),
    /** 给试听页用的即插即用上下文 */
    context () {
      const c = unlock()
      return c && live ? { ctx: c, engine: live } : null
    },
  }
})()
