/**
 * app.js — Main Application Entry Point
 * Handles routing, initialization, and page navigation.
 */
const App = (() => {
  let currentPage = 'dashboard';
  let currentTournamentId = null;

  function init() {
    Auth.onAuthChange(async (user, userData) => {
      const hash = window.location.hash;
      const isLive = hash.startsWith('#/live');
      const isRegister = hash.startsWith('#/register');
      const isWizard = hash.startsWith('#/register-wizard');
      const isArbiterGate = hash.startsWith('#/arbiter-gate');

      if (user && userData) {
        const isMaster = user.email && user.email.toLowerCase() === 'giradojesster28@gmail.com';
        
        // Wait for TenantManager anchor to settle
        let attempts = 0;
        while (!TenantManager.getActiveClubId() && !isMaster && userData.clubId && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 50));
          attempts++;
        }

        // RULE 0: THE "EXISTING SESSION" PRIORITY
        if (userData.hasCompletedSetup === true) {
           sessionStorage.removeItem('isLaunchingNewNode'); // Purge stale flags
           return navigateTo('dashboard');
        }

        // STRICT ROUTING: Master Admin is locked to Super Admin view unless shadowing
        if (isMaster) {
          if (!TenantManager.isShadowMode() && (!hash || hash === '#/' || hash === '#/login' || hash === '#/dashboard')) {
            navigateTo('super-admin');
          } else {
            handleInitialRoute();
          }
        } else if (!hash || hash === '#/' || hash === '#/login') {
          // 🛡️ ACCESSIBILITY UPGRADE: Allow users to enter the dashboard even if setup is incomplete.
          // They can finish the wizard later via a dashboard prompt.
          navigateTo('dashboard');
        } else {
          handleInitialRoute();
        }
      } else if (isLive || isArbiterGate) {
        handleInitialRoute();
      } else if (isRegister || isWizard) {
        // SURGICAL STRIKE: Only allow wizard if explicitly in the Launch flow
        if (sessionStorage.getItem('isLaunchingNewNode')) {
          handleInitialRoute();
        } else {
          window.location.hash = '#/login';
          UI.renderLogin();
        }
      } else {
        UI.renderLogin();
      }
    });

    function handleInitialRoute() {
      const hash = window.location.hash;
      if (!hash) return;
      const parts = hash.split('?');
      const page = parts[0].replace('#/', '');
      const params = new URLSearchParams(parts[1] || '');
      const id = params.get('id');
      navigateTo(page, id);
    }

    window.addEventListener('scroll', () => {
      const bar = document.getElementById('scroll-progress-bar');
      const btn = document.getElementById('btn-back-to-top');
      if (!bar && !btn) return;
      const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
      const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      const scrolled = (winScroll / height) * 100;
      if (bar) bar.style.width = scrolled + "%";
      if (btn) btn.style.display = winScroll > 300 ? 'flex' : 'none';
    });

    // Day 205: Auth MUST initialize before DriveService.
    // TenantManager must anchor before any peripheral cloud sync starts.
    Auth.init();

    // DriveService init deferred until AFTER tenant anchor resolves
    if (window.DriveService) {
      // Wait for auth state then verify TenantManager is anchored
      const _driveInitTimer = setInterval(() => {
        const tenantReady = window.TenantManager?.getActiveClubId?.() ||
                            window.TenantManager?.isMasterAdmin?.();
        if (tenantReady || Auth.getUser()) {
          clearInterval(_driveInitTimer);
          setTimeout(() => window.DriveService.init().catch(() => {}), 500);
        }
      }, 200);
      // Hard timeout after 8s to avoid infinite loop on unauthenticated pages
      setTimeout(() => clearInterval(_driveInitTimer), 8000);
    }
  }

  async function navigateTo(page, param = null) {
    if (window._currentLoginCleanup) {
        window._currentLoginCleanup();
        window._currentLoginCleanup = null;
    }
    currentPage = page;

    // ── SHADOW MODE BANNER ──
    if (TenantManager.isShadowMode && TenantManager.isShadowMode() && page !== 'super-admin') {
      setTimeout(() => {
        let banner = document.getElementById('shadow-mode-banner');
        if (!banner) {
          banner = document.createElement('div');
          banner.id = 'shadow-mode-banner';
          banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:0.6rem;background:rgba(255,159,10,0.95);color:#000;font-weight:800;font-size:0.8rem;text-align:center;font-family:Inter,sans-serif;';
          banner.innerHTML = '👁️ SHADOW MODE — Read-Only View &nbsp; <button onclick="SuperAdminController.exitShadowLogin()" style="background:#000;color:#fff;border:none;padding:0.3rem 0.8rem;border-radius:4px;cursor:pointer;font-weight:700;">Exit Shadow</button>';
          document.body.appendChild(banner);
        }
      }, 200);
    } else {
      const sb = document.getElementById('shadow-mode-banner');
      if (sb) sb.remove();
    }

    // ── GUEST RESTRICTION ──
    const guestRestricted = ['settings', 'audit', 'admin', 'players', 'super-admin'];
    if (Auth.isGuest && Auth.isGuest() && guestRestricted.includes(page)) {
      UI.showToast('Access Denied: Guest Mode', 'error');
      return navigateTo('dashboard');
    }

    // ── SUPER-ADMIN 403 GUARD ──
    if (page === 'super-admin' && !TenantManager.isMasterAdmin()) {
      console.error('[App] 403 Forbidden: Unauthorized super-admin access');
      UI.showToast('403 Forbidden: Unauthorized Access', 'error');
      return navigateTo('dashboard');
    }

    try {
      switch (page) {
        case 'super-admin': {
          SuperAdminView.render();
          break;
        }
        case 'dashboard': {
          UI.showLoading();
          const tournaments = await DB.getAllTournaments();
          UI.hideLoading();
          UI.renderDashboard(tournaments);
          break;
        }
        case 'tournament': {
          currentTournamentId = param;
          UI.showLoading();
          const tournament = await DB.getTournament(param);
          UI.hideLoading();
          if (!tournament) {
            UI.showToast('Tournament not found', 'error');
            navigateTo('dashboard');
            return;
          }
          UI.renderTournamentView(tournament);
          break;
        }
        case 'players': {
          await UI.renderPlayersPage();
          break;
        }
        case 'roster': {
          await UI.renderRosterPage();
          break;
        }
        case 'settings': {
          await UI.renderSettingsPage();
          break;
        }
        case 'audit': {
          await UI.renderAuditLogPage();
          break;
        }
        case 'archive': {
          UI.showLoading();
          await UI.renderArchiveRoom();
          UI.hideLoading();
          break;
        }
        case 'admin': {
          navigateTo('dashboard');
          break;
        }
        case 'live': {
          UI.renderLiveView(param);
          break;
        }
        case 'arbiter': {
          if (typeof ArbiterView !== 'undefined' && param) {
            ArbiterView.render(param);
          } else {
            UI.showToast('Invalid arbiter link', 'error');
            navigateTo('dashboard');
          }
          break;
        }
        case 'arbiter-gate': {
          if (typeof ArbiterGate !== 'undefined' && param) {
            ArbiterGate.render(param);
          } else {
            UI.showToast('Invalid handshake link', 'error');
            navigateTo('dashboard');
          }
          break;
        }
        case 'register': {
          RegisterWizard.render();
          break;
        }
        case 'register-wizard': {
          RegisterWizard.render();
          break;
        }
        default:
          navigateTo('dashboard');
      }
    } catch (err) {
      UI.hideLoading();
      UI.showToast(err.message, 'error');
      console.error('[App]', err);
    }
  }

  return { init, navigateTo, getCurrentPage: () => currentPage };
})();

window.App = App;

window.addEventListener('unhandledrejection', async (event) => {
  console.error('[Unhandled Rejection Detected]', event.reason);
  
  // Route rejected promise stack traces into local storage dispute logs
  try {
    const disputeLogs = secureGetLocalStorageItem('dispute_logs') || [];
    disputeLogs.push({
      type: 'unhandled_promise_rejection',
      reason: event.reason?.message || String(event.reason),
      stack: event.reason?.stack || 'No stack trace',
      timestamp: new Date().toISOString()
    });
    localStorage.setItem('dispute_logs', JSON.stringify(disputeLogs));
  } catch (err) {
    console.error('Failed to log dispute:', err);
  }
  
  // Automatically retry any database connection attempts that were dropped during transit anomalies
  if (event.reason && (event.reason.message?.includes('network') || event.reason.message?.includes('unavailable') || event.reason.message?.includes('offline') || event.reason.message?.includes('FIRESTORE'))) {
    console.log('[Connection Recovery] Dropped transaction/connection detected. Retrying handshake...');
    if (typeof DB !== 'undefined' && DB.checkDatabaseIntegrity) {
      setTimeout(() => DB.checkDatabaseIntegrity(), 2000);
    }
  }
});

document.addEventListener('DOMContentLoaded', () => {
  App.init();

  // ── TOGGLE SIDEBAR CONTROLLER ──
  document.body.addEventListener('click', (e) => {
    const trigger = e.target.closest('#sidebar-toggle-trigger');
    if (trigger) {
      const layoutGrid = document.querySelector('.app-layout-grid');
      if (layoutGrid) {
        layoutGrid.classList.toggle('expanded');
        
        // Save state to local browser cache so layout stays consistent across views
        const isExpanded = layoutGrid.classList.contains('expanded');
        localStorage.setItem('tabuko_sidebar_expanded', isExpanded);
      }
    }
  });

  // ── HYDRATE SIDEBAR EXPANDED STATE ──
  const wasExpanded = localStorage.getItem('tabuko_sidebar_expanded') === 'true';
  if (wasExpanded) {
    const layoutGrid = document.querySelector('.app-layout-grid');
    if (layoutGrid) {
      layoutGrid.classList.add('expanded');
    }
  }
});