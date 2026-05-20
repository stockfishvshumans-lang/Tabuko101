/**
 * club-members.js — Persistent Club Member Roster System
 * Manages global club members and their ratings across tournaments.
 */
const ClubMembers = (() => {

  /**
   * Create a new club member.
   */
  async function createMember(data) {
    const activeClubId = window.TenantManager?.getActiveClubId();
    if (!activeClubId) throw new Error("No active club context found.");

    // Day 223: Member cap enforcement — free tier max 10 active members
    if (window.TierEnforcement) {
      const capResult = await window.TierEnforcement.checkMemberCap(activeClubId);
      if (!capResult.allowed) {
        throw new Error(`Member limit reached (${capResult.count}/${capResult.limit}). Upgrade to Premium for unlimited members.`);
      }
    }

    // Check for duplicate FIDE ID if provided
    if (data.fideId) {
      const existing = await db.collection('members')
        .where('clubId', '==', activeClubId)
        .where('fideId', '==', data.fideId).get();
      if (!existing.empty) throw new Error('A member with this FIDE ID already exists.');
    }

    const ref = db.collection('members').doc();
    const member = {
      id: ref.id,
      name: data.name,
      fideId: data.fideId || null,
      ncfpId: data.ncfpId || null,
      paidUntil: data.paidUntil || null, // Dues Tracking: YYYY-MM-DD
      ratings: {
        fide: data.fideRating || 0,
        ncfp: data.ncfpStandard || data.ncfpRating || 0,
        ncfpRapid: data.ncfpRapid || 0,
        ncfpBlitz: data.ncfpBlitz || 0,
        club: data.clubRating || 1200
      },
      status: 'active', // active | inactive
      isMember: true,
      isArchived: false,
      tournamentsPlayed: 0,
      clubId: activeClubId, // Explicit tenant scope
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await ref.set(member);
    return member;
  }

  async function createBulkMembers(memberArray) {
    if (!memberArray || memberArray.length === 0) return 0;
    // Day 223: Validate array input before processing
    if (!Array.isArray(memberArray)) throw new Error('memberArray must be an array.');

    const activeClubId = window.TenantManager?.getActiveClubId();
    if (!activeClubId) throw new Error("No active club context found.");

    // Day 223: Bulk cap check — how many slots remain?
    if (window.TierEnforcement && !window.TierEnforcement.isPremium()) {
      const capResult = await window.TierEnforcement.checkMemberCap(activeClubId);
      if (!capResult.allowed) {
        throw new Error(`Member limit reached (${capResult.count}/${capResult.limit}). Upgrade to Premium to import bulk members.`);
      }
      const slotsLeft = capResult.limit - capResult.count;
      if (memberArray.length > slotsLeft) {
        memberArray = memberArray.slice(0, slotsLeft);
        if (window.UI?.showToast) UI.showToast(`Free tier: importing first ${slotsLeft} members only.`, 'warning');
      }
    }

    if (window.UI && window.UI.showImportProgressOverlay) {
      window.UI.showImportProgressOverlay(memberArray.length);
    }

    let batch = db.batch();
    let count = 0;
    let totalIngested = 0;

    for (let member of memberArray) {
      const ref = db.collection('members').doc();
      const memberData = {
        ...member,
        id: ref.id,
        clubId: activeClubId,
        isMember: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      batch.set(ref, memberData);
      count++;
      totalIngested++;
      
      if (count === 500) {
        await batch.commit();
        batch = db.batch();
        count = 0;
        if (window.UI && window.UI.updateImportProgress) {
          window.UI.updateImportProgress(totalIngested, memberArray.length);
        }
      }
    }
    if (count > 0) {
      await batch.commit();
      if (window.UI && window.UI.updateImportProgress) {
        window.UI.updateImportProgress(totalIngested, memberArray.length);
      }
    }
    
    if (window.UI && window.UI.hideImportProgressOverlay) {
      window.UI.hideImportProgressOverlay();
    }
    return totalIngested;
  }

  /**
   * Get all active members.
   */
  async function getAllMembers() {
    const activeClubId = window.TenantManager?.getActiveClubId();
    if (!activeClubId) return [];

    const snap = await db.collection('members')
      .where('clubId', '==', activeClubId)
      .where('status', '==', 'active')
      .where('isArchived', '!=', true)
      .orderBy('isArchived')
      .orderBy('name')
      .get();

    // CRITICAL: Explicitly map the document ID into the object
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  /**
   * Update member ratings or status.
   */
  async function updateMember(id, data) {
    const ref = db.collection('members').doc(id);
    await ref.update({
      ...data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  /**
   * Get a single member by ID.
   */
  async function getMember(id) {
    const doc = await db.collection('members').doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  /**
   * Safe removal of a member.
   * Only allows soft delete (deactivation) if they have tournament history.
   * Hard delete only for members with 0 events.
   */
  async function removeMember(id) {
    await db.collection('members').doc(id).update({
      isArchived: true,
      deletedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, action: 'archived' };
  }

  /**
   * Add a member to a tournament by taking a snapshot.
   */
  async function importMemberToTournament(tournamentId, memberId, config) {
    const member = (await db.collection('members').doc(memberId).get()).data();
    if (!member) throw new Error('Member not found');

    const selectedRating = RatingSystem.selectPlayerRating(member, config);

    const tournamentPlayer = {
      id: member.id,
      name: member.name,
      originalMemberId: member.id,
      selectedRating,
      isUnrated: selectedRating === config.defaultRating,
      score: 0,
      opponents: [],
      results: [],
      withdrawn: false,
      isTemporary: false
    };

    // Save to tournament's private player collection
    await db.collection('tournaments').doc(tournamentId).collection('playerData').doc(member.id).set(tournamentPlayer);

    // Add to tournament registry
    await DB.registerPlayerToTournament(tournamentId, member.id);

    // Increment member's counter
    await updateMember(member.id, {
      tournamentsPlayed: firebase.firestore.FieldValue.increment(1)
    });
  }

  /**
   * addTemporaryPlayer: Adds a walk-in/guest directly to a specific tournament.
   * Also registers them in the global active Player Registry as a non-member.
   */
  async function addTemporaryPlayer(tournamentId, data, config) {
    if (!tournamentId) throw new Error("Tournament ID is required.");
    if (!data || !data.name) throw new Error("Player name is required.");

    // 1. Generate a new document reference for the tournament roster
    const newPlayerRef = db.collection('tournaments').doc(tournamentId).collection('playerData').doc();
    const playerId = newPlayerRef.id;

    // 2. Format the player data
    const defaultRating = config?.defaultRating || 1200;
    const clubRating = data.rating || data.clubRating || defaultRating;

    const playerObj = {
      id: playerId,
      name: data.name,
      fideId: data.fideId || null,
      ncfpId: data.ncfpId || null,
      title: data.title || null,
      ratings: {
        fide: data.fideRating || 0,
        ncfp: data.ncfpStandard || data.ncfpRating || 0,
        club: clubRating
      },
      // 🧊 FROZEN SNAPSHOT FOR TOURNAMENT INTEGRITY
      selectedRating: clubRating, // Default used for Swiss pairing math
      ratingSnapshot: {
        fide: data.fideRating || 0,
        ncfp: data.ncfpStandard || data.ncfpRating || 0,
        club: clubRating,
        timestamp: Date.now()
      },
      score: 0,
      isTemporary: true,  // Tags them as a tournament-specific entry
      isMember: false,    // Tags them as a Guest
      withdrawn: false,
      clubId: TenantManager.getActiveClubId(),
      addedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    // 3. Prepare the atomic batch write (All-or-Nothing transaction)
    const batch = db.batch();

    // A. Add to tournament's playerData subcollection
    batch.set(newPlayerRef, playerObj);

    // B. Append to tournament's master playerIds array
    const tournamentRef = db.collection('tournaments').doc(tournamentId);
    batch.update(tournamentRef, {
      playerIds: firebase.firestore.FieldValue.arrayUnion(playerId)
    });

    // 4. Execute the batch to safely inject them into the tournament
    await batch.commit();

    // 5. THE GLOBAL REGISTRY TRACKER (The 30-Day Active Pool)
    try {
      if (window.DB && typeof window.DB.updateRegistryActivity === 'function') {
        await window.DB.updateRegistryActivity(playerObj);
      } else {
        // Fallback: Write directly if DB wrapper isn't found
        await db.collection('playerRegistry').doc(playerId).set({
          id: playerId,
          name: playerObj.name,
          ratings: playerObj.ratings,
          isMember: false,
          lastActiveDate: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    } catch (err) {
      console.warn("[ClubMembers] Failed to update global registry tracker:", err);
    }

    console.log(`[ClubMembers] Added guest player ${data.name} to tournament ${tournamentId} and Global Registry.`);
    return playerObj;
  }

  /**
   * Imports an existing player (Member or Guest) into a tournament
   * and pings the 30-Day Active Radar.
   */
  async function importToTournament(tournamentId, playerId, config) {
    if (!tournamentId || !playerId) throw new Error("Missing tournament or player ID.");

    // 1. Find who they are (Check VIP Vault first, then Registry)
    let playerObj;
    let isMember = false;
    const memberDoc = await db.collection('members').doc(playerId).get();

    if (memberDoc.exists) {
      playerObj = { id: memberDoc.id, ...memberDoc.data() };
      isMember = true;
    } else {
      const regDoc = await db.collection('playerRegistry').doc(playerId).get();
      if (!regDoc.exists) throw new Error("Player not found in system.");
      playerObj = { id: regDoc.id, ...regDoc.data() };
    }

    // 2. Prepare Tournament Data
    const defaultRating = config?.defaultRating || 1200;
    
    // Resolve highest applicable rating based on tournament rules/hierarchy
    let finalRating = defaultRating;
    if (window.RatingSystem && typeof window.RatingSystem.selectPlayerRating === 'function') {
      finalRating = window.RatingSystem.selectPlayerRating(playerObj, config);
    } else {
      // Fallback hierarchy if RatingSystem isn't loaded
      finalRating = playerObj.ratings?.fide || playerObj.ratings?.ncfp || playerObj.ratings?.club || defaultRating;
    }

    const tPlayer = {
      id: playerObj.id,
      name: playerObj.name,
      fideId: playerObj.fideId || null,
      ncfpId: playerObj.ncfpId || null,
      title: playerObj.title || null,
      ratings: playerObj.ratings || { club: finalRating },
      // 🧊 FROZEN SNAPSHOT FOR TOURNAMENT INTEGRITY (Never reads from live after this point)
      selectedRating: finalRating,
      ratingSnapshot: {
        ...playerObj.ratings,
        lockedRating: finalRating,
        timestamp: Date.now()
      },
      score: 0,
      isTemporary: false,
      isMember: isMember, // Accurate flag
      withdrawn: false,
      clubId: TenantManager.getActiveClubId(),
      addedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    // 3. Atomic Batch Insert (Safe saving)
    const batch = db.batch();
    const playerRef = db.collection('tournaments').doc(tournamentId).collection('playerData').doc(playerObj.id);
    batch.set(playerRef, tPlayer);

    const tournamentRef = db.collection('tournaments').doc(tournamentId);
    batch.update(tournamentRef, {
      playerIds: firebase.firestore.FieldValue.arrayUnion(playerObj.id)
    });

    await batch.commit();

    // 4. PING THE RADAR: Reset their 30-day clock and update their status!
    if (window.DB && typeof window.DB.updateRegistryActivity === 'function') {
      await window.DB.updateRegistryActivity(tPlayer);
    }

    return tPlayer;
  }

  /**
   * 30-Day Auto-Delete Policy for Visitor Registry
   */
  async function cleanupRegistry() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const snap = await db.collection('playerRegistry')
      .where('lastActiveDate', '<', thirtyDaysAgo)
      .get();

    if (snap.empty) return 0;

    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    return snap.size;
  }

  /**
   * Convert Visitor to Member (Move and Delete)
   */
  async function promoteVisitorToMember(visitorId) {
    const visitorDoc = await db.collection('playerRegistry').doc(visitorId).get();
    if (!visitorDoc.exists) throw new Error('Visitor not found');

    const data = visitorDoc.data();
    const newMember = await createMember({
      name: data.name,
      clubRating: data.ratings?.club || 1200
    });

    await db.collection('playerRegistry').doc(visitorId).delete();
    return newMember;
  }

  /**
   * Update club ratings for all players after a tournament ends.
   * Processes all matches chronologically to calculate accurate Elo progression.
   */
  async function updateClubRatings(tournamentId) {
    try {
      console.log(`[Ratings] Calculating permanent club ratings for Tournament: ${tournamentId}`);

      // 1. Fetch current permanent members to get their baseline ratings
      const activeClubId = window.TenantManager?.getActiveClubId();
      const membersSnap = await db.collection('members')
        .where('clubId', '==', activeClubId)
        .get();
      const memberRatings = {};
      membersSnap.docs.forEach(doc => {
        // Default to 1200 if they don't have a club rating yet
        memberRatings[doc.id] = doc.data().ratings?.club || 1200;
      });

      // 2. Fetch ALL rounds and matches from this tournament
      const roundsSnap = await db.collection('tournaments').doc(tournamentId).collection('rounds').get();
      const matches = [];
      roundsSnap.docs.forEach(doc => {
        const roundData = doc.data();
        if (roundData.pairings) {
          // Attach the round number so we can sort them chronologically
          const pairingsWithRound = roundData.pairings.map(p => ({ ...p, round: roundData.roundNumber }));
          matches.push(...pairingsWithRound);
        }
      });

      // 3. Sort chronologically (CRITICAL for accurate FIDE/Elo math)
      matches.sort((a, b) => a.round - b.round);

      // 4. Track who actually played in this tournament so we don't update everyone in the database
      const playersToUpdate = new Set();

      // 5. Calculate Elo changes match-by-match
      matches.forEach(match => {
        // Skip unplayed games, pending games, or byes
        if (!match.result || match.result === 'pending' || match.isBye) return;

        const whiteId = match.whiteId;
        const blackId = match.blackId;

        // Skip if they are temporary guests not in the permanent members database
        if (memberRatings[whiteId] === undefined || memberRatings[blackId] === undefined) return;

        playersToUpdate.add(whiteId);
        playersToUpdate.add(blackId);

        const whiteRating = memberRatings[whiteId];
        const blackRating = memberRatings[blackId];

        let whiteScore = 0.5, blackScore = 0.5;
        if (match.result === '1-0') { whiteScore = 1; blackScore = 0; }
        if (match.result === '0-1') { whiteScore = 0; blackScore = 1; }

        // Use your existing math engine (Assuming K-factor of 20 for standard games)
        // Ensure RatingSystem exists, otherwise fallback to standard math
        const calculateElo = window.RatingSystem ? window.RatingSystem.calculateEloChange :
          (r1, r2, s) => Math.round(20 * (s - (1 / (1 + Math.pow(10, (r2 - r1) / 400)))));

        const whiteChange = calculateElo(whiteRating, blackRating, whiteScore, 20);
        const blackChange = calculateElo(blackRating, whiteRating, blackScore, 20);

        // Update in-memory tracker for the next round's math
        memberRatings[whiteId] += whiteChange;
        memberRatings[blackId] += blackChange;
      });

      // 6. Push all new ratings to the database using an Atomic Batch
      const batch = db.batch();

      playersToUpdate.forEach(memberId => {
        const memberRef = db.collection('members').doc(memberId);
        batch.update(memberRef, {
          'ratings.club': memberRatings[memberId],
          'updatedAt': firebase.firestore.FieldValue.serverTimestamp()
        });
      });

      if (playersToUpdate.size > 0) {
        await batch.commit();
        console.log(`[Ratings] Successfully updated permanent Elo for ${playersToUpdate.size} members.`);
      }

      return true;

    } catch (error) {
      console.error("[Ratings] Failed to update club ratings:", error);
      throw error;
    }
  }

  return {
    createMember, createBulkMembers, getAllMembers, getMember, updateMember, removeMember,
    importToTournament, addTemporaryPlayer, updateClubRatings, cleanupRegistry, promoteVisitorToMember
  };
})();
