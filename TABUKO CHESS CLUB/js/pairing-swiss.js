/**
 * pairing-swiss.js — FIDE-Compliant Dutch Swiss Engine
 * 
 * Implements a deterministic, bracket-based Dutch system with:
 * 1. Score-grouping with floater management.
 * 2. Absolute color preference enforcement (3-in-a-row / diff > 2).
 * 3. Recursive transposition logic for bracket matching.
 * 4. Deterministic seeding and bye selection.
 */

const SwissPairing = (() => {

  /**
   * Main Entry Point for Swiss Pairings
   */
  function generatePairings(players, round, config = {}) {
    const activePool = players.filter(p => !p.withdrawn);
    if (round === 1) return generateRound1(activePool, config.seedingStrategy);
    return generateSwiss(activePool);
  }

  // ── ROUND 1 LOGIC ──
  function generateRound1(players, strategy = 'top_vs_bottom') {
    // Sort by Rating DESC -> Title -> Name
    const sorted = [...players].sort((a, b) =>
      (b.selectedRating || 0) - (a.selectedRating || 0) ||
      (a.name.localeCompare(b.name))
    );

    let pool = [...sorted];
    let bye = null;

    if (pool.length % 2 !== 0) {
      // Round 1 Bye: Lowest ranked player
      bye = pool.pop();
    }

    const half = pool.length / 2;
    const pairings = [];

    // FIDE Top vs Bottom: 1 vs N/2+1, 2 vs N/2+2...
    for (let i = 0; i < half; i++) {
      pairings.push(assignColors(pool[i], pool[half + i], i + 1));
    }

    return { pairings, bye };
  }

  // ── SWISS ROUND LOGIC ──
  function generateSwiss(players) {
    // PRE-FILTER: Strips out withdrawn players before pairing
    const activePool = players.filter(p => !p.withdrawn);
    
    // Sort active pool by Score DESC -> Rating DESC -> Name
    const sorted = [...activePool].sort((a, b) =>
      (b.score || 0) - (a.score || 0) ||
      (b.selectedRating || 0) - (a.selectedRating || 0) ||
      (a.name.localeCompare(b.name))
    );

    let pool = [...sorted];
    let bye = null;

    // 1. Assign BYE to lowest eligible player
    if (pool.length % 2 !== 0) {
      bye = selectByePlayer(pool);
      pool = pool.filter(p => p.id !== bye.id);
    }

    // 2. Group by Score
    const brackets = groupByScore(pool);
    let pairings = [];
    let downFloaters = [];

    // 3. Pair Brackets
    for (const bracket of brackets) {
      let candidates = [...downFloaters, ...bracket];

      // If odd, one must float down. 
      // We want the floater to be someone who WASN'T a downfloater last round.
      if (candidates.length % 2 !== 0) {
        // Sort to put potential floaters at the end: 
        // 1. Those who were downfloaters last round (avoid repeating)
        // 2. Rating (lowest first for floating down)
        candidates.sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          if (a.wasDownfloater !== b.wasDownfloater) return a.wasDownfloater ? 1 : -1;
          return (b.selectedRating || 0) - (a.selectedRating || 0);
        });
      }

      const result = pairBracket(candidates);
      pairings.push(...result.pairs);
      downFloaters = result.floaters;
    }

    // 4. Final Fallback (Extremely rare if Dutch logic is sound)
    if (downFloaters.length > 1) {
      for (let i = 0; i < downFloaters.length - 1; i += 2) {
        pairings.push(assignColors(downFloaters[i], downFloaters[i + 1], pairings.length + 1));
      }
    }

    // 5. Board Numbering
    pairings.forEach((p, i) => p.board = i + 1);

    return { pairings, bye };
  }

  /**
   * Dutch Bracket Pairing
   * Uses transposition to satisfy constraints.
   */
  function pairBracket(players) {
    if (players.length < 2) return { pairs: [], floaters: players };

    // Deterministic sort for Dutch compliance (Score -> Rating -> Name)
    const sorted = [...players].sort((a, b) =>
      (b.score - a.score) || (b.selectedRating - a.selectedRating) || (a.name.localeCompare(b.name))
    );

    // Try all possible subset sizes for S1 (usually half, but can be less if floaters are needed)
    const maxS1 = Math.floor(sorted.length / 2);

    for (let s1Size = maxS1; s1Size >= 1; s1Size--) {
      const S1 = sorted.slice(0, s1Size);
      const S2 = sorted.slice(s1Size);

      const match = backtrackPair(S1, S2, []);
      if (match) {
        const pairedIds = new Set(match.flatMap(p => [p.p1.id, p.p2.id]));
        const floaters = sorted.filter(p => !pairedIds.has(p.id));
        return {
          pairs: match.map(m => assignColors(m.p1, m.p2, 0)),
          floaters
        };
      }
    }

    // Bracket collapse fallback
    return { pairs: [], floaters: sorted };
  }

  function backtrackPair(S1, S2, currentPairs) {
    if (S1.length === 0) return currentPairs;

    const p1 = S1[0];
    for (let i = 0; i < S2.length; i++) {
      const p2 = S2[i];

      if (canPair(p1, p2)) {
        const nextS1 = S1.slice(1);
        const nextS2 = [...S2.slice(0, i), ...S2.slice(i + 1)];
        const result = backtrackPair(nextS1, nextS2, [...currentPairs, { p1, p2 }]);
        if (result) return result;
      }
    }
    return null;
  }

  // ── CORE FIDE RULES ──

  function canPair(p1, p2) {
    // Rule: No repeat opponents
    if ((p1.opponents || []).includes(p2.id)) return false;

    // Rule: Absolute Color Constraints (FIDE C.04.1.E)
    // We must ensure that if we pair them, at least one color assignment is legal.
    const canP1White = checkColorConstraint(p1, 'white');
    const canP2Black = checkColorConstraint(p2, 'black');
    const canP1Black = checkColorConstraint(p1, 'black');
    const canP2White = checkColorConstraint(p2, 'white');

    // If P1 can't be White AND P1 can't be Black (impossible, but for logic safety)
    // If P1 MUST be Black and P2 MUST be Black, they cannot pair.
    if (!(canP1White && canP2Black) && !(canP1Black && canP2White)) return false;

    const pref1 = getColorPreference(p1);
    const pref2 = getColorPreference(p2);

    // Violation: Both players MUST have the same color preference and it's FORCED
    if (pref1.must && pref2.must && pref1.color === pref2.color) return false;

    return true;
  }

  // 🛡️ REPAIR: Cross-Tournament Color Balance Ledger Validation (Day 214 Task 1)
  function auditPlayerColorsFromHistory(player) {
    const colors = [];
    let whiteCount = 0;
    let blackCount = 0;
    
    (player.results || []).forEach(r => {
      if (r.color) {
        const c = r.color.toString().toLowerCase();
        if (c.startsWith('w')) {
          colors.push('white');
          whiteCount++;
        } else if (c.startsWith('b')) {
          colors.push('black');
          blackCount++;
        }
      }
    });
    
    return {
      colors,
      whiteCount,
      blackCount,
      balanceDiff: whiteCount - blackCount
    };
  }

  function checkColorConstraint(p, color) {
    const audit = auditPlayerColorsFromHistory(p);
    const colors = audit.colors;
    const diff = audit.balanceDiff;

    // FIDE C.04.1: Max difference of 2
    if (color === 'white' && diff >= 2) return false;
    if (color === 'black' && diff <= -2) return false;

    // 🛡️ REPAIR: FIDE Triple-Color Sequence Firewall (Day 214 Task 2)
    const last2 = colors.slice(-2);
    if (last2.length === 2 && last2[0] === color && last2[1] === color) {
      console.warn(`[FIDE Firewall] Blocking ${p.name || p.id} from receiving ${color} for a third consecutive round.`);
      return false;
    }

    return true;
  }

  function getColorPreference(p) {
    const audit = auditPlayerColorsFromHistory(p);
    const colors = audit.colors;
    const diff = audit.balanceDiff;

    // Force color if 2-in-a-row or diff is 2
    const last2 = colors.slice(-2);
    if (last2.length === 2 && last2[0] === last2[1]) {
      return { color: last2[0] === 'white' ? 'black' : 'white', must: true };
    }
    if (Math.abs(diff) >= 2) {
      return { color: diff > 0 ? 'black' : 'white', must: true };
    }

    // Default preference: Alternate from last round
    const last = colors[colors.length - 1];
    return { color: last === 'white' ? 'black' : 'white', must: false };
  }

  function assignColors(p1, p2, board) {
    const pref1 = getColorPreference(p1);
    const pref2 = getColorPreference(p2);

    // 1. Forced Colors (One must be White, the other must be Black)
    if (pref1.must && pref1.color === 'white') return { white: p1, black: p2, board };
    if (pref2.must && pref2.color === 'white') return { white: p2, black: p1, board };

    // 2. Opposing Preferences
    if (pref1.color === 'white' && pref2.color === 'black') return { white: p1, black: p2, board };
    if (pref1.color === 'black' && pref2.color === 'white') return { white: p2, black: p1, board };

    // 3. Same Preference (Both want White or both want Black)
    // FIDE C.04.1: Higher ranked player gets preference if possible
    const p1Rank = p1.seed || 999;
    const p2Rank = p2.seed || 999;

    if (p1Rank < p2Rank) {
      return { white: pref1.color === 'white' ? p1 : p2, black: pref1.color === 'white' ? p2 : p1, board };
    } else {
      return { white: pref2.color === 'white' ? p2 : p1, black: pref2.color === 'white' ? p1 : p2, board };
    }
  }

  function selectByePlayer(players) {
    // FIDE Rule: BYE goes to lowest ranked eligible player
    // Eligible: Has not had a BYE yet
    const eligible = players
      .filter(p => !p.hadBye)
      .sort((a, b) => {
        // Priority 1: Has not been a floater (if avoidable)
        if (a.wasDownfloater !== b.wasDownfloater) return a.wasDownfloater ? 1 : -1;
        // Priority 2: Score
        if (a.score !== b.score) return a.score - b.score;
        // Priority 3: Rating
        return a.selectedRating - b.selectedRating;
      });

    return eligible[0] || players[players.length - 1];
  }

  function groupByScore(players) {
    const groups = [];
    let current = [];
    let lastScore = null;

    players.forEach(p => {
      if (p.score !== lastScore) {
        if (current.length) groups.push(current);
        current = [p];
        lastScore = p.score;
      } else {
        current.push(p);
      }
    });

    if (current.length) groups.push(current);
    return groups;
  }

  return { generatePairings };

})();

// Global Export
window.SwissPairing = SwissPairing;