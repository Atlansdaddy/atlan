// Mock OpenAI-compat engine for harness receipts: deterministic, no model, no
// RAM. ?mode=good returns a correct REQUEST_ESTIMATE answer; ?mode=bad returns
// a checker-violating one (wrong math, stray part, off-enum category).
import { createServer } from 'node:http';
const PORT = Number(process.env.MOCK_PORT || 8098);
const answers = {
  good: { category: 'washer', parts: ['drain pump'], line_total: 179.98, note: 'Drain pump replacement, standard labor.' },
  bad: { category: 'spaceship', parts: ['flux capacitor'], line_total: 999, note: '' },
};
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const mode = process.env.MOCK_MODE || 'good';
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end('{"status":"ok"}');
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(answers[mode]) } }],
      usage: { total_tokens: 42 },
    }));
  });
}).listen(PORT, '127.0.0.1', () => console.log('mock engine :' + PORT + ' mode=' + (process.env.MOCK_MODE || 'good')));
