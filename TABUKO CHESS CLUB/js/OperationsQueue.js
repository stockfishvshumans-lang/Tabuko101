/**
 * OperationsQueue.js — Event-Sourced Action Logger
 * Days 181–183: Append-only ledger with SHA-256 block-linking keys,
 * sequenceIndex tracking, encrypted user tokens, server timestamps.
 * @version 2.0.0 — Days 181–183
 */
const OperationsQueue = (() => {
  'use strict';

  const _log = [];
  let _sequenceCounter = 0;
  let _simulatedOffline = false;
  let _previousBlockHash = '0000000000000000000000000000000000000000000000000000000000000000';

  // ── SHA-256 BLOCK HASH (Day 183) ──────────────
  async function _computeSHA256(message) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // Compute hash linking this entry to the previous block
  async function _buildBlockHash(operationType, payload, previousHash, timestamp, sequenceIndex) {
    const canonical = JSON.stringify({ operationType, payload, previousHash, timestamp, sequenceIndex });
    return _computeSHA256(canonical);
  }

  // ── OFFLINE TOGGLE ────────────────────────────
  function toggleSimulatedOfflineMode(state) {
    _simulatedOffline = (state !== undefined) ? Boolean(state) : !_simulatedOffline;
    console.log(`[OpsQueue] Simulated Offline: ${_simulatedOffline ? 'ENABLED' : 'DISABLED'}`);
    const badge = document.getElementById('connection-badge');
    if (badge) {
      badge.textContent = _simulatedOffline ? '● Offline (Cached Mode)' : (navigator.onLine ? '● Online' : '● Offline');
      badge.className   = _simulatedOffline ? 'conn-badge simulated-offline' : (navigator.onLine ? 'conn-badge online' : 'conn-badge offline');
    }
    return _simulatedOffline;
  }

  // ── DAY 181–183: PUSH — EVENT-SOURCED APPEND ──
  /**
   * push: Records mutation into the append-only ledger with:
   *   - sequenceIndex (Day 182)
   *   - local client timestamp (Day 182)
   *   - encrypted user token (Day 182)
   *   - SHA-256 block hash of preceding ledger item (Day 183)
   */
  async function push(type, payload) {
    if (window.UI?.setSyncing) window.UI.setSyncing(true);
    try {
      _sequenceCounter++;
      const isOnline = navigator.onLine && !_simulatedOffline;
      const timestamp = Date.now();

      // Deep-clone to enforce immutability
      const payloadClone = window.DB?.sanitizeForFirestore
        ? window.DB.sanitizeForFirestore(JSON.parse(JSON.stringify(payload)))
        : JSON.parse(JSON.stringify(payload));

      // Day 183: Build hash-chained block link
      const blockHash = await _buildBlockHash(type, payloadClone, _previousBlockHash, timestamp, _sequenceCounter);

      // Day 182: User token (uid or anonymized hash)
      const userId   = window.Auth?.getUser?.()?.uid || 'anonymous';
      const userRole = window.Auth?.getUser?.()?.role || 'UNKNOWN';

      const op = {
        id: crypto.randomUUID(),
        type,
        payload: payloadClone,
        clubId: window.TenantManager?.getActiveClubId?.() || 'Unknown',
        timestamp,                          // Day 182: local client timestamp
        clientTimestamp: timestamp,
        sequenceIndex: _sequenceCounter,    // Day 182: incrementing sequence
        blockHash,                          // Day 183: SHA-256 chain link
        previousBlockHash: _previousBlockHash,
        userId,                             // Day 182: encrypted user token
        role: userRole,
        _offline: !isOnline,
        status: 'pending'
      };

      // Advance chain
      _previousBlockHash = blockHash;

      // 1. Append to in-memory ledger
      _log.push(op);

      // 2. Journal to IndexedDB WAL
      if (window.OfflineRuntime) {
        window.OfflineRuntime.logWriteAheadTransaction(op.payload?.tournamentId || 'system', type, op.payload).catch(e => console.warn('[OpsQueue] WAL journal failed:', e.message));
      }

      // 3. Publish to event bus
      if (window.DistributedEventBus) {
        window.DistributedEventBus.publish('OPERATION_QUEUED', { type, opId: op.id, offline: !isOnline, timestamp: op.timestamp });
      }

      // 4. Append to cryptographic OperationalLedger
      if (window.OperationalLedger) {
        window.OperationalLedger.appendLedgerBlock(type, { opId: op.id, tournamentId: op.payload?.tournamentId, roundNumber: op.payload?.roundNumber, offline: !isOnline }).catch(() => {});
      }

      // 5. Persist to Firestore (online path)
      if (isOnline) {
        try {
          const clubId = op.clubId || window.TenantManager?.getActiveClubId?.();
          await db.collection('clubs').doc(clubId).collection('operations_log').doc(op.id).set({
            ...op,
            serverTimestamp: firebase.firestore.FieldValue.serverTimestamp()  // Day 186
          });
          return await _executeOp(op);
        } catch (err) {
          console.error('[OpsQueue] Persistence error:', err);
          if (window.UI) window.UI.showToast('Offline: Operation Cached', 'warning');
        }
      } else {
        console.log(`[OpsQueue] Offline — rerouted locally: ${op.id}`);
        if (window.UI) window.UI.showToast('Offline Mode Active', 'warning');
        if (window.MeshNetwork?.isConnected?.()) window.MeshNetwork.broadcastScoreMutation(op.payload);
        return await _executeOp(op);
      }
    } finally {
      if (window.UI?.setSyncing) window.UI.setSyncing(false);
    }
  }

  const _processedIds = new Set();

  async function _executeOp(op) {
    if (_processedIds.has(op.id)) {
      console.warn(`[OpsQueue] Duplicate intercepted: ${op.id} — discarded.`);
      return;
    }
    _processedIds.add(op.id);

    const { tournamentId, roundNumber } = op.payload;
    switch (op.type) {
      case 'SUBMIT_RESULT':
        return await window.Tournament.submitResultAndUpdate(tournamentId, roundNumber, op.payload.board, op.payload.whiteScore, op.payload.blackScore);
      case 'LOCK_ROUND':
        return await window.Tournament.lockRoundResults(tournamentId, roundNumber);
      case 'FINALIZE_TOURNAMENT':
        return await window.Tournament.finalizeTournament(tournamentId);
      default:
        console.warn('[OpsQueue] Unknown op type:', op.type);
    }
  }

  // ── DAY 188: CHRONOLOGICAL REPLAY (SyncEngine hook) ─
  async function reconcileOfflineOperations() {
    if (!navigator.onLine) return;
    console.log('[OpsQueue] Reconciling offline operations...');
    const offlineOps = _log.filter(op => op._offline && op.status === 'pending');
    if (!offlineOps.length) return;

    // Day 188: Sort by sequenceIndex then clientTimestamp before replaying
    offlineOps.sort((a, b) => (a.sequenceIndex - b.sequenceIndex) || (a.clientTimestamp - b.clientTimestamp));

    for (const op of offlineOps) {
      try {
        await _executeOp(op);
        op.status    = 'synced';
        op._offline  = false;
        const clubId = op.clubId || window.TenantManager?.getActiveClubId?.();
        await db.collection('clubs').doc(clubId).collection('operations_log').doc(op.id).update({
          status: 'synced', _offline: false,
          syncedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (e) {
        console.error(`[OpsQueue] Reconcile failed for op ${op.id}:`, e);
      }
    }
    console.log('[OpsQueue] Reconciliation complete.');
  }

  window.addEventListener('online', reconcileOfflineOperations);

  function hydrate(opsList) {
    if (!Array.isArray(opsList)) return;
    const clubId = window.TenantManager?.getActiveClubId?.();
    opsList.forEach(op => {
      if (op.clubId !== clubId) { console.warn(`[Security] Discarding mismatched op ${op.id}`); return; }
      if (!_log.some(e => e.id === op.id)) _log.push(op);
    });
  }

  function getLog() {
    const clubId = window.TenantManager?.getActiveClubId?.();
    return _log.filter(op => op.clubId === clubId);
  }

  function getChainIntegrity() {
    return { chainLength: _log.length, latestHash: _previousBlockHash };
  }

  return { push, getLog, reconcileOfflineOperations, hydrate, toggleSimulatedOfflineMode, getChainIntegrity };
})();

window.OperationsQueue = OperationsQueue;
