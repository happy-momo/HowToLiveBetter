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
export function measureEntries() {
  const ruler = $('ruler');
  const front = $('front');
  const ps = getComputedStyle(front);
  ruler.style.width = (front.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight)) + 'px';
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

export function flipToPage(pid) {
  if (busy || pid < 0 || pid >= state.pages.length) return;
  const cur = pageIdOfCurrent();
  if (pid === cur) return;
  busy = true;
  const dir = pid > cur ? 1 : -1;
  const targetFlat = state.pages[pid].topEntry;

  if (dir > 0) {
    // 向后翻：当前页作为 turning 掀开，露出 back（已预渲染为 pid）
    if (Number($('back').dataset.page) !== pid) renderPage($('back'), pid);
    turning.innerHTML = front.innerHTML;
    turning.className = 'sheet flipping';
    turning.style.transform = '';
  } else {
    // 向前翻：把目标页放到 turning，从上方翻下覆盖当前页
    turning.innerHTML = `
      <div class="paper">${renderPageHTML(pid)}<div class="curl"></div></div>`;
    turning.className = 'sheet flipping-back';
    turning.style.transform = 'rotateX(-178deg) translateZ(2px)';
  }

  function finish() {
    front.innerHTML = turning.innerHTML;
    front.dataset.page = pid;
    turning.className = 'sheet';
    turning.style.transform = '';
    turning.innerHTML = '';
    state.current.flat = targetFlat;
    updateHash(); refreshPgbar(); saveProgress(); panelAndToc();
    busy = false;
  }

  turning.addEventListener('animationend', finish, { once: true });
}

export function flipDir(dir) { flipToPage(pageIdOfCurrent() + dir); }
export function flipToFlat(flatIndex) {
  const pid = state.pageOfEntry.get(flatIndex);
  if (pid == null) return;
  if (pid === pageIdOfCurrent()) { state.current.flat = flatIndex; updateHash(); saveProgress(); panelAndToc(); return; }
  flipToPage(pid);
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
  document.addEventListener('touchstart', ev => { if (ev.target.closest && ev.target.closest('#panel')) return; touchY = ev.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchend', ev => {
    if (touchY == null) return;
    const dy = ev.changedTouches[0].clientY - touchY;
    if (Math.abs(dy) > 70) flipDir(dy < 0 ? 1 : -1);
    touchY = null;
  }, { passive: true });
}

// panelAndToc 在 Task 7 实现
function panelAndToc() { /* Task 7 */ }

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
  } catch (err) {
    document.body.innerHTML = `<div style="padding:40px;color:#fff">加载失败：${escapeHtml(err.message)}。请确认已联网且服务端在 /book-viewer/ 下。</div>`;
  }
}
boot();