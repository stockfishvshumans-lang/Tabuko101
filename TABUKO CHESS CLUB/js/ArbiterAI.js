/**
 * ArbiterAI.js — Statistical Anomaly Detection & FIDE Fraud Intelligence Engine
 * Day 263: Automated scoring pattern analysis for suspicious result detection.
 *
 * Architecture:
 *   Match history → statistical modeling → probability vector analysis
 *   → anomaly flagging → alert card generation
 *
 * @version 1.0.0 — Day 263 Sprint
 */
const ArbiterAI = (() => {
  'use strict';

  const ANOMALY_THRESHOLDS = {
    UNEXPECTED_WIN_RATING_DIFF: 400,       // Flag wins where rating diff > 400
    CONSECUTIVE_SHORT_DRAWS: 3,             // Flag 3+ consecutive draws
    PERFECT_SCORE_ROUNDS: 5,               // Flag perfect scores past 5 rounds
    SCORING_CONSISTENCY_LOW: 0.15,          // Flag extremely inconsistent scoring
    RAPID_RESULT_SUBMISSION_MS: 5000       // Results submitted < 5 seconds apart
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SCORING ANOMALY EVALUATOR
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function evaluateScoringAnomalies(matches, players) {
    const anomalies = [];

    if (!Array.isArray(matches) || !Array.isArray(players)) return anomalies;

    const playerMap = new Map();
    players.forEach(p => playerMap.set(p.id, p));

    // Group matches by player
    const playerMatches = new Map();
    matches.forEach(m => {
      if (!m.result) return;
      const result = typeof m.result === 'object' ? m.result : null;
      if (!result) return;

      [
        { playerId: m.whiteId, score: parseFloat(result.whiteScore || 0), color: 'White', oppId: m.blackId },
        { playerId: m.blackId, score: parseFloat(result.blackScore || 0), color: 'Black', oppId: m.whiteId }
      ].forEach(entry => {
        if (!entry.playerId) return;
        if (!playerMatches.has(entry.playerId)) playerMatches.set(entry.playerId, []);
        playerMatches.get(entry.playerId).push({
          ...entry,
          round: m.round || m.roundNumber,
          board: m.board,
          timestamp: result.timestamp || m.timestamp || 0
        });
      });
    });

    // Analyze each player's match history
    for (const [playerId, pMatches] of playerMatches) {
      const player = playerMap.get(playerId);
      const playerRating = player?.selectedRating || player?.rating || 1200;
      const playerName = player?.name || playerId;

      // Sort by round
      pMatches.sort((a, b) => (a.round || 0) - (b.round || 0));

      // 1. Check for unexpected upsets
      pMatches.forEach(pm => {
        const opponent = playerMap.get(pm.oppId);
        const oppRating = opponent?.selectedRating || opponent?.rating || 1200;
        const ratingDiff = oppRating - playerRating;

        if (pm.score === 1 && ratingDiff > ANOMALY_THRESHOLDS.UNEXPECTED_WIN_RATING_DIFF) {
          anomalies.push({
            type: 'UNEXPECTED_UPSET',
            severity: 'HIGH',
            playerId,
            playerName,
            opponentId: pm.oppId,
            opponentName: opponent?.name || pm.oppId,
            round: pm.round,
            details: `${playerName} (${playerRating}) defeated ${opponent?.name || 'Unknown'} (${oppRating}) — rating difference: ${ratingDiff}`,
            probability: Math.max(0.05, 1 - (ratingDiff / 800)),
            timestamp: pm.timestamp
          });
        }
      });

      // 2. Check for consecutive draws
      let consecutiveDraws = 0;
      let maxConsecutiveDraws = 0;

      pMatches.forEach(pm => {
        if (pm.score === 0.5) {
          consecutiveDraws++;
          maxConsecutiveDraws = Math.max(maxConsecutiveDraws, consecutiveDraws);
        } else {
          consecutiveDraws = 0;
        }
      });

      if (maxConsecutiveDraws >= ANOMALY_THRESHOLDS.CONSECUTIVE_SHORT_DRAWS) {
        anomalies.push({
          type: 'CONSECUTIVE_DRAWS',
          severity: 'MEDIUM',
          playerId,
          playerName,
          details: `${playerName} has ${maxConsecutiveDraws} consecutive draws — possible pre-arranged results`,
          consecutiveCount: maxConsecutiveDraws,
          probability: 0.3 + (maxConsecutiveDraws * 0.1),
          timestamp: Date.now()
        });
      }

      // 3. Check for perfect scores past threshold
      const totalPoints = pMatches.reduce((sum, pm) => sum + pm.score, 0);
      if (pMatches.length >= ANOMALY_THRESHOLDS.PERFECT_SCORE_ROUNDS && totalPoints === pMatches.length) {
        anomalies.push({
          type: 'PERFECT_SCORE',
          severity: 'LOW',
          playerId,
          playerName,
          details: `${playerName} has a perfect score (${totalPoints}/${pMatches.length}) — verify game integrity`,
          probability: 0.15,
          timestamp: Date.now()
        });
      }

      // 4. Rapid result submissions
      for (let i = 1; i < pMatches.length; i++) {
        if (pMatches[i].timestamp && pMatches[i - 1].timestamp) {
          const timeDiff = pMatches[i].timestamp - pMatches[i - 1].timestamp;
          if (timeDiff > 0 && timeDiff < ANOMALY_THRESHOLDS.RAPID_RESULT_SUBMISSION_MS) {
            anomalies.push({
              type: 'RAPID_SUBMISSION',
              severity: 'HIGH',
              playerId,
              playerName,
              details: `Results for rounds ${pMatches[i - 1].round} and ${pMatches[i].round} submitted only ${timeDiff}ms apart`,
              timeDiffMs: timeDiff,
              probability: 0.6,
              timestamp: pMatches[i].timestamp
            });
          }
        }
      }
    }

    // Sort by severity
    const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    anomalies.sort((a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2));

    return anomalies;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RESULT PATTERN ANALYZER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function analyzeResultPatterns(matches) {
    const stats = {
      totalMatches: matches.length,
      whiteWins: 0,
      blackWins: 0,
      draws: 0,
      decisiveGames: 0,
      averageRatingDiff: 0
    };

    let totalRatingDiff = 0;

    matches.forEach(m => {
      if (!m.result) return;
      const result = typeof m.result === 'object' ? m.result : null;
      if (!result) return;

      const ws = parseFloat(result.whiteScore || 0);
      const bs = parseFloat(result.blackScore || 0);

      if (ws === 1) { stats.whiteWins++; stats.decisiveGames++; }
      else if (bs === 1) { stats.blackWins++; stats.decisiveGames++; }
      else if (ws === 0.5) stats.draws++;

      const wRating = m.whiteRating || 1200;
      const bRating = m.blackRating || 1200;
      totalRatingDiff += Math.abs(wRating - bRating);
    });

    if (matches.length > 0) {
      stats.averageRatingDiff = Math.round(totalRatingDiff / matches.length);
    }

    stats.drawPercentage = matches.length > 0 ? Math.round((stats.draws / matches.length) * 100) : 0;
    stats.whiteAdvantage = matches.length > 0 ? Math.round(((stats.whiteWins - stats.blackWins) / matches.length) * 100) : 0;

    return stats;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // AI ALERT FEED UI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function renderAiAlertFeed(anomalies, containerId = 'ai-alert-feed-root') {
    const root = document.getElementById(containerId);
    if (!root) return;

    if (!anomalies || anomalies.length === 0) {
      root.innerHTML = `
        <div style="background:rgba(16,185,129,0.05);border:1px solid rgba(16,185,129,0.15);border-radius:10px;padding:1rem;text-align:center;font-family:'Inter',sans-serif;">
          <div style="font-size:1.5rem;margin-bottom:0.25rem;">✅</div>
          <div style="font-size:0.75rem;font-weight:700;color:#10b981;">No Anomalies Detected</div>
          <div style="font-size:0.6rem;color:#475569;">All scoring patterns are within expected ranges.</div>
        </div>
      `;
      return;
    }

    const severityColors = { HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#3b82f6' };
    const severityIcons = { HIGH: '🚨', MEDIUM: '⚠️', LOW: 'ℹ️' };

    root.innerHTML = `
      <div style="font-family:'Inter',sans-serif;">
        <div style="font-weight:900;font-size:0.65rem;text-transform:uppercase;letter-spacing:2px;color:#ef4444;margin-bottom:0.5rem;">
          🤖 AI Anomaly Alerts (${anomalies.length})
        </div>
        ${anomalies.slice(0, 10).map(a => `
          <div style="background:rgba(${a.severity === 'HIGH' ? '239,68,68' : a.severity === 'MEDIUM' ? '245,158,11' : '59,130,246'},0.08);border:1px solid rgba(${a.severity === 'HIGH' ? '239,68,68' : a.severity === 'MEDIUM' ? '245,158,11' : '59,130,246'},0.2);border-radius:8px;padding:0.6rem;margin-bottom:0.4rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
              <span style="font-weight:900;font-size:0.65rem;color:${severityColors[a.severity]};">
                ${severityIcons[a.severity]} ${a.type.replace(/_/g, ' ')}
              </span>
              <span style="font-size:0.5rem;color:#475569;font-weight:700;">R${a.round || '?'}</span>
            </div>
            <div style="font-size:0.6rem;color:#94a3b8;line-height:1.4;">${a.details}</div>
            <div style="display:flex;justify-content:space-between;margin-top:0.25rem;">
              <span style="font-size:0.5rem;color:#475569;">Confidence: ${Math.round((a.probability || 0) * 100)}%</span>
              <span style="font-size:0.5rem;color:#64748b;">Player: ${a.playerName || 'Unknown'}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLIC API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    evaluateScoringAnomalies,
    analyzeResultPatterns,
    renderAiAlertFeed,
    ANOMALY_THRESHOLDS
  };
})();

window.ArbiterAI = ArbiterAI;
