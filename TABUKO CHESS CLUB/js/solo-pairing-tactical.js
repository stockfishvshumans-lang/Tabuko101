/**
 * Solo Pairing Tactical UI — Slate-Carbon Style Injector
 * Injects supplemental runtime styles for the flat table pairing interface.
 * Primary styles live in css/slate-carbon.css — this handles dynamic/animation states.
 */
(function injectTacticalSoloPairingStyles() {
  if (document.getElementById('tactical-solo-css')) return;
  const s = document.createElement('style');
  s.id = 'tactical-solo-css';
  s.textContent = `

/* ═══ TACTICAL ROW STATES ═══ */
.match-row-flat.saving { opacity: 0.6; pointer-events: none; }
.match-row-flat.saved { animation: sc-row-saved 0.6s ease; }
@keyframes sc-row-saved {
  0% { background: rgba(34,197,94,0.12); }
  100% { background: var(--bg-panel); }
}

/* Row active focus highlight */
.match-row-flat:focus-within,
.match-row-flat.focused {
  outline: 1px solid rgba(59,130,246,0.3);
  outline-offset: -1px;
  background: rgba(59,130,246,0.04);
}

/* Overdue pulse on pending rows */
.overdue-badge {
  animation: sc-overdue-pulse 2s infinite;
}
@keyframes sc-overdue-pulse {
  0%,100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* ═══ FORFEIT MENU (preserved dropdown) ═══ */
.tac-forfeit-menu {
  position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  background: var(--bg-surface); border: 1px solid var(--border-subtle);
  border-radius: 4px; padding: 4px; display: none; z-index: 100;
  box-shadow: 0 8px 24px rgba(0,0,0,0.6); min-width: 90px;
}
.tac-forfeit-menu.open { display: flex; flex-direction: column; gap: 2px; }
.tac-ff-btn {
  background: none; border: none; color: var(--text-secondary); font-size: 0.6rem;
  font-weight: 800; padding: 4px 8px; cursor: pointer; border-radius: 3px;
  text-align: left; white-space: nowrap; font-family: var(--sc-font-ui);
}
.tac-ff-btn:hover { background: rgba(59,130,246,0.08); color: #fff; }

/* ═══ STATUS ORB (preserved for compatibility) ═══ */
.tac-status-orb {
  width: 7px; height: 7px; border-radius: 50%;
  background: #475569; transition: 0.3s; margin: 0 auto;
}
.tac-status-orb.synced { background: var(--status-locked); }
.tac-status-orb.pending { background: var(--status-pending); animation: sc-orb-blink 1.5s infinite; }
.tac-status-orb.saving { background: var(--accent-blue); animation: sc-orb-blink 0.8s infinite; }
.tac-status-orb.conflict { background: var(--status-conflict); animation: sc-orb-blink 0.6s infinite; }
.tac-status-orb.locked { background: #334155; }
@keyframes sc-orb-blink {
  0%,100% { opacity: 1; } 50% { opacity: 0.3; }
}

/* ═══ BOARD MATCH CARD (backward compat for any remaining card refs) ═══ */
.board-match-card {
  background: var(--bg-panel); border: 1px solid var(--border-subtle);
  border-radius: 4px; padding: 1rem; position: relative;
  transition: all 0.15s ease;
}
.board-match-card.border-locked-emerald { border-color: rgba(34,197,94,0.3); }
.board-match-card.border-draft-amber { border-color: rgba(245,158,11,0.2); }
.tac-row-sync-glow { animation: sc-row-saved 0.6s ease; }

/* Touch score grid (backward compat) */
.touch-score-grid {
  display: flex; gap: 6px; flex-wrap: wrap; justify-content: center;
}
.touch-score-btn {
  min-width: 46px; min-height: 46px; padding: 8px 12px;
  background: var(--bg-surface); border: 1px solid var(--border-subtle);
  color: var(--text-secondary); font-weight: 800; font-size: 0.75rem;
  border-radius: 4px; cursor: pointer; font-family: var(--sc-font-mono);
  transition: all 0.15s ease;
}
.touch-score-btn:hover { border-color: var(--accent-blue); color: #fff; }
.touch-forfeit-btn {
  background: none; border: 1px solid rgba(168,85,247,0.2);
  color: var(--status-forfeit); font-size: 0.65rem; font-weight: 800;
  padding: 4px 10px; border-radius: 4px; cursor: pointer;
}

/* ═══ RESPONSIVE ═══ */
@media (max-width: 768px) {
  .match-row-flat {
    grid-template-columns: 40px 1fr 1fr 40px;
    min-height: auto; padding: 8px; gap: 4px;
  }
}

/* ═══ PRINT ═══ */
@media print {
  .tac-forfeit-menu, .touch-score-grid, .touch-forfeit-btn,
  .tac-edit-btn, .sc-more-dots { display: none !important; }
  .match-row-flat { break-inside: avoid; }
}
`;
  document.head.appendChild(s);
})();
