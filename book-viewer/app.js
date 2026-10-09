// book-viewer/app.js
import { packEntries } from './paginate.mjs';

const $ = id => document.getElementById(id);

// 一条的渲染：测量与真实渲染共用同一套 HTML（保持宽度与高度一致）
export function renderEntryHTML(e) {
  const f = e.fields || {};
  const c = e.cost || {};
  const tag = c && c['钱'] ? `<span class="cost-tag">钱${c['钱']}·时间${c['时间']}·毅力${c['毅力']}·收益${c['收益']}·口径${c['口径']}</span>` : '';
  const lbl = k => f[k] ? `<span class="lbl">${k}</span><p>${escapeHtml(f[k])}</p>` : '';
  return `<h3>${e.num}. ${escapeHtml(e.title)}${tag}</h3>
    ${lbl('成本')}${lbl('说人话')}${lbl('收益')}${lbl('证据等级')}${lbl('来源')}${lbl('备注')}`;
}
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export const state = { corpus: null, sections: [], entries: [], entryIndex: null, pages: [], pageOfEntry: null, current: { flat: 0 } };
let busy = false; // 翻页动画进行中，锁住后续翻页调用，避免重入
// 三个页片引用：app.js 是 ES 模块（严格模式），裸标识符不声明会抛 ReferenceError。
const front = $('front'), back = $('back'), turning = $('turning');

function sectionOf(flat) { for (const s of state.sections) if (flat < s.end) return s; return state.sections[0]; }

export async function load() {
  const res = await fetch('corpus.json');
  if (!res.ok) throw new Error(`corpus 加载失败 HTTP ${res.status}`);
  state.corpus = await res.json();
  buildFlat(); applyHashIndex(); buildPages();
  renderPage($('front'), pageIdOfCurrent());
  renderPage($('back'), 0);
}

export function buildFlat() {
  state.sections = state.corpus.sections.map(s => ({ ...s, start: 0, end: 0 }));
  state.entries = state.corpus.sections.flatMap(s => s.entries);
  let acc = 0;
  for (const s of state.sections) { s.start = acc; s.end = acc + s.entries.length; acc = s.end; }
  state.entryIndex = new Map(state.entries.map((e, i) => [e.entryId, i]));
}

// 测量每条净高。标尺宽度 = 页片内容宽（clientWidth - 横padding），否则换行宽度错误。
// 每条净高只取决于内容宽度，宽度不变就复用上次结果，避免每次重排都做几百次 DOM 测量。
let measureW = 0, measureH = null;
export function measureEntries() {
  const ruler = $('ruler');
  const front = $('front');
  const ps = getComputedStyle(front);
  const w = front.clientWidth;
  if (measureH && measureW === w) return measureH;
  ruler.style.width = (w - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight)) + 'px';
  const heights = [];
  for (const e of state.entries) {
    const d = document.createElement('div');
    d.className = 'entry';
    d.innerHTML = renderEntryHTML(e);
    ruler.appendChild(d);
    heights.push(d.offsetHeight);
    d.remove();
  }
  measureW = w; measureH = heights;
  return heights;
}

function pageHeightPx() {
  const sheet = $('front');
  const ps = getComputedStyle(sheet);
  return Math.round(sheet.clientHeight - parseFloat(ps.paddingTop) - parseFloat(ps.paddingBottom));
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

function applyHashIndex() {
  const m = location.hash.match(/^#entry-([0-9]+-[0-9]+)$/);
  if (m) {
    const fi = state.entryIndex.get(m[1]);
    if (fi != null) state.current.flat = fi;
  }
}

export function pageIdOfCurrent() { return state.pageOfEntry.get(state.current.flat) ?? 0; }

function refreshPgbar() {
  const t = $('pgtext'); if (!t) return;
  t.textContent = `${pageIdOfCurrent() + 1} / ${state.pages.length}`;
}

let rzTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(rzTimer);
  rzTimer = setTimeout(() => { reflow(); }, 300);
});

// 换屏重排：重新分页并回到当前读的条目所在页
export function reflow() {
  if (!state.entries.length) return;
  buildPages();
  const pid = pageIdOfCurrent();
  renderPage($('front'), pid);
  $('back').innerHTML = `<div class="paper">${renderPageHTML(Math.min(pid + 1, state.pages.length - 1))}</div>`;
  refreshPgbar();
}

export function flipToPage(pid, { animate = true } = {}) {
  if (busy || pid < 0 || pid >= state.pages.length) return;
  const cur = pageIdOfCurrent();
  if (pid === cur) return;
  busy = true;
  const dir = pid > cur ? 1 : -1;
  const targetFlat = state.pages[pid].topEntry;

  if (!animate) {
    // 面板点击/章节跳转：瞬间切页，不播动画
    renderPage(front, pid);
    state.current.flat = targetFlat;
    updateHash(); refreshPgbar(); saveProgress();
    if (!$('panel').hidden) refreshPanelPosition();
    busy = false;
    return;
  }

  if (dir > 0) {
    // 向前翻（下一页）：back 显示新页、turning 装旧页翻走、front 藏起来。
    // 用 visibility 而不是 z-index 控制：3D transform + preserve-3d 下 z-index 不靠谱，
    // 浏览器按 3D 空间深度排序，翻卷的页面会”退到远处”被底下的新页盖住，
    // 看起来就是”先显示上一页、突然刷成下一页”。
    if (Number(back.dataset.page) !== pid) renderPage(back, pid);
    back.style.visibility = 'visible';
    turning.innerHTML = front.innerHTML;
    turning.className = 'sheet flipping';
    turning.style.transform = '';
    turning.style.visibility = 'visible';
    front.style.visibility = 'hidden';
  } else {
    // 向后翻（上一页）：turning 装新页从左侧卷回来、front 保持旧页在下层、back 藏着。
    turning.innerHTML = `
      <div class=”paper”>${renderPageHTML(pid)}<div class=”curl”></div></div>`;
    turning.className = 'sheet flipping-back';
    turning.style.transform = 'rotateY(-178deg) translateZ(2px)';
    turning.style.visibility = 'visible';
    back.style.visibility = 'hidden';
  }

  function finish() {
    // 翻完把 front 换成新页、显示回来，其余两层复位并藏起来。
    front.innerHTML = dir > 0 ? back.innerHTML : turning.innerHTML;
    front.dataset.page = pid;
    front.style.visibility = 'visible';
    back.style.visibility = 'hidden';
    turning.className = 'sheet';
    turning.style.transform = '';
    turning.style.visibility = 'hidden';
    turning.innerHTML = '';
    state.current.flat = targetFlat;
    updateHash(); refreshPgbar(); saveProgress();
    if (!$('panel').hidden) refreshPanelPosition();
    busy = false;
  }

  turning.addEventListener('animationend', finish, { once: true });
}

export function flipDir(dir) { flipToPage(pageIdOfCurrent() + dir, { animate: true }); }
export function flipToFlat(flatIndex, { animate = true } = {}) {
  const pid = state.pageOfEntry.get(flatIndex);
  if (pid == null) return;
  if (pid === pageIdOfCurrent()) {
    state.current.flat = flatIndex;
    updateHash(); refreshPgbar(); saveProgress();
    if (!$('panel').hidden) refreshPanelPosition();
    return;
  }
  flipToPage(pid, { animate });
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
  // 左右横滑翻页：左滑（dx<0）下一页、右滑（dx>0）上一页。竖滑留给页内滚动。
  let touchX = null;
  document.addEventListener('touchstart', ev => { if (ev.target.closest && ev.target.closest('#panel')) return; touchX = ev.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', ev => {
    if (touchX == null) return;
    const dx = ev.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 70) flipDir(dx < 0 ? 1 : -1);
    touchX = null;
  }, { passive: true });
}

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
      alert('已导入 ' + bookmarks.length + ' 条书签');
    } catch { alert('导入文件格式不对'); }
  };
  rd.readAsText(file);
}

// 轻量刷新：翻页/跳转时只挪当前节高亮与 ▶ 标记、更新进度条，
// 不整棵重建目录和书签，避免每翻一页都重解析 34 节 DOM。
function refreshPanelPosition() {
  if ($('panel').hidden) return;
  const curSecId = sectionOf(state.current.flat).sectionId;
  const t = $('toc'); if (!t) return;
  t.querySelectorAll('.toc-item').forEach(n => {
    const sec = state.sections.find(s => s.sectionId === n.dataset.sec);
    if (!sec) return;
    const isCur = sec.sectionId === curSecId;
    n.classList.toggle('toc-current', isCur);
    const inner = isCur ? sec.entries.map((e, i) =>
      `<span class="sub">${sec.start + i === state.current.flat ? '▶ ' : ''}第 ${e.num} 条 ${e.title}</span>`).join('') : '';
    n.innerHTML = `${sec.title}${inner}`; // onclick 绑在 n 自身，换内层不丢
  });
  const cur = state.sections.find(s => s.sectionId === curSecId);
  renderProgress(cur ?? state.sections[0]);
}

export function panelAndToc() {
  const sec = sectionOf(state.current.flat);
  const t = $('toc'); if (!t) return;
  t.innerHTML = state.corpus.sections.map(s => {
    const cur = s.sectionId === sec.sectionId ? ' toc-current' : '';
    const inner = cur ? s.entries.map((e, i) => `<span class="sub">${s.start + i === state.current.flat ? '▶ ' : ''}第 ${e.num} 条 ${e.title}</span>`).join('') : '';
    return `<div class="toc-item${cur}" data-sec="${s.sectionId}">${s.title}${inner}</div>`;
  }).join('');
  t.querySelectorAll('.toc-item').forEach(n => n.onclick = () => {
    const secId = n.dataset.sec;
    if (secId === sec.sectionId) return;
    const targetSection = state.corpus.sections.find(x => x.sectionId === secId);
    flipToFlat(state.entryIndex.get(targetSection.entries[0].entryId), { animate: false });
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
  $('sectionProgress').innerHTML = `<div>本节 ${sec.title}：${(s * 100).toFixed(0)}%</div><div class="bar"><div class="fill" style="width:${(s * 100).toFixed(0)}%"></div></div>`;
}

export function openPanel() { $('panel').hidden = false; panelAndToc(); }
export function closePanel() { $('panel').hidden = true; }

function bindPanel() {
  $('openPanel').onclick = openPanel;
  $('closePanel').onclick = closePanel;
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
    ['toc', 'bookmark', 'progress'].forEach(n => $(n).hidden = n !== b.dataset.tab);
  });
  $('addBookmark').onclick = toggleBookmark;
  $('exportBookmarks').onclick = exportBookmarks;
  $('importBookmarks').onclick = () => $('importFile').click();
  $('importFile').onchange = () => { importBookmarksFile($('importFile').files[0]); $('importFile').value = ''; };
}

const LS_READ = 'bookviewer.readentry';
export function hasHashIndex() { return /^#entry-/.test(location.hash); }
export function loadProgress() {
  const id = localStorage.getItem(LS_READ);
  if (!id) return;
  const fi = state.entryIndex.get(id);
  if (fi != null) state.current.flat = fi;
}
export function saveProgress() {
  localStorage.setItem(LS_READ, state.entries[state.current.flat].entryId);
}

async function boot() {
  try {
    await load();
    if (!hasHashIndex()) loadProgress();
    refreshPgbar();
    bindNav();
    bindPanel();
    panelAndToc();
  } catch (err) {
    document.body.innerHTML = `<div style="padding:40px;color:#fff">加载失败：${escapeHtml(err.message)}。请确认已联网且服务端在 /book-viewer/ 下。</div>`;
  }
}
boot();