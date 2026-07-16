import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APKDIR = join(__dirname, '../../.apk');
const COUNTER = join(__dirname, '../../.builds.json');
mkdirSync(APKDIR, { recursive: true });

export const APK_DIR = APKDIR;

let running = null;

function nextStamp(proj) {
  let counts = {};
  try { counts = JSON.parse(readFileSync(COUNTER, 'utf8')); } catch { /* first build */ }
  counts[proj] = (counts[proj] ?? 0) + 1;
  writeFileSync(COUNTER, JSON.stringify(counts));
  return 'B' + counts[proj];
}

// The proven all-in-proot recipe (see docs + proot-android-apk-build memory):
// env.sh (JAVA_HOME/SDK/PATH) → CAP_BUILD=1 web build (self-destroying SW) →
// cap sync → gradle assembleDebug (memory-capped, qemu-aapt2 via gradle.properties).
export function runBuild(projPath, send) {
  if (running) {
    send({ t: 'build.err', msg: `a build for ${running} is already running` });
    return;
  }
  const proj = basename(projPath);
  if (!existsSync(join(projPath, 'android'))) {
    send({ t: 'build.err', msg: `${proj} has no android/ dir — not a Capacitor project (yet). Ask Claude to wrap it.` });
    return;
  }
  running = proj;
  const stamp = nextStamp(proj);
  const started = Date.now();
  const hasBuildScript = (() => {
    try { return !!JSON.parse(readFileSync(join(projPath, 'package.json'), 'utf8')).scripts?.build; }
    catch { return false; }
  })();

  const script = `
set -e
source /root/android-sdk/env.sh
cd ${projPath}
${hasBuildScript ? 'echo "── web build (CAP_BUILD=1) ──" && CAP_BUILD=1 npm run build' : 'echo "── no web build script, skipping ──"'}
if grep -q '"@capacitor/cli"' package.json 2>/dev/null; then echo "── cap sync ──" && npx cap sync android; fi
echo "── gradle assembleDebug ──"
cd android && ./gradlew assembleDebug --no-daemon
`;
  send({ t: 'build.start', proj, stamp });
  const child = spawn('bash', ['-c', script], { env: process.env });
  const onLine = (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) send({ t: 'build.log', line: line.slice(0, 300) });
    }
  };
  child.stdout.on('data', onLine);
  child.stderr.on('data', onLine);
  child.on('close', (code) => {
    running = null;
    if (code !== 0) {
      send({ t: 'build.err', msg: `build failed (exit ${code}) — see log above` });
      send({ t: 'atlan.mood', mood: 'alarmed' });
      return;
    }
    const built = join(projPath, 'android/app/build/outputs/apk/debug/app-debug.apk');
    if (!existsSync(built)) {
      send({ t: 'build.err', msg: 'gradle succeeded but no app-debug.apk found' });
      return;
    }
    // unique filename per build — the MediaStore-staleness dodge
    const name = `${proj}-${stamp}.apk`;
    copyFileSync(built, join(APKDIR, name));
    const mb = (statSync(built).size / 1048576).toFixed(1);
    send({
      t: 'build.done',
      proj, stamp, name, mb,
      secs: Math.round((Date.now() - started) / 1000),
      url: `/apk/${name}`,
    });
    send({ t: 'atlan.mood', mood: 'proud' });
  });
}
