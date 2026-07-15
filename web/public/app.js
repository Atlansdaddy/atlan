/* ATLAN cockpit — vanilla ES, no build step (deliberate: fewer moving parts in proot). */
(() => {
  const $ = (id) => document.getElementById(id);
  const chatlog = $('chatlog');

  // ── tabs ──
  const tabs = document.querySelectorAll('nav button');
  tabs.forEach((b) => b.addEventListener('click', () => {
    tabs.forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(b.dataset.s).classList.add('active');
    if (b.dataset.s === 's-term') initTerm();
    if (b.dataset.s === 's-doctor') loadDoctor();
  }));

  // ── Atlan mood ──
  const moodLines = {
    calm: "The water's calm, boss. What are we building today?",
    building: 'I can feel the build moving through me.',
    alarmed: "Something's off in the hull.",
    proud: 'It surfaced. Look at what you made.',
  };
  let moodTimer = null;
  function setMood(mood) {
    const wrap = $('atlanWrap');
    wrap.className = 'atlan ' + mood;
    $('atlanLine').textContent = moodLines[mood] ?? moodLines.calm;
    clearTimeout(moodTimer);
    if (mood === 'proud' || mood === 'alarmed') {
      moodTimer = setTimeout(() => setMood('calm'), 6000);
    }
  }

  // ── WebSocket ──
  let ws, wsReady = false;
  const pendingOut = [];
  function connect() {
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => {
      wsReady = true;
      $('connDot').classList.add('on');
      $('sessMeta').textContent = 'connected';
      while (pendingOut.length) ws.send(pendingOut.shift());
      if (termOpened) ws.send(JSON.stringify({ t: 'pty.open', name: 'main', cols: term.cols, rows: term.rows }));
    };
    ws.onclose = () => {
      wsReady = false;
      $('connDot').classList.remove('on');
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
      case 'chat.session':
        sessionId = m.id;
        $('sessMeta').textContent = `session ${m.id.slice(0, 8)}`;
        break;
      case 'chat.result': {
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
      case 'atlan.mood': setMood(m.mood); break;
      case 'preview.snapped':
        $('snapBtn').textContent = '📸 Snapshot → Claude';
        updateSeen(m.count);
        addMsg('claude', `Snapshot taken — I'll see it with your next message.`);
        break;
      case 'pty.data': term?.write(m.data); break;
      case 'pty.exit': term?.writeln('\r\n[tmux session ended — reopen the tab to restart]'); break;
    }
  }

  function addMsg(role, text, engineLabel) {
    const div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'user' : role === 'err' ? 'err' : 'claude');
    if (role === 'claude' || role === 'brain') {
      const who = document.createElement('div');
      who.className = 'who'; who.textContent = role === 'brain' ? (engineLabel || 'brain') + ' · chat only' : 'Claude';
      div.append(who);
    }
    div.append(document.createTextNode(text));
    chatlog.append(div); scroll();
  }

  // engine roster → fill the switcher's local/cloud groups
  function loadEngines() {
    fetch('/api/engines').then((r) => r.json()).then((roster) => {
      const ogLocal = $('ogLocal'), ogCloud = $('ogCloud');
      ogLocal.innerHTML = ''; ogCloud.innerHTML = '';
      for (const e of roster) {
        const o = document.createElement('option');
        o.value = `${e.id}|${e.model}`;
        o.textContent = e.label + (e.ready ? '' : ` — needs ${e.needs}`);
        o.disabled = !e.ready;
        (e.id === 'local' ? ogLocal : ogCloud).append(o);
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
  $('doctorBtn').addEventListener('click', loadDoctor);

  connect();
  setMood('calm');
})();
