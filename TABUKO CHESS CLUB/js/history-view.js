/**
 * history-view.js — Monolithic Enterprise Implementation
 * SaaS-Grade Analytics & Versus-Scoreboard Engine
 */
const HistoryUI = (() => {
  let masterHistory = [];
  let currentMember = null;
  let activeFilters = { color: 'all', result: 'all' };

  // ── 1. CSS INJECTION (Enterprise Dark Mode) ──
  const injectStyles = () => {
    if (document.getElementById('history-premium-styles')) return;
    const style = document.createElement('style');
    style.id = 'history-premium-styles';
    style.innerHTML = `
      .hq-dash { font-family: 'Inter', system-ui, sans-serif; color: #f8fafc; padding: 20px; box-sizing: border-box; }
      .hq-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid #334155; padding-bottom: 20px; margin-bottom: 25px; }
      .hq-name { font-size: 2.2rem; font-weight: 900; margin: 0; background: linear-gradient(90deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
      .hq-meta { color: #94a3b8; font-size: 0.95rem; font-weight: 500; margin-top: 5px; }
      
      /* Analytics Grid */
      .hq-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
      .hq-stat-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; }
      .hq-stat-label { color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; font-weight: 700; }
      .hq-stat-value { font-size: 1.8rem; font-weight: 800; color: #fff; }
      
      /* Recent Form Sparkline */
      .hq-form-track { display: flex; gap: 4px; margin-top: 10px; }
      .form-box { width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 800; color: #fff; }
      .fb-win { background: #10b981; } .fb-loss { background: #ef4444; } .fb-draw { background: #64748b; } .fb-pending { background: #334155; }
      
      /* Versus Scoreboard Table */
      .hq-table-container { background: #1e293b; border-radius: 10px; border: 1px solid #334155; overflow-x: auto; max-height: 60vh; overflow-y: auto; }
      .hq-table { width: 100%; border-collapse: collapse; text-align: left; }
      .hq-table th { padding: 15px; font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; border-bottom: 1px solid #334155; background: #0f172a; position: sticky; top: 0; z-index: 10; }
      .hq-table td { padding: 15px; font-size: 0.95rem; border-bottom: 1px solid #334155; }
      
      . scoreboard-row { display: grid; grid-template-columns: 1fr 100px 1fr; align-items: center; gap: 10px; }
      .side-box { font-weight: 600; display: flex; align-items: center; gap: 8px; }
      .side-white { justify-content: flex-end; text-align: right; }
      .side-black { justify-content: flex-start; text-align: left; }
      .res-pill { background: #0f172a; padding: 4px 10px; border-radius: 6px; font-weight: 900; border: 1px solid #334155; text-align: center; }
      
      .owner-mark { color: var(--accent-primary, #81b64c); }
      .opponent-mark { color: #94a3b8; }
      .plus { color: #10b981; } .minus { color: #ef4444; }
    `;
    document.head.appendChild(style);
  };

  const calculateStats = (history) => {
    if (!history || history.length === 0) return { totalGames: 0, winRate: 0, topRival: 'None', recentForm: [] };

    let wins = 0, draws = 0, losses = 0;
    let opponents = {};

    history.forEach(m => {
      if (m.status === 'win') wins++;
      else if (m.status === 'loss') losses++;
      else if (m.status === 'draw') draws++;

      if (m.opponentName && m.opponentName !== 'Unknown') {
        opponents[m.opponentName] = (opponents[m.opponentName] || 0) + 1;
      }
    });

    const totalResolved = wins + draws + losses;
    const winRate = totalResolved > 0 ? Math.round(((wins + (draws * 0.5)) / totalResolved) * 100) : 0;

    let topRival = 'None';
    let maxGames = 0;
    for (const [name, count] of Object.entries(opponents)) {
      if (count > maxGames) { maxGames = count; topRival = name; }
    }

    const recentForm = history.slice(0, 5).map(m => m.status);
    return { totalGames: history.length, winRate, topRival, recentForm };
  };

  const renderTableRows = () => {
    const tbody = document.getElementById('hq-tbody');
    if (!tbody) return;

    const filtered = masterHistory.filter(m => {
      const matchColor = activeFilters.color === 'all' || m.color === activeFilters.color;
      const matchRes = activeFilters.result === 'all' || m.status === activeFilters.result;
      return matchColor && matchRes;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 40px; color: #64748b;">No matching match records found.</td></tr>`;
      return;
    }

    const rowsHtml = filtered.map(m => {
      const isOwnerWhite = m.color === 'white';
      const whiteName = isOwnerWhite ? currentMember.name : m.opponentName;
      const blackName = isOwnerWhite ? m.opponentName : currentMember.name;
      const date = m.timestamp?.toDate ? m.timestamp.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'Archive';

      return `
        <tr>
          <td>
            <div style="font-weight:700; color:#fff;">${m.tournamentName}</div>
            <div style="font-size:0.75rem; color:#64748b;">${date} • Rd ${m.round}</div>
          </td>
          <td>
            <div class="scoreboard-row" style="display: grid; grid-template-columns: 1fr 100px 1fr; align-items: center; gap: 15px;">
              <div class="side-box side-white ${isOwnerWhite ? 'owner-mark' : 'opponent-mark'}" style="justify-content: flex-end; text-align: right;">
                <span>${whiteName}</span> ⚪
              </div>
              <div class="res-pill">${m.result}</div>
              <div class="side-box side-black ${!isOwnerWhite ? 'owner-mark' : 'opponent-mark'}" style="justify-content: flex-start; text-align: left;">
                ⚫ <span>${blackName}</span>
              </div>
            </div>
          </td>
          <td style="text-align:right; font-weight:900; font-family: monospace;" class="${m.ratingChange > 0 ? 'plus' : (m.ratingChange < 0 ? 'minus' : '')}">
            ${m.ratingChange > 0 ? '+' + m.ratingChange : (m.ratingChange || '-')}
          </td>
        </tr>
      `;
    }).join('');

    morphdom(tbody, `<tbody id="hq-tbody">${rowsHtml}</tbody>`);
  };

  function setContext(member, history) {
    currentMember = member;
    masterHistory = history;
  }

  async function renderDashboard(containerId) {
    injectStyles();
    const container = document.getElementById(containerId);
    if (!container) return;

    // Fetch deep career stats from the new DB compiler
    let careerStats = { totalGames: 0, winRatio: 0, ratingHistory: [] };
    if (window.DB && typeof DB.compileMemberCareerHistory === 'function') {
      try {
        careerStats = await DB.compileMemberCareerHistory(currentMember.id);
      } catch (err) {
        console.error("Failed to compile career history:", err);
      }
    }

    const stats = calculateStats(masterHistory);
    const formHtml = stats.recentForm.length > 0
      ? stats.recentForm.map(s => `<div class="form-box fb-${s}">${s.charAt(0).toUpperCase()}</div>`).join('')
      : '<span style="color:#64748b; font-size:0.8rem;">No recent games</span>';

    container.innerHTML = `
      <div class="hq-dash">
        <div class="hq-header">
          <div>
            <h1 class="hq-name">${currentMember.name}</h1>
            <div class="hq-meta">Career Statistics • ${currentMember.ratings?.club || 1200} Elo</div>
          </div>
          <div>
            <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; font-weight:800; text-align:right;">Recent Form</div>
            <div class="hq-form-track">${formHtml}</div>
          </div>
        </div>

        <div class="hq-stats-grid">
          <div class="hq-stat-card"><div class="hq-stat-label">Lifetime Games</div><div class="hq-stat-value">${careerStats.totalGames}</div></div>
          <div class="hq-stat-card"><div class="hq-stat-label">Career Win Rate</div><div class="hq-stat-value" style="color:#10b981;">${careerStats.winRatio}%</div></div>
          <div class="hq-stat-card"><div class="hq-stat-label">Top Rival</div><div class="hq-stat-value" style="font-size: 1.2rem; margin-top: auto;">${stats.topRival}</div></div>
        </div>

        <div style="background:#1e293b; border-radius:10px; padding:20px; border:1px solid #334155; margin-bottom:30px;">
          <canvas id="ratingTrendChart" height="80"></canvas>
        </div>

        <div class="hq-table-container">
          <table class="hq-table">
            <thead>
              <tr>
                <th style="text-align:left;">Tournament</th>
                <th style="text-align:center;">Match Scoreboard</th>
                <th style="text-align:right;">Elo ±</th>
              </tr>
            </thead>
            <tbody id="hq-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
    renderTableRows();

    // Render Chart.js
    if (careerStats.ratingHistory && careerStats.ratingHistory.length > 0 && typeof Chart !== 'undefined') {
      const ctx = document.getElementById('ratingTrendChart').getContext('2d');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: careerStats.ratingHistory.map(r => r.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })),
          datasets: [{
            label: 'Elo Rating',
            data: careerStats.ratingHistory.map(r => r.rating),
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            borderWidth: 3,
            tension: 0.3,
            fill: true,
            pointBackgroundColor: '#1e293b',
            pointBorderColor: '#38bdf8',
            pointRadius: 4
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
            y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } }
          }
        }
      });
    }
  }

  return { setContext, renderDashboard };
})();

window.HistoryUI = HistoryUI;