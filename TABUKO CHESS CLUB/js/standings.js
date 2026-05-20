/**
 * standings.js — Pure FIDE Data Adapter
 * Strictly responsible for mapping Firebase data to the TieBreak.js schema.
 * Contains ZERO UI rendering and ZERO mathematical tiebreak logic.
 */
const Standings = (() => {

  /**
   * prepareData: Converts flat Firebase records into FIDE-ready player objects.
   * Schema: { results: [ {opponentId, result, color, round, isUnplayed} ], roundScores: [ 1, 0.5, 0... ] }
   */
  function prepareData(rawPlayers, rawMatches, targetRound) {
    // 1. Guard clauses and aggressive type coercion
    const players = Array.isArray(rawPlayers) ? JSON.parse(JSON.stringify(rawPlayers)) : [];

    // DEFENSIVE: Sanitize rawMatches immediately to remove nulls or non-objects
    const rawArr = Array.isArray(rawMatches) ? JSON.parse(JSON.stringify(rawMatches)) :
      (rawMatches && typeof rawMatches === 'object' ? JSON.parse(JSON.stringify(Object.values(rawMatches))) : []);
    const safeMatches = rawArr.filter(m => m && typeof m === 'object');

    const target = parseInt(targetRound, 10) || 0;

    if (players.length === 0) return [];
    if (target === 0) return players.map(p => ({ ...p, score: 0, results: [], roundScores: [] }));

    return players.map(player => {
      // 2. Initialize strict FIDE properties
      const p = {
        ...player,
        results: [],
        roundScores: [],
        score: 0
      };

      // 3. STRICT ROUND ALIGNMENT: Loop precisely from Round 1 to targetRound
      // This guarantees `roundScores[0]` is ALWAYS Round 1, preventing TieBreak.js indexing crashes.
      for (let r = 1; r <= target; r++) {
        // Find the match for this specific round
        const m = safeMatches.find(match => {
          const isParticipant = (match.whiteId === p.id || match.blackId === p.id || (match.isBye && match.playerId === p.id));
          const hasResult = (match.result && match.result !== '') || match.isBye;
          const matchRound = parseInt(match.round, 10);
          return isParticipant && hasResult && matchRound === r;
        });

        if (m) {
          // Player played or had an official BYE this round
          let points = 0;
          
          // Day 215 Task 1: Dynamic Case-Insensitive Color Formatting
          let isWhite = m.whiteId === p.id;
          if (m.playerColor) {
            const normalizedColor = String(m.playerColor || '').trim().toLowerCase();
            if (normalizedColor === 'w' || normalizedColor === 'white') isWhite = true;
            else if (normalizedColor === 'b' || normalizedColor === 'black') isWhite = false;
          }
          
          const opponentId = isWhite ? m.blackId : m.whiteId;

          if (m.isBye === true || m.result === 'BYE') {
            // FIDE Bye Logic
            points = 1;
            p.results.push({
              opponentId: null,
              result: 1,
              color: 'None',
              round: r,
              isUnplayed: true
            });
          } else {
            // Standard Result Logic
            const res = m.result;
            
            let rawPoints = 0;
            if (typeof res === 'object' && res !== null) {
              rawPoints = isWhite ? res.whiteScore : res.blackScore;
            } else if (typeof res === 'string') {
              // Day 215 Task 2: Mixed Character Token Matching Filters
              const normalizedRes = res.trim().toLowerCase();
              if (normalizedRes === '1-0' || normalizedRes === '1 - 0' || normalizedRes === '1-0f' || normalizedRes === '1-0(f)') {
                rawPoints = isWhite ? 1 : 0;
              } else if (normalizedRes === '0-1' || normalizedRes === '0 - 1' || normalizedRes === '0-1f' || normalizedRes === '0-1(f)') {
                rawPoints = isWhite ? 0 : 1;
              } else if (normalizedRes === '0.5-0.5' || normalizedRes === '0.5 - 0.5' || normalizedRes === '1/2-1/2' || normalizedRes === '1/2 - 1/2' || normalizedRes === '½-½') {
                rawPoints = 0.5;
              } else if (normalizedRes === '0-0' || normalizedRes === '0-0f') {
                rawPoints = 0;
              } else {
                rawPoints = parseFloat(res) || 0;
              }
            } else {
              rawPoints = res || 0;
            }

            let forcedScore = parseFloat(rawPoints);
            if (isNaN(forcedScore) || forcedScore < 0 || forcedScore > 1) {
              console.error(`[Type Coercion Engine] Invalid score token detected: ${rawPoints}. Enforcing zero-point fallback.`);
              forcedScore = 0.0;
            }
            points = forcedScore;

            p.results.push({
              opponentId: opponentId,
              result: points,
              color: isWhite ? 'White' : 'Black',
              round: r,
              isUnplayed: false
            });
          }

          p.roundScores.push(points);
          p.score += points;

        } else {
          // Missing/Unplayed Round (Late Entry, Unpaired, or Missing Data)
          // MUST pad the arrays to preserve FIDE math indexing (C.02.13.2)
          p.results.push({
            opponentId: null,
            result: 0,
            color: 'None',
            round: r,
            isUnplayed: true
          });
          p.roundScores.push(0);
        }
      }

      return p;
    });
  }

  /**
   * generateLiveStandings: The master orchestrator for the reactive pipeline.
   * Called by UI.js to refresh the standings leaderboard.
   */
  function generateLiveStandings(rawPlayers, rawMatches, targetRound, totalRounds) {
    console.group("🏆 Standings Pipeline Trace");
    console.log("1. Raw Firebase Input:", { rawPlayers, rawMatches, targetRound, totalRounds });

    // 1. Adapter Stage
    const preparedPlayers = prepareData(rawPlayers, rawMatches, targetRound);
    console.log("2. FIDE Adapted Data:", preparedPlayers);

    // 2. Math Engine Stage
    try {
      if (typeof TieBreak === 'undefined' || !TieBreak.rankPlayers) {
        throw new Error("TieBreak.js module is missing from the global window scope.");
      }

      // Chain directly to the FIDE math engine
      const finalStandings = TieBreak.rankPlayers(preparedPlayers, null, totalRounds);

      if (!Array.isArray(finalStandings)) {
        console.error("❌ FIDE Engine Array Output Violation:", finalStandings);
        return [];
      }

      console.log("3. FIDE Engine Output:", finalStandings);
      console.groupEnd();

      // Day 266: Publish standings event to DistributedEventBus
      if (window.DistributedEventBus) {
        window.DistributedEventBus.publish('STANDINGS_COMPUTED', {
          round: targetRound,
          playerCount: finalStandings.length,
          topPlayer: finalStandings[0]?.name || 'N/A',
          timestamp: Date.now()
        });
      }

      // Day 266: Cache compiled standings to IndexedDB via OfflineRuntime
      if (window.OfflineRuntime && targetRound) {
        const tournamentId = window._activeTournamentId || '';
        if (tournamentId) {
          window.OfflineRuntime.cacheCompiledStandings(tournamentId, targetRound, finalStandings)
            .catch(err => console.warn('[Standings] Cache write failed:', err.message));
        }
      }

      // Day 291: Feed match results into AnalyticsPipeline for incremental Rp tracking
      if (window.AnalyticsPipeline && preparedPlayers.length > 0) {
        try {
          preparedPlayers.forEach(p => {
            (p.results || []).forEach(r => {
              if (!r.isUnplayed && r.opponentId) {
                const oppData = preparedPlayers.find(op => op.id === r.opponentId);
                const oppRating = oppData?.selectedRating || oppData?.rating || 1200;
                window.AnalyticsPipeline.ingestMatchResult(
                  p.id, oppRating, r.result,
                  r.color || 'White', r.round || targetRound
                );
              }
            });
          });
        } catch (analyticsErr) {
          console.warn('[Standings] AnalyticsPipeline ingestion error:', analyticsErr.message);
        }
      }

      // Day 258: Log standings computation to OperationalLedger
      if (window.OperationalLedger) {
        window.OperationalLedger.logStandardAction('STANDINGS_COMPUTED', {
          round: targetRound,
          totalPlayers: finalStandings.length,
          topScore: finalStandings[0]?.score || 0
        }).catch(() => {});
      }

      return finalStandings;

    } catch (error) {
      console.error("❌ FIDE Engine Crash:", error);
      console.groupEnd();
      // Throw the error so the UI.js try/catch can render the visual error card
      throw error;
    }
  }

  /**
   * Day 266: getCachedOrCompute — Local-first standings retrieval.
   * Attempts to load from IndexedDB cache first, falls back to live computation.
   */
  async function getCachedOrCompute(rawPlayers, rawMatches, targetRound, totalRounds) {
    if (window.OfflineRuntime && window._activeTournamentId) {
      try {
        const cached = await window.OfflineRuntime.getCachedStandings(
          window._activeTournamentId, targetRound
        );
        if (cached && Array.isArray(cached) && cached.length > 0) {
          console.log('[Standings] Serving from IndexedDB cache.');
          return cached;
        }
      } catch (cacheErr) {
        console.warn('[Standings] Cache read failed:', cacheErr.message);
      }
    }

    return generateLiveStandings(rawPlayers, rawMatches, targetRound, totalRounds);
  }

  // EXPORT BLOCK
  return {
    prepareData,
    prepareDataForTiebreaks: prepareData, // Alias
    generateLiveStandings,
    getCachedOrCompute,
    calculateStandings: generateLiveStandings, // Alias
    createStandingsCache: generateLiveStandings, // Alias
    calculateTeamStandings: (teams) => (window.TeamStandings || TeamStandings).sortTeams(teams)
  };
})();

// Explicit Global Export
window.Standings = Standings;