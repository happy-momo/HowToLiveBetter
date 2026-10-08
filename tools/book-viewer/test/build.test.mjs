import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSectionFile, buildCorpus, structuralString } from '../build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
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
assert.equal(corpus.meta.entryIdsUnique, true, 'entryId 全局唯一');
assert.ok(structuralString(corpus).includes('"entryId":"1-1"'), '结构串含稳定身份');
assert.ok(Array.isArray(corpus.sections) && corpus.sections.length === 34, '34 节不变量');
const again = buildCorpus().structural;
assert.equal(structural, again, '生成确定性：两次结构一致');
console.log('build 测试全部通过');