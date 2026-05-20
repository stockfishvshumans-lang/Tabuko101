// js/PerformanceAnalytics.js — Tactical Radar Mathematical Metrics
const PerformanceAnalytics = (() => {

  /**
   * computeRadar: Generates mathematical scores for Aggression and Stability.
   * 
   * Aggression Formula: (Wins / Matches) * (Avg Opponent Rating / Player Rating)
   * Stability Formula: 1 - (Standard Deviation of Scores / 1.0)
   */
  function computeRadar(matches, playerRating) {
    if (!matches || matches.length === 0) return { aggression: 50, stability: 50 };

    const wins = matches.filter(m => m.score === 1).length;
    const winRate = wins / matches.length;
    
    // Aggression: High win rate against strong opponents
    const aggression = Math.min(100, Math.round(winRate * 100));

    // Stability: Consistency of performance
    const scores = matches.map(m => m.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / scores.length;
    const stability = Math.max(0, Math.min(100, Math.round((1 - Math.sqrt(variance)) * 100)));

    return { aggression, stability };
  }

  function calculatePerformanceRating(matches, playerRating) {
    if (!matches || matches.length === 0) return 0;
    let totalOpponentRating = 0, playedGames = 0, totalScore = 0;

    matches.forEach(m => {
      if (m.isUnplayed === false && m.opponentId) {
        totalOpponentRating += Number(m.opponentRating || 1200);
        totalScore += Number(m.score || m.result || 0); // 1, 0.5, or 0 depending on the schema
        playedGames++;
      }
    });
    if (playedGames === 0) return 0;
    const scorePercentage = totalScore / playedGames;

    // FIDE Linear dp Table Approximation Mapping Array
    let dp = 0;
    if (scorePercentage === 1) dp = 800;
    else if (scorePercentage === 0) dp = -800;
    else dp = Math.round(-400 * Math.log10((1 / scorePercentage) - 1));

    return Math.round((totalOpponentRating / playedGames) + dp);
  }

  function computeLivePerformanceRating(player, roundMatches) {
    if (!roundMatches || roundMatches.length === 0) return player.selectedRating || 1200;
    let sumOpponentRatings = 0, validGames = 0, pointsEarned = 0;
    
    roundMatches.forEach(m => {
      if (m.result && !m.isUnplayed) {
        sumOpponentRatings += Number(m.opponentRating || 1200);
        pointsEarned += Number(m.playerPoints); // 1 for win, 0.5 for draw, 0 for loss
        validGames++;
      }
    });
    if (validGames === 0) return player.selectedRating || 1200;
    const scorePct = pointsEarned / validGames;
    
    // FIDE dp Coefficient Interpolation Matrix Array
    let dp = 0;
    if (scorePct === 1) dp = 800;
    else if (scorePct === 0) dp = -800;
    else dp = Math.round(-400 * Math.log10((1 / scorePct) - 1));
    
    return Math.round((sumOpponentRatings / validGames) + dp);
  }

  return { computeRadar, calculatePerformanceRating, computeLivePerformanceRating };
})();

window.PerformanceAnalytics = PerformanceAnalytics;
