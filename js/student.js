/**
 * STUDENT APP (index.html)
 * Screens: login -> menu -> { practice | class game (multiplayer) | my levels | trophy cabinet | trophy room }
 * Each screen is one function that fills #app. Server calls go through API (js/api.js).
 */
(function () {
  var C = window.APP_CONFIG, esc = Game.esc, store = API.storage, KEY = 'fg_session';
  var app = document.getElementById('app');
  var S = { session: null, timer: null, mp: null };

  /* ---------- helpers ---------- */
  function render(html) { app.innerHTML = html; window.scrollTo(0, 0); }
  function stopPolling() { clearTimeout(S.timer); S.timer = null; S.mp = null; }
  function saveSession() { store.setItem(KEY, JSON.stringify(S.session)); }
  function opName(op) { return Levels.OPS[op].name; }
  function loading(msg) { render('<div class="center pad-xl"><div class="spinner"></div><p>' + esc(msg || 'Loading…') + '</p></div>'); }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3500);
  }
  function fail(e) {
    if (e && e.code === 'SESSION_EXPIRED') { store.removeItem(KEY); S.session = null; toast('Please log in again.'); return showLogin(); }
    toast(e && e.message ? e.message : 'Something went wrong');
  }
  function on(sel, ev, fn) { var n = app.querySelector(sel); if (n) n.addEventListener(ev, fn); }
  function onAll(sel, ev, fn) { app.querySelectorAll(sel).forEach(function (n) { n.addEventListener(ev, function () { fn(n); }); }); }
  function backBtn(label) { return '<button class="btn ghost back" data-back>← ' + (label || 'Back') + '</button>'; }
  /** Profiles change after class games and when the teacher changes cut-offs, so re-fetch on the menu screens. */
  function refreshProfile(then) {
    API.call('profile', { token: S.session.token }).then(function (r) { S.session.profile = r.profile; S.session.rules = r.rules; saveSession(); then(); }).catch(fail);
  }

  /* ---------- fluency meter (menu, trophy cabinet, win screen) ---------- */
  /** Levels fluent right now across all four operations, dust included (the same ✅ count as My levels). */
  function fluentCount() {
    var n = 0, total = 0;
    Levels.ORDER.forEach(function (op) { S.session.profile[op].levels.forEach(function (st) { total++; if (st.fluent) n++; }); });
    return { n: n, total: total, pct: total ? Math.round(n / total * 100) : 0 };
  }
  function fluencyMeter() {
    var f = fluentCount();
    return '<div class="fluency-meter" data-fluency>' +
      '<div class="fm-top"><span class="fm-label">⚡ Fluent levels</span><span class="fm-num"><b>' + f.n + '</b> / ' + f.total + ' · <b>' + f.pct + '%</b></span></div>' +
      '<div class="fm-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + f.total + '" aria-valuenow="' + f.n + '"><div style="width:' + f.pct + '%"></div></div>' +
      '<p class="fm-note">' + esc(C.FLUENCY_REROLL_NOTE || '') + '</p></div>';
  }
  /**
   * Re-roll power bar, shown above every Re-roll button (win screen and cabinet). It is simply the % of levels
   * fluent right now (dust included). The real odds don't depend on it (Haydn's design: it encourages keeping levels fluent).
   */
  function powerBar() {
    var f = fluentCount(), full = f.pct >= 100;
    return '<div class="power-bar' + (full ? ' full' : '') + '" data-power>' +
      '<div class="pb-top"><span class="pb-label">🎲 Re-roll power</span><span class="pb-num">' + f.pct + '%' + (full ? ' ⚡ MAX' : '') + '</span></div>' +
      '<div class="pb-track" role="progressbar" aria-label="Re-roll power" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + f.pct + '">' +
        '<div class="pb-fill" style="width:' + Math.max(f.pct, 2) + '%"></div>' +
        '<div class="pb-ticks" aria-hidden="true"></div></div>' +
      '<p class="pb-note">' + f.n + ' of ' + f.total + ' levels fluent. ' + esc(C.POWER_NOTE || '') + '</p></div>';
  }
  /** Redraws every fluency meter and re-roll power bar on screen (and fills empty power slots). */
  function fillFluency() {
    app.querySelectorAll('[data-fluency]').forEach(function (n) { n.outerHTML = fluencyMeter(); });
    app.querySelectorAll('[data-power], .power-slot').forEach(function (n) { n.outerHTML = powerBar(); });
  }

  /* ---------- login ---------- */
  function startSession(res) {
    S.session = { token: res.token, student: res.student, profile: res.profile, rules: res.rules };
    saveSession();
  }

  function showLogin() {
    stopPolling();
    loading('Opening the temple gates…');
    API.call('classList').then(function (r) {
      var byId = {};
      r.students.forEach(function (s) { byId[s.id] = s; });
      render(
        '<div class="card temple narrow">' +
          '<h1 class="title">Trials of Olympus</h1>' +
          '<p class="subtitle">Climb Mount Olympus one level at a time</p>' +
          (API.demo ? '<p class="demo-note">Demo mode: nobody has a password yet, so you\'ll create one.</p>' : '') +
          '<label>Your name<select id="who"><option value="">Choose your name…</option>' +
            r.students.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') +
          '</select></label>' +
          '<div id="pw-area"></div>' +
          '<a class="switch-link" href="teacher.html">Teacher login</a>' +
        '</div>');
      var area = app.querySelector('#pw-area'), who = app.querySelector('#who');

      function drawReturning() {
        area.innerHTML = '<label>Password<input id="pw" type="password" autocomplete="off" autocapitalize="off"></label>' +
          '<button class="btn big primary" id="go">Enter</button>';
        var go = function () {
          var b = app.querySelector('#go'); b.disabled = true; b.textContent = 'Checking…';
          API.call('login', { studentId: who.value, password: app.querySelector('#pw').value }).then(function (res) {
            startSession(res); showMenu();
          }).catch(function (e) {
            b.disabled = false; b.textContent = 'Enter';
            if (e.code === 'NEEDS_PASSWORD') { byId[who.value].isNew = true; return drawFirstTime(); } // teacher reset it
            fail(e);
          });
        };
        on('#go', 'click', go);
        on('#pw', 'keydown', function (e) { if (e.key === 'Enter') go(); });
        app.querySelector('#pw').focus();
      }

      function drawFirstTime() {
        area.innerHTML =
          '<div class="first-time">' +
            '<h2>Create your password</h2>' +
            '<p>This is your first time here. Make up a password you\'ll remember, at least 4 letters or numbers.</p>' +
            '<p class="write-it">✍️ Write it down somewhere safe, like the back of your diary.</p>' +
            '<label>New password<input id="pw1" type="password" autocomplete="off" autocapitalize="off"></label>' +
            '<label>Type it again<input id="pw2" type="password" autocomplete="off" autocapitalize="off"></label>' +
            '<label class="show-pw"><input type="checkbox" id="show"> Show what I typed</label>' +
            '<button class="btn big primary" id="create">Save my password</button>' +
          '</div>';
        on('#show', 'change', function (e) {
          ['#pw1', '#pw2'].forEach(function (sel) { app.querySelector(sel).type = e.target.checked ? 'text' : 'password'; });
        });
        var create = function () {
          var a = app.querySelector('#pw1').value.trim(), b2 = app.querySelector('#pw2').value.trim();
          if (a.length < 4) return toast('Your password needs at least 4 letters or numbers.');
          if (a !== b2) return toast('The two passwords don\'t match. Try again.');
          var b = app.querySelector('#create'); b.disabled = true; b.textContent = 'Saving…';
          API.call('setPassword', { studentId: who.value, password: a }).then(function (res) {
            startSession(res); showPasswordSaved(a);
          }).catch(function (e) { b.disabled = false; b.textContent = 'Save my password'; fail(e); });
        };
        on('#create', 'click', create);
        on('#pw2', 'keydown', function (e) { if (e.key === 'Enter') create(); });
        app.querySelector('#pw1').focus();
      }

      who.addEventListener('change', function () {
        var s = byId[who.value];
        if (!s) { area.innerHTML = ''; return; }
        if (s.isNew) drawFirstTime(); else drawReturning();
      });
    }).catch(function (e) {
      render('<div class="card narrow center"><h2>Can\'t reach the game</h2><p>' + esc(e.message) + '</p><button class="btn primary" id="retry">Try again</button></div>');
      on('#retry', 'click', showLogin);
    });
  }

  /** Shown once, straight after a student creates their password. */
  function showPasswordSaved(pw) {
    render('<div class="card temple narrow center">' +
      '<div class="big-emoji">🔐</div>' +
      '<h2>Password saved!</h2>' +
      '<p>Your password is:</p><p class="pw-show">' + esc(pw) + '</p>' +
      '<p class="write-it">✍️ Write it down somewhere safe now. You\'ll need it every time you log in.</p>' +
      '<button class="btn big primary" id="done">I\'ve written it down</button></div>');
    on('#done', 'click', showMenu);
  }

  /* ---------- menu ---------- */
  function showMenu() {
    stopPolling();
    render(
      '<div class="card temple narrow center" data-screen="menu">' +
        '<h1 class="title">Welcome, ' + esc(S.session.student.name.split(' ')[0]) + '</h1>' +
        fluencyMeter() +
        '<div class="menu">' +
          '<button class="btn huge primary" id="mp">⚔️ Class game</button>' +
          '<button class="btn huge" id="pr">🎯 Practice</button>' +
          '<button class="btn huge" id="lv">📜 My levels</button>' +
          '<div class="menu-pair">' +
            '<button class="btn huge" id="tc">🏆 Trophy cabinet</button>' +
            '<button class="btn huge" id="tr">🏛️ Trophy room</button>' +
          '</div>' +
        '</div>' +
        '<button class="btn ghost small" id="out">Log out</button>' +
      '</div>');
    on('#mp', 'click', showMultiplayer);
    on('#pr', 'click', function () { showPracticeOps(); });
    on('#lv', 'click', function () { showProfile(Levels.ORDER[0]); });
    on('#tc', 'click', function () { showCabinet(); });
    on('#tr', 'click', showTrophyRoom);
    on('#out', 'click', function () { store.removeItem(KEY); S.session = null; showLogin(); });
    refreshProfile(function () { if (app.querySelector('[data-screen="menu"]')) fillFluency(); });
  }

  function opButtons() {
    return Levels.ORDER.map(function (op) {
      var sum = S.session.profile[op];
      return '<button class="btn op-btn" data-op="' + op + '"><span class="op-sym">' + Levels.OPS[op].symbol + '</span>' +
        '<span>' + opName(op) + '<small>' + (sum.mastered ? '🏆 Every level fluent' : 'Level ' + sum.current + ': ' + esc(Levels.title(op, sum.current))) + '</small></span></button>';
    }).join('');
  }

  /* ---------- trophy cabinet ---------- */
  var SHELF_SLOTS = 5;   // trophies per shelf
  var T = Celebrate.trophy, TN = Celebrate.trophyName;

  function rules() { return S.session.rules || {}; }
  function ladder() { return Celebrate.ladder(rules().reroll); }
  function perthDate(ms, opts) { return new Date(ms).toLocaleDateString('en-AU', Object.assign({ timeZone: 'Australia/Perth' }, opts)); }
  function weekLabel(ms) { return 'Week of ' + perthDate(ms, { day: 'numeric', month: 'short', year: 'numeric' }); }

  /** No chances in the confirm box: just what happens either way, and the re-roll power. */
  function rerollConfirm(box) {
    var name = (box.getAttribute('data-next-name') || 'a better trophy').toUpperCase();
    return 'Re-roll this trophy?\n\nIf it works, it turns ' + name + '.\nIf it doesn\'t, the trophy is GONE.\n\n' +
      'Your re-roll power: ' + fluentCount().pct + '% (from your fluent levels).';
  }

  /**
   * Wires up "Put it in my cabinet / Re-roll" buttons inside `root`. onDone(result) is called after the server answers.
   * Re-rolling shows a short dice spin first so the result feels like a reveal.
   */
  function bindDecisions(root, onDone) {
    root.querySelectorAll('.decide').forEach(function (box) {
      var id = box.getAttribute('data-decide-for');
      box.querySelectorAll('[data-decide]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var choice = btn.getAttribute('data-decide');
          if (choice === 'reroll' && !window.confirm(rerollConfirm(box))) return;
          box.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
          var spin = choice === 'reroll' ? new Promise(function (r) { box.insertAdjacentHTML('beforeend', '<div class="rolling" aria-live="polite"><span class="dice">🎲</span> Rolling…</div>'); setTimeout(r, 1400); }) : Promise.resolve();
          var req = API.call('trophyDecision', { token: S.session.token, id: id, choice: choice });
          Promise.all([req, spin]).then(function (all) { onDone(all[0], box); })
            .catch(function (e) { var r = box.querySelector('.rolling'); if (r) r.remove(); box.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); fail(e); });
        });
      });
    });
  }

  function isTier(outcome) { return !!Celebrate.tierName(outcome); }

  /** Message for the result of a keep / re-roll. */
  function outcomeHtml(res) {
    if (res.outcome === 'kept') return '<div class="outcome kept">✅ It\'s in your trophy cabinet.</div>';
    if (isTier(res.outcome)) {
      var tn = Celebrate.tierName(res.outcome), next = Celebrate.nextStep(res.trophy, ladder());
      return '<div class="outcome tier ' + esc(res.outcome) + '">✨ ' + esc(tn.toUpperCase()) + '! Your ' + esc(res.trophy.n) + ' is now ' + esc(tn.toLowerCase()) + '.' +
        (next ? ' Keep it, or risk it for ' + esc(next.name) + '?' : ' The rarest trophy on Olympus! It\'s in your cabinet.') + '</div>';
    }
    return '<div class="outcome lost">💨 It\'s gone! Better luck next time.</div>';
  }

  /** On the win screen: replace the buttons with the outcome, recolour the trophy, and offer the next step if there is one. */
  function decidedOnResults(res, box) {
    var panel = box.closest('.trophy-won'), t = panel && panel.querySelector('.trophy');
    var note = panel && panel.querySelector('.trophy-won-note');
    panel.querySelectorAll('.outcome').forEach(function (m) { m.remove(); });
    if (isTier(res.outcome)) {
      Celebrate.confetti(3000);
      ['plat', 'pearl', 'ebony'].forEach(function (c) { if (t) t.classList.remove(c); panel.classList.remove(c); });
      if (t) { t.classList.remove('shine'); void t.offsetWidth; t.classList.add(res.outcome, 'shine'); }
      panel.classList.add(res.outcome);
      panel.querySelector('.trophy-won-name').textContent = TN(res.trophy);
      if (note) note.textContent = res.trophy.open ? 'Keep it, or risk it again?' : '';
      box.outerHTML = outcomeHtml(res) + (res.trophy.open ? Celebrate.decision(res.trophy, ladder()) : '');
      if (res.trophy.open) { bindDecisions(panel, decidedOnResults); fillFluency(); }
      return;
    }
    if (note) note.textContent = '';
    if (res.outcome === 'lost' && t) { t.classList.add('vanish'); panel.classList.add('lost'); }
    box.outerHTML = outcomeHtml(res);
  }

  function showCabinet(selectedId, message) {
    stopPolling();
    loading('Polishing your trophies…');
    Promise.all([API.call('cabinet', { token: S.session.token }), API.call('profile', { token: S.session.token })]).then(function (all) {
      S.session.profile = all[1].profile; S.session.rules = all[1].rules; saveSession();
      drawCabinet(all[0].cabinet, selectedId, message);
    }).catch(fail);
  }

  function shelvesHtml(list, slot, minShelves) {
    var out = '';
    for (var i = 0; i < Math.max(list.length, (minShelves || 1) * SHELF_SLOTS); i += SHELF_SLOTS) {
      var row = list.slice(i, i + SHELF_SLOTS), html = row.map(slot).join('');
      for (var k = row.length; k < SHELF_SLOTS; k++) html += '<span class="trophy-slot empty" aria-hidden="true"></span>';
      out += '<div class="shelf">' + html + '</div>';
    }
    return out;
  }

  /**
   * cab = {week: {items, keeper, chosen, locksAt}, locked: [...], showcase: {id, chosen}}.
   * selectedId = trophy whose details are open (this week's or a locked-in one).
   */
  function drawCabinet(cab, selectedId, message) {
    var wk = cab.week, items = wk.items || [], locked = cab.locked || [], show = cab.showcase || { id: null, chosen: false };
    var sel = null, selLocked = false;
    items.forEach(function (t) { if (t.id === selectedId) sel = t; });
    if (!sel) locked.forEach(function (t) { if (t.id === selectedId) { sel = t; selLocked = true; } });
    var lockDay = perthDate(wk.locksAt - 1, { weekday: 'long', day: 'numeric', month: 'short' });

    var weekSlot = function (t) {
      return '<button class="trophy-slot' + (t.id === wk.keeper ? ' keeper' : '') + (sel && t.id === sel.id ? ' selected' : '') + '" data-id="' + esc(t.id) + '" aria-label="' + esc(TN(t)) + '">' +
        (t.id === wk.keeper ? '<span class="slot-badge keep">⭐</span>' : t.open ? '<span class="slot-badge open">🎲</span>' : '') +
        T(t, 'md') + '<span class="slot-name">' + esc(TN(t)) + '</span></button>';
    };
    var lockedSlot = function (t) {
      return '<button class="trophy-slot locked-slot' + (t.id === show.id ? ' showcase' : '') + (sel && t.id === sel.id ? ' selected' : '') + '" data-id="' + esc(t.id) + '" aria-label="' + esc(TN(t)) + '">' +
        (t.id === show.id ? '<span class="slot-badge show">🏛️</span>' : '') +
        T(t, 'md') + '<span class="slot-name">' + esc(TN(t)) + '</span>' +
        '<span class="slot-week">' + esc(weekLabel(t.from)) + '</span></button>';
    };

    var detail = '';
    if (sel && !selLocked) {
      detail = '<div class="trophy-detail">' + T(sel, 'xl') +
        '<div class="detail-text"><div class="detail-name">' + esc(TN(sel)) + '</div>' +
        '<div class="detail-from">Won with the ' + esc(sel.team) + ' · ' + esc(Levels.OPS[sel.op] ? Levels.OPS[sel.op].name : '') + '</div>' +
        (sel.open ? '<p class="detail-note">You haven\'t decided about this one yet.</p>' + Celebrate.decision(sel, ladder()) : '') +
        (sel.id === wk.keeper
          ? '<p class="detail-keep">⭐ ' + (wk.chosen ? 'This is the one you\'re keeping this week.' : 'This one will be kept unless you choose another.') + '</p>'
          : '<button class="btn primary" id="keep-this">⭐ Keep this one this week</button>') +
        '</div></div>';
    } else if (sel) {
      detail = '<div class="trophy-detail">' + T(sel, 'xl') +
        '<div class="detail-text"><div class="detail-name">' + esc(TN(sel)) + '</div>' +
        '<div class="detail-from">Locked in · ' + esc(weekLabel(sel.from)) + (sel.team ? ' · Won with the ' + esc(sel.team) : '') + '</div>' +
        (sel.id === show.id
          ? '<p class="detail-keep">🏛️ ' + (show.chosen ? 'This is your showcase trophy in the Trophy room.' : 'This one stands in the Trophy room until you choose another.') + '</p>'
          : '<button class="btn primary" id="show-this">🏛️ Make this my showcase trophy</button>') +
        '</div></div>';
    }

    render('<div class="card wide cabinet-card">' + backBtn('Menu') +
      '<h2 class="center">🏆 My Trophy Cabinet</h2>' +
      (message || '') +
      fluencyMeter() +
      '<h3 class="cab-head">This week\'s trophies</h3>' +
      '<p class="cab-help">' + (items.length
        ? 'Keep <b>one</b> trophy each week. Tap a trophy, then <b>⭐ Keep this one</b>. At midnight on <b>' + esc(lockDay) + '</b> your ⭐ trophy is locked into your cabinet for good and the others are cleared.' +
          (wk.chosen ? '' : ' <b>You haven\'t chosen yet</b>, so your best one (⭐) will be kept.')
        : 'Win a class game with your team to earn a trophy! Each week you keep your favourite one.') + '</p>' +
      '<div class="cabinet week-cabinet">' + shelvesHtml(items, weekSlot, 1) + '</div>' +
      (sel && !selLocked ? detail : '') +
      '<h3 class="cab-head">Locked in for good</h3>' +
      (locked.length ? '<p class="cab-help">Tap a trophy to make it your <b>🏛️ showcase trophy</b>. It stands on your plinth in the Trophy room for everyone to see.' +
        (show.chosen ? '' : ' You haven\'t chosen yet, so your best one (🏛️) is shown.') + '</p>' : '') +
      '<div class="cabinet">' + (locked.length ? shelvesHtml(locked, lockedSlot, 1)
        : '<p class="cab-empty">The trophy you keep each week will be locked in here forever.</p>') + '</div>' +
      (selLocked ? detail : '') +
      '<div class="center"><button class="btn" id="to-room">🏛️ Visit the Trophy room</button></div>' +
    '</div>');
    fillFluency();
    on('[data-back]', 'click', showMenu);
    on('#to-room', 'click', showTrophyRoom);
    onAll('.trophy-slot[data-id]', 'click', function (b) {
      var id = b.getAttribute('data-id');
      drawCabinet(cab, sel && sel.id === id ? null : id);
      var d = app.querySelector('.trophy-detail'); if (d) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    on('#keep-this', 'click', function () {
      var b = app.querySelector('#keep-this'); b.disabled = true;
      API.call('setKeeper', { token: S.session.token, id: sel.id })
        .then(function (r) { drawCabinet(r.cabinet, sel.id); })
        .catch(function (e) { b.disabled = false; fail(e); });
    });
    on('#show-this', 'click', function () {
      var b = app.querySelector('#show-this'); b.disabled = true;
      API.call('setShowcase', { token: S.session.token, id: sel.id })
        .then(function (r) { drawCabinet(r.cabinet, sel.id, '<div class="outcome kept">🏛️ Your ' + esc(TN(sel)) + ' is now on your plinth in the Trophy room.</div>'); })
        .catch(function (e) { b.disabled = false; fail(e); });
    });
    bindDecisions(app, function (res) {
      drawCabinet(res.cabinet, res.trophy && res.outcome !== 'lost' ? res.trophy.id : null, outcomeHtml(res));
      if (isTier(res.outcome)) Celebrate.confetti(3000);
    });
  }

  /* ---------- trophy room ---------- */
  var PLINTH_W = 210;   // px per plinth (including the gap)

  function showTrophyRoom() {
    stopPolling();
    loading('Lighting the torches…');
    API.call('trophyRoom', { token: S.session.token }).then(function (r) { drawTrophyRoom(r.room); }).catch(fail);
  }

  function plinthHtml(p) {
    return '<div class="plinth' + (p.me ? ' mine' : '') + '">' +
      '<div class="plinth-light" aria-hidden="true"></div>' +
      '<div class="plinth-trophy">' + T(p, 'xl') + '</div>' +
      '<div class="plinth-cap"></div>' +
      '<div class="plinth-body">' +
        '<div class="plinth-tname">' + esc(TN(p)) + '</div>' +
        (p.tier ? '<div class="plinth-tier ' + esc(p.tier) + '">' + esc(Celebrate.tierName(p.tier)) + '</div>' : '') +
        '<div class="plinth-plate">' + esc(p.name) + (p.me ? ' <span class="plinth-you">(you)</span>' : '') + '</div>' +
      '</div>' +
      '<div class="plinth-base"></div>' +
    '</div>';
  }

  function drawTrophyRoom(room) {
    var plinths = room.plinths || [], hasMine = plinths.some(function (p) { return p.me; });
    render('<div class="card wide room-card">' + backBtn('Menu') +
      '<h2 class="center">🏛️ The Trophy Room</h2>' +
      '<p class="cab-help center">' + (plinths.length
        ? 'Every hero\'s showcase trophy. <b>Tap and drag</b> to walk around the hall.'
        : 'The plinths are empty for now. When a week ends, the trophy you kept is locked into your cabinet and appears here.') + '</p>' +
      (plinths.length ? '<div class="hall" id="hall" tabindex="0" aria-label="Trophy room. Drag, or use the arrow keys, to look around.">' +
        '<div class="hall-columns" aria-hidden="true"></div><div class="hall-track"></div><div class="hall-floor" aria-hidden="true"></div></div>' +
        '<p class="hall-hint center" aria-hidden="true">⟵ drag ⟶</p>' : '') +
      '<p class="center cab-help">' + (hasMine ? 'Change your showcase trophy in your trophy cabinet.' : 'You\'ll get your own plinth once you have a trophy locked into your cabinet.') + '</p>' +
      '<div class="center"><button class="btn" id="to-cab">🏆 My trophy cabinet</button></div>' +
    '</div>');
    on('[data-back]', 'click', showMenu);
    on('#to-cab', 'click', function () { showCabinet(); });
    if (plinths.length) mountHall(app.querySelector('#hall'), plinths);
  }

  /**
   * Endless sideways hall: plinth number v (any whole number) shows plinths[v mod N] at x = v × width − offset,
   * so the list loops forever in both directions. Only the plinths on screen (plus one each side) exist in the page.
   * Drag anywhere (finger or mouse) to move; let go and it glides to a stop. Arrow keys and sideways trackpad scroll also work.
   */
  function mountHall(hall, plinths) {
    var track = hall.querySelector('.hall-track'), W = PLINTH_W, N = plinths.length;
    var nodes = {}, offset = 0, vel = 0, glide = null, drag = null;
    var mod = function (a, n) { return ((a % n) + n) % n; };
    var meIdx = -1; plinths.forEach(function (p, i) { if (p.me) meIdx = i; });

    function layout() {
      if (!hall.isConnected) return cleanup();
      var vw = hall.clientWidth, first = Math.floor(offset / W) - 1, last = Math.ceil((offset + vw) / W) + 1, keep = {};
      for (var v = first; v <= last; v++) {
        keep[v] = true;
        var n = nodes[v];
        if (!n) {
          n = document.createElement('div');
          n.className = 'plinth-slot';
          n.style.width = W + 'px';
          n.innerHTML = plinthHtml(plinths[mod(v, N)]);
          track.appendChild(n);
          nodes[v] = n;
        }
        n.style.transform = 'translate3d(' + (v * W - offset) + 'px,0,0)';
      }
      Object.keys(nodes).forEach(function (k) { if (!keep[k]) { nodes[k].remove(); delete nodes[k]; } });
    }
    function stopGlide() { if (glide) cancelAnimationFrame(glide); glide = null; }
    function glideTo(target) {
      stopGlide();
      (function step() {
        var d = target - offset;
        if (Math.abs(d) < 0.5) { offset = target; layout(); glide = null; return; }
        offset += d * 0.18; layout(); glide = requestAnimationFrame(step);
      })();
    }
    function coast() {
      stopGlide();
      var last = performance.now();
      (function step(now) {
        now = now || performance.now();
        var dt = Math.min(40, now - last); last = now;
        offset += vel * dt;
        vel *= Math.pow(0.94, dt / 16);
        layout();
        glide = Math.abs(vel) > 0.02 ? requestAnimationFrame(step) : null;
      })();
    }

    hall.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button > 0) return;
      stopGlide();
      drag = { id: e.pointerId, x: e.clientX, t: performance.now() };
      vel = 0;
      hall.classList.add('dragging');
      try { hall.setPointerCapture(e.pointerId); } catch (err) { /* older Safari */ }
    });
    hall.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var now = performance.now(), dx = e.clientX - drag.x, dt = Math.max(1, now - drag.t);
      offset -= dx;
      vel = 0.8 * (-dx / dt) + 0.2 * vel;
      drag.x = e.clientX; drag.t = now;
      layout();
    });
    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (performance.now() - drag.t > 80) vel = 0; // held still before letting go: no glide
      drag = null;
      hall.classList.remove('dragging');
      coast();
    }
    hall.addEventListener('pointerup', endDrag);
    hall.addEventListener('pointercancel', endDrag);
    hall.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical scrolling still scrolls the page
      e.preventDefault(); stopGlide(); offset += e.deltaX; layout();
    }, { passive: false });
    hall.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); glideTo(Math.round(offset / W) * W + W); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); glideTo(Math.round(offset / W) * W - W); }
    });
    function onResize() { layout(); }
    function cleanup() { stopGlide(); window.removeEventListener('resize', onResize); }
    window.addEventListener('resize', onResize);

    // Start with the student's own plinth (or the first one) in the middle.
    offset = (meIdx >= 0 ? meIdx : 0) * W + W / 2 - hall.clientWidth / 2;
    layout();
  }

  /* ---------- practice: 30 s, or 60 s on a level played but not yet fluent (server sends practiceSecs per level) ---------- */
  function showPracticeOps(fresh) {
    stopPolling();
    render('<div class="card" data-screen="ops">' + backBtn('Menu') + '<h2>Practice</h2><p class="muted">Choose an operation. A new level is 30 seconds. If you\'re not fluent yet, it\'s 60 seconds until you are, then 30 seconds after that.</p><div class="op-grid">' + opButtons() + '</div></div>');
    on('[data-back]', 'click', showMenu);
    onAll('[data-op]', 'click', function (b) { showPracticeLevels(b.getAttribute('data-op')); });
    if (!fresh) refreshProfile(function () { if (app.querySelector('[data-screen="ops"]')) showPracticeOps(true); });
  }

  function levelStatus(st, sum) {
    if (st.fluent) return '<span class="tag ok">✅ ' + st.time.toFixed(2) + ' s</span>';
    if (st.level === sum.current) return '<span class="tag cur">🎯 Your level' + (st.time !== null ? ' · ' + st.time.toFixed(2) + ' s' : '') + '</span>';
    if (st.time !== null) return '<span class="tag">' + st.time.toFixed(2) + ' s</span>';
    return '<span class="tag dim">Not tried</span>';
  }

  function showPracticeLevels(op) {
    var sum = S.session.profile[op];
    render('<div class="card">' + backBtn() + '<h2>' + opName(op) + '</h2>' +
      '<p class="muted">Tap a level to start. You\'re fluent at ' + sum.cutoff + ' s or faster per correct answer (your last try, or the average of your last 2 tries). Class games count too.</p>' +
      '<div class="level-list">' + sum.levels.map(function (st) {
        var info = Levels.info(op, st.level);
        return '<button class="level-btn' + (st.level === sum.current ? ' current' : '') + '" data-level="' + st.level + '">' +
          '<span class="lv-num">' + st.level + '</span>' +
          '<span class="lv-emoji">' + info.emoji + '</span>' +
          '<span class="lv-name">' + (info.tag ? '<b class="lv-tag">' + esc(info.tag) + '</b> ' : '') + esc(info.name) + '</span>' +
          levelStatus(st, sum) + '</button>';
      }).join('') + '</div></div>');
    on('[data-back]', 'click', showPracticeOps);
    onAll('[data-level]', 'click', function (b) { runPractice(op, Number(b.getAttribute('data-level'))); });
    var cur = app.querySelector('.level-btn.current'); if (cur) cur.scrollIntoView({ block: 'center' });
  }

  async function runPractice(op, level) {
    var lvSt = S.session.profile[op] && S.session.profile[op].levels[level - 1];
    var secs = (lvSt && lvSt.practiceSecs) || C.PRACTICE_SECONDS;
    var started = await Game.countdown(app, Date.now() + 3000, Date.now, '<h2 class="count-title">' + esc(Levels.title(op, level)) + '</h2><p class="muted center">⏱ ' + secs + ' seconds</p>');
    if (!started) return showPracticeLevels(op);
    var res = await Game.play(app, { op: op, level: level, endAt: Date.now() + secs * 1000, clock: Date.now, rules: S.session.rules, label: Levels.title(op, level) });
    if (res.quit) return showPracticeLevels(op); // leaving early doesn't save anything
    var saved = null, err = null;
    try {
      saved = await API.callRetry('practiceSubmit', { token: S.session.token, op: op, level: level, correct: res.correct, wrong: res.wrong, seconds: res.seconds });
      S.session.profile = saved.profile; saveSession();
    } catch (e) { err = e; if (e.code === 'SESSION_EXPIRED') return fail(e); }
    var st = S.session.profile[op].levels[level - 1], sum = S.session.profile[op];
    // Same rule as the server: (seconds + penalty) / correct. Use the server's figure when the game was saved.
    var each = saved && saved.saved ? saved.avgTime : res.correct ? (res.seconds + (res.penalty || 0)) / res.correct : null;
    render('<div class="card temple narrow center">' +
      '<h2>' + (res.correct ? 'Well fought!' : 'Keep training!') + '</h2>' +
      '<p class="muted">' + esc(Levels.label(op, level)) + '</p>' +
      '<div class="stat-grid">' +
        '<div><b>' + res.correct + '</b><span>correct</span></div><div><b>' + res.wrong + '</b><span>wrong</span></div>' +
        '<div><b>' + (each !== null ? each.toFixed(2) + ' s' : '—') + '</b><span>per correct</span></div><div><b>' + (res.penalty ? '+' + res.penalty + ' s' : '0 s') + '</b><span>penalty</span></div>' +
      '</div>' +
      (err ? '<p class="warn">Couldn\'t save this game: ' + esc(err.message) + '</p>' :
        !saved.saved ? '<p class="muted">This game was too short to save.</p>' :
        '<p>' + (st.fluent ? '✅ You are <b>fluent</b> at this level (' + st.time.toFixed(2) + ' s)!' :
          'Your fluency time here: <b>' + st.time.toFixed(2) + ' s</b> (goal: ' + sum.cutoff + ' s or faster)') + '</p>') +
      '<div class="choice-row"><button class="btn primary" id="again">Play again</button><button class="btn" id="lvls">Levels</button><button class="btn ghost" id="menu">Menu</button></div></div>');
    on('#again', 'click', function () { runPractice(op, level); });
    on('#lvls', 'click', function () { showPracticeLevels(op); });
    on('#menu', 'click', showMenu);
  }

  /* ---------- my levels ---------- */
  function showProfile(op) {
    stopPolling();
    var draw = function () {
      var sum = S.session.profile[op];
      var dust = rules().dustPerWeek !== undefined ? rules().dustPerWeek : 0.2;
      render('<div class="card">' + backBtn('Menu') + '<h2>My levels</h2>' +
        '<div class="tabs">' + Levels.ORDER.map(function (o) { return '<button class="tab' + (o === op ? ' active' : '') + '" data-op="' + o + '">' + Levels.OPS[o].symbol + ' ' + opName(o) + '</button>'; }).join('') + '</div>' +
        '<p class="big-line">' + (sum.mastered ? '🏆 You are fluent at every level!' : 'You are on <b>Level ' + sum.current + ': ' + esc(Levels.title(op, sum.current)) + '</b>') + '</p>' +
        '<p class="muted">Fluent = ' + sum.cutoff + ' s or faster. Dust 🧹 adds ' + dust + ' s each week you don\'t play a level. Play it once (practice or class game) to clean it all off.</p>' +
        '<div class="table-wrap"><table class="lv-table"><thead><tr><th>Level</th><th>Average</th><th>Dust</th><th>Fluency time</th><th></th></tr></thead><tbody>' +
        sum.levels.map(function (st) {
          return '<tr class="' + (st.level === sum.current && !sum.mastered ? 'current' : '') + '">' +
            '<td><b>' + st.level + '</b> ' + esc(Levels.title(op, st.level)) + '</td>' +
            '<td>' + (st.avg !== null ? st.avg.toFixed(2) + ' s' : '—') + '</td>' +
            '<td>' + (st.dust ? '🧹 +' + st.dust.toFixed(1) + ' s' : '') + '</td>' +
            '<td>' + (st.time !== null ? '<b>' + st.time.toFixed(2) + ' s</b>' : '—') + '</td>' +
            '<td>' + (st.fluent ? '✅' : st.level === sum.current ? '🎯' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>');
      on('[data-back]', 'click', showMenu);
      onAll('[data-op]', 'click', function (b) { op = b.getAttribute('data-op'); draw(); });
    };
    draw();
    refreshProfile(function () { if (app.querySelector('.lv-table')) draw(); });
  }

  /* ---------- class game (multiplayer) ---------- */
  var LEAVE_DONE_MSG = 'You\'re about to leave the lobby.\n\nAre all the rounds finished? Press OK only if they are.';
  var LEAVE_MSG = LEAVE_DONE_MSG + '\n\nYour score for this round won\'t count.';

  function showMultiplayer() {
    stopPolling();
    var mp = S.mp = { playedRound: null, doneRound: null, resultsRound: null, view: '' };
    loading('Entering the arena…');
    var join = function () {
      if (S.mp !== mp) return;
      API.call('joinRoom', { token: S.session.token }).then(function (r) { if (S.mp === mp) handleRoom(r.room); }).catch(function (e) {
        if (S.mp !== mp) return;
        if (e.code === 'NO_ROOM' || e.code === 'ROOM_CLOSED') {
          if (mp.view !== 'noroom') {
            mp.view = 'noroom';
            render('<div class="card temple narrow center"><div class="big-emoji">🏛️</div><h2>The arena gates are closed</h2>' +
              '<p>Your teacher hasn\'t opened a class game yet. Stay on this screen and you\'ll walk in as soon as it opens.</p>' +
              '<button class="btn ghost" id="leave">← Menu</button></div>');
            on('#leave', 'click', showMenu);
          }
          S.timer = setTimeout(join, C.NO_ROOM_POLL_MS + Math.random() * C.POLL_JITTER_MS);
        } else if (e.network) { S.timer = setTimeout(join, C.NO_ROOM_POLL_MS); }
        else fail(e);
      });
    };
    join();
  }

  function poll(ms) {
    var mp = S.mp;
    clearTimeout(S.timer);
    S.timer = setTimeout(function () {
      API.call('roomState', { token: S.session.token }).then(function (r) { if (S.mp === mp) handleRoom(r.room); }).catch(function (e) {
        if (S.mp !== mp) return;
        if (e.code === 'ROOM_CLOSED') { roomClosed(); }
        else if (e.code === 'SESSION_EXPIRED') fail(e);
        else poll(Math.min(ms * 1.5, 15000));
      });
    }, ms + Math.random() * C.POLL_JITTER_MS);
  }

  /** Leave the room on purpose: tell the server (so the teacher isn't kept waiting), then go to the menu. */
  function leaveRoom() {
    API.call('leaveRoom', { token: S.session.token }).catch(function () {});
    showMenu();
  }

  /** Leave buttons once a round has been played: check all the rounds are finished first. */
  function askLeave() { if (window.confirm(LEAVE_DONE_MSG)) leaveRoom(); }

  function roomClosed() {
    S.mp = null;
    render('<div class="card temple narrow center"><div class="big-emoji">🏛️</div><h2>The class game has finished</h2><button class="btn primary" id="menu">Back to menu</button></div>');
    on('#menu', 'click', showMenu);
  }

  function setView(key, html, bind) {
    if (S.mp.view === key) return;
    S.mp.view = key; render(html); if (bind) bind();
  }

  /** Strip shown on every class-game waiting screen so students know they're in the room. */
  function inRoomBanner(text) { return '<div class="in-room"><span class="dot"></span>' + esc(text) + '</div>'; }

  function handleRoom(room) {
    var mp = S.mp;
    if (!mp) return;
    if (!room.joined) { // removed by teacher, dropped after going quiet (e.g. iPad slept), or a new room was opened
      return API.call('joinRoom', { token: S.session.token }).then(function (r) { if (S.mp === mp) { handleRoom(r.room); } }).catch(function () { roomClosed(); });
    }
    var g = room.game;
    if (room.status === 'lobby') {
      setView('lobby' + room.round,
        '<div class="card temple narrow center lobby">' + inRoomBanner('You\'re in the game room') +
          '<div class="bolt-wait" aria-hidden="true">⚡</div>' +
          '<h2>You\'re in the arena!</h2>' +
          '<p>Waiting for your teacher to start the game…</p>' +
          '<p class="count-line" data-count></p>' +
          '<p class="muted small">Keep this screen open. The game starts by itself.</p>' +
          '<button class="btn ghost" id="leave">← Leave the room</button></div>',
        function () { on('#leave', 'click', room.round > 0 ? askLeave : leaveRoom); });
      var c = app.querySelector('[data-count]'); if (c) c.textContent = room.playerCount + ' player' + (room.playerCount === 1 ? '' : 's') + ' in the room';
      return poll(C.LOBBY_POLL_MS);
    }
    if (room.status === 'playing') {
      if (!g.inGame) {
        setView('spectate' + room.round, '<div class="card temple narrow center">' + inRoomBanner('You\'re in the game room') +
          '<div class="big-emoji">🍿</div><h2>A round is already running</h2><p>You\'ll be in the next round.</p>' +
          '<button class="btn ghost" id="leave">← Leave the room</button></div>', function () { on('#leave', 'click', room.round > 1 ? askLeave : leaveRoom); });
        return poll(C.RESULTS_POLL_MS);
      }
      if (room.submitted || mp.doneRound === room.round) { waiting(); return poll(C.RESULTS_POLL_MS); }
      if (mp.playedRound !== room.round) { mp.playedRound = room.round; return runClassGame(room); }
      return poll(C.RESULTS_POLL_MS);
    }
    if (room.status === 'results') {
      if (mp.resultsRound !== room.round) {
        mp.resultsRound = room.round; mp.view = 'results' + room.round;
        render('<div class="card wide" id="res"></div><div class="center after-results">' + inRoomBanner('Still in the game room. Waiting for the next round…') +
          '<button class="btn ghost" id="leave">← Leave the room</button></div>');
        Celebrate.results(app.querySelector('#res'), { teams: room.results.teams, myTeam: room.results.myTeam, me: room.results.me,
                                                       penalty: rules().wrongPenaltySec, odds: ladder() });
        bindDecisions(app, decidedOnResults);
        on('#leave', 'click', askLeave);
        if (room.results.me && room.results.me.trophy) {
          // Show the meter straight away, then again with this round's result counted.
          fillFluency();
          var round = room.round;
          refreshProfile(function () { if (S.mp === mp && mp.resultsRound === round) fillFluency(); });
        }
      }
      return poll(C.RESULTS_POLL_MS);
    }
  }

  function waiting(res) {
    setView('waiting', '<div class="card temple narrow center">' + inRoomBanner('You\'re in the game room') +
      '<div class="big-emoji spin">⏳</div><h2>Time\'s up!</h2>' +
      (res ? '<p>You got <b>' + res.correct + '</b> correct.</p>' : '') + '<p>Waiting for everyone\'s results…</p></div>');
  }

  async function runClassGame(room) {
    var mp = S.mp, g = room.game;
    clearTimeout(S.timer); // no polling while playing
    var teamHtml = g.individual
      ? '<div class="team-reveal" style="--team:' + g.team.hex + '"><span>' + g.team.emoji + '</span><div>You are the <b>' + esc(g.team.name) + '</b><small>Solo round</small></div></div>'
      : '<div class="team-reveal" style="--team:' + g.team.hex + '"><span>' + g.team.emoji + '</span><div>You\'re on the <b>' + esc(g.team.name) + '</b><small>' + g.team.size + ' players. Your teammates are a secret 🤫</small></div></div>';
    var above = teamHtml + '<p class="lv-line">' + opName(g.op) + ': ' + esc(Levels.label(g.op, g.level)) + '</p>';
    if (API.now() < g.startAt) {
      var started = await Game.countdown(app, g.startAt, API.now, above, LEAVE_MSG);
      if (!started) return leaveRoom();
    }
    if (S.mp !== mp) return;
    var res;
    if (API.now() >= g.endAt) res = { correct: 0, wrong: 0, penalty: 0, seconds: 0 };
    else res = await Game.play(app, { op: g.op, level: g.level, endAt: g.endAt, clock: API.now, rules: S.session.rules,
                                      label: g.team.emoji + ' ' + g.team.name + ' · ' + Levels.title(g.op, g.level), quitConfirm: LEAVE_MSG });
    if (res.quit) return leaveRoom(); // left mid-round: no score is sent
    if (S.mp !== mp) return;
    mp.doneRound = room.round;
    mp.view = '';
    waiting(res);
    try {
      var r = await API.callRetry('submitResult', { token: S.session.token, round: room.round, correct: res.correct, wrong: res.wrong, seconds: res.seconds });
      if (S.mp === mp) handleRoom(r.room);
    } catch (e) {
      if (S.mp !== mp) return;
      if (e.code === 'ROOM_CLOSED') return roomClosed();
      toast('Could not send your result: ' + e.message);
      poll(C.RESULTS_POLL_MS);
    }
  }

  /* ---------- start ---------- */
  try { S.session = JSON.parse(store.getItem(KEY)); } catch (e) { S.session = null; }
  if (S.session && S.session.token) {
    // A freshly loaded page always opens on the menu, never the class-game screen. If this iPad was in the
    // game room before a reload, take it out now so the teacher doesn't see (or team up) a student who isn't there.
    API.call('leaveRoom', { token: S.session.token }).catch(function () {});
    showMenu();
  } else showLogin();
})();
