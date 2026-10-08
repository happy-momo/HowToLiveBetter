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