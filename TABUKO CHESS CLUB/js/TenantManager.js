/**
 * TenantManager.js — Hardened Multi-Tenant Engine
 * Controls club isolation, subscription enforcement, and Master Admin priority.
 */
const TenantManager = (() => {
  let activeClubId = null;
  let activeClubData = null;
  let _originalClubId = null; // Shadow Login state
  let _isShadowMode = false;

  // ══════════════════════════════════════════════════════════
  //  MASTER CREDENTIALS — Jesstergirado@gmail.com
  //  The UID will be resolved dynamically on first login.
  //  Once known, set it here for instant identification.
  // ══════════════════════════════════════════════════════════
  const MASTER_EMAIL = 'giradojesster28@gmail.com';
  let MASTER_UID = null; // Resolved dynamically

  async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    activeClubId = urlParams.get('club') || localStorage.getItem('activeClubId');

    Auth.onAuthChange(async (user, userData) => {
      if (user) {
        // ── MASTER UID RESOLUTION ──
        // Resolve the Master UID dynamically from the email
        if (user.email && user.email.toLowerCase() === MASTER_EMAIL) {
          MASTER_UID = user.uid;
          localStorage.setItem('_masterUid', user.uid);
          console.log('[Tenant] Master Admin authenticated:', user.uid);
        } else {
          // Fallback: check localStorage for previously resolved UID
          MASTER_UID = localStorage.getItem('_masterUid') || null;
        }

        if (!activeClubId && userData?.clubId) {
          activeClubId = userData.clubId;
        }

        // ── KILL SWITCH CHECK ──
        // If the user's club is suspended, sign them out immediately
        if (!isMasterAdmin() && userData?.clubId) {
          const suspended = await isClubSuspended(userData.clubId);
          if (suspended) {
            showSuspensionScreen();
            await Auth.signOut();
            return;
          }
        }

        if (activeClubId) {
          // ── TENANT ANCHOR RESET ──
          ensureTenantIsolation(activeClubId);
          
          await resolveTenant(activeClubId, user.uid);
          localStorage.setItem('activeClubId', activeClubId);
        }

        // Listen for system announcements
        listenForAnnouncements();
        
        // ── REMOTE SURGEON LISTENER ──
        if (activeClubId) listenForRemoteCommands(activeClubId);

        // ── LOGIC VERSION HANDSHAKE (Step 4 Security) ──
        checkLogicVersion();

        // ── IDENTITY BINDING (Step 4 Security) ──
        if (activeClubId) bindAdminUID(activeClubId);
        else if (userData?.clubId) bindAdminUID(userData.clubId);
      } else {
        // ── SIGN OUT CLEANUP ──
        if (_announcementUnsub) {
          _announcementUnsub();
          _announcementUnsub = null;
        }
        MASTER_UID = null;
      }
    });
  }

  function ensureTenantIsolation(newClubId) {
    const cachedClubId = localStorage.getItem('activeClubId');
    if (cachedClubId && cachedClubId !== newClubId) {
      console.warn(`[Tenant] Switching silos: ${cachedClubId} → ${newClubId}. Executing Hard Purge.`);
      triggerHardRefresh();
    }
  }

  async function resolveTenant(clubId, uid) {
    try {
      console.log(`[Tenant] Silo Active for Club:`, clubId);
      const clubDoc = await db.collection('clubs').doc(clubId).get();

      if (!clubDoc.exists) {
        console.warn(`[Tenant] Club ${clubId} does not exist.`);
        return;
      }

      activeClubData = clubDoc.data();

      const isAdmin = activeClubData.admin_uid === uid;
      const isMaster = isMasterAdmin();

      window.dispatchEvent(new CustomEvent('tenantLoaded', {
        detail: { clubData: activeClubData, isAdmin, isMaster }
      }));

      applyBranding(activeClubData.branding);
    } catch (err) {
      console.error('[Tenant] Error resolving tenant:', err);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  SUBSCRIPTION ENFORCEMENT
  // ══════════════════════════════════════════════════════════
  function isSubscriptionActive() {
    // Master Admin ALWAYS has access — never locked out
    if (isMasterAdmin()) return true;

    if (!activeClubData || !activeClubData.subscription) return false;

    // Soft Landing: Check is_premium flag and expiry
    const isPremium = activeClubData.subscription.is_premium === true;
    const now = new Date();
    let expiry;

    if (activeClubData.subscription.end_date?.toDate) {
      expiry = activeClubData.subscription.end_date.toDate();
    } else {
      expiry = new Date(activeClubData.subscription.end_date);
    }

    const isActive = now < expiry;
    
    // Hardened Rule: Both must be true for full access
    const status = (isPremium && isActive);
    
    // Auto-Toggle if trial expired
    if (!status && activeClubData.subscription.is_premium) {
      console.warn('[Tenant] Subscription expired. Reverting to basic.');
      // Note: We don't update DB here to avoid write loops, but UI will reflect lock.
    }

    return status;
  }

  /**
   * isFeatureLocked: Specific check for premium-only tools (FIDE Export, Arbiter Links)
   */
  function isFeatureLocked(featureId) {
    if (isMasterAdmin()) return false;
    const active = isSubscriptionActive();
    if (!active) return true; // All locked if subscription is dead

    // Add specific feature gating here if needed
    return false;
  }

  function getTrialDaysRemaining() {
    if (!activeClubData?.subscription?.end_date) return 0;
    const end = activeClubData.subscription.end_date.toDate ? activeClubData.subscription.end_date.toDate() : new Date(activeClubData.subscription.end_date);
    const diff = end - new Date();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  // ══════════════════════════════════════════════════════════
  //  SHADOW LOGIN (Impersonation Mode)
  // ══════════════════════════════════════════════════════════
  function enterShadowMode(targetClubId) {
    if (!isMasterAdmin()) return;
    _originalClubId = activeClubId;
    _isShadowMode = true;
    activeClubId = targetClubId;
    localStorage.setItem('activeClubId', targetClubId);
    console.log(`[Tenant] SHADOW MODE: Viewing as club ${targetClubId}`);

    // Resolve the new tenant context
    resolveTenant(targetClubId, Auth.getUser().uid);
  }

  function exitShadowMode() {
    if (!_isShadowMode) return;
    activeClubId = _originalClubId;
    _isShadowMode = false;
    _originalClubId = null;
    localStorage.setItem('activeClubId', activeClubId || '');
    console.log('[Tenant] SHADOW MODE: Exited');
  }

  // ══════════════════════════════════════════════════════════
  //  KILL SWITCH
  // ══════════════════════════════════════════════════════════
  async function isClubSuspended(clubId) {
    try {
      const doc = await db.collection('clubs').doc(clubId).get();
      if (!doc.exists) return false;
      return doc.data().suspended === true;
    } catch (e) {
      return false;
    }
  }

  function showSuspensionScreen() {
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0f;color:#fff;font-family:'Inter',sans-serif;">
          <div style="text-align:center;max-width:500px;padding:3rem;">
            <div style="font-size:4rem;margin-bottom:1.5rem;">🚫</div>
            <h1 style="font-size:2rem;font-weight:900;margin-bottom:1rem;color:#ff4d4d;">Account Suspended</h1>
            <p style="color:#999;line-height:1.8;margin-bottom:2rem;">Your club account has been suspended by the platform administrator. If you believe this is an error, please contact support.</p>
            <p style="color:#555;font-size:0.8rem;">Contact: Jesstergirado@gmail.com</p>
          </div>
        </div>
      `;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  HARD REFRESH (Purge Cache & Firestore Snap)
  // ══════════════════════════════════════════════════════════
  async function triggerHardRefresh() {
    showPurgingOverlay();
    
    // 1. Clear LocalStorage
    localStorage.clear();
    
    // 2. Clear IndexedDB (Firestore Cache)
    if (db.terminate) {
      await db.terminate();
      await db.clearPersistence();
    }

    // 3. Unregister Service Workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }

    // 4. Force Reload from Server
    setTimeout(() => {
      window.location.reload(true);
    }, 2000);
  }

  function showPurgingOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'purging-overlay fade-in';
    overlay.innerHTML = `
      <div class="purging-spinner"></div>
      <h2 style="font-weight: 900; letter-spacing: 2px; color: #fff;">PURGING SYSTEM CACHE</h2>
      <p style="color: #10B981; font-family: monospace; font-size: 0.8rem; margin-top: 1rem;">Re-pairing Infrastructure... [OK]</p>
    `;
    document.body.appendChild(overlay);
  }

  // ══════════════════════════════════════════════════════════
  //  GLOBAL ANNOUNCEMENTS LISTENER
  // ══════════════════════════════════════════════════════════
  let _announcementUnsub = null;

  function listenForAnnouncements() {
    if (_announcementUnsub) return; // Already listening

    _announcementUnsub = db.collection('system').doc('announcements')
      .onSnapshot(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        if (!data.active || !data.message) return;

        // Don't show to master admin on command center
        if (isMasterAdmin() && window.location.hash === '#/super-admin') return;

        showAnnouncementBanner(data.message, data.type || 'info');
      }, err => {
        console.warn('[Tenant] Announcement listener error:', err.message);
      });
  }

  /**
   * Listen for remote signals from the Super Admin (Remote Surgeon).
   */
  let _commandUnsub = null;
  function listenForRemoteCommands(clubId) {
    if (_commandUnsub) _commandUnsub();
    
    _commandUnsub = db.collection('system').doc(`cmd_${clubId}`)
      .onSnapshot(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        if (!data.command) return;

        // Command: PURGE_CACHE
        if (data.command === 'PURGE_CACHE' && data.timestamp) {
          const lastPurge = localStorage.getItem('_lastRemotePurge') || 0;
          const remoteTime = data.timestamp.toMillis ? data.timestamp.toMillis() : data.timestamp;
          
          if (remoteTime > lastPurge) {
            console.log('[Tenant] Remote Surgeon: PURGE_CACHE signal received.');
            localStorage.setItem('_lastRemotePurge', remoteTime);
            triggerHardRefresh();
          }
        }
      });
  }

  async function triggerHardRefresh() {
    UI.showLoading('System Synchronizing...');
    
    // Clear all localStorage except identity keys
    const mUid = localStorage.getItem('_masterUid');
    const aId = localStorage.getItem('activeClubId');
    localStorage.clear();
    if (mUid) localStorage.setItem('_masterUid', mUid);
    if (aId) localStorage.setItem('activeClubId', aId);

    // Unregister Service Workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (let reg of registrations) await reg.unregister();
    }

    // Force hard reload
    setTimeout(() => {
      window.location.reload(true);
    }, 1000);
  }

  function showAnnouncementBanner(message, type) {
    // Remove existing banner if any
    const existing = document.getElementById('system-announcement-banner');
    if (existing) existing.remove();

    const colors = {
      info: { bg: 'rgba(0, 122, 255, 0.15)', border: '#007aff', text: '#5ac8fa' },
      warning: { bg: 'rgba(255, 159, 10, 0.15)', border: '#ff9f0a', text: '#ffd60a' },
      critical: { bg: 'rgba(255, 55, 95, 0.15)', border: '#ff375f', text: '#ff6961' }
    };
    const c = colors[type] || colors.info;

    const banner = document.createElement('div');
    banner.id = 'system-announcement-banner';
    banner.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:99999;padding:0.75rem 1.5rem;background:${c.bg};border-bottom:2px solid ${c.border};color:${c.text};font-weight:700;font-size:0.85rem;text-align:center;font-family:'Inter',sans-serif;animation:pulse 2s infinite;backdrop-filter:blur(10px);`;
    banner.innerHTML = `
      <span>📢 ${message}</span>
      <button onclick="this.parentElement.remove()" style="position:absolute;right:1rem;top:50%;transform:translateY(-50%);background:none;border:none;color:${c.text};cursor:pointer;font-size:1.2rem;">×</button>
    `;
    document.body.prepend(banner);
  }

  // ══════════════════════════════════════════════════════════
  //  TRIAL PROVISIONING
  // ══════════════════════════════════════════════════════════
  async function provisionTrial(uid, clubId) {
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 7);

    const batch = db.batch();
    const generatedClubId = clubId || `club_${Math.random().toString(36).substr(2, 9)}`;

    const clubRef = db.collection('clubs').doc(generatedClubId);
    batch.set(clubRef, {
      name: "New Chess Club",
      admin_uid: uid,
      subscription: {
        status: 'premium_trial',
        end_date: firebase.firestore.Timestamp.fromDate(trialEndDate),
        is_premium: true,
        has_used_trial: true
      },
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const userRef = db.collection('users').doc(uid);
    batch.update(userRef, {
      clubId: generatedClubId,
      trialProvisioned: true,
      role: 'admin'
    });

    await batch.commit();
    console.log(`[Tenant] Trial provisioned for ${uid} until ${trialEndDate}`);
  }

  // ══════════════════════════════════════════════════════════
  //  BRANDING
  // ══════════════════════════════════════════════════════════
  function applyBranding(branding) {
    if (!branding) return;
    const root = document.documentElement;
    if (branding.colors) {
      if (branding.colors.primary) {
        root.style.setProperty('--club-primary', branding.colors.primary);
        root.style.setProperty('--cobalt-blue', branding.colors.primary);
        root.style.setProperty('--cobalt-glow', `0 0 15px ${branding.colors.primary}66`); // 40% opacity hex
      }
      if (branding.colors.secondary) {
        root.style.setProperty('--club-secondary', branding.colors.secondary);
        root.style.setProperty('--hub-glass', branding.colors.secondary);
      }
    }
    if (branding.logo_url || activeClubData?.logoUrl) {
      const url = branding.logo_url || activeClubData.logoUrl;
      document.querySelectorAll('.club-logo-target').forEach(img => {
        img.src = url;
        img.style.display = 'block';
      });
    }
  }

  function isMasterAdmin() {
    const user = Auth.getUser();
    if (!user) return false;
    
    const email = (user.email || '').toLowerCase().trim();
    const isMaster = (MASTER_UID && user.uid === MASTER_UID) || (email === MASTER_EMAIL);
    
    if (isMaster && !_isShadowMode) {
       // Debug hook for developer
       if (!window._gv_active) {
         console.log('%c[GOD VIEW] Authority Verified: giradojesster28', 'color: #00f2ff; font-weight: bold; background: #000; padding: 2px 5px;');
         window._gv_active = true;
       }
    }
    
    return isMaster;
  }

  // ══════════════════════════════════════════════════════════
  //  WORKSPACE SWITCHER
  //  Hard-reload + cache purge to prevent cross-contamination
  // ══════════════════════════════════════════════════════════
  async function switchWorkspace(newClubId) {
    if (typeof window.UI !== 'undefined' && window.UI.showWorkspaceHydrationScreen) {
      window.UI.showWorkspaceHydrationScreen();
    }
    
    if (window.activeTournamentUnsub) { window.activeTournamentUnsub(); window.activeTournamentUnsub = null; }
    if (window.activeRoundUnsub) { window.activeRoundUnsub(); window.activeRoundUnsub = null; }
    
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (let r of regs) await r.unregister();
    }
    if (window.caches) {
      const keys = await caches.keys();
      for (let k of keys) await caches.delete(k);
    }

    // Purge local state
    activeClubId = null;
    activeClubData = null;
    localStorage.setItem('activeClubId', newClubId);
    sessionStorage.clear();

    // Hard reload to re-initialize with new context
    window.location.reload(true);
  }

  async function getUserClubs() {
    const user = Auth.getUser();
    if (!user) return [];
    // Master admin can see all clubs
    if (isMasterAdmin()) {
      const snap = await db.collection('clubs').get();
      return snap.docs.map(d => ({ id: d.id, name: d.data().name || d.id }));
    }
    // Normal users: check by admin_uid
    const snap = await db.collection('clubs').where('admin_uid', '==', user.uid).get();
    return snap.docs.map(d => ({ id: d.id, name: d.data().name || d.id }));
  }

  // ══════════════════════════════════════════════════════════
  //  LOGIC VERSION CHECK (Step 3: Ruleset Handshake)
  // ══════════════════════════════════════════════════════════
  const LOCAL_LOGIC_VERSION = '2.2.8';

  async function checkLogicVersion() {
    try {
      const configDoc = await db.collection('system').doc('config').get();
      if (!configDoc.exists) return true; // No config = no enforcement
      const minVersion = configDoc.data().min_required_version;
      if (!minVersion) return true;

      if (compareVersions(LOCAL_LOGIC_VERSION, minVersion) < 0) {
        console.warn(`[Tenant] Logic outdated: local=${LOCAL_LOGIC_VERSION}, required=${minVersion}`);
        // Purge service worker and force reload
        if (navigator.serviceWorker) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) await reg.unregister();
        }
        if (window.caches) {
          const names = await caches.keys();
          for (const n of names) await caches.delete(n);
        }
        window.location.reload(true);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('[Tenant] Version check failed:', e.message);
      return true;
    }
  }

  function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0, nb = pb[i] || 0;
      if (na < nb) return -1;
      if (na > nb) return 1;
    }
    return 0;
  }

  // ══════════════════════════════════════════════════════════
  //  UID BINDING (Step 2: Identity Lock)
  //  On first admin login, permanently bind UID to club
  // ══════════════════════════════════════════════════════════
  async function bindAdminUID(clubId) {
    const user = Auth.getUser();
    if (!user || isMasterAdmin()) return;

    const clubDoc = await db.collection('clubs').doc(clubId).get();
    if (!clubDoc.exists) return;

    const data = clubDoc.data();
    if (data.admin_uid) return; // Already bound

    // Verify this user was pre-authorized
    if (data.admin_email && data.admin_email.toLowerCase() === user.email?.toLowerCase()) {
      await db.collection('clubs').doc(clubId).update({
        admin_uid: user.uid,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log(`[Tenant] UID ${user.uid} permanently bound to club ${clubId}`);
    }
  }

  function secureGetLocalStorageItem(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.__corrupted__ || parsed.error || parsed.invalid) {
            console.warn(`[Storage Sanitizer] Corrupted object signature in key "${key}". Clearing cache...`);
            localStorage.removeItem(key);
            return null;
          }
        }
        return parsed;
      } catch (e) {
        console.warn(`[Storage Sanitizer] Invalid JSON structure inside key "${key}". Auto-purging...`);
        localStorage.removeItem(key);
        return null;
      }
    }
    return raw;
  }
  window.secureGetLocalStorageItem = secureGetLocalStorageItem;

  return {
    init,
    getActiveClubId: () => activeClubId,
    getActiveClubData: () => activeClubData,
    isMasterAdmin,
    isSubscriptionActive,
    isFeatureLocked,
    getTrialDaysRemaining,
    isShadowMode: () => _isShadowMode,
    enterShadowMode,
    exitShadowMode,
    isClubSuspended,
    switchWorkspace,
    getUserClubs,
    checkLogicVersion,
    bindAdminUID,
    triggerHardRefresh,
    secureGetLocalStorageItem,
    LOCAL_LOGIC_VERSION,
    MASTER_UID: () => MASTER_UID,
    MASTER_EMAIL
  };
})();

window.TenantManager = TenantManager;
TenantManager.init();