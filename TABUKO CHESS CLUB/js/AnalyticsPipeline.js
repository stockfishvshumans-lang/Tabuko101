/**
 * AnalyticsPipeline.js — Incremental Aggregation Streaming Metrics Engine
 * Day 257 & 282 & 295: Real-time performance rating Rp tracker, tactical efficiency,
 * and momentum trend analysis without full-table rescans.
 *
 * @version 1.0.0 — Day 257/282/295 Sprint
 */
const AnalyticsPipeline = (() => {
  'use strict';

  // Incremental accumulator cache per player
  const _playerAccumulators = new Map();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // INCREMENTAL PERFORMANCE AGGREGATORS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function getOrCreateAccumulator(playerId, initialRating = 1200) {
    if (!_playerAccumulators.has(playerId)) {
      _playerAccumulators.set(playerId, {
        playerId,
        totalGames: 0,
        totalPoints: 0,
        totalOpponentRating: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        blackGames: 0,
        whiteGames: 0,
        currentStreak: 0,
        bestStreak: 0,
        performanceHistory: [],
        rpHistory: [],
        baseRating: initialRating,
        lastUpdated: 0
      });
    }
    return _playerAccumulators.get(playerId);
  }

  /**
   * ingestMatchResult: Incrementally update a player's metrics.
   * Call this after each match result commits — no full-table rescan needed.
   */
  function ingestMatchResult(playerId, opponentRating, playerPoints, color, roundNumber) {
    const acc = getOrCreateAccumulator(playerId);
    const oppRtg = Number(opponentRating || 1200);
    const pts = Number(playerPoints || 0);

    acc.totalGames++;
    // Day 215: Strict single-decimal formatting prevents 0.5+0.5 drift
    acc.totalPoints    = parseFloat((acc.totalPoints    + pts).toFixed(1));
    acc.totalOpponentRating = parseFloat((acc.totalOpponentRating + oppRtg).toFixed(1));

    if (pts === 1) {
      acc.wins++;
      acc.currentStreak = Math.max(0, acc.currentStreak) + 1;
    } else if (pts === 0.5) {
      acc.draws++;
      acc.currentStreak = 0;
    } else {
      acc.losses++;
      acc.currentStreak = Math.min(0, acc.currentStreak) - 1;
    }

    acc.bestStreak = Math.max(acc.bestStreak, acc.currentStreak);

    if (color === 'black' || color === 'Black') acc.blackGames++;
    else acc.whiteGames++;

    // Compute live Rp — Day 215: toFixed(1) on stored round points too
    const liveRp = computePerformanceRatingFromAcc(acc);
    acc.rpHistory.push({ round: roundNumber, rp: liveRp, points: acc.totalPoints });
    acc.performanceHistory.push({
      round: roundNumber,
      points: parseFloat(pts.toFixed(1)),
      oppRating: parseFloat(oppRtg.toFixed(1))
    });
    acc.lastUpdated = Date.now();

    // Publish to event bus
    if (window.DistributedEventBus) {
      window.DistributedEventBus.publish('ANALYTICS_UPDATE', {
        playerId,
        liveRp,
        totalPoints: acc.totalPoints,
        round: roundNumber
      });
    }

    return liveRp;
  }

  /**
   * computePerformanceRatingFromAcc: FIDE Rp from accumulated stats.
   */
  function computePerformanceRatingFromAcc(acc) {
    if (acc.totalGames === 0) return acc.baseRating;

    const scorePct = acc.totalPoints / acc.totalGames;
    const avgOppRating = acc.totalOpponentRating / acc.totalGames;

    // FIDE dp Coefficient Interpolation
    let dp = 0;
    if (scorePct >= 1) dp = 800;
    else if (scorePct <= 0) dp = -800;
    else dp = Math.round(-400 * Math.log10((1 / scorePct) - 1));

    return Math.round(avgOppRating + dp);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TACTICAL EFFICIENCY CALCULATORS (Day 270/295)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function computeTacticalEfficiencyMetrics(playerId) {
    const acc = _playerAccumulators.get(playerId);
    if (!acc || acc.totalGames === 0) {
      return { winRate: 0, drawRate: 0, lossRate: 0, consistency: 50, aggression: 50, momentum: 0 };
    }

    const winRate = Math.round((acc.wins / acc.totalGames) * 100);
    const drawRate = Math.round((acc.draws / acc.totalGames) * 100);
    const lossRate = Math.round((acc.losses / acc.totalGames) * 100);

    // Consistency: Low variance in results = high consistency
    const expectedPts = acc.totalGames * 0.5;
    const variance = Math.abs(acc.totalPoints - expectedPts) / acc.totalGames;
    const consistency = Math.max(0, Math.min(100, Math.round((1 - variance) * 100)));

    // Aggression: Win-heavy scoring against higher-rated opponents
    const avgOpp = acc.totalOpponentRating / acc.totalGames;
    const ratingDiff = avgOpp - acc.baseRating;
    const aggressionBonus = ratingDiff > 0 ? Math.min(20, ratingDiff / 20) : 0;
    const aggression = Math.min(100, Math.round(winRate + aggressionBonus));

    // Momentum: Recent trend direction
    const recentGames = acc.performanceHistory.slice(-5);
    const momentum = recentGames.reduce((sum, g) => sum + (g.points - 0.5), 0);

    return { winRate, drawRate, lossRate, consistency, aggression, momentum: Math.round(momentum * 20) };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BATCH INITIALIZATION FROM EXISTING DATA
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function initializeFromPlayerData(players, allMatches) {
    _playerAccumulators.clear();

    (players || []).forEach(p => {
      getOrCreateAccumulator(p.id, p.selectedRating || p.rating || 1200);
    });

    // Sort matches by round
    const sorted = [...(allMatches || [])].sort((a, b) => (a.round || 0) - (b.round || 0));

    sorted.forEach(m => {
      if (!m.result) return;
      const result = typeof m.result === 'object' ? m.result : null;
      if (!result) return;

      if (m.whiteId) {
        ingestMatchResult(m.whiteId, getPlayerRating(m.blackId, players), result.whiteScore, 'White', m.round || 0);
      }
      if (m.blackId) {
        ingestMatchResult(m.blackId, getPlayerRating(m.whiteId, players), result.blackScore, 'Black', m.round || 0);
      }
    });
  }

  function getPlayerRating(id, players) {
    const p = (players || []).find(x => x.id === id);
    return p?.selectedRating || p?.rating || 1200;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PLAYER PERFORMANCE METRICS CARD UI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function renderPerformanceCard(playerId, containerId) {
    const root = document.getElementById(containerId);
    if (!root) return;

    const acc = _playerAccumulators.get(playerId);
    if (!acc || acc.totalGames === 0) {
      root.innerHTML = '<div style="color:#475569;font-size:0.7rem;text-align:center;padding:1rem;">No match data available</div>';
      return;
    }

    const liveRp = computePerformanceRatingFromAcc(acc);
    const eff = computeTacticalEfficiencyMetrics(playerId);
    const rpTrend = acc.rpHistory.map(r => r.rp);
    const maxRp = Math.max(...rpTrend, liveRp);
    const minRp = Math.min(...rpTrend, liveRp);
    const rpRange = Math.max(maxRp - minRp, 1);

    // Mini sparkline chart
    const sparkPoints = rpTrend.map((rp, i) => {
      const x = (i / Math.max(rpTrend.length - 1, 1)) * 150;
      const y = 30 - ((rp - minRp) / rpRange) * 28;
      return `${x},${y}`;
    }).join(' ');

    root.innerHTML = `
      <div style="background:rgba(15,23,42,0.95);border:1px solid rgba(16,185,129,0.12);border-radius:10px;padding:0.75rem;font-family:'JetBrains Mono',monospace;color:#e2e8f0;font-size:0.65rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
          <span style="font-weight:900;font-size:0.55rem;text-transform:uppercase;letter-spacing:1.5px;color:#10b981;">📊 Live Analytics</span>
          <span style="font-size:1rem;font-weight:900;color:#10b981;">${liveRp}</span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:0.5rem;">
          <div style="text-align:center;background:rgba(0,0,0,0.2);border-radius:4px;padding:3px;">
            <div style="font-weight:900;color:#10b981;">${acc.wins}</div>
            <div style="font-size:0.4rem;color:#64748b;">WIN</div>
          </div>
          <div style="text-align:center;background:rgba(0,0,0,0.2);border-radius:4px;padding:3px;">
            <div style="font-weight:900;color:#f59e0b;">${acc.draws}</div>
            <div style="font-size:0.4rem;color:#64748b;">DRAW</div>
          </div>
          <div style="text-align:center;background:rgba(0,0,0,0.2);border-radius:4px;padding:3px;">
            <div style="font-weight:900;color:#ef4444;">${acc.losses}</div>
            <div style="font-size:0.4rem;color:#64748b;">LOSS</div>
          </div>
          <div style="text-align:center;background:rgba(0,0,0,0.2);border-radius:4px;padding:3px;">
            <div style="font-weight:900;color:#a855f7;">${eff.momentum > 0 ? '+' : ''}${eff.momentum}</div>
            <div style="font-size:0.4rem;color:#64748b;">TREND</div>
          </div>
        </div>

        ${rpTrend.length > 1 ? `
        <svg viewBox="0 0 150 32" style="width:100%;height:32px;margin-bottom:4px;">
          <polyline points="${sparkPoints}" fill="none" stroke="#10b981" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>` : ''}

        <div style="display:flex;gap:6px;">
          <div style="flex:1;text-align:center;font-size:0.5rem;">
            <div style="color:#64748b;">AGG</div>
            <div style="font-weight:900;color:#f59e0b;">${eff.aggression}%</div>
          </div>
          <div style="flex:1;text-align:center;font-size:0.5rem;">
            <div style="color:#64748b;">CON</div>
            <div style="font-weight:900;color:#3b82f6;">${eff.consistency}%</div>
          </div>
          <div style="flex:1;text-align:center;font-size:0.5rem;">
            <div style="color:#64748b;">W/R</div>
            <div style="font-weight:900;color:#10b981;">${eff.winRate}%</div>
          </div>
        </div>
      </div>
    `;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLIC API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    ingestMatchResult,
    computePerformanceRatingFromAcc,
    computeTacticalEfficiencyMetrics,
    initializeFromPlayerData,
    renderPerformanceCard,
    getAccumulator: (id) => _playerAccumulators.get(id) || null,
    getAllAccumulators: () => [..._playerAccumulators.entries()],
    clearCache: () => _playerAccumulators.clear()
  };
})();

window.AnalyticsPipeline = AnalyticsPipeline;
