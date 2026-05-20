/**
 * ArbiterManager.js — Scoped-Authority & Draft Result System
 * Handles arbiter invites, onboarding, and the 3-state result pipeline.
 */
const ArbiterManager = (() => {

  function render403Page() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="auth-gateway fade-in" style="background: #0a0a0f;">
        <div class="auth-card" style="text-align: center; border-color: var(--accent-danger);">
           <div class="auth-icon-wrap" style="background: rgba(244, 63, 94, 0.1);">
              <span style="font-size: 2rem;">🚫</span>
           </div>
           <h2 class="auth-title">403: Forbidden</h2>
           <p class="auth-subtext" style="color: var(--text-muted);">Your account is not authorized for this tournament floor.</p>
           <p style="font-size: 0.8rem; margin: 1.5rem 0; color: #666;">Please contact the Club Administrator to add your email to the authorized staff list.</p>
           <button onclick="App.navigateTo('dashboard')" class="btn btn-auth-primary" style="width: 100%;">Return to Dashboard</button>
        </div>
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════
  //  1. AUTHORITY CHECK
  // ══════════════════════════════════════════════════════════
  function isArbiterForTournament(tournamentId) {
    const user = Auth.getUser();
    if (!user) return false;
    const t = window.activeTournament;
    if (!t || t.id !== tournamentId) return false;
    const arbiters = t.authorized_arbiters || [];
    return arbiters.includes(user.email?.toLowerCase());
  }

  function getArbiterRole(tournament) {
    const user = Auth.getUser();
    if (!user || !tournament) return null;
    if (TenantManager.isMasterAdmin()) return 'master';
    const clubData = TenantManager.getActiveClubData();
    if (clubData?.admin_uid === user.uid) return 'admin';
    const arbiters = tournament.authorized_arbiters || [];
    if (arbiters.includes(user.email?.toLowerCase())) return 'arbiter';
    return null;
  }

  // ══════════════════════════════════════════════════════════
  //  2. INVITE SYSTEM
  // ══════════════════════════════════════════════════════════
  async function inviteArbiter(tournamentId, email, role = 'arbiter') {
    if (!Auth.isAdmin()) { UI.showToast('Only admins can invite staff', 'error'); return; }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes('@')) { UI.showToast('Invalid email', 'warning'); return; }

    await db.collection('tournaments').doc(tournamentId).update({
      authorized_arbiters: firebase.firestore.FieldValue.arrayUnion(cleanEmail)
    });

    // Log to venue vault
    await logVenueAction(tournamentId, 'ARBITER_INVITED', {
      email: cleanEmail, role, invitedBy: Auth.getUser()?.email
    });

    UI.showToast(`${cleanEmail} invited as ${role}`, 'success');
    return generateInviteLink(tournamentId);
  }

  async function removeArbiter(tournamentId, email) {
    if (!Auth.isAdmin()) return;
    await db.collection('tournaments').doc(tournamentId).update({
      authorized_arbiters: firebase.firestore.FieldValue.arrayRemove(email.toLowerCase())
    });
    await logVenueAction(tournamentId, 'ARBITER_REMOVED', { email });
    UI.showToast(`${email} removed`, 'info');
  }

  function generateInviteLink(tournamentId) {
    return `${window.location.origin}/#/arbiter-gate?id=${tournamentId}`;
  }

  // ══════════════════════════════════════════════════════════
  //  3. ONBOARDING HANDSHAKE (First Login via Link)
  // ══════════════════════════════════════════════════════════
  async function handleArbiterLogin(tournamentId) {
    // 1. Identity Check
    let arbiterName = sessionStorage.getItem(`arb_name_${tournamentId}`);
    
    if (!arbiterName) {
      console.log('[Arbiter] No handshake found. Redirecting to Gate...');
      App.navigateTo('arbiter-gate', tournamentId);
      return false;
    }

    // 2. Tournament Status Check
    const tDoc = await db.collection('tournaments').doc(tournamentId).get();
    if (!tDoc.exists) { UI.showToast('Tournament not found', 'error'); return false; }

    const tData = tDoc.data();
    if (tData.status === 'completed' || tData.status === 'archived') {
      UI.showToast('Handshake expired (Tournament Closed)', 'warning');
      return false;
    }

    window.currentArbiterName = arbiterName;
    window.activeTournament = { id: tournamentId, ...tData }; // Hydrate for ArbiterView
    return true;
  }

  // ══════════════════════════════════════════════════════════
  //  4. DRAFT RESULT PIPELINE (3-State)
  // ══════════════════════════════════════════════════════════
  /**
   * submitDraftResult: Arbiter submits a pending result.
   * State: pending_approval
   */
  /**
   * submitDraftResult: Arbiter submits a pending result.
   * State: pending_approval
   */
  async function submitDraftResult(tournamentId, roundNumber, board, whiteScore, blackScore, matchNumber = null) {
    const arbiter = window.currentArbiterName || sessionStorage.getItem(`arb_name_${tournamentId}`) || 'Unknown Arbiter';
    const key = matchNumber ? `${roundNumber}_${matchNumber}_${board}` : `${roundNumber}_${board}`;
    
    await db.collection('tournaments').doc(tournamentId).update({
      [`pending_results.${key}`]: {
        round: roundNumber,
        matchNumber: matchNumber,
        board: board,
        whiteScore: whiteScore,
        blackScore: blackScore,
        status: 'pending_approval',
        submittedBy: arbiter,
        submittedAt: firebase.firestore.FieldValue.serverTimestamp()
      }
    });

    await logVenueAction(tournamentId, 'RESULT_DRAFT', {
      board, round: roundNumber, result: `${whiteScore}-${blackScore}`,
      arbiter: arbiter, matchNumber: matchNumber
    });
  }

  /**
   * approveResult: Admin approves a pending result → official
   */
  async function approveResult(tournamentId, roundNumber, board, whiteScore, blackScore, matchNumber = null) {
    if (!Auth.isAdmin() && !TenantManager.isMasterAdmin()) return;

    const key = matchNumber ? `${roundNumber}_${matchNumber}_${board}` : `${roundNumber}_${board}`;

    // Commit to official standings
    await DB.submitResult(tournamentId, roundNumber, parseInt(board), whiteScore, blackScore, false, null, matchNumber);

    // Remove from pending + mark in approval_log
    await db.collection('tournaments').doc(tournamentId).update({
      [`pending_results.${key}`]: firebase.firestore.FieldValue.delete(),
      [`approval_log.${key}`]: {
        status: 'official',
        approvedBy: Auth.getUser()?.email,
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        result: `${whiteScore}-${blackScore}`
      }
    });

    await logVenueAction(tournamentId, 'RESULT_APPROVED', {
      board, round: roundNumber, result: `${whiteScore}-${blackScore}`
    });

    if (window.AuditLog) {
      await AuditLog.logSystemAction('RESULT_APPROVED', {
        tournamentId, round: roundNumber, board, result: `${whiteScore}-${blackScore}`,
        approvedBy: Auth.getUser()?.email
      });
    }
  }

  /**
   * overrideResult: Admin overrides with a different score
   */
  async function overrideResult(tournamentId, roundNumber, board, whiteScore, blackScore, reason, matchNumber = null) {
    if (!Auth.isAdmin() && !TenantManager.isMasterAdmin()) return;
    if (!reason) { UI.showToast('Override reason is mandatory', 'warning'); return; }

    const key = matchNumber ? `${roundNumber}_${matchNumber}_${board}` : `${roundNumber}_${board}`;

    await DB.submitResult(tournamentId, roundNumber, parseInt(board), whiteScore, blackScore, false, null, matchNumber);

    await db.collection('tournaments').doc(tournamentId).update({
      [`pending_results.${key}`]: firebase.firestore.FieldValue.delete(),
      [`approval_log.${key}`]: {
        status: 'official_overridden',
        overriddenBy: Auth.getUser()?.email,
        overriddenAt: firebase.firestore.FieldValue.serverTimestamp(),
        result: `${whiteScore}-${blackScore}`,
        reason: reason
      }
    });

    await logVenueAction(tournamentId, 'RESULT_OVERRIDDEN', {
      board, round: roundNumber, result: `${whiteScore}-${blackScore}`, reason
    });

    if (window.AuditLog) {
      await AuditLog.logSystemAction('RESULT_OVERRIDDEN', {
        tournamentId, round: roundNumber, board, result: `${whiteScore}-${blackScore}`,
        overriddenBy: Auth.getUser()?.email, reason
      });
    }
  }

  /**
   * massApproveAll: "God-Mode" — approve all pending in one go
   */
  async function massApproveAll(tournamentId) {
    if (!Auth.isAdmin() && !TenantManager.isMasterAdmin()) return;

    const tDoc = await db.collection('tournaments').doc(tournamentId).get();
    if (!tDoc.exists) return;

    const pending = tDoc.data().pending_results || {};
    const keys = Object.keys(pending);
    if (keys.length === 0) { UI.showToast('No pending results', 'info'); return; }

    UI.showLoading();
    let count = 0;
    for (const key of keys) {
      const res = pending[key];
      try {
        await DB.submitResult(tournamentId, res.round, parseInt(res.board), res.whiteScore, res.blackScore, false, null, res.matchNumber || null);
        await db.collection('tournaments').doc(tournamentId).update({
          [`pending_results.${key}`]: firebase.firestore.FieldValue.delete(),
          [`approval_log.${key}`]: {
            status: 'official',
            approvedBy: Auth.getUser()?.email,
            approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            result: `${res.whiteScore}-${res.blackScore}`
          }
        });
        count++;
      } catch (e) {
        console.error(`[Arbiter] Failed to approve ${key}:`, e);
      }
    }
    UI.hideLoading();

    await logVenueAction(tournamentId, 'MASS_APPROVAL', { count, approvedBy: Auth.getUser()?.email });
    
    if (window.AuditLog) {
      await AuditLog.logSystemAction('MASS_APPROVAL', {
        tournamentId, count, approvedBy: Auth.getUser()?.email
      });
    }

    UI.showToast(`${count} results approved`, 'success');
  }

  // ══════════════════════════════════════════════════════════
  //  5. VENUE VAULT (Club-Level Audit)
  // ══════════════════════════════════════════════════════════
  async function logVenueAction(tournamentId, type, details) {
    try {
      // 🛡️ REPAIR: Use global AuditLog for robust permission-safe logging
      await AuditLog.log(type, tournamentId, details);
    } catch (e) {
      console.warn('[Arbiter] Logging failed:', e.message);
    }
  }

  return {
    isArbiterForTournament,
    getArbiterRole,
    inviteArbiter,
    removeArbiter,
    generateInviteLink,
    handleArbiterLogin,
    submitDraftResult,
    approveResult,
    overrideResult,
    massApproveAll,
    logVenueAction
  };
})();

window.ArbiterManager = ArbiterManager;
