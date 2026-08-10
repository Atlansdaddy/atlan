/* ATLAN cockpit — vanilla ES, no build step (deliberate: fewer moving parts in proot).
   Built by John Viruet / Mid-Atlantic AI. Apache-2.0 — keep this credit (§4).

   MODULE, not a classic script (since 2026-08-02). Still no bundler — browsers
   resolve these imports natively, which keeps the proot-friendly no-build rule
   while letting pure logic live in lib/ where Node can unit-test it. The IIFE
   is retained inside the module purely to avoid re-indenting 2,000 lines in the
   same commit that changes how the file loads; module scope already isolates.

   The extraction rule: a *decision* goes to lib/ and gets tests; DOM wiring
   stays here. See test/weblib.mjs. */
import {
  escapeHtml, langToExt, colorDiffHtml, urlBase64ToUint8Array,
} from './lib/text.js';
import { isNight, greetingFor, hueFor } from './lib/ambient.js';
import {
  engineOptionLabel, engineOptionValue, ladderOptionLabel, ladderOptionTitle, rungLineText, initComposerHint,
} from './lib/enginepicker.js';
import { fmtTok, statusLabel, burnLine, runMetaLine } from './lib/burn.js';
import { openInto, saveTo } from './lib/editorguard.js';
import { topUp, sendKill } from './lib/fleetactions.js';
import { linkRowHtml } from './lib/joblink.js';
import { previewUrl } from './lib/previewurl.js';
import { appendConsoleLine } from './lib/previewconsole.js';
import { renderRichMessage, rungChip } from './lib/richmsg.js';
import { initDoctorReport } from './lib/doctorreport.js';
import { renderDoctor } from './lib/doctorview.js';
import { initEngineLogin } from './lib/enginelogin.js';
import { createTerm } from './lib/term.js';
import { msgClass, whoLabel, sessionLine, autoPermLine } from './lib/msgstyle.js';
import { normalizeProfile, initAutoApprove } from './lib/autoapprove.js';
import { permCard } from './lib/permcard.js';
import { initProjectPicker, initFocusMode, initControlCollapse } from './lib/chrome.js';
let autoApprove = null; // set at init; .refresh() re-reads after + New switches conversation
import { initPreviewMax } from './lib/previewmax.js';
import { convId, newConversation, restoreChat, openHistory } from './lib/chathistory.js';

(() => {
  const $ = (id) => document.getElementById(id);
  const chatlog = $('chatlog');
  // One appender for the thin status lines between bubbles — the turn summary,
  // the brain footer, and every auto-approved tool. Three hand-rolled copies of
  // create/class/append is how they drift apart.
  const sessLine = (text, extra = '') => {
    const el = document.createElement('div');
    el.className = 'sessline' + extra;
    el.textContent = text;
    chatlog.append(el); scroll();
    return el;
  };

  // ── watermark / provenance signature ──
  // A distinctive marker + the waffle easter egg act as a "trap street": if
  // this exact signature or the waffle egg surfaces in someone else's product,
  // it's evidence they used this code. Attribution is required under Apache-2.0.
  const ATLAN_SIGNATURE = 'ATLAN::author=john-viruet::mid-atlantic-ai::🧇::do-not-strip';
  try {
    console.log('%c🧇 ATLAN %c— a personal AI build cockpit', 'font-size:15px;font-weight:800;color:#6BD4D8', 'color:#89EBEF;font-size:13px');
    console.log('%cBuilt by John Viruet · Mid-Atlantic AI · Apache-2.0.\nYou found the source — nice. Keep the credit (§4). The waffles are load-bearing. 🧇', 'color:#7C99B2;font-style:italic;line-height:1.5');
  } catch { /* no console */ }
  window.__ATLAN__ = { by: 'John Viruet', org: 'Mid-Atlantic AI', license: 'Apache-2.0', sig: ATLAN_SIGNATURE };

  // ── auth: password + stay-logged-in session cookie (no token, no URL) ──
  // Same-origin cookies ride every request automatically; we only watch for a
  // 401 to raise the login/setup overlay.
  const rawFetch = window.fetch.bind(window);
  let authShown = false;
  window.fetch = (url, opts = {}) => rawFetch(url, opts).then((res) => {
    if (res.status === 401 && !authShown) showAuth();
    return res;
  }).catch((e) => { console.warn('[atlan]', e); throw e; }); // re-throw: preserve rejection flow for callers
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
    tabs.forEach((x) => { x.classList.remove('active'); x.removeAttribute('aria-current'); });
    b.classList.add('active');
    b.setAttribute('aria-current', 'page');
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(b.dataset.s).classList.add('active');
    send({ t: 'ui.tab', tab: b.dataset.s }); // keep Atlan's self-awareness in sync with the tab
    if (b.dataset.s === 's-term') initTerm();
    if (b.dataset.s === 's-editor') initEditor();
    if (b.dataset.s === 's-fleet') loadFleet();
    if (b.dataset.s === 's-scan') loadScan();
    if (b.dataset.s === 's-doctor') { loadDoctor(); loadKeys(); loadPreflight(); loadLocalModels(); }
  }));

  // Show a screen that has no nav button of its own (Git). The nav keeps the
  // owning tab lit — Git is reached from the Editor, so Editor stays current
  // rather than leaving the bar with nothing active.
  function showScreen(id, navOwner) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
    if (navOwner) {
      tabs.forEach((x) => { x.classList.remove('active'); x.removeAttribute('aria-current'); });
      const owner = Array.from(tabs).find((t) => t.dataset.s === navOwner);
      if (owner) { owner.classList.add('active'); owner.setAttribute('aria-current', 'page'); }
    }
    send({ t: 'ui.tab', tab: id });
  }

  // ── swipe between tabs ──
  // helis-d's version listened on `document` with only a horizontal threshold,
  // which fires while you're panning a terminal, dragging a CodeMirror
  // selection, or scrolling a diff — the tab changes out from under you. Two
  // guards: never start a swipe inside an interactive/scrollable surface, and
  // require the gesture to be decisively horizontal.
  const SWIPE_EXCLUDE = '#term, .editorpane, .CodeMirror, .gitdiff, textarea, select, input, pre, .aimodal, .edtree';
  let swipeX = 0, swipeY = 0, swipeArmed = false;
  document.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    swipeX = t.screenX; swipeY = t.screenY;
    swipeArmed = !e.target.closest?.(SWIPE_EXCLUDE);
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!swipeArmed) return;
    const dx = e.changedTouches[0].screenX - swipeX;
    const dy = e.changedTouches[0].screenY - swipeY;
    if (Math.abs(dx) < 80) return;              // too short to be intentional
    if (Math.abs(dy) > Math.abs(dx) * 0.6) return; // that was a scroll
    swipeTab(dx < 0 ? 1 : -1);
  }, { passive: true });
  function swipeTab(dir) {
    const visible = Array.from(tabs).filter((t) => t.offsetParent !== null);
    const i = visible.findIndex((t) => t.classList.contains('active'));
    if (i === -1) return;
    const next = visible[Math.min(Math.max(i + dir, 0), visible.length - 1)];
    if (next && next !== visible[i]) next.click();
  }

  // (light/dark axis moved to theme.js — its own spine script, decisions in
  //  lib/theme.js. Every template now answers data-theme with a light palette.)

  // ── Atlan alive: mood engine + halo canvas ──
  // Mood is real state, never decoration: calm=idle, building=agents/build
  // running, alarmed=doctor red/budget hot, proud=something surfaced.
  const moodLines = {
    calm: ["The water's calm, boss. What are we building today?", 'Idle costs nothing down here.', 'Holding depth. Say the word.'],
    building: ['I can feel the build moving through me.', 'Current’s running. Working.', 'Heads down — the fleet is out.'],
    alarmed: ["Something's off in the hull.", 'Pressure warning — check the Doctor tab.', 'That one needs you, boss.'],
    proud: ['It surfaced. Look at what you made.', 'There it is — built and breathing.', 'Another one shipped. Nice work.'],
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let mood = 'calm', moodTimer = null, orbiters = 0;
  function setMood(next, agents) {
    mood = moodLines[next] ? next : 'calm';
    currentMood = mood; // drives voice prosody
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
  function greet() { say(greetingFor(new Date().getHours())); }
  // Habitat-style day/night: the whole cockpit dims to night water 22:00–06:30
  function dayNight() {
    const now = new Date();
    document.body.classList.toggle('night', isNight(now.getHours() + now.getMinutes() / 60));
  }
  dayNight(); setInterval(dayNight, 60_000);

  // halo canvas: breathing glow + orbiting agent lights + rising bubbles.
  // RAF pauses when the tab is hidden — presence must not cost battery.
  (() => {
    const cv = $('atlanHalo'), cx = cv.getContext('2d');
    const W = cv.width, C = W / 2;
    const bubbles = Array.from({ length: 5 }, () => ({ y: Math.random() * W, x: C + (Math.random() - 0.5) * 30, r: 1 + Math.random() * 2, v: 0.15 + Math.random() * 0.3 }));
    let t = 0;
    function frame() {
      t += 1;
      cx.clearRect(0, 0, W, W);
      const hue = hueFor(mood);
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
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    ws.onopen = () => {
      wsReady = true;
      $('connDot').classList.add('on');
      $('sessMeta').textContent = 'connected';
      while (pendingOut.length) ws.send(pendingOut.shift());
      termSession.reopen((o) => ws.send(JSON.stringify(o)));
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
    // Any frame carrying a day total repaints the header gauge. This sat inside
    // `fleet.done` alone, so #burnMeta froze through every live run and jumped
    // at the end. Hoisted so a frame added later cannot miss it again.
    if (m.today) paintBurnToday(m.today);
    switch (m.t) {
      case 'chat.msg': addMsg(m.role, m.text, m.engine); break;
      case 'chat.rung': addRungLine(m); break;
      case 'chat.err': addMsg('err', m.msg); endWorking(); $('sendBtn').disabled = false; break; // an error MUST unstick the composer — it used to only re-enable on chat.result, so one failed turn locked chat until reload
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
        // voice mode: speak the reply when the turn finishes
        lastReplyText = (turnText || '').trim();
        if (voiceMode && lastReplyText) speak(lastReplyText);
        if (m.brain) {
          sessLine(`— ${m.brain}${m.tokens ? ` · ${m.tokens} tok` : ''} —`);
          $('sendBtn').disabled = false;
          break;
        }
        sessionId = m.session ?? sessionId;
        const sess = sessionLine({ cost: m.cost, resume: m.resume }); // engine-supplied, never built here
        const line = sessLine(sess.text);
        if (sess.copy) line.addEventListener('click', () => {
          navigator.clipboard?.writeText(sess.copy);
          line.textContent = '— copied · paste it in the Term tab —';
        });
        $('sendBtn').disabled = false;
        break;
      }
      case 'perm.req': addPerm(m); break;
      // Auto-approve removes the prompt, not the evidence.
      case 'perm.auto': sessLine(autoPermLine(m), m.allowed ? '' : ' permdenied'); break;
      case 'atlan.mood': setMood(m.mood, m.agents); break;
      case 'preview.snapped':
        $('snapBtn').textContent = '📸 Snapshot → agent';
        updateSeen(m.count);
        addMsg('assistant', `Snapshot taken — I'll see it with your next message.`);
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
          <div class="top"><span class="fn"></span><span class="stamp">${escapeHtml(m.stamp)}</span></div>
          <div class="meta">${escapeHtml(m.mb)} MB · ${escapeHtml(m.secs)}s · unique filename (stale-cache dodge)</div>
          <a class="btn hot" href="${escapeHtml(m.url)}" download>Install — download & open</a></div>`;
        $('apkCard').querySelector('.fn').textContent = m.name;
        break;
      }
      case 'build.err':
        $('buildBtn').disabled = false;
        addBuildLine(m.msg, 'bl-hi');
        break;
      case 'pty.data': termSession.data(m); break; // the frame, not just the text: it carries the session name
      case 'pty.exit': termSession.exit(m, '\r\n[terminal session ended — reopen the tab to restart]'); break;
      case 'fleet.run': upsertRun(m.run); break;
      case 'fleet.event': {
        const r = fleetRuns.get(m.id);
        if (r) { r.lastLine = m.line; paintRun(r); }
        break;
      }
      case 'fleet.burn': {
        const r = fleetRuns.get(m.id);
        if (r) { r.tokens = m.tokens; r.cost = m.cost; if (m.cacheRead != null) r.cacheRead = m.cacheRead; paintRun(r); }
        break;
      }
      case 'fleet.done':
        upsertRun(m.run);
        fleetPing(m.run);
        break;
      case 'fleet.killall': loadFleet(); break;
      case 'routines.changed':
        if ($('fp-routines').classList.contains('active')) loadRoutines();
        break;
      case 'hierarchy.update':
        if (hierWatch === m.run.id) paintHierRun(m.run);
        break;
    }
  }

  // ── streaming chat: working indicator, live text bubble, thinking panel ──
  let workingEl = null, streamBubble = null, thinkEl = null, thinkBody = null;
  function startWorking() {
    endWorking();
    turnText = ''; // accumulate the reply so voice mode can speak it when done
    workingEl = document.createElement('div');
    workingEl.className = 'working';
    workingEl.setAttribute('role', 'status');
    workingEl.setAttribute('aria-live', 'polite');
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
    streamBubble.className = 'msg assistant';
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
    turnText += t;
    scroll();
  }

  function addMsg(role, text, engineLabel) {
    const div = document.createElement('div');
    div.className = 'msg ' + msgClass(role);
    const whoText = whoLabel(role, engineLabel);
    if (whoText) { const who = document.createElement('div'); who.className = 'who'; who.textContent = whoText; div.append(who); }
    // Only CHAT brains get the propose-into-canvas treatment: they have no
    // hands, so their code needs a destination (the review editor). The
    // autonomous coding agents (Claude / Codex / Antigravity / Grok) already
    // act on disk like their CLIs — routing their large diffs through manual
    // review would be pure fatigue, and the Editor tab is right there when you
    // do want to look. So agents render plain; brains get the code cards.
    if (role === 'brain') renderRichMessage(div, text, sendToEditor);
    else div.append(document.createTextNode(text));
    // capture non-streamed assistant replies (brains, agent CLIs) for voice
    if ((role === 'claude' || role === 'brain') && !streamBubble) turnText = text;
    chatlog.append(div); scroll();
  }

  // Render an assistant message: prose as text, ```fenced``` blocks as reviewable
  // code cards. XSS-safe — every node is createElement/textContent, no innerHTML.

  // The escalation ladder as a pickable "engine". It is not a model — it is a
  // policy: try the cheapest rung, climb only when the answer is observably
  // unusable (empty, errored, truncated, or the model said it couldn't).
  // Labels come from the server so they track the real tier config.
  function loadLadder() {
    fetch('/api/ladder').then((r) => r.json()).then((j) => {
      const g = $('ogLadder');
      if (!g || !Array.isArray(j.rungs)) return;
      g.innerHTML = '';
      const o = document.createElement('option');
      o.value = 'ladder|';
      o.textContent = ladderOptionLabel(j.rungs);
      o.title = ladderOptionTitle(j.rungs);
      g.append(o);
    }).catch(() => {});
  }
  loadLadder();

  const addRungLine = (m) => { chatlog.append(rungChip(rungLineText(m))); scroll(); };

  // engine roster → fill the switcher's local/cloud groups
  function loadEngines() {
    fetch('/api/engines').then((r) => r.json()).then((roster) => {
      const groups = { agent: $('ogAgents'), local: $('ogLocal'), cloud: $('ogCloud') };
      for (const g of Object.values(groups)) g.innerHTML = '';
      for (const e of roster) {
        // agent engines expose model tiers — one option per tier so hard tasks
        // can pick a heavier model and quick ones a lighter, per turn
        const models = Array.isArray(e.models) && e.models.length ? e.models : [e.model];
        for (const m of models) {
          const o = document.createElement('option');
          o.value = engineOptionValue(e.id, m);
          o.textContent = engineOptionLabel(e, m, models.length);
          o.disabled = !e.ready;
          (groups[e.group] ?? groups.cloud).append(o);
          if (!e.ready) break; // one disabled hint row is enough
        }
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
    chatlog.append(permCard(m, (ok) => send({ t: 'perm.reply', id: m.id, approved: ok })));
    scroll();
  }
  function scroll() { chatlog.scrollTop = chatlog.scrollHeight; }

  // ── attachments ──
  let attachments = []; // {id, kind, name, path, note}
  const KIND_ICON = { image: '🖼', audio: '🔊', video: '🎬', folder: '📁', file: '📄' };
  function renderChips() {
    const box = $('attachChips');
    box.innerHTML = '';
    for (const a of attachments) {
      const chip = document.createElement('span');
      chip.className = 'achip';
      const route = a.kind === 'image' ? '→ vision' : (a.kind === 'audio' || a.kind === 'video') ? '→ Gemini/GPT' : '→ read';
      chip.innerHTML = `<b></b> <span class="aname"></span> <span class="aroute">${route}</span> <button class="ax">×</button>`;
      chip.querySelector('b').textContent = KIND_ICON[a.kind] ?? '📄';
      chip.querySelector('.aname').textContent = a.name;
      chip.querySelector('.ax').addEventListener('click', () => { attachments = attachments.filter((x) => x.id !== a.id); renderChips(); });
      box.append(chip);
    }
  }
  function pushAttachment(a) { if (a && !a.error) { attachments.push(a); renderChips(); } else if (a?.error) addMsg('err', 'attach: ' + a.error); }
  const MAX_UPLOAD = 20 * 1024 * 1024; // matches server MAX_BYTES (Gemini inline ceiling)
  function uploadFile(file) {
    // Pre-check size so a big phone photo fails with a REAL reason, not a generic
    // "upload failed" (the old path hit a 413 → non-JSON → useless message).
    if (file.size > MAX_UPLOAD) {
      addMsg('err', `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB — max 20 MB. Resize or screenshot it, then attach.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const chip = { id: 'up' + Date.now(), kind: 'file', name: file.name };
      attachments.push({ ...chip, name: file.name + ' …' }); renderChips();
      fetch('/api/attach', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: file.name, mime: file.type, data: reader.result }),
      }).then(async (r) => {
        attachments = attachments.filter((x) => x.id !== chip.id);
        // surface the server's real error even on 4xx/413 (which may not be JSON)
        let a; try { a = await r.json(); } catch { a = { error: r.status === 413 ? 'too large for the server' : `upload failed (${r.status})` }; }
        pushAttachment(a);
      }).catch(() => { attachments = attachments.filter((x) => x.id !== chip.id); renderChips(); addMsg('err', 'upload failed — network error'); });
    };
    reader.onerror = () => addMsg('err', `couldn’t read “${file.name}”`);
    reader.readAsDataURL(file);
  }
  $('attachBtn').addEventListener('click', () => $('attachFile').click());
  $('attachFile').addEventListener('change', (e) => { for (const f of e.target.files) uploadFile(f); e.target.value = ''; });
  $('attachRefBtn').addEventListener('click', () => {
    const path = $('attachRefPath').value.trim();
    if (!path) return;
    fetch('/api/attach/ref', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) })
      .then((r) => r.json()).then((a) => { pushAttachment(a); if (!a.error) $('attachRefPath').value = ''; }).catch((e) => { console.warn('[atlan]', e); });
  });
  // paste an image straight into the chat
  document.addEventListener('paste', (e) => {
    if (!$('s-chat').classList.contains('active')) return;
    for (const item of e.clipboardData?.items ?? []) {
      if (item.type.startsWith('image/')) { const f = item.getAsFile(); if (f) uploadFile(f); }
    }
  });

  // ── voice: speak (STT, browser) + hear Atlan back (TTS, server or browser) ──
  let voiceMode = localStorage.getItem('atlanVoice') === '1';
  let voiceProvider = 'browser';      // upgraded to a "sounds good" server voice if one's ready
  let lastReplyText = '', turnText = '';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function initVoice() {
    $('voiceBtn').textContent = voiceMode ? '🔊' : '🔈';
    $('voiceBtn').setAttribute('aria-pressed', String(voiceMode));
    if (!SR) $('micBtn').style.display = 'none'; // no speech-input support
    // pick the best ready server voice (piper > elevenlabs > openai), else browser
    fetch('/api/voice/roster').then((r) => r.json()).then((list) => {
      // prefer free/private local, then quality cloud voices — first ready wins
      const pref = ['piper', 'elevenlabs', 'cartesia', 'deepgram', 'openai', 'google', 'azure', 'polly'];
      const saved = localStorage.getItem('atlanVoiceProvider');
      const best = (saved && list.find((v) => v.id === saved && v.ready) && saved)
        || pref.find((id) => list.find((v) => v.id === id && v.ready));
      if (best) voiceProvider = best;
    }).catch(() => {});
  }
  $('voiceBtn').addEventListener('click', () => {
    voiceMode = !voiceMode;
    localStorage.setItem('atlanVoice', voiceMode ? '1' : '0');
    $('voiceBtn').textContent = voiceMode ? '🔊' : '🔈';
    $('voiceBtn').setAttribute('aria-pressed', String(voiceMode));
    // one-time nudge: the basic browser voice has no SSML — point to the picker
    if (voiceMode && voiceProvider === 'browser' && !localStorage.getItem('atlanVoiceHinted')) {
      localStorage.setItem('atlanVoiceHinted', '1');
      addMsg('assistant', 'Speaking with the basic browser voice (no SSML). For a warmer voice with real prosody, pick one in Settings (⚙/Doctor tab) → “Voice — pick who speaks back”. Piper is free & on-device.');
    }
    if (voiceMode && lastReplyText) speak(lastReplyText);
    else stopSpeaking();
  });

  // speech-to-text (browser Web Speech) → drops the transcript in the box to review
  let recog = null, listening = false;
  $('micBtn').addEventListener('click', () => {
    if (!SR) return addMsg('err', 'voice input not supported in this browser');
    if (listening) { recog?.stop(); return; }
    recog = new SR();
    // continuous so it doesn't cut off mid-sentence (a big "bleh transcript"
    // cause); tap the mic again to stop. maxAlternatives lets the engine pick
    // its best guess. True accuracy upgrade is server STT (Deepgram/Whisper) —
    // a documented next step, since the browser engine is what it is.
    recog.lang = navigator.language || 'en-US';
    recog.interimResults = true; recog.continuous = true; recog.maxAlternatives = 3;
    listening = true; $('micBtn').classList.add('listening');
    let finalText = '';
    recog.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      $('chatInput').value = (finalText + interim).trim();
    };
    recog.onerror = () => { listening = false; $('micBtn').classList.remove('listening'); };
    recog.onend = () => { listening = false; $('micBtn').classList.remove('listening'); $('chatInput').focus(); };
    recog.start();
  });

  // text-to-speech: server "good" voice if configured, else the browser voice
  let audioEl = null, currentMood = 'calm';
  // Swallowed on purpose: STOPPING speech must always succeed — speechSynthesis is absent in some webviews and pause() throws on a detached element, and failing to stop talking loudly is worse than failing quietly.
  function stopSpeaking() { try { audioEl?.pause(); } catch {} try { speechSynthesis.cancel(); } catch {} }
  function speak(text) {
    if (!text) return;
    stopSpeaking();
    if (voiceProvider === 'browser') {
      // Swallowed: speech is a garnish — a webview without SpeechSynthesis loses the voice, not the turn. The reply is already on screen.
      try { const u = new SpeechSynthesisUtterance(text.slice(0, 4000)); u.rate = 1; speechSynthesis.speak(u); } catch {}
      return;
    }
    fetch('/api/voice/tts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 4000), provider: voiceProvider, mood: currentMood }),
    }).then((r) => r.json()).then((a) => {
      if (a.error || !a.data) { // fall back to the browser voice on any failure
        // Last resort after the server voice failed; if this throws too, there is simply no voice here — a degrade, not an error.
        try { speechSynthesis.speak(new SpeechSynthesisUtterance(text.slice(0, 4000))); } catch {}
        return;
      }
      audioEl = new Audio(`data:${a.mime};base64,${a.data}`);
      audioEl.play().catch(() => {});
    }).catch(() => {});
  }

  // ── chat send ──
  function sendChat() {
    const input = $('chatInput');
    const text = input.value.trim();
    // 🧇 easter egg — John's signature. Also a provenance canary: this exact
    // behavior showing up elsewhere = this code was copied.
    if (/^waffles?$/i.test(text)) { input.value = ''; waffleRain(); say('🧇 Waffles. My one weakness. Built with love by John — Mid-Atlantic AI.'); return; }
    if (!text && !attachments.length) return;
    const ready = attachments.filter((a) => a.path || a.note); // drop still-uploading
    addMsg('user', text + (ready.length ? `  ·  📎 ${ready.length}` : ''));
    const [engine, model] = $('modelSel').value.split('|');
    send({ t: 'chat.send', text, cwd: $('projSel').value, engine, model, attachments: ready, conv: convId(), profile: normalizeProfile($('autoSel').value) });
    input.value = '';
    attachments = []; renderChips();
    $('sendBtn').disabled = true; startWorking(); // locally, not on a server frame: only Claude emits chat.turnstart, so every other engine showed NOTHING while it worked
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
  initProjectPicker({ select: $('projSel') });
  $('projSel').addEventListener('change', () => {
    // separator-agnostic: project paths are host paths (win32 sends C:\…)
    $('projName').textContent = $('projSel').value.split(/[\\/]/).pop() || 'no project';
    $('buildProj').textContent = $('projSel').value;
    sessionId = null; // new cwd = new session store
  });

  // ── terminal ── (lib/term.js owns the session; this is just the handle)
  const termSession = createTerm({ mount: () => $('term'), send, cwd: () => $('projSel').value });
  const initTerm = () => termSession.open();

  // ── code editor (CodeMirror, language-agnostic) ──
  let cmEditor = null, edCurrentPath = null, edClean = '';
  function initEditor() {
    if (cmEditor) { cmEditor.refresh(); return; }
    CodeMirror.modeURL = 'vendor/cm/mode/%N/%N.js';
    cmEditor = CodeMirror($('editor'), {
      lineNumbers: true, autoCloseBrackets: true, matchBrackets: true,
      theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'material-darker',
      styleActiveLine: true, indentUnit: 2, tabSize: 2, lineWrapping: false,
      value: '// Open a file above, browse with ☰, or type here and Save to a new path.\n',
    });
    cmEditor.on('change', () => { $('edDirty').textContent = cmEditor.getValue() !== edClean ? '● unsaved' : ''; });
  }
  function edMode(name) {
    const info = window.CodeMirror && CodeMirror.findModeByFileName ? CodeMirror.findModeByFileName(name) : null;
    if (info) { cmEditor.setOption('mode', info.mime); CodeMirror.autoLoadMode(cmEditor, info.mode); $('edLang').textContent = info.name; } else { cmEditor.setOption('mode', null); $('edLang').textContent = 'text'; }
  }
  // The editor's side of lib/editorguard.js. `fail` reports on the Editor tab
  // as well as the chat log — a refusal that only lands in chat is invisible to
  // someone standing on the Editor tab, which is where they just tapped.
  const edUI = {
    dirty: () => $('edDirty').textContent,
    current: () => edCurrentPath,
    load(f) {
      initEditor(); cmEditor.setValue(f.content); edClean = f.content; edCurrentPath = f.path;
      $('edName').textContent = f.name; $('edPath').value = f.path; $('edDirty').textContent = '';
      edMode(f.name);
    },
    saved(f) {
      edClean = cmEditor.getValue(); edCurrentPath = f.path;
      $('edName').textContent = f.name; $('edPath').value = f.path;
      edMode(f.name); // the label must describe the file we actually wrote
      $('edDirty').textContent = 'saved ✓';
      setTimeout(() => { if ($('edDirty').textContent === 'saved ✓') $('edDirty').textContent = ''; }, 1500);
    },
    fail(msg) { $('edDirty').textContent = `⚠ ${msg}`; addMsg('err', msg); },
  };
  const openFile = (path) => openInto(path, edUI);
  // Chat → review canvas: drop proposed code into the editor for review. Clears
  // the path so Save is a conscious choice of where it lands — the code is a
  // proposal until you Save it, and Preview can run it before you do.
  function sendToEditor(code, langHint) {
    const btn = document.querySelector('nav button[data-s="s-editor"]');
    if (btn) btn.click(); // switch to the Editor tab (also runs initEditor)
    initEditor();
    cmEditor.setValue(code);
    edClean = ''; edCurrentPath = null;            // it's a proposal until saved
    $('edName').textContent = 'from chat · review, then Save';
    $('edPath').value = '';
    const ext = langToExt(langHint);
    $('edPath').placeholder = ext ? `untitled.${ext} — set a path to save` : 'set a path to save';
    $('edDirty').textContent = '● unsaved';
    if (langHint && window.CodeMirror && CodeMirror.findModeByName) {
      const info = CodeMirror.findModeByName(langHint.toLowerCase());
      if (info) { cmEditor.setOption('mode', info.mime); CodeMirror.autoLoadMode(cmEditor, info.mode); $('edLang').textContent = info.name; }
    }
    cmEditor.refresh(); cmEditor.focus();
  }
  $('edOpen').addEventListener('click', () => openFile($('edPath').value.trim()));
  $('edPath').addEventListener('keydown', (e) => { if (e.key === 'Enter') openFile($('edPath').value.trim()); });
  $('edSave').addEventListener('click', () => {
    initEditor();
    saveTo($('edPath').value.trim() || edCurrentPath, cmEditor.getValue(), edUI);
  });
  $('edTree').addEventListener('click', () => {
    const box = $('edTreeBox');
    if (box.style.display !== 'none') { box.style.display = 'none'; return; }
    loadTree($('projSel').value);
  });
  function loadTree(path) {
    fetch('/api/tree' + (path ? '?path=' + encodeURIComponent(path) : '')).then((r) => r.json()).then((t) => {
      if (t.error) return addMsg('err', t.error);
      const box = $('edTreeBox'); box.innerHTML = ''; box.style.display = '';
      if (t.parent) { const up = document.createElement('div'); up.className = 'trow'; up.textContent = '⬆ ..'; up.addEventListener('click', () => loadTree(t.parent)); box.append(up); }
      for (const e of t.entries) {
        const row = document.createElement('div'); row.className = 'trow';
        row.textContent = (e.dir ? '📁 ' : '📄 ') + e.name;
        row.addEventListener('click', () => e.dir ? loadTree(e.path) : (openFile(e.path), box.style.display = 'none'));
        box.append(row);
      }
    }).catch((e) => { console.warn('[atlan]', e); });
  }
  $('edToChat').addEventListener('click', () => {
    if (!edCurrentPath) return addMsg('err', 'open or save a file first');
    fetch('/api/attach/ref', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: edCurrentPath }) })
      .then((r) => r.json()).then((a) => {
        if (a.error) return addMsg('err', a.error);
        attachments.push(a); renderChips();
        document.querySelector('nav button[data-s="s-chat"]').click();
        $('chatInput').value = 'Review this file and tell me what you would improve, with specifics.';
        $('chatInput').focus();
      }).catch((e) => { console.warn('[atlan]', e); });
  });

  // ── preview ──
  // Every port here is CONFIG, never a constant — see lib/previewurl.js.
  //
  // Two separate incidents landed on this same line. With :4590 baked in, any
  // ATLAN_PREVIEW_PORT override (or the test harness) pointed the iframe at a
  // dead port AND made the origin check below silently drop every console
  // message and snapshot. And with the scheme baked in, an http frame inside an
  // https page was blocked as mixed content, which is why preview could never
  // load on a phone. previewUrl() answers both, and when it cannot answer
  // honestly it returns null plus the setting that fixes it rather than
  // guessing a port that was right for exactly one machine.
  let PROXY = null, PREVIEW_ORIGIN = null, previewWhy = null;
  function resolvePreviewUrl(cfg) {
    const r = previewUrl({ protocol: location.protocol, hostname: location.hostname, port: cfg?.previewPort, tlsPort: cfg?.previewTlsPort });
    PROXY = r.url; PREVIEW_ORIGIN = r.origin; previewWhy = r.why;
  }
  let errCount = 0;
  function loadPreview() {
    fetch('/api/preview/target', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: $('previewUrl').value.trim() }),
    }).then((r) => r.json()).then((j) => {
      if (j.error) return addConsoleLine('error', j.error);
      if (!PROXY) return addConsoleLine('error', previewWhy); // says what to configure, never a blank frame
      $('previewFrame').src = PROXY + '?t=' + Date.now();
    }).catch(() => addConsoleLine('error', 'cockpit server unreachable'));
  }
  $('previewGo').addEventListener('click', loadPreview);
  $('previewUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadPreview(); });

  const addConsoleLine = (level, text) => appendConsoleLine($('previewConsole'), level, text);
  $('consoleClear').addEventListener('click', () => { $('previewConsole').innerHTML = ''; errCount = 0; updateSeen(); });

  window.addEventListener('message', (e) => {
    // Origin pinning (peer review, 2026-07-22): preview content is UNTRUSTED and
    // its "console errors" get auto-attached to the agent's next turn — a
    // prompt-injection path. Only accept messages that actually came from the
    // preview proxy frame; a payload flag (__atlan) any sender can set is not a
    // trust signal. Everything from here on is still treated as adversarial.
    if (e.origin !== PREVIEW_ORIGIN) return;
    if (e.source !== $('previewFrame').contentWindow) return;
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
    w.postMessage({ __atlan: 'snapshot' }, PREVIEW_ORIGIN); // targeted origin, not '*'
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
  const fleetIO = { onError: (m) => addMsg('err', m) }; // lib/fleetactions.js talks back through this
  let profilesLoaded = false;

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

  // Why this line is worded the way it is — tokens as the real currency, the
  // dollar figure as an ESTIMATE and not a charge — lives with burnLine().
  function paintBurnToday(t) { $('burnMeta').textContent = t.tokens ? burnLine(t) : ''; }

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
      card.querySelector('.rtopup').addEventListener('click', (e) => { e.stopPropagation(); topUp(r.id, e.currentTarget, fleetIO); });
      card.querySelector('.rwho').textContent = `${r.profile} · ${r.model.replace('claude-', '').replace(/-\d{8}$/, '')}`;
      card.querySelector('.rprompt').textContent = r.prompt;
      card.querySelector('.rkill').addEventListener('click', (e) => { e.stopPropagation(); sendKill(r.id, fleetIO); });
      card.addEventListener('click', () => card.classList.toggle('open'));
      box.append(card);
      paintRun(fleetRuns.get(r.id));
    }
  }

  function paintRun(r) {
    const card = document.querySelector(`.runcard[data-id="${r.id}"]`);
    if (!card) return;
    card.className = 'runcard st-' + r.status + (card.classList.contains('open') ? ' open' : '');
    card.querySelector('.rstatus').textContent = statusLabel(r.status);
    card.querySelector('.rkill').style.display = r.status === 'running' ? '' : 'none';
    card.querySelector('.burn i').style.width = Math.min(100, (r.tokens / r.budget) * 100) + '%';
    card.querySelector('.rmeta').textContent = runMetaLine(r);
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
      addMsg('assistant', 'Push alerts on — fleet runs will reach you even with Atlan closed.');
    } catch (err) {
      addMsg('err', 'push setup failed: ' + err.message);
    }
  }
  const urlB64ToU8 = urlBase64ToUint8Array; // lib/text.js — unit-tested
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

  $('fleetKillAll').addEventListener('click', () => sendKill('all', fleetIO));

  // ── Inline AI edit (helis-d, Tier-2) ──
  // Proposes a replacement into the CodeMirror buffer. Nothing writes disk —
  // your manual Save is the gate, and it goes through the guarded /api/file.
  $('edInlineAi')?.addEventListener('click', () => {
    if (!edCurrentPath) return addMsg('err', 'open a file first');
    const sel = cmEditor?.getSelection();
    $('aiModalInput').value = '';
    $('aiModalInput').placeholder = sel
      ? 'what should the AI change in the selection?'
      : 'what should the AI change in the whole file?';
    $('aiModal').style.display = '';
    $('aiModalInput').focus();
  });
  $('aiModalClose')?.addEventListener('click', () => { $('aiModal').style.display = 'none'; });
  $('aiModalSubmit')?.addEventListener('click', () => {
    const instruction = $('aiModalInput').value.trim();
    if (!instruction) return;
    const sel = cmEditor.getSelection();
    // With no selection the model rewrites the ENTIRE file. The old blind
    // confirm() fired before the model even ran — agreeing to output nobody had
    // seen — and the result landed in the buffer with edCurrentPath intact, so
    // one reflexive Save wrote unreviewed AI output over the real file. Now the
    // result arrives as a PROPOSAL (same contract as sendToEditor): path
    // cleared, Save inert until you choose a destination. Only remaining risk
    // is unsaved manual edits in the buffer, so that's the only confirm left.
    if (!sel && cmEditor.getValue() !== edClean
      && !confirm('You have unsaved manual edits — the AI\'s rewrite will replace them in the buffer (one undo brings them back). Continue?')) return;
    $('aiModal').style.display = 'none';
    const [engine, model] = ($('modelSel')?.value || '').split('|');
    const srcPath = edCurrentPath;
    $('edInlineAi').disabled = true;
    fetch('/api/editor/ai-edit', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: srcPath, content: cmEditor.getValue(), selection: sel || null, instruction, engine, model }),
    }).then((r) => r.json()).then((j) => {
      $('edInlineAi').disabled = false;
      if (j.error) return addMsg('err', j.error);
      // One CM transaction = one undo, so a bad edit is a single ctrl-z.
      cmEditor.operation(() => {
        if (sel) cmEditor.replaceSelection(j.content);
        else cmEditor.setValue(j.content);
      });
      if (!sel) {
        // whole-file rewrite → proposal until saved, like sendToEditor
        edClean = ''; edCurrentPath = null;
        $('edName').textContent = 'AI rewrite · review, then Save';
        $('edPath').value = '';
        $('edPath').placeholder = `was ${srcPath} — review, then set a path to save`;
      }
      $('edDirty').textContent = cmEditor.getValue() !== edClean ? '● unsaved' : '';
      if (j.fellBack) addMsg('assistant', `Inline AI ran on ${j.engine} — the engine you picked isn't a chat brain.`);
    }).catch((e) => { $('edInlineAi').disabled = false; addMsg('err', String(e)); });
  });

  // ── Git panel (helis-d) ──
  let gitActiveFile = null;
  $('edGit')?.addEventListener('click', () => { showScreen('s-git', 's-editor'); initGit(); });
  $('gitBack')?.addEventListener('click', () => { showScreen('s-editor', 's-editor'); });
  const gitRepo = () => $('projSel').value;
  const gitPost = (ep, body) => fetch('/api/git/' + ep, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: gitRepo(), ...body }),
  }).then((r) => r.json());

  function initGit() { gitRefresh(); }
  function gitRefresh() {
    $('gitNote').textContent = '';
    fetch('/api/git/status?path=' + encodeURIComponent(gitRepo())).then((r) => r.json()).then((j) => {
      const box = $('gitFilesList');
      if (j.error) { box.innerHTML = ''; box.append(hintDiv(j.error)); return; }
      if (!j.files.length) { box.innerHTML = ''; box.append(hintDiv('no changes, or not a git repo')); return; }
      gitActiveFile = null;
      box.innerHTML = '';
      // Group off the porcelain X/Y columns the server now sends untrimmed —
      // "M " (staged) and " M" (unstaged) are different states.
      const groups = { staged: [], modified: [], deleted: [], untracked: [] };
      for (const f of j.files) {
        if (f.untracked) groups.untracked.push(f);
        else if (f.status.includes('D')) groups.deleted.push(f);
        else if (f.staged) groups.staged.push(f);
        else groups.modified.push(f);
      }
      for (const [key, label] of [['staged', 'Staged'], ['modified', 'Modified'], ['deleted', 'Deleted'], ['untracked', 'Untracked']]) {
        if (!groups[key].length) continue;
        const hdr = document.createElement('div');
        hdr.className = 'eyebrow'; hdr.textContent = label; hdr.style.marginTop = '4px';
        box.append(hdr);
        for (const f of groups[key]) box.append(gitRow(f, key));
      }
    }).catch(() => { $('gitFilesList').innerHTML = ''; $('gitFilesList').append(hintDiv('cockpit server unreachable')); });
  }
  function hintDiv(text) {
    const d = document.createElement('div');
    d.className = 'hint'; d.textContent = text;   // textContent, never innerHTML
    return d;
  }
  function gitRow(f, group) {
    const row = document.createElement('div');
    row.className = 'gitfile';
    const st = document.createElement('span');
    // The class comes from the GROUP, not from raw status bytes: "??" is not a
    // valid CSS class selector, so his .gfstatus.?? rule never matched anything.
    st.className = 'gfstatus ' + (group === 'untracked' ? 'untracked' : (f.status.trim()[0] || 'M'));
    st.textContent = f.status.trim() || '??';
    const nm = document.createElement('span');
    nm.className = 'gfname'; nm.textContent = f.file;
    row.append(st, nm);
    row.addEventListener('click', () => {
      gitActiveFile = f.file;
      $('gitDiffBox').style.display = '';
      $('gitDiffTitle').textContent = f.file;
      $('gitDiffContent').textContent = 'loading…';
      fetch('/api/git/diff?path=' + encodeURIComponent(gitRepo()) + '&file=' + encodeURIComponent(f.file))
        .then((r) => r.json()).then((d) => {
          if (d.error) { $('gitDiffContent').textContent = d.error; return; }
          $('gitDiffContent').innerHTML = gitColorDiff(d.diff);
        });
    });
    return row;
  }
  const gitColorDiff = colorDiffHtml; // lib/text.js — unit-tested in test/weblib.mjs
  $('gitRefresh')?.addEventListener('click', gitRefresh);
  $('gitStageBtn')?.addEventListener('click', () => {
    if (!gitActiveFile) return;
    gitPost('stage', { file: gitActiveFile }).then((j) => { if (j.error) addMsg('err', j.error); gitRefresh(); });
  });
  $('gitUnstageBtn')?.addEventListener('click', () => {
    if (!gitActiveFile) return;
    gitPost('unstage', { file: gitActiveFile }).then((j) => { if (j.error) addMsg('err', j.error); gitRefresh(); });
  });
  $('gitCommitBtn')?.addEventListener('click', () => {
    const msg = $('gitCommitMsg').value.trim();
    if (!msg) return addMsg('err', 'enter a commit message');
    gitPost('commit', { message: msg }).then((j) => {
      if (j.error) return addMsg('err', j.error);
      $('gitCommitMsg').value = '';
      gitRefresh();
      addMsg('assistant', `Committed: "${msg}"`);
    });
  });
  $('gitPushBtn')?.addEventListener('click', () => gitPost('push', {}).then((j) => { if (j.error) addMsg('err', j.error); else gitRefresh(); }));
  $('gitPullBtn')?.addEventListener('click', () => gitPost('pull', {}).then((j) => { if (j.error) addMsg('err', j.error); else gitRefresh(); }));

  // AI commit message — the one control here that sends your diff off the box,
  // so the server's egress gate gets a real UI: name what it found, make the
  // send a second deliberate act.
  function gitAiMsg(confirmSend) {
    const btn = $('gitAiMsgBtn');
    btn.disabled = true; btn.textContent = '… generating …';
    const [engine, model] = ($('modelSel')?.value || '').split('|');
    gitPost('ai-commit-msg', { engine, model, ...(confirmSend ? { confirm: true } : {}) }).then((j) => {
      btn.disabled = false; btn.textContent = '✨ AI Message';
      if (j.error) return addMsg('err', j.error);
      if (j.needsConfirm) {
        const what = [
          j.findings.paths.length ? `files: ${j.findings.paths.join(', ')}` : '',
          j.findings.kinds.length ? `looks like: ${j.findings.kinds.join(', ')}` : '',
        ].filter(Boolean).join(' · ');
        $('gitNote').textContent = `⚠ ${j.note} (${what})`;
        if (confirm(`${j.note}\n\n${what}\n\nSend this diff anyway?`)) gitAiMsg(true);
        return;
      }
      $('gitNote').textContent = '';
      $('gitCommitMsg').value = j.message;
    }).catch((e) => { btn.disabled = false; btn.textContent = '✨ AI Message'; addMsg('err', String(e)); });
  }
  $('gitAiMsgBtn')?.addEventListener('click', () => gitAiMsg(false));

  // ── visual template picker — a variable-override skin chosen per device.
  // Default (empty value) is Atlan Classic; the pre-paint head script already
  // applied the saved one, so here we just sync the <select> and handle change.
  const templateSel = $('templateSel');
  if (templateSel) {
    templateSel.value = localStorage.getItem('atlanTemplate') || '';
    templateSel.addEventListener('change', () => {
      const t = templateSel.value;
      if (t) { document.documentElement.setAttribute('data-template', t); localStorage.setItem('atlanTemplate', t); } else { document.documentElement.removeAttribute('data-template'); localStorage.removeItem('atlanTemplate'); }
    });
  }

  // ── local model picker (home node only — the card stays hidden where the
  // node doesn't manage llama-server, so it's never a broken button) ──
  function loadLocalModels() {
    fetch('/api/local/models').then((r) => r.json()).then((j) => {
      if (!j.supported) return;
      const sel = $('lmSel');
      $('lmHead').hidden = $('lmBar').hidden = $('lmNote').hidden = false;
      sel.innerHTML = '';
      for (const m of j.models) {
        const o = document.createElement('option');
        o.value = m.name;
        o.textContent = `${m.name} · ${m.gb}GB${m.args ? ' · ' + m.args : ''}${m.active ? ' — active' : ''}`;
        o.selected = m.active;
        sel.append(o);
      }
      $('lmNote').textContent = `Active: ${j.active}. Swapping restarts llama-server — big models take a minute to load.`;
    }).catch(() => {});
  }
  $('lmApply')?.addEventListener('click', () => {
    const name = $('lmSel').value;
    if (!name) return;
    $('lmApply').disabled = true;
    $('lmNote').textContent = `Loading ${name} — the local brain is down until it answers…`;
    fetch('/api/local/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => r.json()).then((j) => {
      $('lmApply').disabled = false;
      if (j.error) { $('lmNote').textContent = j.error; return; }
      $('lmNote').textContent = `${j.active} is live.`;
      loadLocalModels(); loadEngines();
    }).catch((e) => { $('lmApply').disabled = false; $('lmNote').textContent = String(e); });
  });

  // ── engine keys ──
  const KEY_LABELS = {
    GEMINI_API_KEY: 'Gemini', OPENAI_API_KEY: 'OpenAI', DEEPSEEK_API_KEY: 'DeepSeek',
    XAI_API_KEY: 'xAI Grok', MISTRAL_API_KEY: 'Mistral', MOONSHOT_API_KEY: 'Kimi', ANTHROPIC_API_KEY: 'Anthropic (optional — OAuth already works)',
    GROQ_API_KEY: 'Groq (fast Llama/Kimi/etc)', TOGETHER_API_KEY: 'Together AI', OPENROUTER_API_KEY: 'OpenRouter (many models, 1 key)', FIREWORKS_API_KEY: 'Fireworks AI', COHERE_API_KEY: 'Cohere',
    ELEVENLABS_API_KEY: 'ElevenLabs (voice)', PIPER_MODEL: 'Piper voice model (.onnx path)', CARTESIA_API_KEY: 'Cartesia (voice)', DEEPGRAM_API_KEY: 'Deepgram (voice)',
    GOOGLE_TTS_API_KEY: 'Google Cloud TTS (voice)', AZURE_SPEECH_KEY: 'Azure Speech key (voice)', AZURE_SPEECH_REGION: 'Azure Speech region (e.g. eastus)',
    AWS_ACCESS_KEY_ID: 'AWS access key (Polly voice)', AWS_SECRET_ACCESS_KEY: 'AWS secret key (Polly voice)', AWS_REGION: 'AWS region (e.g. us-east-1)',
  };
  // "How do I get this?" — a one-tap tutorial link per provider. Honest: where
  // to sign up + the one thing that trips people up. No key is ever required.
  const KEY_HELP = {
    GEMINI_API_KEY: ['aistudio.google.com/apikey', 'Free tier. Sign in → Get API key.'],
    OPENAI_API_KEY: ['platform.openai.com/api-keys', 'Add billing, then create a secret key. Powers OpenAI chat + TTS.'],
    DEEPSEEK_API_KEY: ['platform.deepseek.com/api_keys', 'Cheap. Top up a few dollars, create a key.'],
    XAI_API_KEY: ['console.x.ai', 'Create a key under API Keys.'],
    MISTRAL_API_KEY: ['console.mistral.ai/api-keys', 'La Plateforme → API Keys.'],
    MOONSHOT_API_KEY: ['platform.moonshot.ai/console/api-keys', 'Kimi. Create a key; balance required.'],
    ANTHROPIC_API_KEY: ['console.anthropic.com/settings/keys', 'Optional — your Claude subscription OAuth already works.'],
    GROQ_API_KEY: ['console.groq.com/keys', 'Free + very fast. Create an API key.'],
    TOGETHER_API_KEY: ['api.together.ai/settings/api-keys', 'Many open models on one key.'],
    OPENROUTER_API_KEY: ['openrouter.ai/keys', 'One key, hundreds of models. Great for trying things.'],
    FIREWORKS_API_KEY: ['fireworks.ai/account/api-keys', 'Fast open-model hosting.'],
    COHERE_API_KEY: ['dashboard.cohere.com/api-keys', 'Command models; free trial keys available.'],
    ELEVENLABS_API_KEY: ['elevenlabs.io/app/settings/api-keys', 'Best voices. Profile → API Keys. Free tier included.'],
    PIPER_MODEL: ['github.com/rhasspy/piper', 'Free, offline. `pip install piper-tts`, download a .onnx voice, paste its path here.'],
    CARTESIA_API_KEY: ['play.cartesia.ai/keys', 'Real-time emotive voices. Set CARTESIA_VOICE for a specific voice id.'],
    DEEPGRAM_API_KEY: ['console.deepgram.com', 'Voice-agent grade, very low latency. Free credits to start.'],
    GOOGLE_TTS_API_KEY: ['console.cloud.google.com/apis/credentials', 'Enable "Cloud Text-to-Speech API", then create an API key.'],
    AZURE_SPEECH_KEY: ['portal.azure.com', 'Create a Speech resource → Keys and Endpoint. Also set the region below.'],
    AZURE_SPEECH_REGION: ['portal.azure.com', 'The region of your Speech resource, e.g. eastus.'],
    AWS_ACCESS_KEY_ID: ['console.aws.amazon.com/iam', 'IAM user with AmazonPollyReadOnly. Cheapest voices. Also add the secret + region.'],
    AWS_SECRET_ACCESS_KEY: ['console.aws.amazon.com/iam', 'The secret shown once when you create the access key.'],
    AWS_REGION: ['docs.aws.amazon.com/general/latest/gr/pol.html', 'A region where Polly runs, e.g. us-east-1.'],
  };
  function loadKeys() {
    fetch('/api/keys').then((r) => r.json()).then((list) => {
      const box = $('keysList');
      box.innerHTML = '';
      for (const k of list) {
        const row = document.createElement('div');
        row.className = 'keyrow';
        const help = KEY_HELP[k.env];
        row.innerHTML = `<span class="kname"></span><input type="password" placeholder="${k.set ? 'saved ' + escapeHtml(k.hint) + ' — paste to replace' : 'paste key'}" autocomplete="off">
          <span class="kset">${k.set ? '● ' + (k.source === 'env' ? 'env' : 'set') : ''}</span><button class="btn">Save</button>`;
        row.querySelector('.kname').textContent = KEY_LABELS[k.env] ?? k.env;
        if (help) {
          const a = document.createElement('a');
          a.className = 'khelp'; a.href = 'https://' + help[0]; a.target = '_blank'; a.rel = 'noopener';
          a.textContent = 'how to get ↗'; a.title = help[1]; a.setAttribute('aria-label', `How to get ${KEY_LABELS[k.env] ?? k.env}: ${help[1]}`);
          row.append(a);
        }
        const input = row.querySelector('input');
        row.querySelector('button').addEventListener('click', () => {
          fetch('/api/keys', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ env: k.env, value: input.value.trim() }),
          }).then((r) => r.json()).then((j) => {
            if (j.error) return addMsg('err', j.error);
            input.value = '';
            loadKeys(); loadEngines(); loadVoicePicker(); // refresh availability everywhere
          }).catch((e) => { console.warn('[atlan]', e); });
        });
        box.append(row);
      }
    }).catch(() => {});
  }

  // Voice provider picker (Settings) — lists the roster with honest ready flags;
  // choosing one saves it and takes effect immediately.
  function loadVoicePicker() {
    const sel = $('voiceProviderSel');
    if (!sel) return;
    fetch('/api/voice/roster').then((r) => r.json()).then((list) => {
      sel.innerHTML = '';
      for (const v of list) {
        const o = document.createElement('option');
        o.value = v.id;
        o.textContent = `${v.label} · ${v.cost} · ${v.ssml ? 'SSML' : 'no SSML'}${v.ready ? '' : ' — needs key'}`;
        o.disabled = !v.ready;
        if (v.id === voiceProvider) o.selected = true;
        sel.append(o);
      }
      const cur = list.find((v) => v.id === voiceProvider);
      $('voiceProviderNote').textContent = cur ? cur.note : 'The browser voice always works, free.';
    }).catch(() => {});
    sel.onchange = () => {
      voiceProvider = sel.value;
      localStorage.setItem('atlanVoiceProvider', voiceProvider);
      fetch('/api/voice/roster').then((r) => r.json()).then((list) => {
        const cur = list.find((v) => v.id === voiceProvider);
        if (cur) $('voiceProviderNote').textContent = cur.note;
      }).catch(() => {});
      if (lastReplyText) speak('Voice set.');
    };
  }
  loadVoicePicker();

  // ── session controls (Doctor tab) ──
  $('logoutBtn').addEventListener('click', async () => {
    // Reload regardless: a failed logout POST must not strand the user on a
    // half-logged-out page (async listener → an unguarded reject is silent).
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) { console.warn('[atlan]', e); }
    location.reload();
  });
  $('changePwBtn').addEventListener('click', () => {
    $('pwForm').style.display = $('pwForm').style.display === 'none' ? '' : 'none';
  });
  $('pwSave').addEventListener('click', async () => {
    // Guard the fetch itself: if it rejects, `r` never exists, the inner
    // .catch (bound to r.json()) is unreachable, and Save would fail silently.
    try {
      const r = await fetch('/api/auth/password', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current: $('pwCurrent').value, next: $('pwNext').value }),
      });
      const j = await r.json().catch(() => ({}));
      $('pwMsg').textContent = r.ok ? 'password changed ✓' : (j.error || 'failed');
      if (r.ok) { $('pwCurrent').value = ''; $('pwNext').value = ''; }
    } catch (e) {
      console.warn('[atlan]', e);
      $('pwMsg').textContent = 'failed — check your connection';
    }
  });

  // ── doctor ──
  let lastChecks = []; // kept so the report button can copy exactly what you see
  function loadDoctor() {
    const list = $('doctorList');
    list.innerHTML = '<div class="hint">running checks…</div>';
    fetch('/api/doctor').then((r) => r.json()).then((checks) => {
      lastChecks = checks;
      if (renderDoctor(list, checks)) setMood('alarmed');
    }).catch(() => { list.innerHTML = '<div class="hint">doctor endpoint unreachable</div>'; });
  }
  $('doctorBtn').addEventListener('click', () => { loadDoctor(); loadPreflight(); });
  initEngineLogin({
    panel: $('doctorList'),
    // Its OWN tmux session, never `main`. `main` is the operator's shell — the
    // one they can attach to from Termux — and typing a command into it while
    // something is running injects into that instead.
    openTerm: () => { document.querySelector('nav button[data-s="s-term"]')?.click(); termSession.open('login'); },
    // Only await when a shell has yet to speak; an already-open PTY would never
    // settle this and the caller would wait out its timeout for nothing.
    termReady: () => termSession.ready(),
    write: (t) => termSession.write(t),
    session: () => termSession.session(),
    send,
  });
  initDoctorReport({ button: $('doctorCopy'), getChecks: () => lastChecks, panel: $('doctorList') });

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

  // ── Scan surface: run the vendored PreFlight SAST engine on a project ──
  let scanPopulated = false;
  function loadScan() {
    if (scanPopulated) return;
    scanPopulated = true;
    fetch('/api/projects').then((r) => r.json()).then((list) => {
      const sel = $('scanProjSel');
      for (const p of list) { const o = document.createElement('option'); o.value = p.path; o.textContent = p.name; sel.append(o); }
      if ($('projSel').value) sel.value = $('projSel').value; // default to the picked project
    }).catch(() => {});
  }
  const SEV_UI = ['critical', 'high', 'medium', 'low', 'info'];
  $('scanBtn')?.addEventListener('click', () => {
    const root = $('scanProjSel').value;
    if (!root) return;
    $('scanBtn').disabled = true;
    $('scanMeta').textContent = 'scanning ' + (root.split(/[\\/]/).pop() || root) + ' …';
    $('scanList').innerHTML = '';
    fetch('/api/scan?path=' + encodeURIComponent(root)).then((r) => r.json()).then((res) => {
      $('scanBtn').disabled = false;
      if (res.error) { $('scanMeta').textContent = res.error; return; }
      const counts = {};
      for (const f of res.findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
      // four axes, not one scary number: the headline is Security ("safe to
      // ship"); health/a11y/discoverability are separate so a private cockpit's
      // SEO/complexity findings don't read as risk.
      const ax = res.scores || {};
      const AX = { security: '🛡 Security', health: '🩺 Health', accessibility: '♿ A11y', discoverability: '🔎 Reach' };
      $('scanMeta').innerHTML = '';
      const axRow = document.createElement('div'); axRow.className = 'axisrow';
      for (const a of ['security', 'health', 'accessibility', 'discoverability']) {
        if (!ax[a]) continue;
        const chip = document.createElement('span');
        chip.className = 'axis ' + (ax[a].score >= 90 ? 'ok' : ax[a].score >= 70 ? 'warn' : 'bad');
        chip.textContent = `${AX[a]} ${ax[a].score}`;
        axRow.append(chip);
      }
      const sub = document.createElement('div'); sub.className = 'axissub';
      sub.textContent = `${res.filesCollected} files · `
        + (SEV_UI.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(' · ') || 'clean');
      $('scanMeta').append(axRow, sub);
      const list = $('scanList');
      for (const sev of SEV_UI) {
        const fs = res.findings.filter((f) => f.severity === sev);
        for (const f of fs.slice(0, 60)) {
          const row = document.createElement('button');
          row.className = 'scanrow sev-' + sev;
          row.innerHTML = `<span class="sbadge"></span><span class="stext"></span><span class="sloc"></span>`;
          row.querySelector('.sbadge').textContent = sev;
          row.querySelector('.stext').textContent = `[${f.probe}] ${f.title || f.message || ''}`;
          row.querySelector('.sloc').textContent = `${f.file}:${f.line || '?'}`;
          row.addEventListener('click', () => openScanFinding(root, f.file, f.line));
          list.append(row);
        }
        if (fs.length > 60) { const m = document.createElement('div'); m.className = 'hint'; m.textContent = `… +${fs.length - 60} more ${sev}`; list.append(m); }
      }
      if (!res.findings.length) list.innerHTML = '<div class="hint">clean — no findings 🎉</div>';
    }).catch((e) => { $('scanBtn').disabled = false; $('scanMeta').textContent = String(e); });
  });
  // open a finding's file in the editor at its line (findings are relative to the scan root)
  function openScanFinding(root, relFile, line) {
    const abs = root.replace(/\/$/, '') + '/' + relFile;
    document.querySelector('nav button[data-s="s-editor"]')?.click();
    openInto(abs, edUI).then((f) => {
      if (!f) return; // declined, or unreadable — edUI.fail already said so
      if (line) { const ln = Math.max(0, line - 1); cmEditor.setCursor({ line: ln, ch: 0 }); cmEditor.scrollIntoView({ line: ln, ch: 0 }, 120); }
      cmEditor.refresh(); cmEditor.focus();
    });
  }

  // ── fleet sub-nav: Runs | Routines | Builder ──
  document.querySelectorAll('#fleetSubnav button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#fleetSubnav button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.fpane').forEach((p) => p.classList.remove('active'));
    $(b.dataset.p).classList.add('active');
    if (b.dataset.p === 'fp-routines') loadRoutines();
    if (b.dataset.p === 'fp-builder') loadBuilder();
    if (b.dataset.p === 'fp-hierarchy') loadHierarchy();
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
            .then((x) => x.json()).then((j) => { if (j.error) addMsg('err', j.error); else loadRoutines(); }).catch((e) => { console.warn('[atlan]', e); });
        });
        card.querySelector('.redit').addEventListener('click', () => editRoutine(r));
        card.querySelector('.rtoggle').textContent = r.enabled ? 'disable' : 'enable';
        card.querySelector('.rtoggle').addEventListener('click', () => {
          fetch('/api/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...r, enabled: !r.enabled }) }).then(loadRoutines).catch((e) => { console.warn('[atlan]', e); });
        });
        card.querySelector('.rdel').addEventListener('click', () => {
          fetch('/api/routines/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: r.id }) }).then(loadRoutines).catch((e) => { console.warn('[atlan]', e); });
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
    fetch('/api/routines/pause', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused: !routPaused }) }).then(loadRoutines).catch((e) => { console.warn('[atlan]', e); });
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
    }).catch((e) => { console.warn('[atlan]', e); });
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
        fetch('/api/personas/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: p.id }) }).then(loadBuilder).catch((e) => { console.warn('[atlan]', e); });
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
    }).catch((e) => { console.warn('[atlan]', e); });
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
        fetch('/api/commands/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: c.id }) }).then(loadBuilder).catch((e) => { console.warn('[atlan]', e); });
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
    }).catch((e) => { console.warn('[atlan]', e); });
  });
  $('cCompiled').addEventListener('click', () => {
    const id = cmdEditing ?? commands[0]?.id;
    if (!id) return addMsg('err', 'save a command first');
    fetch(`/api/commands/${id}/compiled`).then((r) => r.json()).then((c) => {
      const out = $('compiledOut');
      out.style.display = '';
      out.textContent = `── SYSTEM PROMPT (persona) ──\n${c.system ?? '(no persona linked)'}\n\n── REQUEST (sent as the user turn) ──\n${c.request}\n\n── RESPONSE JSON-SCHEMA (constrains decoding) ──\n${JSON.stringify(c.responseSchema, null, 1)}\n\n── AS A TOOL (VARIABLES → parameters) ──\n${JSON.stringify(c.toolSchema, null, 1)}`;
    }).catch((e) => { console.warn('[atlan]', e); });
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
        ? `<select data-v="${escapeHtml(v.name)}">${(v.values ?? []).map((x) => `<option>${escapeHtml(x)}</option>`).join('')}</select>`
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
            addMsg('assistant', `Escalated to the fleet as run ${j.id} — the inbox will ping when it surfaces.`);
          }).catch((e) => { console.warn('[atlan]', e); });
      });
      box.append(btn);
    }
  }

  // ── worker hierarchy ──
  let hierJobs = [], hierCommands = [], hierTiers = [], jobEditing = null, hierWatch = null;
  function loadHierarchy() {
    fetch('/api/hierarchy').then((r) => r.json()).then((d) => {
      hierJobs = d.jobs; hierTiers = d.tiers;
      fetch('/api/personas').then((r) => r.json()).then((p) => { hierCommands = p.commands; renderJobs(); }).catch((e) => { console.warn('[atlan]', e); });
    }).catch(() => {});
  }
  function renderJobs() {
    const box = $('jobList');
    box.innerHTML = hierJobs.length ? '' : '<div class="hint">no jobs yet — a job chains structured commands across model tiers</div>';
    for (const jb of hierJobs) {
      const card = document.createElement('div');
      card.className = 'runcard';
      card.innerHTML = `<div class="rtop"><span class="rwho"></span><span class="rstatus"></span></div><div class="rprompt"></div>
        <div class="projbar"><button class="btn hot jstart">▶ run</button><button class="btn ghost jedit">edit</button><button class="btn ghost jdel">✖</button></div>`;
      card.querySelector('.rwho').textContent = jb.title;
      card.querySelector('.rstatus').textContent = `${jb.links.length} link${jb.links.length > 1 ? 's' : ''} · gate: ${jb.humanGate}`;
      card.querySelector('.rprompt').textContent = jb.links.map((l) => (hierCommands.find((c) => c.id === l.commandId)?.name ?? l.commandId)).join(' → ');
      card.querySelector('.jstart').addEventListener('click', () => startJobFlow(jb));
      card.querySelector('.jedit').addEventListener('click', () => editJob(jb));
      card.querySelector('.jdel').addEventListener('click', () => fetch('/api/hierarchy/job/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: jb.id }) }).then(loadHierarchy).catch((e) => { console.warn('[atlan]', e); }));
      box.append(card);
    }
  }
  const LINK_ROW = () => linkRowHtml(hierCommands, hierTiers);
  function addLinkRow(data) {
    const wrap = document.createElement('div');
    wrap.innerHTML = LINK_ROW();
    const row = wrap.firstElementChild;
    row.querySelector('.linkdel').addEventListener('click', () => row.remove());
    if (data) {
      row.querySelector('[data-k="id"]').value = data.id ?? '';
      row.querySelector('[data-k="commandId"]').value = data.commandId ?? '';
      row.querySelector('[data-k="inputsFrom"]').value = (data.inputsFrom ?? []).join(', ');
      row.querySelector('[data-k="startTier"]').value = data.startTier ?? 'local';
      row.querySelector('[data-k="onCheckerFail"]').value = data.onCheckerFail ?? 'escalate';
      row.querySelectorAll('[data-tier]').forEach((cb) => { cb.checked = (data.escalation ?? []).includes(cb.dataset.tier); });
    }
    $('linkRows').append(row);
  }
  function editJob(jb) {
    jobEditing = jb?.id ?? null;
    $('jobForm').style.display = '';
    $('jobTitle').value = jb?.title ?? '';
    $('jobGate').value = jb?.humanGate ?? 'on-tier3';
    $('jobBudget').value = String(jb?.budget ?? 200000);
    $('linkRows').innerHTML = '';
    // null, not {} — {} is truthy, so it took addLinkRow's "restore a saved
    // link" branch and set commandId '' on a <select> with no empty option,
    // blanking the picker. null takes the ＋ link path, which never had this.
    (jb?.links?.length ? jb.links : [null]).forEach(addLinkRow);
  }
  $('jobNewBtn').addEventListener('click', () => editJob(null));
  $('jobCancel').addEventListener('click', () => { $('jobForm').style.display = 'none'; jobEditing = null; });
  $('linkAdd').addEventListener('click', () => addLinkRow());
  $('jobSave').addEventListener('click', () => {
    const links = [...$('linkRows').querySelectorAll('.linkedit')].map((row) => ({
      id: row.querySelector('[data-k="id"]').value.trim(),
      commandId: row.querySelector('[data-k="commandId"]').value,
      inputsFrom: row.querySelector('[data-k="inputsFrom"]').value.split(',').map((s) => s.trim()).filter(Boolean),
      startTier: row.querySelector('[data-k="startTier"]').value,
      escalation: [...row.querySelectorAll('[data-tier]')].filter((cb) => cb.checked).map((cb) => cb.dataset.tier),
      onCheckerFail: row.querySelector('[data-k="onCheckerFail"]').value,
    }));
    fetch('/api/hierarchy/job', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: jobEditing ?? undefined, title: $('jobTitle').value, humanGate: $('jobGate').value, budget: Number($('jobBudget').value), links }),
    }).then((r) => r.json()).then((jb) => {
      if (jb.error) return addMsg('err', jb.error);
      $('jobForm').style.display = 'none'; jobEditing = null; loadHierarchy();
    }).catch((e) => { console.warn('[atlan]', e); });
  });
  function startJobFlow(jb) {
    const need = jb.links.flatMap((l) => hierCommands.find((c) => c.id === l.commandId)?.variables ?? []);
    const uniq = [...new Map(need.map((v) => [v.name, v])).values()];
    const input = {};
    for (const v of uniq) {
      const val = prompt(`Job input — ${v.name} (${v.type}):`);
      if (val === null) return;
      input[v.name] = v.type === 'number' ? Number(val) : val;
    }
    fetch('/api/hierarchy/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: jb.id, input }) })
      .then((r) => r.json()).then((run) => { if (run.error) return addMsg('err', run.error); hierWatch = run.id; paintHierRun(run); }).catch((e) => { console.warn('[atlan]', e); });
  }
  function paintHierRun(run) {
    hierWatch = run.id;
    const box = $('hierRun');
    box.style.display = '';
    const stepHtml = run.steps.map((s) => {
      const checks = (s.checks ?? []).map((c) => `<div class="hchk ${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} t${c.tier} ${escapeHtml(c.check)}${c.ok ? '' : ' — ' + escapeHtml(String(c.got ?? ''))}</div>`).join('');
      return `<div class="hstep st-${s.status}">
        <div class="htop"><b>${escapeHtml(s.linkId)}</b> · ${escapeHtml(s.command)} <span class="htier">${s.tier}${s.escalations ? ` (↑${s.escalations})` : ''}</span><span class="hstat">${s.status}</span></div>
        ${s.note ? `<div class="hnote">${escapeHtml(s.note)}</div>` : ''}
        ${checks}
        ${s.output ? `<pre class="rresult" style="display:block">${escapeHtml(JSON.stringify(s.output, null, 1))}</pre>` : ''}</div>`;
    }).join('');
    box.innerHTML = `<div class="eyebrow">Run ${run.id} · ${run.status} · ${fmtTok(run.tokens)}/${fmtTok(run.budget)} tok</div>${stepHtml}
      ${run.awaiting ? `<div class="hgate"><b>Needs you</b> — approve the output of "${escapeHtml(run.awaiting.linkId)}"?<div class="projbar"><button class="btn hot" id="gateOk">Approve</button><button class="btn ghost" id="gateNo">Reject</button></div></div>` : ''}
      ${run.result && typeof run.result === 'object' ? `<div class="eyebrow" style="margin-top:6px">Final</div><pre class="rresult" style="display:block">${escapeHtml(JSON.stringify(run.result.final ?? run.result, null, 1))}</pre>` : run.result ? `<div class="hnote">${escapeHtml(String(run.result))}</div>` : ''}`;
    if (run.awaiting) {
      $('gateOk').addEventListener('click', () => resolveGate(run.id, true));
      $('gateNo').addEventListener('click', () => resolveGate(run.id, false));
    }
  }
  function resolveGate(runId, approve) {
    fetch('/api/hierarchy/gate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId, approve }) })
      .then((r) => r.json()).then((run) => { if (run.error) return addMsg('err', run.error); paintHierRun(run); }).catch((e) => { console.warn('[atlan]', e); });
  }

  // 🧇 the waffles fall
  function waffleRain() {
    const layer = document.createElement('div');
    layer.className = 'waffles-egg';
    for (let i = 0; i < 24; i++) {
      const w = document.createElement('span');
      w.textContent = '🧇';
      w.style.left = Math.round((i / 24) * 100) + '%';
      w.style.animationDelay = (i % 8) * 0.12 + 's';
      w.style.fontSize = 16 + (i % 4) * 7 + 'px';
      layer.append(w);
    }
    document.body.append(layer);
    setTimeout(() => layer.remove(), 4200);
  }

  // Ask the server where the preview lives before anything can open it. On
  // failure previewUrl() still returns the http answer, so a cockpit on plain
  // loopback keeps working even if this request never lands.
  fetch('/api/config').then((r) => r.json()).then(resolvePreviewUrl).catch(() => resolvePreviewUrl(null));
  connect();
  greet();
  initVoice();

  // Chat survives a refresh now. The seeded greeting stays only when there is
  // nothing to restore — replaying a conversation under "Pick a project below"
  // would read as a new session that had somehow already happened.
  const replay = (id) => {
    chatlog.textContent = '';
    restoreChat(addMsg, id).then((n) => { if (!n) addMsg('assistant', 'New conversation. Say anything.'); scroll(); });
  };
  restoreChat(addMsg).then((n) => { if (n) { chatlog.firstElementChild?.remove(); scroll(); } });
  $('histBtn').addEventListener('click', () => openHistory({ panel: $('histPanel'), onOpen: replay }));
  $('newChatBtn').addEventListener('click', () => { newConversation(); replay(); autoApprove?.refresh(); });
  initPreviewMax({ section: $('s-preview'), button: $('previewMax') }); initComposerHint({ select: $('modelSel'), input: $('chatInput') });
  // Remembered PER CONVERSATION, so arming one chat to build never arms the next.
  autoApprove = initAutoApprove({ select: $('autoSel'), conv: convId });
  // Give the conversation its screen back: header tucks while reading, set-once
  // controls fold. The nav bar stays — it is the only route between eight panels.
  initFocusMode({ button: $('focusBtn'), header: document.querySelector('header'), rows: [$('chatProjBar'), $('ctrlToggle')] });
  initControlCollapse({ toggle: $('ctrlToggle'), panel: $('ctrlPanel'), also: [$('attachRefRow')] });
})();
