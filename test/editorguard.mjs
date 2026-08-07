// editorguard.mjs — unit tests for the two guards that stand between a tap and
// irreversible loss: opening over unsaved work, and saving onto a file you
// never opened.
//
// The UI spec (test/ui-editor.spec.mjs) proves the guards fire in a real
// browser. These prove the DECISIONS are right without one, which is where the
// interesting cases live: a save onto the SAME file must not nag, a save onto a
// path that does not exist yet must not nag, and a declined dialog must leave
// the disk untouched. A guard that asks every time gets dismissed unread, so
// "does not ask" is as much a requirement as "asks".

import assert from 'node:assert';

import {
  isDirty, fileExists, openInto, saveTo, DISCARD_MSG, overwriteMsg,
} from '../web/public/lib/editorguard.js';

let pass = 0, fail = 0;
const test = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
};

/** A fake cockpit: records what the UI was told and what hit the wire. */
function harness({ disk = {}, dirty = '', answer = true } = {}) {
  const h = {
    asked: [], failed: [], loaded: null, savedAs: null, current: null,
    disk: { ...disk },
    ask: (m) => { h.asked.push(m); return answer; },
    ui: {
      dirty: () => dirty,
      current: () => h.current,
      load: (f) => { h.loaded = f; h.current = f.path; },
      saved: (f) => { h.savedAs = f; h.current = f.path; },
      fail: (m) => h.failed.push(m),
    },
    fetchFn: async (url, opts) => {
      if (opts?.method === 'POST') {
        const { path, content } = JSON.parse(opts.body);
        h.disk[path] = content;
        return { json: async () => ({ path, name: path.split('/').pop(), bytes: content.length }) };
      }
      const path = decodeURIComponent(new URL(url, 'http://x').searchParams.get('path'));
      return {
        json: async () => (path in h.disk
          ? { path, name: path.split('/').pop(), content: h.disk[path] }
          : { error: 'no such file' }),
      };
    },
  };
  return h;
}
const opts = (h) => ({ fetchFn: h.fetchFn, ask: h.ask });

console.log('\nisDirty');
await test('reads app.js’s own #edDirty vocabulary, not a boolean', () => {
  assert.equal(isDirty('● unsaved'), true);
  assert.equal(isDirty('saved ✓'), false);
  assert.equal(isDirty(''), false);
  assert.equal(isDirty(null), false, 'a missing readout must not read as dirty');
});

console.log('\nfileExists');
await test('a readable path exists, a missing one does not', async () => {
  const h = harness({ disk: { '/p/a.js': 'A' } });
  assert.equal(await fileExists('/p/a.js', h.fetchFn), true);
  assert.equal(await fileExists('/p/gone.js', h.fetchFn), false);
});
await test('an unreachable server does not claim the file exists', async () => {
  const boom = async () => { throw new Error('offline'); };
  assert.equal(await fileExists('/p/a.js', boom), false);
});

console.log('\nopenInto');
await test('a clean buffer opens with no dialog at all', async () => {
  const h = harness({ disk: { '/p/a.js': 'A' } });
  const f = await openInto('/p/a.js', h.ui, opts(h));
  assert.equal(f.content, 'A');
  assert.deepEqual(h.asked, [], 'nagged on a clean buffer');
});
await test('unsaved work is not replaced without asking', async () => {
  const h = harness({ disk: { '/p/a.js': 'A' }, dirty: '● unsaved', answer: false });
  assert.equal(await openInto('/p/a.js', h.ui, opts(h)), null);
  assert.deepEqual(h.asked, [DISCARD_MSG]);
  assert.equal(h.loaded, null, 'declined, but the buffer was replaced anyway');
});
await test('saying yes to the discard actually opens the file', async () => {
  const h = harness({ disk: { '/p/a.js': 'A' }, dirty: '● unsaved', answer: true });
  assert.equal((await openInto('/p/a.js', h.ui, opts(h))).content, 'A');
  assert.equal(h.asked.length, 1);
});
await test('a file that cannot be read says so on the editor, not just in chat', async () => {
  const h = harness();
  assert.equal(await openInto('/p/gone.js', h.ui, opts(h)), null);
  assert.deepEqual(h.failed, ['no such file'], 'the reason never reached ui.fail');
});
await test('a thrown fetch is reported, not swallowed', async () => {
  const h = harness();
  h.fetchFn = async () => { throw new Error('offline'); };
  assert.equal(await openInto('/p/a.js', h.ui, opts(h)), null);
  assert.match(h.failed[0] ?? '', /offline/, 'a network failure vanished silently');
});

console.log('\nsaveTo');
await test('saving over the file you already have open does NOT nag', async () => {
  const h = harness({ disk: { '/p/a.js': 'A' } });
  await openInto('/p/a.js', h.ui, opts(h));
  await saveTo('/p/a.js', 'A2', h.ui, opts(h));
  assert.deepEqual(h.asked, [], 'nagged on an ordinary save — this is the common case');
  assert.equal(h.disk['/p/a.js'], 'A2');
});
await test('saving to a path that does not exist yet does NOT nag', async () => {
  const h = harness({ disk: { '/p/a.js': 'A' } });
  await openInto('/p/a.js', h.ui, opts(h));
  await saveTo('/p/new.js', 'N', h.ui, opts(h));
  assert.deepEqual(h.asked, [], 'save-as to a fresh path is not destructive');
  assert.equal(h.disk['/p/new.js'], 'N');
});
await test('saving onto a DIFFERENT existing file asks first', async () => {
  const h = harness({ disk: { '/p/a.js': 'A', '/p/b.js': 'B' }, answer: false });
  await openInto('/p/a.js', h.ui, opts(h));
  assert.equal(await saveTo('/p/b.js', 'A', h.ui, opts(h)), null);
  assert.deepEqual(h.asked, [overwriteMsg('/p/b.js')]);
  assert.equal(h.disk['/p/b.js'], 'B', 'DECLINED, and b.js was destroyed anyway');
});
await test('confirming the overwrite does write it', async () => {
  const h = harness({ disk: { '/p/a.js': 'A', '/p/b.js': 'B' }, answer: true });
  await openInto('/p/a.js', h.ui, opts(h));
  await saveTo('/p/b.js', 'A', h.ui, opts(h));
  assert.equal(h.disk['/p/b.js'], 'A');
  assert.equal(h.savedAs.name, 'b.js', 'ui.saved must name the file actually written');
});
await test('an empty path is refused on the editor surface', async () => {
  const h = harness();
  assert.equal(await saveTo('', 'x', h.ui, opts(h)), null);
  assert.deepEqual(h.failed, ['set a path to save to']);
});
await test('a server refusal reaches ui.fail', async () => {
  const h = harness();
  h.fetchFn = async () => ({ json: async () => ({ error: "Atlan's own files aren't editable here" }) });
  assert.equal(await saveTo('/p/x.js', 'x', h.ui, opts(h)), null);
  assert.match(h.failed[0] ?? '', /aren't editable/, 'a REJECTED save was silent on the editor');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
