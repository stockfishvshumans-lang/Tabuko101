/**
 * BillingWizard.js — Subscription Hub & GCash Verification Wizard
 * 3-Step payment flow: QR → Ref# → Confirm. Reactive subscription sync.
 */
const BillingWizard = (() => {
  let _subUnsub = null;

  // ══════════════════════════════════════════════════════════
  //  TRIAL BANNER
  // ══════════════════════════════════════════════════════════
  function renderTrialBanner() {
    const existing = document.getElementById('trial-banner');
    if (existing) existing.remove();
    if (TenantManager.isMasterAdmin()) return;

    const club = TenantManager.getActiveClubData();
    if (!club || !club.subscription) return;

    const sub = club.subscription;
    const exp = sub.end_date?.toDate ? sub.end_date.toDate() : new Date(sub.end_date);
    const now = new Date();
    const daysLeft = Math.ceil((exp - now) / 86400000);

    if (daysLeft < 0) {
      // Expired
      showBanner(`⚠️ Your subscription has expired. Your data is safe — <a href="#" onclick="BillingWizard.openWizard();return false;" style="color:#ffd60a;text-decoration:underline;">Top up ₱50</a> to restore Premium.`, '#EF4444');
    } else if (daysLeft <= 7 && sub.status === 'premium_trial') {
      showBanner(`✨ Premium Trial: <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> remaining. Enjoy full access to all features.`, '#F59E0B');
    } else if (daysLeft <= 3) {
      showBanner(`⏰ Subscription expires in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>. <a href="#" onclick="BillingWizard.openWizard();return false;" style="color:#fff;text-decoration:underline;">Renew now</a>`, '#F59E0B');
    }

    if (club.verification_pending) {
      showBanner('🟡 Payment processing — verifying via webhook instantly.', '#F59E0B');
    }
  }

  function showBanner(html, color) {
    const b = document.createElement('div');
    b.id = 'trial-banner';
    b.style.cssText = `padding:0.6rem 1.5rem;background:${color};color:#fff;font-size:0.8rem;font-weight:700;text-align:center;font-family:'Inter',sans-serif;position:relative;z-index:9998;`;
    b.innerHTML = html + ` <button onclick="this.parentElement.remove()" style="position:absolute;right:0.75rem;top:50%;transform:translateY(-50%);background:none;border:none;color:#fff;cursor:pointer;font-size:1rem;">×</button>`;
    const app = document.getElementById('app');
    if (app) app.prepend(b);
  }

  // ══════════════════════════════════════════════════════════
  //  3-STEP WIZARD
  // ══════════════════════════════════════════════════════════
  function openWizard() {
    const club = TenantManager.getActiveClubData();
    if (club?.verification_pending) {
      UI.showToast('Payment already submitted — awaiting verification', 'info');
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'billing-wizard-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.9);z-index:10000;padding:1rem;';
    modal.innerHTML = `
      <div class="bw-card">
        <div class="bw-steps" id="bw-steps">
          <div class="bw-step active" data-step="1">1</div>
          <div class="bw-step-line"></div>
          <div class="bw-step" data-step="2">2</div>
          <div class="bw-step-line"></div>
          <div class="bw-step" data-step="3">3</div>
        </div>

        <!-- STEP 1: QR CODE -->
        <div id="bw-page-1" class="bw-page">
          <h2 class="bw-title">Step 1: Scan & Pay ₱50</h2>
          <p class="bw-desc">Scan the GCash QR code below to pay <strong style="color:#00f2ff;">₱50.00</strong> for 30 days of Premium access.</p>
          <div class="bw-qr-area">
            <div style="width:200px;height:200px;background:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto;">
              <div style="text-align:center;color:#000;font-size:0.8rem;padding:1rem;">
                <div style="font-size:2.5rem;">📱</div>
                <strong>GCash QR</strong><br>
                <span style="font-size:0.7rem;color:#666;">Jesstergirado@gmail.com</span><br>
                <strong style="color:#10B981;font-size:1.2rem;">₱50.00</strong>
              </div>
            </div>
            <button class="bw-btn bw-btn-ghost" style="margin-top:0.75rem;" onclick="UI.showToast('Long-press the QR to save','info')">💾 Save QR Image</button>
          </div>
          <button class="bw-btn bw-btn-primary" onclick="BillingWizard.goStep(2)">I've Paid — Next →</button>
        </div>

        <!-- STEP 2: REF # + RECEIPT -->
        <div id="bw-page-2" class="bw-page" style="display:none;">
          <h2 class="bw-title">Step 2: Submit Proof</h2>
          <p class="bw-desc">Enter your GCash Reference Number and attach the receipt screenshot.</p>
          <label class="bw-label">GCash Reference Number *</label>
          <input id="bw-ref-no" class="bw-input" placeholder="e.g. 1234 567 890" style="font-family:'Fira Code',monospace;font-size:1rem;letter-spacing:2px;" />
          <label class="bw-label">Transaction Date & Time</label>
          <input id="bw-txn-time" type="datetime-local" class="bw-input" />
          <label class="bw-label">📎 Attach Receipt Screenshot (via Google Drive)</label>
          <div id="bw-receipt-box" style="margin-top:0.5rem; text-align:center;">
             <button class="bw-btn" id="btn-bw-drive-upload" onclick="BillingWizard.pickReceipt()">🔗 Connect Google Drive</button>
             <input type="hidden" id="bw-receipt-url" value="">
          </div>
          <div style="display:flex;gap:0.75rem;margin-top:1rem;">
            <button class="bw-btn bw-btn-ghost" onclick="BillingWizard.goStep(1)">← Back</button>
            <button class="bw-btn bw-btn-primary" style="flex:2;" onclick="BillingWizard.goStep(3)">Review →</button>
          </div>
        </div>

        <!-- STEP 3: CONFIRM -->
        <div id="bw-page-3" class="bw-page" style="display:none;">
          <h2 class="bw-title">Step 3: Confirm & Submit</h2>
          <div class="bw-confirm-box">
            <div class="bw-confirm-row"><span>Reference #:</span><strong id="bw-confirm-ref" style="font-family:monospace;">—</strong></div>
            <div class="bw-confirm-row"><span>Amount:</span><strong>₱50.00</strong></div>
            <div class="bw-confirm-row"><span>Duration:</span><strong>30 Days</strong></div>
          </div>
          <div class="bw-instructions">
            <p><strong>How it works:</strong></p>
            <ol style="padding-left:1.2rem;font-size:0.75rem;color:#999;line-height:1.8;">
              <li>✅ You scanned & paid ₱50 via GCash</li>
              <li>📸 You captured the receipt screenshot</li>
              <li>🔢 You entered the Reference Number</li>
              <li>⚡ Instant automated webhook activation</li>
            </ol>
          </div>
          <div style="display:flex;gap:0.75rem;margin-top:1rem;">
            <button class="bw-btn bw-btn-ghost" onclick="BillingWizard.goStep(2)">← Back</button>
            <button id="bw-submit-btn" class="bw-btn bw-btn-success" style="flex:2;" onclick="BillingWizard.submitVerification()">🔒 Submit for Verification</button>
          </div>
        </div>

        <button class="bw-close" onclick="document.getElementById('billing-wizard-modal').remove()">×</button>
      </div>
    `;
    document.body.appendChild(modal);
    injectWizardStyles();
  }

  function goStep(n) {
    for (let i = 1; i <= 3; i++) {
      const page = document.getElementById(`bw-page-${i}`);
      if (page) page.style.display = i === n ? 'block' : 'none';
      const dot = document.querySelector(`.bw-step[data-step="${i}"]`);
      if (dot) dot.className = `bw-step ${i <= n ? 'active' : ''}`;
    }
    if (n === 3) {
      const ref = document.getElementById('bw-ref-no')?.value || '—';
      const el = document.getElementById('bw-confirm-ref');
      if (el) el.textContent = ref;
    }
  }

  function pickReceipt() {
    if (window.DriveService) {
      window.DriveService.openDrivePicker((result) => {
        document.getElementById('bw-receipt-url').value = result.thumbnail;
        document.getElementById('bw-receipt-box').innerHTML = `
          <img src="${result.thumbnail}" style="max-height:100px; border-radius:8px; border:1px solid rgba(255,255,255,0.1);">
          <div style="font-size:0.7rem; color:#10B981; margin-top:4px;">Receipt Linked</div>
          <input type="hidden" id="bw-receipt-url" value="${result.thumbnail}">
        `;
      });
    } else {
      UI.showToast("Google Drive API not connected.", "error");
    }
  }

  async function submitVerification() {
    const refNo = document.getElementById('bw-ref-no')?.value?.trim();
    if (!refNo || refNo.length < 5) { UI.showToast('Enter a valid Reference Number', 'warning'); return; }

    const clubId = TenantManager.getActiveClubId();
    if (!clubId) { UI.showToast('No active club', 'error'); return; }

    // Duplicate check
    const dup = await db.collection('clubs').where('subscription.last_ref_no', '==', refNo).get();
    if (!dup.empty) { UI.showToast('This Reference Number has already been used', 'error'); return; }

    // Disable button
    const btn = document.getElementById('bw-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

    try {
      const receiptUrl = document.getElementById('bw-receipt-url')?.value || '';

      await db.collection('clubs').doc(clubId).update({
        'subscription.last_ref_no': refNo,
        'subscription.receiptUrl': receiptUrl,
        'pending_verification': true,
        'verification_pending': true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      await db.collection('system_logs').add({
        type: 'PAYMENT_SUBMITTED',
        clubId,
        refNo,
        receiptUrl,
        message: `[PAYMENT_SUBMITTED] Club ${clubId} submitted Ref: ${refNo}`,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      document.getElementById('billing-wizard-modal')?.remove();
      UI.showToast('Payment submitted! Verifying via instant webhook...', 'success');
      renderTrialBanner();
    } catch (err) {
      UI.showToast('Submission failed: ' + err.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🔒 Submit for Verification'; }
    }
  }

  // ══════════════════════════════════════════════════════════
  //  PREMIUM GATE (Soft Landing)
  // ══════════════════════════════════════════════════════════
  function requirePremium(featureName) {
    if (TenantManager.isMasterAdmin()) return true;
    if (TenantManager.isSubscriptionActive()) return true;

    // Show upgrade modal
    const modal = document.createElement('div');
    modal.id = 'premium-gate-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);z-index:10000;';
    modal.innerHTML = `
      <div style="background:#1a1a2e;border:1px solid rgba(239,68,68,0.3);border-radius:16px;padding:2rem;width:400px;max-width:90vw;text-align:center;color:#e0e0e0;font-family:'Inter',sans-serif;">
        <div style="font-size:3rem;margin-bottom:1rem;">🔒</div>
        <h2 style="color:#EF4444;margin:0 0 0.5rem 0;">Trial Ended</h2>
        <p style="color:#999;font-size:0.85rem;line-height:1.6;margin-bottom:1.5rem;">Your data is safe! Top up <strong style="color:#00f2ff;">₱50</strong> to restore <em>${featureName || 'Premium features'}</em>, Arbiter Links, and Analytics.</p>
        <button onclick="document.getElementById('premium-gate-modal').remove();BillingWizard.openWizard();" style="width:100%;padding:0.75rem;background:rgba(16,185,129,0.2);border:1px solid #10B981;color:#10B981;border-radius:8px;font-weight:800;font-size:0.9rem;cursor:pointer;font-family:inherit;">💳 Upgrade Now — ₱50/month</button>
        <button onclick="document.getElementById('premium-gate-modal').remove();" style="width:100%;padding:0.5rem;background:none;border:none;color:#555;cursor:pointer;margin-top:0.5rem;font-family:inherit;">Maybe later</button>
      </div>
    `;
    document.body.appendChild(modal);
    return false;
  }

  // ══════════════════════════════════════════════════════════
  //  REACTIVE SUBSCRIPTION LISTENER
  // ══════════════════════════════════════════════════════════
  function startSubscriptionListener() {
    const clubId = TenantManager.getActiveClubId();
    if (!clubId || _subUnsub) return;

    _subUnsub = db.collection('clubs').doc(clubId).onSnapshot(doc => {
      if (!doc.exists) return;
      const data = doc.data();
      // If just activated, show celebration
      if (data.subscription?.is_premium && !data.verification_pending && !data.pending_verification) {
        const banner = document.getElementById('trial-banner');
        if (banner && banner.textContent.includes('processing')) {
          banner.remove();
          UI.showToast('🎉 Your subscription is now ACTIVE!', 'success');
        }
      }
    });
  }

  // ── WIZARD STYLES ──
  function injectWizardStyles() {
    if (document.getElementById('bw-css')) return;
    const s = document.createElement('style'); s.id = 'bw-css';
    s.textContent = `
.bw-card{background:#1a1a2e;border:1px solid rgba(0,242,255,0.15);border-radius:16px;padding:2rem;width:480px;max-width:95vw;color:#e0e0e0;font-family:'Inter',sans-serif;position:relative;}
.bw-close{position:absolute;top:1rem;right:1rem;background:none;border:none;color:#555;font-size:1.5rem;cursor:pointer;}
.bw-steps{display:flex;align-items:center;justify-content:center;gap:0.5rem;margin-bottom:1.5rem;}
.bw-step{width:28px;height:28px;border-radius:50%;border:2px solid #333;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:800;color:#555;transition:all 0.3s;}
.bw-step.active{border-color:#00f2ff;color:#00f2ff;background:rgba(0,242,255,0.1);}
.bw-step-line{width:30px;height:2px;background:#333;}
.bw-title{font-size:1.1rem;font-weight:900;color:#fff;margin:0 0 0.5rem 0;}
.bw-desc{color:#888;font-size:0.8rem;margin-bottom:1rem;line-height:1.5;}
.bw-label{font-size:0.65rem;color:#666;text-transform:uppercase;letter-spacing:1px;display:block;margin:0.75rem 0 0.25rem 0;}
.bw-input{width:100%;padding:0.6rem 0.75rem;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:#e0e0e0;font-size:0.85rem;box-sizing:border-box;font-family:inherit;}
.bw-qr-area{text-align:center;margin:1rem 0;}
.bw-confirm-box{background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:1rem;margin:1rem 0;}
.bw-confirm-row{display:flex;justify-content:space-between;padding:0.4rem 0;font-size:0.8rem;border-bottom:1px solid rgba(255,255,255,0.05);}
.bw-instructions{margin:1rem 0;}
.bw-btn{padding:0.6rem 1rem;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#e0e0e0;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:700;width:100%;font-family:inherit;transition:all 0.2s;}
.bw-btn-primary{background:rgba(0,242,255,0.15);border-color:rgba(0,242,255,0.3);color:#00f2ff;}
.bw-btn-success{background:rgba(16,185,129,0.2);border-color:#10B981;color:#10B981;}
.bw-btn-ghost{background:transparent;border-color:transparent;color:#666;}
`;
    document.head.appendChild(s);
  }

  async function handlePaymentWebhookSync(clubId, referenceNumber, amountPaid) {
    // Day 262: Validate tenant scope before processing payment
    if (window.MultiTenantRuntime) {
      const scope = window.MultiTenantRuntime.validateTenantScope(clubId, 'BILLING_WEBHOOK');
      if (!scope.allowed) {
        console.error('[BillingWizard] Tenant scope violation on webhook:', scope.reason);
        throw new Error(`BILLING_SCOPE_VIOLATION: ${scope.reason}`);
      }
    }

    const clubRef = db.collection('clubs').doc(clubId);
    const billingLogRef = db.collection('clubs').doc(clubId).collection('billing_ledger').doc(referenceNumber);
    
    const result = await db.runTransaction(async (transaction) => {
      const clubDoc = await transaction.get(clubRef);
      if (!clubDoc.exists) throw new Error("Target club workspace node missing.");
      
      const now = new Date();
      const currentExpiry = clubDoc.data().subscription?.end_date?.toDate ? clubDoc.data().subscription.end_date.toDate() : new Date(clubDoc.data().subscription?.end_date || now);
      let newExpiry = new Date(currentExpiry > now ? currentExpiry : now);
      newExpiry.setDate(newExpiry.getDate() + 30); // Auto-increment premium access by exactly 30 days
      
      transaction.set(billingLogRef, { referenceNumber, amount: amountPaid, syncedAt: firebase.firestore.FieldValue.serverTimestamp(), status: 'verified', reason: 'Webhook Activation' });
      transaction.update(clubRef, {
        'subscription.status': 'premium',
        'subscription.is_premium': true,
        'subscription.end_date': firebase.firestore.Timestamp.fromDate(newExpiry),
        'pending_verification': false,
        'verification_pending': false
      });

      return { newExpiry, clubId };
    });

    // Day 262: Log to cryptographic OperationalLedger
    if (window.OperationalLedger) {
      await window.OperationalLedger.logCriticalAction('PAYMENT_WEBHOOK_PROCESSED', {
        clubId,
        referenceNumber,
        amount: amountPaid,
        newExpiry: result.newExpiry?.toISOString(),
        processedAt: new Date().toISOString()
      });
    }

    // Day 262: Publish billing event to DistributedEventBus
    if (window.DistributedEventBus) {
      window.DistributedEventBus.publish('BILLING_PAYMENT_VERIFIED', {
        clubId, referenceNumber, amount: amountPaid, timestamp: Date.now()
      });
    }

    return result;
  }

  return { renderTrialBanner, openWizard, render: openWizard, goStep, pickReceipt, submitVerification, requirePremium, startSubscriptionListener, handlePaymentWebhookSync };
})();

window.BillingWizard = BillingWizard;
