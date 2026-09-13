const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app} = require('./harness.cjs');

const KEY = 'nominators-ledger-v1';
const ledger = (over) => JSON.stringify(Object.assign(
  {shows: [{id: 'a', title: 'Hedda Gabler', type: 'revival-play'}], meta: {sample: false}, ballot: {picks: {}}}, over));

/* ---- 1. an unreadable ledger is never overwritten ---- */

for (const [label, bad] of [
  ['truncated json', '{"shows":[{"id":"a"'],
  ['not an object', '"just a string"'],
  ['an array', '[1,2,3]'],
  ['no shows key', '{"meta":{}}'],
]) {
  test(`unreadable storage enters recovery and preserves the bytes: ${label}`, () => {
    const a = app({storage: {[KEY]: bad}});
    a.run('initLocal()');
    assert.equal(a.run('!!recovery'), true, 'should enter recovery');
    assert.equal(a.run('shows.length'), 0, 'must not seed over unreadable data');
    assert.equal(a.raw(KEY), bad, 'the original bytes must be untouched');
    const salvaged = a.keys().filter(k => k.startsWith(KEY + '-unreadable-'));
    assert.equal(salvaged.length, 1, 'a salvage copy is kept');
    assert.equal(a.raw(salvaged[0]), bad);
  });
}

test('a readable ledger loads normally and takes no recovery path', () => {
  const a = app({storage: {[KEY]: ledger()}});
  a.run('initLocal()');
  assert.equal(a.run('!!recovery'), false);
  assert.equal(a.run('shows[0].title'), 'Hedda Gabler');
});

test('an empty season is readable, not corrupt', () => {
  const a = app({storage: {[KEY]: JSON.stringify({shows: [], meta: {}, ballot: {picks: {}}})}});
  a.run('initLocal()');
  assert.equal(a.run('!!recovery'), false);
  assert.equal(a.run('shows.length'), 0);
});

/* ---- 2. rolling snapshots ---- */

const snapsIn = a => a.keys().filter(k => k.startsWith(KEY + '-snapshot-')).length;

test('booting takes a daily snapshot, and a second boot does not duplicate it', async () => {
  const a = app({storage: {[KEY]: ledger()}});
  await a.run('initStore()');
  assert.equal(snapsIn(a), 1);
  await a.run('initStore()');
  assert.equal(snapsIn(a), 1);
});

test('a first-ever run is snapshotted too, not just a returning one', async () => {
  const a = app();                       // nothing in storage at all
  await a.run('initStore()');
  assert.ok(a.run('shows.length') > 0, 'the roster seeded');
  assert.equal(snapsIn(a), 1, 'the seeded season has a rollback copy from the first run');
});

test('booting into recovery takes no snapshot of the empty state', async () => {
  const a = app({storage: {[KEY]: '{"shows":[{'}});
  await a.run('initStore()');
  assert.equal(a.run('!!recovery'), true);
  assert.equal(snapsIn(a), 0, 'an empty recovery state must not become a snapshot');
});

test('snapshots are pruned to the five most recent', () => {
  const a = app({storage: {[KEY]: ledger()}});
  a.run('initLocal()');
  for (let i = 0; i < 8; i++) a.run(`takeSnapshot("tag${i}")`);
  assert.ok(a.keys().filter(k => k.startsWith(KEY + '-snapshot-')).length <= 5);
});

test('a bulk replace snapshots what it is about to destroy', async () => {
  const a = app({storage: {[KEY]: ledger()}});
  a.run('initLocal()');
  await a.run('replaceAll({shows:[], meta:{}, ballot:{picks:{}}})');
  const before = a.keys().filter(k => k.includes('before-replace'));
  assert.equal(before.length, 1);
  assert.equal(JSON.parse(a.raw(before[0])).shows[0].title, 'Hedda Gabler');
  assert.equal(a.run('shows.length'), 0, 'the replace still happened');
});

test('a corrupt snapshot is refused rather than loaded', () => {
  const a = app({storage: {[KEY]: ledger(), [KEY + '-snapshot-bad']: 'not json'}});
  a.run('initLocal()');
  assert.equal(a.run('readSnapshot("' + KEY + '-snapshot-bad")'), null);
  assert.equal(a.run('readable(readSnapshot("' + KEY + '-snapshot-bad"))'), false);
});

/* ---- 3. undo carries the ballot picks back with it ---- */

test('removing a performance and undoing restores it and its nomination', () => {
  const a = app({storage: {[KEY]: ledger()}});
  a.run('initLocal()');
  a.run(`shows = [newShow({id:"s1", seen:"2026-10-01", performances:[
      {id:"p1", name:"Vera Lindqvist", billing:"leading", division:"actress", status:"consider"},
      {id:"p2", name:"Andrew Mbatha"}]})];
    ballot.picks = {"lz-p": {"s1:perf:p1": "nom"}};`);

  a.run('undoBuffer = (function(){ const s = getShow("s1"); const at = 0; const gone = s.performances.splice(at,1)[0]; const held = harvestPicks("s1:perf:p1"); return {at, gone, held}; })()');
  assert.equal(a.run('shows[0].performances.length'), 1);
  assert.equal(a.run('JSON.stringify(ballot.picks["lz-p"])'), '{}', 'the pick goes with it');

  a.run('(function(){ const s = getShow("s1"); s.performances.splice(undoBuffer.at, 0, undoBuffer.gone); returnPicks(undoBuffer.held); })()');
  assert.equal(a.run('shows[0].performances.length'), 2);
  assert.equal(a.run('shows[0].performances[0].name'), 'Vera Lindqvist', 'restored in place');
  assert.equal(a.run('shows[0].performances[0].status'), 'consider', 'with its verdict');
  assert.equal(a.run('ballot.picks["lz-p"]["s1:perf:p1"]'), 'nom', 'and its nomination');
});

test('harvesting a production takes every pick under it, across categories', () => {
  const a = app({storage: {[KEY]: ledger()}});
  a.run('initLocal()');
  a.run(`ballot.picks = {"rev-play":{"s1:show":"nom","s2:show":"nom"},
                         "dir-p":{"s1:craft:direction":"nom"},
                         "lz-p":{"s1:perf:p1":"nom"}};
         held = harvestPicks("s1:");`);
  assert.equal(a.run('held.length'), 3);
  assert.equal(a.run('ballot.picks["rev-play"]["s2:show"]'), 'nom', 'other productions untouched');
  a.run('returnPicks(held)');
  assert.equal(a.run('ballot.picks["dir-p"]["s1:craft:direction"]'), 'nom');
});

/* ---- 4. pending writes are flushed when the tab goes away ---- */

test('pagehide flushes a pending database write and mirrors locally', () => {
  const a = app({realTimers: true});
  const writes = [];
  a.run(`db = {doc:(path) => ({set:(body) => { globalThis.__w = globalThis.__w || []; globalThis.__w.push(path); return Promise.resolve(); }})};
         shows = [newShow({id:"s1", title:"Ironwork"})];
         queueSave("show","s1");`);
  assert.equal(a.run('Object.keys(saveTimers).length'), 1, 'a timer is pending');
  assert.equal(a.raw(KEY), null, 'nothing mirrored yet');

  a.fire('pagehide');
  assert.equal(a.run('Object.keys(saveTimers).length'), 0, 'the timer was flushed, not dropped');
  assert.equal(a.run('globalThis.__w.join(",")'), 'shows/s1', 'the write went out');
  assert.equal(a.stored().shows[0].title, 'Ironwork', 'and a browser copy exists');
});

/* ---- 5. a database failure raises the persistent banner, not a toast ---- */

test('a database write failure raises the banner and clears on recovery', async () => {
  const a = app({realTimers: true});
  a.run('db = {doc:() => ({set:() => Promise.reject({code:"unavailable"})})}; shows=[newShow({id:"s1"})];');
  a.run('flushSave("show","s1")');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(a.run('saveState.failed'), true);
  assert.equal(a.el('#storageWarning').hidden, false, 'the banner is up');
  assert.match(a.el('#storageWarning').innerHTML, /Download backup/);
  assert.equal(a.el('#saveState').textContent, 'Not saved');

  a.run('db = {doc:() => ({set:() => Promise.resolve()})}; flushSave("show","s1")');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(a.run('saveState.failed'), false);
  assert.equal(a.el('#storageWarning').hidden, true, 'and comes down once a write lands');
  assert.match(a.el('#saveState').textContent, /^Saved /);
});

/* ---- 6. import validates before it destroys ---- */

test('a file that is not a ledger is refused by the same guard as a corrupt read', () => {
  const a = app({storage: {[KEY]: ledger()}});
  a.run('initLocal()');
  for (const bad of ['null', '"text"', '[]', '({meta:{}})', '({shows:"nope"})']) {
    assert.equal(a.run(`readable(${bad})`), false, `${bad} must be refused`);
  }
  assert.equal(a.run('readable({shows:[]})'), true, 'an empty but valid ledger is fine');
});
