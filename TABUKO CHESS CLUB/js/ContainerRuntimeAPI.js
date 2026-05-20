/**
 * ContainerRuntimeAPI.js — Global Data Proxy Layer
 * Day 162: Abstracts all UI paths away from direct Firestore paths during offline mode.
 * Day 165: Container-scoped key formatting for IndexedDB isolation.
 * @version 2.0.0 — Days 162–165
 */
const ContainerRuntime = (() => {
  'use strict';

  let _isOfflineMode = false;
  let _activeContainerId = null;

  // ── DAY 162: RUNTIME MODE SWITCH ─────────────
  function setRuntimeMode(isOffline, containerId) {
    _isOfflineMode = isOffline;
    _activeContainerId = containerId;
    console.log(`[Runtime API] Mode switched. Local-First Offline: ${_isOfflineMode ? 'ENABLED' : 'DISABLED'} | Container: ${_activeContainerId}`);
    if (window.DistributedEventBus) {
      window.DistributedEventBus.publish('RUNTIME_MODE_CHANGED', { offline: _isOfflineMode, containerId: _activeContainerId, timestamp: Date.now() });
    }
  }

  // ── DAY 165: SCOPED KEY FORMATTER ─────────────
  function scopedKey(table) {
    return `container_${_activeContainerId}_${table}`;
  }

  // ── PLAYER DATA ACCESS ────────────────────────
  async function getPlayers(tournamentId) {
    if (_isOfflineMode) {
      return await window.OfflineRuntime.getCollectionRecords(scopedKey('active_roster'));
    }
    const snap = await db.collection('tournaments').doc(tournamentId).collection('playerData').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ── MATCH RESULT SUBMISSION ───────────────────
  async function saveMatchResult(tournamentId, roundNumber, board, whiteScore, blackScore, matchNumber = null) {
    // Deep-clone immutable payload
    const payload = JSON.parse(JSON.stringify({
      tournamentId,
      roundNumber: parseInt(roundNumber, 10),
      board: parseInt(board, 10),
      whiteScore: parseFloat(whiteScore),
      blackScore: parseFloat(blackScore),
      matchNumber: matchNumber !== null ? parseInt(matchNumber, 10) : null
    }));

    if (_isOfflineMode) {
      return await window.OperationsQueue.push('SUBMIT_RESULT', payload);
    }
    return await window.Tournament.submitResultAndUpdate(
      payload.tournamentId, payload.roundNumber, payload.board, payload.whiteScore, payload.blackScore, false, null, payload.matchNumber
    );
  }

  // ── STANDINGS ACCESS ──────────────────────────
  async function getStandings(tournamentId, roundNumber) {
    if (_isOfflineMode) {
      const cached = await window.OfflineRuntime.getCachedStandings(_activeContainerId, roundNumber);
      if (cached) return cached;
      const players = await getPlayers(tournamentId);
      const matches = await window.OfflineRuntime.getCollectionRecords(scopedKey('round_brackets'));
      return await window.Standings.generateLiveStandings(players, matches, roundNumber);
    }
    return await window.Standings.getCachedOrCompute(tournamentId, roundNumber);
  }

  // ── ROUND BRACKET ACCESS ──────────────────────
  async function getRoundBracket(tournamentId, roundNumber) {
    if (_isOfflineMode) {
      const records = await window.OfflineRuntime.getCollectionRecords(scopedKey('round_brackets'));
      return records.filter(r => r.roundNumber === parseInt(roundNumber, 10));
    }
    const snap = await db.collection('tournaments').doc(tournamentId)
      .collection('rounds').doc(`round_${roundNumber}`).get();
    return snap.exists ? snap.data() : null;
  }

  // ── PLAYER WITHDRAWAL ─────────────────────────
  async function withdrawPlayer(tournamentId, playerId, roundNumber) {
    const payload = JSON.parse(JSON.stringify({ tournamentId, playerId, roundNumber: parseInt(roundNumber, 10) }));
    if (_isOfflineMode) return await window.OperationsQueue.push('PLAYER_WITHDRAWN', payload);
    return await window.Tournament.withdrawPlayer?.(tournamentId, playerId);
  }

  // ── ROUND LOCK ────────────────────────────────
  async function lockRound(tournamentId, roundNumber) {
    const payload = JSON.parse(JSON.stringify({ tournamentId, roundNumber: parseInt(roundNumber, 10) }));
    if (_isOfflineMode) return await window.OperationsQueue.push('LOCK_ROUND', payload);
    return await window.Tournament.lockRoundResults?.(tournamentId, roundNumber);
  }

  // ── STATE ACCESSORS ───────────────────────────
  function isOffline() { return _isOfflineMode; }
  function getActiveContainerId() { return _activeContainerId; }

  return {
    setRuntimeMode,
    scopedKey,
    getPlayers,
    saveMatchResult,
    getStandings,
    getRoundBracket,
    withdrawPlayer,
    lockRound,
    isOffline,
    getActiveContainerId
  };
})();

window.ContainerRuntime = ContainerRuntime;
