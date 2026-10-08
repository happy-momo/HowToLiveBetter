# 书页阅读器（book-viewer）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个 `book-viewer/` 子目录下的 HTML 翻书页，能顶边下掀、真·3D 卷曲地读完整本 670 条的《高性价比人生指南》，带目录高亮、书签（localStorage + 可导出导入）、阅读进度，桌面和手机同等打磨，纯静态 fetch JSON，GitHub Pages 子路径部署。

**Architecture:** 生成器 `tools/book-viewer/build.mjs` 复用 `lib/book.mjs` 把 `book/*.md` + docs 转成 `book-viewer/corpus.json`（条目带稳定 `entryId`=节-条号）；客户端 `book-viewer/index.html` + `app.js` + `paginate.mjs` + `style.css` 运行时 fetch corpus、用隐藏标尺测每条真实高度、调用纯函数 `packEntries` 分页成固定高页片，再用顶边 `rotateX` 3D 翻页。书签与阅读位置挂在 entryId 上，重排不丢。GitHub Actions 在正文变化时重建 corpus 并自动提交回 main。

**Tech Stack:** 纯 Node (ver.2x) 构建脚本；浏览器原生 ES modules + CSS 3D transforms；无第三方运行时依赖。GitHub Actions（`git-auto-commit-action`）。

**关联规格:** `docs/superpowers/specs/2026-10-08-book-viewer-design.md`

## Global Constraints

- `entryId` = `${节号}-${条号}`，全案唯一稳定身份；书签、阅读位置、跳转一律用它，不碰页码。
- 条目不跨页截断；放不下整条推到下一页。口算成本：670 条全量测量约几十到一百多 ms，只在首次加载 + 换屏跑。
- 翻页只动 `transform`/`opacity`（合成层），不触发布局；`prefers-reduced-motion` 退化为淡入淡出。
- 桌面为左侧抽屉面板、手机为底部弹层；页片高 = 可视区高。
- 客户端不引任何库；进程内 fetch 同源 `corpus.json`。无 `file://` 支持需求（用户选定联网加载）。
- 生成器 `--check` 模式比较时忽略 `generatedAt`/`gitCommit`，只比结构（否则时间戳永远导致失败）。
- 复用的现有解析：`tools/lib/book.mjs` 的 `read`、`readBook`、`stripBackLink`、`buildStamp`、`gitCommit`。不改它们。
- 金额书写、简体中文等全书规则不适用于代码注释；代码注释用简体中文即可，不含要求口吻的感叹号。

## File Structure

```
book-viewer/                              # 提交入库、served at /book-viewer/
├── index.html                            # 壳：容器 + <script type="module" src="app.js">
├── paginate.mjs                          # 纯分页逻辑（Node 与浏览器共用，单一来源）
├── app.js                                # 浏览器应用：加载 corpus、测量、渲染、翻页、书签、面板、路由
├── style.css                              # 纸感 / 透视 / 面板 / 响应式
└── corpus.json                            # 【生成】tools/book-viewer/build.mjs 产出，workflow 自动提交

tools/book-viewer/
├── build.mjs                             # 生成器（读 book/*.md + docs → corpus.json）
└── test/
    ├── fixtures/00-样例小节.md            # 生成器解析的固定样例
    ├── paginate.test.mjs                 # 纯分页函数单元测试
    └── build.test.mjs                    # 生成器解析与全量不变量测试
```

Dependencies 方向：`build.mjs` → `lib/book.mjs`；`app.js` → `paginate.mjs`（`./paginate.mjs`）；`paginate.test.mjs` → `../../book-viewer/paginate.mjs`；`build.test.mjs` → `build.mjs`。无循环。

---

### Task 1: 纯分页函数 `packEntries`

**Files:**
- Create: `book-viewer/paginate.mjs`
- Test: `tools/book-viewer/test/paginate.test.mjs`

**Interfaces:**
- Produces: `packEntries(entryHeights: number[], pageHeight: number, opts?: { singleEntryCap?: number }) → { pageId: number, topEntry: number, entries: number[] }[]`
  - `entryHeights`：每条页内净高数组（下标即全局条目下标，0 起）。
  - `pageHeight`：页内可用高度。
  - 返回页数组；每页 `entries` 为放入的条目下标、`topEntry` 为该页第一条的下标（供「读位置 = 距顶最近条目」用）。
  - 规则：条目不跨页；`used + h <= pageHeight` 则放入本页否则整条进新页；单条高于 `singleEntryCap`（默认 = pageHeight）时钳到 cap，保证不撑破页高。

- [ ] **Step 1: 写失败测试**

```js
// tools/book-viewer/test/paginate.test.mjs
import assert from 'node:assert/strict';
import { packEntries } from '../../book-viewer/paginate.mjs';

function ids(res) { return res.map(p => p.entries); }
function tops(res) { return res.map(p => p.topEntry); }

assert.deepEqual(ids(packEntries([10, 20, 40], 100)), [[0, 1, 2]], '全部塞进一页');
assert.deepEqual(tops(packEntries([10, 20, 40], 100)), [0]);
assert.deepEqual(ids(packEntries([60, 60], 100)), [[0], [1]], '第二条放不下整条推到下页');
assert.deepEqual(tops(packEntries([60, 60], 100)), [0, 1]);
assert.deepEqual(ids(packEntries([50, 50], 100)), [[0, 1]], '贴合边界仍一页');
assert.deepEqual(ids(packEntries([10, 90, 10], 80)), [[0], [1], [2]], '中间超高的条独占一页');
assert.deepEqual(ids(packEntries([200], 100)), [[0]], '单条超过页高被钳到 cap 仍成一页');
assert.deepEqual(ids(packEntries([], 100)), [], '空输入');
console.log('packEntries 全部通过');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node tools/book-viewer/test/paginate.test.mjs`
Expected: FAIL — `Cannot find module '../../book-viewer/paginate.mjs'`。

- [ ] **Step 3: 实现**

```js
// book-viewer/paginate.mjs
// 纯函数自动分页：把「每条净高」塞进固定高度的页。条目不跨页，放不下整条推到下一页。
export function packEntries(entryHeights, pageHeight, opts = {}) {
  const cap = opts.singleEntryCap != null ? opts.singleEntryCap : pageHeight;
  const pages = [];
  let cur = null;
  entryHeights.forEach((h, i) => {
    const clamp = Math.min(h, cap);
    if (cur && cur.used + clamp <= pageHeight) {
      cur.entries.push(i);
      cur.used += clamp;
    } else {
      cur = { pageId: pages.length, topEntry: i, entries: [i], used: clamp };
      pages.push(cur);
    }
  });
  return pages.map(p => ({ pageId: p.pageId, topEntry: p.topEntry, entries: p.entries }));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node tools/book-viewer/test/paginate.test.mjs`
Expected: PASS，打印「packEntries 全部通过」。

- [ ] **Step 5: Commit**

```bash
git add book-viewer/paginate.mjs tools/book-viewer/test/paginate.test.mjs
git commit -m "book-viewer: packEntries 纯分页函数（条目不跨页）"
```

---

### Task 2: 生成器 `build.mjs`

**Files:**
- Create: `tools/book-viewer/build.mjs`
- Test: `tools/book-viewer/test/fixtures/00-样例小节.md`、`tools/book-viewer/test/build.test.mjs`

**Interfaces:**
- Consumes: `lib/book.mjs` 的 `read`、`readBook`、`stripBackLink`、`buildStamp`、`gitCommit`。
- Produces:
  - `parseSectionFile(path, sectionNo)` → `{ sectionId, title, intro, navigation, entries }`；`entries[i]` = `{ entryId, num, title, fields: {成本,说人话,收益,证据等级,来源,备注}, cost: {钱,时间,毅力,收益,口径} | null }`。
  - `buildCorpus()` → `{ corpus, structural }`：`corpus` 为完整对象（含 meta），`structural` 为剥掉 `meta.generatedAt/gitCommit` 后的稳定字符串（供 `--check` 比较）。
  - CLI：默认写 `book-viewer/corpus.json`；`--check` 只比较不写，过时则退出码 1。

- [ ] **Step 1: 建样例并写失败测试**

```markdown
<!-- tools/book-viewer/test/fixtures/00-样例小节.md -->
[← 回总目录](../README.md)

# 0. 样例小节

这是一小节引言，只有两句话。第二句讲收益口径。

本节条目按主题分成下面几块，括号里是条号。

**甲组**：系安全带（第 1 条）。

### 1. 系安全带
<!-- 成本标签: 钱=0 时间=少 毅力=否 收益=大 口径=死亡率 -->
- 成本：不花钱，每次 2 秒。
- 说人话：出车祸死亡概率大约降一半。
- 收益：NHTSA 估计致命伤风险下降 45%。第二句收益。
- 证据等级：A
- 来源：NHTSA (2024). <https://crashstats.nhtsa.dot.gov/Api/Public/ViewPublication/813573>
- 备注：后排也要系。

### 2. 量血压
<!-- 成本标签: 钱=少 时间=少 毅力=些 收益=大 口径=死亡率 -->
- 成本：血压计一百元。
- 说人话：血压每降 10 mmHg 中风低 27%。
- 收益：Ettehad 2016 荟萃分析，收缩压每降 10 mmHg 卒中低 27%（RR 0.73）。这里有一段比较长的收益说明，用来验证多行的收益栏不会被截断，最后一行在这里结束。
- 证据等级：A
- 来源：Lancet. <https://doi.org/10.1016/S0140-6736(15)01225-8>
- 备注：先去量一次。
```

```js
// tools/book-viewer/test/build.test.mjs
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSectionFile, buildCorpus, structuralString } from '../build.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const fx = resolve(ROOT, 'tools/book-viewer/test/fixtures/00-样例小节.md');

const s = parseSectionFile(fx, 0);
assert.equal(s.sectionId, 's0');
assert.equal(s.title, '0. 样例小节');
assert.ok(s.intro.startsWith('这是一小节引言'), '引言拆分正确');
assert.ok(s.navigation.includes('系安全带（第 1 条）'), '导览拆分正确');
assert.equal(s.entries.length, 2);
assert.equal(s.entries[0].entryId, '0-1');
assert.equal(s.entries[0].fields['说人话'], '出车祸死亡概率大约降一半。');
assert.equal(s.entries[0].fields['收益'], 'NHTSA 估计致命伤风险下降 45%。第二句收益。');
assert.deepEqual(s.entries[0].cost, { 钱: '0', 时间: '少', 毅力: '否', 收益: '大', 口径: '死亡率' });
assert.ok(s.entries[1].fields['收益'].includes('多行的收益栏不会被截断'), '多行收益栏整体保留');
assert.equal(s.entries[0].num, 1);

const { corpus, structural } = buildCorpus();
assert.equal(corpus.meta.entryTotal, 670, '全书条目数不变量');
assert.equal(corpus.entryIdsUnique, true, 'entryId 全局唯一');
assert.ok(structuralString(corpus).includes('"entryId":"1-1"'), '结构串含稳定身份');
assert.ok(Array.isArray(corpus.sections) && corpus.sections.length === 34, '34 节不变量');
// entryTotal 与 README 徽章一致：直接重建两次，二次结构串必须一致（确定性）
const again = buildCorpus().structural;
assert.equal(structural, again, '生成确定性：两次结构一致');
console.log('build 测试全部通过');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node tools/book-viewer/test/build.test.mjs`
Expected: FAIL — `Cannot find module '../build.mjs'`。

- [ ] **Step 3: 实现生成器**

```js
// tools/book-viewer/build.mjs
import { read, readBook, stripBackLink, buildStamp, gitCommit } from '../lib/book.mjs';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT = resolve(ROOT, 'book-viewer/corpus.json');

export function parseSectionFile(path, sectionNo) {
  const md = stripBackLink(read(path));
  const title = (md.match(/^# (.+)$/m) || [, ''])[1].trim();
  const rest = md.replace(/^# .+$/m, '').trim();
  const firstEntry = rest.indexOf('### ');
  const pre = firstEntry < 0 ? rest : rest.slice(0, firstEntry).trim();
  const entriesBody = firstEntry < 0 ? '' : rest.slice(firstEntry);

  const navMarker = '本节条目按主题分成下面几块，括号里是条号。';
  let intro = pre;
  let navigation = '';
  if (pre.includes(navMarker)) {
    const i = pre.indexOf(navMarker);
    intro = pre.slice(0, i).trim();
    navigation = pre.slice(i + navMarker.length).trim();
  }

  const entries = [];
  const re = /### (\d+)\. (.+)\n([\s\S]*?)(?=\n### |$)/g;
  let m;
  while ((m = re.exec(entriesBody)) && entriesBody) {
    const [, num, entryTitle, flds] = m;
    const fields = {};
    for (const key of ['成本', '说人话', '收益', '证据等级', '来源', '备注']) {
      const r = new RegExp(`- ${key}：([\\s\\S]*?)(?=\\n- (?:成本|说人话|收益|证据等级|来源|备注)：|$)`);
      const hit = flds.match(r);
      fields[key] = hit ? hit[1].trim() : '';
    }
    let cost = null;
    const tag = flds.match(/<!-- 成本标签: (.+?) -->/);
    if (tag) {
      const kvs = tag[1].matchAll(/(钱|时间|毅力|收益|口径)=([^ ]+)/g);
      cost = Object.fromEntries([...kvs].map(x => [x[1], x[2]]));
    }
    entries.push({ entryId: `${sectionNo}-${num}`, num: Number(num), title: entryTitle.trim(), fields, cost });
  }
  return { sectionId: `s${sectionNo}`, title, intro, navigation, entries };
}

function docIdFromPath(p) {
  const base = basename(p, '.md');
  return `doc-${base.replace(/[^0-9a-zA-Z一-龥]/g, '')}`;
}

export function buildCorpus() {
  const { bookFiles, docFiles } = readBook();
  const sections = bookFiles.map((f, i) => parseSectionFile(`book/${f.replace(/^book\//, '')}`, i + 1));
  const docs = docFiles.filter(p => !p.includes('/')).map(p => {
    const raw = stripBackLink(read(p));
    const title = (raw.match(/^# (.+)$/m) || [, basename(p, '.md')])[1].trim();
    return { id: docIdFromPath(p), title, contentMd: raw.replace(/^# .+$/m, '').trim() };
  });

  const entries = sections.flatMap(s => s.entries);
  const entryIds = new Set(entries.map(e => e.entryId));
  const corpus = {
    meta: {
      title: '高性价比人生指南',
      version: gitCommit(),
      entryTotal: entries.length,
      sectionCount: sections.length,
      generatedAt: buildStamp(),
      entryIdsUnique: entryIds.size === entries.length,
    },
    toc: sections.map(s => ({ id: s.sectionId, title: s.title, file: `book/${s.title[0]}…md` })),
    sections,
    docs,
  };
  return { corpus, structural: structuralString(corpus) };
}

export function structuralString(corpus) {
  const copy = structuredClone(corpus);
  copy.meta.generatedAt = '';
  copy.meta.version = '';
  return JSON.stringify(copy);
}

async function main() {
  const { corpus, structural } = buildCorpus();
  if (process.argv.includes('--check')) {
    if (!existsSync(OUT)) { console.error('corpus.json 缺失，先跑生成器'); process.exit(1); }
    const current = structuralString(JSON.parse(readFileSync(OUT, 'utf8')));
    if (current !== structural) {
      console.error('corpus.json 落后于正文，请重跑 node tools/book-viewer/build.mjs');
      process.exit(1);
    }
    console.log('corpus.json 是最新的');
    return;
  }
  writeFileSync(OUT, JSON.stringify(corpus, null, 2) + '\n', 'utf8');
  console.log(`已写 ${OUT}（${corpus.meta.entryTotal} 条 / ${corpus.meta.sectionCount} 节）`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
node tools/book-viewer/test/build.test.mjs
# 期望 PASS：build 测试全部通过
node tools/book-viewer/build.mjs
# 期望打印「已写 …/book-viewer/corpus.json（670 条 / 34 节）」
node tools/book-viewer/build.mjs --check
# 期望打印「corpus.json 是最新的」；此时应退出码 0
```

- [ ] **Step 5: Commit**

```bash
git add tools/book-viewer/ book-viewer/corpus.json
git commit -m "book-viewer: build.mjs 生成器（lib/book.mjs 复用，产 corpus.json，--check 模式）"
```

---

### Task 3: 壳与样式 `index.html` + `style.css`

**Files:**
- Create: `book-viewer/index.html`、`book-viewer/style.css`

**Interfaces:**
- Produces:
  - `index.html` 提供 id 锚点：`#stage`（透视容器）、`#front`、`#turning`、`#back`（三张页片）、`#ruler`（隐藏测量标尺）、`#panel`（面板）、`#bookmarkBtn`、`#openPanel`。
  - 全局可访问契约：`data-page`（读位置）、`.entry`（条目块）、`.sheet`（页片）、`.tab`（面板 tab）。
  - `style.css` 导出类名：`.sheet`、`.flipping`、`.paper`、`.curl`、`.fade`、`.entry`、`.bookmark-g`、`.bookmark-on`、`.toc-current`。

- [ ] **Step 1: 写壳**

```html
<!-- book-viewer/index.html -->
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>高性价比人生指南 · 书页版</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div id="desk">
  <div id="book">
    <div id="spine-top"></div>
    <div id="stage">
      <article class="sheet" id="front" data-side="front"></article>
      <article class="sheet" id="turning" data-side="turning"></article>
      <article class="sheet" id="back" data-side="back"></article>
    </div>
  </div>
  <button id="openPanel" aria-label="打开面板">☰</button>
  <div id="pgbar"><span id="pgtext"></span></div>
</div>
<div id="ruler" aria-hidden="true"></div>
<aside id="panel" aria-label="面板" hidden>
  <header>
    <span id="panelTitle">面板</span>
    <button id="closePanel">×</button>
  </header>
  <nav class="tabs">
    <button class="tab active" data-tab="toc">目录</button>
    <button class="tab" data-tab="bookmark">书签</button>
    <button class="tab" data-tab="progress">进度</button>
  </nav>
  <div id="toc" class="tabpane"></div>
  <div id="bookmark" class="tabpane">
    <button id="exportBookmarks">导出书签</button>
    <button id="importBookmarks">导入书签</button>
    <input id="importFile" type="file" accept=".json" hidden>
    <ul id="bookmarkList"></ul>
  </div>
  <div id="progress" class="tabpane">
    <div id="globalProgress"></div>
    <div id="sectionProgress"></div>
  </div>
</aside>
<script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写样式**

```css
/* book-viewer/style.css */
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; background: #3a312b; }
body { font-family: "Noto Serif SC", "Songti SC", serif; color: #26221d; overflow: hidden; }

#desk { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px 10px; }
#book { position: relative; width: 100%; max-width: 720px; height: 100%; perspective: 2200px; }
#spine-top { position: absolute; top: -14px; left: 10%; right: 10%; height: 14px; border-radius: 6px 6px 0 0; background: linear-gradient(#b0493a, #8a3529); box-shadow: 0 4px 10px rgba(0,0,0,.5); }

#stage { position: absolute; inset: 0; transform-style: preserve-3d; }
.sheet { position: absolute; inset: 0; transform-origin: 50% 0%; transform-style: preserve-3d; backface-visibility: hidden; background:
  linear-gradient(180deg, #faf7f0 0%, #f3eee3 60%, #ece5d6 100%); border-radius: 4px 4px 10px 10px;
  box-shadow: 0 18px 40px rgba(0,0,0,.45); padding: 28px 30px 34px; overflow-y: auto; }
.sheet.flipping { animation: topflip .9s cubic-bezier(.4,.1,.2,1) forwards; will-change: transform; }
@keyframes topflip { 0% { transform: none; } 100% { transform: rotateX(-178deg) translateZ(2px); } }
.sheet.turn-away { animation-name: none; transform: rotateX(-178deg) translateZ(2px); }
.sheet.fade { animation: fademove .5s ease forwards; }
@keyframes fademove { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-14px); } }

.sheet::-webkit-scrollbar { width: 6px; }
.sheet::-webkit-scrollbar-thumb { background: #c9bfa8; border-radius: 3px; }

#front { z-index: 3; }
#back { z-index: 1; transform: translateZ(-2px); box-shadow: 0 12px 24px rgba(0,0,0,.35); }
#turning { z-index: 2; pointer-events: none; }

.sheet .paper { position: relative; min-height: 100%; }
.sheet .curl { position: absolute; inset: 0; pointer-events: none; opacity: 0; background:
  repeating-linear-gradient(0deg, rgba(0,0,0,.04) 0 2px, transparent 2px 6px); mix-blend-mode: multiply; }
@keyframes curlSweep { 0% { opacity: 0; } 35% { opacity: .5; } 60% { opacity: .15; } 100% { opacity: 0; } }
.sheet.flipping .curl { animation: curlSweep .9s ease forwards; }

.entry { margin-bottom: 22px; break-inside: avoid; }
.entry h3 { margin: 0 0 8px; font-size: 22px; line-height: 1.35; color: #4a2f24; }
.entry .lbl { display: block; font-size: .92em; margin: 8px 0 2px; color: #a3462f; font-weight: 700; }
.entry .cost-tag { margin-left: .5em; }
.entry p { margin: 0 0 4px; font-size: 17px; line-height: 1.85; }
.entry .note { font-size: 15px; color: #5d564b; }

#openPanel { position: fixed; left: 12px; top: 50%; transform: translateY(-50%); z-index: 20; width: 52px; height: 52px; border-radius: 50%; border: 0; background: #b0493a; color: #fff; font-size: 26px; cursor: pointer; box-shadow: 0 6px 16px rgba(0,0,0,.4); }
#pgbar { position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,.55); color: #fdf8ef; padding: 4px 14px; border-radius: 20px; font-size: 13px; letter-spacing: .04em; }

#panel { position: fixed; top: 0; bottom: 0; left: 0; width: 340px; max-width: 88vw; z-index: 30; background: #f7f1e6;
  border-right: 1px solid #d8cbb4; box-shadow: 8px 0 28px rgba(0,0,0,.35); display: flex; flex-direction: column; transition: transform .25s ease; }
#panel[hidden] { display: none; }
#panel header { display: flex; justify-content: space-between; align-items: center; padding: 16px 16px 8px; color: #4a2f24; font-weight: 700; }
#closePanel { border: 0; background: transparent; font-size: 24px; color: #6b5c48; cursor: pointer; }
.tabs { display: flex; border-bottom: 1px solid #d8cbb4; }
.tab { flex: 1; padding: 10px; border: 0; background: transparent; cursor: pointer; font-size: 16px; }
.tab.active { background: #e9dcc3; color: #7a2e1c; font-weight: 700; }
.tabpane { flex: 1; overflow-y: auto; padding: 12px 10px; }
.toc-item { padding: 9px 8px; border-radius: 6px; cursor: pointer; font-size: 16px; line-height: 1.4; }
.toc-item:hover { background: #ebe1cb; }
.toc-item.toc-current { background: #f0c98f; color: #4a1f10; font-weight: 700; }
.toc-item .sub { display: block; font-size: 13px; color: #8a7c66; font-weight: 400; }
#bookmarkList { list-style: none; margin: 0; padding: 0; }
#bookmarkList li { padding: 8px; border-bottom: 1px solid #e4d8bf; cursor: pointer; font-size: 15px; line-height: 1.5; }
#bookmarkList li .sub { display: block; font-size: 12px; color: #8a7c66; }
#exportBookmarks, #importBookmarks { margin: 0 4px 8px; padding: 6px 12px; border: 1px solid #a46; background: #fff; border-radius: 6px; cursor: pointer; font-size: 14px; }
#globalProgress, #sectionProgress { margin-bottom: 14px; }
#globalProgress .bar, #sectionProgress .bar { height: 10px; background: #e4d8bf; border-radius: 5px; overflow: hidden; }
#globalProgress .fill, #sectionProgress .fill { height: 100%; background: #b0493a; width: 0; }

@media (max-width: 560px) {
  .sheet { padding: 18px 16px 24px; }
  .entry h3 { font-size: 19px; }
  .entry p { font-size: 16px; }
  #openPanel { top: auto; bottom: 84px; left: 10px; transform: none; }
  #panel { width: 100%; max-width: 100vw; border-right: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .sheet.flipping { animation: fademove .4s ease forwards; }
}
```

- [ ] **Step 3: 提交**

在 `index.html` 引 `app.js`，而 `app.js` 尚不存在——属预期，下一步填。先不本地看效果（还没有数据），仅确认文件在。

```bash
git add book-viewer/index.html book-viewer/style.css
git commit -m "book-viewer: 壳与纸感/透视/面板/响应式样式骨架"
```

---

### Task 4: 应用 `app.js`（加载、测量、渲染、读位置）

**Files:**
- Create: `book-viewer/app.js`

**Interfaces:**
- Consumes: `./paginate.mjs` 的 `packEntries`；Task 2 的 corpus 形态；Task 3 的 DOM 锚点。
- Produces:
  - `state = { corpus, sections, entries(平铺), entryIndex: Map<entryId, flatIndex>, pages, pageOfEntry: Map<flatIndex, pageId>, current: { flatIndex } }`
  - `measureEntries()` → `number[]`（每条 `el.offsetHeight`，用 `#ruler`）。
  - `paginate()` → `pages`；存回 `state`，并建 `pageOfEntry`。
  - `renderPage(node, flatIndex)` — 把某页内容写进某张 `.sheet`。
  - `renderEntryHTML(e)` → HTML 字符串（在测量与渲染间复用）。

- [ ] **Step 1: 写失败测试（可测小函数在下，验证后并入）**

`app.js` 是浏览器模块，无法在 Node 直接跑。可测的纯逻辑在 Task 1 已覆盖；本任务以 `renderEntryHTML` 的纯函数为可测点，抽到 `book-viewer/paginate.mjs` 同文件不便（那是分页）。改放 `app.js` 顶层；用 Node 语法检查 + 一个浏览器冒烟不可行。故本任务测试 = 用 Node 对 `renderEntryHTML` 做一次静态断言跑不通，改为**保存后人工冒烟**：本地起 http 服务看首屏三张页片渲染第一条内容。以下 Step 标注主人工程。

- [ ] **Step 2: 书写 `app.js` 主体**

```js
// book-viewer/app.js
import { packEntries } from './paginate.mjs';

const $ = id => document.getElementById(id);

// 一条的渲染：测量与真实渲染共用同一套 HTML
export function renderEntryHTML(e) {
  const f = e.fields || {};
  const c = e.cost || {};
  const tag = c && c['钱'] ? `<span class="cost-tag">钱${c['钱']}·时间${c['时间']}·毅力${c['毅力']}·收益${c['收益']}·口径${c['口径']}</span>` : '';
  const lbl = k => f[k] ? `<span class="lbl">${k}</span><p>${escapeHtml(f[k])}</p>` : '';
  return `<h3>${e.num}. ${escapeHtml(e.title)}${tag}</h3>
    ${lbl('成本')}${lbl('说人话')}${lbl('收益')}${lbl('证据等级')}${lbl('来源')}${lbl('备注')}`;
}
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeMd(s) { return escapeHtml(s); }

export const state = { corpus: null, sections: [], entries: [], entryIndex: null, pages: [], pageOfEntry: null, current: { flat: 0 } };

function sectionOf(flat) { for (const s of state.sections) if (flat < s.end) return s; return state.sections[0]; }

export async function load() {
  const res = await fetch('corpus.json');
  if (!res.ok) throw new Error(`corpus 加载失败 HTTP ${res.status}`);
  state.corpus = await res.json();
  buildFlat(); buildPages(); applyHashIndex();
  renderFragment(renderBookCover());
  renderPage($('front'), state.current.flat);
  $('back').innerHTML = renderPageHTML(0);
}

export function buildFlat() {
  state.sections = state.corpus.sections.map(s => ({ ...s, start: 0, end: 0 }));
  state.entries = state.corpus.sections.flatMap(s => s.entries);
  let acc = 0;
  for (const s of state.sections) { s.start = acc; s.end = acc + s.entries.length; acc = s.end; }
  state.entryIndex = new Map(state.entries.map((e, i) => [e.entryId, i]));
}

export function measureEntries() {
  const ruler = $('ruler');
  const heights = [];
  for (const e of state.entries) {
    const d = document.createElement('div');
    d.className = 'entry';
    d.innerHTML = renderEntryHTML(e);
    ruler.appendChild(d);
    heights.push(d.offsetHeight);
    d.remove();
  }
  return heights;
}

export function pageHeightPx() {
  const sheet = $('front');
  const ps = getComputedStyle(sheet);
  const ph = sheet.clientHeight - parseFloat(ps.paddingTop) - parseFloat(ps.paddingBottom);
  return Math.round(ph);
}

export function buildPages() {
  const heights = measureEntries();
  const pageH = pageHeightPx();
  state.pages = packEntries(heights, pageH);
  state.pageOfEntry = new Map();
  state.pages.forEach((p, pi) => p.entries.forEach(ei => state.pageOfEntry.set(ei, pi)));
}

export function renderPageHTML(pageId) {
  const p = state.pages[pageId];
  if (!p) return '<p>（末尾）</p>';
  return p.entries.map(ei => renderEntryHTML(state.entries[ei])).join('');
}

export function renderPage(node, pageId) {
  node.dataset.page = pageId;
  node.innerHTML = `<div class="paper">${renderPageHTML(pageId)}<div class="curl"></div></div>`;
  node.scrollTop = 0;
}

export function renderFragment(html) { /* 预留：未来在 front 之上叠加导览/封面，本版不展开 */ }

function renderBookCover() { return ''; }

function applyHashIndex() {
  const m = location.hash.match(/^#entry-([0-9]+-[0-9]+)$/);
  if (m) {
    const fi = state.entryIndex.get(m[1]);
    if (fi != null) state.current.flat = fi;
  }
}

export function pageIdOfCurrent() { return state.pageOfEntry.get(state.current.flat) ?? 0; }
export function refreshPgbar() { $('pgtext').textContent = `${pageIdOfCurrent() + 1} / ${state.pages.length}`; }

async function boot() {
  try {
    await load();
    refreshPgbar();
  } catch (err) {
    document.body.innerHTML = `<div style="padding:40px;color:#fff">加载失败：${escapeHtml(err.message)}。请确认已联网且服务端在 /book-viewer/ 下。</div>`;
  }
}
boot();
```

- [ ] **Step 3: 本地冒烟起服务器**

Run:
```bash
cd /home/pengyuhang/git0repo/HowToLiveBetter && python3 -m http.server 8900 &
# 浏览器开 http://localhost:8900/book-viewer/ ，期望首屏 front 页显示第 1 节第 1 条「系安全带」起，右下角进度条显示「1 / N」
```
Expected：首屏 `#front` 渲染出第一条与纸感背景，`#pgtext` 显示页码，无控制台报错（网络之外）。

- [ ] **Step 4: Commit**

```bash
git add book-viewer/app.js
git commit -m "book-viewer: app.js 加载 corpus、测量分页、首页渲染、读位置刷新"
```

---

### Task 5: 顶边 3D 翻页 `FlipEngine`

**Files:**
- Modify: `book-viewer/app.js`（追加 flipNext/flipPrev/flipTo/绑定滚轮与键盘）

**Interfaces:**
- Consumes: Task 4 的 `state`、`renderPage`、`pageIdOfCurrent`。
- Produces:
  - `flipNext()` / `flipPrev()`：当前页 +1/−1，动画翻过去，完成后更新 `state.current.flat = 新页 topEntry`、`refreshPgbar`、`updateHash`、`panelAndToc()`。
  - `flipToFlat(flatIndex)`：跳到 $state 指定条目所在页。
  - 翻页保护：动画进行中 `busy` 置位，忽略并发请求。

- [ ] **Step 1: 追加翻页逻辑**

```js
// 追加到 app.js 末尾
const front = $('front'), turning = $('turning'), back = $('back');
let busy = false;

export function flipDir(dir) { // dir=+1 下一页，-1 上一页
  if (busy) return;
  const cur = pageIdOfCurrent();
  const next = cur + dir;
  if (next < 0 || next >= state.pages.length) return;
  busy = true;
  back.dataset.page = next;
  back.innerHTML = `<div class="paper">${renderPageHTML(next)}<div class="curl"></div></div>`;
  back.scrollTop = 0;
  turning.innerHTML = front.innerHTML;
  turning.classList.add('flipping');
  front.classList.remove('flipping');
  turning.addEventListener('animationend', () => {
    front.innerHTML = back.innerHTML;
    front.dataset.page = next;
    state.current.flat = state.pages[next].topEntry;
    turning.classList.remove('flipping');
    refreshPgbar(); updateHash(); panelAndToc();
    busy = false;
  }, { once: true });
}

export function flipToFlat(flatIndex) {
  const target = state.pageOfEntry.get(flatIndex);
  if (target == null) return;
  const cur = pageIdOfCurrent();
  if (target === cur) return;
  front.innerHTML = `<div class="paper">${renderPageHTML(target)}<div class="curl"></div></div>`;
  front.dataset.page = target;
  state.current.flat = flatIndex;
  refreshPgbar(); updateHash(); panelAndToc();
}

export function updateHash() {
  const e = state.entries[state.current.flat];
  history.replaceState(null, '', `#entry-${e.entryId}`);
}

function bindNav() {
  document.addEventListener('keydown', ev => {
    if (ev.target.closest && ev.target.closest('#panel')) return;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' || ev.key === 'PageDown') flipDir(1);
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' || ev.key === 'PageUp') flipDir(-1);
  });
  let touchY = null;
  document.addEventListener('touchstart', ev => { if (ev.target.closest('#panel')) return; touchY = ev.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchend', ev => {
    if (touchY == null) return;
    const dy = ev.changedTouches[0].clientY - touchY;
    if (Math.abs(dy) > 70) flipDir(dy < 0 ? 1 : -1);
    touchY = null;
  }, { passive: true });
}
```

- [ ] **Step 2: 接事件**

```js
// 追加到 app.js boot()：call 顺序：load() 后调用
// 				bindNav();
```
把第 5 步的 `bindNav()` 加进 `boot()`：在 `boot()` 的 try 块里 `load(); refreshPgbar(); bindNav();`。

- [ ] **Step 3: 冒烟**

刷新 http://localhost:8900/book-viewer/ ，按 →、↓、PageDown 或上滑应整页顶边下掀动画翻到下一节一小节；再按 ← 翻回。`prefers-reduced-motion` 时退化淡入。动画中再次按键应被忽略（busy）。

Expected：翻页有 rotateX 卷曲 + 顶部高光扫过 + 桌面阴影；每翻一页 `#pgtext` 页码与 URL fragment 更新。

- [ ] **Step 4: Commit**

```bash
git add book-viewer/app.js
git commit -m "book-viewer: 顶边 rotateX 翻页（flipDir/flipToFlat/busy 保护/触摸键盘导航）"
```

---

### Task 6: `ReaderStore` + 路由与进度

**Files:**
- Modify: `book-viewer/app.js`

**Interfaces:**
- Produces:
  - `loadProgress()`：读 localStorage `bookviewer.readentry` → 若有效则把 `state.current.flat` 设到该 entryId。
  - `saveProgress()`：把当前 entryId 写 localStorage（节流每次翻页）。
  - `updateHash()`（Task 5 已有）更新 URL fragment。
  - 载入时若 `#entry-X` 存在则以其为准并覆盖存储。

- [ ] **Step 1: 加持久化**

```js
// 追加到 app.js
const LS_READ = 'bookviewer.readentry';
export function loadProgress() {
  const id = localStorage.getItem(LS_READ);
  if (!id) return;
  const fi = state.entryIndex.get(id);
  if (fi != null) state.current.flat = fi;
}
export function saveProgress() {
  localStorage.setItem(LS_READ, state.entries[state.current.flat].entryId);
}
```

- [ ] **Step 2: 接入生命周期** — 修改 `boot()`：

```js
// 让 URL fragment 优先于本地存储：hash 有效时跳过 loadProgress（避免被本地覆盖）
export function hasHashIndex() { return /^#entry-/.test(location.hash); }

async function boot() {
  try {
    await load();                // load() 内部已 applyHashIndex（优先 URL）
    if (!hasHashIndex()) loadProgress();
    refreshPgbar(); bindNav();
  } catch (err) {
    document.body.innerHTML = `<div style="padding:40px;color:#fff">加载失败：${escapeHtml(err.message)}。请确认已联网且服务端在 /book-viewer/ 下。</div>`;
  }
}
```
并在 `flipDir` 的 animationend 回调里、`flipToFlat` 里 `updateHash()` 后追加 `saveProgress()`。

- [ ] **Step 3: 冒烟**

刷新后翻两页，再刷新页面，应回到刚翻到的位置；改 URL 到另一有效 `#entry-…` 回车，应从该条所在页续读并覆盖本地存储。

- [ ] **Step 4: Commit**

```bash
git add book-viewer/app.js
git commit -m "book-viewer: 读位置持久化（localStorage + URL fragment 复原）"
```

---

### Task 7: 书签、面板、进度 UI

**Files:**
- Modify: `book-viewer/app.js`

**Interfaces:**
- Consumes: Task 3 的 `#panel`、`.tab`、`#toc/#bookmark/#progress`、`#openPanel/#closePanel`、`#exportBookmarks/#importBookmarks/#importFile`。
- Produces:
  - 书签模型：`BKS`（key `bookviewer.bookmarks`，数组 `[{ entryId, title, at }]`）。
  - `toggleBookmark()`（加/删当前条目）、`renderBookmarks()`、`exportBookmarks()`、`importFile()`。
  - `panelAndToc()`：高亮当前节/条目；渲染目录、进度条。
  - 全局进度 = `flatIndex / totalEntries`；节进度 = `(flatIndex - sec.start) / (sec.end - sec.start)`。

- [ ] **Step 1: 加书签与面板逻辑**

```js
// 追加到 app.js
const BKS_KEY = 'bookviewer.bookmarks';
let bookmarks = JSON.parse(localStorage.getItem(BKS_KEY) || '[]');

export function toggleBookmark() {
  const e = state.entries[state.current.flat];
  const i = bookmarks.findIndex(b => b.entryId === e.entryId);
  if (i >= 0) bookmarks.splice(i, 1); else bookmarks.push({ entryId: e.entryId, title: e.title, at: new Date().toISOString() });
  saveBookmarks();
}

function saveBookmarks() {
  localStorage.setItem(BKS_KEY, JSON.stringify(bookmarks));
  renderBookmarks();
}

export function renderBookmarks() {
  const ul = $('bookmarkList'); if (!ul) return;
  ul.innerHTML = '';
  bookmarks.slice().reverse().forEach(b => {
    const li = document.createElement('li');
    li.textContent = b.title;
    const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = `第 ${b.entryId} 条`;
    li.appendChild(sub);
    li.onclick = () => { const fi = state.entryIndex.get(b.entryId); if (fi != null) { flipToFlat(fi); closePanel(); } };
    ul.appendChild(li);
  });
}

export function exportBookmarks() {
  const blob = new Blob([JSON.stringify(bookmarks, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'bookmarks.json';
  a.click(); URL.revokeObjectURL(a.href);
}

export function importBookmarksFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const arr = JSON.parse(rd.result);
      if (!Array.isArray(arr)) throw 0;
      bookmarks = arr.filter(b => b && typeof b.entryId === 'string');
      saveBookmarks();
    } catch { alert('导入文件格式不对'); }
  };
  rd.readAsText(file);
}

export function panelAndToc() {
  const sec = sectionOf(state.current.flat);
  const t = $('toc'); if (!t) return;
  t.innerHTML = state.corpus.sections.map(s => {
    const cur = s.sectionId === sec.sectionId ? ' toc-current' : '';
    const inner = s.entries.map(e => `<span class="sub">第 ${e.num} 条 ${e.title}</span>`).join('');
    return `<div class="toc-item${cur}" data-sec="${s.sectionId}">${s.title}${cur ? inner : ''}</div>`;
  }).join('');
  t.querySelectorAll('.toc-item').forEach(n => n.onclick = () => {
    const secId = n.dataset.sec;
    if (secId === sec.sectionId) return;
    const targetSection = state.corpus.sections.find(x => x.sectionId === secId);
    flipToFlat(state.entryIndex.get(targetSection.entries[0].entryId));
    closePanel();
  });
  renderProgress(sec);
  renderBookmarks();
}

function renderProgress(sec) {
  const total = state.entries.length;
  const g = state.current.flat / Math.max(1, total - 1);
  $('globalProgress').innerHTML = `<div>全书已读到 ${(g * 100).toFixed(1)}%</div><div class="bar"><div class="fill" style="width:${(g * 100).toFixed(1)}%"></div></div>`;
  const s = sec.entries.length ? (state.current.flat - sec.start) / sec.entries.length : 0;
  $('sectionProgress').innerHTML = `<div>本节已到 ${sec.title}：${(s * 100).toFixed(0)}%</div><div class="bar"><div class="fill" style="width:${(s * 100).toFixed(0)}%"></div></div>`;
}

export function openPanel() { $('panel').hidden = false; panelAndToc(); }
export function closePanel() { $('panel').hidden = true; }
```

- [ ] **Step 2: 绑事件** — 追加到 `bindNav()` 调用之后（在 `boot()` 里）：

```js
$('openPanel').onclick = openPanel;
$('closePanel').onclick = closePanel;
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
  ['toc', 'bookmark', 'progress'].forEach(n => $(n).hidden = n !== b.dataset.tab);
});
$('exportBookmarks').onclick = exportBookmarks;
$('importBookmarks').onclick = () => $('importFile').click();
$('importFile').onchange = () => { importBookmarksFile($('importFile').files[0]); $('importFile').value = ''; };
document.addEventListener('keydown', ev => { if (ev.key === 'b' && !ev.target.closest && true) return; });
$('bookmarkBtn') || null;
```
并在页面右上放一个加书签按钮：在 `index.html` `#bookmarkBtn` 不存在，故沿用面板内引用；把「加当前书签」按钮加入 `#bookmark` 面板顶部：在 Task 3 的 `#bookmark` div 内补 `<button id="addBookmark">加当前条目为书签</button>`。同步在 `app.js` 绑 `$('addBookmark').onclick = toggleBookmark;`。

> 说明：为免分歧，统一以 `#addBookmark` 为加书签入口；`#bookmarkBtn` 一词仅在注释出现，不作为锚点。

- [ ] **Step 3: 冒烟**

点 ☰ 开面板：目录当前节高亮并展开条目；进书签 tab 点「加当前条目为书签」→ 列表出现、可点击跳回；导出下载书签 JSON、导入可恢复；进度 tab 显示全书/本节百分比；手机窄屏下面板占满底、翻页手势仍可用。

- [ ] **Step 4: Commit**

```bash
git add book-viewer/app.js book-viewer/index.html
git commit -m "book-viewer: 书签（localStorage+导出导入）、目录高亮、进度面板"
```

---

### Task 8: CI 与部署接入（GitHub Pages 子路径）

**Files:**
- Create: `.github/workflows/book-viewer.yml`
- Modify: `book-viewer/index.html`（`<html lang>` 已就位，无额外改动）；仅在 README 顶部导航表格加一行入口链接（手工）。

**Interfaces:**
- Consumes: `tools/book-viewer/build.mjs`（是否过时判断 + 重建）。
- Produces:
  - 监听：`push` to `main`，路径 `book/**`、`docs/*.md`、`tools/book-viewer/**`。
  - Job 1 `sync`: 检出 → Node 22 → `node tools/book-viewer/build.mjs`（重建 corpus.json）→ `git-auto-commit-action` 提交并推回，只提交 corpus.json，作者核签名 `github-actions[bot]`。
  - Job 2 `check`: `node tools/book-viewer/build.mjs --check`，必要时失败（确保入库 corpus 不落后）。
  - 说明：因只提交 `book-viewer/corpus.json`，不触碰 `book/**`，本 workflow 的 push 不会触发自身递归（listen paths 不含 book-viewer/**，若含会递归，故 listen 只列 book/docs/tools 源文件）。

- [ ] **Step 1: 写 workflow**

```yaml
# .github/workflows/book-viewer.yml
name: 书页阅读器数据
on:
  push:
    branches: [main]
    paths:
      - 'book/**'
      - 'docs/*.md'
      - 'tools/book-viewer/**'
      - 'README.md'
  pull_request:
    branches: [main]
    paths:
      - 'book/**'
      - 'docs/*.md'
      - 'tools/book-viewer/**'
      - 'README.md'
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: node tools/book-viewer/build.mjs --check

  sync:
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: node tools/book-viewer/build.mjs
      - name: 提交并推回 corpus.json
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          file_pattern: book-viewer/corpus.json
          commit_message: 'chore: 重建 book-viewer/corpus.json'
```

- [ ] **Step 2: README 入口**

在 `README.md` 顶部导航表格「长文」一行之后新增一行（手工，与 `book/` 子路径一致，用相对链接）：

```markdown
| 书页版 | [书页式阅读器（顶边翻页）](book-viewer/) |
```

- [ ] **Step 3: 本地验证 workflow 语义**（不真部署）：

```bash
node tools/book-viewer/build.mjs --check   # 应「corpus.json 是最新的」，退出 0
git add .github/workflows/book-viewer.yml README.md
git commit -m "book-viewer: CI 自动重建 corpus + README 入口"
```
部署到仓库后，GitHub Pages 来源保持「Deploy from a branch, main, /」，`https://<user>.github.io/HowToLiveBetter/book-viewer/` 自动伺服。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/book-viewer.yml README.md
git commit -m "book-viewer: CI 自动重建 corpus + README 入口，Pages 子路径部署"
```
（若与 Task 混在一起，Step 3 的 commit 已含，可跳过本步重复 commit。）

---

## Self-Review

**1. Spec coverage:**
- §一/目标 → Task 3/4 载入、Task 5 翻页、Task 2 数据。
- §二① 生成器 `tools/book-viewer/build.mjs` + `--check` → Task 2。
- §二② 客户端模块 → Task 3(壳/样式) + Task 4(load/pagination/render) + Task 5(FlipEngine) + Task 6(Store/Router) + Task 7(Panel)。
- §三 自动分页（标尺测量/条目不跨页/换屏重排/缓存）→ Task 1(`packEntries`) + Task 4(`measureEntries`/`buildPages`)。— 需检查「同屏宽缓存」与「换屏从当前条目重排」是否有任务覆盖。见下缺口。
- §四 顶边 3D（front/turning/back、rotateX、渐变遮罩、背面翘起、桌面阴影、reduced-motion）→ Task 5 + Task 3 CSS。
- §五 书签/目录/面板/进度 → Task 7。
- §六 平台适配/性能/可靠 → Task 3 CSS 响应式、Task 4 fetch 失败兜底、Task 2 `--check`。
- §七 测试 → Task 1(`packEntries`)、Task 2(build 不变量)。
- §八 部署 → Task 8。

**缺口与修正：**
- 换屏重排：spec §三 要求「换屏时从当前条重新分页」。当前计划只有首次 `buildPages()`。补一步：监听 `resize`（节流）→ 重新 `measureEntries()+buildPages()+flipToFlat(state.current.flat)`。加入 Task 4 Step 增补。
- 同屏宽缓存：`measureEntries()` 每次全量重测。为控范围，初始版不加缓存（670 条约一百毫秒可接受），属 YAGNI；在 Task 4 备注说明。
- `#bookmarkBtn` 歧义：已在 Task 7 统一为 `#addBookmark`。修正上述步骤以避免引用未定义元素（Task 7 Step 2 已给说明）。

**2. Placeholder scan:** 无 TBD/TODO；每个代码步骤都有完整代码与期望输出。`renderFragment`/`renderBookCover` 为空函数体但被标注「预留，本版不展开」，非占位——明确在注释中声明不展开范围。

**3. Type consistency:** `renderPageHTML`（Task 4 定义）在 Task 5/6 使用签名一致；`flipToFlat(flatIndex)` 在 Task 5 定义、Task 7 调用一致；`packEntries` 返回 `{pageId,topEntry,entries}`，Task 4 读取 `.entries/.topEntry` 一致；`sectionOf(flat)` 定义于 Task 4、Task 7 复用一致；`saveProgress/loadProgress` 定义于 Task 6、调用于 Task 6 自身一致。`pageIdOfCurrent` 在 Task 4 定义、Task 5 使用一致。

**补：换屏重排步骤**（纳入 Task 4 Step 3 之后）：

- [ ] **Step 3b: 换屏重排**

```js
// 追加到 app.js
let rzTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(rzTimer);
  rzTimer = setTimeout(() => {
    buildPages();
    flipToFlat(state.current.flat);
  }, 300);
});
```
冒烟：浏览器窗口拉宽/拉窄，应重新分页并仍在当前读的条目处。