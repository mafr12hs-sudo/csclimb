// ============================================================================
// sync.js
// Offline-first layer. This is what makes CareerOS keep working with no
// connection: writes go into a local queue first and are applied
// optimistically to a local cache; database.js calls are attempted
// immediately but never block the UI, and failures fall back to the queue.
//
// Design: last-write-wins per record, keyed by (table, id). This matches
// "never lose user progress" better than a merge strategy would for a
// single-user app — the risk we're guarding against is a dropped network
// call, not concurrent edits from two devices at once. If simultaneous
// multi-device editing becomes a real usage pattern, revisit this; a queue
// timestamp-based LWW is not enough for that case.
// ============================================================================
const QUEUE_KEY = 'careeros_sync_queue_v1';
const CACHE_KEY = 'careeros_local_cache_v1';

let online = navigator.onLine;
let flushing = false;
const statusListeners = new Set();

function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; }
}
function writeQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}
export function writeCache(cache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

/** Merge a partial update into the local cache under `key` (e.g. table name). */
export function updateCache(key, value) {
  const cache = readCache();
  cache[key] = value;
  writeCache(cache);
}

export function onSyncStatusChange(cb) {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}
function notifyStatus(status) {
  for (const cb of statusListeners) cb(status);
}

/**
 * Queue a write to be applied via database.js. `apply` is an async function
 * that performs the actual Supabase call — it's stored by reference at
 * call time (not persisted across reloads), so on reload only the
 * declarative queue entries with known operation types get retried.
 */
export function enqueueWrite(operation) {
  // operation: { id, table, type: 'insert'|'update'|'upsert'|'delete', payload }
  const q = readQueue();
  q.push({ ...operation, queuedAt: Date.now(), attempts: 0 });
  writeQueue(q);
  notifyStatus({ pending: q.length });
  if (online) flushQueue();
}

/**
 * Attempt to write immediately; on failure (offline or transient error),
 * fall back to the queue automatically. This is the function most UI code
 * should call instead of hitting database.js directly for anything that
 * must survive being offline.
 */
export async function writeThrough(operation, applyFn) {
  updateCache(operation.cacheKey ?? operation.table, operation.payload);
  if (!online) {
    enqueueWrite(operation);
    return { queued: true };
  }
  try {
    const result = await applyFn(operation.payload);
    return { queued: false, result };
  } catch (err) {
    console.warn('writeThrough: immediate write failed, queueing', err);
    enqueueWrite(operation);
    return { queued: true, error: err };
  }
}

// Registry so a reloaded queue entry knows which database.js function to
// call. Register these once at app startup — see appShell.js.
const applyRegistry = new Map();
export function registerApplier(type, fn) {
  applyRegistry.set(type, fn);
}

export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  const q = readQueue();
  const remaining = [];

  for (const op of q) {
    const applyFn = applyRegistry.get(op.type);
    if (!applyFn) { remaining.push(op); continue; }
    try {
      await applyFn(op.payload);
    } catch (err) {
      op.attempts += 1;
      if (op.attempts < 5) remaining.push(op);
      else console.error('sync.js: dropping write after 5 failed attempts', op, err);
    }
  }

  writeQueue(remaining);
  notifyStatus({ pending: remaining.length });
  flushing = false;
}

window.addEventListener('online', () => {
  online = true;
  notifyStatus({ online: true });
  flushQueue();
});
window.addEventListener('offline', () => {
  online = false;
  notifyStatus({ online: false });
});

export function isOnline() {
  return online;
}
export function pendingCount() {
  return readQueue().length;
}
