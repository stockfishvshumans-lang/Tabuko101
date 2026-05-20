/**
 * team-pairing-render.js — Slate-Carbon Team Tournament View
 * Flat scoreboard cards with nested board tables. All state logic preserved.
 */
window._teamTacticalRender = async function(el, tournament, targetRound, roundData, playerMap) {
  const rd = parseInt(targetRound);
  const isAdmin = Auth.isAdmin() || Auth.isArbiter();
  const isLocked = ['completed','archived','finished'].includes(tournament.status);
  const isPast = rd < tournament.currentRound;
  const matches = roundData.teamMatches || roundData.matches || [];

  const tSnap = await db.collection('tournaments').doc(tournament.id).collection('teams').get();
  const fullTeams = {};
  tSnap.docs.forEach(d => fullTeams[d.id] = { id: d.id, ...d.data() });

  const matchData = await Promise.all(matches.map(async m => {
    const home = fullTeams[m.homeTeamId] || { name: m.homeTeamName || 'Team A' };
    const away = fullTeams[m.awayTeamId] || { name: m.awayTeamName || 'Team B' };
    const boards = await Promise.all((m.boards || []).map(async (b, i) => {
      if (!b) b = { boardNumber: i+1, whiteId: null, blackId: null, whiteName: 'Vacant', blackName: 'Vacant', result: null };
      const w = await IdentityResolution.resolvePlayer(tournament.id, m.homeTeamId, b.whiteId, b.whiteName, b.boardNumber, playerMap, home);
      const bk = await IdentityResolution.resolvePlayer(tournament.id, m.awayTeamId, b.blackId, b.blackName, b.boardNumber, playerMap, away);
      return { ...b, wName: w.name, wRating: w.rating || w.selectedRating || 0, bName: bk.name, bRating: bk.rating || bk.selectedRating || 0 };
    }));
    let hBP = 0, aBP = 0, done = 0;
    boards.forEach(b => {
      if (b.result) { hBP += b.result.whiteScore || 0; aBP += b.result.blackScore || 0; done++; }
    });
    const mid = m.matchNumber || m.id;
    return { m, mid, home, away, boards, hBP: m.isResolved ? (m.team1BP ?? hBP) : hBP, aBP: m.isResolved ? (m.team2BP ?? aBP) : aBP, done, resolved: m.isResolved };
  }));

  const pending = matchData.filter(d => !d.resolved).length;
  const total = matchData.length;
  const roundOpts = Array.from({length:tournament.currentRound},(_, i)=>i+1).map(r=>`<option value="${r}" ${r===rd?'selected':''}}>Round ${r}</option>`).join('');

  const matchCards = matchData.map(d => {
    const statusCls = d.resolved ? 'sealed' : (d.done > 0 ? 'live' : 'ready');
    const statusTxt = d.resolved ? 'SEALED' : (d.done > 0 ? 'IN PROGRESS' : 'READY');

    const boardRows = d.boards.map(b => {
      const ws = b.result?.whiteScore; const bs = b.result?.blackScore;
      const hasRes = b.result != null;
      let rTxt = 'ENTER', rCls = '';
      if (hasRes) {
        rTxt = `${ws} - ${bs}`;
        rCls = ws > bs ? 'win' : ws < bs ? 'loss' : 'draw';
      }
      const syncIcon = hasRes ? '🔒' : '○';
      return `<tr>
        <td class="sc-td-bd">${b.boardNumber}</td>
        <td class="sc-td-white">${b.wName} <span class="sc-player-elo">(${b.wRating})</span></td>
        <td class="sc-td-result"><span class="sc-result-pill ${rCls} ${hasRes?'has-result':''}" ${!hasRes && isAdmin && !isLocked && !isPast ? `onclick="window._twResultModal('${tournament.id}',${rd},'${d.mid}')"` : ''}>${rTxt}</span></td>
        <td class="sc-td-black">${b.bName} <span class="sc-player-elo">(${b.bRating})</span></td>
        <td class="sc-td-status">${syncIcon}</td>
      </tr>`;
    }).join('');

    return `<div class="sc-team-card" id="tw-card-${d.mid}" data-match-id="${d.mid}">
      <div class="team-bar-header">
        <div class="sc-team-block">
          <span class="sc-team-name-lg" onclick="window._twTeamHistory('${tournament.id}','${d.m.homeTeamId}','${d.home.name}')">${d.home.name}</span>
          <span class="sc-team-avg">Avg: ${d.home.avgRating||0}</span>
        </div>
        <div class="sc-scoreboard">
          <div class="sc-score-display"><span class="tw-score-val">${d.hBP}</span> : <span class="tw-score-val away">${d.aBP}</span></div>
          <span class="sc-score-state ${statusCls}">${statusTxt}</span>
        </div>
        <div class="sc-team-block right">
          <span class="sc-team-name-lg" onclick="window._twTeamHistory('${tournament.id}','${d.m.awayTeamId}','${d.away.name}')">${d.away.name}</span>
          <span class="sc-team-avg">Avg: ${d.away.avgRating||0}</span>
        </div>
      </div>
      <table class="team-matrix-table">
        <thead><tr>
          <th style="width:8%;text-align:center">BD</th>
          <th style="width:38%">WHITE</th>
          <th style="width:16%;text-align:center">RESULT</th>
          <th style="width:38%;text-align:right">BLACK</th>
          <th style="text-align:center">⚡</th>
        </tr></thead>
        <tbody>${boardRows}</tbody>
      </table>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="sc-pairing-viewport">
    <div class="sc-header-bar no-print">
      <div class="sc-header-left">
        <select class="sc-round-select tw-round-sel">${roundOpts}</select>
        ${!isPast && !isLocked ? '<span class="sc-live-dot">LIVE</span>' : '<span style="font-size:0.6rem;color:#475569;font-weight:800">HISTORY</span>'}
        <span class="sc-player-count">${total} Teams • Team Match</span>
        <span class="sc-system-badge">Team Standing</span>
      </div>
      <div class="sc-header-right">
        ${pending > 0 ? `<span style="font-size:0.65rem;font-weight:900;color:var(--status-pending)">${pending} PENDING</span>` : '<span style="font-size:0.65rem;font-weight:900;color:var(--status-locked)">✓ ALL SEALED</span>'}
        <span style="font-size:0.55rem;color:#334155;font-weight:800">${total-pending}/${total}</span>
        <button class="sc-cmd-btn" onclick="UI.printPairings()">🖨️</button>
        ${!isPast && isAdmin && !isLocked ? `<button class="sc-cmd-btn" style="color:var(--status-locked)" onclick="UI.addTournamentRoundPrompt('${tournament.id}')">+ ROUND</button>` : ''}
      </div>
    </div>
    <div class="sc-table-scroll">
      <div class="sc-team-container">
        ${matchCards || '<div style="padding:3rem;text-align:center;color:var(--text-muted)">No Active Pairings</div>'}
        ${roundData.bye ? `<div style="padding:10px 16px;background:rgba(245,158,11,0.05);border:1px dashed rgba(245,158,11,0.2);border-radius:4px;display:flex;align-items:center;gap:10px;margin-top:8px"><span style="font-size:0.6rem;font-weight:900;color:var(--status-pending)">BYE</span><span style="font-size:0.85rem;font-weight:800;color:var(--status-pending)">${roundData.bye.teamName || 'Unknown'}</span></div>` : ''}
      </div>
    </div>
    ${isAdmin && matches.length > 0 ? `<div class="sc-legend-bar no-print" style="gap:8px">
      ${!isLocked && !isPast ? `<button class="sc-cmd-btn danger" id="tw-btn-repair">⚠ Repair</button>` : ''}
      ${!isLocked && isPast ? `<button class="sc-cmd-btn warn" id="tw-btn-unlock">🔓 Unlock Rd ${rd}</button>` : ''}
      ${!isLocked && rd > 1 ? `<button class="sc-cmd-btn danger" id="tw-btn-rollback">⏪ Rollback Rd ${rd}</button>` : ''}
    </div>` : ''}
  </div>`;

  // Event bindings (all preserved)
  el.querySelector('.tw-round-sel')?.addEventListener('change', e => {
    UI.renderTournamentTab('pairings', tournament, parseInt(e.target.value));
  });
  el.querySelector('#tw-btn-repair')?.addEventListener('click', async () => {
    if (!confirm('Delete and regenerate pairings?')) return;
    try { UI.showLoading(); await Tournament.deleteAndRepairCurrentRound(tournament.id); UI.showToast('Regenerated','success'); UI.renderTournamentView(await DB.getTournament(tournament.id)); }
    catch(e){ UI.showToast(e.message,'error'); } finally { UI.hideLoading(); }
  });
  el.querySelector('#tw-btn-rollback')?.addEventListener('click', async () => {
    if (!confirm(`Delete Round ${rd}? DATA WILL BE LOST.`)) return;
    try { UI.showLoading(); await Tournament.deleteCurrentRound(tournament.id); UI.showToast('Deleted','success'); UI.renderTournamentView(await DB.getTournament(tournament.id)); }
    catch(e){ UI.showToast(e.message,'error'); } finally { UI.hideLoading(); }
  });
  el.querySelector('#tw-btn-unlock')?.addEventListener('click', async () => {
    if (!confirm(`Unlock Round ${rd}?`)) return;
    try { UI.showLoading(); await Tournament.unlockRound(tournament.id, rd); UI.showToast(`Rd ${rd} Unlocked`,'success'); UI.renderTournamentTab('pairings', tournament, rd); }
    catch(e){ UI.showToast(e.message,'error'); } finally { UI.hideLoading(); }
  });
};

// Toggle board matrix (preserved)
window._twToggleBoards = function(mid) {
  const el = document.getElementById('tw-boards-' + mid);
  if (!el) return;
  el.classList.toggle('expanded');
  const btn = document.querySelector(`[data-toggle-boards="${mid}"]`);
  if (btn) {
    const isExp = el.classList.contains('expanded');
    btn.innerHTML = btn.innerHTML.replace(isExp ? 'BOARDS' : 'HIDE', isExp ? 'HIDE' : 'BOARDS');
    btn.classList.toggle('active', isExp);
  }
};

// Result Modal for Team — Slate-Carbon (preserved logic, new layout)
window._twResultModal = async function(tournamentId, round, matchId) {
  const t = await DB.getTournament(tournamentId);
  const rData = await DB.getRound(tournamentId, round);
  const match = (rData.teamMatches || rData.matches || []).find(m => (m.matchNumber || m.id) == matchId);
  if (!match) return UI.showToast('Match not found', 'error');

  const tSnap = await db.collection('tournaments').doc(tournamentId).collection('teams').get();
  const teams = {}; tSnap.docs.forEach(d => teams[d.id] = { id: d.id, ...d.data() });
  const pSnap = await db.collection('tournaments').doc(tournamentId).collection('playerData').get();
  const pMap = {}; pSnap.docs.forEach(d => pMap[d.id] = { id: d.id, ...d.data() });

  const home = teams[match.homeTeamId] || { name: match.homeTeamName };
  const away = teams[match.awayTeamId] || { name: match.awayTeamName };

  let hBP = 0, aBP = 0;
  const boardsHtml = await Promise.all(match.boards.map(async b => {
    const w = await IdentityResolution.resolvePlayer(tournamentId, match.homeTeamId, b.whiteId, b.whiteName, b.boardNumber, pMap, home);
    const bk = await IdentityResolution.resolvePlayer(tournamentId, match.awayTeamId, b.blackId, b.blackName, b.boardNumber, pMap, away);
    const ws = b.result?.whiteScore ?? null;
    const bs = b.result?.blackScore ?? null;
    if (ws !== null) { hBP += ws; aBP += bs; }
    const raw = b.rawResult || '';
    return `<div class="tw-board-entry">
      <div class="tw-be-num">${b.boardNumber}</div>
      <div class="tw-be-player white-side">
        <div class="tw-be-name" onclick="PlayerIntel.showCard('${b.whiteId}','${tournamentId}')">${w.name}</div>
        <div class="tw-be-rating">RTG: ${w.rating||w.selectedRating||0}</div>
        <div class="tw-be-score ${ws===1?'win':ws===0?'loss':ws===0.5?'draw':'unset'}">${ws !== null ? ws : '-'}</div>
      </div>
      <div class="tw-be-player black-side">
        <div class="tw-be-name" onclick="PlayerIntel.showCard('${b.blackId}','${tournamentId}')">${bk.name}</div>
        <div class="tw-be-rating">RTG: ${bk.rating||bk.selectedRating||0}</div>
        <div class="tw-be-score ${bs===1?'win':bs===0?'loss':bs===0.5?'draw':'unset'}">${bs !== null ? bs : '-'}</div>
      </div>
      <div class="tw-result-selector">
        <button class="tw-rs-btn ${raw==='1-0'||ws===1?'active-w':''}" data-bd="${b.boardNumber}" data-res="1-0">1-0</button>
        <button class="tw-rs-btn ${raw==='0.5-0.5'||(ws===0.5)?'active-d':''}" data-bd="${b.boardNumber}" data-res="0.5-0.5">½-½</button>
        <button class="tw-rs-btn ${raw==='0-1'||(ws===0&&bs===1)?'active-b':''}" data-bd="${b.boardNumber}" data-res="0-1">0-1</button>
        <button class="tw-rs-btn ${raw==='1-0F'?'active-ff':''}" data-bd="${b.boardNumber}" data-res="1-0F">1-0F</button>
        <button class="tw-rs-btn ${raw==='0-1F'?'active-ff':''}" data-bd="${b.boardNumber}" data-res="0-1F">0-1F</button>
        <button class="tw-rs-btn ${raw==='0-0F'?'active-ff':''}" data-bd="${b.boardNumber}" data-res="0-0F">0-0F</button>
      </div>
    </div>`;
  }));

  const overlay = document.createElement('div');
  overlay.className = 'tw-result-overlay';
  overlay.innerHTML = `<div class="tw-result-modal" style="background:var(--bg-panel);border:1px solid var(--accent-blue)">
    <div class="tw-modal-header">
      <div class="tw-modal-title">Result Entry — Match ${match.matchNumber||''}</div>
      <div class="tw-modal-teams">
        <div class="tw-modal-team"><span class="tw-modal-team-name">${home.name}</span></div>
        <div class="tw-modal-vs" id="tw-modal-score">${hBP} : ${aBP}</div>
        <div class="tw-modal-team"><span class="tw-modal-team-name">${away.name}</span></div>
      </div>
      <div class="tw-modal-meta">
        <span class="tw-modal-meta-pill">Round ${round}</span>
        <span class="tw-modal-meta-pill">Table ${match.matchNumber||'?'}</span>
        <span class="tw-modal-meta-pill">${match.boards.length} Boards</span>
      </div>
    </div>
    <div class="tw-modal-body">${boardsHtml.join('')}</div>
    <div class="tw-modal-footer">
      <button class="sc-btn-cancel" id="tw-modal-close">CLOSE</button>
    </div>
  </div>`;

  document.getElementById('modal-container').appendChild(overlay);

  overlay.querySelector('#tw-modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); } });

  // Result button handlers (preserved — no page reload)
  overlay.querySelectorAll('.tw-rs-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const bd = parseInt(btn.dataset.bd);
      const res = btn.dataset.res;
      const isForfeit = res.includes('F');
      const clean = res.replace('F','');
      const [wS, bS] = clean.split('-').map(parseFloat);

      const entry = btn.closest('.tw-board-entry');
      const allBtns = entry.querySelectorAll('.tw-rs-btn');
      allBtns.forEach(b => b.className = 'tw-rs-btn');
      if (wS === 1 && !isForfeit) btn.classList.add('active-w');
      else if (wS === 0.5) btn.classList.add('active-d');
      else if (bS === 1 && !isForfeit) btn.classList.add('active-b');
      else btn.classList.add('active-ff');

      const scores = entry.querySelectorAll('.tw-be-score');
      if (scores[0]) { scores[0].textContent = wS; scores[0].className = 'tw-be-score ' + (wS > bS ? 'win' : wS < bS ? 'loss' : 'draw'); }
      if (scores[1]) { scores[1].textContent = bS; scores[1].className = 'tw-be-score ' + (bS > wS ? 'win' : bS < wS ? 'loss' : 'draw'); }

      try {
        await Tournament.submitResultAndUpdate(tournamentId, round, bd, wS, bS, isForfeit, null, matchId);
        const freshRound = await DB.getRound(tournamentId, round);
        const freshMatch = (freshRound.teamMatches || freshRound.matches || []).find(m => (m.matchNumber || m.id) == matchId);
        if (freshMatch) {
          let newHBP = 0, newABP = 0, allDone = true;
          freshMatch.boards.forEach(b => {
            if (b.result) { newHBP += b.result.whiteScore || 0; newABP += b.result.blackScore || 0; }
            else allDone = false;
          });
          const scoreEl = document.getElementById('tw-modal-score');
          if (scoreEl) scoreEl.textContent = `${newHBP} : ${newABP}`;
          const card = document.getElementById('tw-card-' + matchId);
          if (card) {
            const sv = card.querySelectorAll('.tw-score-val');
            if (sv[0]) sv[0].textContent = newHBP;
            if (sv[1]) sv[1].textContent = newABP;
            const chip = card.querySelector('.sc-score-state');
            if (chip) {
              chip.className = 'sc-score-state ' + (allDone ? 'sealed' : 'live');
              chip.textContent = allDone ? 'SEALED' : 'IN PROGRESS';
            }
          }
          const freshT = await DB.getTournament(tournamentId);
          window.activeTournament = freshT;
        }
      } catch (err) {
        UI.showToast('Sync Error: ' + err.message, 'error');
      }
    });
  });
};

// Team History Modal (preserved exactly)
window._twTeamHistory = async function(tournamentId, teamId, teamName) {
  const allRoundsSnap = await db.collection('tournaments').doc(tournamentId).collection('rounds').get();
  const rounds = allRoundsSnap.docs.map(d => d.data()).sort((a,b) => a.roundNumber - b.roundNumber);
  const tSnap = await db.collection('tournaments').doc(tournamentId).collection('teams').get();
  const teams = {}; tSnap.docs.forEach(d => teams[d.id] = { id: d.id, ...d.data() });

  let mp = 0, bp = 0, wins = 0, draws = 0, losses = 0;
  const history = [];

  rounds.forEach(r => {
    const matches = r.teamMatches || r.matches || [];
    matches.forEach(m => {
      const isHome = m.homeTeamId === teamId;
      const isAway = m.awayTeamId === teamId;
      if (!isHome && !isAway) return;
      const oppId = isHome ? m.awayTeamId : m.homeTeamId;
      const oppName = (teams[oppId]?.name) || (isHome ? m.awayTeamName : m.homeTeamName) || 'Unknown';
      const myBP = isHome ? (m.team1BP ?? 0) : (m.team2BP ?? 0);
      const oppBP = isHome ? (m.team2BP ?? 0) : (m.team1BP ?? 0);
      const myMP = isHome ? (m.homeMP ?? 0) : (m.awayMP ?? 0);
      bp += myBP; mp += myMP;
      if (myMP === 2) wins++; else if (myMP === 1) draws++; else if (myMP === 0 && m.isResolved) losses++;
      history.push({ rd: r.roundNumber, opp: oppName, myBP, oppBP, myMP, resolved: m.isResolved });
    });
  });

  const overlay = document.createElement('div');
  overlay.className = 'tw-result-overlay';
  overlay.innerHTML = `<div class="tw-history-modal" style="background:var(--bg-panel);border:1px solid var(--border-subtle)">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem">
      <div><div class="tw-hist-title">${teamName}</div><div class="tw-hist-sub">Tournament History</div></div>
      <button class="sc-btn-cancel" style="padding:4px 10px" onclick="this.closest('.tw-result-overlay').remove()">✕</button>
    </div>
    <div class="tw-hist-stats">
      <div class="tw-hist-stat"><div class="tw-hist-stat-val">${mp}</div><div class="tw-hist-stat-label">MP</div></div>
      <div class="tw-hist-stat"><div class="tw-hist-stat-val">${bp}</div><div class="tw-hist-stat-label">BP</div></div>
      <div class="tw-hist-stat"><div class="tw-hist-stat-val" style="color:var(--status-locked)">${wins}W</div><div class="tw-hist-stat-label">${draws}D ${losses}L</div></div>
    </div>
    <div style="border:1px solid var(--border-subtle);border-radius:4px;overflow:hidden">
      ${history.length === 0 ? '<div style="padding:1.5rem;text-align:center;color:var(--text-muted)">No matches yet</div>' : history.map(h => {
        const cls = h.myMP === 2 ? 'win' : h.myMP === 1 ? 'draw' : 'loss';
        return `<div class="tw-hist-round">
          <span class="tw-hist-rd-num">R${h.rd}</span>
          <span class="tw-hist-opp">vs ${h.opp}</span>
          <span class="tw-hist-score ${cls}">${h.myBP} - ${h.oppBP}</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  document.getElementById('modal-container').appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
};
