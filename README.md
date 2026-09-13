# The Nominator's Ledger

A season-long assessment tool for a Tony nominator: log every eligible Broadway
production the night you see it, score the elements while they are fresh, and
arrive at the nominating meeting with all 26 categories ranked, evidenced, and
ready to argue.

It exists because of the gap the job actually has. A nominator sees a show in
September and votes on it the following April, across 26 categories, from
memory. `index.html` is the notebook that closes that gap.

## Using it

Open `index.html` in a browser. There is no build step, no server, and no
dependency beyond the web fonts.

It arrives carrying the announced **2026–27 Broadway season** — 22 productions
with their classifications, theatres, opening nights, creative credits and
announced casting already filled in, so the night you see a show you only have
to score what you saw. One button empties it if you would rather start clean.

### Season

The ledger. One row per production, in opening-night order: the title, who wrote
it, where and when, and **which awards it is currently under consideration for**.

A production you have seen is tinted and carries a check beside its title —
there is no "seen" or "not seen" label, because the row itself says so. Above the
list, one line of plain English rather than a row of figures; anything that needs
acting on lives on **Needs you**, which is what that tab is for. The coverage strip across the top is the state of the season at a
glance — seen, still to see, unmarked, how many elements you are considering,
how many performances still need placing, marked for a second look, slates set,
and how many categories have a thin field.

Filters cut the ledger down to what needs work: not yet seen, seen but nothing
marked, something marked consider, worth a second look, recused.

### The assessment sheet

Click any production. You get:

- **The night itself** — your verdict on the production, a one-line summary, and
  *what will still be in your head in April*. That last field is the one that
  matters in the meeting.
- **Elements** — the credited artist, a verdict, and a note for each of direction,
  book, score, orchestrations, choreography, and the four designs. Only the
  elements that production can actually be nominated for appear.
- **Performances** — performer, role, leading or featured, actor or actress, a
  verdict, and the moment. Billing decides leading versus featured and billing is
  sometimes wrong, so there is a flag for the ones you intend to argue about.
- **Eligibility and conflicts** — mark a production ineligible, mark yourself
  recused (which removes it from every category on your ballot, with the reason
  recorded), or flag it for a second viewing.

### Verdicts, and why scoring is optional

Every element — the production itself, each credit, each performance — carries
one of three verdicts: **consider**, **undecided**, or **pass**. Everything
starts undecided, and marking something *consider* is what puts it on that
category's list. That is the whole mechanism; you never have to give a number to
anything.

**Pass is private.** It records that you gave something thought and moved on, and
it is reported nowhere else — no badge on the ledger, no flag, no count. A
production you passed on can still be under consideration for its design or a
performance, and the ledger will say so without mentioning the pass.

Scoring is there when you want it. Each element also has an optional ten-segment
fader — click it, or focus it and use the arrow keys, `0`–`9`, `Home`, or `End`.
Where you gave a score it orders the list within a verdict group, so the things
you thought hardest about sort to the top. Where you did not, the candidate shows
a dot and sorts alphabetically. Nothing requires a score and nothing is hidden
for want of one.

### Ballot

All 26 competitive categories, grouped the way the committee works through them.
Every production you have seen appears in the categories it is eligible for,
carrying the note you wrote at the time, split into three lists:

- **Considering** — what you marked consider, building as the season goes. This
  is the list you work down.
- **Undecided** — everything eligible you have not ruled on.
- **Passed** — collapsed out of the way, one click from coming back.

You can change a verdict from the ballot as readily as from the assessment sheet,
and a candidate moves between lists as you do. Once something is in the
considering list it gets a **Nominate** button, which puts it on the slate; set
the slate size per category. Changing a verdict away from consider clears any
nomination with it — you cannot nominate what you have passed on.

The eligibility rules are enforced rather than left to memory:

- Book and original score are open to new musicals. A revival's existing book is
  not eligible, and a score assembled from released songs is not an original
  score — both are per-production toggles you control.
- Orchestrations *are* open to revivals.
- Design and direction categories split play from musical; choreography does not.
- Recused productions appear nowhere.

A category with fewer than four eligible candidates is flagged as a thin field,
because that is a problem you want to know about in January, not in April. Until
half the season has been seen those flags stay quiet — a thin field in October is
just an early one.

### Nominations

The finished ballot, with the categories that are not yet settled called out at
the top, and a tally of nominations per production. Download it as plain text,
print it, or take a full JSON backup — every score, note, and conflict — which
is also what the restore button reads.

## Where the data lives, and how it is protected

Published as a Claude Artifact, the ledger persists to the artifact's own private
store and syncs across your devices; it also keeps a mirror copy in the browser
you are using. Opened as a local file, browser storage is the record.

Either way the JSON backup is the copy you control. Take one before the meeting —
the app will remind you if a fortnight goes by without one.

What stands between you and a lost season:

- **Saves are visible.** A header indicator shows the last save; a banner that
  stays up — not a toast that vanishes — appears the moment a write fails, on
  either backend, and comes down when one succeeds.
- **Nothing sits in a timer when you leave.** Local writes are synchronous.
  Database writes are flushed on `pagehide` and when the tab is hidden, and
  mirrored to the browser at the same moment, so a dying network cannot take the
  edit with it.
- **An unreadable ledger is never overwritten.** If what is in storage does not
  parse as a ledger, the app stops and offers a recovery screen: download the raw
  bytes, roll back to a snapshot, load your own backup, or start over. It will
  not silently reseed over your season.
- **Rolling snapshots.** One automatic copy a day plus one before anything
  wholesale (an import, emptying the season), five kept. Reachable from
  *Restore a snapshot* on the Nominations tab.
- **Deletes can be undone.** Removing a performance offers it back for twelve
  seconds, with its verdict and any nomination intact.

Run the tests with `npm test` (49 of them, no dependencies).

### A central feed, later

The merge path is already the shared one: `buildRosterUpdate()` diffs a set of
roster entries against the ledger and `applyRosterUpdate()` applies only what is
ticked, preserving everything the nominator wrote. Today those entries come from
`seedInto()`, the built-in roster.

A centrally managed feed would replace that one function with a fetch and leave
the rest alone — the review screen, the preservation rules and the versioning all
work unchanged. What it additionally needs is a service to host the roster, a
published-version number to compare against `ROSTER_VERSION`, and a decision
about whether updates arrive silently for untouched ledgers only (as now) or
always prompt. None of that is built here.

### Season to season

*Archive this season* on the Nominations tab packs the whole season away — in the
browser, and in the published page's store — and starts a new one. Archived
seasons stay readable and can be restored from *Restore a snapshot*.

### Press releases

Details arrive from press agents as prose, not as a form. **Paste a press
release** on the Season tab and it is read into a draft: title, classification,
theatre, opening night, every credited designer, and the cast with roles where
the release gives them.

Two readers produce the same draft. Where the page can ask Claude, Claude reads
it — far better on real prose. Otherwise a local parser handles the formulaic
parts ("directed by", "scenic design by", "X as Role", "opens Thursday, October
29"). It strips awards from names, so "six-time Tony Award winner Michael Arden"
is filed as *Michael Arden*, and it takes **opening night**, not the first
preview.

Nothing is written until you have corrected it, because reading prose is a guess:

- A release matching a production you already have **updates** it rather than
  duplicating. Blank fields are filled; anything that disagrees with what you
  have is listed for you to tick, and unticked your version stays.
- Only facts of record are written. No verdict, no score, no note, and the
  production is not marked seen. New cast arrives with billing and category
  **unplaced** — those are judgments, not data.

### When the roster is recompiled

New productions get announced all winter. When the built-in roster moves on, a
ledger you have not started yet simply takes the update. Once you have marked
anything, the update becomes a **proposal instead**: a review screen listing new
productions and changed credits, each with a tick box. Nothing you wrote —
verdicts, scores, notes, dates seen, recusals — is touched either way, and
productions you added yourself are left alone.

## Publishing it as an Artifact

```
python3 tools/build-artifact.py dist/artifact.html
```

This strips the document wrapper (the Artifact publisher supplies its own) and
leaves everything else untouched. Publish the result with the `db` and
`downloads` capabilities declared.

## The prepopulated roster

The roster was compiled from public announcements as of **13 September 2026**
and covers the 22 Tony-eligible Broadway productions announced for the 2026–27
season, from *Paranormal Activity* (15 September 2026) through *The Full Monty*
(25 April 2027).

What is filled in is a matter of record: title, classification, theatre, opening
night, author, director, designers and announced principal casting. What is not
filled in is anything that would be an opinion — every score is zero, every note
is empty, and no production is marked as seen.

Three things to know about it:

- **Dates move and casting is added.** Several spring productions had no theatre
  or no dates announced when this was compiled; they carry the note "date TBA"
  and sort to the end of the schedule. More productions will be announced through
  the winter — raise the eligible count as they are.
- **Billing and category are left unplaced by default.** A performance only
  enters a category once you place it as leading or featured and as actor or
  actress. Where an announcement did not settle it, or where the placement is
  the performer's own call, the roster leaves it unplaced rather than guessing,
  and the coverage strip counts how many are still waiting. Mason Alexander Park
  in *Much Ado About Nothing* is left unplaced deliberately for that reason.
- **The genuinely contested rulings are flagged, not decided.** *The Fantasticks*
  never played Broadway, so it is not a revival — but its 1960 book and score are
  not original to this production, and both are switched off pending a ruling.
  *Dolly* mixes catalogue songs with new writing, so its score is switched off the
  same way. *860* is a solo show, which the Administration Committee has
  repeatedly moved out of Best Play. Each carries an eligibility note saying so.

Verify anything you are about to rely on. The ledger is a working notebook, not
a source of record.
