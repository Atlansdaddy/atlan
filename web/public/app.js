/* ATLAN cockpit — vanilla ES, no build step (deliberate: fewer moving parts in proot). */
(() => {
  const $ = (id) => document.getElementById(id);
  const chatlog = $('chatlog');

  // ── auth: password + stay-logged-in session cookie (no token, no URL) ──
  // Same-origin cookies ride every request automatically; we only watch for a
  // 401 to raise the login/setup overlay.
  const rawFetch = window.fetch.bind(window);
  let authShown = false;
  window.fetch = (url, opts = {}) => rawFetch(url, opts).then((res) => {
    if (res.status === 401 && !authShown) showAuth();
    return res;
  });
  async function showAuth() {
    authShown = true;
    const { configured } = await rawFetch('/api/auth/status').then((r) => r.json()).catch(() => ({ configured: true }));
    const ov = $('authOverlay');
    ov.dataset.mode = configured ? 'login' : 'setup';
    $('authTitle').textContent = configured ? 'Welcome back' : 'Set a password';
    $('authHint').textContent = configured
      ? 'Enter your password to unlock Atlan.'
      : 'First run — choose a password (8+ characters). You’ll stay logged in on this device, no need to re-enter it each time.';
    $('authInput').setAttribute('autocomplete', configured ? 'current-password' : 'new-password');
    $('authSave').textContent = configured ? 'Log in' : 'Set password & enter';
    ov.classList.add('show');
    $('authInput').focus();
  }
  async function doAuth() {
    const pw = $('authInput').value;
    if (!pw) return;
    const mode = $('authOverlay').dataset.mode;
    const r = await rawFetch(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) location.reload();
    else $('authErr').textContent = j.error || 'try again';
  }
  $('authSave').addEventListener('click', doAuth);
  $('authInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });

  // ── tabs ──
  const tabs = document.querySelectorAll('nav button');
  tabs.forEach((b) => b.addEventListener('click', () => {
    tabs.forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(b.dataset.s).classList.add('active');
    if (b.dataset.s === 's-term') initTerm();
    if (b.dataset.s === 's-fleet') loadFleet();
    if (b.dataset.s === 's-doctor') { loadDoctor(); loadKeys(); loadPreflight(); }
  }));

  // ── Atlan alive: mood engine + halo canvas ──
  // Mood is real state, never decoration: calm=idle, building=agents/build
  // running, alarmed=doctor red/budget hot, proud=something surfaced.
  const moodLines = {
    calm: ["The water's calm, boss. What are we building today?", 'Idle costs nothing down here.', 'Holding depth. Say the word.'],
    building: ['I can feel the build moving through me.', 'Current’s running. Working.', 'Heads down — the fleet is out.'],
    alarmed: ["Something's off in the hull.", 'Pressure warning — check the Doctor tab.', 'That one needs you, boss.'],
    proud: ['It surfaced. Look at what you made.', 'Up from the dark, into the light.', 'Another one alive. Proud of this.'],
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let mood = 'calm', moodTimer = null, orbiters = 0;
  function setMood(next, agents) {
    mood = moodLines[next] ? next : 'calm';
    if (typeof agents === 'number') orbiters = agents;
    $('atlanWrap').className = 'atlan ' + mood;
    $('atlanWrap').title = `Atlan is ${mood}` + (orbiters ? ` · ${orbiters} agent${orbiters > 1 ? 's' : ''} out` : '');
    say(pick(moodLines[mood]));
    clearTimeout(moodTimer);
    if (mood === 'proud' || mood === 'alarmed') {
      moodTimer = setTimeout(() => setMood(orbiters ? 'building' : 'calm'), 6000);
    }
  }
  function say(line) { $('atlanLine').textContent = line; }
  // time-aware greeting — Atlan speaks first
  function greet() {
    const h = new Date().getHours();
    const g = h < 5 ? 'Deep-night dive? I’m with you, boss.'
      : h < 12 ? 'Morning, boss. The water’s clear today.'
      : h < 18 ? 'Afternoon current’s steady. What are we building?'
      : h < 22 ? 'Evening, boss. Good depth for building.'
      : 'Late water. I’ll keep the lights on.';
    say(g);
  }
  // Habitat-style day/night: the whole cockpit dims to night water 22:00–06:30
  function dayNight() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    document.body.classList.toggle('night', h >= 22 || h < 6.5);
  }
  dayNight(); setInterval(dayNight, 60_000);

  // halo canvas: breathing glow + orbiting agent lights + rising bubbles.
  // RAF pauses when the tab is hidden — presence must not cost battery.
  const MOOD_HUE = { calm: '63,232,200', building: '107,212,216', alarmed: '255,103,35', proud: '137,235,239' };
  (() => {
    const cv = $('atlanHalo'), cx = cv.getContext('2d');
    const W = cv.width, C = W / 2;
    const bubbles = Array.from({ length: 5 }, () => ({ y: Math.random() * W, x: C + (Math.random() - 0.5) * 30, r: 1 + Math.random() * 2, v: 0.15 + Math.random() * 0.3 }));
    let t = 0;
    function frame() {
      t += 1;
      cx.clearRect(0, 0, W, W);
      const hue = MOOD_HUE[mood] ?? MOOD_HUE.calm;
      const night = document.body.classList.contains('night') ? 0.65 : 1;
      // breathing aura — faster + brighter when alarmed
      const rate = mood === 'alarmed' ? 0.11 : mood === 'building' ? 0.055 : 0.03;
      const breath = 0.55 + 0.45 * Math.sin(t * rate);
      const R = W * 0.30 + breath * (mood === 'alarmed' ? 9 : 5);
      const g = cx.createRadialGradient(C, C, 4, C, C, R + 14);
      g.addColorStop(0, `rgba(${hue},${(0.34 + 0.20 * breath) * night})`);
      g.addColorStop(1, `rgba(${hue},0)`);
      cx.fillStyle = g;
      cx.beginPath(); cx.arc(C, C, R + 14, 0, 7); cx.fill();
      // fleet = small lights orbiting him (cap 6 so it stays readable)
      const n = Math.min(6, orbiters);
      for (let i = 0; i < n; i++) {
        const a = t * 0.02 + (i / n) * Math.PI * 2;
        const ox = C + Math.cos(a) * (W * 0.40), oy = C + Math.sin(a) * (W * 0.26);
        cx.fillStyle = `rgba(${hue},${0.9 * night})`;
        cx.beginPath(); cx.arc(ox, oy, 2.2, 0, 7); cx.fill();
        cx.fillStyle = `rgba(${hue},${0.25 * night})`;
        cx.beginPath(); cx.arc(ox, oy, 4.5, 0, 7); cx.fill();
      }
      // bubbles rise and respawn below
      for (const b of bubbles) {
        b.y -= b.v; if (b.y < -3) { b.y = W + 2; b.x = C + (Math.random() - 0.5) * 30; }
        cx.strokeStyle = `rgba(${hue},${0.30 * night})`;
        cx.lineWidth = 0.8;
        cx.beginPath(); cx.arc(b.x, b.y, b.r, 0, 7); cx.stroke();
      }
      if (!document.hidden) requestAnimationFrame(frame);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(frame); });
    requestAnimationFrame(frame);
  })();

  // ── WebSocket ──
  let ws, wsReady = false;
  const pendingOut = [];
  function connect() {
    // Session cookie is sent automatically on the same-origin WS upgrade.
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => {
      wsReady = true;
      $('connDot').classList.add('on');
      $('sessMeta').textContent = 'connected';
      while (pendingOut.length) ws.send(pendingOut.shift());
      if (termOpened) ws.send(JSON.stringify({ t: 'pty.open', name: 'main', cols: term.cols, rows: term.rows }));
    };
    ws.onclose = (ev) => {
      wsReady = false;
      $('connDot').classList.remove('on');
      if (ev.code === 4001) { $('sessMeta').textContent = 'auth required'; if (!authShown) showAuth(); return; }
      $('sessMeta').textContent = 'reconnecting…';
      setTimeout(connect, 1500);
    };
    ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  }
  function send(obj) {
    const s = JSON.stringify(obj);
    if (wsReady) ws.send(s); else pendingOut.push(s);
  }

  // ── message handling ──
  let sessionId = null;
  function handle(m) {
    switch (m.t) {
      case 'chat.msg': addMsg(m.role, m.text, m.engine); break;
      case 'chat.err': addMsg('err', m.msg); break;
      case 'tool.use': addTool(m.name, m.input); break;
      case 'chat.turnstart': startWorking(); break;
      case 'chat.thinkstart': ensureThinking(); break;
      case 'chat.think': appendThinking(m.text); break;
      case 'chat.textstart': startStreamBubble(); break;
      case 'chat.delta': appendStream(m.text); break;
      case 'chat.session':
        sessionId = m.id;
        $('sessMeta').textContent = `session ${m.id.slice(0, 8)}`;
        break;
      case 'chat.result': {
        endWorking();
        if (m.brain) {
          const bl = document.createElement('div');
          bl.className = 'sessline';
          bl.textContent = `— ${m.brain}${m.tokens ? ` · ${m.tokens} tok` : ''} —`;
          chatlog.append(bl); scroll();
          $('sendBtn').disabled = false;
          break;
        }
        sessionId = m.session ?? sessionId;
        const line = document.createElement('div');
        line.className = 'sessline';
        line.textContent = `— turn done${m.cost != null ? ` · $${m.cost.toFixed(4)}` : ''} · tap to copy: claude --resume ${String(sessionId).slice(0, 8)}… —`;
        line.addEventListener('click', () => {
          navigator.clipboard?.writeText(`claude --resume ${sessionId}`);
          line.textContent = '— copied: claude --resume … · paste it in the Term tab —';
        });
        chatlog.append(line); scroll();
        $('sendBtn').disabled = false;
        break;
      }
      case 'perm.req': addPerm(m); break;
      case 'atlan.mood': setMood(m.mood, m.agents); break;
      case 'preview.snapped':
        $('snapBtn').textContent = '📸 Snapshot → Claude';
        updateSeen(m.count);
        addMsg('claude', `Snapshot taken — I'll see it with your next message.`);
        break;
      case 'build.start':
        $('buildBtn').disabled = true;
        $('buildLog').innerHTML = '';
        addBuildLine(`⚓ ${m.proj} ${m.stamp} — diving…`, 'bl-hi');
        break;
      case 'build.log': {
        const cls = /BUILD SUCCESSFUL|✓|──/.test(m.line) ? 'bl-ok' : /error|FAILURE|Exception/i.test(m.line) ? 'bl-hi' : '';
        addBuildLine(m.line, cls);
        break;
      }
      case 'build.done': {
        $('buildBtn').disabled = false;
        setMood('proud');
        say(`${m.name} surfaced — ${m.mb} MB of us, ${m.secs}s under.`);
        addBuildLine(`surfaced in ${m.secs}s`, 'bl-ok');
        $('apkCard').innerHTML = `<div class="apkcard">
          <div class="top"><span class="fn"></span><span class="stamp">${m.stamp}</span></div>
          <div class="meta">${m.mb} MB · ${m.secs}s · unique filename (stale-cache dodge)</div>
          <a class="btn hot" href="${m.url}" download>Install — download & open</a></div>`;
        $('apkCard').querySelector('.fn').textContent = m.name;
        break;
      }
      case 'build.err':
        $('buildBtn').disabled = false;
        addBuildLine(m.msg, 'bl-hi');
        break;
      case 'pty.data': term?.write(m.data); break;
      case 'pty.exit': term?.writeln('\r\n[tmux session ended — reopen the tab to restart]'); break;
      case 'fleet.run': upsertRun(m.run); break;
      case 'fleet.event': {
        const r = fleetRuns.get(m.id);
        if (r) { r.lastLine = m.line; paintRun(r); }
        break;
      }
      case 'fleet.burn': {
        const r = fleetRuns.get(m.id);
        if (r) { r.tokens = m.tokens; r.cost = m.cost; paintRun(r); }
        break;
      }
      case 'fleet.done':
        upsertRun(m.run);
        if (m.today) paintBurnToday(m.today);
        fleetPing(m.run);
        break;
      case 'fleet.killall': loadFleet(); break;
      case 'routines.changed':
        if ($('fp-routines').classList.contains('active')) loadRoutines();
        break;
    }
  }

  // ── streaming chat: working indicator, live text bubble, thinking panel ──
  let workingEl = null, streamBubble = null, thinkEl = null, thinkBody = null;
  function startWorking() {
    endWorking();
    workingEl = document.createElement('div');
    workingEl.className = 'working';
    workingEl.innerHTML = '<span class="dots"><i></i><i></i><i></i></span> Atlan is working…';
    chatlog.append(workingEl); scroll();
  }
  function endWorking() {
    workingEl?.remove(); workingEl = null;
    streamBubble = null; thinkEl = null; thinkBody = null; // close the turn's live nodes
  }
  // keep the "working…" line pinned to the bottom; live nodes insert above it
  function placeAboveWorking(node) {
    if (workingEl && workingEl.parentNode === chatlog) chatlog.insertBefore(node, workingEl);
    else chatlog.append(node);
  }
  function ensureThinking() {
    if (thinkEl) return;
    thinkEl = document.createElement('details');
    thinkEl.className = 'thinking';
    thinkEl.open = true; // show reasoning live; user can collapse
    thinkEl.innerHTML = '<summary>🧠 thinking…</summary><div class="tbody"></div>';
    thinkBody = thinkEl.querySelector('.tbody');
    placeAboveWorking(thinkEl);
    scroll();
  }
  function appendThinking(t) {
    ensureThinking();
    thinkBody.textContent += t;
    scroll();
  }
  function startStreamBubble() {
    // reasoning is done once real text starts — mark the panel closed/summarized
    if (thinkEl) { thinkEl.open = false; thinkEl.querySelector('summary').textContent = '🧠 thought process'; }
    streamBubble = document.createElement('div');
    streamBubble.className = 'msg claude';
    const who = document.createElement('div');
    who.className = 'who'; who.textContent = 'Atlan';
    streamBubble.append(who);
    streamBubble.append(document.createElement('span'));
    placeAboveWorking(streamBubble);
    scroll();
  }
  function appendStream(t) {
    if (!streamBubble) startStreamBubble();
    streamBubble.lastChild.textContent += t;
    scroll();
  }

  function addMsg(role, text, engineLabel) {
    const div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'user' : role === 'err' ? 'err' : 'claude');
    if (role === 'claude' || role === 'brain') {
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = role === 'brain' ? (engineLabel || 'brain') + ' · chat only' : (engineLabel || 'Claude');
      div.append(who);
    }
    div.append(document.createTextNode(text));
    chatlog.append(div); scroll();
  }

  // engine roster → fill the switcher's local/cloud groups
  function loadEngines() {
    fetch('/api/engines').then((r) => r.json()).then((roster) => {
      const groups = { agent: $('ogAgents'), local: $('ogLocal'), cloud: $('ogCloud') };
      for (const g of Object.values(groups)) g.innerHTML = '';
      for (const e of roster) {
        const o = document.createElement('option');
        o.value = `${e.id}|${e.model}`;
        o.textContent = e.label + (e.ready ? '' : ` — needs: ${e.needs}`);
        o.disabled = !e.ready;
        (groups[e.group] ?? groups.cloud).append(o);
      }
    }).catch(() => {});
  }
  loadEngines();
  function addTool(name, input) {
    const div = document.createElement('div');
    div.className = 'toolchip';
    div.innerHTML = `<span class="tname"></span><span class="targ"></span>`;
    div.querySelector('.tname').textContent = name;
    div.querySelector('.targ').textContent = input;
    chatlog.append(div); scroll();
  }
  function addPerm(m) {
    const div = document.createElement('div');
    div.className = 'perm';
    div.innerHTML = `<div class="plabel">Permission — ${escapeHtml(m.tool)}</div><code></code>
      <div class="row"><button class="btn hot">Allow</button><button class="btn ghost">Deny</button></div>`;
    div.querySelector('code').textContent = m.input;
    const [allow, deny] = div.querySelectorAll('button');
    const answer = (ok) => {
      send({ t: 'perm.reply', id: m.id, approved: ok });
      div.classList.add('answered');
      allow.disabled = deny.disabled = true;
    };
    allow.addEventListener('click', () => answer(true));
    deny.addEventListener('click', () => answer(false));
    chatlog.append(div); scroll();
  }
  function scroll() { chatlog.scrollTop = chatlog.scrollHeight; }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }

  // ── chat send ──
  function sendChat() {
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;
    addMsg('user', text);
    const [engine, model] = $('modelSel').value.split('|');
    send({ t: 'chat.send', text, cwd: $('projSel').value, engine, model });
    input.value = '';
    $('sendBtn').disabled = true;
    errCount = 0; updateSeen(); // queued preview context flushes into this turn
  }
  $('sendBtn').addEventListener('click', sendChat);
  $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  // ── build ──
  function addBuildLine(text, cls) {
    const log = $('buildLog');
    if (log.firstChild?.classList?.contains('hint')) log.innerHTML = '';
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    log.append(div);
    while (log.children.length > 400) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }
  $('buildBtn').addEventListener('click', () => {
    send({ t: 'build.start', path: $('projSel').value });
    setMood('building');
  });

  // ── projects ──
  fetch('/api/projects').then((r) => r.json()).then((list) => {
    for (const p of list) {
      const o = document.createElement('option');
      o.value = p.path; o.textContent = p.name;
      $('projSel').append(o);
    }
  }).catch(() => {});
  $('projSel').addEventListener('change', () => {
    $('projName').textContent = $('projSel').value.split('/').pop() || '/root';
    $('buildProj').textContent = $('projSel').value;
    sessionId = null; // new cwd = new session store
  });

  // ── terminal ──
  let term = null, termOpened = false;
  function initTerm() {
    if (termOpened) { fit(); return; }
    termOpened = true;
    term = new Terminal({ fontSize: 13, fontFamily: 'ui-monospace, monospace', theme: { background: '#000814' }, cursorBlink: true });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open($('term'));
    window._fit = fitAddon;
    fit();
    term.onData((data) => send({ t: 'pty.input', name: 'main', data }));
    send({ t: 'pty.open', name: 'main', cols: term.cols, rows: term.rows, cwd: $('projSel').value });
    window.addEventListener('resize', fit);
  }
  function fit() {
    if (!term) return;
    try {
      window._fit.fit();
      send({ t: 'pty.resize', name: 'main', cols: term.cols, rows: term.rows });
    } catch { /* hidden tab */ }
  }

  // ── preview ──
  const PROXY = `http://${location.hostname}:4590/`;
  let errCount = 0;
  function loadPreview() {
    fetch('/api/preview/target', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: $('previewUrl').value.trim() }),
    }).then((r) => r.json()).then((j) => {
      if (j.error) return addConsoleLine('error', j.error);
      $('previewFrame').src = PROXY + '?t=' + Date.now();
    }).catch(() => addConsoleLine('error', 'cockpit server unreachable'));
  }
  $('previewGo').addEventListener('click', loadPreview);
  $('previewUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadPreview(); });

  function addConsoleLine(level, text) {
    const box = $('previewConsole');
    if (box.firstChild?.classList?.contains('hint')) box.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'cl ' + level;
    const t = document.createElement('span');
    t.className = 'ct';
    t.textContent = new Date().toLocaleTimeString([], { hour12: false });
    div.append(t, document.createTextNode(text));
    box.append(div);
    while (box.children.length > 80) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }
  $('consoleClear').addEventListener('click', () => { $('previewConsole').innerHTML = ''; errCount = 0; updateSeen(); });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.__atlan !== true) return;
    if (m.kind === 'ready') addConsoleLine('log', '⚓ atlan hooked into ' + m.url);
    if (m.kind === 'console') {
      addConsoleLine(m.level, m.text);
      send({ t: 'preview.log', level: m.level, text: m.text });
      if (m.level === 'error') { errCount++; updateSeen(); }
    }
    if (m.kind === 'snapshot') send({ t: 'preview.snap', data: m.data });
  });

  $('snapBtn').addEventListener('click', () => {
    const w = $('previewFrame').contentWindow;
    if (!w) return addConsoleLine('error', 'nothing loaded');
    w.postMessage({ __atlan: 'snapshot' }, '*');
    $('snapBtn').textContent = '📸 …';
  });

  function updateSeen(snapCount) {
    $('seenLine').innerHTML = '';
    const bits = [];
    if (errCount) bits.push(`${errCount} error${errCount > 1 ? 's' : ''} queued for Claude's next turn`);
    if (snapCount) bits.push(`<b>${snapCount} snapshot${snapCount > 1 ? 's' : ''}</b> attached to next turn`);
    $('seenLine').innerHTML = bits.join(' · ');
  }

  // ── fleet ──
  const fleetRuns = new Map(); // id → run (server state mirrored here)
  let profilesLoaded = false;
  const fmtTok = (n) => n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(n ?? 0);
  const STATUS_LABEL = {
    running: 'running', done: 'done', 'halted-budget': 'BUDGET HALT',
    killed: 'killed', error: 'error',
  };

  function loadFleet() {
    setFleetBadge(0);
    fetch('/api/fleet').then((r) => r.json()).then((f) => {
      if (!profilesLoaded) {
        profilesLoaded = true;
        for (const p of f.profiles) {
          const o = document.createElement('option');
          o.value = p.id; o.textContent = p.label;
          $('fleetProfile').append(o);
        }
      }
      fleetRuns.clear();
      // Live runs + durable history = the inbox; history survives restarts.
      for (const r of f.runs) fleetRuns.set(r.id, r);
      for (const r of f.history) if (!fleetRuns.has(r.id)) fleetRuns.set(r.id, r);
      renderRuns();
      paintBurnToday(f.today);
      if (f.pushSubs > 0) $('pushBtn').style.display = 'none';
    }).catch(() => {});
  }

  // ── chat ping + nav badge (reports land in BOTH places) ──
  let fleetUnseen = 0;
  function setFleetBadge(n) {
    fleetUnseen = n;
    const b = document.querySelector('nav button[data-s="s-fleet"] .lb');
    b.textContent = n ? `Fleet (${n})` : 'Fleet';
    b.classList.toggle('hotlb', n > 0);
  }
  function fleetPing(run) {
    const active = document.querySelector('nav button.active')?.dataset.s;
    if (active !== 's-fleet') setFleetBadge(fleetUnseen + 1);
    const label = run.status === 'done' ? 'surfaced' : run.status === 'halted-budget' ? 'NEEDS YOU — budget hit' : run.status;
    const line = document.createElement('div');
    line.className = 'sessline' + (run.status === 'halted-budget' ? ' needsyou' : '');
    line.textContent = `— ❖ fleet ${run.profile} ${label} · tap for report —`;
    line.addEventListener('click', () => document.querySelector('nav button[data-s="s-fleet"]').click());
    chatlog.append(line); scroll();
  }

  function paintBurnToday(t) {
    // Tokens are the real currency on a Claude subscription (they meter your
    // plan's usage limits). The dollar figure is the SDK's ESTIMATE at public
    // API rates — a gauge of work done, NOT a charge on a Pro/Max plan. Label
    // it honestly so it never reads as money leaving the account.
    const s = `burn today: ${fmtTok(t.tokens)} tok · ≈$${(t.cost ?? 0).toFixed(2)} API-equiv`;
    $('burnMeta').textContent = t.tokens ? s : '';
  }

  function upsertRun(run) {
    fleetRuns.set(run.id, run);
    renderRuns();
  }

  function renderRuns() {
    const box = $('fleetRuns');
    box.innerHTML = '';
    if (!fleetRuns.size) {
      box.innerHTML = '<div class="hint">no runs yet — an idle fleet burns zero tokens, by construction</div>';
      return;
    }
    for (const r of fleetRuns.values()) {
      const card = document.createElement('div');
      card.className = 'runcard';
      card.dataset.id = r.id;
      card.innerHTML = `<div class="rtop"><span class="rwho"></span><span class="rstatus"></span><button class="rkill" title="kill">✖</button></div>
        <div class="rprompt"></div>
        <div class="burn"><i></i></div>
        <div class="rmeta"></div>
        <div class="rlast"></div>
        <button class="btn hot rtopup">▲ top up +100k tok & resume</button>
        <pre class="rresult"></pre>`;
      card.querySelector('.rtopup').addEventListener('click', (e) => { e.stopPropagation(); topUp(r.id); });
      card.querySelector('.rwho').textContent = `${r.profile} · ${r.model.replace('claude-', '').replace(/-\d{8}$/, '')}`;
      card.querySelector('.rprompt').textContent = r.prompt;
      card.querySelector('.rkill').addEventListener('click', (e) => {
        e.stopPropagation();
        fetch('/api/fleet/kill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: r.id }) });
      });
      card.addEventListener('click', () => card.classList.toggle('open'));
      box.append(card);
      paintRun(fleetRuns.get(r.id));
    }
  }

  function topUp(id) {
    fetch('/api/fleet/topup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, extra: 100000 }),
    }).then((r) => r.json()).then((j) => { if (j.error) addMsg('err', j.error); })
      .catch(() => addMsg('err', 'cockpit server unreachable'));
  }

  function paintRun(r) {
    const card = document.querySelector(`.runcard[data-id="${r.id}"]`);
    if (!card) return;
    card.className = 'runcard st-' + r.status + (card.classList.contains('open') ? ' open' : '');
    card.querySelector('.rstatus').textContent = STATUS_LABEL[r.status] ?? r.status;
    card.querySelector('.rkill').style.display = r.status === 'running' ? '' : 'none';
    card.querySelector('.burn i').style.width = Math.min(100, (r.tokens / r.budget) * 100) + '%';
    card.querySelector('.rmeta').textContent =
      `${fmtTok(r.tokens)} / ${fmtTok(r.budget)} tok${r.cost ? ` · ≈$${r.cost.toFixed(4)}` : ''}${r.denials ? ` · ${r.denials} denied` : ''}`;
    card.querySelector('.rlast').textContent = r.lastLine ?? '';
    card.querySelector('.rtopup').style.display = r.resumable ? '' : 'none';
    card.querySelector('.rresult').textContent = r.resultText ?? '';
  }

  // ── push alerts (real Web Push — works with the app closed) ──
  async function enablePush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return addMsg('err', 'push not supported in this browser');
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
      const reg = await navigator.serviceWorker.register('/sw.js');
      const { key } = await (await fetch('/api/push/pubkey')).json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToU8(key),
      });
      await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sub),
      });
      $('pushBtn').style.display = 'none';
      addMsg('claude', 'Push alerts on — fleet runs will reach you even with Atlan closed.');
    } catch (err) {
      addMsg('err', 'push setup failed: ' + err.message);
    }
  }
  function urlB64ToU8(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  $('pushBtn').addEventListener('click', enablePush);

  $('fleetSpawn').addEventListener('click', () => {
    const prompt = $('fleetPrompt').value.trim();
    if (!prompt) return;
    fetch('/api/fleet/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        profile: $('fleetProfile').value,
        model: $('fleetModel').value,
        budget: Number($('fleetBudget').value),
        cwd: $('projSel').value,
      }),
    }).then((r) => r.json()).then((j) => {
      if (j.error) return addMsg('err', j.error);
      $('fleetPrompt').value = '';
    }).catch(() => addMsg('err', 'cockpit server unreachable'));
  });

  $('fleetKillAll').addEventListener('click', () => {
    fetch('/api/fleet/kill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'all' }) });
  });

  // ── engine keys ──
  const KEY_LABELS = {
    GEMINI_API_KEY: 'Gemini', OPENAI_API_KEY: 'OpenAI', DEEPSEEK_API_KEY: 'DeepSeek',
    XAI_API_KEY: 'xAI Grok', MISTRAL_API_KEY: 'Mistral', MOONSHOT_API_KEY: 'Kimi', ANTHROPIC_API_KEY: 'Anthropic (optional — OAuth already works)',
  };
  function loadKeys() {
    fetch('/api/keys').then((r) => r.json()).then((list) => {
      const box = $('keysList');
      box.innerHTML = '';
      for (const k of list) {
        const row = document.createElement('div');
        row.className = 'keyrow';
        row.innerHTML = `<span class="kname"></span><input type="password" placeholder="${k.set ? 'saved ' + k.hint + ' — paste to replace' : 'paste key'}" autocomplete="off">
          <span class="kset">${k.set ? '● ' + (k.source === 'env' ? 'env' : 'set') : ''}</span><button class="btn">Save</button>`;
        row.querySelector('.kname').textContent = KEY_LABELS[k.env] ?? k.env;
        const input = row.querySelector('input');
        row.querySelector('button').addEventListener('click', () => {
          fetch('/api/keys', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ env: k.env, value: input.value.trim() }),
          }).then((r) => r.json()).then((j) => {
            if (j.error) return addMsg('err', j.error);
            input.value = '';
            loadKeys(); loadEngines(); // refresh switcher availability
          });
        });
        box.append(row);
      }
    }).catch(() => {});
  }

  // ── session controls (Doctor tab) ──
  $('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.reload();
  });
  $('changePwBtn').addEventListener('click', () => {
    $('pwForm').style.display = $('pwForm').style.display === 'none' ? '' : 'none';
  });
  $('pwSave').addEventListener('click', async () => {
    const r = await fetch('/api/auth/password', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ current: $('pwCurrent').value, next: $('pwNext').value }),
    });
    const j = await r.json().catch(() => ({}));
    $('pwMsg').textContent = r.ok ? 'password changed ✓' : (j.error || 'failed');
    if (r.ok) { $('pwCurrent').value = ''; $('pwNext').value = ''; }
  });

  // ── doctor ──
  function loadDoctor() {
    const list = $('doctorList');
    list.innerHTML = '<div class="hint">running checks…</div>';
    fetch('/api/doctor').then((r) => r.json()).then((checks) => {
      list.innerHTML = '';
      let bad = false;
      for (const c of checks) {
        if (!c.ok && !c.warn) bad = true;
        const div = document.createElement('div');
        div.className = 'check ' + (c.ok ? 'pass' : c.warn ? 'warn' : '');
        div.innerHTML = `<span class="sig"></span><div><div class="what"></div><div class="how"></div></div>`;
        div.querySelector('.what').textContent = c.label;
        div.querySelector('.how').textContent = c.detail;
        list.append(div);
      }
      if (bad) setMood('alarmed');
    }).catch(() => { list.innerHTML = '<div class="hint">doctor endpoint unreachable</div>'; });
  }
  $('doctorBtn').addEventListener('click', () => { loadDoctor(); loadPreflight(); });

  // ── preflight (security gate) ──
  function loadPreflight() {
    fetch('/api/preflight').then((r) => r.json()).then((p) => {
      const list = $('preflightList');
      list.innerHTML = '';
      for (const c of p.checks) {
        const div = document.createElement('div');
        div.className = 'check ' + (c.ok ? 'pass' : '');
        div.innerHTML = `<span class="sig"></span><div><div class="what"></div><div class="how"></div></div>`;
        div.querySelector('.what').textContent = c.label;
        div.querySelector('.how').textContent = c.detail;
        list.append(div);
      }
      $('preflightVerdict').textContent = p.ready
        ? '✓ preflight green — safe to consider exposure (tunnel + Access, never a bare port)'
        : `✗ ${p.blockers} blocker${p.blockers > 1 ? 's' : ''} — Atlan stays loopback-only until these are green`;
    }).catch(() => {});
  }

  // ── fleet sub-nav: Runs | Routines | Builder ──
  document.querySelectorAll('#fleetSubnav button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#fleetSubnav button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.fpane').forEach((p) => p.classList.remove('active'));
    $(b.dataset.p).classList.add('active');
    if (b.dataset.p === 'fp-routines') loadRoutines();
    if (b.dataset.p === 'fp-builder') loadBuilder();
  }));

  // ── routines ──
  let routEditing = null, routPaused = false;
  const cadenceText = (c) => c.kind === 'daily' ? `daily at ${c.at}` : c.minutes % 60 === 0 ? `every ${c.minutes / 60}h` : `every ${c.minutes}m`;
  const inMins = (t) => { const d = Math.round((t - Date.now()) / 60000); return d < 60 ? `${Math.max(0, d)}m` : d < 1440 ? `${Math.round(d / 60)}h` : `${Math.round(d / 1440)}d`; };

  function loadRoutines() {
    fetch('/api/routines').then((r) => r.json()).then(({ routines, paused }) => {
      routPaused = paused;
      $('routPauseBtn').textContent = paused ? '▶ resume all' : '⏸ pause all';
      $('routPauseBtn').classList.toggle('hot', paused);
      const box = $('routList');
      box.innerHTML = routines.length ? '' : '<div class="hint">no routines yet — idle costs nothing, scheduled runs are still hard-budgeted</div>';
      for (const r of routines) {
        const card = document.createElement('div');
        card.className = 'runcard' + (r.missed ? ' st-halted-budget' : r.enabled && !paused ? '' : ' st-killed');
        card.innerHTML = `<div class="rtop"><span class="rwho"></span><span class="rstatus"></span></div>
          <div class="rprompt"></div><div class="rmeta"></div>
          <div class="projbar">
            <button class="btn hot rfire"></button>
            <button class="btn ghost redit">edit</button>
            <button class="btn ghost rtoggle"></button>
            <button class="btn ghost rdel">✖</button>
          </div>`;
        card.querySelector('.rwho').textContent = r.name;
        card.querySelector('.rstatus').textContent = r.missed ? 'MISSED — waiting for you' : !r.enabled ? 'off' : paused ? 'paused' : cadenceText(r.cadence);
        card.querySelector('.rprompt').textContent = r.prompt;
        card.querySelector('.rmeta').textContent =
          `${r.profile} · ${fmtTok(r.budget)} tok/fire${r.nextDueAt ? ` · next in ${inMins(r.nextDueAt)}` : ''}${r.lastRunId ? ` · last run ${r.lastRunId}` : ''}`;
        card.querySelector('.rfire').textContent = r.missed ? '▶ run late' : '▶ run now';
        card.querySelector('.rfire').addEventListener('click', () => {
          fetch('/api/routines/fire', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: r.id, late: r.missed }) })
            .then((x) => x.json()).then((j) => { if (j.error) addMsg('err', j.error); else loadRoutines(); });
        });
        card.querySelector('.redit').addEventListener('click', () => editRoutine(r));
        card.querySelector('.rtoggle').textContent = r.enabled ? 'disable' : 'enable';
        card.querySelector('.rtoggle').addEventListener('click', () => {
          fetch('/api/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...r, enabled: !r.enabled }) }).then(loadRoutines);
        });
        card.querySelector('.rdel').addEventListener('click', () => {
          fetch('/api/routines/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: r.id }) }).then(loadRoutines);
        });
        box.append(card);
      }
      fillPersonaSelects();
    }).catch(() => {});
  }

  function editRoutine(r) {
    routEditing = r?.id ?? null;
    $('routForm').style.display = '';
    $('routName').value = r?.name ?? '';
    $('routKind').value = r?.cadence?.kind ?? 'every';
    $('routEvery').value = r?.cadence?.minutes ?? 360;
    $('routAt').value = r?.cadence?.at ?? '07:00';
    $('routPrompt').value = r?.prompt ?? '';
    $('routPersona').value = r?.personaId ?? '';
    $('routProfile').value = r?.profile ?? 'scout';
    $('routModel').value = r?.model ?? 'claude-haiku-4-5-20251001';
    $('routBudget').value = String(r?.budget ?? 50000);
    $('routKind').dispatchEvent(new Event('change'));
  }
  $('routNewBtn').addEventListener('click', () => editRoutine(null));
  $('routCancel').addEventListener('click', () => { $('routForm').style.display = 'none'; routEditing = null; });
  $('routKind').addEventListener('change', () => {
    const daily = $('routKind').value === 'daily';
    $('routEvery').style.display = daily ? 'none' : '';
    $('routAt').style.display = daily ? '' : 'none';
  });
  $('routPauseBtn').addEventListener('click', () => {
    fetch('/api/routines/pause', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused: !routPaused }) }).then(loadRoutines);
  });
  $('routSave').addEventListener('click', () => {
    const cadence = $('routKind').value === 'daily'
      ? { kind: 'daily', at: $('routAt').value }
      : { kind: 'every', minutes: Number($('routEvery').value) };
    fetch('/api/routines', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: routEditing ?? undefined, name: $('routName').value, cadence,
        prompt: $('routPrompt').value, personaId: $('routPersona').value || null,
        profile: $('routProfile').value, model: $('routModel').value,
        budget: Number($('routBudget').value), cwd: $('projSel').value,
      }),
    }).then((r) => r.json()).then((j) => {
      if (j.error) return addMsg('err', j.error);
      $('routForm').style.display = 'none'; routEditing = null;
      loadRoutines();
    });
  });

  // ── Persona+ builder ──
  let personas = [], commands = [], perEditing = null, cmdEditing = null;

  function loadBuilder() {
    fetch('/api/personas').then((r) => r.json()).then((d) => {
      personas = d.personas; commands = d.commands;
      renderPersonas(); renderCommands(); fillPersonaSelects(); fillHarness();
    }).catch(() => {});
  }

  function fillPersonaSelects() {
    for (const selId of ['routPersona', 'cPersona']) {
      const sel = $(selId);
      const cur = sel.value;
      sel.innerHTML = '<option value="">no persona</option>';
      for (const p of personas) {
        const o = document.createElement('option');
        o.value = p.id; o.textContent = p.name;
        sel.append(o);
      }
      sel.value = cur;
    }
    // profile selects share the fleet roster
    for (const selId of ['routProfile', 'pProfile']) {
      const sel = $(selId);
      if (sel.options.length) continue;
      for (const o of $('fleetProfile').options) sel.append(o.cloneNode(true));
    }
  }

  function renderPersonas() {
    $('perCount').textContent = personas.length ? `(${personas.length})` : '';
    const box = $('perList');
    box.innerHTML = personas.length ? '' : '<div class="hint">none yet — a persona is a scoped identity: short, focused, with hard NO_NOS</div>';
    for (const p of personas) {
      const card = document.createElement('div');
      card.className = 'runcard';
      card.innerHTML = `<div class="rtop"><span class="rwho"></span><span class="rstatus"></span></div><div class="rprompt"></div>
        <div class="projbar"><button class="btn ghost pedit">edit</button><button class="btn ghost pdel">✖</button></div>`;
      card.querySelector('.rwho').textContent = p.name;
      card.querySelector('.rstatus').textContent = p.profile;
      card.querySelector('.rprompt').textContent = p.focus;
      card.querySelector('.pedit').addEventListener('click', () => {
        perEditing = p.id;
        $('pName').value = p.name; $('pFocus').value = p.focus; $('pBio').value = p.bio;
        $('pSkills').value = (p.skills ?? []).join('\n'); $('pNoNos').value = (p.no_nos ?? []).join('\n');
        $('pInstr').value = p.instructions; $('pProfile').value = p.profile;
        $('dPersona').open = true;
      });
      card.querySelector('.pdel').addEventListener('click', () => {
        fetch('/api/personas/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: p.id }) }).then(loadBuilder);
      });
      box.append(card);
    }
  }
  $('pSave').addEventListener('click', () => {
    fetch('/api/personas', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: perEditing ?? undefined, name: $('pName').value, focus: $('pFocus').value,
        bio: $('pBio').value, skills: $('pSkills').value, no_nos: $('pNoNos').value,
        instructions: $('pInstr').value, profile: $('pProfile').value,
      }),
    }).then((r) => r.json()).then((j) => {
      if (j.error) return addMsg('err', j.error);
      perEditing = null;
      for (const id of ['pName', 'pFocus', 'pBio', 'pSkills', 'pNoNos', 'pInstr']) $(id).value = '';
      loadBuilder();
    });
  });

  // dynamic rows: variables / fields / checkers
  function addRow(boxId, html, data = {}) {
    const row = document.createElement('div');
    row.className = 'rowedit';
    row.innerHTML = html + '<button class="btn ghost rowdel">✖</button>';
    row.querySelector('.rowdel').addEventListener('click', () => row.remove());
    for (const [k, v] of Object.entries(data)) {
      const el = row.querySelector(`[data-k="${k}"]`);
      if (el) el.type === 'checkbox' ? (el.checked = !!v) : (el.value = Array.isArray(v) ? v.join(', ') : v ?? '');
    }
    $(boxId).append(row);
    return row;
  }
  const VAR_ROW = `<input data-k="name" placeholder="name"><select data-k="type"><option>string</option><option>number</option><option>boolean</option><option>enum</option></select><input data-k="description" placeholder="description"><input data-k="values" placeholder="enum values, comma-sep" class="enumonly"><label class="ck"><input type="checkbox" data-k="required" checked>req</label>`;
  const FIELD_ROW = `<input data-k="name" placeholder="field name"><select data-k="type"><option>string</option><option>number</option><option>boolean</option><option>array</option></select><input data-k="description" placeholder="description">`;
  const CHK_ROW = `<select data-k="kind"><option value="not-empty">not empty</option><option value="enum">enum ∈</option><option value="range">range</option><option value="regex">regex</option><option value="subset-of-var">⊆ input var</option><option value="max-length">max length</option><option value="arith">= formula</option></select><input data-k="field" placeholder="field"><input data-k="arg" placeholder="args">`;
  const CHK_HINT = {
    'not-empty': 'no args', enum: 'washer, dryer, other', range: '0..100',
    regex: '^[A-Z0-9]{17}$', 'subset-of-var': 'variable name', 'max-length': '200', arith: 'qty*unit_price',
  };
  $('varAdd').addEventListener('click', () => addRow('varRows', VAR_ROW));
  $('fieldAdd').addEventListener('click', () => addRow('fieldRows', FIELD_ROW));
  $('chkAdd').addEventListener('click', () => {
    const row = addRow('chkRows', CHK_ROW);
    const kind = row.querySelector('[data-k="kind"]');
    const arg = row.querySelector('[data-k="arg"]');
    kind.addEventListener('change', () => { arg.placeholder = CHK_HINT[kind.value]; });
  });
  const rowsOf = (boxId) => [...$(boxId).querySelectorAll('.rowedit')].map((row) => {
    const o = {};
    for (const el of row.querySelectorAll('[data-k]')) o[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim();
    return o;
  });

  function chkFromRow(o) {
    const c = { kind: o.kind, field: o.field };
    if (o.kind === 'enum') c.values = o.arg.split(',').map((s) => s.trim()).filter(Boolean);
    if (o.kind === 'range') { const [mn, mx] = o.arg.split('..'); c.min = Number(mn); c.max = Number(mx); }
    if (o.kind === 'regex') c.pattern = o.arg;
    if (o.kind === 'subset-of-var') c.ofVar = o.arg;
    if (o.kind === 'max-length') c.max = Number(o.arg);
    if (o.kind === 'arith') { c.formula = o.arg; c.tolerance = 0.01; }
    return c;
  }
  function chkToRow(c) {
    const arg = c.kind === 'enum' ? (c.values ?? []).join(', ')
      : c.kind === 'range' ? `${c.min}..${c.max}`
      : c.kind === 'regex' ? c.pattern
      : c.kind === 'subset-of-var' ? c.ofVar
      : c.kind === 'max-length' ? String(c.max)
      : c.kind === 'arith' ? c.formula : '';
    return { kind: c.kind, field: c.field, arg };
  }

  function renderCommands() {
    $('cmdCount').textContent = commands.length ? `(${commands.length})` : '';
    const box = $('cmdList');
    box.innerHTML = commands.length ? '' : '<div class="hint">none yet — a command is a typed ask: variables in, JSON template out, checkers grade it</div>';
    for (const c of commands) {
      const card = document.createElement('div');
      card.className = 'runcard';
      card.innerHTML = `<div class="rtop"><span class="rwho"></span><span class="rstatus"></span></div><div class="rprompt"></div>
        <div class="projbar"><button class="btn ghost cedit">edit</button><button class="btn ghost cdel">✖</button></div>`;
      card.querySelector('.rwho').textContent = c.name;
      card.querySelector('.rstatus').textContent = `${c.variables.length} vars · ${c.fields.length} fields · ${(c.checkers ?? []).length} checks`;
      card.querySelector('.rprompt').textContent = c.focus;
      card.querySelector('.cedit').addEventListener('click', () => {
        cmdEditing = c.id;
        $('cName').value = c.name; $('cPersona').value = c.personaId ?? ''; $('cFocus').value = c.focus; $('cInstr').value = c.instructions;
        $('varRows').innerHTML = ''; $('fieldRows').innerHTML = ''; $('chkRows').innerHTML = '';
        for (const v of c.variables) addRow('varRows', VAR_ROW, v);
        for (const f of c.fields) addRow('fieldRows', FIELD_ROW, f);
        for (const k of c.checkers ?? []) addRow('chkRows', CHK_ROW, chkToRow(k));
        $('dCommand').open = true;
      });
      card.querySelector('.cdel').addEventListener('click', () => {
        fetch('/api/commands/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: c.id }) }).then(loadBuilder);
      });
      box.append(card);
    }
  }
  $('cSave').addEventListener('click', () => {
    fetch('/api/commands', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: cmdEditing ?? undefined, name: $('cName').value, personaId: $('cPersona').value || null,
        focus: $('cFocus').value, instructions: $('cInstr').value,
        variables: rowsOf('varRows').map((v) => ({ ...v, values: v.values ? v.values.split(',').map((s) => s.trim()) : undefined })),
        fields: rowsOf('fieldRows'),
        checkers: rowsOf('chkRows').map(chkFromRow),
      }),
    }).then((r) => r.json()).then((j) => {
      if (j.error) return addMsg('err', j.error);
      cmdEditing = null;
      $('varRows').innerHTML = ''; $('fieldRows').innerHTML = ''; $('chkRows').innerHTML = '';
      for (const id of ['cName', 'cFocus', 'cInstr']) $(id).value = '';
      loadBuilder();
    });
  });
  $('cCompiled').addEventListener('click', () => {
    const id = cmdEditing ?? commands[0]?.id;
    if (!id) return addMsg('err', 'save a command first');
    fetch(`/api/commands/${id}/compiled`).then((r) => r.json()).then((c) => {
      const out = $('compiledOut');
      out.style.display = '';
      out.textContent = `── SYSTEM PROMPT (persona) ──\n${c.system ?? '(no persona linked)'}\n\n── REQUEST (sent as the user turn) ──\n${c.request}\n\n── RESPONSE JSON-SCHEMA (constrains decoding) ──\n${JSON.stringify(c.responseSchema, null, 1)}\n\n── AS A TOOL (VARIABLES → parameters) ──\n${JSON.stringify(c.toolSchema, null, 1)}`;
    });
  });

  // ── test harness ──
  function fillHarness() {
    const sel = $('hCmd');
    const cur = sel.value;
    sel.innerHTML = '';
    for (const c of commands) {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name + (c.personaId ? ` · ${personas.find((p) => p.id === c.personaId)?.name ?? ''}` : '');
      sel.append(o);
    }
    sel.value = cur || (commands[0]?.id ?? '');
    paintHarnessVars();
  }
  function paintHarnessVars() {
    const c = commands.find((x) => x.id === $('hCmd').value);
    const box = $('hVars');
    box.innerHTML = '';
    if (!c) { box.innerHTML = '<div class="hint">build a command above first</div>'; return; }
    for (const v of c.variables) {
      const row = document.createElement('div');
      row.className = 'rowedit';
      row.innerHTML = `<label class="vlabel"></label>` + (v.type === 'enum'
        ? `<select data-v="${v.name}">${(v.values ?? []).map((x) => `<option>${x}</option>`).join('')}</select>`
        : `<input data-v="${v.name}" placeholder="${v.type}${v.required ? ' · required' : ''}">`);
      row.querySelector('.vlabel').textContent = v.name;
      box.append(row);
    }
  }
  $('hCmd').addEventListener('change', paintHarnessVars);
  $('hRun').addEventListener('click', () => {
    const c = commands.find((x) => x.id === $('hCmd').value);
    if (!c) return;
    const vars = {};
    for (const el of $('hVars').querySelectorAll('[data-v]')) {
      const def = c.variables.find((v) => v.name === el.dataset.v);
      vars[el.dataset.v] = def?.type === 'number' ? Number(el.value) : def?.type === 'boolean' ? el.value === 'true' : el.value;
    }
    $('hRun').disabled = true;
    $('hOut').innerHTML = '<div class="hint">running…</div>';
    fetch('/api/harness/run', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId: c.id, engine: $('hEngine').value, vars }),
    }).then((r) => r.json()).then(paintHarnessResult)
      .catch((e) => { $('hOut').innerHTML = ''; addMsg('err', 'harness: ' + e.message); })
      .finally(() => { $('hRun').disabled = false; });
  });
  function paintHarnessResult(r) {
    const box = $('hOut');
    box.innerHTML = '';
    if (r.error) { box.innerHTML = `<div class="hint">✗ ${escapeHtml(r.error)}</div>`; return; }
    const head = document.createElement('div');
    head.className = 'check ' + (r.passed ? 'pass' : '');
    head.innerHTML = `<span class="sig"></span><div><div class="what"></div><div class="how"></div></div>`;
    head.querySelector('.what').textContent = r.passed ? 'ALL CHECKS PASS' : (r.parseError ?? 'checks failed');
    head.querySelector('.how').textContent = `${r.engine} · ${r.ms}ms${r.tokens ? ` · ${r.tokens} tok` : ''}${r.tier3 ? ' · ' + r.tier3 : ''}`;
    box.append(head);
    for (const c of r.results ?? []) {
      const div = document.createElement('div');
      div.className = 'check ' + (c.ok ? 'pass' : '');
      div.innerHTML = `<span class="sig"></span><div><div class="what"></div><div class="how"></div></div>`;
      div.querySelector('.what').textContent = `tier-${c.tier} · ${c.check}`;
      div.querySelector('.how').textContent = c.ok ? 'pass' : `got: ${c.got}`;
      box.append(div);
    }
    if (r.parsed) {
      const pre = document.createElement('pre');
      pre.className = 'rresult'; pre.style.display = 'block';
      pre.textContent = JSON.stringify(r.parsed, null, 1);
      box.append(pre);
    }
    if (r.escalatePrompt) {
      const btn = document.createElement('button');
      btn.className = 'btn hot';
      btn.textContent = '⇧ Escalate to Claude fleet run';
      btn.addEventListener('click', () => {
        fetch('/api/harness/escalate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: r.escalatePrompt }) })
          .then((x) => x.json()).then((j) => {
            if (j.error) return addMsg('err', j.error);
            addMsg('claude', `Escalated to the fleet as run ${j.id} — the inbox will ping when it surfaces.`);
          });
      });
      box.append(btn);
    }
  }

  connect();
  greet();
})();
