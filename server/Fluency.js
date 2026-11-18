/**
 * FLUENCY RULES  (levels, dust, profiles)
 * ---------------------------------------------------------------
 * Stored profile shape (one JSON blob per student in the Profiles sheet):
 *   { mul: { "4": { r: [3.1, 2.8, 2.9], n: 7, t: 1729500000000 } }, add: {...}, ... }
 *     r = seconds-per-correct for the most recent attempts (max CONFIG.RECENT_ATTEMPTS)
 *     n = total attempts ever at this level
 *     t = time of the last attempt (ms) — dust is counted from here
 *
 * Rules:
 *   attempt time   = (seconds played + WRONG_PENALTY_SEC (1 s) per wrong answer) / correct answers
 *                    Every saved game counts: practice AND class rounds (penalty included in both).
 *   fluency time   = played once: that attempt's time. Played twice or more: average of the 2 most recent attempts.
 *                    Plus dust.
 *   dust           = 0.3 s for every new week (Monday) since the level was last played.
 *                    Playing the level once (practice or class) clears all of it.
 *   fluent         = at least MIN_ATTEMPTS_FOR_FLUENCY attempts (currently 1) AND fluency time (with dust) <= cut-off
 *   current level  = the LOWEST level that is not fluent, counting levels never tried as not fluent
 *                    (e.g. L1 1.2 s, L2 1.1 s, nothing else tried, cut-off 3 s -> Level 3).
 *                    Dusty levels pull a student back to revise them, everywhere: My levels, Practice,
 *                    Class levels AND class rounds (v12).
 *   class level    = the level played in class rounds = current level (dust included, v12).
 *                    Team balancing uses the student's average at that level WITHOUT dust (expectedTime_).
 */

function round2_(x) { return Math.round(x * 100) / 100; }

/** Monday-based week number in local time. */
function weekIndex_(ms) {
  var day = Math.floor((ms + CONFIG.TZ_OFFSET_HOURS * 3600000) / 86400000); // days since 1 Jan 1970 (a Thursday)
  return Math.floor((day + 3) / 7);
}
function dustFor_(lastMs, nowMs) {
  if (!lastMs) return 0;
  return Math.max(0, weekIndex_(nowMs) - weekIndex_(lastMs)) * CONFIG.DUST_PER_WEEK;
}

function cutoffs_() {
  var s = getSettings_(), out = {};
  CONFIG.OPS.forEach(function (op) { out[op] = Number(s['cutoff_' + op]) || CONFIG.DEFAULT_CUTOFF; });
  return out;
}

/** Seconds per correct answer, with WRONG_PENALTY_SEC added for every wrong answer. Unrounded. */
function rawTime_(seconds, correct, wrong) {
  return (Number(seconds) + (Number(wrong) || 0) * CONFIG.WRONG_PENALTY_SEC) / Math.max(Number(correct) || 0, 1);
}
function attemptTime_(seconds, correct, wrong) { return round2_(rawTime_(seconds, correct, wrong)); }

function levelStats_(entry, cutoff, now) {
  if (!entry || !entry.r || !entry.r.length) return { attempts: 0, avg: null, dust: 0, time: null, fluent: false, cleanFluent: false, last: null };
  var r = entry.r.slice(-CONFIG.RECENT_ATTEMPTS);
  var avg = r.reduce(function (a, b) { return a + b; }, 0) / r.length;
  var dust = dustFor_(entry.t, now);
  var time = avg + dust;
  var need = Math.min(CONFIG.MIN_ATTEMPTS_FOR_FLUENCY, CONFIG.RECENT_ATTEMPTS);
  return {
    attempts: entry.n || r.length,
    recent: r,
    avg: round2_(avg),
    dust: dust,
    time: round2_(time),
    fluent: r.length >= need && time <= cutoff,
    cleanFluent: r.length >= need && avg <= cutoff, // fluent if dust is ignored
    last: entry.t || null
  };
}

/** Summary of one operation: {current, mastered, classLevel, classMastered, cutoff, levels:[{level, attempts, avg, dust, time, fluent, cleanFluent}]}
 *  current counts dust. classLevel = current (since v12, class rounds include dusty levels too). */
function opSummary_(profile, op, cutoff, now) {
  var n = CONFIG.LEVEL_COUNTS[op], levels = [], current = null;
  var data = (profile && profile[op]) || {};
  for (var L = 1; L <= n; L++) {
    var st = levelStats_(data[L], cutoff, now);
    st.level = L;
    levels.push(st);
    if (current === null && !st.fluent) current = L;
  }
  var mastered = current === null;
  if (mastered) current = n;
  // Since v12 class rounds use the same level as everywhere else (dust included). classLevel is kept as a name for older code.
  return { current: current, mastered: mastered, classLevel: current, classMastered: mastered, cutoff: cutoff, levels: levels };
}

/** What the student app displays. */
function profileView_(profile) {
  var now = Date.now(), cut = cutoffs_(), out = {};
  CONFIG.OPS.forEach(function (op) { out[op] = opSummary_(profile, op, cut[op], now); });
  return out;
}

/** Adds one attempt to a profile object (mutates it). */
function recordAttempt_(profile, op, level, time, now) {
  profile[op] = profile[op] || {};
  var e = profile[op][level] || { r: [], n: 0 };
  e.r.push(round2_(time));
  if (e.r.length > CONFIG.RECENT_ATTEMPTS) e.r = e.r.slice(-CONFIG.RECENT_ATTEMPTS);
  e.n = (e.n || 0) + 1;
  e.t = now;
  profile[op][level] = e;
}

/**
 * Expected seconds-per-correct at the student's class level for this operation (used to balance teams).
 * = their fluency time at that level WITHOUT dust (+ dust only if CONFIG.BALANCE_ADD_DUST).
 *   So a student sent back to a dusty level is balanced on how fast they really were at it.
 * Never played that level: cut-off + UNKNOWN_EXTRA (an estimate, not a measurement).
 */
function expectedTime_(summary) {
  var st = summary.levels[summary.classLevel - 1];
  if (st.avg === null) return round2_(summary.cutoff + CONFIG.UNKNOWN_EXTRA);
  return CONFIG.BALANCE_ADD_DUST ? st.time : st.avg;
}

/**
 * Moves a profile saved with older level numbers onto the current ones (mutates it; safe to run again).
 * Levels version 1 -> 2 (v12): + and − got ten new Levels 1-10 ("a + n" / "a − n").
 *   Old Addition L1-3 (1D + 1D, 2D + 1D) and old Subtraction L1-3 (1D − 1D, 2D − 1D) no longer exist: their data is dropped
 *   (it stays in the Attempts sheet). Old Addition L4-13 -> L11-20, old Subtraction L4-11 -> L11-18.
 *   Multiplication and division are unchanged. Trophies are unchanged.
 */
function migrateProfile_(p) {
  if (!p || typeof p !== 'object') return p;
  var v = p.lv || 1;
  if (v < 2) {
    ['add', 'sub'].forEach(function (op) {
      var old = p[op];
      if (!old) return;
      var moved = {};
      Object.keys(old).forEach(function (k) { var L = Number(k); if (L >= 4) moved[L + 7] = old[k]; });
      p[op] = moved;
    });
  }
  p.lv = CONFIG.LEVELS_VERSION;
  return p;
}

function validOpLevel_(op, level) {
  return CONFIG.LEVEL_COUNTS.hasOwnProperty(op) && level >= 1 && level <= CONFIG.LEVEL_COUNTS[op] && Math.floor(level) === level;
}
