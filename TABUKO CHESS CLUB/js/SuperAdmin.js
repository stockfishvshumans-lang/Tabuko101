/**
 * SuperAdmin.js — Global Management for the SaaS Owner
 * Accessible only to the Master UID.
 */
const SuperAdmin = (() => {

  async function renderDashboard() {
    if (!TenantManager.isMasterAdmin()) {
      alert('Access Denied: Master privileges required.');
      return;
    }

    const container = document.getElementById('main-content');
    container.innerHTML = `
      <div class="super-admin-dashboard glass-panel animate-fade-in">
        <header class="dashboard-header">
          <h1><i class="fas fa-crown"></i> System Control</h1>
          <div class="stats-grid">
            <div class="stat-box" id="active-clubs-count">0 Active Clubs</div>
            <div class="stat-box" id="pending-verifications-count">0 Pending Payments</div>
          </div>
        </header>

        <section class="admin-section">
          <h3><i class="fas fa-money-check-alt"></i> Payment Verification Queue</h3>
          <div id="payment-queue" class="data-table">
            <p class="loading">Loading queue...</p>
          </div>
        </section>

        <section class="admin-section">
          <h3><i class="fas fa-pulse"></i> Global Pulse (Active Clubs)</h3>
          <div id="global-pulse" class="club-grid"></div>
        </section>

        <section class="admin-section">
          <h3><i class="fas fa-history"></i> System Audit Log</h3>
          <div id="system-audit-log" class="audit-list"></div>
        </section>
      </div>
    `;

    loadPaymentQueue();
    loadGlobalPulse();
    loadSystemAudit();
  }

  async function loadPaymentQueue() {
    const snap = await db.collection('support_tickets')
      .where('type', '==', 'PAYMENT_VERIFICATION')
      .where('status', '==', 'pending')
      .get();
    
    const queueEl = document.getElementById('payment-queue');
    if (snap.empty) {
      queueEl.innerHTML = '<p class="empty">No pending verifications.</p>';
      return;
    }

    let html = '<table><thead><tr><th>Club</th><th>Ref #</th><th>Date</th><th>Action</th></tr></thead><tbody>';
    snap.docs.forEach(doc => {
      const data = doc.data();
      html += `
        <tr>
          <td>${data.clubId}</td>
          <td>${data.referenceNumber}</td>
          <td>${new Date(data.createdAt?.toDate()).toLocaleDateString()}</td>
          <td>
            <button onclick="SuperAdmin.approvePayment('${doc.id}', '${data.clubId}')" class="btn-success btn-sm">Approve</button>
          </td>
        </tr>
      `;
    });
    html += '</tbody></table>';
    queueEl.innerHTML = html;
  }

  async function approvePayment(ticketId, clubId) {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    const batch = db.batch();
    
    // 1. Update Club Subscription
    const clubRef = db.collection('clubs').doc(clubId);
    batch.update(clubRef, {
      'subscription.status': 'premium',
      'subscription.end_date': nextMonth,
      'subscription.is_premium': true
    });

    // 2. Resolve Ticket
    const ticketRef = db.collection('support_tickets').doc(ticketId);
    batch.update(ticketRef, { status: 'approved', resolvedAt: firebase.firestore.FieldValue.serverTimestamp() });

    await batch.commit();
    UI.showToast('Payment approved successfully!', 'success');
    renderDashboard();
  }

  async function loadGlobalPulse() {
    const snap = await db.collection('clubs').get();
    const pulseEl = document.getElementById('global-pulse');
    
    let html = '';
    snap.docs.forEach(doc => {
      const data = doc.data();
      html += `
        <div class="club-pulse-card">
          <h4>${data.name || doc.id}</h4>
          <p>Admin: ${data.admin_uid.substring(0, 8)}...</p>
          <span class="badge ${data.subscription?.status}">${data.subscription?.status}</span>
        </div>
      `;
    });
    pulseEl.innerHTML = html;
  }

  async function loadSystemAudit() {
    const snap = await db.collectionGroup('audit_logs')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
    
    const auditEl = document.getElementById('system-audit-log');
    let html = '<ul>';
    snap.docs.forEach(doc => {
      const data = doc.data();
      html += `<li>[${new Date(data.timestamp?.toDate()).toLocaleTimeString()}] ${data.action} by ${data.uid}</li>`;
    });
    html += '</ul>';
    auditEl.innerHTML = html;
  }

  function renderReactiveTicketQueue() {
    const queueEl = document.getElementById('payment-queue');
    if (!queueEl) return;
    queueEl.innerHTML = '<p class="loading">Listening for active tickets...</p>';

    if (window._ticketUnsub) window._ticketUnsub();
    window._ticketUnsub = db.collectionGroup('support_tickets')
      .where('status', '==', 'pending')
      .onSnapshot(snap => {
        if (snap.empty) {
          queueEl.innerHTML = '<p class="empty">No pending tickets.</p>';
          return;
        }

        let html = '<table><thead><tr><th>Club</th><th>Type</th><th>Ref #</th><th>Action</th></tr></thead><tbody>';
        snap.docs.forEach(doc => {
          const data = doc.data();
          html += `
            <tr>
              <td>${data.clubId}</td>
              <td>${data.type || 'SUPPORT'}</td>
              <td>${data.referenceNumber || 'N/A'}</td>
              <td>
                <button onclick="SuperAdminController.resolveTicketWithCredit('${doc.id}', '${data.clubId}', 30); UI.showToast('Approved', 'success');" class="btn-success btn-sm">Resolve (+30 Days)</button>
              </td>
            </tr>
          `;
        });
        html += '</tbody></table>';
        queueEl.innerHTML = html;
      });
  }

  return { renderDashboard, approvePayment, renderReactiveTicketQueue };
})();

window.SuperAdmin = SuperAdmin;
