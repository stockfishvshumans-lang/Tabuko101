/**
 * ArbiterGate.js — Secure Handshake for Floor Access
 * Day 250: 3-attempt passcode lockout with session-scoped lock.
 * Days 201–300: Input sanitization, character validation, attempt tracking.
 */
const ArbiterGate = (() => {

  // ── DAY 250: PASSCODE ATTEMPT TRACKER ────────
  let _attemptCount = 0;
  let _isLockedOut  = false;
  const MAX_ATTEMPTS = 3;

  function _resetAttempts() { _attemptCount = 0; _isLockedOut = false; }

  function _applyLockout(tournamentId) {
    _isLockedOut = true;
    // Visual lockout state
    const btn = document.getElementById('btn-gate-handshake');
    const inp = document.getElementById('gate-passcode');
    if (btn) { btn.disabled = true; btn.textContent = '🔒 Terminal Locked (3 Fails)'; btn.style.background = 'rgba(239,68,68,0.15)'; btn.style.borderColor = 'rgba(239,68,68,0.3)'; btn.style.color = '#ef4444'; }
    if (inp) { inp.disabled = true; inp.style.borderColor = 'rgba(239,68,68,0.4)'; }

    // Session-scoped lockout key — cannot be bypassed without reload
    const lockKey = `arb_locked_${tournamentId}`;
    sessionStorage.setItem(lockKey, Date.now().toString());

    if (window.UI?.showToast) UI.showToast('Terminal locked. Contact your Chief Arbiter to reset.', 'error');

    // Log lockout to Firestore
    try {
      if (typeof db !== 'undefined') {
        db.collection('system_logs').add({
          type: 'ARBITER_GATE_LOCKOUT',
          tournamentId,
          timestamp: typeof firebase !== 'undefined' ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString(),
          reason: `${MAX_ATTEMPTS} consecutive failed passcode attempts`
        }).catch(() => {});
      }
    } catch {}
  }

  // Day 210: Input sanitization — strip non-digit characters
  function _sanitizePasscode(raw) {
    return String(raw).replace(/\D/g, '').slice(0, 4);
  }
  function _sanitizeName(raw) {
    return String(raw).replace(/[<>"'`{}()\[\]\\]/g, '').trim().slice(0, 80);
  }

  function render(tournamentId) {
    // Day 250: Check session lockout on render
    const lockKey = `arb_locked_${tournamentId}`;
    const isSessionLocked = sessionStorage.getItem(lockKey);

    _resetAttempts(); // Reset in-memory counter on each fresh render

    const root = document.getElementById('app');
    root.innerHTML = `
      <div class="auth-gateway titanium-cobalt fade-in">
        <div class="auth-card glass-panel" style="max-width:400px;padding:3rem;text-align:center;">
          <div class="auth-header">
            <div class="auth-icon-wrap" style="background:rgba(59,130,246,0.1);">
              <span style="font-size:2rem;color:var(--accent-sapphire);">🛡️</span>
            </div>
            <h2 class="auth-title">Floor Handshake</h2>
            <p class="auth-subtext">Enter your credentials to access the console.</p>
          </div>

          ${isSessionLocked ? `
          <div id="gate-lockout-banner" style="margin:1.5rem 0;padding:1rem;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:10px;">
            <div style="font-size:1.5rem;margin-bottom:0.5rem;">🔒</div>
            <div style="font-size:0.8rem;font-weight:800;color:#ef4444;">TERMINAL LOCKED</div>
            <div style="font-size:0.65rem;color:#94a3b8;margin-top:4px;">Contact your Chief Arbiter to reset this terminal.</div>
          </div>` : ''}

          <div class="auth-form" style="margin-top:${isSessionLocked ? '0' : '2rem'};">
            <div class="form-group" style="text-align:left;">
              <label>Arbiter Name</label>
              <input type="text" id="gate-name" class="auth-input"
                placeholder="e.g. IA Jesster Girado" maxlength="80"
                ${isSessionLocked ? 'disabled' : ''} required>
            </div>

            <div class="form-group" style="text-align:left;margin-top:1.5rem;">
              <label>Tournament Passcode (4-Digits)</label>
              <input type="password" id="gate-passcode" class="auth-input"
                maxlength="4" placeholder="••••"
                style="text-align:center;letter-spacing:1rem;font-size:1.5rem;"
                oninput="this.value=this.value.replace(/\\D/g,'')"
                ${isSessionLocked ? 'disabled' : ''} required>
              <div id="gate-attempt-indicator" style="margin-top:6px;font-size:0.65rem;color:#94a3b8;text-align:center;min-height:18px;"></div>
            </div>

            <button id="btn-gate-handshake"
              class="btn btn-auth-primary"
              style="width:100%;margin-top:2rem;background:var(--accent-sapphire);min-height:46px;"
              ${isSessionLocked ? 'disabled' : ''}>
              ${isSessionLocked ? '🔒 Terminal Locked' : 'Authorize Access →'}
            </button>

            <p style="font-size:0.7rem;color:var(--text-muted);margin-top:1.5rem;">
              Identity will be bound to all submitted results for this session.
            </p>
          </div>
        </div>
      </div>
    `;

    if (!isSessionLocked) {
      document.getElementById('btn-gate-handshake').onclick = () => handleHandshake(tournamentId);
      document.getElementById('gate-passcode').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleHandshake(tournamentId);
      });
    }
  }

  async function handleHandshake(tournamentId) {
    // Day 250: Hard block if locked
    if (_isLockedOut) return;

    // Day 210: Sanitize all inputs before processing
    const rawName     = document.getElementById('gate-name')?.value || '';
    const rawPasscode = document.getElementById('gate-passcode')?.value || '';

    const name     = _sanitizeName(rawName);
    const passcode = _sanitizePasscode(rawPasscode);

    if (!name || name.length < 2) {
      if (window.UI?.showToast) UI.showToast('Please enter a valid arbiter name', 'warning');
      return;
    }
    if (passcode.length !== 4) {
      if (window.UI?.showToast) UI.showToast('Please enter the 4-digit passcode', 'warning');
      return;
    }

    try {
      if (window.UI?.showLoading) UI.showLoading('Verifying Authority...');

      const tournamentRef = db.collection('tournaments').doc(tournamentId);
      const isPasscodeValid = await db.runTransaction(async (transaction) => {
        const tDoc = await transaction.get(tournamentRef);
        if (!tDoc.exists) return false;
        const stored = _sanitizePasscode(tDoc.data().staff_passcode || '0000');
        return stored === passcode;
      });

      if (!isPasscodeValid) {
        // Day 250: Increment attempt counter
        _attemptCount++;
        const remaining = MAX_ATTEMPTS - _attemptCount;
        const indicator = document.getElementById('gate-attempt-indicator');

        if (_attemptCount >= MAX_ATTEMPTS) {
          _applyLockout(tournamentId);
          throw new Error(`Terminal locked after ${MAX_ATTEMPTS} failed attempts.`);
        }

        if (indicator) {
          indicator.textContent = `⚠ Incorrect passcode — ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining`;
          indicator.style.color = remaining <= 1 ? '#ef4444' : '#f59e0b';
        }

        // Flash the passcode input red
        const inp = document.getElementById('gate-passcode');
        if (inp) {
          inp.style.borderColor = 'rgba(239,68,68,0.6)';
          inp.value = '';
          inp.focus();
          setTimeout(() => { inp.style.borderColor = ''; }, 1500);
        }

        throw new Error(`Invalid Passcode (${remaining} attempt${remaining !== 1 ? 's' : ''} remaining)`);
      }

      // Successful auth — reset counter
      _attemptCount = 0;

      if (!auth.currentUser) await auth.signInAnonymously();

      // Session expiry watcher
      db.collection('tournaments').doc(tournamentId).onSnapshot(doc => {
        if (doc.exists) {
          const status = doc.data().status;
          if (status === 'completed' || status === 'archived') {
            sessionStorage.removeItem('tabuko_arbiter_token');
            if (auth.currentUser?.isAnonymous) auth.signOut();
            if (window.UI?.showToast) UI.showToast('Session Expired: Tournament has ended.', 'warning');
            window.location.hash = '#/login';
            window.location.reload();
          }
        }
      });

      const encodedToken = btoa(JSON.stringify({ name, tournamentId, role: 'arbiter' }));
      sessionStorage.setItem('tabuko_arbiter_token', encodedToken);
      if (window.UI?.showToast) UI.showToast(`Welcome, ${name}! Identity bound.`, 'success');
      App.navigateTo('arbiter', tournamentId);

    } catch (err) {
      let msg = err.message;
      if (err.code === 'auth/admin-restricted-operation' || err.message.includes('signUp')) {
        msg = "ADMIN REQUIRED: Enable 'Anonymous Sign-In' in Firebase Console.";
      }
      if (!msg.includes('attempt') && !msg.includes('locked')) {
        if (window.UI?.showToast) UI.showToast(msg, 'error');
      }
    } finally {
      if (window.UI?.hideLoading) UI.hideLoading();
    }
  }

  return { render };
})();

window.ArbiterGate = ArbiterGate;
