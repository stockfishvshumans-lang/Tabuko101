/**
 * ContainerPackagingShield.js — Day 160: Health Dashboard UI Component
 * Renders the pre-flight diagnostic overlay for floor arbiters before
 * taking a tournament offline. Integrated into the Admin/Arbiter panel.
 * @version 1.0.0 — Day 160
 */
const ContainerPackagingShield = (() => {
  'use strict';

  // ── RENDER: HEALTH DIAGNOSTICS OVERLAY ─────────
  async function renderHealthDashboard(containerId, targetElId = 'container-shield-root') {
    const root = document.getElementById(targetElId);
    if (!root) return;

    root.innerHTML = `
      <div class="container-shield-panel" style="max-width:520px;margin:0 auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <div>
            <div style="font-weight:900;font-size:0.85rem;color:#f8fafc;letter-spacing:-0.3px;">⬛ Container Pre-Flight Diagnostics</div>
            <div style="font-size:0.6rem;color:#475569;margin-top:2px;font-family:'Inter',sans-serif;">Portable Tournament OS — Offline Readiness Check</div>
          </div>
          <div id="shield-overall-badge" style="font-size:0.6rem;font-weight:900;padding:4px 10px;border-radius:6px;background:rgba(245,158,11,0.1);color:#f59e0b;border:1px solid rgba(245,158,11,0.2);">RUNNING...</div>
        </div>
        <div id="shield-checks-list"><div style="text-align:center;padding:1rem;color:#475569;font-size:0.65rem;">Running diagnostics...</div></div>
        <div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid rgba(255,255,255,0.04);display:flex;justify-content:space-between;align-items:center;">
          <div id="shield-summary-text" style="font-size:0.6rem;color:#64748b;font-family:'Inter',sans-serif;"></div>
          <div style="display:flex;gap:6px;">
            <button id="shield-rerun-btn" onclick="ContainerPackagingShield.renderHealthDashboard('${containerId}','${targetElId}')" 
              style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);color:#3b82f6;padding:5px 14px;border-radius:6px;font-size:0.65rem;font-weight:800;cursor:pointer;letter-spacing:0.5px;min-height:36px;">↻ RERUN</button>
            <button id="shield-seal-btn" onclick="ContainerPackagingShield.initiatePackaging('${containerId}')"
              style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);color:#10b981;padding:5px 14px;border-radius:6px;font-size:0.65rem;font-weight:800;cursor:pointer;letter-spacing:0.5px;min-height:36px;" disabled>🔐 SEAL CONTAINER</button>
          </div>
        </div>
      </div>`;

    // Run diagnostics
    let result;
    try {
      result = await window.TournamentContainerService.runHealthDiagnostics(containerId);
    } catch (e) {
      root.innerHTML = `<div class="container-shield-panel" style="color:#ef4444;font-size:0.7rem;">Diagnostics failed: ${e.message}</div>`;
      return;
    }

    const checksList  = document.getElementById('shield-checks-list');
    const overallBadge = document.getElementById('shield-overall-badge');
    const summaryText  = document.getElementById('shield-summary-text');
    const sealBtn      = document.getElementById('shield-seal-btn');

    if (!checksList) return;

    const statusIcons = { OK: '✅', WARN: '⚠️', FAIL: '❌' };
    const statusCss   = { OK: 'ok', WARN: 'warn', FAIL: 'fail' };

    const rows = Object.values(result.checks).map(check => `
      <div class="check-row">
        <span class="check-icon">${statusIcons[check.status] || '❓'}</span>
        <span class="check-label">${check.label}</span>
        <span class="check-status ${statusCss[check.status] || ''}">${check.status}</span>
        <span class="check-detail" style="display:none;">${check.detail || ''}</span>
      </div>
    `).join('');

    checksList.innerHTML = rows;

    // Expandable detail on click
    checksList.querySelectorAll('.check-row').forEach(row => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        const d = row.querySelector('.check-detail');
        if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
      });
    });

    const failCount = Object.values(result.checks).filter(c => c.status === 'FAIL').length;
    const warnCount = Object.values(result.checks).filter(c => c.status === 'WARN').length;

    // Update overall badge
    if (failCount > 0) {
      overallBadge.textContent   = `${failCount} FAIL${failCount > 1 ? 'S' : ''}`;
      overallBadge.style.background    = 'rgba(239,68,68,0.1)';
      overallBadge.style.color         = '#ef4444';
      overallBadge.style.borderColor   = 'rgba(239,68,68,0.3)';
    } else if (warnCount > 0) {
      overallBadge.textContent   = `${warnCount} WARNING${warnCount > 1 ? 'S' : ''}`;
      overallBadge.style.background    = 'rgba(245,158,11,0.1)';
      overallBadge.style.color         = '#f59e0b';
      overallBadge.style.borderColor   = 'rgba(245,158,11,0.3)';
    } else {
      overallBadge.textContent   = '✓ ALL CLEAR';
      overallBadge.style.background    = 'rgba(16,185,129,0.1)';
      overallBadge.style.color         = '#10b981';
      overallBadge.style.borderColor   = 'rgba(16,185,129,0.3)';
    }

    summaryText.textContent = `${Object.keys(result.checks).length} checks complete · ${failCount} failures · ${warnCount} warnings`;

    // Enable Seal button only if no critical failures
    if (sealBtn) {
      sealBtn.disabled = failCount > 0;
      if (failCount === 0) {
        sealBtn.style.opacity = '1';
        sealBtn.style.cursor  = 'pointer';
        sealBtn.style.background = 'rgba(16,185,129,0.15)';
      } else {
        sealBtn.style.opacity = '0.4';
        sealBtn.style.cursor  = 'not-allowed';
      }
    }
  }

  // ── INITIATE FULL PACKAGING PIPELINE ───────────
  async function initiatePackaging(containerId) {
    const sealBtn = document.getElementById('shield-seal-btn');
    if (sealBtn) { sealBtn.textContent = '⏳ Packaging...'; sealBtn.disabled = true; }

    try {
      const tournament = window.activeTournament || {};
      const players    = window._cachedPlayers   || [];
      const teams      = window._cachedTeams     || [];
      const staff      = window._cachedStaff     || [];
      const sections   = window._cachedSections  || [];

      const result = await window.TournamentContainerService.packageOfflineTournament(
        tournament, players, teams, staff, sections
      );

      if (result.success) {
        if (window.UI?.showToast) window.UI.showToast(`✅ Container sealed: ${result.containerId.slice(0,20)}...`, 'success');
        if (sealBtn) { sealBtn.textContent = '✅ CONTAINER SEALED'; sealBtn.style.color = '#10b981'; }
      } else {
        const errMsg = (result.errors || []).join('; ');
        if (window.UI?.showToast) window.UI.showToast(`❌ Packaging failed: ${errMsg}`, 'error');
        if (sealBtn) { sealBtn.textContent = '🔐 SEAL CONTAINER'; sealBtn.disabled = false; }
      }
    } catch (err) {
      if (window.UI?.showToast) window.UI.showToast(`Packaging error: ${err.message}`, 'error');
      if (sealBtn) { sealBtn.textContent = '🔐 SEAL CONTAINER'; sealBtn.disabled = false; }
    }
  }

  // ── INJECT INTO EXISTING ADMIN PANEL ─────────────
  function mountShieldPanel(tournamentId, afterElementId) {
    const after = document.getElementById(afterElementId);
    if (!after) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'container-shield-root';
    wrapper.style.cssText = 'margin:1.5rem 0;';
    after.insertAdjacentElement('afterend', wrapper);
    renderHealthDashboard(tournamentId, 'container-shield-root');
  }

  return { renderHealthDashboard, initiatePackaging, mountShieldPanel };
})();

window.ContainerPackagingShield = ContainerPackagingShield;
