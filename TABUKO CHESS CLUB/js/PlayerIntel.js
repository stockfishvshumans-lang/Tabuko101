/**
 * PlayerIntel.js — Tactical Performance Analytics
 * Handles the high-density player performance modal and data fetching.
 */
const PlayerIntel = (() => {

  async function showCard(playerId, tournamentId) {
    if (!playerId || playerId === 'Vacant') return;
    
    try {
      UI.showLoading('Fetching Intelligence...');

      const tDoc = await db.collection('tournaments').doc(tournamentId).get();
      if (!tDoc.exists) throw new Error('Tournament not found');
      const tournament = { id: tDoc.id, ...tDoc.data() };

      // Fetch player data
      const pDoc = await db.collection('tournaments').doc(tournamentId).collection('playerData').doc(playerId).get();
      if (!pDoc.exists) throw new Error('Player data not found');
      const player = { id: pDoc.id, ...pDoc.data() };

      // Fetch match history
      const matches = await getMatchHistory(playerId, tournamentId);

      renderModal(player, tournament, matches);

    } catch (err) {
      UI.showToast(err.message, 'error');
    } finally {
      UI.hideLoading();
    }
  }

  async function getMatchHistory(playerId, tournamentId) {
    const roundsSnap = await db.collection('tournaments').doc(tournamentId).collection('rounds').get();
    let allMatches = [];

    roundsSnap.docs.forEach(doc => {
      const rdData = doc.data();
      const rdNum = rdData.roundNumber || parseInt(doc.id.replace('round_', ''));
      const pairings = rdData.pairings || [];
      
      pairings.forEach(p => {
        if (p.whiteId === playerId || p.blackId === playerId) {
          allMatches.push({
            round: rdNum,
            isWhite: p.whiteId === playerId,
            opponentId: p.whiteId === playerId ? p.blackId : p.whiteId,
            opponentName: p.whiteId === playerId ? p.blackName : p.whiteName,
            result: p.result,
            board: p.board
          });
        }
      });
    });

    return allMatches.sort((a, b) => a.round - b.round);
  }

  function renderModal(player, tournament, matches) {
    // Remove existing if any
    const existing = document.getElementById('player-intel-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active titanium-cobalt animate-fade-in';
    overlay.id = 'player-intel-modal';
    overlay.style.zIndex = '9999';
    
    const winRate = calculateWinRate(matches);
    
    let rp = 0;
    if (typeof PerformanceAnalytics !== 'undefined' && PerformanceAnalytics.calculatePerformanceRating) {
      const rpMatches = matches.map(m => ({
        isUnplayed: false,
        opponentId: m.opponentId,
        opponentRating: 1200, 
        score: m.result ? (m.isWhite ? m.result.whiteScore : m.result.blackScore) : 0
      }));
      rp = PerformanceAnalytics.calculatePerformanceRating(rpMatches, player.selectedRating || 1200);
    }

    overlay.innerHTML = `
      <div class="modal glass-panel" style="max-width: 500px; width: 90%; border: 1px solid rgba(59, 130, 246, 0.2); background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(20px);">
        <div class="modal-header" style="border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
          <div class="flex items-center gap-4">
            <div class="auth-icon-wrap" style="width: 50px; height: 50px; background: rgba(59, 130, 246, 0.1); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
              <span style="font-size: 1.5rem;">👤</span>
            </div>
            <div style="text-align: left;">
              <h2 class="card-title" style="margin: 0; font-size: 1.25rem; color: #fff;">${player.name}</h2>
              <div class="flex gap-2 mt-1">
                 <span class="badge" style="font-size: 0.6rem; background: rgba(59, 130, 246, 0.2); color: #60a5fa;">RANK #${player.rank || '-'}</span>
                 <span class="badge" style="font-size: 0.6rem; background: rgba(16, 185, 129, 0.2); color: #10b981;">${player.score || 0} PTS</span>
              </div>
            </div>
          </div>
          <button class="btn btn-ghost" onclick="document.getElementById('player-intel-modal').remove()" style="color: #64748b;">✕</button>
        </div>

        <div class="modal-body" style="padding: 1.5rem 0;">
          <!-- TIE-BREAKS STRIP -->
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1px; background: rgba(255,255,255,0.05); border-radius: 12px; overflow: hidden; margin: 0 1rem 1.5rem;">
            <div style="background: rgba(15, 23, 42, 0.5); padding: 1rem; text-align: center;">
              <div style="font-size: 0.6rem; color: #64748b; font-weight: 800; text-transform: uppercase; margin-bottom: 4px;">Buchholz</div>
              <div style="font-weight: 900; color: #fff; font-size: 1.1rem;">${Number(player.bh || 0).toFixed(1)}</div>
            </div>
            <div style="background: rgba(15, 23, 42, 0.5); padding: 1rem; text-align: center;">
              <div style="font-size: 0.6rem; color: #64748b; font-weight: 800; text-transform: uppercase; margin-bottom: 4px;">Sonne-Berg</div>
              <div style="font-weight: 900; color: #fff; font-size: 1.1rem;">${Number(player.sb || 0).toFixed(2)}</div>
            </div>
            <div style="background: rgba(15, 23, 42, 0.5); padding: 1rem; text-align: center;">
              <div style="font-size: 0.6rem; color: #64748b; font-weight: 800; text-transform: uppercase; margin-bottom: 4px;">Rating</div>
              <div style="font-weight: 900; color: #60a5fa; font-size: 1.1rem;">${player.selectedRating || 0}</div>
            </div>
          </div>

          <!-- PERFORMANCE ANALYTICS -->
          <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; margin: 0 1rem 1.5rem; padding: 1rem; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-size: 0.6rem; color: #10b981; font-weight: 800; text-transform: uppercase;">Performance Rating (Rp)</div>
              <div style="font-weight: 900; color: #fff; font-size: 1.25rem;">${rp}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 0.6rem; color: #64748b; font-weight: 800; text-transform: uppercase;">Est. Diff</div>
              <div style="font-weight: 900; color: ${rp >= (player.selectedRating || 1200) ? '#10b981' : '#ef4444'}; font-size: 1rem;">${rp >= (player.selectedRating || 1200) ? '+' : ''}${rp - (player.selectedRating || 1200)}</div>
            </div>
          </div>

          <!-- THE PATH (Timeline) -->
          <div class="intel-timeline" style="max-height: 300px; overflow-y: auto; padding: 0 1rem;">
            <div style="font-size: 0.7rem; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 1rem; letter-spacing: 1px; border-left: 3px solid #3b82f6; padding-left: 10px;">Tournament Path</div>
            
            ${matches.map(m => {
              const res = m.result;
              let statusClass = 'result-pending';
              let resSymbol = '?';
              let colorText = m.isWhite ? 'White' : 'Black';
              
              if (res) {
                const myScore = m.isWhite ? res.whiteScore : res.blackScore;
                if (myScore === 1 || myScore === 3) {
                  statusClass = 'result-win';
                  resSymbol = 'W';
                } else if (myScore === 0.5) {
                  statusClass = 'result-draw';
                  resSymbol = 'D';
                } else {
                  statusClass = 'result-loss';
                  resSymbol = 'L';
                }
              }

              return `
                <div class="timeline-item" style="display: flex; gap: 1rem; margin-bottom: 1rem; position: relative;">
                  <div style="min-width: 45px; text-align: center;">
                    <div style="font-size: 0.6rem; color: #64748b; font-weight: 800;">RD ${m.round}</div>
                    <div class="result-pill ${statusClass}" style="width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 50%; margin: 4px auto 0; font-weight: 900; font-size: 0.8rem;">${resSymbol}</div>
                  </div>
                  <div style="flex: 1; background: rgba(255,255,255,0.03); padding: 0.85rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div style="text-align: left;">
                        <div style="font-size: 0.65rem; color: #64748b; font-weight: 600; margin-bottom: 2px;">Against</div>
                        <div style="font-weight: 700; color: #f8fafc;">${m.opponentName || 'Unknown'}</div>
                      </div>
                      <div style="text-align: right;">
                        <div style="font-size: 0.6rem; color: #64748b; font-weight: 800; text-transform: uppercase;">Color</div>
                        <div style="font-size: 0.75rem; font-weight: 700; color: #94a3b8;">${colorText}</div>
                      </div>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
            ${matches.length === 0 ? '<p class="text-muted text-sm" style="text-align: center; padding: 2rem;">No games recorded in this session.</p>' : ''}
          </div>
        </div>

        <div class="modal-footer" style="background: rgba(0,0,0,0.3); border-top: 1px solid rgba(255,255,255,0.05); padding: 1.25rem; border-radius: 0 0 16px 16px; display: flex; justify-content: space-between; align-items: center;">
          <div style="text-align: left;">
            <div style="font-size: 0.6rem; color: #64748b; font-weight: 800; text-transform: uppercase;">Global Efficiency</div>
            <div style="font-weight: 900; color: #10b981; font-size: 1.25rem;">${winRate}% <span style="font-size: 0.7rem; color: #64748b; font-weight: 600;">Success Rate</span></div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="document.getElementById('player-intel-modal').remove()" style="padding: 0.6rem 1.2rem; border-radius: 8px;">Dismiss</button>
        </div>
      </div>

      <style>
        .result-win { background: rgba(16, 185, 129, 0.2) !important; color: #10b981 !important; border: 1px solid rgba(16, 185, 129, 0.3) !important; }
        .result-loss { background: rgba(239, 68, 68, 0.2) !important; color: #ef4444 !important; border: 1px solid rgba(239, 68, 68, 0.3) !important; }
        .result-draw { background: rgba(245, 158, 11, 0.2) !important; color: #f59e0b !important; border: 1px solid rgba(245, 158, 11, 0.3) !important; }
        .result-pending { background: rgba(100, 116, 139, 0.1) !important; color: #64748b !important; border: 1px solid rgba(100, 116, 139, 0.2) !important; }
        
        #player-intel-modal .modal-body::-webkit-scrollbar { width: 4px; }
        #player-intel-modal .modal-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
      </style>
    `;

    document.body.appendChild(overlay);
  }

  function calculateWinRate(matches) {
    if (matches.length === 0) return 0;
    let score = 0;
    matches.forEach(m => {
      if (m.result) {
        const myScore = m.isWhite ? m.result.whiteScore : m.result.blackScore;
        score += myScore;
      }
    });
    // In chess, win rate is often (Score / Games)
    return ((score / matches.length) * 100).toFixed(0);
  }

  return { showCard };
})();

window.PlayerIntel = PlayerIntel;
