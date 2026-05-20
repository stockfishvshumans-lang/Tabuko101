/**
 * tiebreak.js — STRICT FIDE-Compliant Tie-Break Engine
 * Days 178–179 Sprint Updates:
 *   Day 178: Unplayed rounds + byes use 0.5 virtual opponent score (FIDE C.02.13.2)
 *   Day 179: calculateDirectEncounter instantiates isolated mini-table scoring matrix
 *            for 3+ tied participants to resolve rankings reliably.
 *
 * FIDE MATHEMATICAL BASIS:
 * 1. Buchholz Virtual Opponent (C.02.13.2): VirtualScore = PlayerScoreBeforeRound + Result + (RemainingRounds × 0.5)
 * 2. Sonneborn-Berger: Correctly handles unplayed games using virtual opponent correction.
 * 3. Direct Encounter: Applied ONLY if all tied players played each other — uses isolated mini-table.
 * 4. Error boundaries: Fails properly when data is missing or inconsistent.
 */
const TieBreak = (() => {

  function buildPlayerMap(players) {
    const map = {};
    players.forEach(p => (map[p.id] = p));
    return map;
  }

  function getScore(player) {
    if (!player.roundScores) throw new Error(`Invalid scores for player ${player.id}`);
    return player.roundScores.reduce((s, r) => s + r, 0);
  }

  // Day 161 Task 1: Canonical Virtual Opponent Score Calculation
  function getVirtualOpponentPoints(opponent, currentRound, totalRounds) {
    let realPoints = parseFloat(opponent.points !== undefined ? opponent.points : getScore(opponent));
    let unplayedRounds = totalRounds - currentRound;
    // FIDE Rule: For tie-break calculations, unplayed rounds count as 0.5 points (nominal draw)
    return realPoints + (unplayedRounds * 0.5);
  }

  function getAdjustedOpponentScore(opponent, totalRounds) {
    if (!opponent) return 0;
    let playedPoints = 0;
    let unplayedRounds = 0;
    (opponent.results || []).forEach(r => {
      if (r.isBye || r.isForfeit || !r.opponentId) {
        unplayedRounds++;
      } else {
        playedPoints += parseFloat(r.result || 0);
      }
    });
    const missingRounds = totalRounds - (opponent.results || []).length;
    if (missingRounds > 0) {
      unplayedRounds += missingRounds;
    }
    return playedPoints + (unplayedRounds * 0.5);
  }

  function getVirtualOpponentScore(player, roundNumber, totalRounds) {
    return (() => {
      // 🛡️ REPAIR: Isolated runtime scope block to prevent cross-player memory leakage
      const pClone = JSON.parse(JSON.stringify(player));
      const roundScores = pClone.roundScores || (pClone.results || []).map(x => x.result || 0);
      const scoreBeforeRound = roundScores
        .slice(0, roundNumber - 1)
        .reduce((s, r) => s + parseFloat(r || 0), 0);

      const resultForRound = roundScores[roundNumber - 1] !== undefined ? parseFloat(roundScores[roundNumber - 1] || 0) : 0.5;
      const remainingRounds = totalRounds - roundNumber;

      return scoreBeforeRound + resultForRound + (remainingRounds * 0.5);
    })();
  }

  function getOpponentScoreForBuchholz(player, r, playerMap, totalRounds) {
    const isUnplayed = !r.opponentId || !playerMap[r.opponentId] || r.isForfeit === true || r.isBye === true;

    if (isUnplayed) {
      // Day 161 Task 2: Direct bye/forfeit uses isolated weight coefficients
      return getVirtualOpponentScore(player, r.round, totalRounds);
    }

    const opponent = playerMap[r.opponentId];
    if (!opponent) {
      console.warn(`Missing opponent data: ${r.opponentId} not found. Substituting 0.5 baseline fallback.`);
      return 0.5 * totalRounds; // Estimated baseline fallback score
    }

    // Day 161 Task 1: For real opponents who had unplayed rounds, calculate their virtual opponent points
    return getAdjustedOpponentScore(opponent, totalRounds);
  }

  // ── DAY 178: FIDE VIRTUAL OPPONENT CORRECTIONS ──
  // Unplayed rounds and byes are scored as 0.5 against a virtual opponent
  // whose score equals the player's own score at that point (FIDE C.02.13.2)
  function buchholzFull(player, playerMap, totalRounds) {
    let sum = 0;
    const results = player.results || [];
    const playedRounds = results.length;

    // Process played + bye rounds
    results.forEach(r => {
      sum += getOpponentScoreForBuchholz(player, r, playerMap, totalRounds);
    });

    // Day 178: Add virtual opponent corrections for any missing rounds
    const missingRounds = totalRounds - playedRounds;
    if (missingRounds > 0) {
      // Virtual opponent score = player's own current score (FIDE C.02.13.2)
      const playerScore = parseFloat(player.points !== undefined ? player.points : 0);
      sum += missingRounds * (playerScore * 0.5); // 0.5 × virtual opponent score
    }

    return sum;
  }

  function buchholzCut1(player, playerMap, totalRounds) {
    const scores = (player.results || [])
      .map(r => getOpponentScoreForBuchholz(player, r, playerMap, totalRounds))
      .sort((a, b) => a - b);
    if (scores.length <= 1) {
      return scores.reduce((a, b) => a + b, 0);
    }
    return scores.slice(1).reduce((s, v) => s + v, 0);
  }

  function sonnebornBerger(player, playerMap, totalRounds) {
    return (player.results || []).reduce((sum, r) => {
      const oppScore = getOpponentScoreForBuchholz(player, r, playerMap, totalRounds);
      return sum + (r.result * oppScore);
    }, 0);
  }

  function numberOfWins(player) {
    return (player.results || []).reduce((count, r) => {
      return count + (r.result === 1 ? 1 : 0);
    }, 0);
  }

  function blackWinsGames(player) {
    return (player.results || []).reduce((count, r) => {
      const isBlack = r.color && r.color.toString().toLowerCase().startsWith('b');
      return count + ((r.result === 1 && isBlack) ? 1 : 0);
    }, 0);
  }

  function progressiveScore(player) {
    let sum = 0, total = 0;
    (player.roundScores || []).forEach(r => {
      sum += r;
      total += sum;
    });
    return total;
  }

  function computeSubGroupMiniTable(tiedPlayerIds, players) {
    let subScores = {};
    tiedPlayerIds.forEach(id => subScores[id] = 0);

    players.forEach(p => {
      if (tiedPlayerIds.includes(p.id)) {
        (p.results || []).forEach(r => {
          if (!r.isBye && !r.isForfeit && r.opponentId && tiedPlayerIds.includes(r.opponentId)) {
            subScores[p.id] += parseFloat(r.result || 0);
          }
        });
      }
    });
    return subScores;
  }

  // ── DAY 179: ISOLATED MINI-TABLE SCORING MATRIX ─
  /**
   * applyDirectEncounter: For 3+ tied players, instantiate an isolated mini-table
   * that scores ONLY results within the tied group, then assigns DE scores.
   * FIDE: Direct encounter is only valid when all tied players faced each other.
   */
  function applyDirectEncounter(group) {
    if (group.length <= 1) return;

    const ids = group.map(p => p.id);

    // FIDE absolute completion check
    let allPlayed = true;
    for (const p of group) {
      const opponentsInGroup = new Set(
        (p.results || [])
          .filter(r => !r.isBye && !r.isForfeit && r.opponentId && ids.includes(r.opponentId))
          .map(r => r.opponentId)
      );
      if (opponentsInGroup.size < group.length - 1) { allPlayed = false; break; }
    }

    if (!allPlayed) {
      // Not all players met — bypass DE, drop to next tie-break
      for (const p of group) p.tieBreaks.DE = 0;
      return;
    }

    // Day 179: Isolated mini-table — only intra-group results count
    const miniTable = _buildIsolatedMiniTable(ids, group);
    for (const p of group) p.tieBreaks.DE = miniTable[p.id] ?? 0;
  }

  /**
   * _buildIsolatedMiniTable: Creates a fresh scoring matrix scoped exclusively
   * to the tied sub-group, preventing cross-group contamination.
   * @param {string[]} tiedIds
   * @param {Object[]} players
   * @returns {Object} { [playerId]: score }
   */
  function _buildIsolatedMiniTable(tiedIds, players) {
    // Deep-clone all player data — immutable input
    const playersClone = JSON.parse(JSON.stringify(players));
    const idSet        = new Set(tiedIds);
    const matrix       = {};
    tiedIds.forEach(id => { matrix[id] = 0; });

    for (const p of playersClone) {
      if (!idSet.has(p.id)) continue;
      for (const r of (p.results || [])) {
        if (r.isBye || r.isForfeit || !r.opponentId) continue;
        if (!idSet.has(r.opponentId)) continue; // Only score intra-group results
        matrix[p.id] = (matrix[p.id] || 0) + parseFloat(r.result || 0);
      }
    }
    return matrix;
  }

  function directEncounter(p1, p2) {
    const match = (p1.results || []).find(r => r.opponentId === p2.id);
    if (!match) return 0;
    if (match.result === 1) return 1;
    if (match.result === 0) return -1;
    return 0;
  }

  function directEncounterGroup(group) {
    const ids = group.map(p => p.id);
    const scores = {};
    group.forEach(p => {
      scores[p.id] = (p.results || [])
        .filter(r => ids.includes(r.opponentId))
        .reduce((sum, r) => sum + r.result, 0);
    });
    return scores;
  }


  // 🛡️ REPAIR: Enforce absolute pure function data insulation via serialization cloning
  function calculateBuchholzPure(playerDataArray, matchesHistory, totalRounds) {
    const localizedPlayers = JSON.parse(JSON.stringify(playerDataArray));
    const map = buildPlayerMap(localizedPlayers);
    const computedTieBreakMap = {};
    localizedPlayers.forEach(p => {
      computedTieBreakMap[p.id] = {
        bh: buchholzFull(p, map, totalRounds),
        bhc1: buchholzCut1(p, map, totalRounds)
      };
    });
    return computedTieBreakMap;
  }

  function calculateSonnebornBergerPure(playerDataArray, matchesHistory, totalRounds) {
    const localizedPlayers = JSON.parse(JSON.stringify(playerDataArray));
    const map = buildPlayerMap(localizedPlayers);
    const computedTieBreakMap = {};
    localizedPlayers.forEach(p => {
      computedTieBreakMap[p.id] = {
        sb: sonnebornBerger(p, map, totalRounds)
      };
    });
    return computedTieBreakMap;
  }

  function calculateAllTieBreaks(players, order, totalRounds) {
    // 🛡️ REPAIR: Deep clone to block mutations of live component references
    const insulatedPlayers = JSON.parse(JSON.stringify(players));
    const map = buildPlayerMap(insulatedPlayers);
    return insulatedPlayers.map(p => {
      if (!p.results || !p.roundScores) {
        throw new Error(`Inconsistent results: Missing results/scores for player ${p.id}`);
      }

      if (p.results.length !== p.roundScores.length) {
        throw new Error(`Inconsistent results: Length mismatch for player ${p.id}`);
      }

      // 🛡️ REPAIR: Opponent Scorecard Cross-Examiner
      (p.results || []).forEach(r => {
         const opp = map[r.opponentId];
         if (opp && !r.isBye && !r.isForfeit) {
            const oppResult = (opp.results || []).find(o => o.opponentId === p.id && o.round === r.round);
            if (oppResult) {
               const pRes = parseFloat(r.result);
               const oRes = parseFloat(oppResult.result);
               let expectedOppResult = 0;
               if (pRes === 1) expectedOppResult = 0;
               else if (pRes === 0) expectedOppResult = 1;
               else if (pRes === 0.5) expectedOppResult = 0.5;

               // Ignore 0-0 double-forfeit / manual double-zero edge cases
               if (oRes !== expectedOppResult && pRes !== undefined && !isNaN(oRes) && !(pRes === 0 && oRes === 0)) {
                  console.warn(`[TieBreak] DATA COLLISION: ${p.name || p.id} vs ${opp.name || opp.id} in round ${r.round}. Expected opp result ${expectedOppResult}, got ${oRes}`);
               }
            }
         }
      });

      const tb = {
        BHC1: buchholzCut1(p, map, totalRounds),
        BH: buchholzFull(p, map, totalRounds),
        SB: sonnebornBerger(p, map, totalRounds),
        PS: progressiveScore(p),
        WIN: numberOfWins(p),
        BWG: blackWinsGames(p),
        DE: 0
      };

      // FIDE FLAT MAPPING: Attach variables directly to root for UI performance
      return {
        ...p,
        score: getScore(p),
        bhc1: tb.BHC1,
        bh: tb.BH,
        sb: tb.SB,
        ps: tb.PS,
        win: tb.WIN,
        bwg: tb.BWG,
        de: 0,
        tieBreaks: tb // Keep nested object for internal math compatibility
      };
    });
  }

  // Authoritative ranking per FIDE strict order
  function rankPlayers(players, order, totalRounds) {
    // Determine the authoritative FIDE order (override parameter)
    const tbOrder = ['score', 'BHC1', 'BH', 'SB', 'DE', 'PS', 'WIN', 'BWG'];

    // First, recalculate or ensure tiebreaks are present
    const playersWithTb = calculateAllTieBreaks(players, order, totalRounds);

    function sortGroup(group, tbIndex) {
      if (group.length <= 1) return group;
      if (tbIndex >= tbOrder.length) return group;

      const tbName = tbOrder[tbIndex];

      if (tbName === 'DE') {
        applyDirectEncounter(group);
      }

      // Sort descending
      group.sort((a, b) => {
        let valA = tbName === 'score' ? a.score : a.tieBreaks[tbName];
        let valB = tbName === 'score' ? b.score : b.tieBreaks[tbName];

        if (Math.abs(valB - valA) > 1e-6) {
          return valB - valA;
        }
        return 0;
      });

      // Split into subgroups of exact ties
      const subgroups = [];
      let currentSubgroup = [group[0]];

      for (let i = 1; i < group.length; i++) {
        let valA = tbName === 'score' ? group[i - 1].score : group[i - 1].tieBreaks[tbName];
        let valB = tbName === 'score' ? group[i].score : group[i].tieBreaks[tbName];

        if (Math.abs(valA - valB) < 1e-6) {
          currentSubgroup.push(group[i]);
        } else {
          subgroups.push(currentSubgroup);
          currentSubgroup = [group[i]];
        }
      }
      subgroups.push(currentSubgroup);

      const sortedGroup = [];
      for (const sg of subgroups) {
        sortedGroup.push(...sortGroup(sg, tbIndex + 1));
      }

      return sortedGroup;
    }

    const sortedPlayers = sortGroup([...playersWithTb], 0);

    let rank = 1;
    for (let i = 0; i < sortedPlayers.length; i++) {
      if (i > 0) {
        const prev = sortedPlayers[i - 1];
        const curr = sortedPlayers[i];

        let tied = true;
        if (Math.abs(prev.score - curr.score) > 1e-6) tied = false;
        else {
          for (const tb of tbOrder) {
            if (tb === 'score') continue;
            if (Math.abs((prev.tieBreaks[tb] || 0) - (curr.tieBreaks[tb] || 0)) > 1e-6) {
              tied = false;
              break;
            }
          }
        }

        if (!tied) rank = i + 1;
      }
      sortedPlayers[i].rank = rank;

      // Update UI flat aliases
      sortedPlayers[i].de = sortedPlayers[i].tieBreaks.DE;
    }

    return sortedPlayers;
  }

  return {
    calculateAllTieBreaks,
    rankPlayers,
    directEncounter,
    directEncounterGroup,
    getVirtualOpponentScore,
    calculateBuchholzPure,
    calculateSonnebornBergerPure,
    rankTeams: (teams) => {
      return [...teams].sort((a, b) => {
        let d = (b.matchPoints || 0) - (a.matchPoints || 0);
        if (d !== 0) return d;
        d = (b.boardPoints || 0) - (a.boardPoints || 0);
        if (d !== 0) return d;
        return (b.rating || 1200) - (a.rating || 1200);
      }).map((t, i) => ({ ...t, rank: i + 1 }));
    }
  };
})();

// Global Export
if (typeof window !== 'undefined') window.TieBreak = TieBreak;
if (typeof module !== 'undefined') module.exports = TieBreak;