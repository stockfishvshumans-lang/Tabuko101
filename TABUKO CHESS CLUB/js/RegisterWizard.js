/**
 * RegisterWizard.js — High-End Multi-Step Club Onboarding
 * Steps: 1. Foundation | 2. Brand Identity | 3. Regulatory Engine
 */
const RegisterWizard = (() => {
  let currentStep = 0; // 0 = Verification, 1 = Account, 2 = Brand, 3 = Presence
  let formData = {
    fullName: '',
    mobile: '',
    email: '',
    password: '',
    personalRole: 'Organizer',
    clubName: '',
    clubSlug: '',
    primaryColor: '#10b981',
    logoUrl: null,
    logoFile: null,
    bio: '',
    city: '',
    address: '',
    socialFB: '',
    socialYT: '',
    socialWeb: '',
    isPublic: true,
    gcashEnabled: false,
    tenantKey: ''
  };

  function render() {
    // 🛡️ AUTHENTICATION OVERRIDE: If the user is already logged in, skip Google Verification
    const user = Auth.getUser();
    if (user && !user.isAnonymous && currentStep === 0) {
       formData.email = user.email || '';
       formData.fullName = user.displayName || '';
       currentStep = 1;
    }

    const root = document.getElementById('app');
    root.innerHTML = `
      <div class="wizard-overlay titanium-cobalt animate-fade-in">
        <div class="wizard-container glass-panel">
          
          <div id="wizard-step-content" class="wizard-content-area">
            <!-- Content injected here -->
          </div>

          <div class="wizard-actions" id="wizard-actions">
            <button id="btn-wiz-back" class="btn-ghost hidden">← Back</button>
            <div style="flex:1"></div>
            <button id="btn-wiz-next" class="btn-primary glow-emerald">Continue Step →</button>
          </div>
        </div>
      </div>
    `;

    injectStyles();
    updateStepUI();
    
    document.getElementById('btn-wiz-next').onclick = handleNext;
    document.getElementById('btn-wiz-back').onclick = handleBack;
  }

  function updateStepUI() {
    const content = document.getElementById('wizard-step-content');
    const actions = document.getElementById('wizard-actions');

    if (currentStep === 0) {
      if (actions) actions.style.display = 'none';
      renderVerificationStep(content);
      return;
    }

    if (actions) actions.style.display = 'flex';
    const btnBack = document.getElementById('btn-wiz-back');
    const btnNext = document.getElementById('btn-wiz-next');

    // Add Progress Bar if not present
    if (!document.querySelector('.wizard-progress')) {
        const container = document.querySelector('.wizard-container');
        const progressHtml = `
          <div class="wizard-progress">
            <div class="progress-track">
              <div id="wizard-progress-fill" class="progress-fill"></div>
            </div>
            <div class="progress-steps">
              <div class="step-indicator" data-step="1">
                <div class="step-num">1</div>
                <div class="step-text">Account</div>
              </div>
              <div class="step-indicator" data-step="2">
                <div class="step-num">2</div>
                <div class="step-text">Club Identity</div>
              </div>
              <div class="step-indicator" data-step="3">
                <div class="step-num">3</div>
                <div class="step-text">Presence</div>
              </div>
            </div>
          </div>
        `;
        container.insertAdjacentHTML('afterbegin', progressHtml);
    }

    const fill = document.getElementById('wizard-progress-fill');
    const indicators = document.querySelectorAll('.step-indicator');

    fill.style.width = `${(currentStep / 3) * 100}%`;
    indicators.forEach((el, i) => {
      el.classList.toggle('active', i + 1 <= currentStep);
    });

    btnBack.classList.toggle('hidden', currentStep === 1);
    btnNext.textContent = currentStep === 3 ? 'Complete Setup 🚀' : 'Continue Step →';

    switch (currentStep) {
      case 1: renderStep1(content); break;
      case 2: renderStep2(content); break;
      case 3: renderStep3(content); break;
    }
  }

  // ── STEP 0: GOOGLE VERIFICATION ──
  function renderVerificationStep(container) {
    container.innerHTML = `
      <div class="step-header" style="text-align: center;">
        <div class="auth-icon-wrap" style="margin: 0 auto 1.5rem; background: rgba(16, 185, 129, 0.1);">
           <span style="font-size: 2.5rem;">✨</span>
        </div>
        <h2>Launch New Club Node</h2>
        <p>Start your Tabuko Journey by verifying your administrative email with Google.</p>
        
        <button id="btn-verify-google" class="btn btn-auth-primary" style="margin-top: 2.5rem; width: 100%; background: #fff; color: #000; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 1rem; padding: 1.25rem; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" height="20">
          Verify with Google to Start
        </button>
        
        <p style="margin-top: 1.5rem; font-size: 0.75rem; color: #64748b;">
           Verification ensures you own the administrative email for this club node.
        </p>
      </div>
    `;

    document.getElementById('btn-verify-google').onclick = async () => {
      try {
        const user = await Auth.verifyWithGoogle();
        formData.email = user.email;
        formData.fullName = user.displayName || '';
        currentStep = 1;
        updateStepUI();
      } catch (e) {
        UI.showToast(e.message, 'error');
      }
    };
  }

  // ── STEP 1: IDENTITY & CONTACT ──
  function renderStep1(container) {
    container.innerHTML = `
      <div class="step-header">
        <h2>Set Security Key</h2>
        <p>Configure your access credentials for daily logins.</p>
      </div>
      <div class="wiz-form-grid">
        <div class="form-group">
          <label>Verified Email</label>
          <input type="email" id="wiz-email" value="${formData.email}" readonly style="background: rgba(16, 185, 129, 0.05); color: #10b981; border-color: rgba(16, 185, 129, 0.2); font-weight: 700;">
        </div>
        <div class="form-group">
          <label>Security Key (Password)</label>
          <input type="password" id="wiz-password" placeholder="Min. 8 Characters" value="${formData.password}">
        </div>
        <div class="form-group">
          <label>Full Name</label>
          <input type="text" id="wiz-fullname" placeholder="e.g. Jesster Girado" value="${formData.fullName}">
        </div>
        <div class="form-group">
          <label>Personal Role</label>
          <select id="wiz-role">
            <option value="Organizer" ${formData.personalRole === 'Organizer' ? 'selected' : ''}>Club Organizer</option>
            <option value="Coach" ${formData.personalRole === 'Coach' ? 'selected' : ''}>Chess Coach</option>
            <option value="President" ${formData.personalRole === 'President' ? 'selected' : ''}>Club President</option>
            <option value="Arbiter" ${formData.personalRole === 'Arbiter' ? 'selected' : ''}>Tournament Arbiter</option>
          </select>
        </div>
        <div class="form-group full-width">
          <label>Mobile Number (GCash Ready)</label>
          <div class="phone-input">
            <span>+63</span>
            <input type="tel" id="wiz-mobile" placeholder="917 123 4567" value="${formData.mobile}">
          </div>
        </div>
      </div>
    `;
  }

  // ── STEP 2: BRAND ARCHITECTURE ──
  function renderStep2(container) {
    container.innerHTML = `
      <div class="step-header">
        <h2>Brand Architecture</h2>
        <p>Define your club's visual "Glow" and digital identity.</p>
      </div>
      <div class="wiz-brand-layout">
        <div class="wiz-form-side">
          <div class="form-group">
            <label>Club Name</label>
            <input type="text" id="wiz-clubname" placeholder="Cabuyao Grandmasters" value="${formData.clubName}">
          </div>
          <div class="form-group">
            <label>Club Slug (Auto-Generated)</label>
            <div class="slug-input">
              <span>tabuko.io/</span>
              <input type="text" id="wiz-slug" value="${formData.clubSlug}">
              <div id="slug-indicator" style="padding-left: 0.5rem; font-size: 0.8rem; font-weight: bold;"></div>
            </div>
          </div>
          <div class="form-group">
            <label>Primary Brand Glow</label>
            <div class="color-picker-wrap">
              <input type="color" id="wiz-color" value="${formData.primaryColor}">
              <span id="color-hex">${formData.primaryColor}</span>
            </div>
          </div>
          <div class="form-group">
            <label>Club Logo</label>
            <div class="logo-upload-box" id="logo-upload-btn">
              ${formData.logoUrl ? `<img src="${formData.logoUrl}" class="logo-preview-img">` : '<span>Connect Google Drive</span>'}
            </div>
          </div>
        </div>
        <div class="wiz-preview-side">
          <label>Brand Preview</label>
          <div class="id-card-preview" style="border-top: 4px solid ${formData.primaryColor}">
             <div class="id-logo">
                ${formData.logoUrl ? `<img src="${formData.logoUrl}">` : '♞'}
             </div>
             <div class="id-info">
                <div class="id-club-name">${formData.clubName || 'Cabuyao Grandmasters'}</div>
                <div class="id-status">TABUKO ECOSYSTEM MEMBER</div>
             </div>
             <div class="id-footer">
                PREMIUM TRIAL • 7 DAYS
             </div>
          </div>
        </div>
      </div>
    `;

    // Events
    const updateSlug = (val) => {
      return val.toLowerCase().trim().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    };

    let debounceTimer;
    document.getElementById('wiz-clubname').oninput = (e) => {
      const slug = updateSlug(e.target.value);
      formData.clubSlug = slug;
      document.getElementById('wiz-slug').value = slug;
      document.querySelector('.id-club-name').textContent = e.target.value || 'Cabuyao Grandmasters';
      triggerSlugCheck(slug);
    };

    document.getElementById('wiz-slug').oninput = (e) => {
      const slug = updateSlug(e.target.value);
      e.target.value = slug;
      formData.clubSlug = slug;
      triggerSlugCheck(slug);
    };

    function triggerSlugCheck(candidateSlug) {
      clearTimeout(debounceTimer);
      const indicator = document.getElementById('slug-indicator');
      if (candidateSlug.length < 3) {
        indicator.innerHTML = '<span style="color:#f87171;">✗ Too short</span>';
        return;
      }
      indicator.innerHTML = '<span style="color:#f59e0b;">...</span>';
      
      debounceTimer = setTimeout(async () => {
        try {
          const docSnap = await db.collection('clubs').doc(candidateSlug).get();
          const isAvailable = !docSnap.exists;
          if (isAvailable) {
            indicator.innerHTML = '<span style="color:#10b981;">✓ Available</span>';
          } else {
            indicator.innerHTML = '<span style="color:#f87171;">✗ Taken</span>';
          }
        } catch(err) {
          indicator.innerHTML = '';
        }
      }, 300);
    }

    document.getElementById('wiz-color').oninput = (e) => {
      formData.primaryColor = e.target.value;
      document.getElementById('color-hex').textContent = e.target.value;
      document.querySelector('.id-card-preview').style.borderTopColor = e.target.value;
    };

    const logoBtn = document.getElementById('logo-upload-btn');
    logoBtn.onclick = () => {
      if (window.DriveService) {
        window.DriveService.openDrivePicker((result) => {
          formData.logoUrl = result.thumbnail;
          formData.logoDriveId = result.fileId;
          document.getElementById('logo-upload-btn').innerHTML = `<img src="${formData.logoUrl}" class="logo-preview-img">`;
          document.querySelector('.id-logo').innerHTML = `<img src="${formData.logoUrl}" style="width:100%;height:100%;object-fit:cover;">`;
        });
      } else {
        UI.showToast("Drive Service not loaded", "error");
      }
    };
  }

  // ── STEP 3: THE PRESENCE ──
  function renderStep3(container) {
    container.innerHTML = `
      <div class="step-header">
        <h2>The Presence</h2>
        <p>Configure your club's global footprint and social visibility.</p>
      </div>
      <div class="wiz-presence-grid">
        <div class="form-group full-width">
          <label>Club Biography & Mission</label>
          <textarea id="wiz-bio" placeholder="Our club aims to produce the next generation of grandmasters in Cabuyao..." rows="3">${formData.bio}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>City / Province</label>
            <input type="text" id="wiz-city" placeholder="Cabuyao, Laguna" value="${formData.city}">
          </div>
          <div class="form-group">
            <label>Standard Playing Venue Address</label>
            <input type="text" id="wiz-address" placeholder="123 Chess St, Brgy Hall" value="${formData.address}">
          </div>
        </div>
        <div class="social-links-grid">
          <div class="form-group">
            <label>Facebook Page</label>
            <input type="text" id="wiz-fb" placeholder="fb.com/cabuyaochess" value="${formData.socialFB}">
          </div>
          <div class="form-group">
            <label>YouTube Channel</label>
            <input type="text" id="wiz-yt" placeholder="youtube.com/@cabuyaochess" value="${formData.socialYT}">
          </div>
          <div class="form-group">
            <label>Official Website</label>
            <input type="text" id="wiz-web" placeholder="www.cabuyaochess.club" value="${formData.socialWeb}">
          </div>
        </div>
        <div class="toggles-grid">
          <div class="toggle-item">
            <div class="toggle-info">
              <h3>Global Visibility</h3>
              <p>Publicly list this club in the Tabuko Ecosystem.</p>
            </div>
            <label class="switch">
              <input type="checkbox" id="wiz-public" ${formData.isPublic ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>
          <div class="toggle-item">
            <div class="toggle-info">
              <h3>GCash Integration</h3>
              <p>Enable automated payment tracking for tournaments.</p>
            </div>
            <label class="switch">
              <input type="checkbox" id="wiz-gcash" ${formData.gcashEnabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>
    `;
  }

  // ── LOGIC HANDLERS ──

  async function handleNext() {
    saveStepData();

    if (currentStep === 1) {
      if (!formData.fullName || !formData.password) return UI.showToast('All fields (including Password) are mandatory', 'warning');
      if (formData.password.length < 8) return UI.showToast('Security Key must be at least 8 characters', 'warning');
      currentStep = 2;
      updateStepUI();
    } else if (currentStep === 2) {
      if (!formData.clubName) return UI.showToast('Please name your club', 'warning');
      currentStep = 3;
      updateStepUI();
    } else {
      await executeFinalProvisioning();
    }
  }

  function handleBack() {
    if (currentStep > 1) {
      currentStep--;
      updateStepUI();
    }
  }

  function saveStepData() {
    if (currentStep === 1) {
      formData.fullName = document.getElementById('wiz-fullname').value;
      formData.password = document.getElementById('wiz-password').value;
      formData.mobile = document.getElementById('wiz-mobile').value.replace(/\s+/g, '');
      formData.personalRole = document.getElementById('wiz-role').value;
    } else if (currentStep === 2) {
      formData.clubName = document.getElementById('wiz-clubname').value;
      const rawSlug = document.getElementById('wiz-slug').value;
      const cleanSlug = rawSlug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
      if (cleanSlug.length < 3) {
        throw new Error("Slug configurations must contain a minimum of 3 alphanumeric characters.");
      }
      formData.clubSlug = cleanSlug;
    } else if (currentStep === 3) {
      formData.bio = document.getElementById('wiz-bio').value;
      formData.city = document.getElementById('wiz-city').value;
      formData.address = document.getElementById('wiz-address').value;
      formData.socialFB = document.getElementById('wiz-fb').value;
      formData.socialYT = document.getElementById('wiz-yt').value;
      formData.socialWeb = document.getElementById('wiz-web').value;
      formData.isPublic = document.getElementById('wiz-public').checked;
      formData.gcashEnabled = document.getElementById('wiz-gcash').checked;
    }
  }

  // Local logo upload replaced by Google Drive Picker

  async function executeFinalProvisioning() {
    try {
      UI.showLoading('Architecting Your Digital Venue...');

      let uid;
      const currentUser = Auth.getUser();

      if (currentUser && !currentUser.isAnonymous) {
        // ── USE EXISTING ACCOUNT ──
        console.log('[Wizard] Using existing authenticated session:', currentUser.uid);
        uid = currentUser.uid;
      } else {
        // ── CREATE NEW ACCOUNT ──
        const authResult = await auth.createUserWithEmailAndPassword(formData.email, formData.password);
        uid = authResult.user.uid;
      }

      // 2. Logo Provisioning (Drive URL already set in formData.logoUrl)
      let finalLogoUrl = formData.logoUrl || null;
      let logoDriveId = formData.logoDriveId || null;

      // 3. Auth Linkage (UID obtained from account creation)
      
      // 4. Generate tenantKey
      formData.tenantKey = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

      // 5. Atomic Provisioning via ClubManager
      await ClubManager.provisionClub(formData, uid, finalLogoUrl, logoDriveId);

      // 5. Success State
      UI.hideLoading();
      renderSuccessScreen(formData.clubName);

    } catch (err) {
      UI.hideLoading();
      UI.showToast(err.message, 'error');
    }
  }

  function renderSuccessScreen(clubName) {
    const root = document.getElementById('app');
    root.innerHTML = `
      <div class="success-screen titanium-obsidian animate-fade-in">
        <div class="success-card glass-panel">
          <div class="success-icon">✨</div>
          <h1>Welcome to the Command Center</h1>
          <p>Registration Successful! <strong>${clubName}</strong> is now live.</p>
          <div class="quick-start">
             <h3>Quick Start Guide</h3>
             <ul>
                <li>🏆 A "Welcome Tournament" draft has been created for you.</li>
                <li>📋 Check your dashboard to start your first pairing.</li>
                <li>📺 Your 7-Day Premium trial is active.</li>
             </ul>
          </div>
          <button onclick="sessionStorage.removeItem('isLaunchingNewNode'); window.location.reload();" class="btn-primary glow-emerald" style="width:100%; padding:1rem; margin-top:1.5rem;">Enter Dashboard</button>
        </div>
      </div>
    `;
  }

  function injectStyles() {
    if (document.getElementById('wiz-styles')) return;
    const s = document.createElement('style');
    s.id = 'wiz-styles';
    s.textContent = `
      .wizard-overlay { position:fixed; top:0; left:0; right:0; bottom:0; background:#05070a; display:flex; align-items:center; justify-content:center; z-index:10000; padding:1rem; }
      .wizard-container { width:100%; max-width:800px; padding:2rem; border-radius:24px; position:relative; }
      .glass-panel { background:rgba(15, 23, 42, 0.8); border:1px solid rgba(255,255,255,0.1); backdrop-filter:blur(30px); box-shadow:0 25px 60px rgba(0,0,0,0.6); }
      
      .wizard-progress { margin-bottom:2.5rem; }
      .progress-track { height:4px; background:rgba(255,255,255,0.05); border-radius:2px; margin-bottom:1rem; overflow:hidden; }
      .progress-fill { height:100%; background:linear-gradient(90deg, #10b981, #0ea5e9); transition:width 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
      .progress-steps { display:flex; justify-content:space-between; }
      .step-indicator { display:flex; flex-direction:column; align-items:center; gap:0.5rem; opacity:0.3; transition:0.3s; }
      .step-indicator.active { opacity:1; }
      .step-num { width:24px; height:24px; border-radius:50%; background:#1e293b; color:#fff; display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:900; border:1px solid rgba(255,255,255,0.1); }
      .step-indicator.active .step-num { background:#10b981; border-color:#10b981; box-shadow:0 0 15px rgba(16,185,129,0.3); }
      .step-text { font-size:0.7rem; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; }
      .step-indicator.active .step-text { color:#fff; }

      .step-header { margin-bottom:2rem; }
      .step-header h2 { font-size:1.75rem; font-weight:900; margin-bottom:0.5rem; color:#fff; letter-spacing:-0.5px; }
      .step-header p { color:#64748b; font-size:0.95rem; }

      .wiz-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:1.5rem; }
      .form-group { display:flex; flex-direction:column; gap:0.5rem; }
      .form-group.full-width { grid-column: 1 / -1; }
      .form-row { display:grid; grid-template-columns:1fr 1fr; gap:1rem; grid-column: 1 / -1; }
      
      .form-group label { font-size:0.75rem; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:1px; }
      .form-group input, .form-group select, .form-group textarea { 
        background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:0.9rem 1.1rem; 
        color:#fff; font-size:0.95rem; transition:0.2s; outline:none;
      }
      .form-group input:focus, .form-group select:focus, .form-group textarea:focus { 
        border-color:#10b981; background:rgba(16,185,129,0.03); box-shadow:0 0 0 4px rgba(16,185,129,0.1); 
      }
      
      .phone-input { display:flex; align-items:center; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.08); border-radius:10px; overflow:hidden; }
      .phone-input span { padding:0 1rem; color:#10b981; font-weight:900; font-size:0.9rem; border-right:1px solid rgba(255,255,255,0.08); }
      .phone-input input { border:none; background:transparent; flex:1; }

      .wiz-brand-layout { display:grid; grid-template-columns:1fr 300px; gap:2.5rem; }
      .slug-input { display:flex; align-items:center; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.08); border-radius:10px; overflow:hidden; }
      .slug-input span { padding:0 0.85rem; color:#0ea5e9; font-weight:800; font-size:0.9rem; }
      .slug-input input { border:none; background:transparent; flex:1; color:#0ea5e9; font-weight:700; cursor:default; }

      .color-picker-wrap { display:flex; align-items:center; gap:1.2rem; }
      input[type="color"] { -webkit-appearance:none; border:none; width:44px; height:44px; border-radius:10px; cursor:pointer; background:none; }
      input[type="color"]::-webkit-color-swatch-wrapper { padding:0; }
      input[type="color"]::-webkit-color-swatch { border:none; border-radius:10px; border:1px solid rgba(255,255,255,0.2); }
      #color-hex { font-family:'JetBrains Mono',monospace; font-weight:800; color:#94a3b8; font-size:0.9rem; }

      .logo-upload-box { height:130px; border:2px dashed rgba(255,255,255,0.1); border-radius:14px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:0.3s; overflow:hidden; position:relative; }
      .logo-upload-box:hover { border-color:#10b981; background:rgba(16,185,129,0.05); }
      .logo-upload-box span { color:#64748b; font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:1px; }
      .logo-preview-img { max-height:100%; width:auto; }

      .id-card-preview { background:#0f172a; border-radius:20px; padding:2rem; display:flex; flex-direction:column; align-items:center; gap:1.2rem; box-shadow:0 15px 40px rgba(0,0,0,0.4); position:relative; overflow:hidden; border:1px solid rgba(255,255,255,0.05); }
      .id-logo { width:90px; height:90px; border-radius:50%; background:#1e293b; display:flex; align-items:center; justify-content:center; font-size:3rem; border:2px solid rgba(255,255,255,0.05); overflow:hidden; }
      .id-logo img { width:100%; height:100%; object-fit:cover; }
      .id-club-name { font-weight:900; font-size:1.2rem; color:#fff; text-align:center; letter-spacing:-0.5px; }
      .id-status { font-size:0.6rem; font-weight:900; background:rgba(16,185,129,0.1); color:#10b981; padding:5px 12px; border-radius:50px; letter-spacing:1px; text-transform:uppercase; }
      .id-footer { margin-top:1.2rem; font-size:0.65rem; font-weight:800; color:#475569; letter-spacing:2px; text-transform:uppercase; }

      .wiz-presence-grid { display:flex; flex-direction:column; gap:1.8rem; }
      .social-links-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:1rem; }
      
      .toggles-grid { display:grid; grid-template-columns:1fr 1fr; gap:1.5rem; background:rgba(0,0,0,0.2); padding:1.5rem; border-radius:16px; border:1px solid rgba(255,255,255,0.05); }
      .toggle-item { display:flex; justify-content:space-between; align-items:center; }
      .toggle-info h3 { font-size:0.9rem; font-weight:900; color:#fff; margin:0; }
      .toggle-info p { font-size:0.75rem; color:#64748b; margin:4px 0 0; }

      /* SWITCH UI */
      .switch { position:relative; display:inline-block; width:46px; height:24px; }
      .switch input { opacity:0; width:0; height:0; }
      .slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#334155; transition:.4s; border-radius:24px; }
      .slider:before { position:absolute; content:""; height:18px; width:18px; left:3px; bottom:3px; background-color:white; transition:.4s; border-radius:50%; }
      input:checked + .slider { background-color:#10b981; }
      input:checked + .slider:before { transform:translateX(22px); }

      .wizard-actions { margin-top:2.5rem; display:flex; align-items:center; }
      .btn-ghost { background:none; border:none; color:#64748b; font-weight:800; cursor:pointer; font-size:0.9rem; transition:0.2s; }
      .btn-ghost:hover { color:#fff; }
      .btn-primary { background:#10b981; color:#000; border:none; padding:1.1rem 2.5rem; border-radius:12px; font-weight:900; text-transform:uppercase; letter-spacing:1px; cursor:pointer; transition:0.3s; font-size:0.95rem; }
      .btn-primary:hover { transform:translateY(-2px); box-shadow:0 8px 25px rgba(16,185,129,0.4); }
      .glow-emerald { box-shadow:0 0 25px rgba(16,185,129,0.2); }
      .hidden { display:none; }

      .success-screen { position:fixed; top:0; left:0; right:0; bottom:0; background:#05070a; display:flex; align-items:center; justify-content:center; z-index:10001; }
      .success-card { max-width:550px; padding:3.5rem; text-align:center; border-radius:32px; }
      .success-icon { font-size:5rem; margin-bottom:1.5rem; filter:drop-shadow(0 0 20px rgba(16,185,129,0.4)); }
      .success-card h1 { font-size:2.2rem; font-weight:900; color:#fff; margin-bottom:1rem; letter-spacing:-1px; }
      .success-card p { color:#94a3b8; margin-bottom:2.5rem; font-size:1.1rem; }
      .quick-start { text-align:left; background:rgba(0,0,0,0.25); padding:1.8rem; border-radius:20px; border:1px solid rgba(255,255,255,0.05); }
      .quick-start h3 { font-size:0.85rem; font-weight:900; color:#10b981; margin-bottom:1.2rem; text-transform:uppercase; letter-spacing:2px; }
      .quick-start ul { list-style:none; padding:0; }
      .quick-start li { font-size:0.95rem; color:#94a3b8; margin-bottom:1rem; display:flex; align-items:center; gap:0.75rem; font-weight:500; }
      .quick-start li::before { content:'✔'; color:#10b981; font-weight:900; }
      
      @keyframes fadeIn { from { opacity:0; transform:translateY(15px); } to { opacity:1; transform:translateY(0); } }
      .animate-fade-in { animation: fadeIn 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
    `;
    document.head.appendChild(s);
  }

  return { render };
})();

window.RegisterWizard = RegisterWizard;
