/**
 * ArbiterView.js — Mobile-Optimized Arbiter Dashboard
 * Single-tap result entry with real-time sync.
 */
const ArbiterView = (() => {
  let _unsub = null;

  function restoreArbiterSession() {
    const token = sessionStorage.getItem('tabuko_arbiter_token');
    if (!token) return false;
    try {
       const decoded = JSON.parse(atob(token));
       if (decoded && decoded.role === 'arbiter') return decoded;
    } catch(e) { return false; }
    return false;
  }

  async function render(tournamentId) {
    const restored = restoreArbiterSession();
    if (restored && restored.tournamentId === tournamentId) {
      window.activeTournament = { name: restored.name || 'Tournament', currentRound: 1 };
    } else {
      const ok = await ArbiterManager.handleArbiterLogin(tournamentId);
      if (!ok) { App.navigateTo('dashboard'); return; }
    }

    const t = window.activeTournament || { name: 'Tournament', currentRound: 1 };
    const app = document.getElementById('app');

    app.innerHTML = `
      <div class="arb-root">
        <header class="arb-header">
          <div class="arb-brand">
            <div class="auth-icon-wrap" style="width:40px;height:40px;background:rgba(59,130,246,0.1);margin-right:12px;">
              <span style="font-size:1.2rem;">🛡️</span>
            </div>
            <div>
              <h1 class="arb-title">${t.name || 'Tournament'}</h1>
              <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                <p class="arb-sub">Round ${t.currentRound || 1}</p>
                <div id="arb-round-status" class="status-badge-mini">LIVE</div>
              </div>
            </div>
          </div>
          <button class="arb-btn-ghost" onclick="Auth.signOut()">Sign Out</button>
        </header>
        <div id="arb-board-grid" class="arb-grid">
          <p class="arb-muted">Initializing Command Cards...</p>
        </div>
        <div id="arb-wait-zone"></div>
      </div>
    `;

    injectStyles();
    setupViewportShieldFocusSafeguards();
    startListener(tournamentId, t.currentRound || 1);
  }

  // Day 89 Task 2: Viewport Shield Focus Safeguards
  function setupViewportShieldFocusSafeguards() {
    window.addEventListener('focusin', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        setTimeout(() => {
          e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
      }
    });
  }

  function startListener(tournamentId, round) {
    if (_unsub) { _unsub(); _unsub = null; }

    _unsub = db.collection('tournaments').doc(tournamentId).onSnapshot(doc => {
      if (!doc.exists) return;
      const tData = doc.data();
      window.activeTournament = { id: doc.id, ...tData };

      if (window.arbiterRoundsStreamUnsub) {
        window.arbiterRoundsStreamUnsub(); // Disconnect active streaming snapshot cleanly
        window.arbiterRoundsStreamUnsub = null;
        console.log('[Stream Management] Successfully detached stale arbiter snapshot channel.');
      }
      
      window.arbiterRoundsStreamUnsub = db.collection('tournaments').doc(tournamentId)
        .collection('rounds').doc(`round_${round}`)
        .onSnapshot(async rDoc => {
          const rData = rDoc.exists ? rDoc.data() : { pairings: [], matches: [] };
          await renderBoards(tournamentId, tData, rData, round);
        });
    });
  }

  async function renderBoards(tournamentId, tData, rData, round) {
    const grid = document.getElementById('arb-board-grid');
    const waitZone = document.getElementById('arb-wait-zone');
    const statusBadge = document.getElementById('arb-round-status');
    if (!grid) return;

    const pending = tData.pending_results || {};
    const approvalLog = tData.approval_log || {};

    const playerSnap = await db.collection('tournaments').doc(tournamentId).collection('playerData').get();
    const fullPlayerMap = {};
    playerSnap.docs.forEach(d => fullPlayerMap[d.id] = d.data());

    const isTeam = tData.isTeamEvent || rData.teamMatches || rData.isTeamRound;
    let totalBoards = 0;
    let filledBoards = 0;

    if (isTeam) {
      const teamSnap = await db.collection('tournaments').doc(tournamentId).collection('teams').get();
      const fullTeamMap = {};
      teamSnap.docs.forEach(d => fullTeamMap[d.id] = d.data());

      const matches = rData.teamMatches || rData.matches || [];
      if (matches.length === 0) {
        grid.innerHTML = '<div class="arb-empty-state">No team pairings for this round yet.</div>';
        return;
      }

      grid.innerHTML = (await Promise.all(matches.map(async (m) => {
        const teamA = fullTeamMap[m.homeTeamId]?.name || m.homeTeamName || m.team1Name || 'Team A';
        const teamB = fullTeamMap[m.awayTeamId]?.name || m.awayTeamName || m.team2Name || 'Team B';

        let liveHBP = 0;
        let liveABP = 0;
        let matchMissingCount = 0;

        const boardsHtml = (await Promise.all((m.boards || []).map(async (b, bIdx) => {
          totalBoards++;
          const boardNum = b.boardNumber || (bIdx + 1);
          const key = `${round}_${m.matchNumber}_${boardNum}`;
          const pendingRes = pending[key];
          const approved = approvalLog[key];

          let resultDisplay = '';
          let isMissing = false;
          let wScore = 0;
          let bScore = 0;

          if (approved) {
            resultDisplay = approved.result;
            [wScore, bScore] = approved.result.split('-').map(parseFloat);
          } else if (pendingRes) {
            resultDisplay = `${pendingRes.whiteScore} - ${pendingRes.blackScore}`;
            wScore = pendingRes.whiteScore;
            bScore = pendingRes.blackScore;
          } else if (b.result) {
            wScore = b.result.whiteScore;
            bScore = b.result.blackScore;
            resultDisplay = `${wScore} - ${bScore}`;
          } else {
            isMissing = true;
            matchMissingCount++;
          }

          if (!isMissing) filledBoards++;
          liveHBP += wScore;
          liveABP += bScore;

          const whiteIdentity = await IdentityResolution.resolvePlayer(tournamentId, m.homeTeamId, b.whiteId, b.whiteName, boardNum, fullPlayerMap, fullTeamMap[m.homeTeamId]);
          const blackIdentity = await IdentityResolution.resolvePlayer(tournamentId, m.awayTeamId, b.blackId, b.blackName, boardNum, fullPlayerMap, fullTeamMap[m.awayTeamId]);

          return `
            <div class="board-command-card ${isMissing ? 'missing-result' : 'synced-result'}">
              <div class="board-index">BD ${boardNum}</div>
              <div class="player-slot white-slot">${whiteIdentity.name || 'Vacant'}</div>
              <div class="result-anchor-120">
                <div class="result-action-rail">
                  <button class="res-btn win-btn ${resultDisplay === '1 - 0' ? 'active' : ''}" onclick="ArbiterView.submitResult('${tournamentId}',${round},${boardNum},1,0,'${m.matchNumber}')">1</button>
                  <button class="res-btn draw-btn ${resultDisplay === '0.5 - 0.5' ? 'active' : ''}" onclick="ArbiterView.submitResult('${tournamentId}',${round},${boardNum},0.5,0.5,'${m.matchNumber}')">½</button>
                  <button class="res-btn loss-btn ${resultDisplay === '0 - 1' ? 'active' : ''}" onclick="ArbiterView.submitResult('${tournamentId}',${round},${boardNum},0,1,'${m.matchNumber}')">0</button>
                </div>
              </div>
              <div class="player-slot black-slot">${blackIdentity.name || 'Vacant'}</div>
              <div class="board-status-badge ${isMissing ? 'MISSING pulse-text' : 'SYNCED'}">
                ${isMissing ? 'MISSING' : '<span class="sync-icon">✓</span> SYNCED'}
              </div>
            </div>
          `;
        }))).join('');

        const matchStatus = matchMissingCount === 0 ? 'synced' : 'missing';

        return `
          <div class="team-match-card ${matchStatus}-glow fade-in">
            <div class="team-match-header">
              <div class="team-label home">${teamA}</div>
              <div class="team-bp-hub pulse-bp">
                <span class="bp-val hbp">${liveHBP}</span>
                <span class="bp-label">BP HUB</span>
                <span class="bp-val abp">${liveABP}</span>
              </div>
              <div class="team-label away">${teamB}</div>
            </div>
            <div class="match-boards-grid">
              ${boardsHtml}
            </div>
          </div>
        `;
      }))).join('');

    } else {
      const matches = rData.pairings || rData.matches || [];
      if (matches.length === 0) {
        grid.innerHTML = '<div class="arb-empty-state">No pairings for this round yet.</div>';
        return;
      }

      grid.innerHTML = (await Promise.all(matches.map(async (m, i) => {
        totalBoards++;
        const boardNum = m.board || i + 1;
        const key = `${round}_${boardNum}`;
        const pendingRes = pending[key];
        const approved = approvalLog[key];

        let resultDisplay = '';
        let isMissing = false;

        if (approved) {
          resultDisplay = approved.result;
        } else if (pendingRes) {
          resultDisplay = `${pendingRes.whiteScore} - ${pendingRes.blackScore}`;
        } else if (m.result) {
          const wS = typeof m.result === 'object' ? m.result.whiteScore : m.result.split('-')[0];
          const bS = typeof m.result === 'object' ? m.result.blackScore : m.result.split('-')[1];
          resultDisplay = `${wS} - ${bS}`;
        } else {
          isMissing = true;
        }

        if (!isMissing) filledBoards++;

        const whiteIdentity = await IdentityResolution.resolvePlayer(tournamentId, null, m.white, m.whiteName, boardNum, fullPlayerMap);
        const blackIdentity = await IdentityResolution.resolvePlayer(tournamentId, null, m.black, m.blackName, boardNum, fullPlayerMap);

        return `
          <div class="board-command-card ${isMissing ? 'missing-result' : 'synced-result'} fade-in">
            <div class="board-index">BD ${boardNum}</div>
            <div class="player-slot white-slot">${whiteIdentity.name || 'Vacant'}</div>
            <div class="result-anchor-120">
              <div class="result-action-rail">
                <button class="res-btn win-btn ${resultDisplay === '1 - 0' ? 'active' : ''}" onclick="ArbiterView.submitResult('${tournamentId}',${round},${boardNum},1,0)">1</button>
                <button class="res-btn draw-btn ${resultDisplay === '0.5 - 0.5' ? 'active' : ''}" onclick="ArbiterView.submitResult('${tournamentId}',${round},${boardNum},0.5,0.5)">½</button>
                <button class="res-btn loss-btn ${resultDisplay === '0 - 1' ? 'active' : ''}" onclick="ArbiterView.submitResult('${tournamentId}',${round},${boardNum},0,1)">0</button>
              </div>
            </div>
            <div class="player-slot black-slot">${blackIdentity.name || 'Vacant'}</div>
            <div class="board-status-badge ${isMissing ? 'MISSING pulse-text' : 'SYNCED'}">
                ${isMissing ? 'MISSING' : '<span class="sync-icon">✓</span> SYNCED'}
            </div>
          </div>
        `;
      }))).join('');
    }

    // ── MISSION COMPLETE HANDSHAKE ──
    const isDone = totalBoards > 0 && filledBoards === totalBoards;
    if (isDone) {
      statusBadge.textContent = 'SUBMITTED & PENDING APPROVAL';
      statusBadge.className = 'status-badge-mini submitted-pulse';
      waitZone.innerHTML = `
        <div class="mission-complete-card glass-panel animate-fade-in">
          <div class="complete-icon">✨</div>
          <h2 class="complete-title">Mission Complete</h2>
          <p class="complete-text">All results have been synced to the Command Center. Waiting for the Admin to finalize the round and pair the next matches. Please stand by.</p>
          <div class="sync-status-bar">
            <div class="sync-fill"></div>
          </div>
        </div>
      `;
    } else {
      statusBadge.textContent = 'LIVE';
      statusBadge.className = 'status-badge-mini live-pulse';
      waitZone.innerHTML = '';
    }
  }

  // Modal logic removed: Inline buttons are now used

  async function submitResult(tournamentId, round, board, w, b, matchNumber = null) {
    document.getElementById('arb-result-modal')?.remove();
    try {
      if (!navigator.onLine) {
        UI.showToast(`Network offline. Caching result...`, 'info');
        // Simple offline diagnostic guard requested
        cacheResultLocally(tournamentId, round, board, w, b, matchNumber);
        return;
      }
      // Trigger silent draft save (goes to pending_results)
      await ArbiterManager.submitDraftResult(tournamentId, round, board, w, b, matchNumber);
      UI.showToast(`Board ${board}: ${w}-${b} pending approval`, 'success');
    } catch (err) {
      UI.showToast(err.message, 'error');
    }
  }

  function cacheResultLocally(tournamentId, round, board, w, b, matchNumber) {
    const key = `offline_res_${tournamentId}_${round}_${board}_${matchNumber || ''}`;
    localStorage.setItem(key, JSON.stringify({ tournamentId, round, board, w, b, matchNumber, ts: Date.now() }));
    UI.showToast('Sync Pending. Cached locally.', 'warning');
    // Once online listener logic
    window.addEventListener('online', syncOfflineResults, { once: true });
  }

  async function syncOfflineResults() {
    UI.showToast('Network restored. Syncing cached results...', 'info');
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('offline_res_')) {
        const val = secureGetLocalStorageItem(key);
        if (!val) continue;
        try {
          await ArbiterManager.submitDraftResult(val.tournamentId, val.round, val.board, val.w, val.b, val.matchNumber);
          localStorage.removeItem(key);
        } catch (e) {
          console.error('Failed to sync offline result', e);
        }
      }
    }
  }

  function cleanup() {
    if (_unsub) { _unsub(); _unsub = null; }
    if (window.arbiterRoundsStreamUnsub) { window.arbiterRoundsStreamUnsub(); window.arbiterRoundsStreamUnsub = null; }
  }

  // ── STYLES ──
  function injectStyles() {
    if (document.getElementById('arb-tactical-css')) return;
    const s = document.createElement('style');
    s.id = 'arb-tactical-css';
    s.textContent = `
      .arb-root { background: #05070a; color: #e2e8f0; min-height: 100vh; padding: 1.5rem; font-family: 'Outfit', sans-serif; padding-bottom: 5rem; }
      .arb-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1.5rem; }
      .arb-brand { display: flex; align-items: center; gap: 0.5rem; }
      .arb-title { font-weight: 900; font-size: 1.3rem; letter-spacing: -0.5px; color: #fff; margin: 0; }
      .arb-sub { color: #64748b; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin: 0; }
      
      .status-badge-mini { font-size: 0.6rem; font-weight: 900; padding: 2px 8px; border-radius: 4px; letter-spacing: 1px; }
      .status-badge-mini.live-pulse { background: rgba(16,185,129,0.1); color: #10b981; border: 1px solid rgba(16,185,129,0.2); animation: live-blink 2s infinite; }
      .status-badge-mini.submitted-pulse { background: rgba(245,158,11,0.1); color: #f59e0b; border: 1px solid rgba(245,158,11,0.2); animation: gold-blink 2s infinite; }
      
      @keyframes live-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      @keyframes gold-blink { 0%, 100% { border-color: rgba(245,158,11,0.2); } 50% { border-color: rgba(245,158,11,0.6); box-shadow: 0 0 10px rgba(245,158,11,0.2); } }

      .arb-grid { display: flex; flex-direction: column; gap: 1.5rem; }
      .arb-empty-state { text-align: center; padding: 5rem; color: #475569; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; }

      .team-match-card { background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 20px; padding: 1.5rem; transition: 0.4s; }
      .team-match-card.synced-glow { border-color: rgba(16,185,129,0.2); background: rgba(6, 78, 59, 0.1); box-shadow: 0 0 30px rgba(16,185,129,0.05); }
      
      .team-match-header { display: grid; grid-template-columns: 40px 1fr 160px 1fr 80px; align-items: center; margin-bottom: 1.5rem; }
      .team-label { font-weight: 900; font-size: 1rem; color: #fff; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .team-label.home { text-align: right; grid-column: 2; padding-right: 20px; }
      .team-label.away { text-align: left; grid-column: 4; padding-left: 20px; color: #94a3b8; }
      
      .team-bp-hub { 
        grid-column: 3; display: flex; align-items: center; justify-content: center; 
        background: #0f172a; padding: 0.4rem 1rem; border-radius: 50px; gap: 0.75rem; 
        border: 1px solid rgba(59, 130, 246, 0.3); box-shadow: 0 0 20px rgba(59, 130, 246, 0.1);
      }
      .pulse-bp { animation: bp-pulse 1s ease-out; }
      @keyframes bp-pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); border-color: #10b981; } 100% { transform: scale(1); } }

      .bp-val { font-family: 'JetBrains Mono', monospace; font-weight: 900; font-size: 1.3rem; }
      .bp-val.hbp { color: #fff; }
      .bp-val.abp { color: #94a3b8; }
      .bp-label { font-size: 0.6rem; font-weight: 900; color: #3b82f6; text-transform: uppercase; letter-spacing: 1px; }

      .match-boards-grid { display: flex; flex-direction: column; gap: 0.75rem; }
      .board-command-card { 
        display: grid; grid-template-columns: 40px 1fr 160px 1fr 80px; align-items: center;
        background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.05); padding: 0.75rem 1rem; border-radius: 12px;
        transition: 0.3s; position: relative;
      }
      .board-command-card.synced-result { border-color: rgba(16,185,129,0.1); background: rgba(0,0,0,0.2); }
      .board-command-card.synced-result .result-action-rail { opacity: 0.6; pointer-events: auto; }
      .board-command-card.synced-result .result-action-rail:hover { opacity: 1; }

      .board-index { grid-column: 1; font-family: 'JetBrains Mono'; font-weight: 900; font-size: 0.65rem; color: #475569; }
      .player-slot { font-weight: 800; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #fff; }
      .white-slot { grid-column: 2; text-align: right; padding-right: 20px; }
      .black-slot { grid-column: 4; text-align: left; padding-left: 20px; color: #94a3b8; }

      .result-anchor-120 { grid-column: 3; display: flex; justify-content: center; width: 160px; }
      .result-action-rail { display: flex; gap: 6px; background: rgba(0,0,0,0.6); padding: 4px; border-radius: 50px; border: 1px solid rgba(255,255,255,0.1); }
      
      .res-btn { 
        width: 44px; height: 44px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.05); background: #1e293b; color: #475569;
        font-weight: 900; font-size: 0.95rem; cursor: pointer; transition: 0.3s;
      }
      .res-btn.win-btn.active { background: #10b981; color: #fff; box-shadow: 0 0 15px rgba(16, 185, 129, 0.5); border-color: rgba(255,255,255,0.2); }
      .res-btn.draw-btn.active { background: #f59e0b; color: #fff; box-shadow: 0 0 15px rgba(245, 158, 11, 0.5); border-color: rgba(245, 158, 11, 0.2); }
      .res-btn.loss-btn.active { background: #ef4444; color: #fff; box-shadow: 0 0 15px rgba(239, 68, 68, 0.5); border-color: rgba(255,255,255,0.2); }

      .board-status-badge { grid-column: 5; text-align: right; font-size: 0.6rem; font-weight: 900; color: #475569; letter-spacing: 1px; }
      .board-status-badge.MISSING { color: #f87171; }
      .board-status-badge.SYNCED { color: #10b981; }
      .sync-icon { font-size: 0.8rem; }

      .mission-complete-card { 
        margin-top: 3rem; background: linear-gradient(135deg, rgba(16,185,129,0.1), rgba(59,130,246,0.1));
        border: 1px solid rgba(16,185,129,0.2); padding: 2.5rem; border-radius: 24px; text-align: center;
        backdrop-filter: blur(20px);
      }
      .complete-icon { font-size: 3rem; margin-bottom: 1rem; }
      .complete-title { font-weight: 900; color: #fff; margin-bottom: 0.5rem; }
      .complete-text { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; max-width: 400px; margin: 0 auto 1.5rem; }
      
      .sync-status-bar { height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden; width: 100px; margin: 0 auto; }
      .sync-fill { height: 100%; width: 100%; background: #10b981; animation: sync-slide 2s linear infinite; }
      @keyframes sync-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }

      .arb-btn-ghost { background: none; border: 1px solid rgba(255,255,255,0.1); color: #64748b; padding: 0.6rem 1.2rem; border-radius: 10px; font-weight: 800; font-size: 0.8rem; cursor: pointer; transition: 0.3s; }
      .arb-btn-ghost:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.2); }
      
      @keyframes pulse-opacity { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
      .pulse-text { animation: pulse-opacity 2s infinite; color: #ef4444 !important; }

      .board-command-card.missing-result { border: 2px solid rgba(239, 68, 68, 0.2); animation: crimson-pulse 2s infinite; }
      @keyframes crimson-pulse {
        0% { border-color: rgba(239, 68, 68, 0.1); box-shadow: 0 0 0 rgba(239, 68, 68, 0); }
        50% { border-color: rgba(239, 68, 68, 0.5); box-shadow: 0 0 15px rgba(239, 68, 68, 0.2); }
        100% { border-color: rgba(239, 68, 68, 0.1); box-shadow: 0 0 0 rgba(239, 68, 68, 0); }
      }
      
      .fade-in { animation: fadeIn 0.4s ease-out forwards; }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(s);
  }

  return { render, submitResult, cleanup };
})();

window.ArbiterView = ArbiterView;
