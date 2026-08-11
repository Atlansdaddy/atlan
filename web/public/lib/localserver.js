// localserver.js — the one-button llama-server toggle + model picker.
//
// Lifted out of app.js by the ceiling ratchet. The surface owns three coupled
// things — the running/stopped state, which model to serve, and the busy latch
// while a start/stop is in flight — that nothing else should reach past.
//
// The picker is disabled while a server is running: you cannot swap the model
// out from under a live generation, so switching means Stop first. Start sends
// the chosen model; Stop frees the RAM the on-device build needs.

/**
 * @param {object} o
 * @param {(id:string)=>Element} o.$   element getter (app.js's own)
 * @param {(msg:string)=>void}   o.notify  error surface
 * @returns {Function} load — call to (re)poll status
 */
export function initLocalServer({ $, notify }) {
  let busy = false;
  let models = [];

  function paint(j) {
    if (!j || !j.available) { $('lsHead').hidden = $('lsBar').hidden = $('lsNote').hidden = true; return; }
    $('lsHead').hidden = $('lsBar').hidden = false;
    $('lsDot').classList.toggle('on', !!j.running);
    if (Array.isArray(j.models) && j.models.length && j.models.length !== models.length) {
      models = j.models;
      const sel = $('lsModel'); const keep = sel.value;
      sel.innerHTML = '';
      for (const m of j.models) {
        const o = document.createElement('option');
        o.value = m.name; o.textContent = `${m.name.replace(/\.gguf$/, '')} · ${m.gb}GB`;
        sel.append(o);
      }
      if (keep) sel.value = keep;
    }
    if (j.running && j.model) $('lsModel').value = j.model;
    $('lsModel').disabled = j.running || busy;
    const btn = $('lsToggle');
    btn.textContent = busy ? '…' : (j.running ? 'Stop' : 'Start');
    btn.disabled = busy;
    btn.dataset.running = j.running ? '1' : '';
  }

  function load() {
    fetch('/api/local/server').then((r) => r.json()).then(paint).catch(() => {});
  }

  $('lsToggle')?.addEventListener('click', () => {
    if (busy) return;
    const running = $('lsToggle').dataset.running === '1';
    const model = $('lsModel').value;
    busy = true; paint({ available: true, running, model, models });
    $('lsNote').hidden = false;
    $('lsNote').textContent = running ? 'Stopping…' : `Starting ${model.replace(/\.gguf$/, '')} — the model takes a moment to load…`;
    fetch('/api/local/server', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(running ? { action: 'stop' } : { action: 'start', model }),
    }).then((r) => r.json()).then((j) => {
      busy = false;
      if (j.error) { $('lsNote').textContent = j.error; notify?.(j.error); load(); return; }
      $('lsNote').textContent = j.running
        ? `Local brain up · ${(j.model ?? '').replace(/\.gguf$/, '')} — pick it as the engine in Chat. Stop it before a build to free RAM.`
        : 'Local brain stopped — RAM is free for a build.';
      paint(j);
    }).catch((e) => { busy = false; $('lsNote').textContent = String(e); load(); });
  });

  return load;
}
