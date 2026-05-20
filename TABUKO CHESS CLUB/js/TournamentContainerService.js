/**
 * TournamentContainerService.js — Portable Tournament OS: Container Engine
 * Days 151–160 Sprint: AES-GCM packaging, pre-flight validation, subscription
 * gateway, offline branch forking, 72-hour expiry, health diagnostics.
 * @version 2.0.0 — Days 151–160
 */
const TournamentContainerService = (() => {
  'use strict';

  const CONTAINER_VERSION = '2.0.0';
  const SCHEMA_VERSION = 4;
  const OFFLINE_EXPIRY_MS = 72 * 60 * 60 * 1000; // Day 159: 72 hours

  // ── DAY 151: BUNDLE COMPILER ─────────────────
  function compileContainerBundle(config, players, teams, staff, sections) {
    const bundle = {
      schemaVersion: SCHEMA_VERSION,
      containerVersion: CONTAINER_VERSION,
      generatedAt: Date.now(),
      expiresAt: Date.now() + OFFLINE_EXPIRY_MS,
      tournament: JSON.parse(JSON.stringify(config || {})),
      roster: JSON.parse(JSON.stringify(players || [])),
      teamDirectory: JSON.parse(JSON.stringify(teams || [])),
      sections: JSON.parse(JSON.stringify(sections || [])),
      staffIndex: JSON.parse(JSON.stringify(staff || [])),
      status: 'compiled',
      checksum: null
    };
    console.log('[ContainerService] Bundle compiled:', { id: config?.id, players: bundle.roster.length });
    return bundle;
  }

  // ── DAY 152 + 158: PRE-FLIGHT VALIDATION ─────
  function runPreFlightValidation(bundle) {
    const errors = [], warnings = [];
    if (!bundle?.tournament) return { passed: false, errors: ['FATAL: Missing tournament object.'], warnings: [] };

    const { tournament, roster, staffIndex } = bundle;
    if (!tournament.id)     errors.push('TOURNAMENT_NO_ID: Missing tournament id.');
    if (!tournament.name)   errors.push('TOURNAMENT_NO_NAME: Missing tournament name.');
    if (!tournament.rounds || tournament.rounds < 1) errors.push('TOURNAMENT_NO_ROUNDS: Round count invalid.');
    if (!tournament.clubId) errors.push('TOURNAMENT_NO_CLUB: Missing clubId association.');

    (roster || []).forEach((p, i) => {
      const tag = `PLAYER[${i}](${p.name || p.id || '?'})`;
      if (!p.id)   errors.push(`${tag}: Missing player id — unmapped player.`);
      if (!p.name) errors.push(`${tag}: Missing player name.`);
      const raw = p.selectedRating ?? p.rating ?? p.ratings?.fide ?? p.ratings?.club ?? p.ratings?.national;
      if (raw === null || raw === undefined || raw === '') {
        errors.push(`${tag}: Empty rating — no Elo baseline. Coerce required before sealing.`);
      } else {
        const n = parseInt(raw, 10);
        if (isNaN(n) || n < 100 || n > 3500) errors.push(`${tag}: Invalid rating "${raw}". Must be 100–3500.`);
      }
      if (!p.fideId) warnings.push(`${tag}: No FIDE ID — will be treated as unrated.`);
    });

    if (!staffIndex?.length) errors.push('STAFF_EMPTY: No staff assigned. Chief Arbiter required.');
    else if (!staffIndex.find(s => /CHIEF|ARBITER/i.test(s.role || '')))
      errors.push('STAFF_NO_CHIEF_ARBITER: No Chief Arbiter in staff index.');

    const result = { passed: errors.length === 0, errors, warnings, validatedAt: Date.now() };
    if (!result.passed) console.error('[ContainerService] PRE-FLIGHT FAILED:', errors);
    else console.log('[ContainerService] Pre-flight PASSED.', { warnings: warnings.length });
    return result;
  }

  // ── DAY 154: SHA-256 CHECKSUM ─────────────────
  async function computeSHA256Checksum(bundle) {
    const copy = JSON.parse(JSON.stringify(bundle));
    delete copy.checksum;
    const encoded = new TextEncoder().encode(JSON.stringify(copy, Object.keys(copy).sort()));
    const buf = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── DAY 155: SUBSCRIPTION GATEWAY ────────────
  async function verifySubscriptionClaims(clubId) {
    try {
      if (typeof db === 'undefined') return { authorized: true, tier: 'offline_assumed', reason: 'OFFLINE_BYPASS' };
      const snap = await db.collection('clubs').doc(clubId).get();
      if (!snap.exists) return { authorized: false, tier: null, reason: 'CLUB_NOT_FOUND' };
      const data = snap.data();
      const tier = (data.subscriptionTier || data.plan || 'free').toLowerCase();
      if (!['premium','enterprise','pro','trial'].includes(tier))
        return { authorized: false, tier, reason: `INSUFFICIENT_TIER: "${tier}" lacks offline access.` };
      const exp = data.subscriptionExpiresAt?.seconds ? data.subscriptionExpiresAt.seconds * 1000 : data.subscriptionExpiresAt;
      if (exp && Date.now() > exp) return { authorized: false, tier, reason: 'SUBSCRIPTION_EXPIRED' };
      return { authorized: true, tier, reason: 'OK' };
    } catch (e) {
      console.warn('[ContainerService] Subscription check failed — offline bypass:', e.message);
      return { authorized: true, tier: 'offline_assumed', reason: 'OFFLINE_BYPASS' };
    }
  }

  // ── DAY 156: OFFLINE BRANCH FORKING ──────────
  async function forkOfflineBranch(tournamentId, containerId) {
    try {
      if (typeof db !== 'undefined' && tournamentId) {
        await db.collection('tournaments').doc(tournamentId).update({
          status: 'offline_branch',
          offlineBranchId: containerId,
          offlineBranchForkedAt: typeof firebase !== 'undefined'
            ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
        });
      }
    } catch (e) { console.warn('[ContainerService] Branch fork write failed (offline):', e.message); }
    if (window.ContainerRuntime) window.ContainerRuntime.setRuntimeMode(true, containerId);
    console.log(`[ContainerService] Offline branch forked: ${containerId}`);
    return containerId;
  }

  // ── AES-GCM ENCRYPTION ───────────────────────
  async function generateContainerKey() {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  async function encryptBundle(bundle, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(bundle));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    const keyJwk = await crypto.subtle.exportKey('jwk', key);
    return { iv: [...iv], data: [...new Uint8Array(encrypted)], keyJwk, encryptedAt: Date.now() };
  }

  async function decryptBundle(container) {
    const key = await crypto.subtle.importKey('jwk', container.keyJwk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(container.iv) }, key, new Uint8Array(container.data));
    return JSON.parse(new TextDecoder().decode(dec));
  }

  // ── MASTER PIPELINE ───────────────────────────
  async function packageOfflineTournament(config, players, teams, staff, sections) {
    console.log('[ContainerService] Starting Offline Packaging Pipeline...');
    const bundle = compileContainerBundle(config, players, teams, staff, sections);

    const validation = runPreFlightValidation(bundle);
    if (!validation.passed) return { success: false, stage: 'PRE_FLIGHT', errors: validation.errors, warnings: validation.warnings };

    const clubId = config?.clubId || window.TenantManager?.getActiveClubId?.();
    const sub = await verifySubscriptionClaims(clubId);
    if (!sub.authorized) return { success: false, stage: 'SUBSCRIPTION', errors: [`SUBSCRIPTION_DENIED: ${sub.reason}`], warnings: [] };

    bundle.checksum = await computeSHA256Checksum(bundle);
    const key = await generateContainerKey();
    const encrypted = await encryptBundle(bundle, key);
    const containerId = `tcc_${config.id}_${Date.now()}`;
    Object.assign(encrypted, { containerId, expiresAt: bundle.expiresAt, tournamentId: config.id, containerVersion: CONTAINER_VERSION });

    if (window.OfflineRuntime?.storeContainerBundle) await window.OfflineRuntime.storeContainerBundle(containerId, encrypted);
    await forkOfflineBranch(config.id, containerId);
    if (window.OperationalLedger) await window.OperationalLedger.appendLedgerBlock('CONTAINER_PACKAGED', { containerId, tournamentId: config.id, checksum: bundle.checksum.slice(0,16)+'...', expiresAt: bundle.expiresAt }).catch(() => {});

    console.log(`[ContainerService] ✅ Container packaged: ${containerId}`);
    return { success: true, containerId, expiresAt: bundle.expiresAt, checksum: bundle.checksum, playerCount: players?.length || 0, warnings: validation.warnings };
  }

  // ── DAY 159: EXPIRY ENFORCEMENT ───────────────
  function isContainerExpired(container) {
    if (!container?.expiresAt) return true;
    const expired = Date.now() > container.expiresAt;
    if (expired) console.warn('[ContainerService] Container EXPIRED at', new Date(container.expiresAt).toISOString());
    return expired;
  }

  // ── DAY 160: HEALTH DIAGNOSTICS ───────────────
  async function runHealthDiagnostics(containerId) {
    const checks = {};
    checks.webWorkers    = { label:'Web Workers',        status: typeof Worker !== 'undefined' ? 'OK' : 'FAIL',   detail: typeof Worker !== 'undefined' ? 'Available' : 'API missing' };
    checks.cryptoAPI     = { label:'WebCrypto AES-GCM',  status: (crypto?.subtle) ? 'OK' : 'FAIL',               detail: (crypto?.subtle) ? 'crypto.subtle OK' : 'Not available' };
    checks.indexedDB     = { label:'IndexedDB Storage',  status: typeof indexedDB !== 'undefined' ? 'OK' : 'FAIL', detail: typeof indexedDB !== 'undefined' ? 'Available' : 'Not supported' };
    checks.broadcastCh   = { label:'BroadcastChannel',   status: typeof BroadcastChannel !== 'undefined' ? 'OK' : 'WARN', detail: typeof BroadcastChannel !== 'undefined' ? 'Cross-tab sync OK' : 'Not supported' };
    checks.networkStatus = { label:'Network',            status: navigator.onLine ? 'WARN' : 'OK',               detail: navigator.onLine ? 'Online — offline branch active' : 'Fully offline' };

    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        const pct = est.quota ? Math.round((est.usage / est.quota) * 100) : 0;
        const usedMB = ((est.usage || 0) / 1048576).toFixed(1);
        const quotaMB = ((est.quota || 0) / 1048576).toFixed(0);
        checks.storageQuota = { label:'Storage Quota', status: pct < 85 ? 'OK' : pct < 95 ? 'WARN' : 'FAIL', detail: `${usedMB}MB / ${quotaMB}MB (${pct}%)` };
      } else { checks.storageQuota = { label:'Storage Quota', status:'WARN', detail:'Estimate API unavailable' }; }
    } catch { checks.storageQuota = { label:'Storage Quota', status:'WARN', detail:'Could not estimate' }; }

    if (containerId && window.OfflineRuntime?.getContainerBundle) {
      try {
        const stored = await window.OfflineRuntime.getContainerBundle(containerId);
        const expired = isContainerExpired(stored);
        checks.containerIntegrity = { label:'Container Integrity', status: stored && !expired ? 'OK' : 'FAIL',
          detail: !stored ? 'Not found' : expired ? `EXPIRED at ${new Date(stored.expiresAt).toISOString()}` : `Valid — expires ${new Date(stored.expiresAt).toLocaleString()}` };
      } catch (e) { checks.containerIntegrity = { label:'Container Integrity', status:'FAIL', detail: e.message }; }
    }

    const hasFails = Object.values(checks).some(c => c.status === 'FAIL');
    return { passed: !hasFails, checks, diagnosticsAt: Date.now() };
  }

  return { compileContainerBundle, runPreFlightValidation, computeSHA256Checksum, verifySubscriptionClaims, forkOfflineBranch, packageOfflineTournament, decryptBundle, isContainerExpired, runHealthDiagnostics, CONTAINER_VERSION, OFFLINE_EXPIRY_MS };
})();

window.TournamentContainerService = TournamentContainerService;
