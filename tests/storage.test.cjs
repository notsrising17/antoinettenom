const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app: makeApp} = require('./harness.cjs');

/* Same cases as before; the DOM stub now lives in the shared harness and
   returns a distinct element per selector. */
function app(saved) {
  const a = makeApp({storage: saved ? {'nominators-ledger-v1': saved} : {}});
  return {run: a.run, saved: a.stored, fail: a.fail, warning: a.el('#storageWarning')};
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
