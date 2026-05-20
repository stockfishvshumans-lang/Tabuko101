/**
 * tv.js — Enterprise TV Broadcast Module
 * Features: Smart Grids, Living Leaderboards, and Team/Individual Dual-Mode
 * Day 262: Hardware-accelerated translate3d leaderboard shifting (no layout reflow).
 * Day 263: Viewport size cached once at startup — no DOM queries during live rounds.
 * Day 280: GPU compositing hints on all animated rows.
 */
const TV = (() => {
  let tournamentId = null;
  let standingsInitialized = false;
  let pendingApprovals = {};

  // Day 263: Cache viewport dimensions globally at startup — prevents slow DOM queries mid-round
  const _vp = {
    w: window.innerWidth,
    h: window.innerHeight,
    rowH: 70,  // default row height (recalculated once on render)
    rowGap: 10
  };
  window.addEventListener('resize', () => {
    _vp.w = window.innerWidth;
    _vp.h = window.innerHeight;
  }, { passive: true });

  // ── 1. INJECT BROADCAST STYLES (No CSS file needed) ──
  function injectTVStyles() {
    if (document.getElementById('tabuko-tv-styles')) return;
    const style = document.createElement('style');
    style.id = 'tabuko-tv-styles';
    style.innerHTML = `
      /* Smart Grid Pairings */
      .tv-pairing-row {
        display: flex;
        align-items: center;
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid var(--border-color, #334155);
        border-radius: 8px;
        padding: 0 15px;
        color: #fff;
        font-weight: 700;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
      }
      .tv-pairing-row .board { min-width: 40px; color: var(--accent-primary, #a855f7); font-weight: 900; }
      .tv-pairing-row .player { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tv-pairing-row .white-player { text-align: right; padding-right: 15px; }
      .tv-pairing-row .black-player { text-align: left; padding-left: 15px; }
      .tv-pairing-row .score { 
        min-width: 80px; 
        text-align: center; 
        background: rgba(0,0,0,0.4); 
        padding: 5px 10px; 
        border-radius: 4px;
        color: var(--accent-success, #22c55e);
      }
      .tv-rtg { color: #64748b; font-size: 0.7em; margin: 0 5px; }
      
      /* Living Leaderboard — Day 262: GPU-only positioning, no layout paint reflow */
      #standings-body { position: relative; height: 420px; width: 100%; overflow: hidden; }
      .living-row {
        position: absolute;
        width: 100%;
        height: 70px;
        display: flex;
        align-items: center;
        background: linear-gradient(90deg, rgba(30,41,59,0.9) 0%, rgba(15,23,42,0.9) 100%);
        border-left: 4px solid var(--accent-primary, #a855f7);
        border-radius: 6px;
        padding: 0 20px;
        box-sizing: border-box;
        /* Day 262: translate3d ONLY — compositor thread, zero layout paint */
        transform: translate3d(0, 0, 0);
        transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
        /* Day 280: GPU compositing hints */
        will-change: transform;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        color: white;
        font-size: 1.5rem;
        font-weight: 800;
      }
      .living-row .rank { width: 50px; color: var(--accent-primary, #a855f7); }
      .living-row .name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .living-row .pts { width: 80px; text-align: right; color: var(--accent-success, #22c55e); font-size: 1.8rem; }
      
      /* Staggered Entrance Animation */
      @keyframes slideInRight {
        from { opacity: 0; transform: translateX(100px); }
        to { opacity: 1; transform: translateX(0); }
      }
      .stagger-1 { animation: slideInRight 0.5s ease forwards 0.1s; opacity: 0; }
      .stagger-2 { animation: slideInRight 0.5s ease forwards 0.2s; opacity: 0; }
      .stagger-3 { animation: slideInRight 0.5s ease forwards 0.3s; opacity: 0; }
      .stagger-4 { animation: slideInRight 0.5s ease forwards 0.4s; opacity: 0; }
      .stagger-5 { animation: slideInRight 0.5s ease forwards 0.5s; opacity: 0; }
      
      /* Pulse Indicator */
      .pulse-dot {
        height: 8px; width: 8px; background-color: #22c55e;
        border-radius: 50%; display: inline-block; margin-right: 8px;
        box-shadow: 0 0 0 0 rgba(34, 197, 144, 0.7);
        animation: pulse 2s infinite;
      }
      @keyframes pulse {
        0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 144, 0.7); }
        70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(34, 197, 144, 0); }
        100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 144, 0); }
      }
      #tv-sync-time {
        font-size: 0.75rem; color: #64748b; font-weight: 800;
        text-transform: uppercase; letter-spacing: 1px;
        display: flex; align-items: center;
      }
      .pending-badge {
        position: absolute;
        bottom: -5px;
        left: 50%;
        transform: translateX(-50%);
        background: #eab308;
        color: #000;
        font-size: 0.6em;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 900;
        z-index: 10;
        box-shadow: 0 2px 4px rgba(0,0,0,0.5);
      }
      
      /* Pulsing Draft Score */
      .pulsing-draft {
        animation: score-pulse 1.5s infinite;
        background: rgba(234, 179, 8, 0.15) !important;
        border: 1px solid rgba(234, 179, 8, 0.4);
      }
      @keyframes score-pulse {
        0% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(1.05); }
        100% { opacity: 1; transform: scale(1); }
      }
      
      @media print {
        body, #app, #tv-container, .tv-grid, .tv-pairing-row, table {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
          color: black !important;
          box-shadow: none !important;
        }
        .no-print, .btn, .badge, .sidebar, header, #tv-sync-time {
          display: none !important;
        }
        .tv-pairing-row {
          background: white !important;
          color: black !important;
          border-bottom: 1px solid #000 !important;
          page-break-inside: avoid !important;
        }
        .tv-pairing-row .board {
          color: black !important;
        }
        .tv-pairing-row .score {
          background: none !important;
          color: black !important;
          border: 1px solid #000 !important;
        }
        h1, h2, h3 {
          color: black !important;
          text-shadow: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ── 2. INITIALIZATION & ROUTING ──
  async function init() {
    injectTVStyles();

    let id = window.location.hash.substring(1);
    if (!id) id = localStorage.getItem('tabuko_active_tv_id');

    tournamentId = id;

    if (tournamentId) {
      window.history.replaceState(null, null, '#' + tournamentId);
      loadBroadcast();
    } else {
      document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #020617; color: #fff;">
          <h2 style="font-size: 2.5rem; margin-bottom: 10px;">Live Broadcast Setup</h2>
          <p style="color: #94a3b8; margin-bottom: 30px;">Enter Tournament ID to begin the live broadcast.</p>
          <div style="display: flex; gap: 10px; width: 100%; max-width: 400px;">
            <input type="text" id="manual-tv-id" placeholder="Tournament ID" style="flex: 1; padding: 12px; border-radius: 6px; background: #1e293b; color: white; border: 1px solid #334155;">
            <button class="btn btn-primary" onclick="window.location.hash = document.getElementById('manual-tv-id').value; window.location.reload();">Connect</button>
          </div>
        </div>
      `;
    }
  }

  let activeRoundListener = null;

  const broadcastChannel = new BroadcastChannel('tabuko_broadcast_sync');

  // Broadcast local changes across open browser tabs instantly without network requests
  function broadcastLocalStateUpdate(type, payload) {
    broadcastChannel.postMessage({ type, payload, senderId: crypto.randomUUID() });
  }

  broadcastChannel.onmessage = function(event) {
    console.log('[Local Mesh Handshake] Captured tab cross-communication:', event.data.type);
    
    // Day 102 Task 2: Multi-Tab Connection Status Badge UI
    const syncEl = document.getElementById('tv-sync-time');
    if (syncEl) {
      syncEl.innerHTML = `<span class="pulse-dot"></span> <span style="color:#10b981;">Local Mesh Active</span> • SYNC: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    if (event.data.type === 'STANDINGS_UPDATE') {
      renderLivingLeaderboard(event.data.payload);
    } else if (event.data.type === 'PAIRINGS_UPDATE') {
      updatePairings(event.data.payload.roundData, event.data.payload.isTeamEvent);
    }
  };

  // Day 261: Subscribe to DistributedEventBus for reactive updates
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      if (window.DistributedEventBus) {
        window.DistributedEventBus.subscribe('STANDINGS_COMPUTED', (envelope) => {
          console.log('[TV] EventBus standings update received.');
        });

        window.DistributedEventBus.subscribe('MESH_STANDINGS_UPDATE', (envelope) => {
          console.log('[TV] P2P mesh standings update received.');
          if (envelope.payload) renderLivingLeaderboard(envelope.payload);
        });
      }
    }, 500);
  }

  async function loadBroadcast() {
    try {
      // 2. Continuous Clock (1s interval)
      setInterval(() => {
        const clockEl = document.getElementById('tv-clock');
        if (clockEl) {
          clockEl.innerText = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
      }, 1000);

    } catch (err) {
      console.error("[TV] Broadcast Error:", err);
    }
  }

  // ── 3. SMART MULTI-COLUMN GRID (Pairings) ──
  function updatePairings(roundData, isTeamEvent) {
    const container = document.getElementById('tv-pairings') || document.getElementById('tv-pairings-list');
    if (!container) return;

    // Unify Team Matches vs Individual Pairings
    let matches = [];
    if (isTeamEvent && roundData.teamMatches) matches = roundData.teamMatches;
    else if (!isTeamEvent && roundData.pairings) matches = roundData.pairings;

    const totalBoards = matches.length + (roundData.bye ? 1 : 0);

    // SAFETY: Handle Empty/Corrupted Round Gracefully
    if (totalBoards === 0) {
      container.innerHTML = '<div style="color: #64748b; text-align: center; width: 100%; font-size: 2rem; margin-top: 50px;">Waiting for pairings...</div>';
      return;
    }

    // Mathematical Layout Engine
    let columns = 1;
    if (totalBoards > 12 && totalBoards <= 26) columns = 2;
    else if (totalBoards > 26) columns = 3;

    const rowsPerColumn = Math.ceil(totalBoards / columns);
    const dynamicHeight = `calc((75vh / ${rowsPerColumn}) - 10px)`;

    container.style.display = 'grid';
    container.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    container.style.gap = '15px';

    let html = matches.map(m => {
      const boardKey = isTeamEvent ? `${roundData.roundNumber}_${m.matchNumber}` : `${roundData.roundNumber}_${m.board}`;
      const pending = pendingApprovals[boardKey];
      
      if (isTeamEvent) {
        const score = m.isResolved ? `${m.team1BP ?? m.homeBoardPoints ?? 0} - ${m.team2BP ?? m.awayBoardPoints ?? 0}` : (pending ? `${pending.whiteScore} - ${pending.blackScore}` : 'vs');
        const badge = (!m.isResolved && pending) ? '<div class="pending-badge">🟡 UNCONFIRMED</div>' : '';
        const pulsingClass = (!m.isResolved && pending) ? 'pulsing-draft' : '';
        return `
          <div class="tv-pairing-row" style="height: ${dynamicHeight}; font-size: clamp(14px, 2vh, 32px); position: relative;">
            <div class="board">${m.matchNumber}</div>
            <div class="player white-player">${m.homeTeamName || 'Unknown'}</div>
            <div class="score ${pulsingClass}" style="color: ${m.isResolved ? 'var(--accent-success)' : (pending ? '#eab308' : '#fff')};">${score}</div>
            <div class="player black-player">${m.awayTeamName || 'Unknown'}</div>
            ${badge}
          </div>
        `;
      } else {
        const score = m.result ? `${m.result.whiteScore} - ${m.result.blackScore}` : (pending ? `${pending.whiteScore} - ${pending.blackScore}` : 'vs');
        const badge = (!m.result && pending) ? '<div class="pending-badge">🟡 UNCONFIRMED</div>' : '';
        const pulsingClass = (!m.result && pending) ? 'pulsing-draft' : '';
        return `
          <div class="tv-pairing-row" style="height: ${dynamicHeight}; font-size: clamp(14px, 2vh, 32px); position: relative;">
            <div class="board">${m.board}</div>
            <div class="player white-player">${m.whiteName} <span class="tv-rtg">${m.whiteRating || ''}</span></div>
            <div class="score ${pulsingClass}" style="color: ${m.result ? 'var(--accent-success)' : (pending ? '#eab308' : '#fff')};">${score}</div>
            <div class="player black-player"><span class="tv-rtg">${m.blackRating || ''}</span> ${m.blackName}</div>
            ${badge}
          </div>
        `;
      }
    }).join('');

    // Render BYE if it exists
    if (roundData.bye) {
      const byeName = isTeamEvent ? (roundData.bye.teamName || 'Unknown') : (roundData.bye.playerName || 'Unknown');
      html += `
        <div class="tv-pairing-row" style="height: ${dynamicHeight}; font-size: clamp(14px, 2vh, 32px); opacity: 0.7;">
          <div class="board">BYE</div>
          <div class="player white-player">${byeName}</div>
          <div class="score">1 - 0</div>
          <div class="player black-player" style="color: #64748b;">---</div>
        </div>
      `;
    }

    const newHtml = `
      <div id="${container.id}" class="${container.className}" style="${container.style.cssText}">
        ${html}
      </div>
    `;
    morphdom(container, newHtml);
  }

  // ── 4. LIVING LEADERBOARD (Top 5 GPU Accelerated) ──
  // Removed iterative polling functions as they are replaced by BroadcastChannel
  function updateStandings(tournament) {
    console.log('[Local Mesh] Polling skipped, relying on BroadcastChannel for updates.');
  }

  function renderLivingLeaderboard(standings) {
    const body = document.getElementById('standings-body');
    if (!body) return;

    // Day 261/293: Use LiveRender GPU-accelerated patching when available
    if (window.LiveRender) {
      window.LiveRender.patchLeaderboard('standings-body', standings);
      standingsInitialized = true;
      return;
    }

    // Day 262: Hardware-accelerated translate3d row shifting
    // Recalculate row height once using cached viewport — no DOM reads during render
    const rowH   = _vp.rowH;
    const rowGap = _vp.rowGap;

    if (standingsInitialized) {
      // SHIFT EXISTING ROWS via translate3d (compositor only — zero layout reflow)
      requestAnimationFrame(() => {
        standings.forEach((player, index) => {
          const rowEl = body.querySelector(`[data-player-id="${player.id || ''}"]`);
          if (rowEl) {
            const newY = index * (rowH + rowGap);
            rowEl.style.transform = `translate3d(0, ${newY}px, 0)`;

            // Update displayed score without innerHTML rewrite
            const ptsEl = rowEl.querySelector('.standings-pts');
            if (ptsEl) ptsEl.textContent = parseFloat(player.score || 0).toFixed(1);

            const rankEl = rowEl.querySelector('.standings-rank');
            if (rankEl) rankEl.textContent = index + 1;
          }
        });
      });
      return;
    }

    // INITIAL RENDER: Build rows with translate3d positioning from the start
    requestAnimationFrame(() => {
      body.innerHTML = '';
      standings.forEach((player, index) => {
        const row  = document.createElement('div');
        const yPos = index * (rowH + rowGap);
        row.className = 'living-row gpu-animated';
        row.dataset.playerId = player.id || `p_${index}`;
        row.dataset.rank     = index + 1;
        // Day 262: Initial position via translate3d — never use top/margin
        row.style.transform  = `translate3d(0, ${yPos}px, 0)`;
        row.style.opacity    = '0';
        row.innerHTML = `
          <div class="rank standings-rank">${index + 1}</div>
          <div class="name standings-name">${player.name || 'Unknown'}</div>
          <div class="pts standings-pts">${parseFloat(player.score || 0).toFixed(1)}</div>
        `;
        body.appendChild(row);

        // Staggered entrance
        requestAnimationFrame(() => {
          row.style.transition = `transform 0.6s cubic-bezier(0.34,1.56,0.64,1), opacity 0.4s ease ${index * 0.05}s`;
          row.style.opacity = '1';
        });
      });
      standingsInitialized = true;
    });
  }

  return { init, patchLeaderboardElement: renderLivingLeaderboard, broadcastLocalStateUpdate };
})();

// Auto-Initialize on page load
document.addEventListener('DOMContentLoaded', TV.init);