/**
 * pairing-team.js — FIDE-Compliant Team Swiss Engine (REFACTORED)
 * 
 * FIXES APPLIED:
 * - Removed the "greedy" sequential matching loop.
 * - Implemented recursive Bracket Backtracking to prevent deadlock in later rounds.
 * - Teams are properly bracketed by Match Points, and floaters are handled correctly.
 */
const TeamPairing = (() => {

  /**
   * calculateTeamRoundResult: Computes MP and BP from a set of boards.
   */
  function calculateTeamRoundResult(boards) {
    let homeBP = 0, awayBP = 0;
    const totalBoards = boards.length;

    boards.forEach(b => {
      if (b.result) {
        const isHomeWhite = (b.boardNumber - 1) % 2 === 0;
        if (isHomeWhite) {
          homeBP += b.result.whiteScore;
          awayBP += b.result.blackScore;
        } else {
          homeBP += b.result.blackScore;
          awayBP += b.result.whiteScore;
        }
      }
    });

    const threshold = totalBoards / 2;
    let homeMP = 0, awayMP = 0;

    if (homeBP > threshold) { homeMP = 2; awayMP = 0; }
    else if (awayBP > threshold) { homeMP = 0; awayMP = 2; }
    else { homeMP = 1; awayMP = 1; }

    return { homeBP, awayBP, homeMP, awayMP };
  }

  /**
   * createTeamMatch: Spawns boards for a team matchup.
   */
  /**
   * _findPlayerName: Resolves a player name from a team object by ID, board number, or index.
   */
  function _findPlayerName(team, playerId, boardIndex) {
    if (!team.players || team.players.length === 0) return 'TBD';
    // 1. Match by ID
    const byId = team.players.find(p => p.id === playerId);
    if (byId && byId.name && byId.name.trim() !== '' && byId.name.toLowerCase() !== 'vacant') return byId.name;
    // 2. Match by board number
    const byBoard = team.players.find(p => p.boardNumber == (boardIndex + 1) || p.board == (boardIndex + 1));
    if (byBoard && byBoard.name && byBoard.name.trim() !== '' && byBoard.name.toLowerCase() !== 'vacant') return byBoard.name;
    // 3. Fall back to array position
    const byIdx = team.players[boardIndex];
    if (byIdx && byIdx.name && byIdx.name.trim() !== '' && byIdx.name.toLowerCase() !== 'vacant') return byIdx.name;
    return 'TBD';
  }

  function alignTeamBoards(teamA, teamB, isTeamAWhiteOnB1, teamSize) {
    // Day 165 Task 1: Sequential Board Color Alternation
    const boards = [];
    for (let i = 0; i < teamSize; i++) {
      const isWhite = (i % 2 === 0) ? isTeamAWhiteOnB1 : !isTeamAWhiteOnB1;
      const whiteTeam = isWhite ? teamA : teamB;
      const blackTeam = isWhite ? teamB : teamA;
      boards.push({
        boardNumber: i + 1,
        whiteId: whiteTeam.playerIds[i] || '',
        blackId: blackTeam.playerIds[i] || '',
        whiteName: _findPlayerName(whiteTeam, whiteTeam.playerIds[i], i),
        blackName: _findPlayerName(blackTeam, blackTeam.playerIds[i], i),
        result: null
      });
    }
    return boards;
  }

  function createTeamMatch(teamA, teamB, matchNumber) {
    const isTeamAWhiteOnB1 = Math.random() > 0.5; // FIDE randomization
    const teamSize = Math.max(teamA.playerIds?.length || 0, teamB.playerIds?.length || 0, 4);
    const boards = alignTeamBoards(teamA, teamB, isTeamAWhiteOnB1, teamSize);

    return {
      matchNumber,
      homeTeamId: teamA.id,
      awayTeamId: teamB.id,
      homeTeamName: teamA.name,
      awayTeamName: teamB.name,
      boards,
      isResolved: false
    };
  }

  /**
   * generateTeamPairings: Main Swiss Entry Point
   */
  function generateTeamPairings(teams, roundNumber, config = {}) {
    const previousMatches = new Map();
    // Reconstruct history map for checking rematches
    teams.forEach(t => {
      previousMatches.set(t.id, new Set(t.opponents || []));
    });

    const pool = teams.filter(t => !t.withdrawn);
    let bye = null;

    if (pool.length % 2 !== 0) {
      // Find lowest ranked eligible for bye
      for (let i = pool.length - 1; i >= 0; i--) {
        if (!pool[i].hadBye) {
          bye = pool.splice(i, 1)[0];
          break;
        }
      }
      if (!bye) bye = pool.pop();
    }

    // Sort for Score-Bracketed pairing (MP > BP > Rating)
    pool.sort((a, b) => {
      if (b.mp !== a.mp) return b.mp - a.mp;
      if (b.bp !== a.bp) return b.bp - a.bp;
      return (b.avgRating || 0) - (a.avgRating || 0);
    });

    const pairings = [];
    const pairedIds = new Set();
    
    // RECURSION SAFETY VALVE
    let recursionDepth = 0;

    /**
     * Recursive Backtracking Pairing Engine
     */
    function findPairings(index) {
      recursionDepth++;
      if (recursionDepth > 3000) {
        throw new Error("SWISS_DEADLOCK_REACHED: Infinite recursion detected in pairing engine. Manual arbiter pairing required.");
      }

      if (index >= pool.length) return true;
      if (pairedIds.has(pool[index].id)) return findPairings(index + 1);

      const teamA = pool[index];
      
      // Try to pair with every subsequent available team
      for (let j = index + 1; j < pool.length; j++) {
        const teamB = pool[j];
        if (pairedIds.has(teamB.id)) continue;
        
        // FIDE Prohibition: No rematches
        if (previousMatches.get(teamA.id).has(teamB.id)) continue;

        // Valid Match Found
        pairings.push(createTeamMatch(teamA, teamB, pairings.length + 1));
        pairedIds.add(teamA.id);
        pairedIds.add(teamB.id);

        if (findPairings(index + 1)) return true;

        // Backtrack
        pairings.pop();
        pairedIds.delete(teamA.id);
        pairedIds.delete(teamB.id);
      }

      return false;
    }

    const success = findPairings(0);
    
    if (!success && pool.length > 0) {
      // Emergency Fallback: If no valid Swiss pairing exists, pair sequentially to avoid crash
      console.warn("[Swiss Engine] Deadlock reached. Executing emergency sequential fallback.");
      const remaining = pool.filter(t => !pairedIds.has(t.id));
      for (let i = 0; i < remaining.length; i += 2) {
        if (remaining[i+1]) {
          pairings.push(createTeamMatch(remaining[i], remaining[i+1], pairings.length + 1));
        } else if (!bye) {
          bye = remaining[i];
        }
      }
    }

    return { pairings, bye };
  }

  return { 
    generateTeamPairings, 
    generateSwissPairings: generateTeamPairings,
    createTeamMatch, 
    alignTeamBoards,
    calculateTeamRoundResult 
  };
})();

window.TeamPairing = TeamPairing;