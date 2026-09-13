const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('\ninitStore()')[0];

function app(saved) {
  let stored = saved;
  let fail = false;
  const warning = {hidden:true, innerHTML:''};
  const ctx = vm.createContext({
    console, window:{}, setTimeout:() => 1, clearTimeout:() => {},
    document:{addEventListener() {}, querySelector:() => warning},
    localStorage:{getItem:() => stored, setItem:(key,value) => {
      if (fail) throw new Error('quota');
      stored = value;
    }},
  });
  vm.runInContext(source, ctx);
  return {run:code => vm.runInContext(code, ctx), saved:() => JSON.parse(stored),
    fail:value => {fail=value;}, warning};
}

test('verdict is persisted without waiting for a timer', () => {
  const a = app();
  a.run('shows = [newShow({id:"test"})]; setStatus("test:show", "consider")');
  assert.equal(a.saved().shows[0].status, 'consider');
});

test('failed storage preserves the prior save and offers backup; retry clears warning', () => {
  const a = app();
  a.run('shows = [newShow({id:"test"})]; writeLocal()');
  a.fail(true);
  a.run('setStatus("test:show", "consider")');
  assert.equal(a.saved().shows[0].status, '');
  assert.equal(a.run('shows[0].status'), 'consider');
  assert.equal(a.warning.hidden, false);
  assert.match(a.warning.innerHTML, /Download backup/);
  a.fail(false);
  assert.equal(a.run('writeLocal()'), true);
  assert.equal(a.warning.hidden, true);
  assert.equal(a.saved().shows[0].status, 'consider');
});

for (const field of ['shows[0].status', 'shows[0].crafts.direction.status', 'shows[0].performances[0].status']) {
  test(`roster replacement respects verdict-only work: ${field}`, () => {
    const a = app();
    a.run('meta.sample=true; shows=[newShow({performances:[{id:"p"}]})]');
    assert.equal(a.run('untouched()'), true);
    a.run(`${field}="pass"`);
    assert.equal(a.run('untouched()'), false);
  });
}

test('local data without a version migrates legacy ballot verdicts', () => {
  const a = app(JSON.stringify({shows:[{id:'test',type:'new-play',title:'Test'}],
    meta:{sample:false}, ballot:{picks:{play:{'test:show':'hold'}}}}));
  a.run('initLocal()');
  assert.equal(a.run('shows[0].status'), 'consider');
  assert.equal(a.run('meta.dataVersion === DATA_VERSION'), true);
  assert.equal(a.saved().shows[0].status, 'consider');
});
