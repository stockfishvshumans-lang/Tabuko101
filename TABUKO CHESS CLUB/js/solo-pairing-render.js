/**
 * Solo Pairing Tactical Renderer — Slate-Carbon Flat Table Layout
 * Replaces card-grid with high-density spreadsheet rows matching reference mockup.
 * All event handlers and state logic preserved from original.
 */
window._tacticalRenderPairings = async function(el, tournament, targetRound, deps) {
  // Print styles (preserved)
  if (!document.getElementById('dynamic-print-rules')) {
    const styleSheet = document.createElement("style");
    styleSheet.id = 'dynamic-print-rules';
    styleSheet.innerHTML = `
      @media print {
        body, #app, .sc-pairing-viewport, .sc-table-scroll, table {
          width: 100% !important; max-width: 100% !important;
          margin: 0 !important; padding: 0 !important;
          background: white !important; color: black !important;
        }
        .no-print, .sc-header-bar, .sc-legend-bar, .btn-matrix-action,
        .sc-more-dots, .sc-cmd-btn, .sc-filter-btn { display: none !important; }
        .match-row-flat {
          display: grid !important; break-inside: avoid;
          border-bottom: 1px solid #000 !important;
          background: white !important; color: black !important;
        }
        h1, h2, h3 { color: black !important; text-shadow: none !important; }
      }
    `;
    document.head.appendChild(styleSheet);
  }

  window._deps = deps;
  const { DB, Auth, Tournament, renderRoundSelector, showLoading, hideLoading, showToast, renderTournamentHeaderActions, renderTournamentTab, playerMap, isLocked } = deps;
  const rd = targetRound || tournament.currentRound || 0;
  if (rd === 0) {
    el.innerHTML = `<div style="padding:4rem;text-align:center;border:2px dashed #334155;border-radius:12px;background:rgba(0,0,0,0.1);">
      <div style="font-size:3rem;margin-bottom:1rem;opacity:0.5">📋</div>
      <p style="color:#64748b;margin-bottom:2rem">Tournament hasn't started. Register participants then start Round 1.</p>
    </div>`;
    return;
  }

  const roundData = await DB.getRound(tournament.id, rd);
  if (!roundData) { el.innerHTML = '<p style="color:#64748b">Round data not found.</p>'; return; }
  if (tournament.isTeamEvent) return UI.renderTeamPairings(el, tournament, rd, roundData, playerMap);

  const isAdmin = Auth.isAdmin() || Auth.isArbiter();
  const isPastRound = rd < tournament.currentRound;
  const pairings = roundData.pairings || [];
  const totalBoards = pairings.length;
  const completedBoards = pairings.filter(p => p.result).length;
  const pendingBoards = totalBoards - completedBoards;

  // Round start tracker (preserved)
  if (!window._roundStartTimeMap) window._roundStartTimeMap = {};
  if (!window._roundStartTimeMap[tournament.id + '_' + rd]) {
    window._roundStartTimeMap[tournament.id + '_' + rd] = roundData.startedAt || Date.now();
  }

  // Avatar helpers (preserved)
  const avatarColor = (name) => {
    const colors = ['#3b82f6','#8b5cf6','#ec4899','#f97316','#14b8a6','#eab308','#06b6d4','#ef4444','#22c55e','#a855f7'];
    let h = 0; for(let i=0;i<(name||'').length;i++) h = ((h<<5)-h)+(name||'X').charCodeAt(i);
    return colors[Math.abs(h) % colors.length];
  };
  const initials = (name) => (name||'?').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();

  // Build round selector options
  const roundOpts = Array.from({length: tournament.currentRound}, (_, i) => i + 1)
    .map(r => `<option value="${r}" ${r === rd ? 'selected' : ''}>Round ${r}</option>`).join('');

  // Header bar
  const headerBar = `<div class="sc-header-bar no-print">
    <div class="sc-header-left">
      <select class="sc-round-select history-round-selector">${roundOpts}</select>
      ${!isPastRound && !isLocked ? '<span class="sc-live-dot">LIVE</span>' : '<span style="font-size:0.6rem;color:#475569;font-weight:800">HISTORY</span>'}
      <span class="sc-player-count">${totalBoards * 2} Players</span>
      <span class="sc-system-badge">Swiss System</span>
    </div>
    <div class="sc-header-right">
      <input type="text" class="sc-search-input" id="tac-search" placeholder="Search player...">
      <button class="sc-filter-btn">Filters</button>
      ${!isPastRound && isAdmin && !isLocked ? `
        <button class="sc-cmd-btn" onclick="UI.renderLateEntryModal('${tournament.id}',${rd})">+ LATE</button>
        <button class="sc-cmd-btn" onclick="UI.addTournamentRoundPrompt('${tournament.id}')">+ ROUND</button>
      ` : ''}
      <button id="cmd-saver-print" class="sc-cmd-btn" title="Paper-Saver Print">🖨️</button>
      <button class="sc-cmd-btn" onclick="UI.printPairings()">🖨️ Std</button>
      ${!isPastRound && isAdmin && !isLocked ? (
        pairings.every(p => !p.result)
          ? `<button class="sc-cmd-btn danger" id="btn-repair-round">⚠ REPAIR</button>`
          : (rd > 1 ? `<button class="sc-cmd-btn danger" id="btn-rollback-round">⏪ ROLLBACK</button>` : '')
      ) : (isAdmin && isPastRound && !isLocked ? `<button class="sc-cmd-btn warn" id="btn-unlock-round">🔓 UNLOCK</button>` : '')}
    </div>
  </div>`;

  // Table header
  const tableHeader = `<div class="sc-table-header">
    <div class="sc-th-center">Board</div>
    <div>White</div>
    <div class="sc-th-center">Rtg</div>
    <div class="sc-th-center">Pts</div>
    <div class="sc-th-center">Action</div>
    <div class="sc-th-right">Black</div>
    <div class="sc-th-center">Rtg</div>
    <div class="sc-th-center">Pts</div>
    <div class="sc-th-center">Status</div>
    <div class="sc-th-center"></div>
  </div>`;

  // Build rows
  const rows = pairings.map((p, idx) => {
    const cachedW = window.IdentityResolution?._resolvedIdentityCacheMap?.[p.whiteId];
    const cachedB = window.IdentityResolution?._resolvedIdentityCacheMap?.[p.blackId];
    const wMap = playerMap[p.whiteId] || {};
    const bMap = playerMap[p.blackId] || {};
    const wName = cachedW?.name || wMap.name || p.whiteName || 'Vacant';
    const bName = cachedB?.name || bMap.name || p.blackName || 'Vacant';
    const wRating = cachedW?.rating || p.whiteRating || wMap.rating || 0;
    const bRating = cachedB?.rating || p.blackRating || bMap.rating || 0;
    const liveW = window.liveStandingsMap?.[p.whiteId]?.score ?? p.whiteScore ?? 0;
    const liveB = window.liveStandingsMap?.[p.blackId]?.score ?? p.blackScore ?? 0;
    const hasResult = !!p.result;

    // Status
    let statusCls = 'pending', statusTxt = 'PENDING';
    if (hasResult) {
      if (p.result.isForfeit) { statusCls = 'forfeit'; statusTxt = 'FORFEIT'; }
      else if (p.result.whiteScore === 0.5) { statusCls = 'draw'; statusTxt = 'DRAW'; }
      else { statusCls = 'locked'; statusTxt = 'LOCKED'; }
    }

    // Action button content
    let actionContent;
    if (hasResult) {
      const displayVal = `${p.result.whiteScore} - ${p.result.blackScore}`;
      actionContent = `<button class="btn-matrix-action has-result" data-board="${p.board}">${displayVal}</button>`;
    } else if (isPastRound || isLocked) {
      actionContent = `<span style="color:#334155;font-weight:800">—</span>`;
    } else {
      actionContent = `<button class="btn-matrix-action" data-board="${p.board}" onclick="window._scOpenResultModal('${tournament.id}',${rd},${p.board},${idx})">ENTER RESULT</button>`;
    }

    // FIDE title tags
    const wTitle = wMap.fideTitle ? `<span class="sc-title-tag">${wMap.fideTitle}</span>` : '';
    const bTitle = bMap.fideTitle ? `<span class="sc-title-tag">${bMap.fideTitle}</span>` : '';

    return `<div class="match-row-flat" data-board="${p.board}" data-idx="${idx}" data-white="${wName.toLowerCase()}" data-black="${bName.toLowerCase()}">
      <div class="sc-board-num">${p.board}</div>
      <div class="sc-player-block">
        <div class="sc-avatar-pill" style="background:${avatarColor(wName)}">${initials(wName)}</div>
        <span class="sc-player-name clickable-name" onclick="PlayerIntel.showCard('${p.whiteId}','${tournament.id}')">${wName}</span>
        ${wTitle}
      </div>
      <div class="sc-rating">${wRating}</div>
      <div class="sc-points">${parseFloat(liveW).toFixed(1)}</div>
      <div style="padding:0 8px">${actionContent}</div>
      <div class="sc-player-block right-align">
        ${bTitle}
        <span class="sc-player-name clickable-name" onclick="PlayerIntel.showCard('${p.blackId}','${tournament.id}')">${bName}</span>
        <div class="sc-avatar-pill" style="background:${avatarColor(bName)}">${initials(bName)}</div>
      </div>
      <div class="sc-rating">${bRating}</div>
      <div class="sc-points">${parseFloat(liveB).toFixed(1)}</div>
      <div><span class="sc-status-chip ${statusCls}">${statusTxt}</span></div>
      <div class="sc-more-dots"><span></span><span></span><span></span></div>
    </div>`;
  }).join('');

  // Legend
  const legend = `<div class="sc-legend-bar no-print">
    <div class="sc-legend-item"><div class="sc-legend-dot" style="background:var(--status-pending)"></div>PENDING — Result not yet encoded</div>
    <div class="sc-legend-item"><div class="sc-legend-dot" style="background:var(--status-locked)"></div>LOCKED — Result saved & locked</div>
    <div class="sc-legend-item"><div class="sc-legend-dot" style="background:var(--status-conflict)"></div>CONFLICT — Data conflict / review</div>
    <div class="sc-legend-item"><div class="sc-legend-dot" style="background:var(--status-forfeit)"></div>FORFEIT — Forfeit selected</div>
  </div>`;

  el.innerHTML = `<div class="sc-pairing-viewport">
    ${headerBar}
    ${tableHeader}
    <div class="sc-table-scroll">${rows}</div>
    ${legend}
  </div>`;

  // === OVERDUE TIMER (preserved) ===
  if (window._overdueTimer) clearInterval(window._overdueTimer);
  const startTimerLoop = () => {
    const roundStart = window._roundStartTimeMap[tournament.id + '_' + rd];
    if (!roundStart) return;
    window._overdueTimer = setInterval(() => {
      const elapsedMs = Date.now() - roundStart;
      const limitMinutes = tournament.roundTimeLimit || 45;
      const isOverdue = elapsedMs > (limitMinutes * 60000);
      el.querySelectorAll('.match-row-flat').forEach(row => {
        const chip = row.querySelector('.sc-status-chip.pending');
        if (!chip) return;
        let badge = row.querySelector('.overdue-badge');
        if (isOverdue) {
          if (!badge) {
            badge = document.createElement('div');
            badge.className = 'overdue-badge';
            badge.style.cssText = 'position:absolute;top:2px;right:4px;background:var(--status-conflict);color:white;padding:1px 6px;border-radius:3px;font-size:0.5rem;font-weight:800;font-family:var(--sc-font-mono);z-index:5;';
            badge.textContent = 'OVERDUE';
            row.style.position = 'relative';
            row.appendChild(badge);
          }
        } else {
          if (badge) badge.remove();
        }
      });
    }, 5000);
  };
  startTimerLoop();

  // === EVENT BINDINGS (all preserved) ===

  // Search filter
  const searchInput = el.querySelector('#tac-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      el.querySelectorAll('.match-row-flat').forEach(row => {
        const w = row.dataset.white || '';
        const b = row.dataset.black || '';
        row.style.display = (w.includes(q) || b.includes(q) || row.dataset.board.includes(q)) ? '' : 'none';
      });
    });
  }

  // Round selector
  el.querySelector('.history-round-selector')?.addEventListener('change', (e) => {
    window._tacticalRenderPairings(el, tournament, parseInt(e.target.value), deps);
  });

  // Paper-Saver Print
  const printBtn = el.querySelector('#cmd-saver-print');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      const targetContainer = el.closest('.main-viewport') || el;
      targetContainer.classList.add('print-matrix-dense');
      window.print();
      setTimeout(() => targetContainer.classList.remove('print-matrix-dense'), 500);
    });
  }

  // Repair / Rollback / Unlock (all preserved)
  document.getElementById('btn-repair-round')?.addEventListener('click', async () => {
    if (confirm(`Delete Round ${rd} pairings to regenerate? No results recorded yet.`)) {
      try {
        showLoading();
        if (window.TournamentManager) window.TournamentManager.applyUiInteractiveShield(true);
        await Tournament.deleteAndRepairCurrentRound(tournament.id);
        showToast(`Round ${rd} pairings deleted. Re-pair or edit roster.`, 'info');
        const f = await DB.getTournament(tournament.id);
        UI.renderTournamentView(f);
      } catch (err) { showToast(err.message, 'error'); }
      finally {
        if (window.TournamentManager) window.TournamentManager.applyUiInteractiveShield(false);
        hideLoading();
      }
    }
  });

  el.querySelector('#btn-rollback-round')?.addEventListener('click', async () => {
    if (confirm(`Delete all Round ${rd} data and revert to Round ${rd-1}?`)) {
      try {
        showLoading();
        if (window.TournamentManager) window.TournamentManager.applyUiInteractiveShield(true);
        await Tournament.deleteCurrentRound(tournament.id);
        await Tournament.recalculateStandings(tournament.id);
        showToast(`Reverted to Round ${rd-1}.`, 'info');
        const f = await DB.getTournament(tournament.id);
        UI.renderTournamentView(f);
      } catch (err) { showToast(err.message, 'error'); }
      finally {
        if (window.TournamentManager) window.TournamentManager.applyUiInteractiveShield(false);
        hideLoading();
      }
    }
  });

  el.querySelector('#btn-unlock-round')?.addEventListener('click', async () => {
    if (confirm(`Unlock Round ${rd} for corrections?`)) {
      try {
        showLoading();
        if (window.TournamentManager) window.TournamentManager.applyUiInteractiveShield(true);
        await Tournament.unlockRound(tournament.id, rd);
        showToast(`Round ${rd} Unlocked`, 'success');
        window._tacticalRenderPairings(el, tournament, rd, deps);
      } catch (err) { showToast(err.message, 'error'); }
      finally {
        if (window.TournamentManager) window.TournamentManager.applyUiInteractiveShield(false);
        hideLoading();
      }
    }
  });

  // Keyboard navigation (preserved)
  let focusedIdx = -1;
  const rows_els = () => el.querySelectorAll('.match-row-flat:not([style*="display: none"])');
  el.addEventListener('keydown', (e) => {
    const visible = Array.from(rows_els());
    if (!visible.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); focusedIdx = Math.min(focusedIdx+1, visible.length-1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusedIdx = Math.max(focusedIdx-1, 0); }
    else return;
    el.querySelectorAll('.match-row-flat').forEach(r => r.style.outline = '');
    if (focusedIdx >= 0 && visible[focusedIdx]) {
      visible[focusedIdx].style.outline = '1px solid var(--accent-blue)';
      visible[focusedIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
  el.setAttribute('tabindex', '0');

  // Lock mode
  if (isLocked) {
    setTimeout(() => {
      document.getElementById('btn-repair-round')?.remove();
      document.getElementById('btn-rollback-round')?.remove();
      el.querySelectorAll('.btn-matrix-action:not(.has-result)').forEach(b => {
        b.disabled = true; b.style.opacity = '0.3'; b.style.cursor = 'default';
      });
    }, 0);
  }
};

/**
 * Result Entry Modal (MODULE 3) — Compact Slate-Carbon Panel
 * Keyboard shortcuts: 1=White Win, 2=Draw, 3=Black Win, f=Forfeit, Enter=Confirm
 */
window._scOpenResultModal = async function(tournamentId, round, board, idx) {
  const { DB, Tournament, renderTournamentHeaderActions } = window._deps || {};
  const t = window.activeTournament || await DB.getTournament(tournamentId);
  const rData = await DB.getRound(tournamentId, round);
  const pairing = (rData.pairings || [])[idx];
  if (!pairing) return UI.showToast('Pairing not found', 'error');

  const pMap = window._deps?.playerMap || {};
  const cachedW = window.IdentityResolution?._resolvedIdentityCacheMap?.[pairing.whiteId];
  const cachedB = window.IdentityResolution?._resolvedIdentityCacheMap?.[pairing.blackId];
  const wMap = pMap[pairing.whiteId] || {};
  const bMap = pMap[pairing.blackId] || {};
  const wName = cachedW?.name || wMap.name || pairing.whiteName || 'Vacant';
  const bName = cachedB?.name || bMap.name || pairing.blackName || 'Vacant';
  const wRating = cachedW?.rating || pairing.whiteRating || wMap.rating || 0;
  const bRating = cachedB?.rating || pairing.blackRating || bMap.rating || 0;
  const wTitle = wMap.fideTitle || '';
  const bTitle = bMap.fideTitle || '';

  // Remove existing modal
  document.getElementById('sc-result-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'sc-result-modal-overlay';
  overlay.className = 'sc-modal-overlay';

  overlay.innerHTML = `<div class="modal-core-frame" id="sc-modal-frame">
    <div class="sc-modal-board-label">BOARD ${board}</div>
    <div class="sc-modal-players">
      <div class="sc-modal-player">
        <div class="sc-modal-player-name">${wTitle ? wTitle + ' ' : ''}${wName}</div>
        <div class="sc-modal-player-meta">[${wRating}]</div>
      </div>
      <div class="sc-modal-vs">vs</div>
      <div class="sc-modal-player right">
        <div class="sc-modal-player-name">${bTitle ? bTitle + ' ' : ''}${bName}</div>
        <div class="sc-modal-player-meta">[${bRating}]</div>
      </div>
    </div>
    <div class="sc-modal-round-sub">Round ${round} • Swiss System</div>

    <div style="font-size:0.65rem;font-weight:700;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Select Result</div>
    <div class="modal-input-grid">
      <button class="btn-score-pad white-win" data-result="1-0">
        <span class="sc-score-big">1 - 0</span>
        <span class="sc-score-label">White Wins</span>
      </button>
      <button class="btn-score-pad black-win" data-result="0-1">
        <span class="sc-score-big">0 - 1</span>
        <span class="sc-score-label">Black Wins</span>
      </button>
      <button class="btn-score-pad draw-btn btn-score-full" data-result="0.5-0.5">
        <span class="sc-score-big">½ - ½</span>
        <span class="sc-score-label">Draw</span>
      </button>
      <button class="btn-score-pad forfeit-btn-pad btn-score-full" data-result="forfeit">
        <span class="sc-score-big">FORFEIT</span>
        <span class="sc-score-label">Set Forfeit</span>
      </button>
    </div>

    <div id="sc-forfeit-sub" style="display:none;margin-bottom:12px">
      <div style="display:flex;gap:8px">
        <button class="btn-score-pad" data-ff="1-0F" style="flex:1"><span class="sc-score-big">1-0</span><span class="sc-score-label">White FF Win</span></button>
        <button class="btn-score-pad" data-ff="0-1F" style="flex:1"><span class="sc-score-big">0-1</span><span class="sc-score-label">Black FF Win</span></button>
        <button class="btn-score-pad" data-ff="0-0F" style="flex:1"><span class="sc-score-big">0-0</span><span class="sc-score-label">Double FF</span></button>
      </div>
    </div>

    <div class="sc-notes-label">Arbiter Notes (optional)</div>
    <textarea class="sc-notes-input" id="sc-arbiter-notes" placeholder="Optional notes..."></textarea>

    <div class="sc-modal-actions">
      <button class="sc-btn-cancel" id="sc-modal-cancel">CANCEL</button>
      <button class="sc-btn-confirm" id="sc-modal-confirm" disabled>CONFIRM RESULT</button>
    </div>
  </div>`;

  document.getElementById('modal-container').appendChild(overlay);

  // State
  let selectedResult = null;
  let isForfeit = false;
  const confirmBtn = overlay.querySelector('#sc-modal-confirm');
  const allPads = overlay.querySelectorAll('.btn-score-pad[data-result]');
  const forfeitSub = overlay.querySelector('#sc-forfeit-sub');

  function selectResult(val) {
    allPads.forEach(b => b.classList.remove('selected'));
    forfeitSub.style.display = 'none';
    if (val === 'forfeit') {
      forfeitSub.style.display = 'block';
      selectedResult = null;
      isForfeit = false;
      confirmBtn.disabled = true;
      overlay.querySelector(`[data-result="forfeit"]`).classList.add('selected');
      return;
    }
    isForfeit = false;
    selectedResult = val;
    overlay.querySelector(`[data-result="${val}"]`)?.classList.add('selected');
    confirmBtn.disabled = false;
  }

  // Pad clicks
  allPads.forEach(btn => {
    btn.addEventListener('click', () => selectResult(btn.dataset.result));
  });

  // Forfeit sub-buttons
  overlay.querySelectorAll('[data-ff]').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('[data-ff]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedResult = btn.dataset.ff;
      isForfeit = true;
      confirmBtn.disabled = false;
    });
  });

  // Close handlers
  const closeModal = () => overlay.remove();
  overlay.querySelector('#sc-modal-cancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  // Confirm
  confirmBtn.addEventListener('click', async () => {
    if (!selectedResult) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'SAVING...';
    try {
      const clean = selectedResult.replace('F', '');
      const [wS, bS] = clean.split('-').map(parseFloat);
      await Tournament.submitResultAndUpdate(tournamentId, round, board, wS, bS, isForfeit);
      closeModal();
      const fresh = await DB.getTournament(tournamentId);
      window.activeTournament = fresh;
      renderTournamentHeaderActions(fresh);
      // Re-render the table
      const container = document.querySelector('.sc-pairing-viewport')?.parentElement || el;
      window._tacticalRenderPairings(container, fresh, round, window._deps);
    } catch (err) {
      UI.showToast('Sync Error — ' + err.message, 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'CONFIRM RESULT';
    }
  });

  // MODULE 4: Keyboard shortcuts
  function keyHandler(e) {
    if (!document.getElementById('sc-result-modal-overlay')) {
      document.removeEventListener('keydown', keyHandler);
      return;
    }
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key === '1') { selectResult('1-0'); return; }
    if (e.key === '2') { selectResult('0.5-0.5'); return; }
    if (e.key === '3') { selectResult('0-1'); return; }
    if (e.key === 'f' || e.key === 'F') { selectResult('forfeit'); return; }
    if (e.key === 'Enter' && selectedResult && !confirmBtn.disabled) {
      e.preventDefault();
      confirmBtn.click();
    }
  }
  document.addEventListener('keydown', keyHandler);
};
