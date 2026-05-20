/**
 * rating.js — Multi-Rating System for Tabuko Chess Club
 *
 * Supports FIDE, NCFP, Club ratings.
 * Rating-agnostic: tournament config determines which rating type is used.
 * Handles unrated players with configurable strategies.
 */

const RatingSystem = (() => {

  /**
   * Select the effective rating for a player based on tournament config.
   *
   * @param {Object} player - Player object with ratings map
   * @param {Object} config - Tournament config { ratingType, unratedHandling, defaultRating }
   * @param {Array} allPlayers - All players in tournament (for "lowest" strategy)
   * @returns {number} Resolved numeric rating
   */
  function selectPlayerRating(player, config, allPlayers = []) {
    const { ratingType, unratedHandling, defaultRating } = config;

    // Check if player has the selected rating type
    const ratingValue = player.ratings ? player.ratings[ratingType] : null;

    if (ratingValue !== null && ratingValue !== undefined && !isNaN(ratingValue)) {
      return ratingValue;
    }

    // Player is unrated for this type — apply fallback
    return handleUnrated(player, config, allPlayers);
  }

  /**
   * Apply unrated handling strategy.
   */
  function handleUnrated(player, config, allPlayers) {
    const { unratedHandling, defaultRating, ratingType } = config;

    switch (unratedHandling) {
      case 'lowest': {
        // Find lowest rated player in the pool
        let lowest = Infinity;
        for (const p of allPlayers) {
          const r = p.ratings ? p.ratings[ratingType] : null;
          if (r !== null && r !== undefined && !isNaN(r) && r < lowest) {
            lowest = r;
          }
        }
        // Assign 100 below the lowest, or default if no rated players
        return lowest === Infinity ? (defaultRating || 1000) : Math.max(lowest - 100, 100);
      }

      case 'fixed':
        return defaultRating || 1200;

      case 'estimated':
        // Use player's estimatedRating if set by admin, else default
        return player.estimatedRating || defaultRating || 1200;

      default:
        return defaultRating || 1200;
    }
  }

  /**
   * Assign resolved ratings to all players in a tournament.
   * Ensures every player has a selectedRating before pairing begins.
   */
  function assignInitialRatings(players, config) {
    const { ratingType, unratedHandling, defaultRating } = config;

    return players.map(player => {
      const ratingValue = player.ratings ? player.ratings[ratingType] : null;
      const isUnrated = ratingValue === null || ratingValue === undefined || isNaN(ratingValue);

      let selectedRating;
      if (!isUnrated) {
        selectedRating = ratingValue;
      } else {
        // Strict Unrated Handling
        switch (unratedHandling) {
          case 'lowest':
            const lowest = Math.min(...players.filter(p => p.ratings && p.ratings[ratingType]).map(p => p.ratings[ratingType]), defaultRating || 1000);
            selectedRating = Math.max(lowest - 100, 100);
            break;
          case 'fixed':
            selectedRating = defaultRating || 1200;
            break;
          case 'estimated':
            selectedRating = player.estimatedRating || defaultRating || 1200;
            break;
          default:
            selectedRating = defaultRating || 1200;
        }
      }

      return {
        ...player,
        selectedRating,
        isUnrated,
        score: 0,
        opponents: [],
        colors: [],
        results: [],
        roundScores: []
      };
    });
  }

  /**
   * Sort players by selectedRating descending.
   *
   * @param {Array} players - Players with selectedRating
   * @returns {Array} Sorted copy
   */
  function sortPlayersByRating(players) {
    return [...players].sort((a, b) => b.selectedRating - a.selectedRating);
  }

  /**
   * Compute team rating based on tournament config.
   *
   * @param {Object} team - Team with players[] array
   * @param {Object} config - Tournament config with teamRatingMethod
   * @returns {number} Computed team rating
   */
  function computeTeamRating(team, config) {
    const method = config.teamRatingMethod || 'average';
    const ratings = team.players.map(p => p.selectedRating || 0);
    const total = ratings.reduce((sum, r) => sum + r, 0);

    if (method === 'total') {
      return total;
    }

    // Default: average
    return ratings.length > 0 ? Math.round(total / ratings.length) : 0;
  }

  /**
   * Validate that all players have a resolved numeric rating.
   *
   * @param {Array} players - Players to validate
   * @returns {{ valid: boolean, errors: string[] }}
   */
  function validateRatings(players) {
    const errors = [];
    for (const p of players) {
      if (p.selectedRating === undefined || p.selectedRating === null || isNaN(p.selectedRating)) {
        errors.push(`Player "${p.name}" (${p.id}) has no resolved rating.`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Calculate Elo Rating Change.
   * Standard FIDE Formula: Expected = 1 / (1 + 10^((opp - player) / 400))
   * New Rating = Old Rating + K * (Score - Expected)
   * 
   * @param {number} playerRating - Current rating of the player
   * @param {number} opponentRating - Current rating of the opponent
   * @param {number} actualScore - 1 for Win, 0.5 for Draw, 0 for Loss
   * @param {number} kFactor - The K-factor (usually 20 or 40)
   * @returns {number} The change in rating (can be negative)
   */
  function calculateEloChange(playerRating, opponentRating, actualScore, kFactor = 20) {
    let ratingDiff = opponentRating - playerRating;

    // FIDE 400-Point Rule: Cap the maximum difference
    if (ratingDiff > 400) ratingDiff = 400;
    if (ratingDiff < -400) ratingDiff = -400;

    const expected = 1 / (1 + Math.pow(10, ratingDiff / 400));
    return Math.round(kFactor * (actualScore - expected));
  }

  /**
   * Determine K-Factor based on player experience.
   * Provisional (< 30 games): 40
   * Established (>= 30 games): 20
   * 
   * @param {Object} player - The player object
   * @returns {number} K-factor
   */
  function getKFactor(player) {
    const games = player.tournamentsPlayed || 0;
    return games < 30 ? 40 : 20;
  }

  return {
    selectPlayerRating,
    assignInitialRatings,
    sortPlayersByRating,
    computeTeamRating,
    validateRatings,
    calculateEloChange,
    getKFactor
  };

})();

// Global Export
window.RatingSystem = RatingSystem;
