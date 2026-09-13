const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app} = require('./harness.cjs');
const copy = x => JSON.parse(JSON.stringify(x));
const tick = () => new Promise(resolve => setImmediate(resolve));
function cloud() {
  const docs = new Map(), listeners = new Map(), calls = [];
  const state = {failSet:'', corruptRead:'', failDelete:false};
  const snap = p => ({exists:docs.has(p), data:() => copy(docs.get(p))});
  const api = {
    doc:p => ({get:async () => state.corruptRead && p.includes(state.corruptRead) ? {exists:true,data:()=>({bad:true})} : snap(p),
      set:async body => { calls.push(['set',p]); if(state.failSet && p.includes(state.failSet)) throw Error('write failed'); docs.set(p,copy(body)); },
      delete:async () => {calls.push(['delete',p]); if(state.failDelete) throw Error('delete failed'); docs.delete(p);},
      onSnapshot:fn => {listeners.set(p,fn); return ()=>listeners.delete(p);}}),
    collection:p => ({get:async()=>({docs:[...docs].filter(([key])=>key.startsWith(p+'/')).map(([key,value])=>({id:key.slice(p.length+1),data:()=>copy(value)}))}),
      onSnapshot:fn=>{listeners.set(p,fn);return()=>listeners.delete(p);}})
  };
  return {api,docs,listeners,calls,state};
}
function setup(c=cloud()){
 const a=app();a.ctx.store=c.api;a.run('db=store; shows=[newShow({id:"old",title:"Old",memory:"keep me"})]; meta.sample=false; render=()=>{}; paintStrip=()=>{}');
 c.docs.set('season/meta',JSON.parse(a.run('JSON.stringify(meta)')));
 c.docs.set('season/ballot',{picks:{},order:{}});
 c.docs.set('shows/old',JSON.parse(a.run('JSON.stringify(showBody(shows[0]))')));
 return {a,c};
}
const backup={shows:[{id:'new',title:'New',type:'new-play',memory:'restored'}],meta:{sample:false},ballot:{picks:{},order:{}}};

test('older acknowledgement cannot clear protection for a newer edit',async()=>{
 const {a,c}=setup();await a.run('initDb()');
 const pending=[];a.ctx.store={doc:()=>({set:body=>new Promise(resolve=>pending.push({body,resolve}))})};a.run('db=store');
 a.run('shows[0].memory="first"; queueSave("show","old"); flushSave("show","old"); shows[0].memory="second"; queueSave("show","old")');
 pending[0].resolve();await tick();
 assert.equal(a.run('dirty.has("show:old")'),true);
 c.listeners.get('shows')({docs:[{id:'old',data:()=>({title:'Old',memory:'first'})}]});
 assert.equal(a.run('shows[0].memory'),'second');
 a.run('flushSave("show","old")');await tick();assert.equal(pending[1].body.memory,'second');
 pending[1].resolve();await tick();assert.equal(a.run('dirty.has("show:old")'),false);
});

test('overlapping writes are serialized with independent payloads',async()=>{
 const {a}=setup();const pending=[];a.ctx.store={doc:()=>({set:body=>new Promise(resolve=>pending.push({body,resolve}))})};a.run('db=store');
 a.run('shows[0].memory="first"; flushSave("show","old"); shows[0].memory="second"; queueSave("show","old"); flushSave("show","old")');
 assert.equal(pending.length,1);assert.equal(pending[0].body.memory,'first');
 pending[0].resolve();await tick();assert.equal(pending.length,2);assert.equal(pending[1].body.memory,'second');pending[1].resolve();await tick();
});

for(const failure of ['write','verification','pointer']) test(`restore ${failure} failure preserves the original cloud ledger`,async()=>{
 const {a,c}=setup();a.ctx.backup=backup;
 if(failure==='write')c.state.failSet='/shows/new';
 if(failure==='verification')c.state.corruptRead='/shows/new';
 if(failure==='pointer')c.state.failSet='season/active';
 const result=await a.run('replaceAll(backup)');
 assert.equal(result.ok,false);assert.equal(a.run('shows[0].id'),'old');
 assert.equal(c.docs.get('shows/old').memory,'keep me');assert.equal(c.docs.has('season/active'),false);
 assert.equal(c.calls.some(([op])=>op==='delete'),false);
});

test('restore requires a recovery copy before any cloud writes',async()=>{
 const {a,c}=setup();a.fail(true);a.ctx.backup=backup;
 assert.equal((await a.run('replaceAll(backup)')).ok,false);assert.equal(c.calls.length,0);assert.equal(a.run('shows[0].id'),'old');
});

test('successful staged restore survives reload and ignores old callbacks',async()=>{
 const {a,c}=setup();await a.run('initDb()');const oldListener=c.listeners.get('shows');a.ctx.backup=backup;
 assert.equal((await a.run('replaceAll(backup)')).ok,true);
 assert.equal(a.run('shows[0].id'),'new');assert.equal(c.docs.has('shows/old'),true);
 oldListener({docs:[]});assert.equal(a.run('shows[0].id'),'new');
 a.run('shows[0].memory="edited after restore"');await a.run('flushSave("show","new")');
 const b=app();b.ctx.store=c.api;b.run('db=store; render=()=>{}; paintStrip=()=>{}');await b.run('initDb()');
 assert.equal(b.run('shows[0].memory'),'edited after restore');
});

for(const patch of [{meta:{targets:null}},{shows:[{id:'x',crafts:{direction:{credit:123}}}]},{ballot:{order:{play:'bad'}}},{shows:[{id:'x',performances:[{id:'p'},{id:'p'}]}]},{shows:[{title:'missing id'}]},{ballot:{picks:{play:null}}}])test('malformed nested backup is rejected: '+JSON.stringify(patch),async()=>{
 const a=app();a.run('shows=[newShow({id:"old"})];writeLocal()');a.ctx.bad={...backup,...patch};
 assert.equal(a.run('validateLedger(bad).ok'),false);assert.equal((await a.run('replaceAll(bad)')).ok,false);assert.equal(a.stored().shows[0].id,'old');
});

test('cloud-down deletion performs no writes and retains picks',async()=>{
 const {a,c}=setup();a.run('cloudDown=true;ballot.picks={play:{"old:show":"nom"}}');
 assert.equal(await a.run('removeShow("old")'),false);assert.equal(c.calls.length,0);assert.equal(a.run('shows.length'),1);assert.equal(a.run('ballot.picks.play["old:show"]'),'nom');
});

test('failed deletion retains production and selections and surfaces failure',async()=>{
 const {a,c}=setup();c.state.failDelete=true;a.run('ballot.picks={play:{"old:show":"nom"}}');
 assert.equal(await a.run('removeShow("old")'),false);assert.equal(a.run('shows.length'),1);assert.equal(a.run('ballot.picks.play["old:show"]'),'nom');assert.equal(a.run('saveState.failed'),true);
});

test('delete waits for the outstanding save so it cannot recreate the production',async()=>{
 const {a,c}=setup();let release;const original=c.api.doc;c.api.doc=p=>{const doc=original(p);if(p==='shows/old')doc.set=body=>new Promise(resolve=>{release=()=>{c.docs.set(p,copy(body));resolve();}});return doc;};
 a.run('flushSave("show","old")');const deleting=a.run('removeShow("old")');await tick();assert.equal(c.calls.some(([op])=>op==='delete'),false);
 release();assert.equal(await deleting,true);assert.equal(c.docs.has('shows/old'),false);
});

test('another window activating a restore blocks writes from the stale window',async()=>{
 const {a,c}=setup();await a.run('initDb()');
 c.listeners.get('season/active')({exists:true,data:()=>({prefix:'ledgers/another/'})});
 assert.equal(a.run('cloudDown'),true);
 const count=c.calls.length;assert.equal(await a.run('removeShow("old")'),false);assert.equal(c.calls.length,count);
});

test('failed local replacement retains the previous persisted and visible season',async()=>{
 const a=app();a.run('shows=[newShow({id:"old"})];writeLocal()');
 const original=a.ctx.localStorage.setItem;a.ctx.localStorage.setItem=(key,value)=>{if(key==='nominators-ledger-v1')throw Error('quota');original(key,value);};a.ctx.backup=backup;
 assert.equal((await a.run('replaceAll(backup)')).ok,false);assert.equal(a.run('shows[0].id'),'old');assert.equal(a.stored().shows[0].id,'old');
});

test('restore round-trips the current roster and ranked ballot',async()=>{
 const a=app();a.run('seedSeason();ballot.order={play:[shows[0].id+":show"]};globalThis.backup=JSON.parse(JSON.stringify({shows,meta,ballot}))');
 assert.equal(a.run('validateLedger(backup).ok'),true);assert.equal((await a.run('replaceAll(backup)')).ok,true);
 assert.equal(a.run('shows.length'),22);assert.equal(a.run('ballot.order.play.length'),1);
});
