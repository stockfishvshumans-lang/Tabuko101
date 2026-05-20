/**
 * Register.js — Unified Club Admin Onboarding
 * Provisions Account, Club, and 7-Day Trial in one click.
 */
const Register = (() => {

  function render() {
    const root = document.getElementById('app');
    root.innerHTML = `
      <div class="auth-gateway titanium-obsidian animate-fade-in">
        <div class="auth-card onboarding-card">
          <header class="auth-header">
            <div class="auth-icon-wrap">♞</div>
            <h2>Join Tabuko Chess</h2>
            <p>Start your 7-Day Premium Trial</p>
          </header>

          <form id="onboarding-form" class="auth-form">
            <div class="form-section-label">Personal Information</div>
            <div class="form-row">
              <div class="form-group">
                <label>Full Name</label>
                <input type="text" id="reg-name" placeholder="Grandmaster Name" required>
              </div>
              <div class="form-group">
                <label>Phone Number</label>
                <input type="tel" id="reg-phone" placeholder="09XX XXX XXXX" required>
              </div>
            </div>
            <div class="form-group">
              <label>Email Address</label>
              <input type="email" id="reg-email" placeholder="admin@chessclub.com" required>
            </div>
            <div class="form-group">
              <label>Security Key (Password)</label>
              <input type="password" id="reg-password" placeholder="••••••••" required minlength="8">
            </div>

            <div class="form-section-label">Chess Club Information</div>
            <div class="form-group">
              <label>Club Name</label>
              <input type="text" id="reg-club-name" placeholder="e.g. Cabuyao Kings" required>
            </div>
            <div class="form-group">
              <label>Club URL Slug (System ID)</label>
              <input type="text" id="reg-club-slug" placeholder="e.g. cabuyao-kings" required>
              <small id="slug-error" style="color: crimson; display: none;">Invalid slug format. Use 3-24 lowercase letters, numbers, or dashes.</small>
            </div>
            <div class="form-group">
              <label>City / Location</label>
              <input type="text" id="reg-club-location" placeholder="e.g. Laguna, PH" required>
            </div>

            <button type="submit" class="btn-auth-primary glow-btn" id="btn-create-account">
              Create Club Account & Start Trial
            </button>
            
            <p class="auth-footer">
              Already have a club? <a href="#" onclick="UI.renderLogin()">Login here</a>
            </p>
          </form>
        </div>
      </div>
    `;

    document.getElementById('onboarding-form').addEventListener('submit', handleOnboarding);
    
    // Real-time Input Verification Observer
    document.getElementById('reg-phone').addEventListener('input', validateInputs);
    document.getElementById('reg-club-slug').addEventListener('input', validateInputs);
    
    // Auto-generate slug from name
    document.getElementById('reg-club-name').addEventListener('input', (e) => {
      const slugInput = document.getElementById('reg-club-slug');
      if (!slugInput.value || slugInput.dataset.auto === 'true') {
         slugInput.value = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 24);
         slugInput.dataset.auto = 'true';
         validateInputs();
      }
    });

    document.getElementById('reg-club-slug').addEventListener('focus', () => {
       document.getElementById('reg-club-slug').dataset.auto = 'false';
    });

    injectOnboardingStyles();
  }

  function validateInputs() {
    const phone = document.getElementById('reg-phone');
    const slug = document.getElementById('reg-club-slug');
    const btn = document.getElementById('btn-create-account');
    const slugError = document.getElementById('slug-error');
    
    let valid = true;
    
    // Phone Validation
    if (phone.value && !/^(09|\+639)\d{9}$/.test(phone.value)) {
      phone.style.borderColor = 'crimson';
      phone.style.boxShadow = '0 0 5px crimson';
      valid = false;
    } else {
      phone.style.borderColor = '#333';
      phone.style.boxShadow = 'none';
    }

    // Slug Validation
    if (slug.value && !/^[a-z0-9-_]{3,24}$/.test(slug.value)) {
      slug.style.borderColor = 'crimson';
      slug.style.boxShadow = '0 0 5px crimson';
      slugError.style.display = 'block';
      valid = false;
    } else {
      slug.style.borderColor = '#333';
      slug.style.boxShadow = 'none';
      slugError.style.display = 'none';
    }

    btn.disabled = !valid;
    return valid;
  }

  async function handleOnboarding(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-create-account');
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const fullName = document.getElementById('reg-name').value;
    const phone = document.getElementById('reg-phone').value;
    const clubName = document.getElementById('reg-club-name').value;
    const location = document.getElementById('reg-club-location').value;

    if (!validateInputs()) {
       UI.showToast('Please fix validation errors before submitting.', 'warning');
       return;
    }

    const clubSlug = document.getElementById('reg-club-slug').value.trim();

    try {
      UI.showLoading('Provisioning your Chess Empire...');
      btn.disabled = true;

      // 1. Generate & Verify Slug
      let clubId = clubSlug;
      const slugCheck = await db.collection('clubs').doc(clubId).get();
      if (slugCheck.exists) {
        UI.hideLoading();
        btn.disabled = false;
        UI.showToast('This Club URL Slug is already taken. Please choose another.', 'error');
        document.getElementById('reg-club-slug').style.borderColor = 'crimson';
        return;
      }

      // 2. Create Firebase Auth Account
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      const uid = cred.user.uid;

      // 3. Execute Unified Batch Write
      const batch = db.batch();
      
      // User Doc
      const userRef = db.collection('users').doc(uid);
      batch.set(userRef, {
        uid,
        email,
        fullName,
        phone,
        role: 'admin',
        clubId: clubId,
        trialProvisioned: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Club Doc
      const clubRef = db.collection('clubs').doc(clubId);
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 7);

      batch.set(clubRef, {
        name: clubName,
        location: location,
        admin_uid: uid,
        subscription: {
          status: 'premium_trial',
          end_date: firebase.firestore.Timestamp.fromDate(trialEndDate),
          is_premium: true,
          has_used_trial: true
        },
        branding: {
          name: clubName,
          logo_url: 'https://placeholder-url.com/default-logo.png'
        },
        settings: {
          defaultTieBreaks: ['buchholz', 'sonnebornBerger', 'wins'],
          ratingSystem: 'standard'
        },
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      await batch.commit();

      // 4. Finalize & Redirect
      UI.hideLoading();
      UI.showToast('Welcome to Tabuko! Your 7-Day Premium Trial has started.', 'success');
      
      // Update local state and redirect
      localStorage.setItem('activeClubId', clubId);
      window.location.reload(); // Reload to pick up new tenant context

    } catch (err) {
      console.error('[Onboarding] Error:', err);
      UI.hideLoading();
      btn.disabled = false;
      
      if (err.code === 'auth/email-already-in-use') {
        UI.showToast('Email already in use. Please login.', 'error');
      } else {
        UI.showToast(err.message, 'error');
      }
    }
  }

  function injectOnboardingStyles() {
    if (document.getElementById('onboarding-styles')) return;
    const style = document.createElement('style');
    style.id = 'onboarding-styles';
    style.textContent = `
      .onboarding-card {
        width: 100%;
        max-width: 500px;
        padding: 2.5rem;
      }
      .form-section-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 2px;
        color: var(--hub-accent, #00f2ff);
        margin: 1.5rem 0 1rem;
        opacity: 0.8;
        border-bottom: 1px solid rgba(0, 242, 255, 0.1);
        padding-bottom: 0.5rem;
      }
      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
      }
      .auth-footer {
        text-align: center;
        margin-top: 1.5rem;
        font-size: 0.85rem;
        color: #888;
      }
      .auth-footer a {
        color: var(--hub-accent, #00f2ff);
        text-decoration: none;
      }
      .onboarding-card .auth-input, .onboarding-card input {
        width: 100%;
        background: #111;
        border: 1px solid #333;
        color: white;
        padding: 0.75rem;
        border-radius: 4px;
        margin-top: 0.25rem;
      }
      .onboarding-card label {
        font-size: 0.75rem;
        color: #aaa;
      }
      .glow-btn {
        width: 100%;
        margin-top: 2rem;
        padding: 1rem;
        background: #00f2ff;
        color: #000;
        font-weight: bold;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        box-shadow: 0 0 15px rgba(0, 242, 255, 0.2);
      }
    `;
    document.head.appendChild(style);
  }

  return { render };
})();

window.Register = Register;
