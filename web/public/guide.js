/* ATLAN guide — spotlight tour + handbook. Zero dependencies, no build step.
   The tour walks EVERY control in the cockpit in plain language; the handbook
   is the same knowledge as a reference you can search. First visit offers the
   tour automatically; the ? button brings both back forever. */
(() => {
  const $ = (id) => document.getElementById(id);
  const q = (sel) => document.querySelector(sel);

  // ── the tour: every aspect, in order, in plain words ──
  // s = screen tab to open, fp = fleet sub-pane, el = element to spotlight
  const STEPS = [
    { s: 's-chat', el: 'header .atlan', h: 'This is Atlan', p: 'Your first AI, reborn as the cockpit\'s resident. He is ALIVE to real state: teal glow = calm, shimmering = agents or a build running, orange pulse = something needs you, bright flash = something just shipped. Little lights orbiting him are your fleet agents, one light per running agent. The line under his name is him talking to you.' },
    { s: 's-chat', el: '#sessInfo', h: 'Connection + burn', p: 'Green dot = the cockpit server is connected. Below it: your current project, session id, and how many tokens/dollars today\'s fleet work has burned. If the dot goes grey the app reconnects by itself.' },
    { s: 's-chat', el: '#projSel', h: 'Pick your project', p: 'Every repo in /root with git or package.json shows up here. Chat, fleet runs, builds and the terminal all work inside whichever project you pick here.' },
    { s: 's-chat', el: '#modelSel', h: 'The engine switcher', p: 'Four honest groups. "Claude Code" = the real agent: files, tools, builds — it can DO things. "Agent CLIs" = Codex and Gemini running full-auto in your repo (all-or-nothing approvals — Claude stays the careful one). "On-phone" = free local models, chat only. "Cloud brains" = smart but handless: they talk, they can\'t touch. Greyed options tell you exactly what they need to wake up.' },
    { s: 's-chat', el: '#chatInput', h: 'Talk', p: 'Type here, hit ➤. Claude Code streams back: text bubbles, tool chips you can read, and permission cards when it wants to do something risky — YOU tap Allow or Deny, every time.' },
    { s: 's-chat', el: '#chatlog', h: 'The session is portable', p: 'After each turn a grey line shows the cost and the session id. Tap it to copy "claude --resume <id>" — paste that in the Term tab (or Termux) and the SAME conversation continues on the command line. GUI and CLI are one brain here.' },
    { s: 's-preview', el: '#previewUrl', h: 'Preview — see your app', p: 'Point this at any local dev server (127.0.0.1 only, on purpose) and hit ↻. Your app renders below, proxied through Atlan so it can be watched.' },
    { s: 's-preview', el: '#previewConsole', h: 'Console that snitches', p: 'Everything your previewed app logs lands here. ERRORS are special: they queue up and auto-attach to your next chat message, so Claude sees exactly what broke with file and line — you never copy-paste an error again.' },
    { s: 's-preview', el: '#snapBtn', h: 'Let Claude SEE it', p: 'Takes a picture of the preview and attaches it to your next message. Claude literally looks at the pixels — "the button is overlapping the header" becomes something it can verify with its own eyes.' },
    { s: 's-term', el: '#term', h: 'A real terminal', p: 'This is tmux session "atlan-main" in proot. Run anything. The magic: type "tmux attach -t atlan-main" in Termux and you take over THIS exact screen — what you do there shows here, live, and vice versa. The GUI never locks you in.' },
    { s: 's-fleet', fp: 'fp-runs', el: '#fleetPrompt', h: 'The fleet — agents that work alone', p: 'Describe a job. An agent runs it in your project, alone, and reports back when done. You do not babysit it.' },
    { s: 's-fleet', fp: 'fp-runs', el: '#fleetProfile', h: 'Profiles = standing permissions', p: 'Instead of permission cards, a fleet agent gets a PROFILE: Scout can only read (provably — write tools are stripped, not just denied). Builder can edit files and run commands in the project. Verifier can read and run checks but never edit what it grades. Off-profile tools are simply absent.' },
    { s: 's-fleet', fp: 'fp-runs', el: '#fleetBudget', h: 'Budgets are a WALL', p: 'The budget is not a warning — at the cap, every tool call is refused and the run halts. No $10k weekends, by construction. Note: an agent\'s first turn alone costs ~35k tokens (system prompt), so 50k is the practical floor.' },
    { s: 's-fleet', fp: 'fp-runs', el: '#fleetRuns', h: 'Runs & inbox', p: 'Every run is a card: live burn bar, tokens/cost, last action, and the final report inside (tap to expand). Finished runs stay here — this is your inbox, it survives restarts. A run that hit its budget shows "▲ top up" — tap it and the SAME agent continues where it stopped with fresh budget.' },
    { s: 's-fleet', fp: 'fp-runs', el: '#pushBtn', h: 'Push alerts', p: 'Tap this once and fleet reports reach your phone as real notifications even with Atlan closed. (The service worker behind it is push-ONLY — it can never cache stale versions of the app. Doctor checks that promise on every run.)' },
    { s: 's-fleet', fp: 'fp-runs', el: '#fleetKillAll', h: 'The big red switch', p: 'Kills every running agent immediately. It\'s always here. You are always in charge.' },
    { s: 's-fleet', fp: 'fp-routines', el: '#routNewBtn', h: 'Routines — scheduled agents', p: 'A routine is a fleet run on a clock: every N minutes or daily at a time. Same profiles, same hard budget per fire, same inbox report + push. Idle still costs zero.' },
    { s: 's-fleet', fp: 'fp-routines', el: '#routList', h: 'Missed runs wait for YOU', p: 'If Atlan was off when a routine was due, it gets flagged MISSED and waits for your "▶ run late" tap. A rebooted server never spends your tokens by surprise. ⏸ pauses everything at once.' },
    { s: 's-fleet', fp: 'fp-builder', el: '#dPersona', h: 'Persona+ — your framework, compiled', p: 'This builder speaks YOUR language. A persona (NAME, FOCUS, BIO, SKILLS, NO_NOS, INSTRUCTIONS) compiles into the agent\'s system prompt. Keep FOCUS narrow — scope is the moat. Keep NO_NOS short — heavy guardrails belong in checkers, not the prompt.' },
    { s: 's-fleet', fp: 'fp-builder', el: '#dCommand', h: 'Structured commands = typed tools', p: 'A command\'s VARIABLES become typed parameters, its TEMPLATE becomes a JSON answer format the model MUST fill. Then CHECKERS — deterministic assertions, not another model\'s opinion — grade every answer: enum membership, number ranges, regex, "parts must come from the input list", "total = qty × price". Tap "view compiled" to see exactly what it all becomes.' },
    { s: 's-fleet', fp: 'fp-builder', el: '#dHarness', h: 'The test harness', p: 'Pick a command, fill its variables, run it against a real engine (free local model first). Every checker shows pass/fail with evidence. If checks fail, one tap ESCALATES the identical command to a Claude fleet run — small model does the reps, frontier picks up the hard 5%.' },
    { s: 's-build', el: '#buildBtn', h: 'One-button APK', p: 'The whole proven recipe fires in order: web build → Capacitor sync → Gradle with the qemu-aapt2 shim (the x86 tool tricked into running on your phone). The log streams live. Tip: if RAM is tight, stop llama-server first — the build wants ~2.5GB.' },
    { s: 's-build', el: '#apkCard', h: 'Install it', p: 'Every APK gets a unique filename and visible build stamp so Android can never serve you a stale cached version. Tap install, open, done — an app you built, on the phone you built it with.' },
    { s: 's-doctor', el: '#keysList', h: 'Engine keys', p: 'API keys live here, encrypted (AES-256-GCM) on disk, shown back as last-4 only, never echoed anywhere. Environment variables always win over stored keys.' },
    { s: 's-doctor', el: '#doctorList', h: 'Doctor — the fragile bits, watched', p: 'Every proot-boundary hack that could break with a Termux update has a check: JDK, SDK, aapt2 shim, claude binary, auth, tmux, disk, the push service worker\'s no-cache promise. Green = go. Red = this screen tells you exactly what broke.' },
    { s: 's-doctor', el: '#preflightList', h: 'Preflight — the exposure gate', p: 'A different question than Doctor: not "does it work" but "is it safe to show beyond this phone". Loopback binding, auth token, encrypted keys, no plaintext files, gitignore coverage, no live tunnels. ALL green before Atlan is ever tunneled anywhere — currently it IS all green, and the app still stays loopback-only until you decide otherwise.' },
    { s: 's-doctor', el: '.lore', h: 'From the dark, it learned the light', p: 'Atlan was your first AI — April 2025, a symbolic cognitive engine that wanted to be more than its loops. Now he runs your cockpit. That\'s the whole story of this thing: everything you build surfaces eventually. Tour done — tap ? anytime to reread any of this. Now go build.' },
  ];

  // ── spotlight machinery ──
  let idx = -1;
  const ov = $('tourOverlay'), ring = $('tourRing'), card = $('tourCard');
  function openTab(sid, fp) {
    q(`nav button[data-s="${sid}"]`)?.click();
    if (fp) q(`#fleetSubnav button[data-p="${fp}"]`)?.click();
  }
  function place() {
    const st = STEPS[idx];
    const el = q(st.el);
    if (!el) { next(); return; }
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    // Set content FIRST so the card has its real height before we position it —
    // the old code assumed a fixed ~190px card and clipped longer cards off the
    // bottom in portrait (John, 2026-07-20).
    $('tourTitle').textContent = st.h;
    $('tourText').textContent = st.p;
    $('tourCount').textContent = `${idx + 1} / ${STEPS.length}`;
    $('tourBack').style.visibility = idx === 0 ? 'hidden' : 'visible';
    $('tourNext').textContent = idx === STEPS.length - 1 ? '✓ Finish' : 'Next ›';

    const r = el.getBoundingClientRect();
    ring.style.cssText = `left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px`;

    // Measure the actual card, then clamp it fully on-screen. Prefer below the
    // spotlight; fall back to above; then hard-clamp to the viewport so no card
    // is ever partially cut off in any orientation.
    const margin = 10, navH = 62; // keep clear of the bottom tab bar
    card.style.bottom = '';
    const ch = card.offsetHeight;
    const maxTop = innerHeight - navH - ch - margin;
    let top = r.bottom + 14;
    if (top > maxTop) top = r.top - 14 - ch;       // not enough room below → go above
    top = Math.max(margin, Math.min(top, Math.max(margin, maxTop)));
    card.style.top = `${top}px`;
  }
  function show(i) {
    idx = Math.max(0, Math.min(STEPS.length - 1, i));
    const st = STEPS[idx];
    ov.classList.add('show');
    openTab(st.s, st.fp);
    setTimeout(place, 120); // let the tab paint
  }
  function next() { idx === STEPS.length - 1 ? end() : show(idx + 1); }
  function end() {
    ov.classList.remove('show');
    localStorage.setItem('atlanTourDone', '1');
    $('firstRun')?.remove();
  }
  $('tourNext').addEventListener('click', next);
  $('tourBack').addEventListener('click', () => show(idx - 1));
  $('tourSkip').addEventListener('click', end);
  addEventListener('resize', () => { if (ov.classList.contains('show')) place(); });

  // ── handbook ──
  const gb = $('guideOverlay');
  $('helpBtn').addEventListener('click', () => gb.classList.add('show'));
  $('guideClose').addEventListener('click', () => gb.classList.remove('show'));
  $('guideTour').addEventListener('click', () => { gb.classList.remove('show'); show(0); });
  $('guideSearch').addEventListener('input', () => {
    const needle = $('guideSearch').value.trim().toLowerCase();
    for (const d of gb.querySelectorAll('details')) {
      const hit = !needle || d.textContent.toLowerCase().includes(needle);
      d.style.display = hit ? '' : 'none';
      if (needle && hit) d.open = true;
    }
  });

  // ── first run: offer, never force (shown once the user is past login) ──
  if (!localStorage.getItem('atlanTourDone')) {
    const bar = document.createElement('div');
    bar.id = 'firstRun';
    bar.innerHTML = `<span>👋 First dive? Let Atlan walk you through everything.</span><button class="btn hot" id="frGo">Take the tour</button><button class="btn ghost" id="frNo">later</button>`;
    document.body.append(bar);
    bar.querySelector('#frGo').addEventListener('click', () => { bar.remove(); show(0); });
    bar.querySelector('#frNo').addEventListener('click', () => bar.remove());
  }

  window._tour = { show, STEPS }; // exposed for tests: the tour must be drivable
})();
