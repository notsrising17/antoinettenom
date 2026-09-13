const {test} = require('node:test');
const assert = require('node:assert/strict');
const {app} = require('./harness.cjs');

const today = () => new Date().toISOString().slice(0, 10);
const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

test('the diary holds what is booked and not yet seen, soonest first', () => {
  const a = app();
  a.run(`shows = [
    newShow({id:"far",  title:"Far",  booked:"${shift(20)}"}),
    newShow({id:"soon", title:"Soon", booked:"${shift(2)}"}),
    newShow({id:"done", title:"Done", booked:"${shift(3)}", seen:"${shift(3)}"}),
    newShow({id:"none", title:"None"})];`);
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(diary().map(s => s.title))')), ['Soon', 'Far'],
    'seen and unbooked productions stay out');
});

test('a booking whose date has passed without being logged is overdue, not forgotten', () => {
  const a = app();
  a.run(`shows = [
    newShow({id:"late", title:"Late", booked:"${shift(-3)}"}),
    newShow({id:"ok",   title:"Ok",   booked:"${shift(-1)}", seen:"${shift(-1)}"}),
    newShow({id:"soon", title:"Soon", booked:"${shift(4)}"})];`);
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(overdue().map(s => s.title))')), ['Late']);
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(diary().map(s => s.title))')), ['Soon'],
    'an overdue booking is not still in the diary');
});

test('a booking today reads as tonight, tomorrow as tomorrow', () => {
  const a = app();
  a.run(`shows = [newShow({id:"t", booked:"${today()}", bookedTime:"19:30"})]`);
  assert.match(a.run('whenBooked(shows[0])'), /^Tonight, 7:30\s?PM$/i,
    'a 24-hour input value reads back as a 12-hour clock time, not raw "19:30"');
  a.run(`shows = [newShow({id:"t", booked:"${shift(1)}"})]`);
  assert.equal(a.run('whenBooked(shows[0])'), 'Tomorrow');
});

test('the calendar file carries the curtain, a three hour run, and the theatre', () => {
  const a = app();
  a.run(`shows = [newShow({id:"e", title:"Evita", theatre:"Winter Garden Theatre",
    type:"revival-musical", author:"Lloyd Webber and Rice", booked:"2027-03-25", bookedTime:"19:00"})];
    globalThis.__ics = icsFor(shows[0]);`);
  const ics = a.run('__ics');
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20270325T190000/, 'floating local time, no timezone');
  assert.match(ics, /DTEND:20270325T220000/, 'three hours later');
  assert.match(ics, /SUMMARY:Evita/);
  assert.match(ics, /LOCATION:Winter Garden Theatre/);
  assert.match(ics, /END:VCALENDAR$/);
  assert.equal(ics.split('\r\n').length, ics.split('\n').length, 'CRLF line endings, as iCalendar requires');
});

test('a curtain time is defaulted rather than producing an invalid event', () => {
  const a = app();
  a.run(`shows = [newShow({id:"x", title:"No time", booked:"2027-01-05"})]; globalThis.__ics = icsFor(shows[0]);`);
  assert.match(a.run('__ics'), /DTSTART:20270105T193000/);
});

test('commas and newlines in a title are escaped for the calendar', () => {
  const a = app();
  a.run(`shows = [newShow({id:"s", title:"School Girls; Or, The African Mean Girls Play",
    theatre:"Samuel J. Friedman", booked:"2026-09-28"})]; globalThis.__ics = icsFor(shows[0]);`);
  const ics = a.run('__ics');
  const summary = ics.split('\r\n').find(l => l.startsWith('SUMMARY'));
  assert.equal(summary, 'SUMMARY:School Girls\\; Or\\, The African Mean Girls Play',
    'semicolons and commas are backslash-escaped, as iCalendar requires');
});

test('the Google Calendar link carries the same window and escapes its parameters', () => {
  const a = app();
  a.run(`shows = [newShow({id:"g", title:"Much Ado About Nothing", theatre:"Winter Garden",
    booked:"2026-11-20", bookedTime:"19:00"})]; globalThis.__u = googleCalendarUrl(shows[0]);`);
  const u = a.run('__u');
  assert.match(u, /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  assert.match(u, /dates=20261120T190000%2F20261120T220000/);
  assert.match(u, /text=Much\+Ado\+About\+Nothing/);
});

test('marking it seen uses the booked date, and clears it from the diary', () => {
  const a = app();
  a.run(`shows = [newShow({id:"m", title:"M", booked:"${shift(-2)}"})];
    const s = getShow("m"); s.seen = s.booked;`);
  assert.equal(a.run('shows[0].seen'), a.run('shows[0].booked'));
  assert.equal(a.run('diary().length'), 0);
  assert.equal(a.run('overdue().length'), 0, 'and out of the overdue list too');
});
