# 投放素材与文案

> 这份是给舰长直接复制粘贴用的，不是给玩家看的。改一个字都可以，别改链接。

## 素材清单

| 用途 | 文件 |
| --- | --- |
| 演示 GIF（3:2 竖版偏方，640×547，约 3MB） | `docs/demo.gif` |
| 桌面截图 3×3×3 / 4×4×4 / 平面 | `docs/ui-3d.png`、`docs/ui-4x4x4.png`、`docs/ui-2d.png` |
| 手机截图 | `docs/mob-m3.png`、`docs/mob-m4.png`、`docs/mob-m2.png` |
| 社交卡片（1280×640） | `docs/social-preview.png` |

- 线上：<https://1822774284.github.io/homu-2048/>
- 仓库：<https://github.com/1822774284/homu-2048>

## 一句话介绍（不同长度，按平台截取）

- 12 字：**把 2048 塞进 3×3×3 的立方体里**
- 30 字：**六个方向都能推的 2048，四层还能拆开看；顺带塞了 4×4×4 和经典平面版**
- 60 字：**吼姆 2048：把 2048 塞进 3×3×3 的立方体，六个方向推、四层能拆开；同一页还有 4×4×4 和经典 4×4。纯静态单页，无依赖，手机上也能玩**

## 中文

### B站动态

> 把 2048 塞进立方体里会怎样——做了个 3×3×3 的立体 2048，六个方向都能推，四层还能拆开看。同一页还塞了 4×4×4 和经典平面版，纯网页，点开就玩，手机上也能转视角。
> 网页版在评论区 ↓
> #2048 #独立游戏 #前端 #WebGL #崩坏3

配图顺序：GIF 优先，其后 `ui-4x4x4.png`、`mob-m3.png`。话题里别只挂游戏区，前端相关的标签带来的点击率更高。

### 知乎（想法 / 回答评论区）

> 周末做的一个小东西：把 2048 做成 3D 的。
>
> 麻烦的地方不在渲染，在「方向」这件事上——立方体有六个推动方向，屏幕上只有二维，所以每个方向按钮的箭头得跟着镜头转，指向按下之后方块在屏幕上会往哪边走；轴正对镜头的时候，这个箭头会退化成「近/远」。
>
> 顺手做了三套棋盘（3×3×3、4×4×4、平面 4×4），各自独立存档。纯静态单页，没有构建步骤，three.js 是单个文件塞在仓库里。
>
> 在线玩：<https://1822774284.github.io/homu-2048/>

### 贴吧（崩坏3吧 / 独立游戏吧）

> 【自制】吼姆 2048 立方体版，纯网页
>
> - 3×3×3 立方体，六个方向推，L 键把四层拆开看
> - 还有 4×4×4，以及经典平面 4×4，三套各自存档
> - 手机上单指推、双指转视角
> - 特殊块（虚线框）只跟同值特殊块合并，两块一起消失，一次腾两格
>
> 点开就玩，不用下载：https://1822774284.github.io/homu-2048/

### 小红书

> 做了个立体版 2048 🧊
>
> 3×3×3 的立方体，六个方向都能推，按 L 还能把四层拆开看（这个最爽）。
> 顺手做了 4×4×4 和经典平面版，三种棋盘各自存档，互不覆盖。
> 纯网页，不用下载，手机也能玩，双指转视角。
>
> 数字推到 2048 时，方块上不再写数字，而是「吼姆」两个字。

配图：`demo.gif` + 三张手机截图（竖图优先，小红书吃竖图）。

### V2EX（分享创造节点）

> **标题**：把 2048 做成 3D 的：六个方向都能推，四层还能拆开
>
> 纯静态单页，无构建、无外部依赖（three.js 单文件塞进仓库）。
>
> 几个实现上的点：
> - 规则层跟渲染层分开，engine 不碰 DOM，只返回每个方块从哪来到哪去，动画层负责插值
> - 静止时不重绘，动画 / 相机 / 重建才打脏标记
> - 空格提示合并成一个 InstancedMesh，4×4×4 满盘 65 draw、约 11 万三角形
> - 求解器两段前瞻（走一步 → 枚举每个空格长新块 → 再算一步），200 步 20 局中位 2580 分
>
> 在线：https://1822774284.github.io/homu-2048/
> 源码：https://github.com/1822774284/homu-2048

## English

### Show HN

**Title**（≤80 字符，别用 "Show HN: I made…" 这种套话）:

> Show HN: 2048 in 3D — push along six axes, pull the layers apart

**First comment**（HN 规矩：正文解释「怎么做的」，链接单独给）:

> Live: https://1822774284.github.io/homu-2048/
>
> It started as a joke about 2048 having "one more axis". 3×3×3 gives 27 cells and six push directions; a 4×4×4 board is the same rules at 64 cells, and a classic flat 4×4 is there too.
>
> The interesting problem was input, not rendering. A cube has six push directions and the screen has two. So each direction pad's arrow rotates with the camera and points at where the blocks will travel on screen; when an axis faces the camera head-on the label degrades to near/far.
>
> Rendering: three.js r160 vendored as a single file, no build step. Rules live in engine3d.js and never touch the DOM — they return where every block came from and went to, and the animation layer interpolates. Nothing redraws while idle. Empty-cell hints are one InstancedMesh; a full 4×4×4 board is 65 draw calls, ~110k triangles.
>
> There is also a two-ply solver (one move, assume a tile in every empty cell, evaluate one more) used for the autoplay/demo mode; median 2580 over 20 runs of 200 moves.
>
> Everything is MIT, no tracking, no network at runtime.

### Reddit r/webdev / r/WebGames / r/threejs

**Title**:

> I made a 3D 2048 — six push directions, and you can pull the layers apart

**Body**:

> Live: https://1822774284.github.io/homu-2048/
>
> Pure static page — no build step, three.js vendored as one file, no network requests at runtime.
>
> The part I enjoyed most was the input model. Six push directions on a 2D screen means every direction pad has to re-orient itself as the camera orbits: the arrow points at where blocks will actually travel on screen, and collapses to near/far when an axis faces you.
>
> Also in there: a 4×4×4 board, a classic flat 4×4, per-board saves, undo across 50 steps (you can undo out of a dead end), and a two-ply solver for the demo mode.
>
> Source (MIT): https://github.com/1822774284/homu-2048
>
> Happy to answer anything about the render/camera side — that's where most of the bugs were.

## 发布节奏

1. 先修好仓库的 Social preview（Settings → Social preview → 上传 `docs/social-preview.png`），再发任何链接——之后所有转发卡片都用这张。
2. 同一天发两处足够：一个中文社区 + 一个英文社区。分发太散，回复不过来，反而没人管。
3. 发布后 4 小时内盯评论：3D 眩晕、手机操作、求解器这三个问题最常被问，答案已经在 README 里，直接摘。
4. V2EX / HN 掉下去很快，别删重发；隔一周换一个切入点（比如只讲方向按钮怎么跟镜头转）再发一次。

## 国内访问（可选）

GitHub Pages 走境外 CDN，首次加载 three.js（约 670KB）在国内可能要 3–6 秒。两个备选，都要账号，所以只能手动做：

| 方案 | 代价 | 说明 |
| --- | --- | --- |
| Gitee Pages | 实名认证 + 仓库镜像 | 免费版要手动点「更新」才会重新部署，长期会掉队；镜像仓库容易跟主仓库不同步 |
| Cloudflare Pages | 一个 Cloudflare 账号 | 连 GitHub 仓库、构建命令留空、输出目录 `/`，之后每次 push 自动部署；国内速度只比 GitHub Pages 稍好 |

判断标准：如果投放后一周内国内访问占比高（看不了统计，靠评论反馈），再做镜像；否则不值得维护第二份部署。

## 不要做的事

- 不要在群里发「求 star」。GitHub 的 trending 看的是 star 增速，但被举报刷量会直接沉底。
- 不要在没有 WebGL 的环境（比如某些公司内网 / 老 iPad）上截图当宣传图。
- 不要承诺「支持 5×5×5」——代码里 N 参数夹在 2..5，但 5×5×5 没做性能与存档验证。
