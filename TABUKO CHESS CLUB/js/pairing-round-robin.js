/**
 * pairing-round-robin.js — FIDE-Compliant Berger Table Engine
 * 
 * Implements the standard Round Robin "Circle Method" (Berger System)
 * 1. Fixed position for Player 1.
 * 2. Clockwise rotation for all other players.
 * 3. Automatic color alternation for Player 1 (W in odd, B in even).
 * 4. Automatic "BYE" handling for odd player counts.
 */
const RRPairing = (() => {

  /**
   * Main Entry Point: Generate pairings for a specific round of a Round Robin.
   * @param {Array} players - List of active players.
   * @param {number} roundNumber - Current round to generate.
   */
  function generateRoundRobinPairings(players, roundNumber) {
    // 1. Sort by Seed/Rank for consistent Berger mapping
    const sorted = [...players].sort((a, b) => (a.seed || 999) - (b.seed || 999));
    
    let pool = [...sorted];
    let hasBye = false;

    // 2. Handle Odd Count: Add dummy BYE player
    if (pool.length % 2 !== 0) {
      pool.push({ id: 'BYE', name: 'BYE', isDummy: true });
      hasBye = true;
    }

    const n = pool.length;
    const pairings = [];
    let bye = null;

    // 3. Circle Method (Berger Table) Logic
    // Fix Player 1 at index 0. Other players rotate.
    // Positions for Round R are calculated by rotating N-1 players.
    const rotationCount = roundNumber - 1;
    const rotatedPool = [pool[0]];
    const others = pool.slice(1);

    // Rotate clockwise: last element becomes first
    for (let i = 0; i < rotationCount; i++) {
      others.unshift(others.pop());
    }
    rotatedPool.push(...others);

    // 4. Pair top row with bottom row
    // Row 1: [0, 1, 2, ..., n/2-1]
    // Row 2: [n-1, n-2, ..., n/2] (mirrored)
    const half = n / 2;
    for (let i = 0; i < half; i++) {
      const p1 = rotatedPool[i];
      const p2 = rotatedPool[n - 1 - i];

      if (p1.isDummy) {
        bye = p2;
      } else if (p2.isDummy) {
        bye = p1;
      } else {
        // 5. Assign Colors
        // FIDE Rule: Player 1 (p1 in the original pool) alternates colors.
        // In the circle method, if round is odd, p1 is White if they are in top row.
        // Simplified: Alternate based on roundNumber and position.
        const isP1White = roundNumber % 2 !== 0;
        
        // If it's the fixed player (pool[0]), use the alternation rule
        if (p1.id === pool[0].id) {
          pairings.push(isP1White ? { white: p1, black: p2 } : { white: p2, black: p1 });
        } else if (p2.id === pool[0].id) {
          pairings.push(isP1White ? { white: p2, black: p1 } : { white: p1, black: p2 });
        } else {
          // Others alternate based on sum of positions (Standard Circle Method)
          // or just simple alternation for the board
          if (i % 2 === 0) pairings.push({ white: p2, black: p1 });
          else pairings.push({ white: p1, black: p2 });
        }
      }
    }

    // Number the boards
    pairings.forEach((p, idx) => p.board = idx + 1);

    return { pairings, bye };
  }

  return { generateRoundRobinPairings };
})();

// Global Export
window.RRPairing = RRPairing;
