/* 语言层：zh / en。
 *
 * 优先级：?lang= > localStorage > navigator.language（zh* 判中文，其余英文）。
 * 带 ?lang= 访问会把结果写进 localStorage，重载后不会跳回去——probe 靠这个把无头浏览器
 * （navigator.language = en-US）钉在中文上，否则 38 项断言里的「标题是立方体」会先挂。
 *
 * 切换语言走整页重载：局面与最高分本来就存在 localStorage，刷新不掉进度，
 * 只有回退历史会丢。比给每个模块传 lang 参数便宜得多，也不会漏掉哪句。
 */
(function () {
  'use strict'

  var KEY = 'homu2048.lang.v1'
  var qs = new URLSearchParams(location.search)
  var fromUrl = (qs.get('lang') || '').toLowerCase()
  var saved = null
  try { saved = localStorage.getItem(KEY) } catch (e) { /* 隐私模式下忽略 */ }

  var lang
  if (fromUrl === 'zh' || fromUrl === 'cn' || fromUrl === 'zh-cn') lang = 'zh'
  else if (fromUrl === 'en') lang = 'en'
  else if (saved === 'zh' || saved === 'en') lang = saved
  else lang = (navigator.language || 'zh').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'

  if (lang !== saved) { try { localStorage.setItem(KEY, lang) } catch (e) { /* ignore */ } }

  var D = {
    zh: {
      pageTitle: '吼姆 2048 · 立方体 / 平面',
      brand: '吼姆',
      boot: '正在加载…',
      bootSlow: '还在加载 three.js…（首次约 670KB，之后有缓存）',
      touchHint: '单指滑动 = 推方块 · 双指拖动或 ↺ ↻ = 转视角',
      dim2d: '2D 平面',
      dim3d: '3D 3×3×3',
      dim3d4: '3D 4×4×4',
      stepsLabel: '步数',
      footLimit: '步数上限',
      unlimited: '无限',
      title3d: '立方体 3×3×3',
      title3d4: '立方体 4×4×4',
      title2d: '平面',
      sub3d: '方向键 4 向 · Q/E 走层深 · L 分层 · V 视角复位 · M 静音 · 拖拽转视角 · R 重开',
      sub3d4: '同一套六向操作 · 64 格 · 4 层 · L 分层 · V 视角复位 · R 重开',
      sub2d: '方向键 / WASD 移动 · 标准 4×4 · Ctrl+Z 回退 · M 静音 · R 重开',
      foot3d: '特殊块：虚线框标记，只能与同值特殊块合并，合并即消失',
      foot3d4: '4×4×4：64 格 · 存档与最高分和 3×3×3 分开记',
      foot2d: '平面 4×4 · 与立方版分开记最高分，存档与步数模式各自独立',
      viewBtn: '⌂ 视角',
      restartBtn: '⟳ 重开',
      undoBtn: '↶ 回退',
      tipView: '视角复位（V）',
      tipRestart: '重开一局（R）',
      tipUndo: '回退一步（Ctrl+Z）',
      tipSound: '音效开关（M）',
      tipYawL: '向左转视角（Shift+←）',
      tipYawR: '向右转视角（Shift+→）',
      overTitle: '结束',
      overSub: '按 R 或点这里重开',
      overSteps: '步数用尽',
      overStuck: '无路可走',
      overLine: function (h) {
        return '本局 ' + h.score + ' 分 · ' + h.steps + ' 步 · 最高 ' + h.best + ' 分 · 按 R 或点这里重开'
      },
      near: '近',
      far: '远',
      langSwitch: 'EN',
      langTitle: '切换为 English',
      botBadge: '求解器代打中',
      botEnd: function (h) { return '结束 · ' + h.score + ' 分 · ' + h.steps + ' 步' },
    },
    en: {
      pageTitle: 'Homu 2048 — Cube & Flat',
      brand: 'Homu',
      boot: 'Loading…',
      bootSlow: 'Still loading three.js… (~670 KB the first time, cached afterwards)',
      touchHint: 'Swipe to push · two fingers or ↺ ↻ to orbit',
      dim2d: '2D Flat',
      dim3d: '3D 3×3×3',
      dim3d4: '3D 4×4×4',
      stepsLabel: 'Steps',
      footLimit: 'Move limit',
      unlimited: '∞',
      title3d: 'Cube 3×3×3',
      title3d4: 'Cube 4×4×4',
      title2d: 'Flat',
      sub3d: 'Arrows move · Q/E layer depth · L explode · V reset view · M mute · drag to orbit · R restart',
      sub3d4: 'Same six directions · 64 cells · 4 layers · L explode · V reset view · R restart',
      sub2d: 'Arrows / WASD · standard 4×4 · Ctrl+Z undo · M mute · R restart',
      foot3d: 'Special blocks (dotted outline) only merge with an equal special — both vanish',
      foot3d4: '4×4×4: 64 cells · save and best score are kept apart from 3×3×3',
      foot2d: 'Flat 4×4 · best score kept apart from the cube boards',
      viewBtn: '⌂ View',
      restartBtn: '⟳ Restart',
      undoBtn: '↶ Undo',
      tipView: 'Reset the view (V)',
      tipRestart: 'Restart the game (R)',
      tipUndo: 'Undo one step (Ctrl+Z)',
      tipSound: 'Sound on / off (M)',
      tipYawL: 'Orbit left (Shift+←)',
      tipYawR: 'Orbit right (Shift+→)',
      overTitle: 'Game over',
      overSub: 'Press R or tap here to restart',
      overSteps: 'Out of moves',
      overStuck: 'Stuck — no move left',
      overLine: function (h) {
        return 'Score ' + h.score + ' · ' + h.steps + ' moves · best ' + h.best + ' · press R or tap to restart'
      },
      near: 'Near',
      far: 'Far',
      langSwitch: '中文',
      langTitle: '切换到中文',
      botBadge: 'Solver playing',
      botEnd: function (h) { return 'Done · ' + h.score + ' points · ' + h.steps + ' moves' },
    },
  }

  function t (key) {
    var v = D[lang][key]
    if (v == null) v = D.zh[key]
    if (typeof v === 'function') return v.apply(null, [].slice.call(arguments, 1))
    return v
  }

  /** 把静态文案灌进去：data-i18n / data-i18n-title / data-i18n-html。 */
  function apply (root) {
    var scope = root || document
    var nodes = scope.querySelectorAll('[data-i18n]')
    for (var i = 0; i < nodes.length; i++) {
      var v = t(nodes[i].getAttribute('data-i18n'))
      if (v != null) nodes[i].textContent = v
    }
    nodes = scope.querySelectorAll('[data-i18n-title]')
    for (var j = 0; j < nodes.length; j++) {
      var tv = t(nodes[j].getAttribute('data-i18n-title'))
      if (tv != null) nodes[j].setAttribute('title', tv)
    }
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    document.title = t('pageTitle')
  }

  /** 切语言：存一次，带 lang 参数进来的那种 URL 要把参数去掉，否则重载又被覆盖。 */
  function set (next) {
    try { localStorage.setItem(KEY, next) } catch (e) { /* ignore */ }
    var url = new URL(location.href)
    url.searchParams.delete('lang')
    location.replace(url.toString())
  }

  window.HomuI18n = {
    lang: lang,
    other: lang === 'zh' ? 'en' : 'zh',
    t: t,
    apply: apply,
    set: set,
    KEY: KEY,
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply() })
  else apply()
})()
