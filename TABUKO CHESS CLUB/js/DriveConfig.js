/**
 * DriveConfig.js
 * Centralized configuration for the Google Drive "Engine Room".
 * 
 * 🟥 RULE 0: CREDENTIAL SECURITY
 * DO NOT hardcode these keys in public Git repositories. 
 * Use a .env file or a secure configuration for production.
 */

const gdriveConfig = {
  apiKey: null, 
  clientId: null,
  appId: null,
  // Expanded scope to ensure the "Permission Bridge" can modify file sharing settings
  scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly',
  discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
};

window.gdriveConfig = gdriveConfig;
