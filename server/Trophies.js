/**
 * TROPHY CABINET + TROPHY ROOM
 * ---------------------------------------------------------------
 * Each student's cabinet is stored inside their profile JSON (Profiles sheet), so no new sheet is needed:
 *   profile.cab = { wk, items: [trophy, ...newest first], keep: id | null,
 *                   locked: [trophy + {wk}, ...newest first], show: id | null }
 *   trophy      = { id, e: '🦉', n: 'Owl of Athena', op: 'mul', team: 'Azure Krakens', t: 1729500000000,
 *                   tier: 'plat' | 'pearl' | 'ebony' | absent (= basic), open: true (not decided yet) | absent }
 *   (Trophies from v9/v10 stored platinum as plat: true. They are read as tier 'plat' and converted.)
 *
 * Rules:
 *  - Every player on the winning team of a class round (who sent in a result) gets the same BASIC trophy.
 *    It goes into this week's trophies straight away, "open" (undecided).
 *  - Undecided trophy: the student either puts it in the cabinet as it is (decides it), or re-rolls it ONE step
 *    up the ladder (CONFIG.REROLL_LADDER): basic -> platinum 20%, platinum -> pearl 10%, pearl -> ebony 5%.
 *    Miss = the trophy is lost. Hit = it changes tier and stays undecided, so they can keep it or risk it again.
 *    Ebony is the top: it is decided automatically. The odds are the same for every student and are not sent
 *    to the app (students only see a "re-roll power" bar made from their fluent levels — Haydn's design).
 *  - One trophy per week is kept: the student taps the one to keep. At the start of the next trophy week
 *    (Sunday 00:00 Perth) that trophy is LOCKED into the cabinet for good and the week's other trophies are cleared.
 *    If they didn't choose, their best trophy is kept: highest tier first (ebony, pearl, platinum, basic), then newest.
 *  - Showcase: the student picks one locked-in trophy to stand on their plinth in the Trophy room.
 *    If they haven't picked one, their best locked-in trophy is shown (highest tier, then newest).
 *  - Locking happens whenever the cabinet is next read or changed, so no timed trigger is needed.
 *  - Older cabinets (v6/v7) had a "favourite": it is locked in (or, if it was won this week, kept as this week's choice).
 */

var DAY_MS_ = 86400000;

/** Sunday-based week number in local time (day 0 = Thursday 1 Jan 1970, so day 3 is a Sunday). */
function trophyWeek_(ms) {
  var day = Math.floor((ms + CONFIG.TZ_OFFSET_HOURS * 3600000) / DAY_MS_);
  return Math.floor((day + 4) / 7);
}
/** Time (ms) the given trophy week ends, i.e. the next Sunday 00:00 local time. */
function trophyWeekEnds_(wk) {
  return ((wk + 1) * 7 - 4) * DAY_MS_ - CONFIG.TZ_OFFSET_HOURS * 3600000;
}
/** Time (ms) the given trophy week starts (Sunday 00:00 local time). */
function trophyWeekStarts_(wk) { return trophyWeekEnds_(wk) - 7 * DAY_MS_; }

function copyTrophy_(t) { var c = {}; Object.keys(t).forEach(function (k) { c[k] = t[k]; }); return c; }

/* ---------- Tiers ---------- */

/** 'basic', 'plat', 'pearl' or 'ebony'. */
function tierOf_(t) { return t.tier || (t.plat ? 'plat' : 'basic'); }
/** Old platinum trophies (plat: true) -> tier: 'plat'. Mutates. */
function normaliseTier_(t) { if (t.plat) { if (!t.tier) t.tier = 'plat'; delete t.plat; } }
/** 0 = basic; then 1, 2, 3 ... going up the re-roll ladder (platinum, pearl, ebony). */
function tierRank_(id) {
  if (id === 'basic') return 0;
  for (var i = 0; i < CONFIG.REROLL_LADDER.length; i++) if (CONFIG.REROLL_LADDER[i].to === id) return i + 1;
  return 1; // a tier that has since been removed from CONFIG still beats basic
}
/** The ladder step a trophy can be re-rolled with, or null (top tier). */
function nextStep_(t) {
  var tier = tierOf_(t);
  for (var i = 0; i < CONFIG.REROLL_LADDER.length; i++) if (CONFIG.REROLL_LADDER[i].from === tier) return CONFIG.REROLL_LADDER[i];
  return null;
}
/** The best trophy in a list: highest tier first, then the newest. */
function bestOf_(list) {
  var best = null;
  (list || []).forEach(function (t) {
    if (!best) { best = t; return; }
    var a = tierRank_(tierOf_(t)), b = tierRank_(tierOf_(best));
    if (a > b || (a === b && t.t > best.t)) best = t;
  });
  return best;
}

/* ---------- Weekly keep ---------- */

/** The trophy that will be locked in this week: the chosen one, else the best one. */
function weekKeeper_(cab) {
  var items = cab.items || [], i;
  if (cab.keep) for (i = 0; i < items.length; i++) if (items[i].id === cab.keep) return items[i];
  return bestOf_(items);
}

/** Locks the week's keeper into the cabinet and clears the week. */
function lockWeek_(cab) {
  var k = weekKeeper_(cab);
  if (k) {
    var lockedT = copyTrophy_(k);
    delete lockedT.open;
    lockedT.wk = cab.wk;
    cab.locked.unshift(lockedT);
  }
  cab.items = []; cab.keep = null;
}

/** The student's cabinet, after locking any finished week. Mutates the profile. */
function cabinet_(profile, now) {
  var wk = trophyWeek_(now);
  var cab = profile.cab || { wk: wk, items: [], keep: null, locked: [], show: null };
  if (!cab.items) cab.items = [];
  if (!cab.locked) cab.locked = [];
  if (cab.keep === undefined) cab.keep = null;
  if (cab.show === undefined) cab.show = null;
  if (cab.wk === undefined) cab.wk = wk;
  if (cab.fav) { // v6/v7 favourite
    var fav = cab.fav; delete cab.fav;
    var favWk = trophyWeek_(fav.t);
    if (favWk === cab.wk) { cab.items.unshift(fav); cab.items.sort(function (a, b) { return b.t - a.t; }); cab.keep = fav.id; }
    else { var lf = copyTrophy_(fav); lf.wk = favWk; cab.locked.unshift(lf); cab.locked.sort(function (a, b) { return b.wk - a.wk; }); }
  }
  cab.items.forEach(normaliseTier_);
  cab.locked.forEach(normaliseTier_);
  if (cab.wk !== wk) { lockWeek_(cab); cab.wk = wk; }
  profile.cab = cab;
  return cab;
}

/** A random trophy, avoiding `notEmoji` (e.g. the previous round's) when possible. */
function pickTrophy_(notEmoji) {
  var list = CONFIG.TROPHIES.filter(function (t) { return t[0] !== notEmoji; });
  if (!list.length) list = CONFIG.TROPHIES;
  var t = list[Math.floor(Math.random() * list.length)];
  return { e: t[0], n: t[1] };
}

/** Adds a won (basic) trophy to this week's trophies, undecided (mutates the profile). Returns the stored trophy. */
function awardTrophy_(profile, trophy, op, teamName, now) {
  var cab = cabinet_(profile, now);
  var item = { id: now.toString(36) + Math.random().toString(36).slice(2, 7), e: trophy.e, n: trophy.n, op: op, team: teamName, t: now, open: true };
  cab.items.unshift(item);
  while (cab.items.length > CONFIG.TROPHY_SHELF_MAX) {
    var drop = cab.items.pop();
    if (drop.id === cab.keep) { cab.items.splice(cab.items.length - 1, 1, drop); } // never drop the chosen one
  }
  return item;
}

function findIn_(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
  return -1;
}

/**
 * The student decides what to do with an undecided trophy.
 * choice 'keep'   -> it goes in the cabinet as it is.                                  outcome 'kept'
 * choice 'reroll' -> one step up the ladder. Hit: outcome = the new tier ('plat' / 'pearl' / 'ebony'); the trophy
 *                    stays undecided unless it is now the top tier. Miss: outcome 'lost' (removed).
 * rnd: optional random number 0..1 (tests); the server always uses Math.random.
 */
function decideTrophy_(profile, id, choice, now, rnd) {
  var cab = cabinet_(profile, now);
  var i = findIn_(cab.items, id);
  if (i < 0) throw new Error('That trophy isn\'t in your cabinet any more.');
  var t = cab.items[i];
  if (!t.open) throw new Error('You\'ve already decided about this trophy.');
  if (choice === 'keep') { delete t.open; return { outcome: 'kept', trophy: t }; }
  if (choice !== 'reroll') throw new Error('Unknown choice');
  var step = nextStep_(t);
  if (!step) { delete t.open; throw new Error('This trophy is already the best it can be.'); }
  var r = rnd === undefined ? Math.random() : rnd;
  if (r < step.chance) {
    t.tier = step.to;
    if (!nextStep_(t)) delete t.open; // top of the ladder: nothing left to re-roll
    return { outcome: step.to, trophy: t };
  }
  cab.items.splice(i, 1);
  if (cab.keep === id) cab.keep = null;
  return { outcome: 'lost', trophy: null };
}

/** The student picks which of this week's trophies to keep. */
function setKeeper_(profile, id, now) {
  var cab = cabinet_(profile, now);
  if (findIn_(cab.items, id) < 0) throw new Error('That trophy isn\'t in your cabinet any more.');
  cab.keep = id;
  return cab;
}

/* ---------- Showcase + trophy room ---------- */

/** The locked-in trophy on the student's plinth: the one they picked, else their best locked-in one. */
function showcase_(cab) {
  var i = cab.show ? findIn_(cab.locked, cab.show) : -1;
  return i >= 0 ? cab.locked[i] : bestOf_(cab.locked);
}

/** The student picks one of their locked-in trophies as their showcase trophy. */
function setShowcase_(profile, id, now) {
  var cab = cabinet_(profile, now);
  if (findIn_(cab.locked, id) < 0) throw new Error('Only trophies locked into your cabinet can go in the Trophy room.');
  cab.show = id;
  return cab;
}

/** What the student app displays in the cabinet. */
function cabinetView_(profile, now) {
  var cab = cabinet_(profile, now);
  var k = weekKeeper_(cab), s = showcase_(cab);
  return {
    week: { items: cab.items, keeper: k ? k.id : null, chosen: !!cab.keep, locksAt: trophyWeekEnds_(cab.wk) },
    locked: cab.locked.map(function (t) { var c = copyTrophy_(t); c.from = trophyWeekStarts_(t.wk); return c; }),
    showcase: { id: s ? s.id : null, chosen: !!(s && cab.show === s.id) },
    odds: rerollOdds_()
  };
}

/**
 * Trophy room: every active student who has a showcase trophy, sorted by name.
 * Read-only: works on copies of the profiles, so it never writes to the sheet (a finished week is locked the
 * same way when that student's own cabinet is next opened).
 * Only names and showcase trophies are sent; never levels, times or anyone's other trophies.
 */
function trophyRoom_(meId, now) {
  var students = getStudents_().filter(function (s) { return s.active; });
  var profiles = getProfiles_(students.map(function (s) { return s.id; }));
  var plinths = [];
  students.forEach(function (s) {
    var copy = JSON.parse(JSON.stringify(profiles[s.id] || {}));
    var t = showcase_(cabinet_(copy, now));
    if (!t) return;
    plinths.push({ name: s.name, me: s.id === meId, e: t.e, n: t.n, tier: tierOf_(t) === 'basic' ? null : tierOf_(t),
                   op: t.op, from: trophyWeekStarts_(t.wk) });
  });
  plinths.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { plinths: plinths, students: students.length };
}

/** The ladder as sent to the student app: which tier comes next and its name. No chances (they aren't shown). */
function rerollOdds_() {
  return { steps: CONFIG.REROLL_LADDER.map(function (st) { return { from: st.from, to: st.to, name: st.name }; }) };
}
