/**
 * SnapshotRecovery.js — Tournament State Checkpoint Memoization Worker
 * Day 167: Auto-saves standings state vectors when rounds lock or standings generate.
 * Day 168: Optimizes StateReconstruction by loading latest snapshot + replaying delta.
 * @version 1.0.0 — Days 167–168
 */
const SnapshotRecovery = (() => {
  'use strict';

  // ── DAY 167: AUTO-SNAPSHOT ON ROUND LOCK ──────
  /**
   * captureRoundSnapshot: Serialize compiled standings state as a static checkpoint.
   * Called automatically when a round is locked or standings are freshly generated.
   * @param {string} containerId
   * @param {number} roundNumber
   * @param {Array}  standingsArray - compiled sorted standings array
   */
  async function captureRoundSnapshot(containerId, roundNumber, standingsArray) {
    if (!containerId || !roundNumber || !Array.isArray(standingsArray)) {
      console.warn('[SnapshotRecovery] captureRoundSnapshot: invalid arguments');
      return null;
    }

    // Deep-clone — treat all input as immutable
    const vectorClone = JSON.parse(JSON.stringify(standingsArray));

    try {
      if (window.OfflineRuntime?.saveRoundSnapshot) {
        await window.OfflineRuntime.saveRoundSnapshot(containerId, roundNumber, vectorClone);
        console.log(`[SnapshotRecovery] Snapshot sealed: container=${containerId} round=${roundNumber} players=${vectorClone.length}`);
      }

      // Also write to operational ledger for audit trail
      if (window.OperationalLedger) {
        await window.OperationalLedger.appendLedgerBlock('SNAPSHOT_CAPTURED', {
          containerId,
          roundNumber,
          playerCount: vectorClone.length,
          topPlayer: vectorClone[0]?.name || null,
          capturedAt: Date.now()
        }).catch(() => {});
      }

      return { containerId, roundNumber, playerCount: vectorClone.length, capturedAt: Date.now() };
    } catch (err) {
      console.error('[SnapshotRecovery] Snapshot capture failed:', err.message);
      return null;
    }
  }

  // ── DAY 168: OPTIMIZED TIMELINE RECONSTRUCTION ─
  /**
   * reconstructFromNearestSnapshot: Load the closest snapshot at or before targetRound
   * then replay only remaining WAL operations, avoiding full replay from genesis.
   *
   * @param {string} containerId
   * @param {number} targetRound
   * @param {Array}  allEventLogs - full event log array
   * @returns {Array} compiled standings array at targetRound
   */
  async function reconstructFromNearestSnapshot(containerId, targetRound, allEventLogs) {
    let baseSnapshot = null;
    let baseRound    = 0;

    // Attempt to load the closest available snapshot
    try {
      if (window.OfflineRuntime?.getLatestSnapshot) {
        baseSnapshot = await window.OfflineRuntime.getLatestSnapshot(containerId, targetRound - 1);
        if (baseSnapshot) {
          baseRound = baseSnapshot.roundNumber || 0;
          console.log(`[SnapshotRecovery] Snapshot hit: round=${baseRound}, replaying delta to round=${targetRound}`);
        }
      }
    } catch (err) {
      console.warn('[SnapshotRecovery] Snapshot load failed — falling back to full replay:', err.message);
    }

    // If no snapshot found, fall through to full reconstruction
    if (!baseSnapshot) {
      console.log('[SnapshotRecovery] No snapshot found — running full reconstruction from genesis');
      if (window.StateReconstruction) {
        const state = window.StateReconstruction.reconstructStandingsFromLog(allEventLogs, targetRound);
        return window.StateReconstruction.compileSnapshot(state);
      }
      return [];
    }

    // Filter only the delta events: rounds after the snapshot round up to targetRound
    const deltaEvents = (allEventLogs || []).filter(evt => {
      const r = evt.roundNumber ?? evt.payload?.roundNumber ?? 0;
      return r > baseRound && r <= targetRound;
    });

    // Build initial player map from snapshot standings vector
    const playerMap = new Map();
    (baseSnapshot.standingsVector || []).forEach(p => {
      playerMap.set(p.id, JSON.parse(JSON.stringify(p)));
    });

    // Replay delta events onto the snapshot state
    for (const evt of deltaEvents) {
      const type    = evt.type || evt.operationType;
      const payload = evt.payload || evt;

      if (type === 'MATCH_RECORDED' || type === 'MATCH_RESULT') {
        const { whiteId, blackId, whiteScore, blackScore, roundNumber: rn } = payload;
        if (whiteId && playerMap.has(whiteId)) {
          const w = playerMap.get(whiteId);
          w.points = parseFloat((w.points + parseFloat(whiteScore || 0)).toFixed(4));
          w.history = [...(w.history || []), { round: rn, opponentId: blackId, result: parseFloat(whiteScore), color: 'White', isUnplayed: false }];
          if (blackId) w.opponents = [...(w.opponents || []), blackId];
          w.colors = [...(w.colors || []), 'white'];
        }
        if (blackId && playerMap.has(blackId)) {
          const b = playerMap.get(blackId);
          b.points = parseFloat((b.points + parseFloat(blackScore || 0)).toFixed(4));
          b.history = [...(b.history || []), { round: rn, opponentId: whiteId, result: parseFloat(blackScore), color: 'Black', isUnplayed: false }];
          if (whiteId) b.opponents = [...(b.opponents || []), whiteId];
          b.colors = [...(b.colors || []), 'black'];
        }
      } else if (type === 'BYE_AWARDED') {
        const pid = payload.playerId || payload.id;
        if (pid && playerMap.has(pid)) {
          const p = playerMap.get(pid);
          p.points = parseFloat((p.points + 1).toFixed(4));
          p.hadBye = true;
        }
      } else if (type === 'PLAYER_WITHDRAWN') {
        const pid = payload.playerId || payload.id;
        if (pid && playerMap.has(pid)) playerMap.get(pid).withdrawn = true;
      } else if (type === 'PLAYER_REJOINED') {
        const pid = payload.playerId || payload.id;
        if (pid && playerMap.has(pid)) playerMap.get(pid).withdrawn = false;
      }
    }

    // Compile sorted array
    const sorted = [...playerMap.values()]
      .filter(p => !p.withdrawn)
      .sort((a, b) => (b.points - a.points) || ((b.rating || 1200) - (a.rating || 1200)));
    sorted.forEach((p, i) => { p.rank = i + 1; });

    console.log(`[SnapshotRecovery] Delta reconstruction complete: ${sorted.length} players, round=${targetRound}`);
    return sorted;
  }

  // ── SNAPSHOT LIST UTILITY ─────────────────────
  async function listSnapshots(containerId) {
    try {
      if (!window.OfflineRuntime?.openDB) return [];
      const db = await window.OfflineRuntime.openDB();
      return new Promise((resolve) => {
        const tx  = db.transaction('state_snapshots', 'readonly');
        const idx = tx.objectStore('state_snapshots').index('by_container');
        const req = idx.getAll(containerId);
        req.onsuccess = () => resolve((req.result || []).map(s => ({ snapshotId: s.snapshotId, roundNumber: s.roundNumber, playerCount: (s.standingsVector || []).length, savedAt: s.savedAt })));
        req.onerror   = () => resolve([]);
      });
    } catch { return []; }
  }

  // ── HOOK: AUTO-CAPTURE ON ROUND LOCK EVENT ─────
  function installAutoCapturHook() {
    if (window.DistributedEventBus) {
      window.DistributedEventBus.subscribe('ROUND_LOCKED', async (data) => {
        const { tournamentId, roundNumber, standings, containerId } = data;
        const cId = containerId || window.ContainerRuntime?.getActiveContainerId?.() || tournamentId;
        if (standings && cId) {
          await captureRoundSnapshot(cId, roundNumber, standings);
        }
      });
      console.log('[SnapshotRecovery] Auto-capture hook installed on ROUND_LOCKED events.');
    }
  }

  return {
    captureRoundSnapshot,
    reconstructFromNearestSnapshot,
    listSnapshots,
    installAutoCapturHook
  };
})();

window.SnapshotRecovery = SnapshotRecovery;
