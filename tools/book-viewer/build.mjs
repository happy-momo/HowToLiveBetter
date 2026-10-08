// tools/book-viewer/build.mjs
import { read, readBook, stripBackLink, buildStamp, gitCommit } from '../lib/book.mjs';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
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
  const docs = docFiles.filter(p => (p.match(/\//g) || []).length === 1).map(p => {
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