/**
 * pairing-worker.js — Background Thread Swiss/Team Pairing Engine
 * Days 171–180 Sprint:
 *   Day 171: Pure function with deep-cloned immutable state
 *   Day 172: All cloud/Firestore vars stripped from inner loops
 *   Day 173: Deterministic SHA-256 seeding replaces LCG random
 *   Day 174: History pulled from local shard data
 *   Day 175: Clean postMessage handshake
 *   Day 176: Color-three-consecutive FIDE validation firewall
 *   Day 177: Recursion counter with depth limit termination
 *   Day 180: Scoped device role permission mapping
 */

// ── DAY 173: SHA-256 DETERMINISTIC SEED ──────────
// WebCrypto is NOT available in workers by default in all browsers — use a
// pure-JS SHA-256 implementation for reproducibility without async.
function computeSHA256Signature(message) {
  // Pure-JS SHA-256 (no external dependencies)
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
             0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
             0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
             0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
             0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
             0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
             0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
             0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];

  function rightRotate(v, a) { return (v >>> a) | (v << (32 - a)); }

  const bytes = [];
  for (let i = 0; i < message.length; i++) {
    const c = message.charCodeAt(i);
    if (c < 128) { bytes.push(c); }
    else if (c < 2048) { bytes.push(192 | (c >> 6), 128 | (c & 63)); }
    else { bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
  }
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bitLen = (message.length * 8);
  bytes.push(0,0,0,0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];

  for (let i = 0; i < bytes.length; i += 64) {
    const w = [];
    for (let j = 0; j < 16; j++) w[j] = (bytes[i+j*4] << 24) | (bytes[i+j*4+1] << 16) | (bytes[i+j*4+2] << 8) | bytes[i+j*4+3];
    for (let j = 16; j < 64; j++) { const s0 = rightRotate(w[j-15],7)^rightRotate(w[j-15],18)^(w[j-15]>>>3); const s1 = rightRotate(w[j-2],17)^rightRotate(w[j-2],19)^(w[j-2]>>>10); w[j] = (w[j-16]+s0+w[j-7]+s1) >>> 0; }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let j = 0; j < 64; j++) {
      const S1 = rightRotate(e,6)^rightRotate(e,11)^rightRotate(e,25);
      const ch = (e&f)^(~e&g);
      const t1 = (hh+S1+ch+K[j]+w[j]) >>> 0;
      const S0 = rightRotate(a,2)^rightRotate(a,13)^rightRotate(a,22);
      const maj = (a&b)^(a&c)^(b&c);
      const t2 = (S0+maj) >>> 0;
      hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0;
    h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
  }
  return h.map(x => x.toString(16).padStart(8,'0')).join('');
}

// Day 173: Deterministic seed using SHA-256 hash of tournamentId+round+sortedPlayerIds
function generateDeterministicSeed(tournamentId, roundNumber, playerIdsArray) {
  const sortedIds = [...playerIdsArray].sort().join('|');
  const message   = `${tournamentId}_R${roundNumber}_${sortedIds}`;
  return computeSHA256Signature(message);
}

// Seeded RNG derived from SHA-256 (Mulberry32)
const Seeder = {
  _state: 0,
  init(tournamentId, roundNumber, playerIds) {
    const hex  = generateDeterministicSeed(tournamentId, roundNumber, playerIds);
    this._state = parseInt(hex.slice(0, 8), 16) >>> 0;
  },
  random() {
    let t = (this._state += 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
};

// ── DAY 180: DEVICE ROLE HIERARCHY ───────────────
const DEVICE_ROLES = {
  CHIEF_ARBITER:  { canPair: true,  canLock: true,  canEdit: true,   readOnly: false },
  FLOOR_ARBITER:  { canPair: false, canLock: false, canEdit: true,   readOnly: false },
  DISPLAY_MONITOR:{ canPair: false, canLock: false, canEdit: false,  readOnly: true  }
};

function getDevicePermissions(deviceRole) {
  const key = (deviceRole || 'DISPLAY_MONITOR').toUpperCase().replace(/\s/g,'_');
  return DEVICE_ROLES[key] || DEVICE_ROLES.DISPLAY_MONITOR;
}

// ── DAY 175: CLEAN postMessage LISTENER ──────────
self.onmessage = function(e) {
  const { type, payload } = e.data;

  if (type === 'RUN_LOAD_TEST') {
    try { self.postMessage({ type: 'LOAD_TEST_SUCCESS', result: runPairingLoadTest() }); }
    catch (err) { self.postMessage({ type: 'ERROR', error: err.message }); }
    return;
  }

  if (type === 'CHECK_DEVICE_ROLE') {
    self.postMessage({ type: 'DEVICE_ROLE_RESPONSE', permissions: getDevicePermissions(payload?.deviceRole) });
    return;
  }

  try {
    // Day 172: Strip all cloud references — pull player ids purely from payload
    // Day 171: Deep-clone all inputs — treat as fully immutable
    const immutablePayload = JSON.parse(JSON.stringify(payload));
    const playerIds = (immutablePayload.players || immutablePayload.teams || []).map(p => p.id);

    // Day 173: Deterministic SHA-256 seed
    Seeder.init(
      immutablePayload.config?.tournamentId || 'tabuko',
      immutablePayload.roundNumber,
      playerIds
    );

    const t0 = performance.now();
    let result;

    if (type === 'GENERATE_SWISS') {
      // Day 171: Pass deep-cloned immutable state only
      const activePlayers = (immutablePayload.players || []).filter(p => !p.withdrawn);
      result = SwissEngine.generatePairings(activePlayers, immutablePayload.roundNumber, immutablePayload.config, false);
      if (!result.pairings.length && activePlayers.length > 1)
        result = SwissEngine.generatePairings(activePlayers, immutablePayload.roundNumber, immutablePayload.config, true);

    } else if (type === 'GENERATE_TEAM') {
      const activeTeams = (immutablePayload.teams || []).filter(t => !t.withdrawn);
      result = TeamEngine.generateTeamPairings(activeTeams, immutablePayload.roundNumber, immutablePayload.config, false);
      if (!result.pairings.length && activeTeams.length > 1)
        result = TeamEngine.generateTeamPairings(activeTeams, immutablePayload.roundNumber, immutablePayload.config, true);

    } else {
      throw new Error(`Unknown pairing type: ${type}`);
    }

    const elapsed = performance.now() - t0;
    if (elapsed > 3000) console.warn(`[PairingWorker] Took ${elapsed.toFixed(0)}ms — approaching block limit.`);

    // Day 175: Clean response handshake
    self.postMessage({ type: 'SUCCESS', result: JSON.parse(JSON.stringify(result)), executionTime: elapsed });

  } catch (err) {
    self.postMessage({ type: 'ERROR', error: err.message });
  }
};

// ── SWISS ENGINE ──────────────────────────────────
const SwissEngine = (() => {
  let _recursionCount = 0;
  let _relaxColor     = false;
  const MAX_RECURSION = 25000; // Day 177

  // Day 171: Pure function — receives immutable deep-cloned input
  function generatePairings(players, round, config = {}, allowRepeats = false, forceRelax = false) {
    _recursionCount = 0;
    _relaxColor     = forceRelax;

    // Day 172: No cloud references — work purely from passed data
    const activePool = players.filter(p => !p.withdrawn);

    if (round === 1) return _generateRound1(activePool, config.seedingStrategy);
    try {
      return _generateSwiss(activePool, allowRepeats);
    } catch (err) {
      if (err.message === 'RECURSION_LIMIT_EXCEEDED') {
        if (!_relaxColor) return generatePairings(players, round, config, allowRepeats, true);
        if (!allowRepeats) return generatePairings(players, round, config, true, true);
      }
      throw err;
    }
  }

  function _generateRound1(players, strategy = 'top_vs_bottom') {
    const sorted = [...players].sort((a,b) =>
      ((b.ratingSnapshot?.rating || b.selectedRating || 0) - (a.ratingSnapshot?.rating || a.selectedRating || 0)) ||
      (a.name || '').localeCompare(b.name || '')
    );
    let pool = [...sorted];
    let bye  = null;
    if (pool.length % 2 !== 0) bye = pool.pop();
    const half = pool.length / 2;
    const pairings = [];
    for (let i = 0; i < half; i++) pairings.push(_assignColors(pool[i], pool[half + i], i + 1));
    return { pairings, bye };
  }

  function _generateSwiss(players, allowRepeats) {
    const sorted = [...players].sort((a,b) =>
      (b.score||0) - (a.score||0) ||
      ((b.ratingSnapshot?.rating||b.selectedRating||0) - (a.ratingSnapshot?.rating||a.selectedRating||0)) ||
      (a.name||'').localeCompare(b.name||'')
    );
    let pool = [...sorted];
    let bye  = null;
    if (pool.length % 2 !== 0) { bye = _selectByePlayer(pool); pool = pool.filter(p => p.id !== bye.id); }

    const brackets    = _groupByScore(pool);
    let pairings      = [];
    let downFloaters  = [];

    for (const bracket of brackets) {
      let candidates = [...downFloaters, ...bracket];
      candidates.sort((a,b) => (b.score - a.score) || ((b.ratingSnapshot?.rating||b.selectedRating||0) - (a.ratingSnapshot?.rating||a.selectedRating||0)) || (a.id||'').localeCompare(b.id||''));
      const result = _pairBracket(candidates, allowRepeats);
      pairings.push(...result.pairs);
      downFloaters = result.floaters;
    }
    if (downFloaters.length > 1) {
      for (let i = 0; i < downFloaters.length - 1; i += 2)
        pairings.push(_assignColors(downFloaters[i], downFloaters[i+1], pairings.length + 1));
    }
    pairings.forEach((p, i) => p.board = i + 1);
    return { pairings, bye };
  }

  function _pairBracket(players, allowRepeats) {
    if (players.length < 2) return { pairs: [], floaters: players };
    const sorted  = [...players].sort((a,b) => (b.score-a.score) || ((b.ratingSnapshot?.rating||b.selectedRating||0) - (a.ratingSnapshot?.rating||a.selectedRating||0)) || (a.id||'').localeCompare(b.id||''));
    const maxS1   = Math.floor(sorted.length / 2);
    for (let s1 = maxS1; s1 >= 1; s1--) {
      const match = _backtrack(sorted.slice(0, s1), sorted.slice(s1), [], allowRepeats);
      if (match) {
        const ids = new Set(match.flatMap(p => [p.p1.id, p.p2.id]));
        return { pairs: match.map(m => _assignColors(m.p1, m.p2, 0)), floaters: sorted.filter(p => !ids.has(p.id)) };
      }
    }
    return { pairs: [], floaters: sorted };
  }

  // Day 177: Explicit recursion counter with depth limit
  function _backtrack(S1, S2, current, allowRepeats) {
    _recursionCount++;
    if (_recursionCount > MAX_RECURSION) throw new Error('RECURSION_LIMIT_EXCEEDED');
    if (!S1.length) return current;
    const p1 = S1[0];
    for (let i = 0; i < S2.length; i++) {
      if (_canPair(p1, S2[i], allowRepeats)) {
        const res = _backtrack(S1.slice(1), [...S2.slice(0,i), ...S2.slice(i+1)], [...current, { p1, p2: S2[i] }], allowRepeats);
        if (res) return res;
      }
    }
    return null;
  }

  function _canPair(p1, p2, allowRepeats) {
    if (!allowRepeats && (p1.opponents || []).includes(p2.id)) return false;
    return (_checkColor(p1,'white') && _checkColor(p2,'black')) || (_checkColor(p1,'black') && _checkColor(p2,'white'));
  }

  // Day 176: FIDE three-consecutive color validation firewall
  function _checkColor(p, color) {
    if (_relaxColor) return true;
    const colors = p.colors || [];
    const diff   = colors.reduce((acc, c) => acc + (c === 'white' ? 1 : -1), 0);
    if (color === 'white' && diff >= 2) return false;
    if (color === 'black' && diff <= -2) return false;
    // Three consecutive same color block (FIDE strict)
    const last3 = colors.slice(-3);
    if (last3.length === 3 && last3.every(c => c === color)) return false;
    return true;
  }

  function _getColorPref(p) {
    const colors = p.colors || [];
    const last2  = colors.slice(-2);
    const diff   = colors.reduce((acc, c) => acc + (c === 'white' ? 1 : -1), 0);
    if (last2.length === 2 && last2[0] === last2[1]) return { color: last2[0] === 'white' ? 'black' : 'white', must: true };
    if (Math.abs(diff) >= 2) return { color: diff > 0 ? 'black' : 'white', must: true };
    return { color: colors[colors.length-1] === 'white' ? 'black' : 'white', must: false };
  }

  function _assignColors(p1, p2, board) {
    const pref1 = _getColorPref(p1);
    const pref2 = _getColorPref(p2);
    if (pref1.must && pref1.color === 'white') return { white: p1, black: p2, board };
    if (pref2.must && pref2.color === 'white') return { white: p2, black: p1, board };
    if (pref1.color === 'white' && pref2.color === 'black') return { white: p1, black: p2, board };
    if (pref1.color === 'black' && pref2.color === 'white') return { white: p2, black: p1, board };
    return (p1.id||'').localeCompare(p2.id||'') < 0 ? { white: p1, black: p2, board } : { white: p2, black: p1, board };
  }

  function _selectByePlayer(players) {
    const eligible = players.filter(p => !p.hadBye).sort((a,b) =>
      (a.score - b.score) || ((a.ratingSnapshot?.rating||a.selectedRating||0) - (b.ratingSnapshot?.rating||b.selectedRating||0)) || (a.id||'').localeCompare(b.id||'')
    );
    return eligible[0] || players[players.length - 1];
  }

  function _groupByScore(players) {
    const groups = [];
    let current = [], lastScore = null;
    players.forEach(p => {
      if (p.score !== lastScore) { if (current.length) groups.push(current); current = [p]; lastScore = p.score; }
      else current.push(p);
    });
    if (current.length) groups.push(current);
    return groups;
  }

  return { generatePairings };
})();

// ── TEAM ENGINE ───────────────────────────────────
const TeamEngine = (() => {
  function generateTeamPairings(teams, roundNumber, config = {}, allowRepeats = false) {
    const pool = [...teams].filter(t => !t.withdrawn).sort((a,b) => (b.mp - a.mp) || (b.bp - a.bp) || (a.id||'').localeCompare(b.id||''));
    let bye = null;
    if (pool.length % 2 !== 0) {
      const idx = pool.findIndex(t => !t.hadBye);
      bye = idx !== -1 ? pool.splice(idx, 1)[0] : pool.pop();
    }
    const pairings = [];
    const paired   = new Set();

    function findPairings(i) {
      if (i >= pool.length) return true;
      if (paired.has(pool[i].id)) return findPairings(i + 1);
      const teamA = pool[i];
      for (let j = i + 1; j < pool.length; j++) {
        const teamB = pool[j];
        if (!paired.has(teamB.id) && (allowRepeats || !(teamA.opponents||[]).includes(teamB.id))) {
          pairings.push(_createMatch(teamA, teamB, pairings.length + 1, roundNumber));
          paired.add(teamA.id); paired.add(teamB.id);
          if (findPairings(i + 1)) return true;
          pairings.pop(); paired.delete(teamA.id); paired.delete(teamB.id);
        }
      }
      return false;
    }
    findPairings(0);
    return { pairings, bye };
  }

  function _createMatch(teamA, teamB, matchNumber, roundNumber) {
    const isTeamAWhite = Seeder.random() > 0.5;
    const teamSize     = teamA.playerIds?.length || 4;
    const boards       = [];
    for (let i = 0; i < teamSize; i++) {
      const isWhite = (i % 2 === 0) ? isTeamAWhite : !isTeamAWhite;
      boards.push({
        boardNumber: i + 1,
        whiteId:   isWhite ? teamA.playerIds?.[i] : teamB.playerIds?.[i],
        blackId:   isWhite ? teamB.playerIds?.[i] : teamA.playerIds?.[i],
        whiteName: isWhite ? (teamA.players?.[i]?.name || 'Vacant') : (teamB.players?.[i]?.name || 'Vacant'),
        blackName: isWhite ? (teamB.players?.[i]?.name || 'Vacant') : (teamA.players?.[i]?.name || 'Vacant'),
        result: null
      });
    }
    return { matchNumber, homeTeamId: teamA.id, awayTeamId: teamB.id, homeTeamName: teamA.name, awayTeamName: teamB.name, boards, isResolved: false };
  }

  return { generateTeamPairings };
})();

// ── LOAD TEST ─────────────────────────────────────
function runPairingLoadTest() {
  const mockPlayers = Array.from({ length: 500 }, (_, i) => ({
    id: `p_${i+1}`, name: `Mock ${i+1}`, selectedRating: 1000 + Math.floor(Seeder.random() * 1200),
    score: 0, opponents: [], colors: [], hadBye: false, withdrawn: false
  }));
  Seeder.init('load_test', 1, mockPlayers.map(p => p.id));
  let cpuTime = 0;
  for (let r = 1; r <= 10; r++) {
    const t0 = performance.now();
    const res = SwissEngine.generatePairings(JSON.parse(JSON.stringify(mockPlayers)), r, { seedingStrategy: 'top_vs_bottom' }, false);
    cpuTime += performance.now() - t0;
    (res.pairings || []).forEach(p => {
      const roll = Seeder.random();
      if (roll < 0.4) { p.white.score += 1; } else if (roll < 0.8) { p.black.score += 1; } else { p.white.score += 0.5; p.black.score += 0.5; }
      p.white.opponents.push(p.black.id); p.white.colors.push('white');
      p.black.opponents.push(p.white.id); p.black.colors.push('black');
    });
    if (res.bye) { res.bye.score += 1; res.bye.hadBye = true; }
  }
  return { passed: cpuTime <= 3000, cpuTime, playerCount: 500, roundsCount: 10 };
}
