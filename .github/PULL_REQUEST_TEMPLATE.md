## 改了什么

<!-- 一两句。关联 issue 用 #12 这种写法。 -->

## 为什么

<!-- 不写「优化了体验」，写具体：哪一步原来会怎样，现在怎样。 -->

## 验证

- [ ] `node engine3d.js test` 全 PASS
- [ ] `node engine2d.js` 全 PASS
- [ ] `node probe-cdp.mjs` 45 项全 PASS（改了 DOM / 操作才需要）
- [ ] 手工在各档位里玩过，截图贴在下面

## 注意

- 规则改动（`engine3d.js` / `engine2d.js`）会同时影响存档与求解器，请在 PR 里说明存档兼容性
- 新增资源文件要同步改 `index.html` 里的资产版本号，否则老用户会吃旧缓存
- 项目底线：纯静态、无构建、无第三方依赖（`vendor/three.min.js` 除外）
