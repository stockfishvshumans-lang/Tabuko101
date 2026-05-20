/**
 * pairing-round-robin-team.js — FIDE-Compliant Team Berger Engine
 * 
 * Logic:
 * 1. Apply Circle Method (Berger) to Teams to determine Match A vs Match B.
 * 2. Generate individual boards using Team Swiss alternation logic:
 *    Board 1: Home-White, Board 2: Home-Black, Board 3: Home-White...
 */
const TeamRRPairing = (() => {

  /**
   * Generate Round Robin pairings for Teams.
   */
  function generateTeamRRPairings(teams, roundNumber) {
    // 1. Sort for Berger Seeding
    const sorted = [...teams].sort((a, b) => (a.seed || 999) - (b.seed || 999));
    
    let pool = [...sorted];
    let hasBye = false;

    // 2. Handle Odd Count
    if (pool.length % 2 !== 0) {
      pool.push({ teamId: 'BYE', teamName: 'BYE', isDummy: true });
      hasBye = true;
    }

    const n = pool.length;
    const matchups = [];
    let bye = null;

    // 3. Circle Method Rotation
    const rotationCount = roundNumber - 1;
    const rotatedPool = [pool[0]];
    const others = pool.slice(1);

    for (let i = 0; i < rotationCount; i++) {
      others.unshift(others.pop());
    }
    rotatedPool.push(...others);

    // 4. Pair Teams and Generate Boards
    const half = n / 2;
    const pairings = [];

    for (let i = 0; i < half; i++) {
      const t1 = rotatedPool[i];
      const t2 = rotatedPool[n - 1 - i];

      if (t1.isDummy) {
        bye = t2;
      } else if (t2.isDummy) {
        bye = t1;
      } else {
        // 5. Team Color Alternation (Berger)
        // Fixed Team alternates "Home" status
        const isT1Home = roundNumber % 2 !== 0;
        let homeTeam, awayTeam;

        if (t1.teamId === pool[0].teamId) {
          homeTeam = isT1Home ? t1 : t2;
          awayTeam = isT1Home ? t2 : t1;
        } else if (t2.teamId === pool[0].teamId) {
          homeTeam = isT1Home ? t2 : t1;
          awayTeam = isT1Home ? t1 : t2;
        } else {
          if (i % 2 === 0) { homeTeam = t2; awayTeam = t1; }
          else { homeTeam = t1; awayTeam = t2; }
        }

        // 6. Delegate to Team Match creation (W, B, W, B logic)
        pairings.push(TeamPairing.createTeamMatch(homeTeam, awayTeam, pairings.length + 1));
      }
    }

    return { pairings, bye };
  }

  return { generateTeamRRPairings };
})();

// Global Export
window.TeamRRPairing = TeamRRPairing;
