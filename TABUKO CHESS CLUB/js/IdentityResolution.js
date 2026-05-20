/**
 * IdentityResolution.js
 * Centralized identity mapping service for the Tabuko Tournament Engine.
 * Implements a 3-tier fail-safe resolution: Registry -> Tournament Roster -> Snapshot
 */
const IdentityResolution = (() => {
  // Day 147 Task 1: In-Memory Key-Value Directory Cache
  const _resolvedIdentityCacheMap = {};
  
  /**
   * enforcePrefix: Deterministic identity string separators
   */
  function enforcePrefix(id, origin) {
    if (!id) return id;
    const strId = id.toString();
    if (strId === 'BYE') return 'sys_bye';
    if (strId.startsWith('mbr_') || strId.startsWith('gst_') || strId === 'sys_bye') return strId;
    
    if (origin === 'master') return `mbr_${strId}`;
    if (origin === 'guest') return `gst_${strId}`;
    return strId;
  }

  /**
   * resolvePlayer: Returns the most accurate player name and rating.
   */
  // Day 217 Task 1: Pre-Flight Identity Mapping Array Validators & Day 217 Task 2: Null Property Safety Interceptors
  function sanitizePlayerProfile(p) {
    if (!p || typeof p !== 'object') {
      return { id: 'temp_unknown', name: 'Vacant', rating: 1200, federation: 'LOCAL', countryCode: 'PHI', results: [], roundScores: [] };
    }
    
    const s = { ...p };
    
    if (!s.name || s.name.trim() === '' || s.name.toLowerCase() === 'vacant') {
      s.name = 'Vacant';
    }
    
    // Safety check ratings
    const parsedRating = parseInt(s.selectedRating || s.rating || (s.ratings && s.ratings.club));
    if (isNaN(parsedRating) || parsedRating <= 0) {
      s.rating = 1200; // Baseline fallback
    } else {
      s.rating = parsedRating;
    }
    
    if (!s.federation || s.federation.trim() === '') {
      s.federation = 'LOCAL';
    }
    
    if (!s.countryCode || s.countryCode.trim() === '') {
      s.countryCode = 'PHI';
    }

    if (!Array.isArray(s.results)) {
      s.results = [];
    }
    if (!Array.isArray(s.roundScores)) {
      s.roundScores = [];
    }
    
    return s;
  }

  /**
   * resolvePlayer: Returns the most accurate player name and rating.
   */
  async function resolvePlayer(tournamentId, teamId, pId, pName, boardNum, playerMap = null, teamObject = null) {
    // Check local memory cache map first for instant extraction
    if (pId && _resolvedIdentityCacheMap[pId]) {
      return _resolvedIdentityCacheMap[pId];
    }

    const bNum = Number(boardNum);
    const isGuest = pId && pId.toString().startsWith('gst_');
    let resolved = null;

    // Tier 1: Local or Global Registry (Direct ID Match)
    // 🛡️ DATA OVERWRITE FIREWALL: Block guest records from querying primary member properties
    if (pId && !pId.toString().startsWith('temp_') && !isGuest) {
      // Check local tournament map first (Primary Authority)
      if (playerMap && playerMap[pId]) {
        const audited = sanitizePlayerProfile(playerMap[pId]);
        resolved = { 
          name: audited.name, 
          rating: audited.rating,
          federation: audited.federation,
          countryCode: audited.countryCode
        };
      } else {
        // Fallback: Global Registry (if db is available)
        try {
          const doc = await db.collection('members').doc(pId).get();
          if (doc.exists) {
            const audited = sanitizePlayerProfile(doc.data());
            resolved = { 
              name: audited.name, 
              rating: audited.rating,
              federation: audited.federation,
              countryCode: audited.countryCode
            };
          }
        } catch (e) {}
      }
    }

    // Tier 2: Team Roster (Lookup by Board Number or ID)
    if (!resolved) {
      let team = teamObject;
      if (!team && teamId && tournamentId) {
        try {
          const doc = await db.collection('tournaments').doc(tournamentId).collection('teams').doc(teamId).get();
          team = doc.exists ? doc.data() : null;
        } catch (e) { console.error("IdentityResolution: Team fetch failed", e); }
      }

      if (team && team.players) {
        // Find by ID, then by Board Number (normalize for both board and boardNumber keys)
        const p = team.players.find(x => 
          (pId && x.id === pId) || 
          (x.boardNumber == bNum) || 
          (x.board == bNum)
        );

        if (p && p.name && p.name.trim() !== '' && p.name.toLowerCase() !== 'vacant') {
          const audited = sanitizePlayerProfile(p);
          resolved = { 
            name: audited.name, 
            rating: audited.rating,
            federation: audited.federation,
            countryCode: audited.countryCode
          };
        } else if (bNum <= team.players.length) {
          const bp = team.players[bNum - 1];
          if (bp && bp.name && bp.name.trim() !== '' && bp.name.toLowerCase() !== 'vacant') {
            const audited = sanitizePlayerProfile(bp);
            resolved = { 
              name: audited.name, 
              rating: audited.rating,
              federation: audited.federation,
              countryCode: audited.countryCode
            };
          }
        }
      }
    }

    // Tier 3: Snapshot Fallback (The pairing itself)
    if (!resolved) {
      resolved = { 
        name: (pName && pName.toLowerCase() !== 'vacant' && pName.trim() !== '') ? pName : 'Vacant', 
        rating: 1200,
        federation: 'LOCAL',
        countryCode: 'PHI'
      };
    }

    // Store in private key-value dictionary block
    if (pId) {
      _resolvedIdentityCacheMap[pId] = resolved;
    }

    return resolved;
  }

  /**
   * resolveTeam: Returns the most accurate team name.
   */
  async function resolveTeam(tournamentId, teamId, snapshotName, teamMap = null) {
    if (teamId && teamMap && teamMap[teamId]) return teamMap[teamId].name;
    
    if (teamId) {
      const doc = await db.collection('tournaments').doc(tournamentId).collection('teams').doc(teamId).get();
      if (doc.exists) return doc.data().name;
    }

    return snapshotName || 'Unknown Team';
  }

  return { resolvePlayer, resolveTeam, enforcePrefix, _resolvedIdentityCacheMap };
})();

window.IdentityResolution = IdentityResolution;
