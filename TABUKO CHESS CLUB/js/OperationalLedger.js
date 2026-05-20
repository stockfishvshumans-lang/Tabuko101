/**
 * OperationalLedger.js — Cryptographic Append-Only Secure Audit Ledger
 * Day 258 & 264 & 289: SHA-256 hash-chained immutable ledger for tamper detection.
 *
 * Architecture:
 *   Action payload → JSON.stringify + previousHash + timestamp
 *   → SHA-256 (WebCrypto API) → append block → verify chain integrity
 *
 * @version 1.0.0 — Day 258/264/289 Sprint
 */
const OperationalLedger = (() => {
  'use strict';

  const _ledgerChain = [];
  const _GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SHA-256 HASH GENERATOR (WebCrypto API)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function computeSHA256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LEDGER BLOCK GENERATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function appendLedgerBlock(action, payload, metadata = {}) {
    const previousHash = _ledgerChain.length > 0
      ? _ledgerChain[_ledgerChain.length - 1].hash
      : _GENESIS_HASH;

    const timestamp = Date.now();
    const rawPayload = JSON.parse(JSON.stringify(payload || {}));

    // Build canonical string for hash computation
    const canonicalString = JSON.stringify({
      action,
      payload: rawPayload,
      previousHash,
      timestamp,
      blockIndex: _ledgerChain.length
    });

    const hash = await computeSHA256(canonicalString);

    const block = {
      blockIndex: _ledgerChain.length,
      action,
      payload: rawPayload,
      metadata: {
        ...metadata,
        userId: metadata.userId || window.Auth?.getUser?.()?.uid || 'system',
        userEmail: metadata.userEmail || window.Auth?.getUser?.()?.email || 'system',
        clubId: window.TenantManager?.getActiveClubId?.() || 'local',
        clientTimestamp: new Date(timestamp).toISOString()
      },
      previousHash,
      hash,
      timestamp,
      verified: true
    };

    _ledgerChain.push(block);

    // Publish to event bus
    if (window.DistributedEventBus) {
      window.DistributedEventBus.publish('LEDGER_BLOCK_ADDED', {
        blockIndex: block.blockIndex,
        action,
        hash: hash.substring(0, 16) + '...',
        timestamp
      });
    }

    // Persist to Firestore if available
    try {
      if (typeof db !== 'undefined') {
        const clubId = block.metadata.clubId;
        if (clubId && clubId !== 'local') {
          await db.collection('clubs').doc(clubId).collection('app_operations_ledger').add({
            ...block,
            serverTimestamp: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      }
    } catch (err) {
      console.warn('[OperationalLedger] Firestore persistence queued (offline?):', err.message);
    }

    return block;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CHAIN INTEGRITY VERIFICATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function verifyChainIntegrity() {
    if (_ledgerChain.length === 0) return { valid: true, blocks: 0, errors: [] };

    const errors = [];

    for (let i = 0; i < _ledgerChain.length; i++) {
      const block = _ledgerChain[i];

      // 1. Verify previous hash linkage
      const expectedPrevHash = i === 0 ? _GENESIS_HASH : _ledgerChain[i - 1].hash;
      if (block.previousHash !== expectedPrevHash) {
        errors.push({
          blockIndex: i,
          type: 'CHAIN_BREAK',
          message: `Block ${i} previousHash mismatch. Expected: ${expectedPrevHash.substring(0, 16)}... Got: ${block.previousHash.substring(0, 16)}...`
        });
      }

      // 2. Recompute and verify block hash
      const canonicalString = JSON.stringify({
        action: block.action,
        payload: block.payload,
        previousHash: block.previousHash,
        timestamp: block.timestamp,
        blockIndex: block.blockIndex
      });

      const recomputedHash = await computeSHA256(canonicalString);
      if (recomputedHash !== block.hash) {
        errors.push({
          blockIndex: i,
          type: 'HASH_MISMATCH',
          message: `Block ${i} hash verification failed. Data may have been tampered.`
        });
        block.verified = false;
      } else {
        block.verified = true;
      }
    }

    return {
      valid: errors.length === 0,
      blocks: _ledgerChain.length,
      errors,
      lastVerified: Date.now()
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PRIORITY-BASED NOTIFICATION DISPATCH (Day 264)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const PRIORITY_LEVELS = {
    CRITICAL: { level: 0, color: '#ef4444', icon: '🚨' },
    HIGH: { level: 1, color: '#f59e0b', icon: '⚠️' },
    NORMAL: { level: 2, color: '#3b82f6', icon: 'ℹ️' },
    LOW: { level: 3, color: '#64748b', icon: '📝' }
  };

  async function logCriticalAction(action, payload) {
    return appendLedgerBlock(action, payload, { priority: 'CRITICAL' });
  }

  async function logStandardAction(action, payload) {
    return appendLedgerBlock(action, payload, { priority: 'NORMAL' });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SECURITY AUDIT EXPLORER UI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function renderSecurityExplorer(containerId = 'security-explorer-root') {
    const root = document.getElementById(containerId);
    if (!root) return;

    const integrity = await verifyChainIntegrity();
    const recentBlocks = _ledgerChain.slice(-15).reverse();

    root.innerHTML = `
      <div style="background:rgba(15,23,42,0.95);border:1px solid rgba(${integrity.valid ? '16,185,129' : '239,68,68'},0.15);border-radius:12px;padding:1rem;font-family:'JetBrains Mono',monospace;color:#e2e8f0;font-size:0.65rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <div style="font-weight:900;font-size:0.6rem;text-transform:uppercase;letter-spacing:2px;color:${integrity.valid ? '#10b981' : '#ef4444'};">
            🔐 Operational Ledger ${integrity.valid ? '— CHAIN VALID' : '— INTEGRITY BREACH'}
          </div>
          <div style="font-size:0.55rem;color:#475569;">${integrity.blocks} blocks</div>
        </div>

        ${integrity.errors.length > 0 ? `
        <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:6px;padding:0.5rem;margin-bottom:0.5rem;">
          ${integrity.errors.map(e => `
            <div style="font-size:0.55rem;color:#f87171;">Block #${e.blockIndex}: ${e.type} — ${e.message}</div>
          `).join('')}
        </div>` : ''}

        <div style="max-height:250px;overflow-y:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                <th style="text-align:left;padding:4px;font-size:0.5rem;color:#64748b;font-weight:800;">#</th>
                <th style="text-align:left;padding:4px;font-size:0.5rem;color:#64748b;font-weight:800;">ACTION</th>
                <th style="text-align:left;padding:4px;font-size:0.5rem;color:#64748b;font-weight:800;">TIME</th>
                <th style="text-align:left;padding:4px;font-size:0.5rem;color:#64748b;font-weight:800;">HASH</th>
                <th style="text-align:center;padding:4px;font-size:0.5rem;color:#64748b;font-weight:800;">✓</th>
              </tr>
            </thead>
            <tbody>
              ${recentBlocks.map(b => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                  <td style="padding:3px 4px;color:#475569;">${b.blockIndex}</td>
                  <td style="padding:3px 4px;color:#e2e8f0;font-weight:700;">${b.action}</td>
                  <td style="padding:3px 4px;color:#64748b;">${new Date(b.timestamp).toLocaleTimeString('en-GB')}</td>
                  <td style="padding:3px 4px;color:#3b82f6;font-size:0.5rem;">${b.hash.substring(0, 12)}...</td>
                  <td style="padding:3px 4px;text-align:center;">${b.verified ? '<span style="color:#10b981;">✓</span>' : '<span style="color:#ef4444;">✗</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LIVE OPERATIONS MONITOR FEED UI (Day 264/289)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function renderLiveOperationsStream(containerId = 'ops-stream-root') {
    const root = document.getElementById(containerId);
    if (!root) return;

    const recentOps = _ledgerChain.slice(-20).reverse();

    root.innerHTML = `
      <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:0.75rem;font-family:'JetBrains Mono',monospace;font-size:0.6rem;max-height:300px;overflow-y:auto;">
        <div style="font-weight:900;font-size:0.55rem;text-transform:uppercase;letter-spacing:1.5px;color:#64748b;margin-bottom:0.5rem;">📋 Live Operations Stream</div>
        ${recentOps.length === 0 ? '<div style="color:#334155;text-align:center;padding:1rem;">No operations recorded</div>' : ''}
        ${recentOps.map(op => `
          <div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.02);align-items:flex-start;">
            <span style="color:#334155;min-width:60px;font-size:0.5rem;">${new Date(op.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span style="color:#a855f7;font-weight:800;min-width:150px;">${op.action}</span>
            <span style="color:#475569;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${op.metadata?.userEmail || 'system'}</span>
            <span style="color:${op.verified ? '#10b981' : '#ef4444'};font-weight:900;">${op.verified ? '✓' : '✗'}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLIC API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    appendLedgerBlock,
    verifyChainIntegrity,
    logCriticalAction,
    logStandardAction,
    renderSecurityExplorer,
    renderLiveOperationsStream,
    getChain: () => [..._ledgerChain],
    getChainLength: () => _ledgerChain.length,
    getLatestBlock: () => _ledgerChain.length > 0 ? { ..._ledgerChain[_ledgerChain.length - 1] } : null,
    PRIORITY_LEVELS
  };
})();

window.OperationalLedger = OperationalLedger;
