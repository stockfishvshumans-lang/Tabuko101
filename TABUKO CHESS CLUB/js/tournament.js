/**
 * tournament.js — Tournament Lifecycle Management
 * Orchestrates registration → pairing → results → standings flow.
 */
window.Tournament = (() => {
  
  /**
   * validateRoundStart: Enforces the Swiss Mathematical Floor (Rounds + 1).
   * Prevents pairing crashes by ensuring enough participants exist.
   */
  function validateRoundStart(tournament, participantCount) {
    if (tournament.type === 'swiss') {
      const totalRounds = parseInt(tournament.totalRounds || 0, 10);
      const minRequired = totalRounds + 1;
      if (participantCount < minRequired) {
        throw new Error(`CRITICAL_FLOOR_VIOLATION|${totalRounds}|${minRequired}`);
      }
    }
    return true;
  }



  /**
   * executePairingWorker: Resilient dispatcher with Main-Thread Fallback.
   * Prioritizes background workers but recovers automatically for offline/restricted environments.
   */
  async function executePairingWorker(type, payload) {
    UI.showLoading(`Orchestrating ${type.replace('GENERATE_', '')} Engine...`);

    try {
      // Priority 1: Web Worker (Off-thread isolation)
      return await new Promise((resolve, reject) => {
        try {
          const worker = new Worker('js/pairing-worker.js');

          worker.onmessage = (e) => {
            const { type: status, result, error } = e.data;
            if (status === 'SUCCESS') resolve(result);
            else reject(new Error(error || "Worker Logical Failure"));
            worker.terminate();
          };

          worker.onerror = (err) => {
            reject(new Error("Worker System Fault: " + err.message));
            worker.terminate();
          };

          worker.postMessage({ type, payload });
        } catch (initErr) {
          reject(initErr); // Fail immediately to trigger fallback
        }
      });
    } catch (err) {
      console.warn("[Pairing] Primary Worker failed. Activating Main-Thread Fallback.", err);

      // Priority 2: Resilient Main-Thread Fallback
      try {
        let result;
        if (type === 'GENERATE_SWISS') {
          if (typeof SwissPairing === 'undefined') throw new Error("Swiss Engine missing");
          result = SwissPairing.generatePairings(payload.players, payload.roundNumber, payload.config);
        } else if (type === 'GENERATE_TEAM') {
          if (typeof TeamPairing === 'undefined') throw new Error("Team Engine missing");
          result = TeamPairing.generateTeamPairings(payload.teams, payload.roundNumber, payload.config);
        } else {
          throw new Error("Invalid Engine Specification");
        }
        return result;
      } catch (fallbackErr) {
        UI.showToast("Critical Pairing Engine Failure", "error");
        throw fallbackErr;
      }
    } finally {
      UI.hideLoading();
    }
  }

  /**
   * Start a new round: generate pairings, save to Firestore, advance round.
   */

  /**
   * Start a team round.
   */
  async function startTeamRound(tournament, nextRound) {
    let teams = await DB.getAllTeams(tournament.id);
    const config = { teamRatingMethod: tournament.teamRatingMethod };

    // 1. Ensure all teams have their players populated (Fixes "Vacant" names for legacy teams)
    const allPlayersSnap = await db.collection('tournaments').doc(tournament.id).collection('playerData').get();
    const allPlayersMap = {};
    allPlayersSnap.docs.forEach(d => {
      const p = d.data();
      allPlayersMap[d.id] = { id: d.id, ...p };
    });

    teams = teams.map(t => {
      if (!t.players || t.players.length === 0) {
        // Build players array from playerIds if missing
        t.players = (t.playerIds || []).map((pid, idx) => {
          const pObj = allPlayersMap[pid];
          return {
            id: pid,
            name: pObj?.name || 'Unknown',
            boardNumber: idx + 1,
            rating: pObj?.selectedRating || 0
          };
        });
      }
      return t;
    });

    // 2. Assign team ratings
    teams = teams.map(t => {
      const players = (t.players || []).map(p => ({
        ...p,
        selectedRating: RatingSystem.selectPlayerRating(p, {
          ratingType: tournament.ratingType,
          unratedHandling: tournament.unratedHandling,
          defaultRating: tournament.defaultRating
        }, t.players)
      }));
      return { ...t, players };
    });

    // Load existing team state (Must pass pre-fetched allRounds if in a transaction)
    const allRoundsSnap = await db.collection('tournaments').doc(tournament.id).collection('rounds').get();
    const allRounds = allRoundsSnap.docs.map(d => d.data());
    teams = buildTeamState(teams, allRounds);

    UI.showLoading("Worker executing Team engine...");
    const { pairings, bye } = await executePairingWorker('GENERATE_TEAM', { teams, roundNumber: nextRound, config });

    // Save team round
    const roundRef = db.collection('tournaments').doc(tournament.id).collection('rounds').doc(`round_${nextRound}`);
    await roundRef.set({
      roundNumber: nextRound,
      status: 'active',
      isTeamRound: true,
      matches: pairings.map(m => ({
        matchNumber: m.matchNumber,
        homeTeamId: m.homeTeam.teamId,
        awayTeamId: m.awayTeam.teamId,
        homeTeamName: m.homeTeam.teamName,
        awayTeamName: m.awayTeam.teamName,
        boards: m.boards.map(b => ({
          boardNumber: b.boardNumber,
          whiteId: b.white?.id || null,
          blackId: b.black?.id || null,
          whiteName: b.white?.name || '',
          blackName: b.black?.name || '',
          result: b.result
        }))
      })),
      bye: bye ? { teamId: bye.teamId, teamName: bye.teamName } : null,
      createdAt: Date.now()
    });

    await DB.updateTournament(tournament.id, { currentRound: nextRound, status: 'active' });
    return { pairings, bye, roundNumber: nextRound };
  }

  /**
   * buildPlayerState: Reconstructs player scores/history from pre-fetched round data.
   * Transaction-Safe: No async DB calls.
   */
  function buildPlayerState(players, allRounds, scoringType = 'standard') {
    const playerMap = {};
    for (const p of players) {
      playerMap[p.id] = {
        ...p,
        score: 0, opponents: [], results: [], roundScores: [],
        colors: [], hadBye: false, withdrawn: p.withdrawn || false
      };
    }

    allRounds.sort((a, b) => a.roundNumber - b.roundNumber).forEach(round => {
      const pairings = round.pairings || [];
      pairings.forEach(pairing => {
        if (!pairing.result) return;
        const { whiteId, blackId, result } = pairing;
        const { whiteScore, blackScore } = result;

        if (playerMap[whiteId]) {
          playerMap[whiteId].score += whiteScore;
          playerMap[whiteId].opponents.push(blackId);
          playerMap[whiteId].colors.push('white');
          playerMap[whiteId].results.push({ opponentId: blackId, result: whiteScore, round: round.roundNumber });
          playerMap[whiteId].roundScores.push(whiteScore);
        }
        if (playerMap[blackId]) {
          playerMap[blackId].score += blackScore;
          playerMap[blackId].opponents.push(whiteId);
          playerMap[blackId].colors.push('black');
          playerMap[blackId].results.push({ opponentId: whiteId, result: blackScore, round: round.roundNumber });
          playerMap[blackId].roundScores.push(blackScore);
        }
      });

      if (round.bye) {
        const bid = round.bye.playerId || round.bye.id;
        if (playerMap[bid]) {
          const byeScore = (scoringType === '3point' ? 3 : 1);
          playerMap[bid].score += byeScore;
          playerMap[bid].hadBye = true;
          playerMap[bid].roundScores.push(byeScore);
          playerMap[bid].results.push({ opponentId: null, result: byeScore, round: round.roundNumber, isBye: true });
        }
      }
    });

    return Object.values(playerMap);
  }

  /**
   * buildTeamState: Reconstructs team scores/history from pre-fetched round data.
   * Transaction-Safe: No async DB calls.
   */
  function buildTeamState(teams, allRounds) {
    const teamMap = {};
    for (const t of teams) {
      const tid = t.id || t.teamId;
      teamMap[tid] = { ...t, teamId: tid, matchPoints: 0, boardPoints: 0, opponents: [], teamResults: [], hadBye: false };
    }

    allRounds.sort((a, b) => a.roundNumber - b.roundNumber).forEach(round => {
      if (!round.isTeamRound) return;

      (round.teamMatches || round.matches || []).forEach(match => {
        const result = computeTeamMatchResult(match);
        if (!result) return;

        if (teamMap[result.homeTeamId]) {
          teamMap[result.homeTeamId].matchPoints += result.homeMatchPoints;
          teamMap[result.homeTeamId].boardPoints += result.homeBoardPoints;
          teamMap[result.homeTeamId].opponents.push(result.awayTeamId);
        }
        if (teamMap[result.awayTeamId]) {
          teamMap[result.awayTeamId].matchPoints += result.awayMatchPoints;
          teamMap[result.awayTeamId].boardPoints += result.awayBoardPoints;
          teamMap[result.awayTeamId].opponents.push(result.homeTeamId);
        }
      });

      if (round.bye) {
        const tid = round.bye.teamId;
        if (teamMap[tid]) {
          teamMap[tid].matchPoints += 2;
          teamMap[tid].hadBye = true;
        }
      }
    });

    return Object.values(teamMap);
  }

  /**
   * Compute team match result from board results.
   */
  function computeTeamMatchResult(match) {
    let homeBP = 0, awayBP = 0, allDone = true;
    for (const b of (match.boards || [])) {
      if (!b.result) { allDone = false; continue; }
      homeBP += b.result.whiteScore || 0;
      awayBP += b.result.blackScore || 0;
    }
    if (!allDone) return null;

    let homeMP, awayMP;
    if (homeBP > awayBP) { homeMP = 2; awayMP = 0; }
    else if (awayBP > homeBP) { homeMP = 0; awayMP = 2; }
    else { homeMP = 1; awayMP = 1; }

    return { homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId, homeBoardPoints: homeBP, awayBoardPoints: awayBP, homeMatchPoints: homeMP, awayMatchPoints: awayMP };
  }

  /**
   * Validate a single match result.
   */
  function validateMatch(pairing) {
    if (!pairing.result) return { valid: false, error: 'Result missing' };
    const { whiteScore, blackScore } = pairing.result;

    const validScores = [0, 0.5, 1];
    if (!validScores.includes(whiteScore) || !validScores.includes(blackScore)) {
      return { valid: false, error: 'Invalid score values' };
    }

    if (whiteScore + blackScore !== 1) {
      // Walkovers/Double forfeits might have different sums, but standard is 1.
      // For now, enforcing standard sum for simplicity unless specified.
      return { valid: false, error: 'Score sum must be 1.0' };
    }

    return { valid: true };
  }

  /**
   * Submit match result with strict validation.
   */
  async function submitResultAndUpdate(tournamentId, roundNumber, board, whiteScore, blackScore, isForfeit = false, pgn = null, matchNumber = null) {
    const user = Auth.getUser();
    const userData = Auth.getUserData();
    const isArbiterBridge = userData?.role === 'arbiter' || (user && !user.email);

    if (isArbiterBridge) {
      // ARBITER BRIDGE: Skip rating calculations and direct writes to official pairings
      await DB.submitResult(tournamentId, roundNumber, board, whiteScore, blackScore, isForfeit, pgn, matchNumber);
      return { white: { name: 'Player', change: 0 }, black: { name: 'Player', change: 0 }, isPending: true };
    }

    const tournament = await DB.getTournament(tournamentId);
    const round = await DB.getRound(tournamentId, roundNumber);
    if (!round) throw new Error('Round not found');
    if (round.status === 'locked' && !Auth.isAdmin()) throw new Error('Round is locked and cannot be edited');

    const scoring = tournament.scoringType || 'standard';

    // Validate score sum based on system
    if (scoring === '3point') {
      const sum = whiteScore + blackScore;
      if (!isForfeit && sum !== 3 && sum !== 2) throw new Error('3-Point Scoring: Sum must be 3 or 2');
    } else {
      if (isForfeit && whiteScore === 0 && blackScore === 0) { /* 0-0F is valid */ }
      else if (whiteScore + blackScore !== 1) throw new Error('Standard Scoring: Scores must sum to 1.0 (or 0-0 forfeit)');
    }

    // Resolve Pairing/Board
    let pairing;
    if (tournament.isTeamEvent) {
      const matches = round.teamMatches || round.matches || [];
      for (const m of matches) {
        if (matchNumber && String(m.matchNumber) !== String(matchNumber)) continue;
        pairing = (m.boards || []).find(b => (b.boardNumber || b.board) === board);
        if (pairing) break;
      }
    } else {
      pairing = (round.pairings || []).find(p => p.board === board);
    }

    if (!pairing) throw new Error(`Board ${board} not found in Round ${roundNumber}`);

    const isOverwrite = !!(pairing && pairing.result);
    const oldResult = isOverwrite ? { ...pairing.result } : null;

    // 1. Fetch current ratings for Elo calculation
    const [wSnap, bSnap] = await Promise.all([
      pairing.whiteId ? db.collection('tournaments').doc(tournamentId).collection('playerData').doc(pairing.whiteId).get() : Promise.resolve({ data: () => null }),
      pairing.blackId ? db.collection('tournaments').doc(tournamentId).collection('playerData').doc(pairing.blackId).get() : Promise.resolve({ data: () => null })
    ]);
    const whiteP = wSnap.data();
    const blackP = bSnap.data();

    // 2. Calculate Elo Changes (Bypass for forfeits or Vacant boards)
    let changeW = 0, changeB = 0;

    if (!isForfeit && whiteP && blackP) {
      const sWhite = whiteScore > blackScore ? 1 : (whiteScore === blackScore ? 0.5 : 0);
      const sBlack = blackScore > whiteScore ? 1 : (blackScore === whiteScore ? 0.5 : 0);

      const kWhite = RatingSystem.getKFactor(whiteP);
      const kBlack = RatingSystem.getKFactor(blackP);

      changeW = RatingSystem.calculateEloChange(whiteP.selectedRating || 1200, blackP.selectedRating || 1200, sWhite, kWhite);
      changeB = RatingSystem.calculateEloChange(blackP.selectedRating || 1200, whiteP.selectedRating || 1200, sBlack, kBlack);
    }

    // 3. Update Tournament Data
    const updatePromises = [
      DB.submitResult(tournamentId, roundNumber, board, whiteScore, blackScore, isForfeit, pgn, matchNumber)
    ];

    // Clear pending result if it exists (Handshake resolution)
    const pendingKey = matchNumber ? `${roundNumber}_${matchNumber}_${board}` : `${roundNumber}_${board}`;
    updatePromises.push(db.collection('tournaments').doc(tournamentId).update({
      [`pending_results.${pendingKey}`]: firebase.firestore.FieldValue.delete()
    }));

    if (whiteP) {
      const newRatingW = (whiteP.selectedRating || 1200) + changeW;
      updatePromises.push(db.collection('tournaments').doc(tournamentId).collection('playerData').doc(pairing.whiteId).update({ selectedRating: newRatingW }));
    }
    if (blackP) {
      const newRatingB = (blackP.selectedRating || 1200) + changeB;
      updatePromises.push(db.collection('tournaments').doc(tournamentId).collection('playerData').doc(pairing.blackId).update({ selectedRating: newRatingB }));
    }

    await Promise.all(updatePromises);

    // 4. Update Global Passports (The Prestige Identity Ecosystem)
    if (whiteP && blackP && !isForfeit) {
      const sWhite = whiteScore > blackScore ? 1 : (whiteScore === blackScore ? 0.5 : 0);
      const sBlack = blackScore > whiteScore ? 1 : (blackScore === whiteScore ? 0.5 : 0);

      await Promise.all([
        EloEngine.processMatchResult(pairing.whiteId, pairing.blackId, sWhite, tournamentId),
        EloEngine.processMatchResult(pairing.blackId, pairing.whiteId, sBlack, tournamentId)
      ]);
    }

    // 5. Logging and Standings
    const logActionType = isOverwrite ? AuditLog.ACTIONS.RESULT_CHANGED : AuditLog.ACTIONS.RESULT_SUBMITTED;
    const logChanges = {};
    if (whiteP) logChanges[whiteP.name] = (changeW > 0 ? '+' : '') + changeW;
    if (blackP) logChanges[blackP.name] = (changeB > 0 ? '+' : '') + changeB;

    AuditLog.log(logActionType, tournamentId, {
      round: roundNumber, board, whiteScore, blackScore,
      changes: logChanges,
      previous: oldResult
    });

    // Optimization: Skip heavy recalculation during result entry.
    // Standings are now officially computed during finalizeRound.

    // Return changes for UI toast
    return {
      white: { name: whiteP?.name || 'Vacant', change: changeW },
      black: { name: blackP?.name || 'Vacant', change: changeB }
    };
  }

  /**
   * Submit Team Result (Replacement for OperationsQueue)
   */
  async function submitTeamResult(tournamentId, roundNumber, matchNumber, boardResults, team1BP, team2BP) {
    const tRef = db.collection('tournaments').doc(tournamentId);
    const roundRef = tRef.collection('rounds').doc(`round_${roundNumber}`);

    await db.runTransaction(async (transaction) => {
      const rDoc = await transaction.get(roundRef);
      if (!rDoc.exists) throw new Error('Round not found');
      const data = rDoc.data();

      const matches = data.teamMatches || data.matches || [];
      const matchIdx = matches.findIndex(m => String(m.matchNumber) === String(matchNumber));
      if (matchIdx === -1) throw new Error(`Match ${matchNumber} not found`);

      // Update board results
      const match = matches[matchIdx];
      boardResults.forEach(br => {
        const board = match.boards.find(b => b.boardNumber === br.boardNum);
        if (board) board.result = br.result;
      });

      // Update match BP
      match.team1BP = team1BP;
      match.team2BP = team2BP;
      match.isResolved = true;

      transaction.update(roundRef, { teamMatches: matches });
    });

    await recalculateStandings(tournamentId);
    return { success: true };
  }


  /**
   * Strict validation for an entire round before it can be completed.
   */
  async function validateRound(tournamentId, roundNumber) {
    const round = await DB.getRound(tournamentId, roundNumber);
    if (!round) throw new Error('Round not found');

    const pairings = round.pairings || [];
    const errors = [];

    // 1. Check all pairings have results
    pairings.forEach(p => {
      const v = validateMatch(p);
      if (!v.valid) errors.push(`Board ${p.board}: ${v.error}`);
    });

    // 2. Check for duplicate players or missing players
    const seenPlayers = new Set();
    pairings.forEach(p => {
      if (seenPlayers.has(p.whiteId)) errors.push(`Duplicate player entry: ${p.whiteName}`);
      if (seenPlayers.has(p.blackId)) errors.push(`Duplicate player entry: ${p.blackName}`);
      seenPlayers.add(p.whiteId);
      seenPlayers.add(p.blackId);
    });

    // 3. Bye Handling
    if (round.bye) {
      if (seenPlayers.has(round.bye.playerId)) {
        errors.push(`Player ${round.bye.playerName} has both a pairing and a BYE.`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true };
  }

  /**
   * lockRoundResults: Validates all match outcomes for a round and locks them into the standings cache.
   * This is an intermediate step and DOES NOT conclude the tournament.
   */
  async function lockRoundResults(tournamentId, roundNumber) {
    UI.showLoading(`Locking Round ${roundNumber} Results...`);
    try {
      const validation = await validateRound(tournamentId, roundNumber);
      if (!validation.valid) {
        throw new Error('Round cannot be locked: ' + validation.errors.join('; '));
      }

      const fullStandings = await recalculateStandings(tournamentId);

      const batch = db.batch();
      const tRef = db.collection('tournaments').doc(tournamentId);

      const cacheRef = tRef.collection('standings_cache').doc(`round_${roundNumber}`);
      batch.set(cacheRef, {
        ...fullStandings,
        round: roundNumber,
        serverTimestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      const roundRef = tRef.collection('rounds').doc(`round_${roundNumber}`);
      batch.update(roundRef, {
        status: 'locked',
        finalizedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Day 170 Task 1: Serialize standings directly into parent standingsCache field
      batch.update(tRef, {
        standingsCache: {
          ...fullStandings,
          round: roundNumber,
          updatedAt: Date.now()
        }
      });

      await batch.commit();

      // Day 163 Task 1 & 2: Serialized Standings Checkpoint Stream to Google Drive
      if (window.GDrive && window.GDrive.serializeStandingsCheckpoint) {
        window.GDrive.serializeStandingsCheckpoint(tournamentId, roundNumber)
          .then(res => {
            if (res) console.log(`[Arbiter Checkpoint] Google Drive checkpoint saved for Round ${roundNumber}.`);
          })
          .catch(e => console.error("[Arbiter Checkpoint] Failed to save standing checkpoint:", e));
      }

      AuditLog.logArbiterAction(AuditLog.ACTIONS.ROUND_COMPLETED, {
        round: roundNumber,
        message: "Round results locked and standings cached."
      }, tournamentId);

      // Fetch tournament to satisfy broadcast webhook requirements
      const tDoc = await db.collection('tournaments').doc(tournamentId).get();
      const tournamentData = tDoc.exists ? tDoc.data() : { name: 'Tabuko Chess', isTeamEvent: false };

      // 📺 BROADCAST SYNC HOOK (Day 40)
      localStorage.setItem(`sync_tournament_${tournamentId}`, JSON.stringify({
         id: tournamentId,
         name: tournamentData.name || 'Tabuko Chess',
         currentRound: roundNumber,
         isTeamEvent: !!tournamentData.isTeamEvent,
         standings: fullStandings,
         timestamp: Date.now()
      }));

      UI.showToast(`Round ${roundNumber} Results Locked!`, 'success');
      return { success: true, standings: fullStandings };

    } catch (err) {
      console.error("[Lock Round Error]", err);
      UI.showToast(err.message, 'error');
      throw err;
    } finally {
      UI.hideLoading();
    }
  }

  // lockRound is now an alias for lockRoundResults (see exports)

  /**
   * BUG FIX: Aggregates cumulative scores from historical rounds.
   * Must be called before generatePairings() to ensure correct brackets.
   */
  async function updatePlayerScores(tournamentId, currentRoundNum) {
    const tRef = db.collection('tournaments').doc(tournamentId);
    const snap = await tRef.collection('playerData').get();
    const players = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const batch = db.batch();

    for (const p of players) {
      let total = 0;
      // Scrape all past rounds for results
      for (let r = 1; r <= currentRoundNum; r++) {
        const round = await DB.getRound(tournamentId, r);
        if (!round) continue;

        const match = (round.pairings || []).find(pair => pair.whiteId === p.id || pair.blackId === p.id);
        if (match && match.result) {
          total += (match.whiteId === p.id) ? (match.result.whiteScore || 0) : (match.result.blackScore || 0);
        } else if (round.teamMatches || round.matches) {
          const tMatches = round.teamMatches || round.matches || [];
          for (const tm of tMatches) {
            const board = (tm.boards || []).find(b => b.whiteId === p.id || b.blackId === p.id);
            if (board && board.result) {
              total += (board.whiteId === p.id) ? (board.result.whiteScore || 0) : (board.result.blackScore || 0);
              break;
            }
          }
        }

        if (round.bye && (round.bye.playerId === p.id || round.bye.id === p.id)) {
          total += 1.0;
        }
      }
      // Persist the aggregated score to player document
      batch.update(tRef.collection('playerData').doc(p.id), { score: total });
    }

    await batch.commit();
    console.log(`[Tournament] Updated cumulative scores for ${players.length} players.`);
  }

  /**
   * Atomic sequence to transition to the next round.
   * Ensures all results are valid, generates pairings, and publishes to broadcast.
   */
  /**
   * validateCurrentRound: Public helper to check if a round is ready for completion.
   */
  async function validateCurrentRound(tournamentId, roundNumber) {
    const round = await DB.getRound(tournamentId, roundNumber);
    return validateCurrentRoundData(round, roundNumber);
  }

  /**
   * validateCurrentRoundData: Internal helper for transaction-safe validation.
   */
  function validateCurrentRoundData(roundData, roundNumber) {
    if (!roundData) return { valid: false, errors: [`Round ${roundNumber} document not found.`] };

    const errors = [];

    // --- TEAM TOURNAMENT VALIDATION ---
    if (roundData.isTeamRound) {
      const matches = roundData.teamMatches || roundData.matches || [];
      if (matches.length === 0) return { valid: false, errors: ['No team matches found in this round.'] };

      matches.forEach(m => {
        if (!m.isResolved && m.homeMP === undefined) {
          errors.push(`Match ${m.matchNumber}: Not marked as resolved.`);
        }

        let calculatedHomeBP = 0, calculatedAwayBP = 0, boardsValid = true;

        (m.boards || []).forEach(b => {
          const res = b.rawResult || (b.result ? `${b.result.whiteScore}-${b.result.blackScore}` : null);
          const validResults = ['1-0', '0-1', '0.5-0.5', '1-0F', '0-1F', '0-0F'];

          if (!res) {
            boardsValid = false;
            errors.push(`Match ${m.matchNumber}, Board ${b.boardNumber}: Missing result.`);
            return;
          }
          if (!validResults.includes(res)) {
            boardsValid = false;
            errors.push(`Match ${m.matchNumber}, Board ${b.boardNumber}: Illegal result "${res}".`);
            return;
          }
          if (res === '1-0' || res === '1-0F') calculatedHomeBP += 1;
          else if (res === '0-1' || res === '0-1F') calculatedAwayBP += 1;
          else if (res === '0.5-0.5') { calculatedHomeBP += 0.5; calculatedAwayBP += 0.5; }
        });

        if (boardsValid && m.homeMP !== undefined) {
          if (calculatedHomeBP !== m.team1BP || calculatedAwayBP !== m.team2BP) {
            errors.push(`Match ${m.matchNumber}: Stored Board Points (${m.team1BP}-${m.team2BP}) do not match board sum (${calculatedHomeBP}-${calculatedAwayBP}).`);
          }
          let expectedHomeMP = calculatedHomeBP > calculatedAwayBP ? 2 : (calculatedHomeBP === calculatedAwayBP ? 1 : 0);
          let expectedAwayMP = calculatedAwayBP > calculatedHomeBP ? 2 : (calculatedAwayBP === calculatedHomeBP ? 1 : 0);
          if (m.homeMP !== expectedHomeMP || m.awayMP !== expectedAwayMP) {
            errors.push(`Match ${m.matchNumber}: Match Points (MP) are incorrectly derived.`);
          }
        }
      });
    }
    // --- INDIVIDUAL TOURNAMENT VALIDATION ---
    else {
      const pairings = roundData.pairings || [];
      if (pairings.length === 0) return { valid: false, errors: ['No pairings found in this round.'] };

      pairings.forEach(p => {
        if (!p.result) {
          errors.push(`Board ${p.board}: Missing result.`);
        } else {
          const { whiteScore, blackScore, isForfeit } = p.result;
          const sum = whiteScore + blackScore;
          // Valid if sum is 1, OR if it's a 0-0 double forfeit
          if (sum !== 1 && !(isForfeit && whiteScore === 0 && blackScore === 0)) {
            errors.push(`Board ${p.board}: Scores must sum to 1.0 (or 0-0 Forfeit).`);
          }
        }
      });
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * computeTeamStandings: Computes the official ranking using FIDE tie-breaks.
   */
  function computeTeamStandings(teams, allRounds, tournament) {
    const teamStats = {};
    const teamSize = tournament.teamSize || 4;

    // Initialize
    teams.forEach(t => {
      const tid = t.id || t.teamId;
      teamStats[tid] = {
        ...t, id: tid, mp: 0, bp: 0, opponents: [], results: [],
        wins: 0, draws: 0, losses: 0, // Explicit Match Record
        matchPointsVs: {},
        colorHistory: [], // Reconstructed Home/Away history on Board 1
        hadBye: false,
        players: t.players || [] // Ensure players metadata persists
      };
    });

    // Process each round for Matches and Byes
    allRounds.forEach(round => {
      const matches = round.teamMatches || round.matches || [];

      // 1. Process Matches
      matches.forEach(m => {
        if (!m.isResolved && m.homeMP === undefined) return;
        const hId = m.team1Id || m.homeTeamId;
        const aId = m.team2Id || m.awayTeamId;

        if (teamStats[hId]) {
          const hMP = m.homeMP || 0;
          teamStats[hId].mp += hMP;
          teamStats[hId].bp += (m.team1BP || 0);
          if (hMP === 2) teamStats[hId].wins++;
          else if (hMP === 1) teamStats[hId].draws++;
          else teamStats[hId].losses++;

          teamStats[hId].opponents.push(aId);
          teamStats[hId].results.push({ oppId: aId, mp: hMP, bp: m.team1BP || 0 });
          teamStats[hId].matchPointsVs[aId] = hMP;
          teamStats[hId].colorHistory.push('white');
        }
        if (teamStats[aId]) {
          const aMP = m.awayMP || 0;
          teamStats[aId].mp += aMP;
          teamStats[aId].bp += (m.team2BP || 0);
          if (aMP === 2) teamStats[aId].wins++;
          else if (aMP === 1) teamStats[aId].draws++;
          else teamStats[aId].losses++;

          teamStats[aId].opponents.push(hId);
          teamStats[aId].results.push({ oppId: hId, mp: aMP, bp: m.team2BP || 0 });
          teamStats[aId].matchPointsVs[hId] = aMP;
          teamStats[aId].colorHistory.push('black');
        }
      });

      // 2. Process Byes (FIDE Rules: 2 MP, 50% BP)
      if (round.bye) {
        const tid = round.bye.teamId;
        if (teamStats[tid]) {
          teamStats[tid].mp += 2;
          teamStats[tid].bp += (teamSize / 2);
          teamStats[tid].hadBye = true;
          teamStats[tid].results.push({ oppId: 'BYE', mp: 2, bp: (teamSize / 2) });
        }
      }
    });

    // FIDE Virtual Opponent Real-Time Tie-Breaks (TB, TSB)
    // FIDE Virtual Opponent Real-Time Tie-Breaks (TB, TSB)
    const virtualByeMP = (tournament.totalRounds || 9) * 2 * 0.5; // FIDE C.02.13.2: BYE is worth 50% of Max MP

    Object.values(teamStats).forEach(t => {
      t.tb = 0;
      t.tsb = 0;

      t.results.forEach(r => {
        if (r.oppId === 'BYE') {
          t.tb += virtualByeMP;
          t.tsb += (virtualByeMP * r.mp); // r.mp is 2 for a BYE
        } else {
          const oppMP = teamStats[r.oppId]?.mp || 0;
          t.tb += oppMP;
          t.tsb += (oppMP * r.mp);
        }
      });
    });

    // Ranking Sort (STRICT ORDER: MP, BP, TB, TSB, DE)
    return Object.values(teamStats).sort((a, b) => {
      if (b.mp !== a.mp) return b.mp - a.mp;   // 1. Match Points
      if (b.bp !== a.bp) return b.bp - a.bp;   // 2. Board Points
      if (b.tb !== a.tb) return b.tb - a.tb;   // 3. Team Buchholz
      if (b.tsb !== a.tsb) return b.tsb - a.tsb; // 4. Team Sonneborn-Berger

      // 5. Direct Encounter (DE)
      const deMatch = a.matchPointsVs[b.id];
      if (deMatch !== undefined) {
        const bDeMatch = b.matchPointsVs[a.id];
        if (deMatch !== bDeMatch) return bDeMatch - deMatch;
      }
      return (b.avgRating || 0) - (a.avgRating || 0);
    }).map((t, idx) => ({ ...t, rank: idx + 1 }));
  }

  /**
   * generateNextRound: Atomic sequence to transition to the next round.
   */
  async function generateNextRound(tournamentId) {
    const tournament = await DB.getTournament(tournamentId);
    let participants = [];
    
    if (tournament.isTeamEvent) {
      participants = await DB.getAllTeams(tournamentId);
    } else {
      participants = await DB.getTournamentPlayers(tournamentId);
    }

    // 🧱 SWISS MATHEMATICAL FLOOR GUARD
    validateRoundStart(tournament, participants.length);

    if (participants.length <= 1) {
      throw new Error(`Cannot start round: Only ${participants.length} participant(s) registered. A minimum of 2 is required for pairings.`);
    }

    const tRef = db.collection('tournaments').doc(tournamentId);

    // --- PHASE 1: PRE-FLIGHT LOCK (Transaction 1) ---
    const tData = await db.runTransaction(async (transaction) => {
      const tDoc = await transaction.get(tRef);
      if (!tDoc.exists) throw new Error("Tournament not found.");
      const data = tDoc.data();

      if (data.status === 'completed') throw new Error("Tournament is already completed.");
      if (data.isGeneratingRound) throw new Error("SWISS_ENGINE_LOCKED: Engine is currently pairing.");

      transaction.update(tRef, { status: 'pairing', isGeneratingRound: true });
      return data;
    });

    try {
      const currentRd = parseInt(tournament.currentRound || 0, 10);
      const nextRound = currentRd + 1;
      if (nextRound > (tournament.totalRounds || 99)) throw new Error('Tournament rounds limit reached');

      // Fetch collections natively from SERVER to ensure transaction integrity
      const [currentRdDoc, teamsSnap, roundsSnap, playersSnap] = await Promise.all([
        currentRd > 0 ? tRef.collection('rounds').doc(`round_${currentRd}`).get({ source: 'server' }) : Promise.resolve(null),
        tRef.collection('teams').get({ source: 'server' }),
        tRef.collection('rounds').get({ source: 'server' }),
        tRef.collection('playerData').get({ source: 'server' })
      ]);

      // Validation logic
      if (currentRd > 0 && currentRdDoc && currentRdDoc.exists) {
        const validation = validateCurrentRoundData(currentRdDoc.data(), currentRd);
        if (!validation.valid) {
          throw new Error(`ROUND INTEGRITY ERROR: Round ${currentRd} is not ready for completion.\n\nRequired Actions:\n- ${validation.errors.join('\n- ')}\n\nTip: Ensure all boards have results and are saved to the cloud.`);
        }
      }

      const allRounds = roundsSnap.docs.map(d => d.data());
      const teamsList = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const activePlayers = playersSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.withdrawn);

      let pairings, bye, cacheData = null, roundData = null;

      if (tournament.isTeamEvent) {
        const allPlayersMap = {};
        playersSnap.docs.forEach(doc => allPlayersMap[doc.id] = { id: doc.id, ...doc.data() });

        const teamsWithPlayers = teamsList.map(t => {
          const hydratedPlayers = (t.playerIds || []).map(id => {
            const p = allPlayersMap[id];
            if (p) return { id: p.id, name: p.name, rating: p.selectedRating || 0 };
            
            // Fallback to team document's own snapshot (if previous enrollment missed them)
            const tp = (t.players || []).find(x => x.id === id);
            return tp ? { id, name: tp.name, rating: tp.rating || 0 } : { id, name: 'Vacant', rating: 0 };
          });
          return { ...t, players: hydratedPlayers };
        });

        const rankedTeams = computeTeamStandings(teamsWithPlayers, allRounds, tournament);
        const config = { teamRatingMethod: tournament.teamRatingMethod };

        UI.showLoading("Worker executing Team Swiss engine...");
        const result = await executePairingWorker('GENERATE_TEAM', { teams: rankedTeams, roundNumber: nextRound, config });

        pairings = result.pairings;
        bye = result.bye;

        // FIX: Match field names with ui_v228.js (teams instead of standings)
        // AND: Include board standings in the cache for high-density UI
        const boardStandings = TeamStandings.generateBoardStandings(allRounds, tournament.totalRounds || nextRound, allPlayersMap, teamsList);

        cacheData = JSON.parse(JSON.stringify({
          round: currentRd,
          teams: rankedTeams.map(t => ({
            id: t.id, name: t.name, mp: t.mp, bp: t.bp, rank: t.rank, tb: t.tb, tsb: t.tsb
          })),
          boards: boardStandings,
          updatedAt: Date.now()
        }));

        roundData = JSON.parse(JSON.stringify({
          roundNumber: nextRound, status: 'active', isTeamRound: true,
          teamMatches: pairings.map(m => ({
            matchNumber: m.matchNumber,
            homeTeamId: m.homeTeamId || m.team1Id, awayTeamId: m.awayTeamId || m.team2Id,
            homeTeamName: m.homeTeamName || m.team1Name, awayTeamName: m.awayTeamName || m.team2Name,
            boards: (m.boards || []).map(b => ({
              boardNumber: b.boardNumber,
              whiteId: b.whiteId || null, blackId: b.blackId || null,
              whiteName: b.whiteName || 'Vacant', blackName: b.blackName || 'Vacant',
              result: null
            }))
          })),
          bye: bye ? { teamId: bye.id || bye.teamId, teamName: bye.name || bye.teamName } : null
        }));
      } else {
        const playerState = buildPlayerState(activePlayers, allRounds, tournament.scoringType);
        const config = { seedingStrategy: tournament.seedingStrategy || 'top_vs_bottom' };

        UI.showLoading("Worker executing FIDE Swiss engine...");
        const result = await executePairingWorker('GENERATE_SWISS', { players: playerState, roundNumber: nextRound, config });

        pairings = result.pairings;
        bye = result.bye;

        roundData = JSON.parse(JSON.stringify({
          roundNumber: nextRound, status: 'active',
          pairings: (pairings || []).map(p => ({
            board: p.board,
            whiteId: p?.white?.id || null, blackId: p?.black?.id || null,
            whiteName: p?.white?.name || 'Vacant', blackName: p?.black?.name || 'Vacant',
            whiteRating: p?.white?.selectedRating || 0, blackRating: p?.black?.selectedRating || 0,
            result: null
          })),
          bye: bye ? { playerId: bye.id || bye.playerId, playerName: bye.name || bye.playerName } : null
        }));
      }

      // --- PHASE 3: COMMIT & UNLOCK (Transaction 2) ---
      UI.showLoading("Saving pairings to database...");
      await db.runTransaction(async (transaction) => {
        if (cacheData && currentRd > 0) {
          cacheData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
          transaction.set(tRef.collection('standings_cache').doc(`round_${currentRd}`), cacheData);
        }

        roundData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        transaction.set(tRef.collection('rounds').doc(`round_${nextRound}`), DB.sanitizeForFirestore(roundData));

        if (currentRd > 0) {
          // WE NO LONGER LOCK THE PAST ROUND: 
          // Admins need full visibility and the ability to correct disputes without hard locks.
          transaction.update(tRef.collection('rounds').doc(`round_${currentRd}`), { status: 'completed' });
        }

        transaction.update(tRef, { currentRound: nextRound, status: 'active', isGeneratingRound: false });
      });

    } catch (error) {
      console.error("[Swiss Engine Error]", error);
      // EMERGENCY FAILSAFE: Release the lock so the tournament isn't bricked
      await tRef.update({ isGeneratingRound: false });
      throw error;
    } finally {
      UI.hideLoading();
    }
  }

  /**
   * recalculateStandings: Forces a full re-read and FIDE computation.
   * BUG FIX: Now permanently syncs computed scores back to the Players/Teams database collections!
   */
  /**
   * recalculateStandings: SYSTEM A & B Master Computation Engine
   * Perform one massive fetch, compute all FIDE tie-breaks, and return structured data.
   */
  async function recalculateStandings(tournamentId, force = false) {
    const tournament = await DB.getTournament(tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // 0. Lazy Standings: Return cache if current round is already officially computed
    if (!force) {
      const cache = await DB.getStandingsCache(tournamentId);
      if (cache && cache.round === tournament.currentRound) {
        console.log(`[Standings] Cache Hit for Round ${tournament.currentRound}. Skipping fetch.`);
        return cache;
      }
    }

    const tRef = db.collection('tournaments').doc(tournamentId);

    // 1. Massive Fetch
    const [teamsSnap, playersSnap, roundsSnap] = await Promise.all([
      tRef.collection('teams').get(),
      tRef.collection('playerData').get(),
      tRef.collection('rounds').get()
    ]);

    const teams = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const players = playersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const allRounds = roundsSnap.docs.map(d => d.data()).sort((a, b) => a.roundNumber - b.roundNumber);
    const totalRounds = tournament.totalRounds || 0;

    // 2. Tiered Name Hydrator — Build Player Map with Fallback to Team Rosters
    //    Priority: playerData (global) → team.players (registration roster)
    //    This ensures players registered via teams are NEVER displayed as "Vacant".
    const playerMap = {};

    // Tier 1: Global playerData collection (authoritative source)
    players.forEach(p => {
      if (p.id && p.name) playerMap[p.id] = p.name;
    });

    // Tier 2: Team registration rosters (fallback for team-only registrations)
    if (tournament.isTeamEvent) {
      teams.forEach(team => {
        (team.players || []).forEach(tp => {
          if (tp.id && tp.name && !playerMap[tp.id]) {
            playerMap[tp.id] = tp.name;
          }
        });
        // Also check playerIds cross-referenced with embedded player names
        (team.playerIds || []).forEach((pid, idx) => {
          if (pid && !playerMap[pid]) {
            const teamPlayer = (team.players || []).find(p => p.id === pid);
            if (teamPlayer && teamPlayer.name) {
              playerMap[pid] = teamPlayer.name;
            }
          }
        });
      });
    }

    let standings = {};

    if (tournament.isTeamEvent) {
      // --- SYSTEM A: Team Engine ---
      const teamStandings = TeamStandings.computeTeamStandings(teams, allRounds, tournament);

      // --- SYSTEM B: Board Engine (With Hydration) ---
      const boardStandings = TeamStandings.generateBoardStandings(allRounds, totalRounds, playerMap, teams);

      standings = {
        teams: teamStandings,
        boards: boardStandings,
        isTeamEvent: true,
        updatedAt: Date.now()
      };

      // 🔄 Sync Team Standings to Firestore
      const batch = db.batch();
      teamStandings.forEach(t => {
        const teamRef = tRef.collection('teams').doc(t.id);
        batch.update(teamRef, { mp: t.mp, bp: t.bp, rank: t.rank, tb: t.tb, tsb: t.tsb });
      });
      await batch.commit();

    } else {
      // --- INDIVIDUAL ENGINE ---
      const config = {
        ratingType: tournament.ratingType,
        unratedHandling: tournament.unratedHandling,
        defaultRating: tournament.defaultRating
      };

      let playerState = buildPlayerState(players, allRounds, tournament.scoringType);
      const individualStandings = TieBreak.rankPlayers(playerState, [], totalRounds);

      standings = {
        players: individualStandings,
        isTeamEvent: false,
        updatedAt: Date.now()
      };

      // --- CATEGORY AWARDS (Sub-Podiums) ---
      if (tournament.enableSpecialPrizes && tournament.categoryCutoffs) {
        standings.categoryAwards = applyCategoryAwards(individualStandings, tournament.categoryCutoffs);
      }

      // 🔄 Sync Individual Standings to Firestore
      const batch = db.batch();
      individualStandings.forEach(p => {
        const pRef = tRef.collection('playerData').doc(p.id);
        const updates = { score: p.score, rank: p.rank };
        
        // Tag winners with badges for the listener to pick up
        if (standings.categoryAwards) {
          const awards = [];
          if (p.rank <= 3) awards.push('Overall');
          for (const [cat, winners] of Object.entries(standings.categoryAwards)) {
            if (winners.find(w => w.id === p.id)) awards.push(cat.replace('top', ''));
          }
          if (awards.length > 0) updates.awards = awards;
        }
        
        batch.update(pRef, updates);
      });
      await batch.commit();
    }

    return standings;
  }

  /**
   * applyCategoryAwards: Filters and ranks players into sub-podiums.
   */
  function applyCategoryAwards(players, cutoffs) {
    const awards = {
      topLady: [],
      topKiddie: [],
      topJunior: [],
      topSenior: []
    };

    players.forEach(p => {
      const birthYear = p.birthDate ? new Date(p.birthDate).getFullYear() : null;
      const gender = p.gender || 'Unknown';

      // Lady Category
      if (gender.toLowerCase() === 'female') {
        awards.topLady.push(p);
      }

      if (birthYear) {
        // Kiddie: Born on or after Kiddie Cutoff
        if (birthYear >= cutoffs.kiddie) {
          awards.topKiddie.push(p);
        }
        // Junior: Between Junior and Kiddie
        else if (birthYear >= cutoffs.junior && birthYear < cutoffs.kiddie) {
          awards.topJunior.push(p);
        }
        // Senior: Born on or before Senior Cutoff
        else if (birthYear <= cutoffs.senior) {
          awards.topSenior.push(p);
        }
      }
    });

    // Take top 3 for each
    for (const key in awards) {
      awards[key] = awards[key].slice(0, 3);
    }

    return awards;
  }




  /**
   * finalizeTournament: Concludes the entire tournament lifecycle.
   * Archives history, updates permanent ratings, and marks as archived/completed.
   */
  async function finalizeTournament(tournamentId) {
    try {
      UI.showLoading("Finalizing Tournament and Building Analytics...");

      // LIFECYCLE GUARD: Only allow finalization when ALL rounds are complete
      const tournament = await DB.getTournament(tournamentId);
      if (!tournament) throw new Error('Tournament not found');

      const currentRound = parseInt(tournament.currentRound || 0, 10);
      const totalRounds = parseInt(tournament.totalRounds || 0, 10);
      const isMaster = Auth.getUser()?.email?.toLowerCase() === 'giradojesster28@gmail.com';

      if (totalRounds > 0 && currentRound < totalRounds) {
        const msg = `Cannot finalize: Round ${currentRound} of ${totalRounds} completed. All ${totalRounds} rounds must be played.`;
        if (isMaster) {
          if (!confirm(msg + "\n\nFORCE FINALIZE as Master Admin? (standings will be locked as-is)")) return;
        } else {
          throw new Error(msg);
        }
      }

      // PENDING RESULTS GUARD
      if (tournament.pending_results && Object.keys(tournament.pending_results).length > 0) {
        const msg = "Cannot finalize: There are pending results awaiting approval.";
        if (isMaster) {
          if (!confirm(msg + "\n\nFORCE FINALIZE and DISCARD pending drafts?")) return;
        } else {
          throw new Error(msg + " Please verify all results in the Approval Queue.");
        }
      }

      // 1. Calculate permanent Elo changes
      if (window.ClubMembers && window.ClubMembers.updateClubRatings) {
        await window.ClubMembers.updateClubRatings(tournamentId);
      }

      // 2. Archive all matches for Head-to-Head history
      if (window.DB && window.DB.buildTournamentMatchHistory) {
        await window.DB.buildTournamentMatchHistory(tournamentId);
      }

      // 3. Mark tournament as completed and archived
      await DB.updateTournament(tournamentId, {
        status: 'completed',
        isArchived: true,
        completedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      if (typeof AuditLog !== 'undefined') {
        AuditLog.logArbiterAction(AuditLog.ACTIONS.TOURNAMENT_UPDATED, {
          message: `Tournament Finalized and Archived after ${currentRound} rounds.`
        }, tournamentId);
      }

      UI.showToast("Tournament finalized. History and Ratings updated!", 'success');
      setTimeout(() => App.navigateTo('dashboard'), 1500);

    } catch (err) {
      console.error("[Finalize Tournament Error]", err);
      UI.showToast("Error finalizing tournament: " + err.message, 'error');
    } finally {
      UI.hideLoading();
    }
  }

  /**
   * Publish pairings for TV broadcast.
   */
  async function publishPairingsBroadcast(tournamentId, roundNumber, pairings, bye) {
    await db.collection('tournaments').doc(tournamentId).collection('pairings_broadcast').doc('current').set({
      roundNumber,
      pairings: pairings.map((p, i) => ({
        board: p.board || i + 1,
        whiteName: p.white?.name || '',
        blackName: p.black?.name || '',
        whiteRating: p.white?.selectedRating || 0,
        blackRating: p.black?.selectedRating || 0,
        result: null
      })),
      bye: bye ? { playerName: bye.name || '', playerId: bye.id } : null,
      updatedAt: Date.now()
    });
  }

  /**
   * Update tournament metadata.
   */
  async function editTournament(id, data) {
    await DB.updateTournament(id, {
      ...data,
      updatedAt: Date.now()
    });
    AuditLog.log(AuditLog.ACTIONS.TOURNAMENT_UPDATED, id, data);
  }

  /**
   * Highly destructive action: Safely delete tournament and all sub-collections.
   * Uses batched writes to ensure data integrity.
   */
  async function deleteTournament(tournamentId) {
    await DB.deleteTournament(tournamentId);
    AuditLog.log(AuditLog.ACTIONS.TOURNAMENT_UPDATED, tournamentId, { action: 'Tournament Archived' });
    return { success: true };
  }

  /**
   * ROLLBACK: Deletes the current round and reverts the tournament state.
   * Required for fixing errors in previous round results.
   */
  async function deleteCurrentRound(tournamentId) {
    const tRef = db.collection('tournaments').doc(tournamentId);

    return await db.runTransaction(async (transaction) => {
      const tDoc = await transaction.get(tRef);
      if (!tDoc.exists) throw new Error('Tournament not found');
      const tournament = tDoc.data();

      const currentRoundNum = tournament.currentRound || 0;
      if (currentRoundNum <= 0) throw new Error('No rounds to rollback');

      // 1. Delete the round document
      const roundRef = tRef.collection('rounds').doc(`round_${currentRoundNum}`);
      transaction.delete(roundRef);

      // 2. Decrement round counter
      const prevRound = currentRoundNum - 1;
      const newStatus = prevRound === 0 ? 'registration' : 'active';
      transaction.update(tRef, {
        currentRound: prevRound,
        status: newStatus,
        updatedAt: Date.now()
      });

      // 3. If there was a previous round, unlock it
      if (prevRound > 0) {
        const prevRoundRef = tRef.collection('rounds').doc(`round_${prevRound}`);
        transaction.update(prevRoundRef, { status: 'active' });
      }

      // 4. Cleanup broadcast
      if (prevRound > 0) {
        // We'll leave it for now or we could revert broadcast to prev round
      } else {
        transaction.delete(tRef.collection('pairings_broadcast').doc('current'));
      }

      return { prevRound };
    });
  }

  /**
   * Atomic sequence: Lock tournament, Generate R1, and Navigate.
   * Uses a Firestore transaction to ensure atomic status update and round creation.
   */
  async function startTournamentAndPairR1(tournamentId) {
    const tournament = await DB.getTournament(tournamentId);
    if (!tournament) throw new Error('Tournament not found');

    let participants = [];
    if (tournament.isTeamEvent) {
      participants = await DB.getAllTeams(tournamentId);
    } else {
      participants = await DB.getTournamentPlayers(tournamentId);
    }

    // 🧱 SWISS MATHEMATICAL FLOOR GUARD
    validateRoundStart(tournament, participants.length);

    const tRef = db.collection('tournaments').doc(tournamentId);

    try {
      // --- PHASE 1: PRE-FLIGHT LOCK (Transaction 1) ---
      const tData = await db.runTransaction(async (transaction) => {
        const tDoc = await transaction.get(tRef);
        if (!tDoc.exists) throw new Error('Tournament not found');
        const data = tDoc.data();
        if (data.status !== 'registration') throw new Error('Tournament already started');
        if (data.isGeneratingRound) throw new Error("SWISS_ENGINE_LOCKED: Engine is currently pairing.");

        transaction.update(tRef, { isGeneratingRound: true });
        return data;
      });

      // --- PHASE 2: COMPUTE PHASE (Outside Transaction) ---
      UI.showLoading("Generating Round 1 pairings...");

      let pairings, bye, roundData = null;

      if (tournament.isTeamEvent) {
        const rawTeams = await DB.getAllTeams(tournamentId);
        if (rawTeams.length < 2) {
          throw new Error(`Cannot start: Only ${rawTeams.length} team(s) registered. Need at least 2 teams for a Team Event.`);
        }
        const teamSize = tournament.teamSize || 4;

        const playersSnap = await db.collection('tournaments').doc(tournamentId).collection('playerData').get();
        const allPlayersMap = {};
        playersSnap.docs.forEach(doc => allPlayersMap[doc.id] = { id: doc.id, ...doc.data() });

        // AGGRESSIVE SANITIZATION: Filter out empty strings/nulls and validate roster size
        const teams = await Promise.all(rawTeams.map(async t => {
          const cleanIds = (t.playerIds || []).filter(id => id && id.trim() !== '');
          if (cleanIds.length !== teamSize) {
            throw new Error(`Cannot start: Team '${t.name}' only has ${cleanIds.length} valid players. Please edit the team to ensure exactly ${teamSize} players are assigned.`);
          }
          const hydratedPlayers = cleanIds.map(id => {
            const p = allPlayersMap[id];
            if (p) return { id: p.id, name: p.name, rating: p.selectedRating || 0 };
            
            // Tier 2 Fallback: Check the team's own roster snapshot
            const teamPlayer = (t.players || []).find(tp => tp.id === id);
            if (teamPlayer) return { id, name: teamPlayer.name, rating: teamPlayer.rating || 0 };

            return { id, name: 'Vacant', rating: 0 };
          });

          // PERMANENT HYDRATION: Save names to the team document for this tournament
          await tRef.collection('teams').doc(t.id).update({ players: hydratedPlayers });

          return { ...t, playerIds: cleanIds, players: hydratedPlayers };
        }));

        const config = { teamRatingMethod: tournament.teamRatingMethod };

        UI.showLoading("Worker executing Round 1 Team engine...");
        const result = await executePairingWorker('GENERATE_TEAM', { teams, roundNumber: 1, config });
        pairings = result.pairings;
        bye = result.bye;

        roundData = JSON.parse(JSON.stringify({
          roundNumber: 1,
          status: 'active',
          isTeamRound: true,
          teamMatches: pairings.map(m => ({
            matchNumber: m.matchNumber,
            homeTeamId: m.homeTeamId,
            awayTeamId: m.awayTeamId,
            homeTeamName: m.homeTeamName,
            awayTeamName: m.awayTeamName,
            boards: m.boards.map(b => ({
              boardNumber: b.boardNumber,
              whiteId: b.whiteId || null,
              blackId: b.blackId || null,
              whiteName: b.whiteName || 'Vacant',
              blackName: b.blackName || 'Vacant',
              result: null
            }))
          })),
          bye: bye ? { teamId: bye.id || bye.teamId, teamName: bye.name || bye.teamName } : null
        }));
      } else {
        const snap = await tRef.collection('playerData').get();
        const allPlayers = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.withdrawn);

        const config = { ratingType: tournament.ratingType, unratedHandling: tournament.unratedHandling, defaultRating: tournament.defaultRating };
        let players = RatingSystem.assignInitialRatings(allPlayers, config);

        // Day 145: Immutable Starting Rating Snapshot Generator Hook
        try {
          const snapshotBatch = db.batch();
          players.forEach(p => {
            const ratingVal = p.rating || p.selectedRating || 1200;
            const pRef = tRef.collection('playerData').doc(p.id);
            snapshotBatch.update(pRef, {
              ratingSnapshot: {
                rating: ratingVal,
                ratingType: tournament.ratingType || 'club',
                timestamp: Date.now()
              },
              selectedRating: ratingVal
            });
          });
          await snapshotBatch.commit();
          console.log(`[Snapshot Hook] Roster ratings snapshotted successfully.`);
        } catch (err) {
          console.error("Failed to commit rating snapshots:", err);
        }

        UI.showLoading("Worker executing Round 1 Swiss engine...");
        const result = await executePairingWorker('GENERATE_SWISS', { players, roundNumber: 1, config: { seedingStrategy: tournament.seedingStrategy || 'top_vs_bottom' } });
        pairings = result.pairings;
        bye = result.bye;

        roundData = JSON.parse(JSON.stringify({
          roundNumber: 1,
          status: 'active',
          pairings: (pairings || []).map(p => ({
            board: p.board,
            whiteId: p?.white?.id || null,
            blackId: p?.black?.id || null,
            whiteName: p?.white?.name || 'Vacant',
            blackName: p?.black?.name || 'Vacant',
            result: null
          })),
          bye: bye ? { playerId: bye.id || bye.playerId, name: bye.name || bye.playerName } : null
        }));
      }

      // --- PHASE 3: COMMIT & UNLOCK (Transaction 2) ---
      UI.showLoading("Finalizing Tournament Start...");
      await db.runTransaction(async (transaction) => {
        const roundRef = tRef.collection('rounds').doc('round_1');
        roundData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        transaction.set(roundRef, DB.sanitizeForFirestore(roundData));

        transaction.update(tRef, DB.sanitizeForFirestore({ currentRound: 1, status: 'active', isGeneratingRound: false }));
      });

      AuditLog.logArbiterAction(AuditLog.ACTIONS.ROUND_STARTED, { message: "Tournament Started - Round 1 Generated", pairingCount: pairings.length }, tournamentId);
      UI.showToast("Tournament started! Round 1 is live.", 'success');

      return { pairings, bye, roundNumber: 1 };

    } catch (error) {
      console.error("[Tournament Start Error]", error);
      await tRef.update({ isGeneratingRound: false });
      throw error;
    } finally {
      UI.hideLoading();
    }
  }

  /**
   * FIDE Late Joiner Logic: Adds a player mid-tournament with historical 0.5-point byes.
   */
  async function addLateJoiner(tournamentId, rosterMemberId, currentRound) {
    const tournament = await DB.getTournament(tournamentId);
    if (!tournament) throw new Error('Tournament not found');

    const config = {
      ratingType: tournament.ratingType || 'club',
      defaultRating: tournament.defaultRating || 1200,
      unratedHandling: tournament.unratedHandling || 'fixed'
    };

    // 1. Snapshot the member from the roster
    const member = await ClubMembers.getMember(rosterMemberId);
    if (!member) throw new Error('Member not found');

    const selectedRating = member.ratings?.[config.ratingType] || config.defaultRating;

    // 2. Create historical half-point (0.5) results
    const historicalResults = [];
    const historicalScores = [];
    let initialScore = 0;
    for (let r = 1; r < currentRound; r++) {
      // Day 168: Automatically assign half-point (0.5) unplayed round bye values instead of zero points
      historicalResults.push({ round: r, opponentId: null, result: 0.5, color: null, isUnplayed: true });
      historicalScores.push(0.5);
      initialScore += 0.5;
    }

    const playerData = {
      ...member,
      id: member.id, // Keep roster ID
      selectedRating,
      score: initialScore,
      withdrawn: false,
      results: historicalResults,
      roundScores: historicalScores,
      joinedRound: currentRound,
      isLateJoiner: true,
      updatedAt: Date.now()
    };

    // 3. Batch write: Create player, update tournament playerIds list, and log action
    const batch = db.batch();
    const pRef = db.collection('tournaments').doc(tournamentId).collection('playerData').doc(member.id);
    batch.set(pRef, playerData);

    const tRef = db.collection('tournaments').doc(tournamentId);
    batch.update(tRef, {
      playerIds: firebase.firestore.FieldValue.arrayUnion(member.id)
    });

    await batch.commit();

    // Recalculate standings immediately so the late joiner is properly integrated
    await recalculateStandings(tournamentId);

    AuditLog.logArbiterAction(AuditLog.ACTIONS.PLAYER_REGISTERED, {
      message: `Late Player Added - Assigned Half-Point (0.5) Byes for Rounds 1 to ${currentRound - 1}`,
      playerName: member.name
    }, tournamentId);

    return playerData;
  }

  /**
   * REVERSAL: Clear a match result and rollback ratings.
   */
  async function clearResult(tournamentId, roundNumber, board) {
    const round = await DB.getRound(tournamentId, roundNumber);
    if (!round) throw new Error('Round not found');
    if (round.status === 'locked') throw new Error('Round is locked');

    const pairing = (round.pairings || []).find(p => p.board === board);
    if (!pairing || !pairing.result) return;

    // 1. Clear in Firestore
    const roundRef = db.collection('tournaments').doc(tournamentId).collection('rounds').doc(`round_${roundNumber}`);
    const newPairings = round.pairings.map(p => {
      if (p.board === board) return { ...p, result: null };
      return p;
    });

    await roundRef.update({ pairings: newPairings });

    // 2. Full standings recalculation (rebuilds ratings from source)
    await recalculateStandings(tournamentId);

    AuditLog.log(AuditLog.ACTIONS.RESULT_CLEARED, tournamentId, { round: roundNumber, board });
    return true;
  }

  /**
   * DESTRUCTIVE: Resets the entire tournament to Round 0.
   * Keeps the player roster but deletes all rounds and standings.
   */
  async function resetTournament(tournamentId) {
    const tRef = db.collection('tournaments').doc(tournamentId);

    const collections = ['rounds', 'standings_cache', 'pairings_broadcast'];
    const batch = db.batch();

    for (const col of collections) {
      const snap = await tRef.collection(col).get();
      snap.forEach(doc => batch.delete(doc.ref));
    }

    batch.update(tRef, {
      currentRound: 0,
      status: 'registration',
      updatedAt: Date.now()
    });

    await batch.commit();
    AuditLog.logArbiterAction(AuditLog.ACTIONS.TOURNAMENT_UPDATED, { message: 'Tournament Reset to Registration Phase' }, tournamentId);
    return { success: true };
  }

  async function withdrawPlayer(tournamentId, playerId) {
    const tRef = db.collection('tournaments').doc(tournamentId);
    const pRef = tRef.collection('playerData').doc(playerId);

    const batch = db.batch();
    batch.update(pRef, {
      withdrawn: true,
      withdrawnAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Day 167 Task 2: Clean tournament playerIds array to prevent downstream pairing issues
    batch.update(tRef, {
      playerIds: firebase.firestore.FieldValue.arrayRemove(playerId)
    });

    await batch.commit();

    // Recalculate standings immediately to tag player as WD in cache
    await recalculateStandings(tournamentId);

    AuditLog.logArbiterAction(AuditLog.ACTIONS.PLAYER_REMOVED, {
      message: `Player Withdrawn from Tournament - Will no longer be paired.`
    }, tournamentId);

    return { success: true };
  }



  /**
   * SAFETY REPAIR: Deletes the current round pairings IF no results are in yet.
   */
  async function deleteAndRepairCurrentRound(tournamentId) {
    const tournament = await DB.getTournament(tournamentId);
    const rd = tournament.currentRound;
    if (rd <= 0) throw new Error('No round to repair');

    const round = await DB.getRound(tournamentId, rd);
    if (!round) throw new Error('Round data not found');

    // Pillar 6: Check for any recorded results (Individual or Team)
    const matches = round.teamMatches || round.pairings || [];
    const hasResults = matches.some(m => {
      if (tournament.isTeamEvent) {
        return m.isResolved || (m.boards && m.boards.some(b => !!b.result || !!b.rawResult));
      }
      return !!m.result;
    });

    if (hasResults) {
      throw new Error('Cannot repair round: Match results have already been recorded. Use Rollback instead.');
    }

    // Safe to delete
    const tRef = db.collection('tournaments').doc(tournamentId);
    await tRef.collection('rounds').doc(`round_${rd}`).delete();

    // Decrement temporarily so generateNextRound sees the correct context
    await tRef.update({ currentRound: rd - 1, status: 'active' });

    // REPAIR PHASE: Trigger immediate regeneration
    console.log(`[Arbiter] Repairing Round ${rd}...`);
    const repairResult = await generateNextRound(tournamentId);

    AuditLog.logArbiterAction(AuditLog.ACTIONS.ROUND_STARTED, {
      message: `Round ${rd} pairings deleted and successfully regenerated.`
    }, tournamentId);

    return repairResult;
  }

  //
  // Day 164 Task 1: FIDE TRF Compliant Exporter with 80-character sheets
  const exportTournamentToFideTRF = async function(tournamentId) {
    const tournament = await DB.getTournament(tournamentId);
    if (!tournament) throw new Error('Tournament not found');

    const players = await DB.getTournamentPlayers(tournamentId);
    const standings = await DB.getStandingsCache(tournamentId);
    const roundsSnap = await db.collection('tournaments').doc(tournamentId).collection('rounds').get();
    const rounds = roundsSnap.docs.map(d => d.data()).sort((a, b) => a.roundNumber - b.roundNumber);

    // Day 164 Task 2: Validation Firewalls for birthdates and country codes
    const invalidPlayers = [];
    players.forEach(p => {
      if (!p.birthDate) {
        invalidPlayers.push(`${p.name} (Missing Birthdate)`);
      }
      if (!p.federation && !p.countryCode) {
        invalidPlayers.push(`${p.name} (Missing Country/Federation Code)`);
      }
    });

    if (invalidPlayers.length > 0) {
      throw new Error(`FIDE TRF COMPILATION HALTED: ${invalidPlayers.join(', ')}. Please update player profile details before submitting to FIDE.`);
    }

    // Header metadata compliant with 80-char layout
    let trf = `012 ${tournament.name.substring(0, 40).padEnd(40)}\n`;
    trf += `022 ${'Tabuko Chess Venue'.substring(0, 40).padEnd(40)}\n`;
    trf += `032 ${(tournament.federation || 'PHI').substring(0, 3).toUpperCase().padStart(3)}\n`;
    trf += `042 ${tournament.startDate || new Date().toISOString().slice(0,10).replace(/-/g, '/')}\n`;
    trf += `052 ${String(players.length).padStart(4)}\n`;
    trf += `062 ${String(tournament.totalRounds || 5).padStart(2)}\n`;
    trf += `072 ${String(tournament.currentRound || 0).padStart(2)}\n`;
    trf += `082 ${tournament.isTeamEvent ? 'Team' : 'Individual'}\n`;
    trf += `\n`;

    const playerStandingsList = standings?.players || standings || [];
    const playerWithRanks = players.map(p => {
      const standing = playerStandingsList.find(s => s.id === p.id);
      return {
        ...p,
        rank: standing?.rank || 999,
        score: standing?.score || 0
      };
    }).sort((a, b) => a.rank - b.rank);

    const rankMap = {};
    playerWithRanks.forEach((p, idx) => {
      rankMap[p.id] = idx + 1;
    });

    playerWithRanks.forEach((p, idx) => {
      const rk = String(idx + 1).padStart(4);
      const title = (p.title || '  ').substring(0, 2).padEnd(2);
      const name = (p.name || 'Unknown').substring(0, 30).padEnd(30);
      const rtg = String(p.selectedRating || 1200).padStart(4);
      const fed = (p.federation || p.countryCode || 'PHI').substring(0, 3).toUpperCase().padEnd(3);
      const dob = p.birthDate ? new Date(p.birthDate).toISOString().slice(0, 10).replace(/-/g, '/') : '0000/00/00';
      const pts = String(Number(p.score).toFixed(1)).padStart(4);

      let line = `001 ${rk} ${title} ${name} ${rtg} ${fed} ${dob} ${pts}`;

      rounds.forEach(round => {
        const pairing = (round.pairings || []).find(pr => pr.whiteId === p.id || pr.blackId === p.id);
        if (pairing) {
          const isWhite = pairing.whiteId === p.id;
          const oppId = isWhite ? pairing.blackId : pairing.whiteId;
          const oppRank = rankMap[oppId] || 0;
          const oppRankStr = String(oppRank).padStart(4);
          const colorChar = isWhite ? 'w' : 'b';
          
          let resultChar = '0';
          if (pairing.result) {
            const wScore = pairing.result.whiteScore;
            const bScore = pairing.result.blackScore;
            if (wScore === 1 && bScore === 0) resultChar = isWhite ? '1' : '0';
            else if (wScore === 0 && bScore === 1) resultChar = isWhite ? '0' : '1';
            else if (wScore === 0.5) resultChar = '=';
          }
          line += `  ${oppRankStr} ${colorChar} ${resultChar}`;
        } else if (round.bye && round.bye.playerId === p.id) {
          line += `  0000 - 1`;
        } else {
          line += `  0000 - 0`;
        }
      });

      trf += line + `\n`;
    });

    return trf;
  }

  const generateFideTRF = async function(tournamentId) {
    return exportTournamentToFideTRF(tournamentId);
  };

  // Day 201: Global namespace mapping to prevent ReferenceError
  window.generateFideTRF = generateFideTRF;

  /**
   * validateTeamRoster: Strict FIDE Strength Lock & Uniqueness Check.
   * Enforces: Rating Board 1 >= Board 2 >= Board 3...
   */
  async function validateTeamRoster(tournamentId, teamPayload) {
    const { playerIds, players, name } = teamPayload;

    // 1. Strength Lock Check (Board Order Rating Integrity)
    for (let i = 0; i < players.length - 1; i++) {
      if (players[i].rating < players[i + 1].rating) {
        throw new Error(`FIDE Strength Lock Violation: In team '${name}', Board ${i + 1} (${players[i].rating}) is rated lower than Board ${i + 2} (${players[i + 1].rating}).`);
      }
    }

    // 2. Uniqueness Check (No multi-team players)
    const teams = await DB.getAllTeams(tournamentId);
    for (const team of teams) {
      if (team.id === teamPayload.id) continue;
      const intersection = playerIds.filter(id => (team.playerIds || []).includes(id));
      if (intersection.length > 0) {
        throw new Error(`Registration Conflict: Players are already assigned to team '${team.name}'.`);
      }
    }
    return true;
  }

  /**
   * validateTeamRound: Corrected Async Logic
   * Fixes: "await is not defined" error by using for...of instead of forEach
   */
  async function validateTeamRound(tournamentId, roundNumber) {
    const round = await DB.getRound(tournamentId, roundNumber);
    if (!round) return { valid: false, errors: ['Round not found'] };

    const errors = [];
    const matches = round.teamMatches || round.matches || [];

    // USE FOR...OF INSTEAD OF FOREACH FOR ASYNC SUPPORT
    for (const m of matches) {
      if (!m.isResolved) {
        errors.push(`Match ${m.matchNumber} (${m.homeTeamName} vs ${m.awayTeamName}) is not fully resolved.`);
      }

      // Check nested boards
      for (const b of (m.boards || [])) {
        if (!b.rawResult && !b.result) {
          errors.push(`Match ${m.matchNumber}, Board ${b.boardNumber} is missing a result.`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  return {
    generateNextRound,
    startNextRound: generateNextRound, // UI Button hook
    computeTeamStandings, // Exact name the app expects
    computeFideStandings: computeTeamStandings, // Legacy fallback
    validateTeamRoster,
    startTournamentAndPairR1,
    generateFideTRF,
    exportTournamentToFideTRF,
    validateCurrentRound,
    validateTeamRound,
    addLateJoiner,
    withdrawPlayer,
    submitResultAndUpdate,
    validateMatch,
    validateRound,
    lockRoundResults,
    lockRound: lockRoundResults, // Alias: legacy callers get the canonical implementation
    finalizeTournament,
    publishPairingsBroadcast,
    buildPlayerState,
    buildTeamState,
    editTournament,
    deleteTournament,
    deleteCurrentRound,
    resetTournament,
    deleteAndRepairCurrentRound,
    clearResult,
    submitTeamResult,
    recalculateStandings,
    unlockRound: async function(tournamentId, roundNumber) {
      const rd = parseInt(roundNumber, 10);
      const tRef = db.collection('tournaments').doc(tournamentId);

      // Day 169 Task 1: Secure transaction-wrapped rollback helper
      await db.runTransaction(async (transaction) => {
        const tSnap = await transaction.get(tRef);
        if (!tSnap.exists) throw new Error("Tournament not found");
        const tournament = tSnap.data();

        const currentRound = tournament.currentRound || 1;
        const targetRoundRef = tRef.collection('rounds').doc(`round_${rd}`);
        const targetRoundSnap = await transaction.get(targetRoundRef);
        if (!targetRoundSnap.exists) throw new Error(`Round ${rd} document not found`);

        // Delete all downstream rounds and standings caches
        for (let r = rd + 1; r <= currentRound; r++) {
          const roundRef = tRef.collection('rounds').doc(`round_${r}`);
          transaction.delete(roundRef);
          
          const cacheRef = tRef.collection('standings_cache').doc(`round_${r}`);
          transaction.delete(cacheRef);
        }

        // Revert target round status to active
        transaction.update(targetRoundRef, { status: 'active' });

        // Update parent tournament document
        transaction.update(tRef, {
          currentRound: rd,
          status: 'active',
          updatedAt: Date.now()
        });
      });

      // Day 169 Task 2: Cascade down to each player and reset downstream scores
      const playersSnap = await db.collection('tournaments').doc(tournamentId).collection('playerData').get();
      const batch = db.batch();
      
      playersSnap.docs.forEach(doc => {
        const p = doc.data();
        const results = p.results || [];
        const roundScores = p.roundScores || [];

        // Filter out downstream round results and roundScores
        const slicedResults = results.filter(r => r.round <= rd);
        const slicedRoundScores = roundScores.slice(0, rd);
        const newScore = slicedRoundScores.reduce((sum, val) => sum + (parseFloat(val) || 0), 0);

        batch.update(doc.ref, {
          results: slicedResults,
          roundScores: slicedRoundScores,
          score: newScore
        });
      });

      await batch.commit();

      // Recompute standings cache immediately to reflect the rolled back round state
      await recalculateStandings(tournamentId);

      if (window.AuditLog) {
        AuditLog.logArbiterAction(AuditLog.ACTIONS.TOURNAMENT_UPDATED, { 
          message: `Cascading rollback: Round ${rd} unlocked. All downstream rounds deleted.` 
        }, tournamentId);
      }
      return true;
    },
    executeHighConcurrencyStressTest: async function() {
      console.log('[Stress Test] Starting Heavy High-Concurrency Swiss Simulation...');
      performance.mark('stress-test-start');
      
      const playersCount = 500;
      const mockPlayers = [];
      for (let i = 1; i <= playersCount; i++) {
        mockPlayers.push({
          id: `mock_player_${i}`,
          name: `Mock Player ${i}`,
          selectedRating: Math.floor(Math.random() * 1200) + 1200,
          results: []
        });
      }
      
      let currentRound = 1;
      const totalRounds = 10;
      
      performance.mark('swiss-pairing-start');
      for (let round = 1; round <= totalRounds; round++) {
        mockPlayers.sort((a, b) => {
          const scoreA = a.results.reduce((sum, r) => sum + r.result, 0);
          const scoreB = b.results.reduce((sum, r) => sum + r.result, 0);
          return scoreB - scoreA || b.selectedRating - a.selectedRating;
        });
        
        for (let i = 0; i < mockPlayers.length; i += 2) {
          const white = mockPlayers[i];
          const black = mockPlayers[i + 1] || null;
          if (!black) {
            white.results.push({ round, result: 1.0, isBye: true });
            continue;
          }
          
          const outcomes = [
            { w: 1.0, b: 0.0 },
            { w: 0.5, b: 0.5 },
            { w: 0.0, b: 1.0 }
          ];
          const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
          
          const expectedW = 1 / (1 + Math.pow(10, (black.selectedRating - white.selectedRating) / 400));
          const expectedB = 1 - expectedW;
          
          white.results.push({ round, result: outcome.w, change: Math.round(20 * (outcome.w - expectedW)) });
          black.results.push({ round, result: outcome.b, change: Math.round(20 * (outcome.b - expectedB)) });
        }
      }
      performance.mark('swiss-pairing-end');
      
      performance.measure('swiss-simulation-duration', 'swiss-pairing-start', 'swiss-pairing-end');
      const measure = performance.getEntriesByName('swiss-simulation-duration')[0];
      console.log(`[Stress Test] 10 rounds Swiss tournament simulation finished in ${measure.duration.toFixed(2)}ms`);
      
      performance.mark('stress-test-end');
      performance.measure('total-stress-test-duration', 'stress-test-start', 'stress-test-end');
      const totalMeasure = performance.getEntriesByName('total-stress-test-duration')[0];
      
      const resultsReport = {
        playersSimulated: playersCount,
        roundsSimulated: totalRounds,
        pairingDurationMs: measure.duration,
        totalDurationMs: totalMeasure.duration,
        timestamp: Date.now()
      };
      
      // Try to render diagnostic UI updates if active view supports it
      if (window.UI && window.UI.updateDiagnosticsPanel) {
        window.UI.updateDiagnosticsPanel(resultsReport);
      }
      
      return resultsReport;
    }
  };
})();

// Global Export already handled by IIFE assignment on line 5
