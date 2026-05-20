/**
 * ClubManager.js — Backend Provisioning for Tabuko Clubs
 * Handles atomic creation of Club and Admin User documents.
 */
const ClubManager = (() => {

  /**
   * Provision a new club and bind its administrator.
   * @param {Object} formData - Data from the Registration Wizard
   * @param {string} uid - Firebase Auth UID
   * @param {string} logoUrl - Final resolved logo URL
   * @param {string} logoDriveId - Google Drive ID for logo
   */
  async function provisionClub(formData, uid, logoUrl, logoDriveId) {
    const batch = db.batch();
    
    const clubRef = db.collection('clubs').doc(formData.clubSlug);
    const userRef = db.collection('users').doc(uid);
    
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7);

    // 1. Club Document Setup
    batch.set(clubRef, {
      id: formData.clubSlug,
      name: formData.clubName,
      admin_uid: uid,
      tenantKey: formData.tenantKey || Math.random().toString(36).substring(2, 15),
      branding: {
        primaryColor: formData.primaryColor,
        logoUrl: logoUrl || null,
        logoDriveId: logoDriveId || null
      },
      presence: {
        bio: formData.bio || '',
        location: {
          city: formData.city || '',
          address: formData.address || ''
        },
        socials: {
          fb: formData.socialFB || '',
          yt: formData.socialYT || '',
          web: formData.socialWeb || ''
        },
        isPublic: formData.isPublic !== undefined ? formData.isPublic : true,
        gcashEnabled: formData.gcashEnabled || false
      },
      subscription: {
        is_premium: true,
        status: 'trial',
        expiresAt: firebase.firestore.Timestamp.fromDate(trialEnd)
      },
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 2. Admin User Document Setup
    batch.set(userRef, {
      uid: uid,
      email: formData.email,
      fullName: formData.fullName,
      phone: `+63${formData.mobile}`,
      personalRole: formData.personalRole,
      clubId: formData.clubSlug,
      role: 'admin',
      hasCompletedSetup: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 3. Inject Welcome Tournament Draft
    const tourRef = db.collection('tournaments').doc();
    batch.set(tourRef, {
      id: tourRef.id,
      clubId: formData.clubSlug,
      admin_uid: uid,
      title: 'Welcome Blitz Draft Open',
      description: 'Welcome to Tabuko! Use this tournament to test the pairing engine and results entry.',
      format: 'swiss',
      status: 'draft',
      timeControl: '10+5',
      maxRounds: 5,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      sections: [
        { name: 'Open Section', id: 'sec_1', players: [] }
      ]
    });

    return batch.commit();
  }

  return { provisionClub };
})();

window.ClubManager = ClubManager;
