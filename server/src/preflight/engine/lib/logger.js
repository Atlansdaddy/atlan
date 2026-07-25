// Lightweight structured logger for the audit app.
// - Levels: debug | info | warn | error
// - Ring buffer (default 500 entries) so the Diagnostics panel always has the last N events.
// - Subscribes for live UI updates.
// - Exposes window.__auditLogs (read), window.__auditLogger (control) in dev for console use.

const LEVELS = ['debug', 'info', 'warn', 'error'];
const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };

const DEFAULT_BUFFER = 500;
const STORAGE_KEY = 'audit-app:logs:v1';

let buffer = [];
let subscribers = new Set();
let counter = 0;
let minLevel = 'debug';
let bufferLimit = DEFAULT_BUFFER;

function nextId() {
  counter += 1;
  return `${Date.now()}-${counter.toString(36)}`;
}

function safeStringify(v) {
  if (v == null) return String(v);
  if (typeof v === 'string') return v;
  if (v instanceof Error) {
    return JSON.stringify({ name: v.name, message: v.message, stack: v.stack });
  }
  try {
    return JSON.stringify(v, circularReplacer());
  } catch {
    try {
      return String(v);
    } catch {
      return '[unserializable]';
    }
  }
}

// Returns a replacer that swaps circular references for "[Circular]" sentinels.
// Used by exportLogs() and persistLogsToLocalStorage() so one bad log entry can't
// break every diagnostics export.
function circularReplacer() {
  const seen = new WeakSet();
  return (key, value) => {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    if (typeof value === 'function') return `[fn ${value.name || 'anonymous'}]`;
    if (typeof value === 'bigint') return value.toString();
    return value;
  };
}

function notify() {
  for (const fn of subscribers) {
    try {
      fn(buffer);
    } catch (e) {
      // Subscriber threw — isolate so one bad listener can't break the rest. Can't use the
      // logger here (would recurse into notify), so write straight to console.
      console.debug('logger: subscriber threw', e?.message);
    }
  }
}

function emit(level, scope, message, context) {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
  const entry = {
    id: nextId(),
    ts: Date.now(),
    level,
    scope: scope || 'app',
    message: typeof message === 'string' ? message : safeStringify(message),
    context: context === undefined ? null : context,
  };
  buffer.push(entry);
  if (buffer.length > bufferLimit) {
    buffer.splice(0, buffer.length - bufferLimit);
  }
  // Mirror to console with level + scope prefix for native devtools filtering.
  const prefix = `[${entry.scope}]`;
  const consoleArgs = context !== undefined ? [prefix, message, context] : [prefix, message];
  switch (level) {
    case 'debug':
      console.debug(...consoleArgs);
      break;
    case 'info':
      console.info(...consoleArgs);
      break;
    case 'warn':
      console.warn(...consoleArgs);
      break;
    case 'error':
      console.error(...consoleArgs);
      break;
    default:
      console.log(...consoleArgs);
      break; // future-proof against new levels
  }
  notify();
  return entry;
}

export function createLogger(scope) {
  return {
    debug: (msg, ctx) => emit('debug', scope, msg, ctx),
    info: (msg, ctx) => emit('info', scope, msg, ctx),
    warn: (msg, ctx) => emit('warn', scope, msg, ctx),
    error: (msg, ctx) => emit('error', scope, msg, ctx),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

export const log = createLogger('app');

export function getLogs() {
  return buffer.slice();
}

export function clearLogs() {
  buffer = [];
  notify();
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function setMinLevel(level) {
  if (LEVELS.includes(level)) minLevel = level;
}

export function getMinLevel() {
  return minLevel;
}

export function setBufferLimit(n) {
  if (typeof n === 'number' && n > 0) {
    bufferLimit = n;
    if (buffer.length > bufferLimit) {
      buffer.splice(0, buffer.length - bufferLimit);
    }
  }
}

export function exportLogs() {
  // Use the circular-safe replacer so a single bad context object can't break this.
  try {
    return JSON.stringify(buffer, circularReplacer(), 2);
  } catch {
    // Last-ditch fallback: emit a minimal payload listing what we tried to dump.
    return JSON.stringify(
      {
        error: 'log export failed even with circular replacer',
        entryCount: buffer.length,
        lastEntry: buffer.length
          ? { ts: buffer[buffer.length - 1].ts, level: buffer[buffer.length - 1].level }
          : null,
      },
      null,
      2
    );
  }
}

export function persistLogsToLocalStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, exportLogs());
      return true;
    }
  } catch (e) {
    // Quota exceeded or storage disabled — surface via console only (can't logger.error from here).
    console.debug('logger: persistLogsToLocalStorage failed', e?.message);
  }
  return false;
}

// Best-effort dev surface so users can inspect from the browser console.
if (typeof window !== 'undefined') {
  window.__auditLogs = getLogs;
  window.__auditLogger = {
    setMinLevel,
    getMinLevel,
    clear: clearLogs,
    export: exportLogs,
    persist: persistLogsToLocalStorage,
  };

  // HMR-safe registration: tear down old listeners before adding new ones.
  // Without this, every Vite hot reload stacks another pair of listeners that
  // close over a stale buffer reference and silently double-log everything.
  const onWinError = (e) => {
    emit('error', 'window.error', e.message || 'Uncaught error', {
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      error: e.error
        ? { name: e.error.name, message: e.error.message, stack: e.error.stack }
        : null,
    });
  };
  const onUnhandled = (e) => {
    const reason = e.reason;
    emit(
      'error',
      'window.unhandledrejection',
      reason instanceof Error ? reason.message : safeStringify(reason),
      reason instanceof Error ? { name: reason.name, stack: reason.stack } : null
    );
  };

  if (window.__auditLoggerListeners) {
    window.removeEventListener('error', window.__auditLoggerListeners.onWinError);
    window.removeEventListener('unhandledrejection', window.__auditLoggerListeners.onUnhandled);
  }
  window.addEventListener('error', onWinError);
  window.addEventListener('unhandledrejection', onUnhandled);
  window.__auditLoggerListeners = { onWinError, onUnhandled };
}
