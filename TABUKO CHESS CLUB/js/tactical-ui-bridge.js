/**
 * tactical-ui-bridge.js
 * Visual identity and tactical component handlers for the War Room interface.
 */
window.TacticalUI = (() => {
  const FACTIONS = [
    { name: 'Vanguard', color: '#10b981', glow: 'rgba(16, 185, 129, 0.4)', icon: 'shield' },
    { name: 'Strikeforce', color: '#f59e0b', glow: 'rgba(245, 158, 11, 0.4)', icon: 'bolt' },
    { name: 'Phalanx', color: '#3b82f6', glow: 'rgba(59, 130, 246, 0.4)', icon: 'anchor' },
    { name: 'Wraith', color: '#a855f7', glow: 'rgba(168, 85, 247, 0.4)', icon: 'target' },
    { name: 'Titan', color: '#ef4444', glow: 'rgba(239, 68, 68, 0.4)', icon: 'castle' }
  ];

  function getFaction(name) {
    if (!name) return FACTIONS[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return FACTIONS[Math.abs(hash) % FACTIONS.length];
  }

  function getShieldSVG(faction) {
    const icons = {
      shield: '<path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/>',
      bolt: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
      anchor: '<path d="M12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2zm0 2a8 8 0 100 16 8 8 0 000-16zm-1 3h2v1h-2V7zm0 3h2v5h-2v-5zm0 7h2v1h-2v-1z"/>',
      target: '<path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/>',
      castle: '<path d="M2 7v10h3v-2h2v2h3V7H8V5H6v2H2zm18 0v10h-3v-2h-2v2h-3V7h2V5h2v2h4zM11 9h2v2h-2V9zm0 4h2v2h-2v-2z"/>'
    };
    const path = icons[faction.icon] || icons.shield;
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="${faction.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:100%; height:100%; filter: drop-shadow(0 0 8px ${faction.glow});">
        ${path}
      </svg>
    `;
  }

  function toggleMatchBoards(matchId) {
    const matrix = document.getElementById(`board-matrix-${matchId}`);
    const btn = document.querySelector(`[data-match-id="${matchId}"].boards-toggle-btn`);
    if (!matrix) return;
    
    const isExpanded = matrix.classList.contains('expanded');
    if (isExpanded) {
      matrix.classList.remove('expanded');
      if (btn) btn.innerHTML = btn.innerHTML.replace('HIDE', 'SHOW').replace('boards-active', '');
    } else {
      matrix.classList.add('expanded');
      if (btn) btn.innerHTML = btn.innerHTML.replace('SHOW', 'HIDE');
    }
  }

  return { getFaction, getShieldSVG, toggleMatchBoards };
})();
