/**
 * auth.js — Hardened Authentication Module
 * Days 241–245: Brute-force rate limiter, exponential backoff, single-device session lock.
 * Days 201–300 Sprint: Client-side attempt counter + server-side security_meta tracking.
 */
const Auth = (() => {
  let currentUser = null;
  let currentUserData = null;
  const listeners = [];
  let sessionWatchdog = null;

  const ADMIN_DOMAIN_ALIAS = '@admin';
  const ADMIN_DOMAIN_REAL  = '@admin.tabuko.local';

  // ── DAY 241: ATTEMPT COUNTER CONSTANTS ───────
  const MAX_CLIENT_ATTEMPTS  = 5;   // Client-side lockout threshold
  const MAX_SERVER_ATTEMPTS  = 10;  // Server-side hard lockout
  const LOCKOUT_BASE_MS      = 1000; // Base for 2^n backoff

  function resolveEmail(input) {
    let email = input.trim().toLowerCase();
    if (email.endsWith(ADMIN_DOMAIN_ALIAS)) email = email.replace(ADMIN_DOMAIN_ALIAS, ADMIN_DOMAIN_REAL);
    return email;
  }

  function displayEmail(email) {
    if (!email) return '';
    return email.replace(ADMIN_DOMAIN_REAL, ADMIN_DOMAIN_ALIAS);
  }

  // ── DAY 241: CLIENT-SIDE ATTEMPT TRACKER ─────
  function _getAttemptRecord(email) {
    try {
      const raw = localStorage.getItem(`tabuko_auth_attempts_${btoa(email)}`);
      return raw ? JSON.parse(raw) : { count: 0, lastAttempt: 0, lockedUntil: 0 };
    } catch { return { count: 0, lastAttempt: 0, lockedUntil: 0 }; }
  }

  function _saveAttemptRecord(email, record) {
    try { localStorage.setItem(`tabuko_auth_attempts_${btoa(email)}`, JSON.stringify(record)); } catch {}
  }

  function _clearAttemptRecord(email) {
    try { localStorage.removeItem(`tabuko_auth_attempts_${btoa(email)}`); } catch {}
  }

  // ── DAY 242: EXPONENTIAL BACKOFF LOCKOUT ──────
  // Lockout duration = 2^n × 1000ms (n = attempt count beyond threshold)
  function _checkClientLockout(email) {
    const record = _getAttemptRecord(email);
    if (record.lockedUntil && Date.now() < record.lockedUntil) {
      const remainingMs = record.lockedUntil - Date.now();
      const remainSec = Math.ceil(remainingMs / 1000);
      throw new Error(`Too many failed attempts. Try again in ${remainSec}s.`);
    }
    return record;
  }

  function _recordFailedAttempt(email) {
    const record = _getAttemptRecord(email);
    record.count++;
    record.lastAttempt = Date.now();

    // Day 242: Exponential backoff — 2^n × 1000ms
    if (record.count >= MAX_CLIENT_ATTEMPTS) {
      const n = record.count - MAX_CLIENT_ATTEMPTS + 1;
      const backoffMs = Math.pow(2, n) * LOCKOUT_BASE_MS;
      const cappedBackoffMs = Math.min(backoffMs, 30 * 60 * 1000); // Cap at 30 min
      record.lockedUntil = Date.now() + cappedBackoffMs;
      console.warn(`[Auth] Client lockout applied: ${cappedBackoffMs}ms (attempt ${record.count})`);
    }
    _saveAttemptRecord(email, record);

    // Day 243: Server-side attempt counter
    _incrementServerAttemptCounter(email, record.count).catch(() => {});
  }

  // ── DAY 243: SERVER-SIDE SECURITY_META TRACKER ─
  async function _incrementServerAttemptCounter(email, clientCount) {
    try {
      if (typeof db === 'undefined') return;
      // Try to find the user document by email to write to security_meta subcollection
      const usersQuery = await db.collection('users').where('email', '==', email).limit(1).get();
      if (usersQuery.empty) return;

      const userId    = usersQuery.docs[0].id;
      const metaRef   = db.collection('users').doc(userId).collection('security_meta').doc('login_attempts');

      await db.runTransaction(async (tx) => {
        const doc = await tx.get(metaRef);
        const data = doc.exists ? doc.data() : { count: 0, firstAttempt: null, status: 'active' };

        const newCount = (data.count || 0) + 1;
        const update = {
          count: newCount,
          lastAttempt: firebase.firestore.FieldValue.serverTimestamp(),
          firstAttempt: data.firstAttempt || firebase.firestore.FieldValue.serverTimestamp(),
          email,
          clientCount
        };

        // Day 244: Server-side lockout at 10 attempts
        if (newCount >= MAX_SERVER_ATTEMPTS) {
          update.status = 'locked';
          update.lockedAt = firebase.firestore.FieldValue.serverTimestamp();
          console.warn('[Auth] Server-side lockout triggered for:', email);
        }

        tx.set(metaRef, update, { merge: true });
      });
    } catch (e) {
      if (e.code !== 'permission-denied' && !e.message.toLowerCase().includes('permission')) {
        console.warn('[Auth] Could not write server attempt counter:', e.message);
      }
    }
  }

  // ── DAY 244: CHECK SERVER LOCKOUT STATUS ──────
  async function _checkServerLockoutStatus(email) {
    try {
      if (typeof db === 'undefined') return; // Cannot check — allow offline
      const usersQuery = await db.collection('users').where('email', '==', email).limit(1).get();
      if (usersQuery.empty) return;

      const userId  = usersQuery.docs[0].id;
      const metaDoc = await db.collection('users').doc(userId).collection('security_meta').doc('login_attempts').get();
      if (!metaDoc.exists) return;

      const data = metaDoc.data();
      if (data.status === 'locked') {
        throw new Error('This account has been locked due to repeated failed login attempts. Contact your administrator.');
      }
    } catch (e) {
      if (e.message.includes('locked')) throw e; // Re-throw lockout errors
      if (e.code !== 'permission-denied' && !e.message.toLowerCase().includes('permission')) {
        console.warn('[Auth] Server lockout check failed silently:', e.message);
      }
    }
  }

  function init() {
    auth.onAuthStateChanged(async (user) => {
      currentUser = user;
      if (user) {
        if (user.isAnonymous) {
          currentUserData = { uid: user.uid, role: 'guest' };
        } else {
          try {
            const doc = await db.collection('users').doc(user.uid).get();
            currentUserData = doc.exists ? doc.data() : { uid: user.uid, email: user.email, role: 'admin' };

            if (currentUserData.hasCompletedSetup && user.providerData.some(p => p.providerId === 'google.com')) {
              console.warn('[Security] Unauthorized Google Session detected. Forcing Purge.');
              await logout();
              return;
            }

            if (currentUserData.role === 'admin' || currentUserData.role === 'arbiter') {
              startSessionWatchdog(user.uid);
            }
          } catch (e) {
            console.warn('[Auth] Initialization sync failed:', e.message);
            currentUserData = { uid: user.uid, email: user.email, role: 'admin' };
          }
        }
      } else {
        currentUserData = null;
        if (sessionWatchdog) { sessionWatchdog(); sessionWatchdog = null; }
      }
      listeners.forEach(fn => fn(currentUser, currentUserData));
    });
  }

  function onAuthChange(fn) { listeners.push(fn); }

  // ── HARDENED LOGIN WITH RATE LIMITER ─────────
  async function signInWithEmailAndPassword(email, password) {
    const resolvedEmail = resolveEmail(email);

    // Day 241-242: Check client-side lockout first
    try { _checkClientLockout(resolvedEmail); } catch (lockErr) {
      if (window.UI?.showToast) UI.showToast(lockErr.message, 'error');
      throw lockErr;
    }

    // Day 244: Check server-side lockout status
    try { await _checkServerLockoutStatus(resolvedEmail); } catch (srvLockErr) {
      if (window.UI?.showToast) UI.showToast(srvLockErr.message, 'error');
      throw srvLockErr;
    }

    try {
      if (window.UI?.showLoading) UI.showLoading('Initializing Console...');
      const result = await auth.signInWithEmailAndPassword(resolvedEmail, password);

      // Clear attempt record on successful login
      _clearAttemptRecord(resolvedEmail);

      // Day 245: Single-device session stamp
      await stampSession(result.user.uid);

      if (window.UI?.showToast) UI.showToast('Secure Session Established', 'success');
      return result.user;
    } catch (err) {
      // Record the failed attempt (but not if it was already a lockout error)
      if (!err.message.includes('Too many failed') && !err.message.includes('locked')) {
        _recordFailedAttempt(resolvedEmail);
        const record = _getAttemptRecord(resolvedEmail);
        const remaining = Math.max(0, MAX_CLIENT_ATTEMPTS - record.count);
        const msg = remaining > 0
          ? `${err.message} (${remaining} attempt${remaining !== 1 ? 's' : ''} remaining)`
          : err.message;
        if (window.UI?.showToast) UI.showToast(msg, 'error');
      } else {
        if (window.UI?.showToast) UI.showToast(err.message, 'error');
      }
      throw err;
    } finally {
      if (window.UI?.hideLoading) UI.hideLoading();
    }
  }

  async function verifyWithGoogle() {
    try {
      if (window.UI?.showLoading) UI.showLoading('Contacting Google Identity...');
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await auth.signInWithPopup(provider);
      const user = result.user;
      const userDoc = await db.collection('users').doc(user.uid).get();
      if (userDoc.exists && userDoc.data().hasCompletedSetup) {
        await auth.signOut();
        throw new Error('This identity is already bound to a club. Please use Password Login.');
      }
      await user.delete();
      return { email: user.email, displayName: user.displayName };
    } catch (err) {
      console.error('[Auth] Verification Failure:', err);
      if (window.UI?.showToast) UI.showToast(err.message, 'error');
      throw err;
    } finally {
      if (window.UI?.hideLoading) UI.hideLoading();
    }
  }

  async function loginAsGuest() {
    try {
      if (window.UI?.showLoading) UI.showLoading('Entering Spectator Mode...');
      await auth.signInAnonymously();
      sessionStorage.setItem('isGuestUser', 'true');
      App.navigateTo('dashboard');
    } catch (err) {
      if (window.UI?.showToast) UI.showToast(err.message, 'error');
      throw err;
    } finally {
      if (window.UI?.hideLoading) UI.hideLoading();
    }
  }

  async function logout() {
    if (sessionWatchdog) { sessionWatchdog(); sessionWatchdog = null; }
    sessionStorage.removeItem('isLaunchingNewNode');
    sessionStorage.removeItem('isGuestUser');
    localStorage.removeItem('tabuko_session');
    await auth.signOut();
    window.location.hash = '#/login';
    window.location.reload();
  }

  // ── DAY 245: SINGLE-DEVICE SESSION LOCK ───────
  async function stampSession(uid) {
    const deviceSessionId = crypto.randomUUID();
    localStorage.setItem('tabuko_device_token', deviceSessionId);
    await db.collection('users').doc(uid).update({ currentSessionId: deviceSessionId });
  }

  function startSessionWatchdog(uid) {
    if (sessionWatchdog) sessionWatchdog();
    const localSession = localStorage.getItem('tabuko_device_token');
    sessionWatchdog = db.collection('users').doc(uid).onSnapshot(doc => {
      if (!doc.exists) return;
      const data = doc.data();
      if (data.currentSessionId && data.currentSessionId !== localSession) {
        console.warn('[Security] Session Conflict: Booting device.');
        renderSessionConflict();
        logout();
      }
    }, (error) => console.error('Session Watchdog Error:', error));
  }

  function renderSessionConflict() {
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#020617;font-family:'Inter',sans-serif;">
        <div style="max-width:420px;text-align:center;padding:3.5rem;background:#0f172a;border:1px solid rgba(239,68,68,0.3);border-radius:16px;">
          <div style="font-size:3.5rem;margin-bottom:1.5rem;">🔒</div>
          <h2 style="color:#f87171;font-weight:900;margin-bottom:0.5rem;">Session Conflict</h2>
          <p style="color:#94a3b8;margin-bottom:2.5rem;">This account has been accessed from an alternative device. This terminal session has been terminated for security.</p>
          <button onclick="window.location.reload()" style="width:100%;padding:1rem;background:linear-gradient(135deg,#3b82f6,#6366f1);border:none;border-radius:12px;color:#fff;font-weight:800;cursor:pointer;">Re-Authorize This Device</button>
        </div>
      </div>`;
  }

  function getUser() { return currentUser; }
  function getUserData() { return currentUserData; }
  function isAdmin() { return !!currentUser && !currentUser.isAnonymous && currentUserData?.role === 'admin'; }
  function isArbiter() { return !!currentUser && !currentUser.isAnonymous && (currentUserData?.role === 'admin' || currentUserData?.role === 'arbiter'); }
  function isGuest() { return sessionStorage.getItem('isGuestUser') === 'true'; }

  return {
    init, onAuthChange,
    signInWithEmailAndPassword, verifyWithGoogle, loginAsGuest,
    logout, signOut: logout,
    getUser, getUserData, isAdmin, isArbiter, isGuest,
    displayEmail, resolveEmail
  };
})();

window.Auth = Auth;
