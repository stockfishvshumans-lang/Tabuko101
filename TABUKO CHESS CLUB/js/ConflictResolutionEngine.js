/**
 * ConflictResolutionEngine.js — Deterministic Merge Coordinator
 * Days 184–185: Role-weighted, timestamp-deterministic conflict resolution matrix.
 * Reconciles overlapping updates from multiple offline devices upon network recovery.
 * @version 1.0.0 — Days 184–185
 */
const ConflictResolutionEngine = (() => {
  'use strict';

  // ── ROLE HIERARCHY WEIGHTS (Day 180 / 185) ────
  const ROLE_WEIGHTS = {
    'CHIEF_ARBITER':    100,
    'ARBITER':           80,
    'FLOOR_ARBITER':     60,
    'SCOREKEEPER':       40,
    'DISPLAY_MONITOR':   10,
    'SYSTEM':            50,
    'UNKNOWN':            0
  };

  function getRoleWeight(role) {
    const key = (role || 'UNKNOWN').toUpperCase().replace(/[^A-Z_]/g, '');
    return ROLE_WEIGHTS[key] ?? ROLE_WEIGHTS['UNKNOWN'];
  }

  // ── DUPLICATE DETECTION ───────────────────────
  function areEntriesIdentical(entryA, entryB) {
    const pA = JSON.parse(JSON.stringify(entryA.payload || {}));
    const pB = JSON.parse(JSON.stringify(entryB.payload || {}));
    // Strip metadata before comparing payload content
    ['timestamp', 'clientId', 'sequenceId', 'version_vector', 'status'].forEach(k => { delete pA[k]; delete pB[k]; });
    return JSON.stringify(pA) === JSON.stringify(pB) && entryA.operationType === entryB.operationType;
  }

  // ── DAY 185: BOARD RESULT CONFLICT RESOLVER ───
  /**
   * resolveResultConflict: Deterministic winner selection for overlapping board results.
   * Priority: role weight → timestamp → clientId lexicographic.
   *
   * @param {Object} entryA - local WAL entry
   * @param {Object} entryB - remote WAL entry or server record
   * @returns {{ winner: Object, loser: Object, reason: string }}
   */
  function resolveResultConflict(entryA, entryB) {
    // Rule 0: Auto-ignore exact duplicates
    if (areEntriesIdentical(entryA, entryB)) {
      return { winner: entryA, loser: entryB, reason: 'DUPLICATE_IGNORED' };
    }

    const weightA = getRoleWeight(entryA.role || entryA.metadata?.role);
    const weightB = getRoleWeight(entryB.role || entryB.metadata?.role);

    // Rule 1: Higher role weight wins (CHIEF_ARBITER overrides FLOOR_ARBITER)
    if (weightA > weightB) return { winner: entryA, loser: entryB, reason: `ROLE_PRIORITY: A(${weightA}) > B(${weightB})` };
    if (weightB > weightA) return { winner: entryB, loser: entryA, reason: `ROLE_PRIORITY: B(${weightB}) > A(${weightA})` };

    // Rule 2: Equal roles — newest timestamp wins
    const tsA = entryA.timestamp || entryA.clientTimestamp || 0;
    const tsB = entryB.timestamp || entryB.clientTimestamp || 0;
    if (tsA > tsB) return { winner: entryA, loser: entryB, reason: `TIMESTAMP_LWW: A newer by ${tsA - tsB}ms` };
    if (tsB > tsA) return { winner: entryB, loser: entryA, reason: `TIMESTAMP_LWW: B newer by ${tsB - tsA}ms` };

    // Rule 3: Absolute tiebreak — lexicographic clientId (deterministic across devices)
    const cidA = entryA.clientId || '';
    const cidB = entryB.clientId || '';
    if (cidA > cidB) return { winner: entryA, loser: entryB, reason: 'CLIENT_ID_LEXICOGRAPHIC: A' };
    return { winner: entryB, loser: entryA, reason: 'CLIENT_ID_LEXICOGRAPHIC: B' };
  }

  // ── DAY 184: BATCH LOG MERGE COORDINATOR ──────
  /**
   * mergeOperationLogs: Reconcile two arrays of operation logs (local + remote).
   * Deduplicates, resolves conflicts per board, and returns the authoritative merged log.
   *
   * @param {Array} localLog  - local pending WAL entries
   * @param {Array} remoteLog - remote Firestore-fetched entries
   * @returns {{ merged: Array, conflicts: Array, duplicates: number }}
   */
  function mergeOperationLogs(localLog, remoteLog) {
    const local  = JSON.parse(JSON.stringify(localLog  || []));
    const remote = JSON.parse(JSON.stringify(remoteLog || []));

    const merged    = [];
    const conflicts = [];
    let duplicates  = 0;

    // Index remote by a board+round key for fast lookup
    const remoteIndex = new Map();
    remote.forEach(entry => {
      const key = _buildConflictKey(entry);
      if (!remoteIndex.has(key)) remoteIndex.set(key, []);
      remoteIndex.get(key).push(entry);
    });

    // Process each local entry
    const processedKeys = new Set();
    for (const localEntry of local) {
      const key = _buildConflictKey(localEntry);

      if (processedKeys.has(key + localEntry.clientId)) {
        duplicates++; continue;
      }
      processedKeys.add(key + localEntry.clientId);

      const remoteMatches = remoteIndex.get(key) || [];
      if (remoteMatches.length === 0) {
        merged.push(localEntry); // No remote conflict — accept local
        continue;
      }

      // Resolve conflict for each matching remote entry
      let winner = localEntry;
      for (const remoteEntry of remoteMatches) {
        const resolution = resolveResultConflict(winner, remoteEntry);
        if (resolution.reason !== 'DUPLICATE_IGNORED' && resolution.winner !== winner) {
          conflicts.push({ key, localEntry, remoteEntry, resolution: resolution.reason });
          winner = resolution.winner;
        } else if (resolution.reason === 'DUPLICATE_IGNORED') {
          duplicates++;
        }
      }
      merged.push(winner);
    }

    // Add remote-only entries (not present in local log)
    for (const remoteEntry of remote) {
      const key = _buildConflictKey(remoteEntry);
      const localMatch = local.find(l => _buildConflictKey(l) === key);
      if (!localMatch) merged.push(remoteEntry);
    }

    // Chronological sort by sequenceIndex + timestamp
    merged.sort((a, b) => (a.sequenceIndex || 0) - (b.sequenceIndex || 0) || (a.timestamp || 0) - (b.timestamp || 0));

    console.log(`[ConflictResolution] Merge complete: ${merged.length} entries, ${conflicts.length} conflicts resolved, ${duplicates} duplicates dropped`);
    return { merged, conflicts, duplicates };
  }

  function _buildConflictKey(entry) {
    const p = entry.payload || {};
    if (entry.operationType === 'SUBMIT_RESULT' || entry.operationType === 'MATCH_RESULT') {
      return `result_${p.tournamentId}_R${p.roundNumber}_B${p.board}`;
    }
    if (entry.operationType === 'LOCK_ROUND') {
      return `lock_${p.tournamentId}_R${p.roundNumber}`;
    }
    if (entry.operationType === 'PLAYER_WITHDRAWN' || entry.operationType === 'PLAYER_REJOINED') {
      return `player_${p.tournamentId}_${p.playerId}`;
    }
    return `generic_${entry.operationType}_${entry.clientId || Date.now()}`;
  }

  // ── SHADOW CHECKSUM VALIDATOR (Day 190) ───────
  /**
   * validateChecksum: Compare local event log hash against remote server hash.
   * Returns true if checksums match (no divergence detected).
   */
  async function validateChecksum(localLog, remoteChecksum) {
    const canonical = JSON.stringify(
      (localLog || [])
        .map(e => ({ type: e.operationType, board: e.payload?.board, round: e.payload?.roundNumber, ts: e.timestamp }))
        .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    );
    const encoded = new TextEncoder().encode(canonical);
    const buf     = await crypto.subtle.digest('SHA-256', encoded);
    const localHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    const match = localHash === remoteChecksum;
    if (!match) console.warn(`[ConflictResolution] Checksum mismatch! Local:${localHash.slice(0,16)}... Remote:${remoteChecksum?.slice(0,16)}...`);
    return { match, localHash };
  }

  // ── PUBLIC API ────────────────────────────────
  return {
    resolveResultConflict,
    mergeOperationLogs,
    validateChecksum,
    getRoleWeight,
    areEntriesIdentical,
    ROLE_WEIGHTS
  };
})();

window.ConflictResolutionEngine = ConflictResolutionEngine;
