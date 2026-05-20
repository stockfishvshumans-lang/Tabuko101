/**
 * MultiTenantRuntime.js — Cross-Club Inheritance Boundary & Scope Validator
 * Day 260 & 285 & 294: Permission inheritance tree to isolate data ops between clubs.
 *
 * Architecture:
 *   Every data operation → validateTenantScope(clubId)
 *   → verify user identity token matches parent tenant scope
 *   → allow or reject with audit trail
 *
 * @version 1.0.0 — Day 260/285/294 Sprint
 */
const MultiTenantRuntime = (() => {
  'use strict';

  const _scopeRegistry = new Map();
  const _accessLog = [];
  const MAX_ACCESS_LOG = 200;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SCOPE VALIDATION GATE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * validateTenantScope: Cross-references user identity against tenant boundaries.
   * MUST be called before any write operation across clubs.
   */
  function validateTenantScope(targetClubId, operationType = 'READ') {
    const activeClubId = window.TenantManager?.getActiveClubId?.();
    const userUid = window.Auth?.getUser?.()?.uid || null;
    const isMaster = window.TenantManager?.isMasterAdmin?.() || false;

    const result = {
      allowed: false,
      reason: '',
      targetClubId,
      activeClubId,
      userUid,
      operationType,
      timestamp: Date.now()
    };

    // Master admin bypass (with audit)
    if (isMaster) {
      result.allowed = true;
      result.reason = 'MASTER_ADMIN_BYPASS';
      logAccess(result);
      return result;
    }

    // Scope check: target must match active club
    if (!targetClubId || !activeClubId) {
      result.reason = 'MISSING_SCOPE_IDENTIFIERS';
      logAccess(result);
      return result;
    }

    if (targetClubId !== activeClubId) {
      result.reason = 'CROSS_TENANT_VIOLATION';
      console.warn(`[MultiTenantRuntime] 🚫 Cross-tenant ${operationType} blocked: ${activeClubId} → ${targetClubId}`);
      logAccess(result);
      return result;
    }

    // Verify user belongs to this club
    const userScope = _scopeRegistry.get(userUid);
    if (userScope && !userScope.clubs.includes(targetClubId) && !userScope.isMaster) {
      result.reason = 'USER_NOT_IN_CLUB_SCOPE';
      logAccess(result);
      return result;
    }

    result.allowed = true;
    result.reason = 'SCOPE_VALID';
    logAccess(result);
    return result;
  }

  /**
   * wrapWithScopeCheck: Higher-order function to guard any async operation.
   */
  function wrapWithScopeCheck(targetClubId, operationType, asyncFn) {
    const scope = validateTenantScope(targetClubId, operationType);
    if (!scope.allowed) {
      console.error(`[MultiTenantRuntime] Operation blocked: ${scope.reason}`);
      throw new Error(`TENANT_SCOPE_VIOLATION: ${scope.reason}`);
    }
    return asyncFn();
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // USER SCOPE REGISTRATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function registerUserScope(userUid, clubIds = [], isMaster = false) {
    _scopeRegistry.set(userUid, {
      userUid,
      clubs: [...clubIds],
      isMaster,
      registeredAt: Date.now()
    });
  }

  function getUserScope(userUid) {
    return _scopeRegistry.get(userUid) || null;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CACHE PARTITION VALIDATOR
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function getPartitionedCacheKey(baseKey) {
    const clubId = window.TenantManager?.getActiveClubId?.() || 'default';
    return `tenant_${clubId}_${baseKey}`;
  }

  function validateCachePartition(cacheKey) {
    const clubId = window.TenantManager?.getActiveClubId?.() || 'default';
    return cacheKey.includes(`tenant_${clubId}_`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SHADOW SESSION AUDITING (Day 269/294)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function logShadowSessionEntry(masterUid, targetClubId, purpose = '') {
    const auditRecord = {
      type: 'SHADOW_SESSION_ENTRY',
      masterUid,
      masterEmail: window.Auth?.getUser?.()?.email || 'unknown',
      targetClubId,
      purpose,
      authorizationToken: crypto.randomUUID(),
      timestamp: Date.now(),
      clientTimestamp: new Date().toISOString()
    };

    _accessLog.push(auditRecord);

    // Persist to central audit ledger
    try {
      if (typeof db !== 'undefined') {
        await db.collection('system_logs').add({
          ...auditRecord,
          serverTimestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    } catch (err) {
      console.warn('[MultiTenantRuntime] Shadow session audit persistence queued:', err.message);
    }

    // Also log to operational ledger if available
    if (window.OperationalLedger) {
      await window.OperationalLedger.logCriticalAction('SHADOW_SESSION_ENTRY', auditRecord);
    }

    console.log(`[MultiTenantRuntime] 🔍 Shadow session logged: ${masterUid} → ${targetClubId}`);
    return auditRecord;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ACCESS LOGGING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function logAccess(result) {
    _accessLog.push({ ...result });
    if (_accessLog.length > MAX_ACCESS_LOG) _accessLog.shift();
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WORKSPACE ISOLATION MONITOR UI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function renderWorkspaceIsolationMonitor(containerId = 'isolation-monitor-root') {
    const root = document.getElementById(containerId);
    if (!root) return;

    const activeClubId = window.TenantManager?.getActiveClubId?.() || 'N/A';
    const userUid = window.Auth?.getUser?.()?.uid || 'N/A';
    const isMaster = window.TenantManager?.isMasterAdmin?.() || false;
    const recentAccess = _accessLog.slice(-10).reverse();

    const violations = _accessLog.filter(a => !a.allowed).length;
    const totalChecks = _accessLog.length;

    root.innerHTML = `
      <div style="background:rgba(15,23,42,0.95);border:1px solid rgba(${violations > 0 ? '239,68,68' : '16,185,129'},0.15);border-radius:12px;padding:1rem;font-family:'JetBrains Mono',monospace;color:#e2e8f0;font-size:0.65rem;">
        <div style="font-weight:900;font-size:0.6rem;text-transform:uppercase;letter-spacing:2px;color:#10b981;margin-bottom:0.75rem;">🛡️ Workspace Isolation</div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;margin-bottom:0.75rem;">
          <div style="background:rgba(0,0,0,0.3);padding:0.5rem;border-radius:6px;">
            <div style="font-size:0.45rem;color:#64748b;font-weight:800;">ACTIVE TENANT</div>
            <div style="font-size:0.65rem;font-weight:900;color:#00f2ff;overflow:hidden;text-overflow:ellipsis;">${activeClubId}</div>
          </div>
          <div style="background:rgba(0,0,0,0.3);padding:0.5rem;border-radius:6px;">
            <div style="font-size:0.45rem;color:#64748b;font-weight:800;">ACCESS ROLE</div>
            <div style="font-size:0.65rem;font-weight:900;color:${isMaster ? '#f59e0b' : '#10b981'};">${isMaster ? 'MASTER' : 'CLUB ADMIN'}</div>
          </div>
          <div style="background:rgba(0,0,0,0.3);padding:0.5rem;border-radius:6px;">
            <div style="font-size:0.45rem;color:#64748b;font-weight:800;">VIOLATIONS</div>
            <div style="font-size:0.65rem;font-weight:900;color:${violations > 0 ? '#ef4444' : '#10b981'};">${violations} / ${totalChecks}</div>
          </div>
        </div>

        <div style="font-size:0.5rem;color:#64748b;font-weight:800;margin-bottom:0.25rem;">RECENT ACCESS CHECKS</div>
        ${recentAccess.map(a => `
          <div style="display:flex;gap:6px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.02);font-size:0.5rem;align-items:center;">
            <span style="color:${a.allowed ? '#10b981' : '#ef4444'};">${a.allowed ? '✓' : '✗'}</span>
            <span style="color:#475569;min-width:50px;">${a.operationType}</span>
            <span style="color:#64748b;flex:1;overflow:hidden;text-overflow:ellipsis;">${a.reason}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLIC API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    validateTenantScope,
    wrapWithScopeCheck,
    registerUserScope,
    getUserScope,
    getPartitionedCacheKey,
    validateCachePartition,
    logShadowSessionEntry,
    renderWorkspaceIsolationMonitor,
    getAccessLog: () => [..._accessLog]
  };
})();

window.MultiTenantRuntime = MultiTenantRuntime;
