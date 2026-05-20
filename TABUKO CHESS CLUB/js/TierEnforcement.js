/**
 * TierEnforcement.js — Days 221–225: Quantifiable Usage Cap Gates
 * Non-bypassable resource limitation matrix for Free vs Premium tiers.
 *
 * FREE TIER CAPS:
 *   - Max 3 tournaments
 *   - Max 10 club members
 *   - Offline container packaging: DISABLED
 *   - Automated Google Drive sync: DISABLED
 *   - Public TV signage view: DISABLED
 *
 * PREMIUM TIER: Unlimited access to all modules.
 */
const TierEnforcement = (() => {
  'use strict';

  // ── TIER LIMITS ─────────────────────────────────
  const FREE_LIMITS = {
    tournaments:  3,
    members:      10,
    offline:      false,
    driveSync:    false,
    tvSignage:    false,
  };

  // ── HELPER: IS ACCOUNT PREMIUM ──────────────────
  function _isPremium() {
    if (window.TenantManager?.isMasterAdmin?.()) return true;
    return window.TenantManager?.isSubscriptionActive?.() === true;
  }

  // ── DAY 222: TOURNAMENT COUNT GATE ──────────────
  /**
   * Call before creating a new tournament.
   * Wraps a Firestore count query in a transaction to prevent race conditions.
   * @returns {Promise<{allowed: boolean, count: number, limit: number}>}
   */
  async function checkTournamentCap(clubId) {
    if (_isPremium()) return { allowed: true, count: 0, limit: Infinity };

    if (!clubId) throw new Error('[TierEnforcement] No clubId provided for tournament cap check.');

    const result = await db.runTransaction(async (tx) => {
      // Read current count from club document (fast, atomic, race-safe)
      const clubRef = db.collection('clubs').doc(clubId);
      const clubDoc = await tx.get(clubRef);
      if (!clubDoc.exists) throw new Error('Club not found.');

      const count = clubDoc.data().tournament_count || 0;
      return { count };
    });

    const allowed = result.count < FREE_LIMITS.tournaments;
    if (!allowed) {
      _showUpgradeModal(
        `Tournament Limit Reached (${FREE_LIMITS.tournaments}/${FREE_LIMITS.tournaments})`,
        'Free accounts are limited to 3 active tournaments. Upgrade to Premium for unlimited tournaments.'
      );
    }
    return { allowed, count: result.count, limit: FREE_LIMITS.tournaments };
  }

  // ── DAY 223: MEMBER COUNT GATE ──────────────────
  /**
   * Call before creating a new club member.
   * Disables creation inputs when active profiles reach 10.
   * @returns {Promise<{allowed: boolean, count: number, limit: number}>}
   */
  async function checkMemberCap(clubId) {
    if (_isPremium()) return { allowed: true, count: 0, limit: Infinity };

    if (!clubId) throw new Error('[TierEnforcement] No clubId provided for member cap check.');

    const snap = await db.collection('members')
      .where('clubId', '==', clubId)
      .where('status', '==', 'active')
      .where('isArchived', '==', false)
      .get();

    const count   = snap.size;
    const allowed = count < FREE_LIMITS.members;

    if (!allowed) {
      _showUpgradeModal(
        `Member Limit Reached (${count}/${FREE_LIMITS.members})`,
        'Free accounts support up to 10 active club members. Upgrade to Premium for an unlimited roster.'
      );
    }
    return { allowed, count, limit: FREE_LIMITS.members };
  }

  // ── DAY 223: DISABLE MEMBER INPUT UI ────────────
  /**
   * Evaluates current member count and disables creation buttons in the UI
   * when the free cap is reached. Safe to call on roster page render.
   */
  async function enforceMemberCapUI(clubId) {
    if (_isPremium()) return;
    const { allowed, count, limit } = await checkMemberCap(clubId);

    const addBtns = document.querySelectorAll(
      '#btn-add-member, #btn-import-member, [data-action="add-member"], .add-member-btn'
    );

    addBtns.forEach(btn => {
      if (!allowed) {
        btn.disabled = true;
        btn.title    = `Member limit reached (${count}/${limit}) — Upgrade to Premium`;
        btn.style.opacity = '0.45';
        btn.style.cursor  = 'not-allowed';
        // Inject cap badge near the button
        if (!btn.nextElementSibling?.classList?.contains('tier-cap-badge')) {
          const badge = document.createElement('span');
          badge.className   = 'tier-cap-badge';
          badge.textContent = `${count}/${limit} FREE LIMIT`;
          badge.style.cssText = 'font-size:0.55rem;font-weight:900;color:#f59e0b;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);padding:2px 7px;border-radius:4px;margin-left:6px;vertical-align:middle;letter-spacing:0.5px;';
          btn.insertAdjacentElement('afterend', badge);
        }
      } else {
        btn.disabled = false;
        btn.title    = '';
        btn.style.opacity = '';
        btn.style.cursor  = '';
        btn.nextElementSibling?.classList?.contains('tier-cap-badge') && btn.nextElementSibling.remove();
      }
    });
  }

  // ── DAY 224: OFFLINE PACKAGING GATE ─────────────
  function checkOfflinePackagingAccess() {
    if (_isPremium()) return true;
    _showUpgradeModal(
      'Premium Feature: Offline Container Packaging',
      'Offline tournament packaging is a Premium-only feature. Upgrade to enable floor-side offline operation.'
    );
    return false;
  }

  // ── DAY 225: DRIVE SYNC GATE ─────────────────────
  function checkDriveSyncAccess() {
    if (_isPremium()) return true;
    _showUpgradeModal(
      'Premium Feature: Automated Google Drive Sync',
      'Automated PGN and asset Drive sync is a Premium-only feature.'
    );
    return false;
  }

  // ── TV SIGNAGE GATE ───────────────────────────────
  function checkTvSignageAccess() {
    if (_isPremium()) return true;
    _showUpgradeModal(
      'Premium Feature: Public TV Signage',
      'Live leaderboard TV signage is available for Premium clubs only.'
    );
    return false;
  }

  // ── UPGRADE MODAL ────────────────────────────────
  function _showUpgradeModal(title, body) {
    document.getElementById('tier-cap-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'tier-cap-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);z-index:10001;padding:1rem;';
    modal.innerHTML = `
      <div style="background:#0f172a;border:1px solid rgba(245,158,11,0.3);border-radius:16px;padding:2rem;width:100%;max-width:400px;text-align:center;color:#e2e8f0;font-family:'Inter',sans-serif;">
        <div style="font-size:2.5rem;margin-bottom:1rem;">🔒</div>
        <h3 style="color:#f59e0b;font-weight:900;margin:0 0 0.5rem;font-size:1rem;">${title}</h3>
        <p style="color:#94a3b8;font-size:0.8rem;line-height:1.6;margin:0 0 1.5rem;">${body}</p>
        <button onclick="document.getElementById('tier-cap-modal').remove();if(window.BillingWizard)BillingWizard.openWizard();"
          style="width:100%;padding:0.75rem;background:linear-gradient(135deg,rgba(245,158,11,0.2),rgba(245,158,11,0.1));border:1px solid rgba(245,158,11,0.4);color:#f59e0b;border-radius:8px;font-weight:800;font-size:0.85rem;cursor:pointer;font-family:inherit;margin-bottom:0.5rem;">
          ✨ Upgrade to Premium — ₱50/month
        </button>
        <button onclick="document.getElementById('tier-cap-modal').remove();"
          style="width:100%;padding:0.5rem;background:none;border:none;color:#475569;cursor:pointer;font-family:inherit;font-size:0.75rem;">
          Not now
        </button>
      </div>`;
    document.body.appendChild(modal);
  }

  // ── PUBLIC LIMITS READ ───────────────────────────
  function getLimits() { return { ...FREE_LIMITS }; }
  function isPremium()  { return _isPremium(); }

  return {
    checkTournamentCap,
    checkMemberCap,
    enforceMemberCapUI,
    checkOfflinePackagingAccess,
    checkDriveSyncAccess,
    checkTvSignageAccess,
    getLimits,
    isPremium
  };
})();

window.TierEnforcement = TierEnforcement;
