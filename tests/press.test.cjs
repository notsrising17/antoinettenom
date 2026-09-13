const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app} = require('./harness.cjs');

/* A release in the shape press agents actually send them. */
const RELEASE = `FOR IMMEDIATE RELEASE

A FEW GOOD MEN will begin performances October 8, 2026 at the Vivian Beaumont
Theater, with an official opening night on Thursday, October 29, 2026.

Aaron Sorkin's courtroom drama returns to Broadway in its first revival,
directed by six-time Tony Award winner Michael Arden. The production stars
Emmy Award winner Bradley Whitford and Tom Blyth, with Krysta Rodriguez as
Lt. Commander JoAnne Galloway and Stephanie Berry as Judge Randolph.

The creative team features scenic design by Dane Laffrey, costume design by
Linda Cho, lighting design by Jen Schriever and sound design by Nevin Steinberg.`;

function draft(a, text) { a.run('globalThis.__d = parsePressRelease(' + JSON.stringify(text) + ')'); }

test('reads the classification, theatre and OPENING night (not the first preview)', () => {
  const a = app();
  draft(a, RELEASE);
  assert.equal(a.run('__d.type'), 'revival-play');
  assert.equal(a.run('__d.theatre'), 'Vivian Beaumont Theater');
  assert.equal(a.run('__d.opened'), '2026-10-29', 'opening night, not the 8 October preview');
});

test('strips awards and honorifics from credited names', () => {
  const a = app();
  draft(a, RELEASE);
  assert.equal(a.run('__d.crafts.direction'), 'Michael Arden', 'not "six-time Tony Award winner Michael Arden"');
});

test('reads every designer, each to the right department', () => {
  const a = app();
  draft(a, RELEASE);
  assert.equal(a.run('__d.crafts.scenic'), 'Dane Laffrey');
  assert.equal(a.run('__d.crafts.costume'), 'Linda Cho');
  assert.equal(a.run('__d.crafts.lighting'), 'Jen Schriever');
  assert.equal(a.run('__d.crafts.sound'), 'Nevin Steinberg');
});

test('reads cast, keeping roles where the release gives them', () => {
  const a = app();
  draft(a, RELEASE);
  const names = JSON.parse(a.run('JSON.stringify(__d.cast.map(c => c.name))'));
  assert.ok(names.includes('Krysta Rodriguez'), names.join(', '));
  assert.ok(names.includes('Stephanie Berry'));
  assert.equal(a.run('__d.cast.find(c => c.name === "Krysta Rodriguez").role'), 'Lt. Commander JoAnne Galloway');
});

test('a musical release is classified and its writing credits separated', () => {
  const a = app();
  draft(a, `GALILEO, a new musical, opens December 6, 2026 at the Shubert Theatre.
    Book by Danny Strong, with music and lyrics by Zoe Sarnak and Michael Weiner.
    Directed by Michael Mayer and choreographed by David Neumann.`);
  assert.equal(a.run('__d.type'), 'new-musical');
  assert.equal(a.run('__d.crafts.book'), 'Danny Strong');
  assert.equal(a.run('__d.crafts.score'), 'Zoe Sarnak and Michael Weiner');
  assert.equal(a.run('__d.crafts.direction'), 'Michael Mayer');
  assert.equal(a.run('__d.crafts.choreography'), 'David Neumann');
});

test('a year-less date is placed in the right half of the season', () => {
  const a = app();
  a.run('meta.label = "2026\\u201327 Broadway season"');
  draft(a, 'The play opens on March 25 at the Winter Garden Theatre.');
  assert.equal(a.run('__d.opened'), '2027-03-25', 'March belongs to the second calendar year');
  draft(a, 'The play opens on October 18 at the Hudson Theatre.');
  assert.equal(a.run('__d.opened'), '2026-10-18', 'October belongs to the first');
});

test('empty or junk text yields an empty draft rather than throwing', () => {
  const a = app();
  draft(a, '');
  assert.equal(a.run('__d.title'), '');
  draft(a, '!!! ??? ...');
  assert.equal(a.run('typeof __d.crafts'), 'object');
});

/* ---- applying a draft ---- */

test('applying a release adds the production without setting any judgment', () => {
  const a = app();
  a.run(`shows = []; meta.eligibleTotal = 0;
    intake = {stage:"check", draft:parsePressRelease(${JSON.stringify(RELEASE)}), matchId:"", overwrite:new Set()};
    globalThis.__r = applyIntake();`);
  assert.equal(a.run('__r.created'), true);
  assert.equal(a.run('shows.length'), 1);
  assert.equal(a.run('shows[0].theatre'), 'Vivian Beaumont Theater');
  assert.equal(a.run('shows[0].crafts.direction.credit'), 'Michael Arden');
  assert.equal(a.run('shows[0].status'), '', 'no verdict');
  assert.equal(a.run('shows[0].overall'), 0, 'no score');
  assert.equal(a.run('shows[0].seen'), '', 'not marked as seen');
  assert.equal(a.run('shows[0].performances.every(p => p.billing === "unset" && p.division === "unset")'), true,
    'billing and category are left for the nominator to judge');
});

test('a release for a production already in the ledger fills blanks and never overwrites your work', () => {
  const a = app();
  a.run(`shows = [newShow({id:"s1", title:"A Few Good Men", type:"revival-play",
      theatre:"MY OWN NOTE", seen:"2026-11-01", status:"consider", memory:"the cross-examination",
      crafts:{direction:{credit:"Someone Else", score:9, note:"mine", status:"consider"}}})];
    intake = {stage:"check", draft:parsePressRelease(${JSON.stringify(RELEASE)}), matchId:"s1", overwrite:new Set()};
    globalThis.__r = applyIntake();`);
  assert.equal(a.run('__r.created'), false, 'matched, not duplicated');
  assert.equal(a.run('shows.length'), 1, 'no duplicate row');
  assert.equal(a.run('shows[0].theatre'), 'MY OWN NOTE', 'a filled field is left alone');
  assert.equal(a.run('shows[0].crafts.direction.credit'), 'Someone Else', 'and so is a credit you set');
  assert.equal(a.run('shows[0].seen'), '2026-11-01');
  assert.equal(a.run('shows[0].status'), 'consider');
  assert.equal(a.run('shows[0].memory'), 'the cross-examination');
  assert.equal(a.run('shows[0].crafts.direction.score'), 9);
  assert.equal(a.run('shows[0].crafts.scenic.credit'), 'Dane Laffrey', 'but a blank one is filled');
});

test('a conflict is only overwritten when explicitly ticked', () => {
  const a = app();
  a.run(`shows = [newShow({id:"s1", title:"A Few Good Men", type:"revival-play", theatre:"Old Theatre"})];
    intake = {stage:"check", draft:parsePressRelease(${JSON.stringify(RELEASE)}), matchId:"s1",
      overwrite:new Set(["theatre"])};
    applyIntake();`);
  assert.equal(a.run('shows[0].theatre'), 'Vivian Beaumont Theater');
});

test('cast already recorded is not duplicated', () => {
  const a = app();
  a.run(`shows = [newShow({id:"s1", title:"A Few Good Men", type:"revival-play",
      performances:[{id:"p1", name:"Krysta Rodriguez", billing:"leading", division:"actress"}]})];
    intake = {stage:"check", draft:parsePressRelease(${JSON.stringify(RELEASE)}), matchId:"s1", overwrite:new Set()};
    applyIntake();`);
  assert.equal(a.run('shows[0].performances.filter(p => p.name === "Krysta Rodriguez").length'), 1);
  assert.equal(a.run('shows[0].performances.find(p => p.name === "Krysta Rodriguez").billing'), 'leading',
    'the placement you already made survives');
});

test('the title survives press-release boilerplate on its own line', () => {
  const a = app();
  draft(a, RELEASE);
  assert.equal(a.run('__d.title'), 'A Few Good Men', 'not "For Immediate Release a Few Good Men"');
});

test('a quoted title is preferred, and a plain headline still works', () => {
  const a = app();
  draft(a, 'FOR IMMEDIATE RELEASE\n\nProducers announced today that "Inter Alia" will open December 1 at the Music Box Theatre.');
  assert.equal(a.run('__d.title'), 'Inter Alia');
  draft(a, 'MUCH ADO ABOUT NOTHING\n\nThe production opens November 19 at the Winter Garden Theatre.');
  assert.equal(a.run('__d.title'), 'Much Ado About Nothing');
});

test('a shouted title is set in title case, including a single word', () => {
  const a = app();
  draft(a, 'FOR IMMEDIATE RELEASE\n\nGLORIA will begin previews March 17 at the Hayes Theater.');
  assert.equal(a.run('__d.title'), 'Gloria');
  draft(a, 'WANTED will open November 8 at the James Earl Jones Theatre.');
  assert.equal(a.run('__d.title'), 'Wanted');
});
