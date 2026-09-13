const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app} = require('./harness.cjs');
const KEY = 'nominators-ledger-v1';

/* A stub store whose reads can be made to fail, so the difference between
   "empty" and "unreachable" is testable. */
function cloud(opts) {
  const o = opts || {};
  const docs = new Map(Object.entries(o.docs || {}));
  const shows = o.shows || [];
  const state = {readsFail: !!o.readsFail, writes: [], deletes: []};
  const snap = v => ({exists: v !== undefined, data: () => v});
  const api = {
    doc: path => ({
      get: () => state.readsFail ? Promise.reject({code: 'unavailable'}) : Promise.resolve(snap(docs.get(path))),
      set: body => { state.writes.push(path); docs.set(path, body); return Promise.resolve(); },
      delete: () => { state.deletes.push(path); docs.delete(path); return Promise.resolve(); },
    }),
    collection: () => ({
      get: () => state.readsFail ? Promise.reject({code: 'unavailable'})
        : Promise.resolve({docs: shows.map(s => ({id: s.id, data: () => s}))}),
      onSnapshot: (next) => { state.onShows = next; return () => {}; },
    }),
  };
  // doc() also needs onSnapshot for the ballot/meta listeners
  const rawDoc = api.doc;
  api.doc = path => Object.assign(rawDoc(path), {
    onSnapshot: next => { state['on' + path] = next; return () => {}; },
  });
  return {api, state, docs};
}

test('a failed read never seeds a fresh roster over the saved season', async () => {
  const c = cloud({readsFail: true});
  const a = app();
  a.ctx.__db = c.api;
  a.run('db = __db');
  await a.run('initDb()');

  assert.equal(a.run('cloudDown'), true, 'the app knows the store was unreachable');
  assert.equal(c.state.writes.length, 0, 'NOTHING was written');
  assert.equal(c.state.deletes.length, 0, 'and nothing deleted');
  assert.equal(a.run('shows.length'), 0, 'no sample roster was installed');
});

test('a genuinely empty store does seed, because the reads succeeded', async () => {
  const c = cloud({});
  const a = app();
  a.ctx.__db = c.api;
  a.run('db = __db');
  await a.run('initDb()');
  assert.equal(a.run('cloudDown'), false);
  assert.ok(a.run('shows.length') > 0, 'the roster seeded');
  assert.ok(c.state.writes.length > 0, 'and was written');
});

test('while the store is unreachable every write is refused', async () => {
  const c = cloud({readsFail: true});
  const a = app();
  a.ctx.__db = c.api;
  a.run('db = __db');
  await a.run('initDb()');
  a.run('shows = [newShow({id:"s1"})]; queueSave("show","s1"); flushSave("show","s1")');
  assert.equal(c.state.writes.length, 0, 'refused rather than overwriting newer work');
  assert.equal(a.run('saveState.failed'), true);
  assert.match(a.el('#storageWarning').innerHTML, /could not be reached/);
});

test('an unreachable store still shows the browser mirror', async () => {
  const mirror = JSON.stringify({shows: [{id: 'm1', title: 'Evita', type: 'revival-musical'}], meta: {}, ballot: {picks: {}}});
  const c = cloud({readsFail: true});
  const a = app({storage: {[KEY]: mirror}});
  a.ctx.__db = c.api;
  a.run('db = __db');
  await a.run('initDb()');
  assert.equal(a.run('shows[0].title'), 'Evita', 'the season is still readable');
  assert.equal(a.run('cloudDown'), true);
});

test('an inbound snapshot does not roll back an edit still waiting to save', async () => {
  const c = cloud({shows: [{id: 's1', title: 'Galileo', type: 'new-musical', memory: ''}]});
  const a = app();
  a.ctx.__db = c.api;
  a.run('db = __db');
  await a.run('initDb()');
  a.run('render = () => {}');

  a.run('getShow("s1").memory = "the furnace light"; queueSave("show","s1")');
  assert.equal(a.run('dirty.has("show:s1")'), true, 'the edit is pending');

  // the server echoes an older version while the write is still in flight
  c.state.onShows({docs: [{id: 's1', data: () => ({title: 'Galileo', type: 'new-musical', memory: ''})}]});
  assert.equal(a.run('getShow("s1").memory'), 'the furnace light', 'the pending edit survived');

  a.run('dirty.delete("show:s1")');
  c.state.onShows({docs: [{id: 's1', data: () => ({title: 'Galileo', type: 'new-musical', memory: 'from the server'})}]});
  assert.equal(a.run('getShow("s1").memory'), 'from the server', 'once saved, the server wins again');
});

/* ---- restore validation ---- */

test('a damaged backup is rejected whole, naming every fault', () => {
  const a = app();
  const bad = a.run(`JSON.stringify(validateLedger({shows:[
    {id:"a", title:"Real", type:"new-play"},
    "not a record",
    {id:"a", title:"Duplicate id", type:"new-play"},
    {id:"c", title:"Bad type", type:"opera"},
    {id:"d", title:"Bad cast", type:"new-play", performances:"nope"}]}))`);
  const r = JSON.parse(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /not a record/.test(e)));
  assert.ok(r.errors.some(e => /repeats an identifier/.test(e)));
  assert.ok(r.errors.some(e => /unknown category/.test(e)));
  assert.ok(r.errors.some(e => /damaged cast list/.test(e)));
});

test('a sound backup validates, and reports how many productions it holds', () => {
  const a = app();
  const r = JSON.parse(a.run(`JSON.stringify(validateLedger({shows:[
    {id:"a", title:"Ironwork", type:"new-musical", performances:[{name:"Imani Frost"}]}], meta:{}, ballot:{picks:{}}}))`));
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
});

test('a partial restore reports failure rather than success', async () => {
  const a = app({realTimers: true});
  a.run(`db = {doc:(p) => ({
      set:() => p.indexOf("shows/") === 0 ? Promise.reject({code:"unavailable"}) : Promise.resolve(),
      delete:() => Promise.resolve()})};
    shows = [];`);
  const result = await a.run('replaceAll({shows:[{id:"x",title:"T",type:"new-play"}], meta:{}, ballot:{picks:{}}})');
  assert.equal(result.ok, false, 'not reported as success');
  assert.ok(result.failed >= 1, 'the failures are counted');
  assert.ok(result.snapshot, 'and the way back was recorded');
});

/* ---- roster updates preserve work ---- */

test('a roster update is proposed, not applied, once work has started', () => {
  const a = app();
  a.run(`shows = [newShow({id:"s1", rosterId:"Paranormal Activity", title:"Paranormal Activity",
      type:"new-play", theatre:"WRONG", seen:"2026-09-20", status:"consider", memory:"mine"})];
    meta.sample = true; meta.rosterVersion = 0;
    rosterUpdate = buildRosterUpdate();`);
  assert.ok(a.run('rosterUpdate.added.length') > 0, 'the productions not in the ledger are offered');
  assert.ok(a.run('rosterUpdate.changed.length') > 0, 'and the changed detail is offered');
  assert.equal(a.run('shows.length'), 1, 'but nothing has been applied yet');
  assert.equal(a.run('shows[0].theatre'), 'WRONG', 'and nothing changed');
});

test('applying a roster update keeps every verdict, note and date seen', () => {
  const a = app();
  a.run(`shows = [newShow({id:"s1", rosterId:"Paranormal Activity", title:"Paranormal Activity",
      type:"new-play", theatre:"WRONG", seen:"2026-09-20", status:"consider", memory:"the letter",
      crafts:{direction:{credit:"", score:8, note:"held the room", status:"consider"}}})];
    meta.sample = true; meta.rosterVersion = 0;
    rosterUpdate = buildRosterUpdate();
    for (const g of rosterUpdate.changed) for (const f of g.fields) rosterUpdate.accept.add("set:"+g.id+":"+f.key);
    applyRosterUpdate();`);
  assert.equal(a.run('shows[0].theatre'), 'August Wilson Theatre', 'the fact of record moved');
  assert.equal(a.run('shows[0].seen'), '2026-09-20', 'the date seen is untouched');
  assert.equal(a.run('shows[0].status'), 'consider', 'the verdict is untouched');
  assert.equal(a.run('shows[0].memory'), 'the letter', 'the note is untouched');
  assert.equal(a.run('shows[0].crafts.direction.score'), 8, 'the score is untouched');
  assert.equal(a.run('shows[0].crafts.direction.note'), 'held the room');
  assert.equal(a.run('meta.rosterVersion'), a.run('ROSTER_VERSION'), 'and the roster is marked current');
});

test('a production you added yourself is never touched by a roster update', () => {
  const a = app();
  a.run(`shows = [newShow({id:"mine", title:"A fringe transfer", type:"new-play", theatre:"Mine"})];
    meta.sample = true; meta.rosterVersion = 0;
    rosterUpdate = buildRosterUpdate();
    for (const g of rosterUpdate.changed) for (const f of g.fields) rosterUpdate.accept.add("set:"+g.id+":"+f.key);
    applyRosterUpdate();`);
  assert.equal(a.run('getShow("mine").theatre'), 'Mine');
  assert.equal(a.run('getShow("mine").title'), 'A fringe transfer');
});

/* ---- manual ranking ---- */

test('manual order overrides score order and survives in exports', () => {
  const a = app();
  a.run(`ballot = {picks:{}, order:{}};
    const list = [{key:"a", who:"A", score:9, status:"consider"},
                  {key:"b", who:"B", score:5, status:"consider"},
                  {key:"c", who:"C", score:7, status:"consider"}];
    globalThis.__list = list;
    setOrder("play", ["b","c","a"]);`);
  const ordered = a.run('applyOrder("play", __list).map(c => c.key).join("")');
  assert.equal(ordered, 'bca', 'the nominator order wins');
  a.run('moveInOrder("play","b",1,["a","b","c"])');
  assert.equal(a.run('orderOf("play").join("")'), 'cba', 'and can be nudged');
});
