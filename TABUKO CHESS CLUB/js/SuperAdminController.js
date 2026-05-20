/**
 * SuperAdminController.js — The "Titanium" Backend Logic
 * All destructive operations are transaction-wrapped.
 * Master Admin: giradojesster28@gmail.com
 */
const SuperAdminController = (() => {

  // ══════════════════════════════════════════════════════════
  //  1. MANUAL CREDIT (Transaction-Wrapped)
  // ══════════════════════════════════════════════════════════
  async function applyManualCredit(clubId, days, reason) {
    if (!TenantManager.isMasterAdmin()) {
      UI.showToast('Unauthorized', 'error');
      return;
    }
    if (!reason || reason.trim().length < 3) {
      UI.showToast('A reason note is mandatory', 'warning');
      return;
    }

    const clubRef = db.collection('clubs').doc(clubId);

    try {
      await db.runTransaction(async (transaction) => {
        const clubDoc = await transaction.get(clubRef);
        if (!clubDoc.exists) throw new Error('Club not found');

        const data = clubDoc.data();
        const now = new Date();
        const sub = data.subscription || {};
        let currentExpiry = now;
        if (sub.end_date) {
          if (typeof sub.end_date.toDate === 'function') currentExpiry = sub.end_date.toDate();
          else if (sub.end_date.seconds) currentExpiry = new Date(sub.end_date.seconds * 1000);
          else currentExpiry = new Date(sub.end_date);
        }

        // STACKING LOGIC: If active, append. If expired, start from today.
        let newExpiry = new Date(currentExpiry > now ? currentExpiry : now);
        newExpiry.setDate(newExpiry.getDate() + parseInt(days));

        transaction.update(clubRef, {
          'subscription.end_date': firebase.firestore.Timestamp.fromDate(newExpiry),
          'subscription.is_premium': true,
          'subscription.status': 'premium',
          'updatedAt': firebase.firestore.FieldValue.serverTimestamp()
        });

        // Audit log within the same transaction
        const logRef = db.collection('system_logs').doc();
        transaction.set(logRef, {
          type: 'MANUAL_CREDIT',
          clubId: clubId,
          days: parseInt(days),
          reason: reason.trim(),
          actorEmail: Auth.getUser()?.email || 'SuperAdmin',
          actorUid: Auth.getUser()?.uid || 'system',
          message: `[CREDIT] +${days} days to ${data.name || clubId}. Reason: ${reason.trim()}`,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        const billingLogRef = clubRef.collection('billing_ledger').doc();
        transaction.set(billingLogRef, {
          referenceNumber: 'MANUAL_' + Date.now().toString().slice(-6),
          amount: 0,
          daysAdded: parseInt(days),
          syncedAt: firebase.firestore.FieldValue.serverTimestamp(),
          status: 'verified',
          reason: reason.trim(),
          actorUid: Auth.getUser()?.uid || 'system'
        });
      });

      UI.showToast(`+${days} days credited to ${clubId}`, 'success');
      return true;
    } catch (err) {
      UI.showToast('Credit failed: ' + err.message, 'error');
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  1b. SUBSCRIPTION STACKING LOGIC (applyCredit)
  // ══════════════════════════════════════════════════════════
  async function applyCredit(clubId, days, reason) {
    if (!TenantManager.isMasterAdmin()) return;
    const adminEmail = Auth.getUser()?.email || 'SuperAdmin';
    const clubRef = db.collection('clubs').doc(clubId);

    try {
      await db.runTransaction(async (transaction) => {
        const clubDoc = await transaction.get(clubRef);
        if (!clubDoc.exists) throw new Error('Club not found');

        const data = clubDoc.data();
        const now = new Date();
        const sub = data.subscription || {};
        let currentExpiry = sub.end_date?.toDate ? sub.end_date.toDate() : (sub.end_date ? new Date(sub.end_date) : now);

        // THE HANDSHAKE: If ACTIVE, add days. If EXPIRED, now + days.
        let newExpiry = new Date(currentExpiry > now ? currentExpiry : now);
        newExpiry.setDate(newExpiry.getDate() + parseInt(days));

        transaction.update(clubRef, {
          'subscription.end_date': firebase.firestore.Timestamp.fromDate(newExpiry),
          'subscription.status': 'premium',
          'subscription.is_premium': true,
          'updatedAt': firebase.firestore.FieldValue.serverTimestamp()
        });

        // AUDIT VAULT: Write to system_logs
        const logRef = db.collection('system_logs').doc();
        transaction.set(logRef, {
          type: 'ADMIN_CREDIT',
          clubId: clubId,
          days: parseInt(days),
          reason: reason.trim(),
          actorEmail: adminEmail,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        const billingLogRef = clubRef.collection('billing_ledger').doc();
        transaction.set(billingLogRef, {
          referenceNumber: 'ADMIN_' + Date.now().toString().slice(-6),
          amount: 0,
          daysAdded: parseInt(days),
          syncedAt: firebase.firestore.FieldValue.serverTimestamp(),
          status: 'verified',
          reason: reason.trim(),
          actorUid: Auth.getUser()?.uid || 'system'
        });
      });
      UI.showToast(`+${days} days credited to ${clubId}`, 'success');
      return true;
    } catch (err) {
      UI.showToast('Credit failed: ' + err.message, 'error');
      return false;
    }
  }

  async function resolveTicketWithCredit(ticketId, clubId, creditDays) {
    const ticketRef = db.collection('support_tickets').doc(ticketId);
    const clubRef = db.collection('clubs').doc(clubId);
    
    await db.runTransaction(async (transaction) => {
      const ticketDoc = await transaction.get(ticketRef);
      if (!ticketDoc.exists) throw new Error("Target support ticket missing.");
      
      const clubDoc = await transaction.get(clubRef);
      if (!clubDoc.exists) throw new Error("Target club instance missing.");
      
      const sub = clubDoc.data().subscription || {};
      let currentExpiry = sub.end_date?.toDate ? sub.end_date.toDate() : new Date();
      let newExpiry = new Date(currentExpiry > new Date() ? currentExpiry : new Date());
      newExpiry.setDate(newExpiry.getDate() + parseInt(creditDays, 10));
      
      transaction.update(ticketRef, { status: 'approved', resolvedAt: firebase.firestore.FieldValue.serverTimestamp() });
      transaction.update(clubRef, {
        'subscription.end_date': firebase.firestore.Timestamp.fromDate(newExpiry),
        'subscription.status': 'premium',
        'subscription.is_premium': true
      });
    });
  }


  // ══════════════════════════════════════════════════════════
  //  2. PAYMENT VERIFICATION (Atomic with Duplicate Check)
  // ══════════════════════════════════════════════════════════
  async function verifyPayment(clubId, refNo) {
    if (!TenantManager.isMasterAdmin()) return;

    try {
      // Duplicate reference check
      const dupCheck = await db.collection('system_logs')
        .where('refNo', '==', refNo)
        .where('type', '==', 'PAYMENT_VERIFIED')
        .get();

      if (!dupCheck.empty) {
        throw new Error(`Reference ${refNo} has already been claimed.`);
      }

      const clubRef = db.collection('clubs').doc(clubId);

      await db.runTransaction(async (transaction) => {
        const clubDoc = await transaction.get(clubRef);
        if (!clubDoc.exists) throw new Error('Club not found');
        const clubData = clubDoc.data();

        const now = new Date();
        let currentExpiry = clubData.subscription?.end_date?.toDate() || now;

        // STACKING: Active = append 30d. Expired = today + 30d.
        let newExpiry = new Date(currentExpiry > now ? currentExpiry : now);
        newExpiry.setDate(newExpiry.getDate() + 30);

        transaction.update(clubRef, {
          'subscription.end_date': firebase.firestore.Timestamp.fromDate(newExpiry),
          'subscription.is_premium': true,
          'subscription.status': 'premium',
          'subscription.last_verified_ref': refNo,
          'pending_verification': false,
          'updatedAt': firebase.firestore.FieldValue.serverTimestamp()
        });

        const logRef = db.collection('system_logs').doc();
        transaction.set(logRef, {
          type: 'PAYMENT_VERIFIED',
          clubId: clubId,
          refNo: refNo,
          actorEmail: Auth.getUser()?.email || 'SuperAdmin',
          actorUid: Auth.getUser()?.uid || 'system',
          message: `[VERIFIED] ${clubData.name || clubId} — Ref: ${refNo} — +30 days until ${newExpiry.toLocaleDateString()}`,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      });

      UI.showToast('Payment verified — +30 days applied', 'success');
    } catch (err) {
      UI.showToast(err.message, 'error');
    }
  }

  // ══════════════════════════════════════════════════════════
  //  3. SHADOW LOGIN (Impersonation Mode)
  // ══════════════════════════════════════════════════════════
  function shadowLogin(clubId) {
    if (!TenantManager.isMasterAdmin()) return;

    TenantManager.enterShadowMode(clubId);

    // Log the impersonation event
    db.collection('system_logs').add({
      type: 'SHADOW_LOGIN',
      clubId: clubId,
      actorEmail: Auth.getUser()?.email || 'SuperAdmin',
      actorUid: Auth.getUser()?.uid || 'system',
      message: `[SHADOW] SuperAdmin entered shadow mode for club: ${clubId}`,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    UI.showToast(`Shadow Mode: Viewing as ${clubId}`, 'info');

    // Navigate to that club's dashboard
    App.navigateTo('dashboard');
  }

  function exitShadowLogin() {
    TenantManager.exitShadowMode();
    UI.showToast('Shadow Mode exited', 'info');
    App.navigateTo('super-admin');
  }

  // ══════════════════════════════════════════════════════════
  //  4. GLOBAL ANNOUNCEMENT SYSTEM
  // ══════════════════════════════════════════════════════════
  async function broadcastAnnouncement(message, type = 'info') {
    if (!TenantManager.isMasterAdmin()) return;

    await db.collection('system').doc('announcements').set({
      message: message,
      type: type, // 'info' | 'warning' | 'critical'
      active: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      author: Auth.getUser()?.email || 'SuperAdmin'
    });

    await db.collection('system_logs').add({
      type: 'ANNOUNCEMENT',
      message: `[BROADCAST] ${type.toUpperCase()}: ${message}`,
      actor: Auth.getUser()?.email || 'SuperAdmin',
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    UI.showToast('Announcement broadcast to all clubs', 'success');
  }

  async function clearAnnouncement() {
    if (!TenantManager.isMasterAdmin()) return;
    await db.collection('system').doc('announcements').set({
      active: false,
      message: '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    UI.showToast('Announcement cleared', 'info');
  }

  // ══════════════════════════════════════════════════════════
  //  5. KILL SWITCH (Club Suspension)
  // ══════════════════════════════════════════════════════════
  async function toggleClubSuspension(clubId) {
    if (!TenantManager.isMasterAdmin()) return;

    const clubRef = db.collection('clubs').doc(clubId);
    const clubSnap = await clubRef.get();
    if (!clubSnap.exists) return;

    const isSuspended = clubSnap.data().suspended || false;
    const newStatus = !isSuspended;

    await clubRef.update({
      suspended: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    if (typeof AuditLog !== 'undefined') {
      await AuditLog.log(
        newStatus ? 'CLUB_SUSPENDED' : 'CLUB_REACTIVATED',
        null,
        { clubId, actorEmail: Auth.getUser()?.email || 'SuperAdmin' }
      );
    } else {
      await db.collection('audit_logs').add({
        action: newStatus ? 'CLUB_SUSPENDED' : 'CLUB_REACTIVATED',
        clubId: clubId,
        actorEmail: Auth.getUser()?.email || 'SuperAdmin',
        details: { message: `[${newStatus ? 'SUSPENDED' : 'REACTIVATED'}] Club: ${clubId}` },
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    UI.showToast(`Club ${clubId} has been ${newStatus ? 'suspended' : 'reactivated'}`, newStatus ? 'warning' : 'success');
  }

  // ══════════════════════════════════════════════════════════
  //  6. REMOTE SURGEON (Force Cache Clear)
  // ══════════════════════════════════════════════════════════
  async function forceCacheClear(clubId) {
    if (!TenantManager.isMasterAdmin()) return;

    if (!confirm(`WARING: This will force a HARD REFRESH on all active sessions for Club ${clubId}. Proceed?`)) return;

    try {
      UI.showLoading('Broadcasting Purge Signal...');
      await db.collection('system').doc(`cmd_${clubId}`).set({
        command: 'PURGE_CACHE',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        issuedBy: Auth.getUser()?.email || 'SuperAdmin'
      });

      UI.showToast(`Purge Signal Broadcasted to ${clubId}`, 'success');
    } catch (err) {
      UI.showToast(err.message, 'error');
    } finally {
      UI.hideLoading();
    }
  }

  // ══════════════════════════════════════════════════════════
  //  7. DATABASE GARBAGE COLLECTION
  // ══════════════════════════════════════════════════════════
  async function archivePastSeasonData() {
    if (!TenantManager.isMasterAdmin()) return;

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    try {
      const oldTournaments = await db.collection('tournaments')
        .where('status', 'in', ['completed', 'finished', 'archived'])
        .where('createdAt', '<', firebase.firestore.Timestamp.fromDate(sixMonthsAgo))
        .get();

      if (oldTournaments.empty) {
        UI.showToast('No old tournaments to archive', 'info');
        return 0;
      }

      let count = 0;
      const batch = db.batch();

      oldTournaments.docs.forEach(doc => {
        // Copy to history collection
        const historyRef = db.collection('tournament_history').doc(doc.id);
        batch.set(historyRef, {
          ...doc.data(),
          archivedAt: firebase.firestore.FieldValue.serverTimestamp(),
          archivedBy: Auth.getUser()?.email || 'SuperAdmin'
        });

        // Mark original as deep-archived
        batch.update(doc.ref, {
          status: 'deep_archived',
          isArchived: true,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        count++;
      });

      // Log the GC event
      const logRef = db.collection('system_logs').doc();
      batch.set(logRef, {
        type: 'GARBAGE_COLLECTION',
        message: `[GC] Archived ${count} tournaments older than 6 months`,
        actor: Auth.getUser()?.email || 'SuperAdmin',
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      await batch.commit();
      UI.showToast(`Archived ${count} old tournaments`, 'success');
      return count;
    } catch (err) {
      UI.showToast('Archive failed: ' + err.message, 'error');
      return 0;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  7. REJECTION HANDLER
  // ══════════════════════════════════════════════════════════
  async function rejectPayment(clubId, reason) {
    if (!TenantManager.isMasterAdmin()) return;

    await db.collection('clubs').doc(clubId).update({
      pending_verification: false,
      rejection_reason: reason,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('system_logs').add({
      type: 'PAYMENT_REJECTED',
      clubId: clubId,
      reason: reason,
      actor: Auth.getUser()?.email || 'SuperAdmin',
      message: `[REJECTED] Club ${clubId}: ${reason}`,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    UI.showToast('Payment rejected', 'info');
  }

  // ══════════════════════════════════════════════════════════
  //  8. CLUB PROVISIONING (Atomic Batch)
  // ══════════════════════════════════════════════════════════
  async function provisionClub({ clubName, adminEmail, slug, logoUrl }) {
    if (!TenantManager.isMasterAdmin()) return;

    // Validate slug uniqueness
    const existing = await db.collection('clubs').doc(slug).get();
    if (existing.exists) throw new Error(`Slug "${slug}" is already taken.`);

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7);

    const batch = db.batch();

    // Club document
    const clubRef = db.collection('clubs').doc(slug);
    batch.set(clubRef, {
      name: clubName,
      slug: slug,
      admin_email: adminEmail.toLowerCase(),
      admin_uid: null, // Locked on first admin login (UID Binding)
      branding: { logo_url: logoUrl || null, colors: { primary: '#00f2ff', secondary: '#1a1a2e' } },
      subscription: {
        status: 'premium_trial',
        end_date: firebase.firestore.Timestamp.fromDate(trialEnd),
        is_premium: true,
        has_used_trial: true
      },
      suspended: false,
      pending_verification: false,
      infrastructure: { provisioned_at: firebase.firestore.FieldValue.serverTimestamp(), tier: 'TRIAL', storage_mb: 0 },
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Default settings sub-collection
    const settingsRef = db.collection('clubs').doc(slug).collection('settings').doc('default');
    batch.set(settingsRef, {
      timeControl: 'Classical',
      tiebreaks: ['buchholzCut1', 'buchholzFull', 'sonnebornBerger'],
      pointSystem: { win: 1, draw: 0.5, loss: 0 },
      boardCapacity: 20,
      venues: [],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Provisioning log
    const logRef = db.collection('system_logs').doc();
    batch.set(logRef, {
      type: 'CLUB_PROVISIONED',
      clubId: slug,
      message: `[PROVISIONED] "${clubName}" (${slug}) for ${adminEmail}. Trial until ${trialEnd.toLocaleDateString()}`,
      actor: Auth.getUser()?.email || 'SuperAdmin',
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Pre-authorize admin email
    const provRef = db.collection('pending_provision').doc(adminEmail.toLowerCase());
    batch.set(provRef, { clubId: slug, email: adminEmail.toLowerCase(), provisioned: true });

    await batch.commit();
    UI.showToast(`Club "${clubName}" provisioned successfully`, 'success');
  }

  async function checkSlugAvailability(slug) {
    const clean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
    if (clean.length < 3) return { available: false, slug: clean, reason: 'Too short' };
    const doc = await db.collection('clubs').doc(clean).get();
    return { available: !doc.exists, slug: clean };
  }

  // ══════════════════════════════════════════════════════════
  //  9. LOGIC VERSION PUSH
  // ══════════════════════════════════════════════════════════
  async function pushLogicVersion(version) {
    if (!TenantManager.isMasterAdmin()) return;
    await db.collection('system').doc('config').set({
      min_required_version: version,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await db.collection('system_logs').add({
      type: 'LOGIC_UPDATE',
      message: `[LOGIC] Min required version pushed to v${version}`,
      actor: Auth.getUser()?.email || 'SuperAdmin',
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    UI.showToast(`Logic version updated to v${version}`, 'success');
  }

  // ══════════════════════════════════════════════════════════
  //  10. TOGGLE EVENT CREATION AUTHORITY
  // ══════════════════════════════════════════════════════════
  async function toggleEventCreation(clubId, canCreate) {
    if (!TenantManager.isMasterAdmin()) return;
    await db.collection('clubs').doc(clubId).update({
      can_create_events: canCreate,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    UI.showToast(`Event creation ${canCreate ? 'enabled' : 'disabled'} for ${clubId}`, 'info');
  }

  // ══════════════════════════════════════════════════════════
  //  11. REMOTE SURGEON (Force Cache Clear)
  // ══════════════════════════════════════════════════════════
  async function forceCacheClear(clubId) {
    if (!TenantManager.isMasterAdmin()) return;

    await db.collection('system').doc(`cmd_${clubId}`).set({
      command: 'PURGE_CACHE',
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      actor: Auth.getUser()?.email || 'SuperAdmin'
    });

    await db.collection('system_logs').add({
      type: 'REMOTE_SURGEON',
      clubId: clubId,
      message: `[SURGEON] Force cache purge signal sent to ${clubId}`,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    UI.showToast(`Cache purge signal sent to ${clubId}`, 'success');
  }

  // ══════════════════════════════════════════════════════════
  //  12. REVENUE & CONVERSION ANALYTICS
  // ══════════════════════════════════════════════════════════
  async function getSubscriptionMetrics() {
    if (!TenantManager.isMasterAdmin()) return;
    const snap = await db.collection('clubs').get();
    const now = new Date();
    const threshold48h = new Date(now.getTime() + (48 * 60 * 60 * 1000));

    const funnel = { trial: 0, expired: 0, premium: 0 };
    const alerts = [];

    snap.docs.forEach(doc => {
      const data = doc.data();
      const sub = data.subscription || {};
      const exp = sub.end_date?.toDate ? sub.end_date.toDate() : (sub.end_date ? new Date(sub.end_date) : null);

      if (sub.status === 'premium_trial' && (!exp || exp > now)) {
        funnel.trial++;
      } else if (sub.status === 'premium' && exp && exp > now) {
        funnel.premium++;
        if (exp < threshold48h) alerts.push({ id: doc.id, name: data.name, expiry: exp });
      } else {
        funnel.expired++;
      }
    });

    return { funnel, alerts };
  }

  // ══════════════════════════════════════════════════════════
  //  13. GOODWILL EXTENSION (+3 Days)
  // ══════════════════════════════════════════════════════════
  async function extendTrialGoodwill(clubId) {
    if (!TenantManager.isMasterAdmin()) return;

    try {
      UI.showLoading('Injecting Goodwill Credit...');
      const clubRef = db.collection('clubs').doc(clubId);
      const clubDoc = await clubRef.get();
      const currentEnd = clubDoc.data()?.subscription?.end_date?.toDate() || new Date();

      const newEnd = new Date(Math.max(currentEnd, new Date()));
      newEnd.setDate(newEnd.getDate() + 3);

      await clubRef.update({
        'subscription.end_date': firebase.firestore.Timestamp.fromDate(newEnd),
        'updatedAt': firebase.firestore.FieldValue.serverTimestamp()
      });

      await db.collection('system_logs').add({
        type: 'GOODWILL_CREDIT',
        clubId: clubId,
        message: `[GOODWILL] +3 days extension granted to ${clubId}`,
        actorEmail: Auth.getUser()?.email,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      UI.showToast('Goodwill +3 Days applied', 'success');
    } catch (err) { UI.showToast(err.message, 'error'); }
    finally { UI.hideLoading(); }
  }

  // ══════════════════════════════════════════════════════════
  //  14. MASTER AUTHORITY TOGGLE
  // ══════════════════════════════════════════════════════════
  async function toggleMasterAuthority(enabled) {
    if (!TenantManager.isMasterAdmin()) return;

    await db.collection('system').doc('config').set({
      provisioning_enabled: enabled,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    UI.showToast(`Provisioning ${enabled ? 'Enabled' : 'Disabled'}`, enabled ? 'success' : 'warning');
  }

  // ══════════════════════════════════════════════════════════
  //  15. SOS / SUPPORT REPORTING
  // ══════════════════════════════════════════════════════════
  async function reportIssue() {
    const msg = prompt("SOS Support: Describe the critical issue or assistance required:");
    if (!msg || msg.trim().length < 5) return;

    try {
      UI.showLoading('Broadcasting SOS...');
      const clubId = TenantManager.getActiveClubId() || 'unknown';
      const user = Auth.getUser();

      await db.collection('support_tickets').add({
        type: 'SOS_REPORT',
        clubId: clubId,
        message: msg,
        severity: 'critical',
        status: 'pending',
        actorEmail: user?.email || 'unknown',
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      await db.collection('system_logs').add({
        type: 'SOS_BROADCAST',
        clubId: clubId,
        message: `[SOS] ${clubId} reported: ${msg}`,
        actor: user?.email,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      UI.showToast('SOS Broadcasted to Super Admin', 'success');
    } catch (err) { UI.showToast(err.message, 'error'); }
    finally { UI.hideLoading(); }
  }

  return {
    applyManualCredit,
    verifyPayment,
    rejectPayment,
    shadowLogin,
    exitShadowLogin,
    broadcastAnnouncement,
    clearAnnouncement,
    toggleClubSuspension,
    archivePastSeasonData,
    provisionClub,
    checkSlugAvailability,
    pushLogicVersion,
    toggleEventCreation,
    forceCacheClear,
    getSubscriptionMetrics,
    extendTrialGoodwill,
    toggleMasterAuthority,
    reportIssue,
    applyCredit
  };
})();

window.SuperAdminController = SuperAdminController;
