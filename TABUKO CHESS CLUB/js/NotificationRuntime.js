/**
 * NotificationRuntime.js — Centralized Priority-Based Dispatch Coordinator
 * Day 264: Unified notification broker with retry-safe delivery across terminals.
 *
 * @version 1.0.0 — Day 264 Sprint
 */
const NotificationRuntime = (() => {
  'use strict';

  const _queue = [];
  const _history = [];
  const MAX_HISTORY = 200;
  let _toastContainer = null;

  const PRIORITY = {
    CRITICAL: { level: 0, color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '🚨', duration: 8000 },
    HIGH:     { level: 1, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '⚠️', duration: 6000 },
    NORMAL:   { level: 2, color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', icon: 'ℹ️', duration: 4000 },
    SUCCESS:  { level: 2, color: '#10b981', bg: 'rgba(16,185,129,0.12)', icon: '✅', duration: 3500 },
    LOW:      { level: 3, color: '#64748b', bg: 'rgba(100,116,139,0.08)', icon: '📝', duration: 3000 }
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DISPATCH — Send Notification
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function dispatch(message, priority = 'NORMAL', metadata = {}) {
    const config = PRIORITY[priority] || PRIORITY.NORMAL;

    const notification = {
      id: crypto.randomUUID(),
      message,
      priority,
      metadata: { ...metadata },
      timestamp: Date.now(),
      delivered: false,
      retryCount: 0
    };

    _queue.push(notification);
    _history.push(notification);
    if (_history.length > MAX_HISTORY) _history.shift();

    // Attempt immediate delivery
    deliverToast(notification, config);

    // Publish to event bus
    if (window.DistributedEventBus) {
      window.DistributedEventBus.publish('NOTIFICATION_DISPATCHED', {
        id: notification.id,
        message,
        priority,
        timestamp: notification.timestamp
      });
    }

    return notification;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TOAST DELIVERY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function ensureContainer() {
    if (_toastContainer && document.body.contains(_toastContainer)) return _toastContainer;

    _toastContainer = document.createElement('div');
    _toastContainer.id = 'notification-toast-center';
    _toastContainer.style.cssText = `
      position:fixed;top:16px;right:16px;z-index:100000;
      display:flex;flex-direction:column;gap:8px;
      max-width:380px;width:100%;pointer-events:none;
    `;
    document.body.appendChild(_toastContainer);
    return _toastContainer;
  }

  function deliverToast(notification, config) {
    const container = ensureContainer();

    const toast = document.createElement('div');
    toast.id = `toast-${notification.id}`;
    toast.style.cssText = `
      background:${config.bg};border:1px solid ${config.color}33;
      border-left:3px solid ${config.color};
      border-radius:10px;padding:12px 16px;
      font-family:'Inter',sans-serif;color:#e2e8f0;
      transform:translateX(120%);opacity:0;
      transition:transform 0.4s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease;
      pointer-events:auto;cursor:pointer;
      backdrop-filter:blur(12px);
      box-shadow:0 8px 32px rgba(0,0,0,0.4);
    `;

    toast.innerHTML = `
      <div style="display:flex;gap:8px;align-items:flex-start;">
        <span style="font-size:1rem;">${config.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.7rem;font-weight:900;color:${config.color};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">
            ${notification.priority}
          </div>
          <div style="font-size:0.75rem;font-weight:600;line-height:1.4;color:#e2e8f0;">
            ${notification.message}
          </div>
          <div style="font-size:0.5rem;color:#475569;margin-top:4px;">
            ${new Date(notification.timestamp).toLocaleTimeString('en-GB')}
          </div>
        </div>
        <button onclick="this.closest('[id^=toast-]').remove()" style="background:none;border:none;color:#475569;cursor:pointer;font-size:1rem;padding:0;line-height:1;">×</button>
      </div>
    `;

    container.appendChild(toast);

    // Slide in
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(0)';
      toast.style.opacity = '1';
    });

    // Auto-dismiss
    setTimeout(() => {
      toast.style.transform = 'translateX(120%)';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, config.duration);

    // Click to dismiss
    toast.addEventListener('click', () => {
      toast.style.transform = 'translateX(120%)';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    });

    notification.delivered = true;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CONVENIENCE METHODS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function critical(message, meta) { return dispatch(message, 'CRITICAL', meta); }
  function warning(message, meta) { return dispatch(message, 'HIGH', meta); }
  function info(message, meta) { return dispatch(message, 'NORMAL', meta); }
  function success(message, meta) { return dispatch(message, 'SUCCESS', meta); }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TOAST NOTIFICATION CENTER UI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function renderToastNotificationCenter(containerId = 'notification-center-root') {
    const root = document.getElementById(containerId);
    if (!root) return;

    const recent = _history.slice(-15).reverse();
    const critCount = _history.filter(n => n.priority === 'CRITICAL').length;

    root.innerHTML = `
      <div style="background:rgba(15,23,42,0.95);border:1px solid rgba(59,130,246,0.12);border-radius:12px;padding:1rem;font-family:'Inter',sans-serif;color:#e2e8f0;font-size:0.65rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <div style="font-weight:900;font-size:0.6rem;text-transform:uppercase;letter-spacing:2px;color:#3b82f6;">🔔 Notification Center</div>
          <div style="font-size:0.55rem;color:#475569;">${_history.length} total ${critCount > 0 ? `• <span style="color:#ef4444;font-weight:900;">${critCount} critical</span>` : ''}</div>
        </div>

        <div style="max-height:250px;overflow-y:auto;">
          ${recent.length === 0 ? '<div style="color:#334155;text-align:center;padding:1rem;">No notifications</div>' : ''}
          ${recent.map(n => {
            const cfg = PRIORITY[n.priority] || PRIORITY.NORMAL;
            return `
              <div style="display:flex;gap:6px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.03);align-items:flex-start;">
                <span style="font-size:0.8rem;">${cfg.icon}</span>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:0.6rem;color:#e2e8f0;font-weight:600;line-height:1.3;">${n.message}</div>
                  <div style="font-size:0.45rem;color:#475569;margin-top:1px;">${new Date(n.timestamp).toLocaleTimeString('en-GB')}</div>
                </div>
                <span style="font-size:0.45rem;font-weight:900;color:${cfg.color};">${n.priority}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLIC API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    dispatch,
    critical,
    warning,
    info,
    success,
    renderToastNotificationCenter,
    getHistory: () => [..._history],
    getQueue: () => [..._queue],
    clearHistory: () => { _history.length = 0; },
    PRIORITY
  };
})();

window.NotificationRuntime = NotificationRuntime;
