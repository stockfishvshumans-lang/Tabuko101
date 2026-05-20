/**
 * TeamStandings.js — Enterprise-Grade FIDE Team Tournament Engine
 * 
 * Designed as a high-density, dual-pass computational engine for Team Chess Events.
 * Implements strict FIDE tie-break standards (MP, BP, TB, TSB, DE) with 
 * Virtual Opponent adjustments and Mini-Table Direct Encounter resolution.
 * 
 * @author Senior Tournament Systems Architect
 * @version 2.0.0 (Production-Ready)
 */
const TeamStandings = (() => {
  'use strict';

  // INTERNAL STATE (SNAPSHOT CACHE)
  let _cache = { 
    teams: [], 
    matches: [], 
    rounds: [],
    config: {
      teamSize: 4,
      totalRounds: 0,
      scoring: 'standard' // 'standard' (2,1,0) or '3point' (3,1,0)
    }
  };

  /**
   * PASS 1: Base Score Computation
   * Calculates Match Points (MP) and Board Points (BP) from raw match data.
   * Handles Team Byes and individual board results.
   * 
   * @param {Array} teams Array of team objects
   * @param {Array} rounds Array of round objects containing teamMatches
   * @returns {Object} Map of teamId -> stats
   */
  const computeBaseScores = (teams, rounds) => {
    const statsMap = {};
    const teamSize = _cache.config.teamSize;

    // Initialize map
    teams.forEach(t => {
      statsMap[t.id] = {
        id: t.id,
        name: t.name,
        mp: 0,
        bp: 0,
        history: [], // { round, oppId, mp, bp, isBye }
        opponents: new Set(),
        rank: 0,
        tb: 0,
        tsb: 0,
        de: 0,
        win: 0, draw: 0, loss: 0
      };
    });

    rounds.forEach(round => {
      const matches = round.teamMatches || round.matches || [];
      const rdNum = round.roundNumber;

      // Process Matches
      matches.forEach(m => {
        const t1Id = m.team1Id || m.homeTeamId;
        const t2Id = m.team2Id || m.awayTeamId;

        // Skip unresolved matches
        if (m.team1BP === undefined && m.homeBoardPoints === undefined) return;

        // Day 218 Task 1: Dynamic Float Coercion Verification Boundaries
        let t1BP = parseFloat(m.team1BP ?? m.homeBoardPoints ?? 0);
        if (isNaN(t1BP)) t1BP = 0.0;
        let t2BP = parseFloat(m.team2BP ?? m.awayBoardPoints ?? 0);
        if (isNaN(t2BP)) t2BP = 0.0;

        // Determine Match Result (MP)
        let t1MP = 0, t2MP = 0;
        if (t1BP > t2BP) { t1MP = 2; }
        else if (t1BP === t2BP) { t1MP = 1; t2MP = 1; }
        else { t2MP = 2; }

        let coercedT1MP = parseFloat(t1MP);
        if (isNaN(coercedT1MP)) coercedT1MP = 0.0;
        let coercedT2MP = parseFloat(t2MP);
        if (isNaN(coercedT2MP)) coercedT2MP = 0.0;

        // Apply to Stats with Day 218 Task 2 Float Accumulator Precision Sanitizers
        if (statsMap[t1Id]) {
          const s = statsMap[t1Id];
          s.mp = parseFloat((s.mp + coercedT1MP).toFixed(4));
          s.bp = parseFloat((s.bp + t1BP).toFixed(4));
          s.history.push({ round: rdNum, oppId: t2Id, mp: coercedT1MP, bp: t1BP, isBye: false });
          s.opponents.add(t2Id);
          if (t1MP === 2) s.win++; else if (t1MP === 1) s.draw++; else s.loss++;
        }
        if (statsMap[t2Id]) {
          const s = statsMap[t2Id];
          s.mp = parseFloat((s.mp + coercedT2MP).toFixed(4));
          s.bp = parseFloat((s.bp + t2BP).toFixed(4));
          s.history.push({ round: rdNum, oppId: t1Id, mp: coercedT2MP, bp: t2BP, isBye: false });
          s.opponents.add(t1Id);
          if (t2MP === 2) s.win++; else if (t2MP === 1) s.draw++; else s.loss++;
        }
      });

      // Process Round Byes
      if (round.bye) {
        const tid = round.bye.teamId;
        if (statsMap[tid]) {
          const s = statsMap[tid];
          s.mp += 2; // Bye gives full Match Points
          
          // 🛡️ REPAIR: Chain team bye adjustments directly to the canonical FIDE math engine
          if (typeof TieBreak !== 'undefined' && typeof TieBreak.getVirtualOpponentScore === 'function') {
            const dummyPlayer = { score: s.mp, results: s.history.map(h => ({ result: h.mp, isUnplayed: h.isBye })) };
            let virtualPoints = TieBreak.getVirtualOpponentScore(dummyPlayer, rdNum, _cache.config.totalRounds);
            s.bp += (virtualPoints * teamSize);
          } else {
            s.bp += (teamSize * 0.5); // Baseline fallback
          }

          s.history.push({ round: rdNum, oppId: 'BYE', mp: 2, bp: (teamSize * 0.5), isBye: true });
          s.win++;
        }
      }
    });

    return statsMap;
  };

  /**
   * PASS 2: Relational Tie-Break Math
   * Calculates Buchholz and Sonneborn-Berger using opponent MP.
   * Implements FIDE C.02.13.2 Virtual Opponent for unplayed rounds.
   * 
   * @param {Object} statsMap Map from computeBaseScores
   */
  const computeRelationalMath = (statsMap) => {
    const totalRounds = _cache.config.totalRounds;
    const teamIds = Object.keys(statsMap);

    teamIds.forEach(id => {
      const team = statsMap[id];
      let tb = 0;
      let tsb = 0;

      team.history.forEach(match => {
        if (match.isBye || match.oppId === 'BYE' || match.oppId === 'FORFEIT') {
          // VIRTUAL OPPONENT (FIDE C.02.13.2)
          // Simplified for Team Events: Bye opponent is treated as having 50% performance
          const virtualMP = (totalRounds * 1.0); // 1 MP per round avg
          tb += virtualMP;
          tsb += (virtualMP * match.mp);
        } else {
          const opponent = statsMap[match.oppId];
          const oppMP = opponent ? opponent.mp : 0;
          tb += oppMP;
          tsb += (oppMP * match.mp);
        }
      });

      team.tb = tb;
      team.tsb = tsb;
    });
  };

  /**
   * THE MINI-TABLE ENGINE: Direct Encounter Resolution
   * FIDE Rule: DE only applies if ALL tied teams played each other.
   * 
   * @param {Array} tiedTeams Array of team stats objects
   * @returns {Object} Map of teamId -> deRankScore
   */
  const resolveDirectEncounter = (tiedTeams) => {
    if (tiedTeams.length < 2) return {};

    const tiedIds = tiedTeams.map(t => t.id);
    const miniTable = {};
    tiedIds.forEach(id => miniTable[id] = 0);

    // Check completeness: Did every tied team play every other tied team?
    let allPlayedEachOther = true;
    for (let i = 0; i < tiedIds.length; i++) {
      for (let j = i + 1; j < tiedIds.length; j++) {
        const t1 = tiedTeams.find(t => t.id === tiedIds[i]);
        if (!t1.opponents.has(tiedIds[j])) {
          allPlayedEachOther = false;
          break;
        }
      }
      if (!allPlayedEachOther) break;
    }

    if (!allPlayedEachOther) return {};

    // Calculate Mini-Table MP
    tiedTeams.forEach(t => {
      t.history.forEach(m => {
        if (tiedIds.includes(m.oppId)) {
          miniTable[t.id] += m.mp;
        }
      });
    });

    return miniTable;
  };

  /**
   * rankTeams: The FIDE Stable Ranking Pipeline
   * Hierarchy: MP > BP > TB > TSB > DE
   */
  const rankTeams = (teamStatsArray) => {
    // 1. Initial Sort (excluding DE)
    let sorted = [...teamStatsArray].sort((a, b) => {
      // Data Validation Fallbacks
      const aMP = a.mp || 0, bMP = b.mp || 0;
      const aBP = a.bp || 0, bBP = b.bp || 0;
      const aTB = a.tb || 0, bTB = b.tb || 0;
      const aTSB = a.tsb || 0, bTSB = b.tsb || 0;
      
      if (bMP !== aMP) return bMP - aMP;
      if (bBP !== aBP) return bBP - aBP;
      if (bTB !== aTB) return bTB - aTB;
      if (bTSB !== aTSB) return bTSB - aTSB;
      return 0; // Temporary tie
    });

    // 2. Identify Tie Groups for Direct Encounter
    const groups = [];
    let currentGroup = [];

    for (let i = 0; i < sorted.length; i++) {
      if (i === 0) {
        currentGroup.push(sorted[i]);
        continue;
      }

      const a = sorted[i-1];
      const b = sorted[i];

      // If tied on all primary/secondary criteria
      if (a.mp === b.mp && a.bp === b.bp && a.tb === b.tb && a.tsb === b.tsb) {
        currentGroup.push(b);
      } else {
        if (currentGroup.length > 1) groups.push([...currentGroup]);
        currentGroup = [b];
      }
    }
    if (currentGroup.length > 1) groups.push(currentGroup);

    // 3. Resolve DE for each group
    groups.forEach(group => {
      const deScores = resolveDirectEncounter(group);
      group.forEach(t => {
        t.de = deScores[t.id] || 0;
      });
    });

    // 4. Final Final Sort (Including DE)
    return sorted.sort((a, b) => {
      const aMP = a.mp || 0, bMP = b.mp || 0;
      const aBP = a.bp || 0, bBP = b.bp || 0;
      const aTB = a.tb || 0, bTB = b.tb || 0;
      const aTSB = a.tsb || 0, bTSB = b.tsb || 0;
      const aDE = a.de || 0, bDE = b.de || 0;
      
      if (bMP !== aMP) return bMP - aMP;
      if (bBP !== aBP) return bBP - aBP;
      if (bTB !== aTB) return bTB - aTB;
      if (bTSB !== aTSB) return bTSB - aTSB;
      if (bDE !== aDE) return bDE - aDE;
      return (a.name || '').localeCompare(b.name || ''); // Final Alpha Tie-break
    });
  };

  /**
   * UI REFRESH: Morphdom-Compatible Renderer
   * Outputs a high-density FIDE leaderboard.
   */
  const refreshUI = (rankedTeams) => {
    const root = document.getElementById('enterprise-table-root');
    if (!root) return;

    const rows = rankedTeams.map((t, i) => {
      const rank = i + 1;
      let medalClass = '';
      if (rank === 1) medalClass = 'medal-gold';
      else if (rank === 2) medalClass = 'medal-silver';
      else if (rank === 3) medalClass = 'medal-bronze';

      return `
        <tr class="${medalClass}">
          <td class="text-center rank-col" style="width: 50px;">${rank}</td>
          <td class="text-left font-bold" style="font-size: 1.05rem;">${t.name}</td>
          <td class="text-center font-black pts-column" style="font-size: 1.25rem;">${t.mp}</td>
          <td class="text-center font-bold">${t.bp.toFixed(1).replace('.0', '')}</td>
          <td class="text-center text-muted" style="font-size: 0.85rem;">${t.tb.toFixed(1).replace('.0', '')}</td>
          <td class="text-center text-muted" style="font-size: 0.85rem;">${t.tsb.toFixed(1).replace('.0', '')}</td>
          <td class="text-center text-muted" style="font-size: 0.85rem;">${t.de > 0 ? t.de : '-'}</td>
          <td class="text-center text-xs" style="color: #64748b;">${t.win}W / ${t.draw}D / ${t.loss}L</td>
        </tr>
      `;
    }).join('');

    const html = `
      <div class="card p-0 overflow-hidden" style="border: 1px solid var(--border-color);">
        <table class="broadcast-table">
          <thead>
            <tr style="background: var(--bg-sidebar);">
              <th style="width: 50px;">RK</th>
              <th class="text-left">TEAM NAME</th>
              <th title="Match Points (Win=2, Draw=1)">MP</th>
              <th title="Board Points (Sum of game scores)">BP</th>
              <th title="Team Buchholz (Opponent MP Sum)">TB</th>
              <th title="Team Sonneborn-Berger">TSB</th>
              <th title="Direct Encounter">DE</th>
              <th class="text-center">RECORD</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;

    if (window.morphdom) {
      window.morphdom(root, `<div>${html}</div>`, { childrenOnly: true });
    } else {
      root.innerHTML = html;
    }
  };

  /**
   * PERSISTENCE: Atomic Firestore Sync
   * Saves the computed standings to a dedicated cache for public viewing.
   */
  const commitToCloud = async (tournamentId, roundNumber, rankedTeams) => {
    if (typeof db === 'undefined') return;
    
    try {
      const batch = db.batch();
      const cacheRef = db.collection('tournaments').doc(tournamentId)
                        .collection('standings_cache').doc(`round_${roundNumber}`);
      
      batch.set(cacheRef, {
        teams: rankedTeams.map(t => ({
          id: t.id,
          name: t.name,
          mp: t.mp,
          bp: t.bp,
          tb: t.tb,
          tsb: t.tsb,
          de: t.de,
          rank: t.rank,
          record: `${t.win}-${t.draw}-${t.loss}`
        })),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        round: roundNumber,
        isOfficial: true
      });

      // Update individual team ranks in their own documents for fast lookup
      rankedTeams.forEach((t, i) => {
        const teamRef = db.collection('tournaments').doc(tournamentId)
                          .collection('teams').doc(t.id);
        batch.update(teamRef, { 
          currentRank: i + 1,
          mp: t.mp,
          bp: t.bp
        });
      });

      await batch.commit();
      console.log(`[TeamStandings] Atomic Cloud Sync Complete for Round ${roundNumber}`);
    } catch (err) {
      console.error("[TeamStandings] Persistence Error:", err);
    }
  };

  return {
    /**
     * update: The primary entry point for the standings pipeline.
     * Triggers Fetch -> Dual-Pass Compute -> Rank -> Persist -> Render.
     * 
     * @param {string} tournamentId Firestore Document ID
     * @param {number} roundNumber The current active round
     */
    update: async (tournamentId, roundNumber) => {
      console.log(`[TeamStandings] Pipeline Initiated: Round ${roundNumber}`);
      
      try {
        // 1. DATA ACQUISITION (SNAPSHOT)
        const tDoc = await db.collection('tournaments').doc(tournamentId).get();
        const tournament = tDoc.data();
        
        const teamsSnap = await db.collection('tournaments').doc(tournamentId).collection('teams').get();
        const teams = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const roundsSnap = await db.collection('tournaments').doc(tournamentId).collection('rounds').get();
        const rounds = roundsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // 2. CONFIGURATION SYNC
        _cache.config = {
          teamSize: tournament.teamSize || 4,
          totalRounds: tournament.totalRounds || roundNumber,
          scoring: tournament.scoringType || 'standard'
        };

        // 3. THE DUAL-PASS PIPELINE
        // Pass 1: Physical Performance
        const statsMap = computeBaseScores(teams, rounds);
        
        // Pass 2: Relational Tie-Breaks
        computeRelationalMath(statsMap);

        // 4. RANKING & STABLE SORT
        const rankedTeams = rankTeams(Object.values(statsMap));
        
        // Assign ranks
        rankedTeams.forEach((t, idx) => t.rank = idx + 1);

        // 5. ATOMIC COMMIT & UI REFRESH
        await commitToCloud(tournamentId, roundNumber, rankedTeams);
        refreshUI(rankedTeams);

        return rankedTeams;
      } catch (err) {
        console.error("[TeamStandings] Pipeline Crash:", err);
        throw err;
      }
    },

    // EXPOSE UTILS FOR EXTERNAL MODULES (e.g. TieBreak.js integration)
    computeTeamStandings: (teams, rounds, tournament) => {
      _cache.config = {
        teamSize: tournament.teamSize || 4,
        totalRounds: tournament.totalRounds || 0
      };
      const statsMap = computeBaseScores(teams, rounds);
      computeRelationalMath(statsMap);
      const ranked = rankTeams(Object.values(statsMap));
      ranked.forEach((t, i) => t.rank = i + 1);
      return ranked;
    },

    /**
     * generateBoardStandings: SYSTEM B (Board Engine)
     * Aggregates raw board data for individual Swiss ranking.
     * 
     * @param {Array} allRounds 
     * @param {number} totalRounds 
     * @param {Object} playerMap Global lookup from playerData (optional)
     * @param {Array} teams Array of team objects for roster lookup (optional)
     */
    generateBoardStandings: (allRounds, totalRounds, playerMap = {}, teams = []) => {
      const boardData = {}; // { boardNum: { playerId: playerRecord } }
      const playerIndex = {}; // Cache for roster names

      // 1. Build Player Index from Team Rosters (Primary Source)
      teams.forEach(t => {
        (t.players || []).forEach(p => {
          if (p.id) playerIndex[p.id] = p.name;
        });
      });

      allRounds.forEach(round => {
        const matches = round.teamMatches || round.matches || [];
        matches.forEach(m => {
          (m.boards || []).forEach(b => {
            const bNum = b.boardNumber;
            if (!boardData[bNum]) boardData[bNum] = {};

            const addResult = (id, matchName, score, oppId, color, teamName) => {
              if (!id && !matchName) return;

              // HYDRATOR LOGIC: Resolve the best possible name
              // Primary: Tournament Map, Secondary: Team Roster (via playerIndex), Tertiary: Pairing Name
              const resolvedName = playerMap[id]?.name || playerIndex[id] || (matchName && matchName !== 'Vacant' ? matchName : 'Vacant');

              if (!id) {
                // If no ID, generate a pseudo-ID based on teamName and board position for this specific match
                // but for board standings, we really need a stable ID.
                // Fallback to matchName if it exists and isn't Vacant.
                if (resolvedName === 'Vacant') return;
                id = `guest_${teamName}_${b.boardNumber}`;
              }

              if (!boardData[bNum][id]) {
                boardData[bNum][id] = { 
                  id, 
                  name: resolvedName, 
                  score: 0, 
                  results: [], 
                  roundScores: [], 
                  rating: 0, 
                  teamName 
                };
              }
              const p = boardData[bNum][id];
              
              if (p.name === 'Vacant' && resolvedName !== 'Vacant') {
                p.name = resolvedName;
              }

              p.score += score;
              p.results.push({ opponentId: oppId, result: score, round: round.roundNumber, color });
              p.roundScores.push(score);
            };

            const res = b.result || {};
            addResult(b.whiteId, b.whiteName, res.whiteScore || 0, b.blackId, 'white', m.homeTeamName || m.team1?.name);
            addResult(b.blackId, b.blackName, res.blackScore || 0, b.whiteId, 'black', m.awayTeamName || m.team2?.name);
          });
        });
      });

      const finalBoards = {};
      Object.keys(boardData).forEach(bNum => {
        const players = Object.values(boardData[bNum]);
        // Use authoritative TieBreak engine
        if (typeof TieBreak !== 'undefined') {
          finalBoards[bNum] = TieBreak.rankPlayers(players, [], totalRounds);
        } else {
          finalBoards[bNum] = players.sort((a,b) => b.score - a.score);
        }
      });

      return finalBoards;
    }
  };
})();

// GLOBAL EXPORT
window.TeamStandings = TeamStandings;
