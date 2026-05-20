/**
 * DriveService.js
 * Google Drive Picker API flow for "2-Click" logo management.
 */

const DriveService = (() => {
  let pickerApiLoaded = false;
  let gapiLoaded = false;
  let accessToken = null;

  let initPromise = null;

  /**
   * Initialize the Google Platform Library.
   */
  function init() {
    if (initPromise) return initPromise;
    
    initPromise = new Promise(async (resolve) => {
      if (typeof gapi === 'undefined') {
        console.warn('[DriveService] GAPI not found.');
        resolve(false);
        return;
      }

      // Day 202-203: Explicit try/catch intercepts 404 in local dev env gracefully
      if (!gdriveConfig.apiKey) {
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (!isLocalhost) {
          try {
            const response = await fetch('/system/secure_vault', { signal: AbortSignal.timeout(3000) });
            if (response.ok) {
              const data = await response.json();
              gdriveConfig.apiKey  = data.apiKey;
              gdriveConfig.clientId = data.clientId;
              gdriveConfig.appId   = data.appId;
              console.log('[DriveService] Secure keys hydrated from runtime vault.');
            }
          } catch (vaultErr) {}
        }

        if (!gdriveConfig.apiKey) {
          try {
            if (typeof db !== 'undefined' && typeof db.collection === 'function') {
              const vaultDoc = await db.collection('system').doc('secure_vault').get();
              if (vaultDoc.exists) {
                const data = vaultDoc.data();
                gdriveConfig.apiKey  = data.apiKey;
                gdriveConfig.clientId = data.clientId;
                gdriveConfig.appId   = data.appId;
              }
            }
          } catch (firestoreErr) {}
        }
        
        if (!gdriveConfig.apiKey) {
          const fbConfig = window.firebaseConfig || {};
          gdriveConfig.apiKey = fbConfig.apiKey || "MOCK_API_KEY_FALLBACK_PLACEHOLDER";
          gdriveConfig.clientId = fbConfig.clientId || "MOCK_CLIENT_ID_FALLBACK.apps.googleusercontent.com";
          gdriveConfig.appId = fbConfig.appId || "MOCK_APP_ID_FALLBACK";
          gdriveConfig._placeholderMode = true;
        }
      }

      if (!gdriveConfig.apiKey || !gdriveConfig.clientId || gdriveConfig._placeholderMode) {
        // Proactively apply UI shields/disable states to Drive UI components
        setTimeout(() => {
          const gdControls = document.querySelectorAll('.google-drive-btn, #connect-drive-btn, .drive-control');
          gdControls.forEach(el => {
            el.disabled = true;
            el.style.opacity = '0.5';
            el.title = 'Google Drive integration is currently disabled (missing configuration credentials).';
          });
        }, 100);

        resolve(false);
        return;
      }

      gapi.load('client:picker:drive', async () => {
        try {
          await gapi.client.init({
            apiKey: gdriveConfig.apiKey,
            discoveryDocs: gdriveConfig.discoveryDocs,
          });
          pickerApiLoaded = true;
          gapiLoaded = true;
          console.log('[DriveService] Engine Room Initialized (Drive + Picker).');
          resolve(true);
        } catch (err) {
          console.error('[DriveService] Init failed:', err);
          resolve(false);
        }
      });
    });
    return initPromise;
  }

  /**
   * Trigger the Google Picker API flow.
   * @param {Function} callback - Called with { fileId, thumbnail, name }
   */
  async function openDrivePicker(callback) {
    if (!gdriveConfig.apiKey || !gdriveConfig.clientId) {
      console.warn("[DriveService] Google credentials missing. Redirecting picker flow to Native File Uploader.");
      fallbackToNativeFilePicker(callback);
      return;
    }

    if (!pickerApiLoaded) {
      console.log('[DriveService] Waiting for initialization...');
      const success = await init();
      if (!success) {
        console.warn("[DriveService] Initialization failed. Redirecting to Native File Uploader.");
        fallbackToNativeFilePicker(callback);
        return;
      }
    }

    // Native File Uploader Fallback Handler
    function fallbackToNativeFilePicker(cb) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
      fileInput.style.display = 'none';
      fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
          try {
            const reader = new FileReader();
            reader.onload = () => {
              cb({
                fileId: `local_${Date.now()}`,
                thumbnail: reader.result,
                name: file.name,
                isLocal: true
              });
            };
            reader.readAsDataURL(file);
          } catch (err) {
            console.error("[DriveService] Native file picker error:", err);
          }
        }
      };
      document.body.appendChild(fileInput);
      fileInput.click();
      document.body.removeChild(fileInput);
    }

    // Strict variable validation shield before GSI Token Client initialization
    if (!gdriveConfig.clientId || gdriveConfig.clientId.includes('MOCK') || gdriveConfig._placeholderMode) {
      console.warn("[DriveService] Enforcing GSI Validation Shield: Missing/Mock Google Client ID. Redirecting picker flow to Native File Uploader.");
      
      const gdControls = document.querySelectorAll('.google-drive-btn, #connect-drive-btn, .drive-control');
      gdControls.forEach(el => {
        el.disabled = true;
        el.style.opacity = '0.5';
        el.title = 'Google Drive integration is currently disabled (missing configuration credentials).';
      });

      fallbackToNativeFilePicker(callback);
      return;
    }

    // Request Access Token using GIS
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: gdriveConfig.clientId,
      scope: gdriveConfig.scope,
      callback: async (response) => {
        if (response.error !== undefined) {
          throw (response);
        }
        accessToken = response.access_token;
        createPicker(callback);
      },
    });

    if (accessToken === null) {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      tokenClient.requestAccessToken({ prompt: '' });
    }
  }

  function createPicker(callback) {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS_IMAGES);
    view.setMimeTypes('image/png,image/jpeg,image/webp,image/gif');
    
    const picker = new google.picker.PickerBuilder()
      .enableFeature(google.picker.Feature.NAVIG_HIDDEN)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setAppId(gdriveConfig.appId)
      .setOAuthToken(accessToken)
      .addView(view)
      .setOrigin(window.location.origin)
      .setDeveloperKey(gdriveConfig.apiKey)
      .setCallback(async (data) => {
        if (data[google.picker.Response.ACTION] === google.picker.Action.PICKED) {
          const doc = data[google.picker.Response.DOCUMENTS][0];
          const fileId = doc[google.picker.Document.ID];
          const name = doc[google.picker.Document.NAME];

          console.log(`[DriveService] File Picked: ${name} (${fileId})`);
          
          // Automated Permission Bridge
          await authorizeFile(fileId);

          const thumbnail = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
          
          if (callback) {
            callback({ fileId, thumbnail, name });
          }
        }
      })
      .build();
    picker.setVisible(true);
  }

  /**
   * AUTOMATED PERMISSION BRIDGE
   * Ensures the logo is visible to everyone (anyone with link = reader).
   */
  async function authorizeFile(fileId) {
    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone'
        })
      });
      if (!response.ok) throw new Error("Permission fetch failed");
      console.log("[DriveService] Permission bridge successful. Asset is now public.");
    } catch (err) {
      console.error("[DriveService] Permission bridge failed. This usually means the API Key is restricted or the user denied 'drive.file' scope.", err);
      // We don't throw here to avoid breaking the UI, but we log it for the admin
      UI.showToast("Note: Public sharing failed. Logo might only be visible to you.", "warning");
    }
  }

  /**
   * THE SILENT UPLOADER: Drop-to-Drive Bridge
   * Uploads a local file directly to Google Drive and sets public permissions.
   */
  /**
   * THE SILENT UPLOADER: Local-to-Drive Multipart Bridge
   * Uses binary FormData to transfer assets directly to cloud storage.
   */
  async function uploadLogoToDrive(file) {
    if (!gapiLoaded) await init();

    return new Promise((resolve, reject) => {
      // Strict variable validation shield before GSI Token Client initialization
      if (!gdriveConfig.clientId || gdriveConfig.clientId.includes('MOCK') || gdriveConfig._placeholderMode) {
        // Fallback to Native DataURL upload with Canvas Compression
        try {
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX_WIDTH = 250;
              const scaleSize = MAX_WIDTH / (img.width || 1);
              canvas.width = MAX_WIDTH;
              canvas.height = (img.height || 1) * scaleSize;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              
              resolve({
                fileId: `local_${Date.now()}`,
                thumbnail: canvas.toDataURL('image/jpeg', 0.8),
                name: file.name || `club_logo_${Date.now()}`
              });
            };
            img.onerror = () => reject(new Error("Image processing failed"));
            img.src = e.target.result;
          };
          reader.onerror = () => reject(new Error("Local file reading failed"));
          reader.readAsDataURL(file);
        } catch (e) {
          reject(e);
        }
        return;
      }

      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: gdriveConfig.clientId,
        scope: gdriveConfig.scope,
        callback: async (response) => {
          if (response.error !== undefined) return reject(response);
          accessToken = response.access_token;

          try {
            const metadata = {
              name: `club_logo_${Date.now()}`,
              mimeType: file.type,
              parents: ['root']
            };

            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', file);

            const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}` },
              body: form
            });

            if (!res.ok) throw new Error("Cloud Sync Failed: Check Connection.");
            const driveFile = await res.json();
            const fileId = driveFile.id;

            console.log(`[DriveService] Multipart Sync Successful: ${fileId}`);

            // Automated Permission Bridge
            await setPublicPermission(fileId);

            const thumbnail = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
            resolve({ fileId, thumbnail, name: metadata.name });
          } catch (err) {
            console.error("[DriveService] Silent Sync Error:", err);
            reject(err);
          }
        },
      });

      if (accessToken === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        tokenClient.requestAccessToken({ prompt: '' });
      }
    });
  }

  /**
   * Automated Permission Bridge: Prevents "Access Denied" errors.
   */
  async function setPublicPermission(fileId) {
    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' })
      });
      if (!response.ok) throw new Error("Permission fetch failed");
      console.log("[DriveService] Asset Governance: Public access granted.");
    } catch (err) {
      console.error("[DriveService] Permission bridge failed:", err);
    }
  }

  return { init, openDrivePicker, authorizeFile, uploadLogoToDrive, setPublicPermission };
})();

window.DriveService = DriveService;
