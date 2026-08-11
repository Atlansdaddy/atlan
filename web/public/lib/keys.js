// keys.js — the Doctor's engine keys, grouped by errand.
//
// Lifted out of app.js by the ceiling ratchet when the flat list learned to
// fold. Worth extracting on its own merits too: the key surface owns three
// coupled pieces (the provider roster, the how-to-get links, and the
// voice/LLM split) that nothing else should reach past.
//
// Voice keys are a different errand from LLM keys — different consoles,
// different reason to be there — and one flat list buried both under a
// twenty-row scroll. Two collapsible groups wear their state on the outside
// (how many set, of how many), so neither needs opening just to know where
// you stand. Open/closed is remembered per device.
import { escapeHtml } from './text.js';

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

const VOICE_ENVS = new Set([
  'ELEVENLABS_API_KEY', 'PIPER_MODEL', 'CARTESIA_API_KEY', 'DEEPGRAM_API_KEY',
  'GOOGLE_TTS_API_KEY', 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION',
]);

/**
 * Wires the key groups to their container.
 *
 * @param {object}   o
 * @param {Element}  o.box      the #keysList container
 * @param {Function} o.notify   (msg) => void, error surface
 * @param {Function} o.onSaved  () => void, refresh availability everywhere a key matters
 * @returns {Function} call it to (re)load the groups
 */
export function initKeys({ box, notify, onSaved }) {
  function keyRow(k) {
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
        if (j.error) return notify(j.error);
        input.value = '';
        load(); onSaved(); // refresh availability everywhere
      }).catch((e) => { console.warn('[atlan]', e); });
    });
    return row;
  }

  function load() {
    fetch('/api/keys').then((r) => r.json()).then((list) => {
      box.innerHTML = '';
      const buckets = [
        { id: 'llm', name: 'LLM engines', blurb: 'Metered chat models. Everything works without any — they unlock more models.', rows: list.filter((k) => !VOICE_ENVS.has(k.env)) },
        { id: 'voice', name: 'Voice', blurb: 'Speech in and out. The free browser voice always works; these unlock nicer ones.', rows: list.filter((k) => VOICE_ENVS.has(k.env)) },
      ];
      for (const b of buckets) {
        if (!b.rows.length) continue;
        const wrap = document.createElement('details');
        wrap.className = 'docgroup keygroup';
        // LLM starts open (it is the primary errand), voice starts closed;
        // after that the device's own choice wins.
        const memo = localStorage.getItem('keysOpen.' + b.id);
        wrap.open = memo === null ? b.id === 'llm' : memo === '1';
        wrap.addEventListener('toggle', () => localStorage.setItem('keysOpen.' + b.id, wrap.open ? '1' : '0'));
        const head = document.createElement('summary');
        head.className = 'docgroup-head';
        const name = document.createElement('span');
        name.className = 'docgroup-name';
        name.textContent = b.name;
        const set = b.rows.filter((k) => k.set).length;
        const badge = document.createElement('span');
        badge.className = 'docgroup-badge' + (set ? ' pass' : '');
        badge.textContent = `${set} of ${b.rows.length} set`;
        const blurb = document.createElement('span');
        blurb.className = 'docgroup-blurb';
        blurb.textContent = b.blurb;
        head.append(name, badge, blurb);
        wrap.append(head);
        for (const k of b.rows) wrap.append(keyRow(k));
        box.append(wrap);
      }
    }).catch(() => {});
  }

  return load;
}
