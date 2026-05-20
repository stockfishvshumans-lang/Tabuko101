// js/PlayerRegistry.js — Tiered Identity Resolution Engine
const PlayerRegistry = (() => {

  /**
   * resolvePlayerIdentity: The definitive 3-Tier Hydrator.
   * Resolution Order: Global Registry -> Tournament Data -> Team Registration
   */
  async function resolvePlayerIdentity(tournamentId, pId, teamId, snapshotName, boardNum) {
    if (!pId) return { name: snapshotName || 'Vacant', source: 'none' };

    // TIER 1: Global Registry (The Authority)
    if (!pId.toString().startsWith('temp_')) {
      const global = await db.collection('members').doc(pId).get();
      if (global.exists) return { name: global.data().name, rating: global.data().ratings?.club || 1200, source: 'Registry' };
    }

    // TIER 2: Tournament playerData (The Context)
    const local = await db.collection('tournaments').doc(tournamentId).collection('playerData').doc(pId).get();
    if (local.exists) return { name: local.data().name, rating: local.data().selectedRating || 0, source: 'Tournament' };

    // TIER 3: Team Registration (The Roster) - CRUCIAL FIX
    if (teamId) {
      const team = await db.collection('tournaments').doc(tournamentId).collection('teams').doc(teamId).get();
      if (team.exists) {
        const teamData = team.data();
        const player = (teamData.players || []).find(p => p.id === pId || Number(p.boardNumber) === Number(boardNum));
        if (player && player.name && player.name !== 'Vacant') {
          return { name: player.name, rating: player.rating || 0, source: 'TeamRoster' };
        }
      }
    }

    // FALLBACK: Snapshot data
    return { name: (snapshotName && snapshotName !== 'Vacant') ? snapshotName : 'Vacant Player', rating: 0, source: 'Snapshot' };
  }

  return { resolvePlayerIdentity };
})();

window.PlayerRegistry = PlayerRegistry;
