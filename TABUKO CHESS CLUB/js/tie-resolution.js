/**
 * tie-resolution.js — Final Tie Resolution System
 *
 * Handles ties that persist AFTER all standard tie-breaks are exhausted.
 * Aligned with FIDE regulations.
 *
 * Resolution chain:
 *  1. Direct Encounter (re-check, mini-table for 3+)
 *  2. Additional configurable tie-breaks (rating, black games, performance rating)
 *  3. Shared Placement (default fallback)
 *  4. Playoff (optional, requires manual result entry)
 *  5. Randomization (last resort, discouraged, must be explicitly enabled)
 */

const TieResolution = (() => {

  // 🛡️ REPAIR: Enforce strict multi-stage FIDE tie-break resolution sorting
  function executeMultiStageSort(p1, p2) {
    const p1Points = parseFloat(p1.points !== undefined ? p1.points : (p1.score || 0));
    const p2Points = parseFloat(p2.points !== undefined ? p2.points : (p2.score || 0));
    if (p1Points !== p2Points) return p2Points - p1Points;

    const de1 = p1.tieBreaks?.DE || p1.de || 0;
    const de2 = p2.tieBreaks?.DE || p2.de || 0;
    if (de1 !== de2) return de2 - de1;

    const bh1 = p1.tieBreaks?.Buchholz || p1.tieBreaks?.BH || p1.bh || 0;
    const bh2 = p2.tieBreaks?.Buchholz || p2.tieBreaks?.BH || p2.bh || 0;
    if (bh1 !== bh2) return bh2 - bh1;

    const w1 = p1.tieBreaks?.WIN || p1.totalWins || p1.win || 0;
    const w2 = p2.tieBreaks?.WIN || p2.totalWins || p2.win || 0;
    if (w1 !== w2) return w2 - w1;

    const pr1 = p1.performanceRating || p1.tieBreaks?.performanceRating || 1200;
    const pr2 = p2.performanceRating || p2.tieBreaks?.performanceRating || 1200;
    return pr2 - pr1;
  }

  function orderTiedPlayersPure(p1, p2, additionalRules = []) {
    return executeMultiStageSort(p1, p2);
  }


  /**
   * Main entry point: resolve final ties among players who share the same rank.
   *
   * @param {Array} players - All tournament players (ranked, with tieBreaks)
   * @param {Object} config - Resolution config
   *   { additionalTieBreaks: [], allowPlayoff: bool, allowRandom: bool }
   * @param {Array} tieBreakOrder - The primary tie-break order already applied
   * @returns {Array} Players with finalRank and tieResolvedBy
   */
  function resolveFinalTies(players, config = {}, tieBreakOrder = []) {
    const { additionalTieBreaks = [], allowPlayoff = false, allowRandom = false } = config;

    // Group by current rank
    const rankGroups = {};
    for (const p of players) {
      const rank = p.rank || 1;
      if (!rankGroups[rank]) rankGroups[rank] = [];
      rankGroups[rank].push(p);
    }

    const resolved = [];

    for (const rank of Object.keys(rankGroups).sort((a, b) => a - b)) {
      const group = rankGroups[rank];

      if (group.length === 1) {
        // No tie — already resolved
        resolved.push({
          ...group[0],
          finalRank: parseInt(rank),
          tieResolvedBy: 'No Tie'
        });
        continue;
      }

      // Attempt resolution chain
      const resolvedGroup = resolveGroup(group, players, config, tieBreakOrder);
      resolved.push(...resolvedGroup);
    }

    return resolved;
  }

  /**
   * Resolve a group of tied players through the resolution chain.
   */
  function resolveGroup(group, allPlayers, config, tieBreakOrder) {
    const { additionalTieBreaks = [], allowPlayoff = false, allowRandom = false } = config;
    const baseRank = group[0].rank || 1;

    // ── STEP 1: Direct Encounter (mini-table) ──
    const deResult = applyDirectEncounterTieBreak(group);
    if (deResult.resolved) {
      return assignRanks(deResult.sorted, baseRank, 'Direct Encounter');
    }

    // ── STEP 2: Additional Tie-Breaks ──
    if (additionalTieBreaks.length > 0) {
      const atbResult = applyAdditionalTieBreaks(group, additionalTieBreaks);
      if (atbResult.resolved) {
        return assignRanks(atbResult.sorted, baseRank, 'Additional Tie-break');
      }
    }

    // ── STEP 3: Check for playoff results (if playoff was conducted) ──
    if (allowPlayoff) {
      const playoffResult = checkPlayoffResults(group);
      if (playoffResult.resolved) {
        return assignRanks(playoffResult.sorted, baseRank, 'Playoff');
      }
    }

    // ── STEP 4: Randomization (last resort) ──
    if (allowRandom) {
      console.warn('[TieResolution] Using RANDOMIZATION for final tie. This is logged.');
      const randomResult = applyRandomization(group);
      return assignRanks(randomResult, baseRank, 'Randomization (Last Resort)');
    }

    // ── STEP 5: Shared Placement (default fallback) ──
    return applySharedPlacement(group, baseRank);
  }

  /**
   * Direct Encounter tie-break for a group.
   * For 2 players: head-to-head.
   * For 3+: mini-table among the group.
   */
  function applyDirectEncounterTieBreak(group) {
    if (group.length === 2) {
      const de = TieBreak.directEncounter(group[0], group[1]);
      if (de !== 0) {
        const sorted = de === 1 ? [group[0], group[1]] : [group[1], group[0]];
        return { resolved: true, sorted };
      }
      return { resolved: false, sorted: group };
    }

    // 3+ players: mini-table
    const miniTable = generateMiniTable(group);
    const sorted = [...group].sort((a, b) => {
      const scoreA = miniTable[a.id] || 0;
      const scoreB = miniTable[b.id] || 0;
      return scoreB - scoreA;
    });

    // Check if mini-table resolves all ties
    const scores = sorted.map(p => miniTable[p.id] || 0);
    const allUnique = new Set(scores).size === scores.length;

    if (allUnique) {
      return { resolved: true, sorted };
    }

    // Partial resolution: check if at least the top is resolved
    // Even with circular results, if there's differentiation, use it
    if (scores[0] !== scores[1]) {
      return { resolved: true, sorted };
    }

    return { resolved: false, sorted: group };
  }

  /**
   * Generate a mini-table for a group of tied players.
   * Returns map of playerId → score within the group.
   */
  function generateMiniTable(group) {
    return TieBreak.directEncounterGroup(group);
  }

  /**
   * Apply additional tie-breaks from config.
   */
  function applyAdditionalTieBreaks(group, additionalTBs) {
    const sorted = [...group].sort((a, b) => {
      for (const tbName of additionalTBs) {
        let valA, valB;

        switch (tbName) {
          case 'rating':
            valA = a.selectedRating || 0;
            valB = b.selectedRating || 0;
            break;
          case 'blackGames':
            valA = (a.colors || []).filter(c => c === 'black').length;
            valB = (b.colors || []).filter(c => c === 'black').length;
            break;
          case 'performanceRating':
            valA = a.tieBreaks ? (a.tieBreaks.performanceRating || 0) : 0;
            valB = b.tieBreaks ? (b.tieBreaks.performanceRating || 0) : 0;
            break;
          default:
            valA = a.tieBreaks ? (a.tieBreaks[tbName] || 0) : 0;
            valB = b.tieBreaks ? (b.tieBreaks[tbName] || 0) : 0;
        }

        const diff = valB - valA;
        if (Math.abs(diff) > 0.001) return diff;
      }
      return orderTiedPlayersPure(a, b, additionalTBs);
    });

    // Check if resolved
    const isResolved = sorted.length <= 1 || (() => {
      for (let i = 1; i < sorted.length; i++) {
        for (const tbName of additionalTBs) {
          let valA, valB;
          switch (tbName) {
            case 'rating':
              valA = sorted[i - 1].selectedRating || 0;
              valB = sorted[i].selectedRating || 0;
              break;
            default:
              valA = sorted[i - 1].tieBreaks ? (sorted[i - 1].tieBreaks[tbName] || 0) : 0;
              valB = sorted[i].tieBreaks ? (sorted[i].tieBreaks[tbName] || 0) : 0;
          }
          if (Math.abs(valB - valA) > 0.001) return true;
        }
      }
      return false;
    })();

    return { resolved: isResolved, sorted };
  }

  /**
   * Check if playoff results exist for the group.
   * Playoff results are stored as playoffResult on player objects.
   */
  function checkPlayoffResults(group) {
    const withPlayoff = group.filter(p => p.playoffResult !== undefined && p.playoffResult !== null);

    if (withPlayoff.length !== group.length) {
      return { resolved: false, sorted: group };
    }

    const sorted = [...group].sort((a, b) => (b.playoffResult || 0) - (a.playoffResult || 0));
    const scores = sorted.map(p => p.playoffResult);
    const allUnique = new Set(scores).size === scores.length;

    return { resolved: allUnique, sorted };
  }

  /**
   * Apply randomization as a last resort.
   * Fisher-Yates shuffle — deterministic order is NOT guaranteed.
   */
  function applyRandomization(group) {
    const shuffled = [...group];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Shared Placement: all players share the same rank.
   * Next rank skips appropriately.
   */
  function applySharedPlacement(group, baseRank) {
    return group.map(p => ({
      ...p,
      finalRank: baseRank,
      tieResolvedBy: 'Shared Placement'
    }));
  }

  /**
   * Assign sequential ranks starting from baseRank.
   */
  function assignRanks(sortedPlayers, baseRank, method) {
    return sortedPlayers.map((p, i) => ({
      ...p,
      finalRank: baseRank + i,
      tieResolvedBy: method
    }));
  }

  // ── TEAM TIE RESOLUTION ──

  /**
   * Resolve ties for teams using the same chain.
   */
  function resolveTeamTies(teams, config = {}) {
    const rankGroups = {};
    for (const t of teams) {
      const rank = t.rank || 1;
      if (!rankGroups[rank]) rankGroups[rank] = [];
      rankGroups[rank].push(t);
    }

    const resolved = [];

    for (const rank of Object.keys(rankGroups).sort((a, b) => a - b)) {
      const group = rankGroups[rank];

      if (group.length === 1) {
        resolved.push({
          ...group[0],
          finalRank: parseInt(rank),
          tieResolvedBy: 'No Tie'
        });
        continue;
      }

      // Direct encounter between teams
      if (group.length === 2) {
        const t1 = group[0];
        const t2 = group[1];
        const match = (t1.teamResults || []).find(r => r.opponentTeamId === t2.teamId);
        if (match) {
          if (match.matchResult === 2) {
            resolved.push({ ...t1, finalRank: parseInt(rank), tieResolvedBy: 'Direct Encounter' });
            resolved.push({ ...t2, finalRank: parseInt(rank) + 1, tieResolvedBy: 'Direct Encounter' });
            continue;
          } else if (match.matchResult === 0) {
            resolved.push({ ...t2, finalRank: parseInt(rank), tieResolvedBy: 'Direct Encounter' });
            resolved.push({ ...t1, finalRank: parseInt(rank) + 1, tieResolvedBy: 'Direct Encounter' });
            continue;
          }
        }
      }

      // Shared placement for teams
      for (const t of group) {
        resolved.push({ ...t, finalRank: parseInt(rank), tieResolvedBy: 'Shared Placement' });
      }
    }

    return resolved;
  }

  return {
    resolveFinalTies,
    applyDirectEncounterTieBreak,
    generateMiniTable,
    applySharedPlacement,
    applyAdditionalTieBreaks,
    resolveTeamTies,
    executeMultiStageSort
  };

})();
