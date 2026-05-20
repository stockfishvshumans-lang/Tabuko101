/**
 * DiagnosticsLogger.js — Day 220: Active Listener Diagnostics & Promise Rejection Recorder
 * Provides UI.renderActiveListenerDiagnostics() to log unhandled rejections to database logs
 * and render a live diagnostic panel for the admin dashboard.
 *
 * @version 1.0.0 — Day 220 Sprint
 */
const DiagnosticsLogger = (() => {
  'use strict';

  const MAX_LOCAL_LOG_ENTRIES = 100;
  const LOCAL_LOG_KEY = 'tabuko_diagnostics_log';
  let _rejectionCount = 0;
  let _isListening    = false;

  // ── INTERNAL: Read/write local ring-buffer log ──
  function _readLog() {
    try { return JSON.parse(localStorage.getItem(LOCAL_LOG_KEY) || '[]'); } catch { return []; }
  }
  function _writeLog(entries) {
    try { localStorage.setItem(LOCAL_LOG_KEY, JSON.stringify(entries.slice(-MAX_LOCAL_LOG_ENTRIES))); } catch {}
  }

  // ── DAY 220: UNHANDLED REJECTION INTERCEPTOR ────
  function startRejectionCapture() {
    if (_isListening) return;
    _isListening = true;

    window.addEventListener('unhandledrejection', async (event) => {
      _rejectionCount++;
      const reason  = event.reason;
      const message = reason?.message || String(reason);
      const stack   = reason?.stack   || 'No stack trace';
      const entry   = {
        id:        `diag_${Date.now()}_${_rejectionCount}`,
        type:      'unhandled_promise_rejection',
        message,
        stack,
        timestamp: new Date().toISOString(),
        url:       window.location.href
      };

      // 1. Ring-buffer in localStorage (immediate, offline-safe)
      const log = _readLog();
      log.push(entry);
      _writeLog(log);

      // 2. Persist to Firestore system_logs (async, non-blocking)
      try {
        if (typeof db !== 'undefined') {
          await db.collection('system_logs').add({
            ...entry,
            serverTimestamp: firebase?.firestore?.FieldValue?.serverTimestamp?.() || null,
            clubId: window.TenantManager?.getActiveClubId?.() || null,
            userEmail: window.Auth?.getUser?.()?.email || 'unauthenticated'
          });
        }
      } catch (e) {
        // Must NOT throw here — we're in an error handler
        console.warn('[DiagnosticsLogger] Failed to persist rejection to Firestore:', e.message);
      }

      // 3. Update live panel if mounted
      _refreshPanel();
    });

    console.log('[DiagnosticsLogger] Day 220: Rejection capture active.');
  }

  // ── DAY 220: RENDER DIAGNOSTIC PANEL ────────────
  /**
   * UI.renderActiveListenerDiagnostics — callable from admin panel.
   * Renders a live panel showing active listeners, rejection count, and log entries.
   */
  function renderActiveListenerDiagnostics(containerId = 'diagnostics-root') {
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      (document.querySelector('.content-viewport') || document.body).appendChild(container);
    }

    const log = _readLog();
    const activeListeners = (window.activeListeners || []).length;

    container.innerHTML = `
      <div style="background:#0f172a;border:1px solid rgba(59,130,246,0.15);border-radius:12px;padding:1rem;font-family:'JetBrains Mono',monospace;color:#e2e8f0;margin:1rem 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <span style="font-size:0.65rem;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#3b82f6;">⚡ Day 220 — Runtime Diagnostics</span>
          <div style="display:flex;gap:6px;">
            <button onclick="DiagnosticsLogger.clearLog()" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#ef4444;padding:3px 10px;border-radius:4px;font-size:0.55rem;font-weight:900;cursor:pointer;">CLEAR LOG</button>
            <button onclick="DiagnosticsLogger.renderActiveListenerDiagnostics('${containerId}')" style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);color:#3b82f6;padding:3px 10px;border-radius:4px;font-size:0.55rem;font-weight:900;cursor:pointer;">↻ REFRESH</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:0.75rem;">
          <div style="background:rgba(0,0,0,0.3);border-radius:6px;padding:6px;text-align:center;">
            <div style="font-size:1rem;font-weight:900;color:${_rejectionCount > 0 ? '#ef4444' : '#10b981'};">${_rejectionCount}</div>
            <div style="font-size:0.45rem;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Rejections</div>
          </div>
          <div style="background:rgba(0,0,0,0.3);border-radius:6px;padding:6px;text-align:center;">
            <div style="font-size:1rem;font-weight:900;color:#f59e0b;">${activeListeners}</div>
            <div style="font-size:0.45rem;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Active Listeners</div>
          </div>
          <div style="background:rgba(0,0,0,0.3);border-radius:6px;padding:6px;text-align:center;">
            <div style="font-size:1rem;font-weight:900;color:#a855f7;">${log.length}</div>
            <div style="font-size:0.45rem;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Log Entries</div>
          </div>
        </div>

        <div id="diag-log-list" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
          ${log.length === 0
            ? '<div style="color:#475569;font-size:0.6rem;text-align:center;padding:1rem;">✅ No rejections logged</div>'
            : [...log].reverse().slice(0, 20).map(entry => `
              <div style="background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.1);border-radius:4px;padding:5px 8px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
                  <span style="font-size:0.5rem;color:#ef4444;font-weight:900;">REJECTION</span>
                  <span style="font-size:0.45rem;color:#475569;">${new Date(entry.timestamp).toLocaleTimeString()}</span>
                </div>
                <div style="font-size:0.55rem;color:#94a3b8;word-break:break-all;">${entry.message?.slice(0, 120) || 'Unknown error'}${entry.message?.length > 120 ? '…' : ''}</div>
              </div>
            `).join('')
          }
        </div>
      </div>
    `;

    // Attach to window.UI for the documented API surface
    if (window.UI && !window.UI.renderActiveListenerDiagnostics) {
      window.UI.renderActiveListenerDiagnostics = renderActiveListenerDiagnostics;
    }
  }

  function _refreshPanel() {
    const panel = document.getElementById('diagnostics-root');
    if (panel) renderActiveListenerDiagnostics('diagnostics-root');
  }

  function clearLog() {
    _writeLog([]);
    _rejectionCount = 0;
    _refreshPanel();
    if (window.UI?.showToast) UI.showToast('Diagnostics log cleared', 'success');
  }

  function getLog() { return _readLog(); }

  // Auto-start rejection capture on load
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startRejectionCapture);
    } else {
      startRejectionCapture();
    }

    // Expose UI.renderActiveListenerDiagnostics as soon as UI is available
    const _uiAttachTimer = setInterval(() => {
      if (window.UI) {
        window.UI.renderActiveListenerDiagnostics = renderActiveListenerDiagnostics;
        clearInterval(_uiAttachTimer);
      }
    }, 200);
    setTimeout(() => clearInterval(_uiAttachTimer), 10000);
  }

  return { renderActiveListenerDiagnostics, startRejectionCapture, clearLog, getLog };
})();

window.DiagnosticsLogger = DiagnosticsLogger;
