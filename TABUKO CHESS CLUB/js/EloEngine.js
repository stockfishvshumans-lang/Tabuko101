// js/EloEngine.js — Dynamic Rating Evolution
const EloEngine = (() => {

  /**
   * processMatchResult: Updates Global Passport and Ratings.
   */
  async function processMatchResult(pId, oppId, score, tournamentId, roundNumber = 0, boardNumber = 0) {
    if (!pId || pId.toString().startsWith('temp_') || pId.toString().toLowerCase() === 'vacant') return;

    await db.runTransaction(async (transaction) => {
      const pRef = db.collection('members').doc(pId);
      const pDoc = await transaction.get(pRef);
      if (!pDoc.exists) return;

      const pData = pDoc.data();
      const processedMatchIds = pData.processedMatchIds || [];
      const matchHashToken = `match_${tournamentId}_r${roundNumber}_b${boardNumber}`;

      if (processedMatchIds.includes(matchHashToken)) {
        return; // Early exit: idempotent
      }

      const oppDoc = await db.collection('members').doc(oppId).get();
      const oppRating = oppDoc.exists ? (oppDoc.data().ratings?.club || 1200) : 1200;

      const currentRating = pData.ratings?.club || 1200;
      const kFactor = (pData.passport?.tournamentsPlayed || 0) < 5 ? 40 : 20;
      
      const change = RatingSystem.calculateEloChange(currentRating, oppRating, score, kFactor);
      
      transaction.update(pRef, {
        'ratings.club': currentRating + change,
        'passport.tournamentsPlayed': (pData.passport?.tournamentsPlayed || 0) + 1,
        'metadata.lastMatch': Date.now(),
        'processedMatchIds': firebase.firestore.FieldValue.arrayUnion(matchHashToken)
      });
    });
  }

  return { processMatchResult };
})();

window.EloEngine = EloEngine;
