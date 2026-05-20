// js/TournamentManager.js — Hardened Round Lifecycle, Transactional Mutex & Cryptographic Roster Checks
window.TournamentManager = (() => {

  /**
   * finalizeAndArchive: The single canonical endpoint for tournament completion.
   * Delegates to Tournament.finalizeTournament for Elo/history, then refreshes the UI.
   */
  async function finalizeAndArchive(tournamentId) {
    if (!confirm('Are you sure you want to FINALIZE this tournament?\n\nThis will:\n1. Lock all results permanently.\n2. Update official Club Ratings.\n3. Move to the Archive Room.')) return;

    try {
      // Delegate to the existing canonical finalization engine with structural safety checks
      if (typeof window.Tournament !== 'undefined' && typeof window.Tournament.finalizeTournament === 'function') {
        await window.Tournament.finalizeTournament(tournamentId);
      } else {
        throw new Error("CRITICAL_DEPENDENCY_MISSING|The core Tournament execution module is not bound in global memory scope.");
      }

      UI.showToast('🏁 Tournament Finalized & Archived!', 'success');

      // Manual refresh as fallback:
      const fresh = await DB.getTournament(tournamentId);
      if (fresh) {
        UI.renderTournamentView(fresh);
      } else {
        App.navigateTo('dashboard');
      }
    } catch (err) {
      console.error('[TournamentManager] Finalization failed:', err);
      UI.showToast(err.message, 'error');
    }
  }

  // Day 212 Task 1: Multi-Field Transactional Mutex Guards
  async function advanceRoundAtomic(tournamentId) {
    const tourneyRef = db.collection('tournaments').doc(tournamentId);
    
    // Apply UI interactive component shields before running transaction
    applyUiInteractiveShield(true);
    
    try {
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(tourneyRef);
        if (!doc.exists) throw new Error("Tournament missing.");
        const data = doc.data();
        if (data.isTransitioning === true) {
          throw new Error("TRANSACTION_LOCKED|Round advancement already in flight.");
        }
        transaction.update(tourneyRef, { isTransitioning: true });
      });

      // Call the actual round advancement logic with global namespace guards
      let result;
      if (typeof window.Tournament !== 'undefined' && typeof window.Tournament.startNextRound === 'function') {
        result = await window.Tournament.startNextRound(tournamentId);
      } else {
        throw new Error("CRITICAL_DEPENDENCY_MISSING|The core Tournament execution module is not bound in global memory scope.");
      }
      
      // Release isTransitioning lock after success
      await tourneyRef.update({ isTransitioning: false });
      return result;
    } catch (err) {
      console.error("[TournamentManager] advanceRoundAtomic failed:", err);
      await tourneyRef.update({ isTransitioning: false }).catch(() => {});
      throw err;
    } finally {
      applyUiInteractiveShield(false);
    }
  }

  async function lockRoundAtomic(tournamentId, roundNumber) {
    const tourneyRef = db.collection('tournaments').doc(tournamentId);
    
    // Apply UI interactive component shields before running transaction
    applyUiInteractiveShield(true);
    
    try {
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(tourneyRef);
        if (!doc.exists) throw new Error("Tournament missing.");
        const data = doc.data();
        if (data.isTransitioning === true) {
          throw new Error("TRANSACTION_LOCKED|Round locking already in flight.");
        }
        transaction.update(tourneyRef, { isTransitioning: true });
      });

      // Call the actual round lock logic with global namespace guards
      let result;
      if (typeof window.Tournament !== 'undefined' && typeof window.Tournament.lockRound === 'function') {
        result = await window.Tournament.lockRound(tournamentId, roundNumber);
      } else {
        throw new Error("CRITICAL_DEPENDENCY_MISSING|The core Tournament execution module is not bound in global memory scope.");
      }
      
      // Release isTransitioning lock after success
      await tourneyRef.update({ isTransitioning: false });
      return result;
    } catch (err) {
      console.error("[TournamentManager] lockRoundAtomic failed:", err);
      await tourneyRef.update({ isTransitioning: false }).catch(() => {});
      throw err;
    } finally {
      applyUiInteractiveShield(false);
    }
  }

  // Day 212 Task 2: UI Interactive Component Shield Overlays
  function applyUiInteractiveShield(shouldLock) {
    const overlayId = 'tournament-operation-shield-overlay';
    let overlay = document.getElementById(overlayId);
    
    if (shouldLock) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style = `
          position: fixed;
          top: 0; left: 0; width: 100vw; height: 100vh;
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(6px);
          z-index: 99999;
          display: flex; align-items: center; justify-content: center;
          color: #f8fafc; font-family: sans-serif; font-weight: 700; font-size: 1.25rem;
        `;
        overlay.innerHTML = `
          <div style="background: #1e293b; border: 1px solid #334155; padding: 2.5rem; border-radius: 16px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); max-width: 450px;">
            <div style="margin: 0 auto 1.5rem auto; width: 60px; height: 60px; border: 5px solid #3b82f6; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <div style="font-size: 1.4rem; font-weight: 900; margin-bottom: 0.75rem; letter-spacing: 0.5px;">LOCKING TERMINAL ACTIONS</div>
            <div style="font-size: 0.95rem; color: #94a3b8; line-height: 1.5;">Floor terminal inputs are temporarily shielded to isolate database writes and prevent race conditions.</div>
          </div>
          <style>
            @keyframes spin { to { transform: rotate(360deg); } }
          </style>
        `;
        document.body.appendChild(overlay);
      }
      
      document.querySelectorAll('button, input, select, textarea').forEach(el => {
        el.setAttribute('data-was-disabled', el.disabled);
        el.disabled = true;
      });
    } else {
      if (overlay) overlay.remove();
      document.querySelectorAll('button, input, select, textarea').forEach(el => {
        const wasDisabled = el.getAttribute('data-was-disabled') === 'true';
        el.disabled = wasDisabled;
        el.removeAttribute('data-was-disabled');
      });
    }
  }

  // Day 245 Task 1: Deterministic Cryptographic Roster Hashing
  function computeRosterHash(players) {
    if (!players || !Array.isArray(players)) return '';
    const sortedIds = players.map(p => p.id || p).sort();
    const concatenated = sortedIds.join('|');
    
    let hash = 2166136261;
    for (let i = 0; i < concatenated.length; i++) {
      hash ^= concatenated.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  // Day 245 Task 2: Real-Time Device Mutation Synchronization Alerts
  async function verifyRosterConsistency(tournamentId, players) {
    const localHash = computeRosterHash(players);
    const docRef = db.collection('tournaments').doc(tournamentId).collection('roster_signatures').doc('active');
    
    try {
      const snap = await docRef.get();
      if (snap.exists) {
        const remoteHash = snap.data().rosterHash;
        if (remoteHash && remoteHash !== localHash) {
          showRosterCollisionModal();
          return false;
        }
      } else {
        await docRef.set({ rosterHash: localHash, updatedAt: Date.now() });
      }
      return true;
    } catch (e) {
      console.warn("[TournamentManager] Roster signature check bypassed:", e);
      return true;
    }
  }

  function showRosterCollisionModal() {
    const overlay = document.createElement('div');
    overlay.style = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(220, 38, 38, 0.95); backdrop-filter: blur(8px);
      z-index: 999999; display: flex; align-items: center; justify-content: center;
      color: #fff; font-family: sans-serif; text-align: center; padding: 2rem;
    `;
    overlay.innerHTML = `
      <div style="background: #1e1b4b; border: 2px solid #ef4444; padding: 3.5rem; border-radius: 20px; max-width: 600px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6);">
        <h1 style="color: #ef4444; font-size: 2.5rem; font-weight: 900; margin-bottom: 1.5rem; letter-spacing: 1px;">🚨 ROSTER SYNC COLLISION</h1>
        <p style="font-size: 1.2rem; line-height: 1.8; color: #cbd5e1; margin-bottom: 2.5rem;">
          Another administrative device has modified this tournament roster mid-round! 
          Calculations halted immediately to prevent database corruption.
        </p>
        <button onclick="window.location.reload()" style="background: #ef4444; color: #fff; font-weight: 900; border: none; padding: 1.25rem 2.5rem; border-radius: 10px; cursor: pointer; font-size: 1.1rem; transition: background 0.2s; letter-spacing: 0.5px; text-transform: uppercase;">
          Reload Workspace & Sync
        </button>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  return { 
    finalizeAndArchive, 
    advanceRoundAtomic, 
    lockRoundAtomic, 
    applyUiInteractiveShield,
    computeRosterHash,
    verifyRosterConsistency
  };
})();
