/**
 * StateReconstruction.js — Event Sourcing Timeline Compiler & Player Snapshotter
 * Day 255: Zero-trust tournament state reconstruction from append-only event logs.
 *
 * Architecture:
 *   Append-only event log → chronological sort → pure functional fold
 *   → reconstructed player map → immutable standings snapshot
 *
 * @version 1.0.0 — Day 255 Sprint
 */
const StateReconstruction = (() => {
  'use strict';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // EVENT LOG RECONSTRUCTION ENGINE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * reconstructStandingsFromLog: Pure functional state compiler.
   * Rejects mutable score variables — computes state entirely from event history.
   *
   * @param {Array} eventLogs - Chronological event entries
   * @param {number} targetRoundId - Reconstruct up to this round (inclusive)
   * @returns {Map} playersState map { id → { id, name, points, history, opponents, colors, rating } }
   */
  function reconstructStandingsFromLog(eventLogs, targetRoundId = Infinity) {
    const playersState = new Map();

    if (!Array.isArray(eventLogs) || eventLogs.length === 0) return playersState;

    // Sort by absolute sequential order tokens (deterministic)
    const chronLog = [...eventLogs].sort((a, b) => {
      const seqA = a.sequenceId || a.version_vector || 0;
      const seqB = b.sequenceId || b.version_vector || 0;
      return (seqA - seqB) || ((a.timestamp || 0) - (b.timestamp || 0));
    });

    for (const log of chronLog) {
      // Respect round boundary
      if (log.roundNumber !== undefined && log.roundNumber > targetRoundId) break;

      const type = log.type || log.operationType;
      const payload = log.payload || log;

      switch (type) {
        case 'PLAYER_REGISTERED': {
          const pid = payload.id || payload.playerId;
          if (!pid) break;
          playersState.set(pid, {
            id: pid,
            name: payload.name || 'Unknown',
            points: 0,
            history: [],
            opponents: [],
            colors: [],
            rating: parseInt(payload.selectedRating || payload.rating || 1200),
            withdrawn: false,
            hadBye: false,
            joinedRound: payload.joinedRound || 1
          });
          break;
        }

        case 'MATCH_RECORDED':
        case 'MATCH_RESULT': {
          const whiteId = payload.whiteId;
          const blackId = payload.blackId;
          const whiteScore = parseFloat(payload.whiteScore || 0);
          const blackScore = parseFloat(payload.blackScore || 0);
          const roundNum = payload.roundNumber || log.roundNumber || 0;

          if (whiteId && playersState.has(whiteId)) {
            const w = playersState.get(whiteId);
            w.points = parseFloat((w.points + whiteScore).toFixed(4));
            w.history.push({
              round: roundNum,
              opponentId: blackId,
              result: whiteScore,
              color: 'White',
              isUnplayed: false
            });
            if (blackId) w.opponents.push(blackId);
            w.colors.push('white');
          }

          if (blackId && playersState.has(blackId)) {
            const b = playersState.get(blackId);
            b.points = parseFloat((b.points + blackScore).toFixed(4));
            b.history.push({
              round: roundNum,
              opponentId: whiteId,
              result: blackScore,
              color: 'Black',
              isUnplayed: false
            });
            if (whiteId) b.opponents.push(whiteId);
            b.colors.push('black');
          }
          break;
        }

        case 'BYE_AWARDED': {
          const byeId = payload.playerId || payload.id;
          if (byeId && playersState.has(byeId)) {
            const p = playersState.get(byeId);
            p.points = parseFloat((p.points + 1).toFixed(4));
            p.hadBye = true;
            p.history.push({
              round: payload.roundNumber || log.roundNumber || 0,
              opponentId: null,
              result: 1,
              color: 'None',
              isUnplayed: true
            });
          }
          break;
        }

        case 'PLAYER_WITHDRAWN': {
          const wId = payload.playerId || payload.id;
          if (wId && playersState.has(wId)) {
            playersState.get(wId).withdrawn = true;
          }
          break;
        }

        case 'PLAYER_REJOINED': {
          const rId = payload.playerId || payload.id;
          if (rId && playersState.has(rId)) {
            playersState.get(rId).withdrawn = false;
          }
          break;
        }

        default:
          // Unknown event type — skip silently
          break;
      }
    }

    return playersState;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SNAPSHOT COMPILER — Convert Map to Ranked Array
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function compileSnapshot(playersState) {
    const playersArray = [...playersState.values()]
      .filter(p => !p.withdrawn)
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return (b.rating || 1200) - (a.rating || 1200);
      });

    playersArray.forEach((p, i) => p.rank = i + 1);
    return playersArray;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DIFFERENTIAL DELTA COMPUTATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function computeStateDelta(previousState, currentState) {
    const changes = [];

    for (const [id, current] of currentState) {
      const prev = previousState.get(id);
      if (!prev) {
        changes.push({ type: 'ADDED', playerId: id, data: current });
        continue;
      }

      if (prev.points !== current.points) {
        changes.push({
          type: 'SCORE_CHANGED',
          playerId: id,
          previousPoints: prev.points,
          currentPoints: current.points,
          delta: current.points - prev.points
        });
      }

      if (prev.withdrawn !== current.withdrawn) {
        changes.push({
          type: current.withdrawn ? 'WITHDRAWN' : 'REJOINED',
          playerId: id
        });
      }
    }

    // Detect removals
    for (const [id] of previousState) {
      if (!currentState.has(id)) {
        changes.push({ type: 'REMOVED', playerId: id });
      }
    }

    return changes;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BUILD EVENT LOG FROM FIRESTORE DATA
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function buildEventLogFromRoundData(players, rounds) {
    const eventLog = [];
    let seq = 0;

    // Register all players
    (players || []).forEach(p => {
      seq++;
      eventLog.push({
        sequenceId: seq,
        type: 'PLAYER_REGISTERED',
        payload: {
          id: p.id,
          name: p.name,
          selectedRating: p.selectedRating || p.rating || (p.ratings?.club) || 1200
        },
        timestamp: p.createdAt?.seconds ? p.createdAt.seconds * 1000 : Date.now() - 86400000
      });
    });

    // Process rounds chronologically
    const sortedRounds = [...(rounds || [])].sort((a, b) => (a.roundNumber || 0) - (b.roundNumber || 0));

    for (const round of sortedRounds) {
      const rdNum = round.roundNumber || 0;

      // Process pairings
      (round.pairings || []).forEach(pairing => {
        if (!pairing.result) return;

        seq++;
        const result = pairing.result;
        eventLog.push({
          sequenceId: seq,
          type: 'MATCH_RECORDED',
          roundNumber: rdNum,
          payload: {
            whiteId: pairing.whiteId,
            blackId: pairing.blackId,
            whiteScore: typeof result === 'object' ? result.whiteScore : 0,
            blackScore: typeof result === 'object' ? result.blackScore : 0,
            roundNumber: rdNum,
            board: pairing.board
          },
          timestamp: result.timestamp || Date.now()
        });
      });

      // Process bye
      if (round.bye) {
        seq++;
        eventLog.push({
          sequenceId: seq,
          type: 'BYE_AWARDED',
          roundNumber: rdNum,
          payload: {
            playerId: round.bye.playerId,
            roundNumber: rdNum
          },
          timestamp: Date.now()
        });
      }
    }

    return eventLog;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TIMELINE SCRUBBER UI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function renderTimelineScrubber(containerId, eventLogs, totalRounds, onRoundChange) {
    const root = document.getElementById(containerId);
    if (!root) return;

    root.innerHTML = `
      <div style="background:rgba(15,23,42,0.95);border:1px solid rgba(245,158,11,0.15);border-radius:12px;padding:1rem;font-family:'Inter',sans-serif;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <div style="font-weight:900;font-size:0.65rem;text-transform:uppercase;letter-spacing:2px;color:#f59e0b;">⏮ Tournament Timeline</div>
          <div id="timeline-round-label" style="font-size:0.7rem;color:#e2e8f0;font-weight:800;">Round ${totalRounds}</div>
        </div>

        <div style="padding:0 4px;">
          <input type="range" id="timeline-scrubber-input" min="0" max="${totalRounds}" value="${totalRounds}" 
            style="width:100%;accent-color:#f59e0b;cursor:pointer;" />
        </div>

        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:0.5rem;color:#475569;font-weight:700;">
          <span>Registration</span>
          ${Array.from({ length: totalRounds }, (_, i) => `<span>R${i + 1}</span>`).join('')}
        </div>

        <div id="timeline-event-count" style="margin-top:0.5rem;font-size:0.55rem;color:#64748b;text-align:center;">
          ${eventLogs.length} events tracked
        </div>
      </div>
    `;

    // Bind scrubber input
    const slider = document.getElementById('timeline-scrubber-input');
    if (slider) {
      slider.addEventListener('input', (e) => {
        const roundNum = parseInt(e.target.value);
        const label = document.getElementById('timeline-round-label');
        if (label) label.textContent = roundNum === 0 ? 'Pre-Tournament' : `Round ${roundNum}`;

        // Reconstruct state at target round
        const state = reconstructStandingsFromLog(eventLogs, roundNum);
        const snapshot = compileSnapshot(state);

        if (typeof onRoundChange === 'function') {
          onRoundChange(roundNum, snapshot);
        }
      });
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DAY 168: SNAPSHOT-OPTIMIZED RECONSTRUCTION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * reconstructWithSnapshotOptimization: Uses SnapshotRecovery to load the
   * nearest available round checkpoint, then replays only the remaining delta
   * operations to reach targetRound. Falls back to full log replay if no snapshot.
   *
   * @param {string} containerId
   * @param {number} targetRound
   * @param {Array}  allEventLogs - full chronological event log
   * @returns {Promise<Array>} compiled standings array
   */
  async function reconstructWithSnapshotOptimization(containerId, targetRound, allEventLogs) {
    // Delegate to SnapshotRecovery if available (Day 168)
    if (window.SnapshotRecovery?.reconstructFromNearestSnapshot) {
      try {
        const result = await window.SnapshotRecovery.reconstructFromNearestSnapshot(
          containerId,
          targetRound,
          allEventLogs
        );
        if (result && result.length > 0) return result;
      } catch (err) {
        console.warn('[StateReconstruction] Snapshot-optimized path failed — falling back:', err.message);
      }
    }

    // Full reconstruction fallback (genesis replay)
    const state    = reconstructStandingsFromLog(allEventLogs, targetRound);
    const snapshot = compileSnapshot(state);

    // Auto-capture this result as a new snapshot for future optimization
    if (window.SnapshotRecovery?.captureRoundSnapshot && containerId) {
      window.SnapshotRecovery.captureRoundSnapshot(containerId, targetRound, snapshot).catch(() => {});
    }

    return snapshot;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLIC API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    reconstructStandingsFromLog,
    reconstructWithSnapshotOptimization,
    compileSnapshot,
    computeStateDelta,
    buildEventLogFromRoundData,
    renderTimelineScrubber
  };
})();

window.StateReconstruction = StateReconstruction;

