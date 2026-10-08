import assert from 'node:assert/strict';
import { packEntries } from '../../../book-viewer/paginate.mjs';

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