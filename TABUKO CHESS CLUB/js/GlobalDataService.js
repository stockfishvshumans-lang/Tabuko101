/**
 * GlobalDataService.js — Cross-Tenant Intelligence (Super Admin Only)
 * Bypasses tenant filters to provide holistic ecosystem oversight.
 */
const GlobalDataService = (() => {
  
  /**
   * Fetch all registered clubs with metadata.
   */
  async function getAllClubs() {
    if (!TenantManager.isMasterAdmin()) return [];
    try {
      const snap = await db.collection('clubs').get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('[GlobalData] Failed to fetch clubs:', err);
      return [];
    }
  }

  /**
   * Drill-down: Fetch all members for a specific club.
   */
  async function getClubMembers(clubId) {
    if (!TenantManager.isMasterAdmin()) return [];
    try {
      const snap = await db.collection('members').where('clubId', '==', clubId).get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      // Fallback: check sub-collection if necessary
      const subSnap = await db.collection('clubs').doc(clubId).collection('members').get();
      return subSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
  }

  /**
   * Drill-down: Fetch tournament history for a club.
   */
  async function getClubTournaments(clubId) {
    if (!TenantManager.isMasterAdmin()) return [];
    try {
      const snap = await db.collection('tournaments').where('clubId', '==', clubId).orderBy('createdAt', 'desc').limit(30).get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      return [];
    }
  }

  /**
   * Global Search: Query across names, cities, and emails.
   */
  async function searchDirectory(query) {
    if (!TenantManager.isMasterAdmin() || !query) return [];
    const q = query.toLowerCase();
    const all = await getAllClubs();
    
    return all.filter(c => 
      c.name?.toLowerCase().includes(q) || 
      c.city?.toLowerCase().includes(q) || 
      c.admin_email?.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    );
  }

  /**
   * Global Registry: Fetch all members across all clubs using collectionGroup or targeted subcollections.
   */
  async function compileGlobalPlayers() {
    const activeClubId = window.TenantManager?.getActiveClubId?.() || 'default';
    
    // Day 150 Task 2: Explicit Document Path Routing
    if (!TenantManager.isMasterAdmin()) {
      if (!activeClubId || activeClubId === 'default') return [];
      try {
        const snap = await db.collection('clubs').doc(activeClubId).collection('members').get();
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data(), clubId: activeClubId }));
      } catch (err) {
        console.error('[GlobalData] Failed to compile club registry:', err);
        return [];
      }
    }

    try {
      const snap = await db.collectionGroup('members').get();
      return snap.docs.map(doc => {
        const data = doc.data();
        const resolvedClubId = data.clubId || doc.ref.parent.parent?.id || 'Unknown';
        if (data.isPublic === false) {
          return { id: doc.id, name: data.name, ratings: data.ratings, clubId: resolvedClubId, email: '[REDACTED]', phone: '[REDACTED]' };
        }
        return { id: doc.id, ...data, clubId: resolvedClubId };
      });
    } catch (err) {
      console.error('[GlobalData] Failed to compile registry:', err);
      return [];
    }
  }

  /**
   * Public Search: Anonymized lookup for public tournament pages
   */
  async function searchPublicDirectory(query) {
    if (!query) return [];
    const activeClubId = window.TenantManager?.getActiveClubId?.();
    const q = query.toLowerCase();

    // Day 150 Task 2: Explicit Document Path Routing
    if (activeClubId) {
      try {
        const snap = await db.collection('clubs').doc(activeClubId).collection('members').get();
        return snap.docs.map(doc => {
          const d = doc.data();
          return { id: doc.id, name: d.name, ratings: d.ratings, clubId: activeClubId, fideId: d.fideId };
        }).filter(m => m.name && m.name.toLowerCase().includes(q));
      } catch (err) {
        console.error('[GlobalData] Public search on active club failed, trying collectionGroup fallback:', err);
      }
    }

    try {
      const snap = await db.collectionGroup('members').get();
      return snap.docs.map(doc => {
        const d = doc.data();
        const resolvedClubId = d.clubId || doc.ref.parent.parent?.id || 'Unknown';
        return { id: doc.id, name: d.name, ratings: d.ratings, clubId: resolvedClubId, fideId: d.fideId };
      }).filter(m => m.name && m.name.toLowerCase().includes(q));
    } catch (err) {
      return [];
    }
  }

  return { getAllClubs, getClubMembers, getClubTournaments, searchDirectory, searchPublicDirectory, compileGlobalPlayers };
})();

window.GlobalDataService = GlobalDataService;
