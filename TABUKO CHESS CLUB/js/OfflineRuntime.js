/**
 * OfflineRuntime.js — Portable Tournament OS: Runtime Engine
 * Days 161–170: tabuko_container_runtime namespace, five-table schema,
 * scoped key isolation, high-perf indices, type-coercion gates, cleanup tasks.
 * @version 2.0.0 — Days 161–170
 */
const OfflineRuntime = (() => {
  'use strict';

  // ── DAY 161: DEDICATED DATABASE NAMESPACE ─────
  const DB_NAME    = 'tabuko_container_runtime';
  const DB_VERSION = 5;

  // ── DAY 164: FIVE TARGET DATA TABLES ──────────
  const STORES = {
    META:       'container_metadata',
    ROSTER:     'active_roster',
    BRACKETS:   'round_brackets',
    LEDGER:     'event_ledger',
    SNAPSHOTS:  'state_snapshots',
    // Legacy stores retained for WAL backward compat
    WAL:        'write_ahead_log',
    STANDINGS:  'cached_standings',
    CONTAINERS: 'container_bundles'
  };

  let _db = null;
  let _walSequence = 0;
  let _isOffline = false;

  // ── DATABASE INITIALISER ──────────────────────
  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Day 164: container_metadata
        if (!db.objectStoreNames.contains(STORES.META)) {
          const s = db.createObjectStore(STORES.META, { keyPath: 'containerId' });
          s.createIndex('by_tournament', 'tournamentId', { unique: false });
          s.createIndex('by_status',     'status',       { unique: false });
        }

        // Day 164 + 166: active_roster with sectionId & withdrawn indices
        if (!db.objectStoreNames.contains(STORES.ROSTER)) {
          const s = db.createObjectStore(STORES.ROSTER, { keyPath: 'scopedKey' });
          s.createIndex('by_container',  'containerId', { unique: false });
          s.createIndex('by_section',    'sectionId',   { unique: false }); // Day 166
          s.createIndex('by_withdrawn',  'withdrawn',   { unique: false }); // Day 166
        }

        // Day 164 + 166: round_brackets
        if (!db.objectStoreNames.contains(STORES.BRACKETS)) {
          const s = db.createObjectStore(STORES.BRACKETS, { keyPath: 'scopedKey' });
          s.createIndex('by_container', 'containerId', { unique: false });
          s.createIndex('by_round',     'roundNumber', { unique: false });
        }

        // Day 164: event_ledger
        if (!db.objectStoreNames.contains(STORES.LEDGER)) {
          const s = db.createObjectStore(STORES.LEDGER, { keyPath: 'sequenceId', autoIncrement: true });
          s.createIndex('by_container', 'containerId', { unique: false });
          s.createIndex('by_status',    'status',      { unique: false });
          s.createIndex('by_timestamp', 'timestamp',   { unique: false });
        }

        // Day 164: state_snapshots
        if (!db.objectStoreNames.contains(STORES.SNAPSHOTS)) {
          const s = db.createObjectStore(STORES.SNAPSHOTS, { keyPath: 'snapshotId' });
          s.createIndex('by_container', 'containerId', { unique: false });
          s.createIndex('by_round',     'roundNumber', { unique: false });
        }

        // Legacy WAL (backward compat)
        if (!db.objectStoreNames.contains(STORES.WAL)) {
          const w = db.createObjectStore(STORES.WAL, { keyPath: 'sequenceId', autoIncrement: true });
          w.createIndex('by_status',     'status',      { unique: false });
          w.createIndex('by_tournament', 'tournamentId',{ unique: false });
          w.createIndex('by_timestamp',  'timestamp',   { unique: false });
        }

        // Legacy standings cache
        if (!db.objectStoreNames.contains(STORES.STANDINGS)) {
          db.createObjectStore(STORES.STANDINGS, { keyPath: 'id' });
        }

        // Container bundle store
        if (!db.objectStoreNames.contains(STORES.CONTAINERS)) {
          const c = db.createObjectStore(STORES.CONTAINERS, { keyPath: 'containerId' });
          c.createIndex('by_expires', 'expiresAt', { unique: false });
        }
      };

      req.onsuccess = () => { _db = req.result; console.log('[OfflineRuntime] tabuko_container_runtime DB v5 ready.'); resolve(_db); };
      req.onerror  = () => { console.error('[OfflineRuntime] DB open failed:', req.error); reject(req.error); };
    });
  }

  // ── GENERIC IDB HELPERS ───────────────────────
  async function _put(storeName, record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function _get(storeName, key) {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => resolve(null);
    });
  }

  async function _getByIndex(storeName, indexName, value) {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx  = db.transaction(storeName, 'readonly');
      const idx = tx.objectStore(storeName).index(indexName);
      const req = idx.getAll(value);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => resolve([]);
    });
  }

  async function _delete(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror   = () => reject(req.error);
    });
  }

  // ── DAY 165: SCOPED COLLECTION RECORDS ────────
  async function getCollectionRecords(scopedKeyPrefix) {
    const db = await openDB();
    // Determine the store from the key prefix pattern
    const store = scopedKeyPrefix.includes('active_roster')  ? STORES.ROSTER
                : scopedKeyPrefix.includes('round_brackets') ? STORES.BRACKETS
                : STORES.LEDGER;

    return new Promise((resolve) => {
      const tx = db.transaction(store, 'readonly');
      const os = tx.objectStore(store);
      const req = os.getAll();
      req.onsuccess = () => resolve((req.result || []).filter(r => r.containerId && scopedKeyPrefix.includes(r.containerId)));
      req.onerror   = () => resolve([]);
    });
  }

  // ── DAY 169: DATABASE CLEANUP TASK ────────────
  async function clearStaleContainerRecords(containerId) {
    const db = await openDB();
    const storesToClear = [STORES.ROSTER, STORES.BRACKETS, STORES.LEDGER, STORES.SNAPSHOTS];
    let deleted = 0;
    for (const storeName of storesToClear) {
      await new Promise((resolve) => {
        const tx = db.transaction(storeName, 'readwrite');
        const os = tx.objectStore(storeName);
        const idx = os.index('by_container');
        const req = idx.getAll(containerId);
        req.onsuccess = () => {
          req.result.forEach(r => { os.delete(r.scopedKey || r.sequenceId || r.snapshotId); deleted++; });
          resolve();
        };
        req.onerror = () => resolve();
      });
    }
    console.log(`[OfflineRuntime] Cleared ${deleted} stale records for container ${containerId}`);
    return deleted;
  }

  // ── CONTAINER BUNDLE STORE ────────────────────
  async function storeContainerBundle(containerId, encryptedContainer) {
    const record = JSON.parse(JSON.stringify({ ...encryptedContainer, containerId, storedAt: Date.now() }));
    return _put(STORES.CONTAINERS, record);
  }

  async function getContainerBundle(containerId) {
    return _get(STORES.CONTAINERS, containerId);
  }

  // ── CONTAINER METADATA ────────────────────────
  async function saveContainerMeta(containerId, meta) {
    return _put(STORES.META, JSON.parse(JSON.stringify({ ...meta, containerId, updatedAt: Date.now() })));
  }

  async function getContainerMeta(containerId) {
    return _get(STORES.META, containerId);
  }

  // ── DAY 164: ROSTER WRITES WITH TYPE GATES ────
  // Day 170: strict type-coercion validation before writing
  function _validateRosterRecord(record) {
    const errors = [];
    if (typeof record.id !== 'string' || !record.id)    errors.push('Missing string id');
    if (typeof record.name !== 'string' || !record.name) errors.push('Missing string name');
    const r = record.selectedRating ?? record.rating;
    if (r !== undefined) {
      const n = parseInt(r, 10);
      if (isNaN(n) || n < 0) errors.push(`Invalid rating: ${r}`);
      else record.selectedRating = n; // coerce to integer
    }
    if (typeof record.withdrawn !== 'boolean') record.withdrawn = Boolean(record.withdrawn);
    if (errors.length) throw new Error(`[OfflineRuntime] Roster record validation failed: ${errors.join('; ')}`);
    return record;
  }

  async function putRosterRecord(containerId, player) {
    const validated = _validateRosterRecord(JSON.parse(JSON.stringify(player)));
    const scopedKey = `container_${containerId}_roster_${validated.id}`;
    return _put(STORES.ROSTER, { ...validated, containerId, scopedKey });
  }

  async function putRoundBracket(containerId, roundData) {
    const clone = JSON.parse(JSON.stringify(roundData));
    const scopedKey = `container_${containerId}_bracket_R${clone.roundNumber}`;
    return _put(STORES.BRACKETS, { ...clone, containerId, scopedKey });
  }

  // ── WAL: WRITE-AHEAD LOG ──────────────────────
  async function logWriteAheadTransaction(tournamentId, operationType, payload) {
    _walSequence++;
    const entry = {
      operationType,
      tournamentId: tournamentId || 'system',
      payload: JSON.parse(JSON.stringify(payload)),
      timestamp: Date.now(),
      clientId: crypto.randomUUID(),
      clubId: window.TenantManager?.getActiveClubId?.() || 'local',
      status: 'pending_sync',
      version_vector: _walSequence,
      retryCount: 0
    };
    return _put(STORES.WAL, entry).then(seqId => {
      console.log(`[WAL] Entry sealed: ${operationType} [seq:${_walSequence}]`);
      if (window.DistributedEventBus) window.DistributedEventBus.publish('WAL_ENTRY_ADDED', { operationType, tournamentId, timestamp: entry.timestamp });
      return { sequenceId: seqId, ...entry };
    });
  }

  async function getPendingWALEntries() {
    return _getByIndex(STORES.WAL, 'by_status', 'pending_sync');
  }

  async function markWALEntrySynced(sequenceId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.WAL, 'readwrite');
      const store = tx.objectStore(STORES.WAL);
      const req = store.get(sequenceId);
      req.onsuccess = () => {
        const entry = req.result;
        if (entry) { entry.status = 'synced'; entry.syncedAt = Date.now(); store.put(entry); }
        resolve(true);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getWALStats() {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.WAL, 'readonly');
      const store = tx.objectStore(STORES.WAL);
      const countReq = store.count();
      countReq.onsuccess = () => {
        const idx = store.index('by_status');
        const pendReq = idx.count('pending_sync');
        pendReq.onsuccess = () => resolve({ totalEntries: countReq.result, pendingSync: pendReq.result, syncedEntries: countReq.result - pendReq.result });
        pendReq.onerror = () => resolve({ totalEntries: countReq.result, pendingSync: 0 });
      };
      countReq.onerror = () => resolve({ totalEntries: 0, pendingSync: 0 });
    });
  }

  // ── STANDINGS CACHE ───────────────────────────
  async function cacheCompiledStandings(tournamentId, roundNum, payload) {
    return _put(STORES.STANDINGS, { id: `${tournamentId}_R${roundNum}`, tournamentId, roundNumber: roundNum, payload: JSON.parse(JSON.stringify(payload)), updatedAt: Date.now() });
  }

  async function getCachedStandings(tournamentId, roundNum) {
    const record = await _get(STORES.STANDINGS, `${tournamentId}_R${roundNum}`);
    if (record && (Date.now() - record.updatedAt) < 300000) return record.payload;
    return null;
  }

  // ── SNAPSHOTS ─────────────────────────────────
  async function saveTournamentSnapshot(tournamentId, data) {
    return _put(STORES.SNAPSHOTS, { snapshotId: tournamentId, containerId: tournamentId, data: JSON.parse(JSON.stringify(data)), savedAt: Date.now() });
  }

  async function getTournamentSnapshot(tournamentId) {
    const r = await _get(STORES.SNAPSHOTS, tournamentId);
    return r?.data || null;
  }

  async function saveRoundSnapshot(containerId, roundNumber, standingsVector) {
    const snapshotId = `${containerId}_R${roundNumber}`;
    return _put(STORES.SNAPSHOTS, { snapshotId, containerId, roundNumber, standingsVector: JSON.parse(JSON.stringify(standingsVector)), savedAt: Date.now() });
  }

  async function getRoundSnapshot(containerId, roundNumber) {
    return _get(STORES.SNAPSHOTS, `${containerId}_R${roundNumber}`);
  }

  async function getLatestSnapshot(containerId, upToRound) {
    const all = await _getByIndex(STORES.SNAPSHOTS, 'by_container', containerId);
    const filtered = all.filter(s => s.roundNumber <= upToRound).sort((a, b) => b.roundNumber - a.roundNumber);
    return filtered[0] || null;
  }

  // ── CONNECTION MONITOR ────────────────────────
  function initConnectionMonitor() {
    if (!document.getElementById('offline-runtime-indicator')) {
      const el = document.createElement('div');
      el.id = 'offline-runtime-indicator';
      el.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:99999;padding:6px 14px;border-radius:20px;font-size:0.65rem;font-weight:900;font-family:"Inter",monospace;display:flex;align-items:center;gap:6px;transition:all 0.4s ease;pointer-events:none;opacity:0.9;';
      document.body.appendChild(el);
    }
    updateConnectionBadge();
    window.addEventListener('online', () => { _isOffline = false; updateConnectionBadge(); if (window.DistributedEventBus) window.DistributedEventBus.publish('NETWORK_STATUS', { online: true, timestamp: Date.now() }); });
    window.addEventListener('offline', () => { _isOffline = true; updateConnectionBadge(); if (window.DistributedEventBus) window.DistributedEventBus.publish('NETWORK_STATUS', { online: false, timestamp: Date.now() }); });
  }

  function updateConnectionBadge() {
    const el = document.getElementById('offline-runtime-indicator');
    if (!el) return;
    const online = navigator.onLine && !_isOffline;
    el.style.background = online ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)';
    el.style.border      = online ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(245,158,11,0.4)';
    el.style.color       = online ? '#10b981' : '#f59e0b';
    el.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${online ? '#10b981' : '#f59e0b'};display:inline-block;${online ? '' : 'animation:pulse 1.5s infinite;'}"></span> ${online ? 'Online' : 'Offline (Local-First)'}`;
  }

  function isOffline() { return !navigator.onLine || _isOffline; }

  return {
    openDB,
    getCollectionRecords,
    clearStaleContainerRecords,
    storeContainerBundle,
    getContainerBundle,
    saveContainerMeta,
    getContainerMeta,
    putRosterRecord,
    putRoundBracket,
    logWriteAheadTransaction,
    getPendingWALEntries,
    markWALEntrySynced,
    getWALStats,
    cacheCompiledStandings,
    getCachedStandings,
    saveTournamentSnapshot,
    getTournamentSnapshot,
    saveRoundSnapshot,
    getRoundSnapshot,
    getLatestSnapshot,
    initConnectionMonitor,
    updateConnectionBadge,
    isOffline,
    STORES
  };
})();

window.OfflineRuntime = OfflineRuntime;
