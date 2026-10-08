# 书页阅读器（book-viewer）设计规格

日期：2026-10-08
状态：已获设计审批，待实现计划

## 一、目标与定位

在手机上、电脑上，以「真实书本翻页」的方式阅读《高性价比人生指南》全部内容的新页面。核心体验：

- 一本**竖立、从顶边往下掀**的相册式书（像挂日历/翻页簿），配**真·3D 书页卷曲**。
- 正文自动分页成一张张固定高度的「页片」，放不下就溢出到下一页。
- 任意一页都能呼出一个**面板**：目录（高亮当前读到哪）、书签列表（可跳转）、阅读进度。
- 书签挂在「条目」上（不挂页码），换屏重排后依旧精准，可导出/导入备份。
- **桌面、手机同等打磨**；联网加载（不做离线单文件）；GitHub Pages 部署。

输入：现有 `book/*.md`（34 节，670 条）与 `README.md` 目录结构。
输出：`book-viewer/index.html` + `corpus.json`，由 `tools/` 生成器产出。

## 二、整体架构

两条独立半程，中间以 `corpus.json` 相接。

### ① 生成器（构建期）

新脚本 `tools/book-viewer/build.mjs`，复用 `tools/lib/book.mjs`（与 EPUB/PDF/离线 HTML 同一套章节清单与内容解析）。输出：

```
corpus.json
{
  "meta":   { "title", "version", "entryTotal", "sectionCount", "generatedAt" },
  "toc":    [ { "id":"s01", "title":"不要早死", "file":"book/01-…md" } ],
  "sections": [
    { "sectionId":"s01", "title":"1. 不要早死", "intro":"…", "navigation":"…(导览分组)",
      "entries":[
        { "entryId":"1-1", "num":1, "title":"系安全带…",
          "fields":{ 成本, 说人话, 收益, 证据等级, 来源, 备注 },
          "cost":{ 钱, 时间, 毅力, 收益量级, 口径 } }   // 解析自「成本标签」注释
      ]
    }
  ],
  "docs": [ { "id":"doc-…", "title":"…", "contentHtml":"…" } ]  // 长文（可选收录）
}
```

- 每条的**稳定身份是 `entryId`（节+条号）**，不靠页码。这是书签与「阅读位置」重排容错的基础。
- 生成器做成**可喂给 check 的模式**：比较已入库 `corpus.json` 与重新生成的应得值，不一致即退出码 1，供 CI 用。挂到 `sync-stats.mjs --check` 一起跑，或独立 job。

### ② 客户端（运行时）

自包含 `book-viewer/index.html`，纯静态，`fetch('corpus.json')` 同源加载。架构为**状态机 + 事件总线**。

| 模块 | 职责 |
|---|---|
| `load()` | fetch corpus，构建内存索引：entryId→{节,条}、section→entries、entryId→所属页码的映射 |
| `Pagination` | 自动分页器（见第三节） |
| `BookRenderer` | 把当前页的 DOM 画出来（正文排版、纸张样式、成本标签展示） |
| `FlipEngine` | 顶边 3D 翻页动画（见第四节），暴露 `flipTo(entryId)`、`next()`、`prev()` |
| `ReaderStore` | 状态中心：URI 阅读位置、localStorage 书签/进度 |
| `Panel` | 目录 + 书签 + 阅读进度 + 跳转（见第五节） |
| `Router` | 用 `location.hash` 存「当前条目 + 面板开合」，刷新/分享 URL 复原 |

数据流向：用户翻页 → `ReaderStore.next()` → `Pagination` 得下一页内容 → `BookRenderer` 更新下一张纸 DOM → `FlipEngine` 放一次顶边下掀 → 完成写 `location.hash` + localStorage → `Panel` 进度高亮跟着动。

## 三、自动分页器

**目标**：670 条可变长度正文，排成固定高度的页片。

- **测量**：隐藏「标尺」div，挂正文样式，按当前屏宽把每条渲染进去，量实际高度（含边距、列表、段间空隙）。
- **逐条分页**：`页剩余 ≥ 条高 → 放入本页；否则 → 条整体溢出到下一页`。**条目不跨页截断**，保证任意条目连同它的书签永远在同一张页上。这是硬约束。
- **孤行控制**：某条仅剩极小块空间时，整条推到下页，避免「纸上只有一个标题」。
- **结果**：`page[]`，每页 `{ pageId, [entryId…], currentTopEntryId }`。书签/阅读位置指 `entryId`，重排后依旧能找到；读位置 = 距当前页顶最近的条目。
- **换屏重排**：从 `ReaderStore` 当前 entryId 重新分页，翻回当前页。页片固定高（=可视区），跨页是内存里的页数组，不预先生成一堆 DOM。
- **性能**：分页只在**首次加载 + 换屏**时跑（670 条全量约几十到一百多 ms，纯布局）。翻页瞬间不重算——用已分号的页数组。缓存：记每个 entryId 的「测量高 + 所用屏宽」，同屏宽直接复用；翻页只动 transform/opacity，不触发布局。

## 四、顶边 3D 翻页（FlipEngine）

- **结构**：`perspective` 容器里叠三张页片——面前的纸（front）、正翻过去的纸（turning）、身后的纸（back）。翻页 = 顶层纸绕**顶边** `rotateX` 从 0 到 `-180°`，配背面 Z 偏移、投影、纸张透光。
- **真实感**：
  - 翻转中用一段**渐变遮罩 + 顶部高光**模拟纸在折弯处受光。
  - 纸从顶边弯下：用 `clip-path` / 多层 transform 在翻转中段压一个中部隆起（背面纸「翘起」），避免平板翻转的假感。
  - 背景放**桌面/书脊阴影**，让竖立的册子「悬在场景里」有纵深。
- **单列相册**：一次只翻一张，符合顶边下掀，天然适配竖屏。
- **偏好**：`prefers-reduced-motion` 时退化为淡入淡出。

## 五、书签、目录、面板、进度

- **书签**挂 `entryId`，localStorage。**导出/导入**一个 JSON 文件做备份迁移。
- **面板**：可从任意页呼出；桌面为收起的侧栏/抽屉，手机为底部弹出。三个 tab：
  - **目录**：34 节按 README 结构；**当前在读节/条目高亮**；点条目翻到那一页。
  - **书签**：列标签，显示标题 + 节号，点跳转。
  - **进度**：全书总进度（已读条目/总数）+ 每节内进度条。
- **进度 & 阅读位置**：localStorage + `location.hash`，刷新/分享 URL 可复原。

## 六、平台适配、性能、可靠性

- **桌面/手机同级**：竖屏为主，横屏保持单栏居中；面板桌面左侧抽屉、手机底部弹出。以「可视区高度 = 页片高」为准，视口变化（含地址栏显隐、横竖屏切换）触发重排。
- **可靠性**：
  - `corpus.json` 加载失败 → 显示可重试的报错页，不白屏崩溃。
  - 过时检测：meta.generatedAt 与 README 版本对不上时在控制台/状态提示「正文可能未同步」，可在 CI 的 stats 检查里一并判不匹配即红。
  - 条目含少量不可渲染结构（表格、代码块）时由现有渲染逻辑兜底，不因一页异常崩整册。
- **可访问性**：键盘方向键翻页、aria 标签、焦点移动跟随页切换、`prefers-reduced-motion` 降级。

## 七、测试

- **生成器**：产出 corpus 后跑 `check-refs --check` 校验交叉引用、校验 entryId 唯一、条数与 README 一致。
- **分页器**：抽成纯函数 + 少量 fixture 单元测试——(a) 超长条溢出到下一页、(b) 条目不跨页、(c) 换屏宽重排后读位置仍在原条目。
- **翻页**：视觉/交互人工验证；状态机用少量测试覆盖 `next/prev/flipTo` 的位置迁移。
- **CI**：正文改动自动重建 corpus；`--check` 保证入库 JSON 不落后于正文。

## 八、GitHub Pages 部署（方案 1）

- 生成器把 `book-viewer/index.html` + `corpus.json` 写进仓库（子路径部署）。
- 加一个 workflow（或并入 book.yml build），在 main 上 `book/**`、`docs/**` 变化后跑生成器并**自动提交回 main**。
- 现有 Pages「Deploy from a branch, main, /」零改动，自动在 `https://<user>.github.io/HowToLiveBetter/book-viewer/` 伺服。
- 已知代价：两个生成文件进 git 历史（JSON 可控，可接受）。将来需要时再迁「Actions 产物部署」方案 2。
- hook 挂牢：CI 的 stats 检查一并校验 `corpus.json` 版本与正文一致，过时即红。
- 入口：在 README 顶部导航表格（「长文」/衍生工具附近）加一行 `book-viewer` 链接，并按仓库现有规则手工同步 index.html 相关描述与 CLAUDE.md 目录简介。

## 附：明确不做的（YAGNI）

- 不做离线单文件内联（用户选了联网加载）。
- 不做左右双跨页展开（顶边相册单列即够）。
- 不接登录、服务端、多端云同步（书签仅 localStorage + 可导出导入）。
- 不做 Canvas 栅格化的像素级纸纹理（正文需可选、可检索，不能变成图）。
- 第一版不把 `成本标签` 做成完整筛选器，只在条目上展示它。