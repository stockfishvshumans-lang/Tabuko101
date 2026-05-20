// js/SnapshotManager.js — Local State Recomputation & Delta Sync
const SnapshotManager = (() => {

  /**
   * recomputeLocalState: Synchronizes the UI by replaying the ops log.
   * This is critical for offline-first reliability.
   */
  async function recomputeLocalState(tournamentId) {
    console.log(`[Snapshot] Syncing local state for ${tournamentId}...`);
    
    // 1. Fetch latest checkpoint
    const snapshot = await db.collection('tournaments').doc(tournamentId).collection('snapshots').orderBy('timestamp', 'desc').limit(1).get();
    let state = snapshot.empty ? { results: {}, lockedRounds: [] } : snapshot.docs[0].data().state;
    const since = snapshot.empty ? 0 : snapshot.docs[0].data().timestamp;

    const lastSequenceIndex = state.lastSequenceIndex !== undefined ? state.lastSequenceIndex : -1;
    const clubId = window.TenantManager?.getActiveClubId() || 'Unknown';

    // 2. Fetch trailing operations log from sandboxed nested sub-collection
    const ops = await db.collection('clubs').doc(clubId).collection('operations_log')
      .where('payload.tournamentId', '==', tournamentId)
      .where('timestamp', '>', since)
      .orderBy('timestamp', 'asc')
      .get();

    // 3. Replay log onto state with strict sequence verification
    let expectedSequenceIndex = lastSequenceIndex + 1;
    let corrupted = false;

    for (let i = 0; i < ops.docs.length; i++) {
      const op = ops.docs[i].data();
      
      // Check sequenceIndex boundaries
      if (op.sequenceIndex === undefined) {
        console.error(`[Snapshot] [CORRUPTION ALERT] Operation ${op.id} is missing sequenceIndex.`);
        corrupted = true;
        break;
      }

      // Check for out-of-order or missing event gaps
      if (op.sequenceIndex !== expectedSequenceIndex) {
        // Duplicate-immune check
        if (op.sequenceIndex <= lastSequenceIndex) {
          console.warn(`[Snapshot] Skipping duplicate operation: ${op.id} (Seq: ${op.sequenceIndex})`);
          continue;
        }
        
        console.error(`[Snapshot] [CORRUPTION ALERT] Sequence gap detected! Expected: ${expectedSequenceIndex}, Got: ${op.sequenceIndex}`);
        corrupted = true;
        break;
      }

      // Check structural keys validation
      if (!op.type || !op.payload || (op.type === 'SUBMIT_RESULT' && (!op.payload.roundNumber || !op.payload.board))) {
        console.error(`[Snapshot] [CORRUPTION ALERT] Operation ${op.id} has misaligned structural entry keys.`);
        corrupted = true;
        break;
      }

      // Process operation
      if (op.type === 'SUBMIT_RESULT') {
        state.results[`${op.payload.roundNumber}_${op.payload.board}`] = op.payload.result;
      } else if (op.type === 'LOCK_ROUND') {
        state.lockedRounds.push(op.payload.roundNumber);
      }

      state.lastSequenceIndex = op.sequenceIndex;
      expectedSequenceIndex = op.sequenceIndex + 1;
    }

    if (corrupted) {
      const errorMsg = `Snapshot hydration aborted due to data corruption, missing event index gap, or sequence misalignment.`;
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast(`🚨 Workspace Sync Halted: Data integrity boundary triggered.`, 'error');
      }
      throw new Error(`CRITICAL_DATA_CORRUPTION|${errorMsg}`);
    }

    return state;
  }

  /**
   * syncState: Day 148 Incremental Delta Tracking Data Hydration
   */
  function syncState(clubId, onUpdate) {
    const LocalStorageManager = {
      getLastSyncTimestamp: () => {
        const ts = localStorage.getItem('last_sync_timestamp');
        return ts ? parseInt(ts, 10) : 0;
      },
      setLastSyncTimestamp: (ts) => {
        localStorage.setItem('last_sync_timestamp', ts.toString());
      }
    };

    const lastCheckpoint = LocalStorageManager.getLastSyncTimestamp();
    console.log(`[Snapshot] Syncing deltas since checkpoint: ${lastCheckpoint}`);

    // Stream deltas exclusively, removing full transaction table downloads
    return db.collection('clubs').doc(clubId).collection('operations_log')
      .where('timestamp', '>', lastCheckpoint)
      .orderBy('timestamp', 'asc')
      .onSnapshot(snapshot => {
        const mutations = [];
        let maxTs = lastCheckpoint;
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          mutations.push(data);
          if (data.timestamp > maxTs) {
            maxTs = data.timestamp;
          }
        });
        
        if (mutations.length > 0) {
          LocalStorageManager.setLastSyncTimestamp(maxTs);
          if (typeof onUpdate === 'function') {
            onUpdate(mutations);
          }
        }
      }, err => {
        console.error("[Snapshot] Delta stream failed, retrying handshake...", err);
      });
  }

  return { recomputeLocalState, syncState };
})();

window.SnapshotManager = SnapshotManager;
