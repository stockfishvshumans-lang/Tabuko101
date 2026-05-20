/**
 * gdrive.js — Google Drive API Integration
 * Exports tournament data (standings, pairings, PGN) to Google Drive.
 * Uses Google Identity Services for OAuth2 + gapi for Drive API.
 *
 * SETUP:
 *   1. Go to Google Cloud Console → APIs & Services → Enable "Google Drive API"
 *   2. Create OAuth 2.0 Client ID (Web application)
 *   3. Set authorized redirect URI to your Firebase Hosting domain
 *   4. Replace CLIENT_ID below with your actual client ID
 */
const GDrive = (() => {

  // Replace with your Google Cloud OAuth2 Client ID
  const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER_NAME = 'Tabuko Chess Club Exports';

  let tokenClient = null;
  let accessToken = null;
  let folderId = null;

  /**
   * Initialize Google Identity Services.
   * Call this after the GIS library loads.
   */
  function init() {
    if (typeof google === 'undefined' || !google.accounts) {
      console.warn('[GDrive] Google Identity Services not loaded. Add the script tag to HTML.');
      return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          console.error('[GDrive] Auth error:', response.error);
          return;
        }
        accessToken = response.access_token;
        console.log('[GDrive] Authenticated with Google Drive');
      }
    });
  }

  /**
   * Request Drive access (shows Google consent dialog).
   */
  function authorize() {
    return new Promise((resolve, reject) => {
      if (!tokenClient) { reject(new Error('GDrive not initialized')); return; }
      tokenClient.callback = (response) => {
        if (response.error) { reject(new Error(response.error)); return; }
        accessToken = response.access_token;
        resolve(accessToken);
      };
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  /**
   * Ensure the exports folder exists in Drive.
   */
  async function ensureFolder() {
    if (folderId) return folderId;

    // Search for existing folder
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`;
    const searchResp = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const searchData = await searchResp.json();

    if (searchData.files && searchData.files.length > 0) {
      folderId = searchData.files[0].id;
      return folderId;
    }

    // Create folder
    const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const created = await createResp.json();
    folderId = created.id;
    return folderId;
  }

  /**
   * Upload a text file to Google Drive.
   *
   * @param {string} filename - Name of the file
   * @param {string} content - File content (text)
   * @param {string} mimeType - MIME type (default: text/plain)
   * @returns {Object} Drive file metadata
   */
  async function uploadFile(filename, content, mimeType = 'text/plain') {
    if (!accessToken) await authorize();
    const parentId = await ensureFolder();

    const metadata = {
      name: filename,
      parents: [parentId],
      mimeType
    };

    // Multipart upload
    const boundary = '---tabuko-boundary-' + Date.now();
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) + `\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n` +
      content + `\r\n` +
      `--${boundary}--`;

    const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });

    return resp.json();
  }

  /**
   * Export tournament standings as CSV to Drive.
   */
  async function exportStandingsCSV(tournament, standings) {
    const tbo = tournament.tieBreakOrder || [];
    let csv = '#,Name,Rating,Score,' + tbo.join(',') + ',Resolved By\n';
    for (const s of standings) {
      csv += [
        s.rank, `"${s.name}"`, s.tieBreaks?.rating || '', s.score,
        ...tbo.map(tb => s.tieBreaks?.[tb] ?? ''),
        s.tieResolvedBy || ''
      ].join(',') + '\n';
    }
    const filename = `${tournament.name.replace(/[^a-zA-Z0-9]/g, '_')}_Standings_R${tournament.currentRound}.csv`;
    const result = await uploadFile(filename, csv, 'text/csv');
    AuditLog.log('EXPORT_STANDINGS', tournament.id, { filename, driveFileId: result.id });
    return result;
  }

  /**
   * Export pairings for a round as CSV to Drive.
   */
  async function exportPairingsCSV(tournament, round) {
    let csv = 'Board,White,Result,Black\n';
    for (const p of (round.pairings || [])) {
      const result = p.result ? `${p.result.whiteScore}-${p.result.blackScore}` : 'pending';
      csv += `${p.board},"${p.whiteName || p.whiteId}",${result},"${p.blackName || p.blackId}"\n`;
    }
    if (round.bye) csv += `BYE,"${round.bye.playerName}",1-0,---\n`;

    const filename = `${tournament.name.replace(/[^a-zA-Z0-9]/g, '_')}_Round${round.roundNumber}_Pairings.csv`;
    const result = await uploadFile(filename, csv, 'text/csv');
    AuditLog.log('EXPORT_PAIRINGS', tournament.id, { filename, round: round.roundNumber, driveFileId: result.id });
    return result;
  }

  /**
   * Export tournament as JSON backup to Drive.
   */
  async function exportTournamentBackup(tournament, allRounds, standings) {
    const backup = {
      exportDate: new Date().toISOString(),
      tournament,
      rounds: allRounds,
      standings,
      version: '1.0'
    };
    const filename = `${tournament.name.replace(/[^a-zA-Z0-9]/g, '_')}_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    const result = await uploadFile(filename, JSON.stringify(backup, null, 2), 'application/json');
    AuditLog.log('EXPORT_BACKUP', tournament.id, { filename, driveFileId: result.id });
    return result;
  }

  // 🛡️ REPAIR: Compile resilient standing JSON checkpoints for structural backup
  async function serializeStandingsCheckpoint(tournamentId, roundNumber) {
    try {
      console.log(`[GDrive Backup] Starting automated standings checkpoint serialize for Tournament: ${tournamentId}, Round: ${roundNumber}`);
      
      const tournament = await DB.getTournament(tournamentId);
      if (!tournament) throw new Error("Tournament not found");

      // Fetch computed standings from standings_cache
      const standingsSnap = await db.collection('tournaments').doc(tournamentId).collection('standings_cache').doc(`round_${roundNumber}`).get();
      if (!standingsSnap.exists) {
        console.warn(`[GDrive Backup] Standings cache for Round ${roundNumber} not found. Skipping GDrive serialize.`);
        return null;
      }

      const standingsData = standingsSnap.data();
      const backupPayload = {
        exportDate: new Date().toISOString(),
        tournamentId,
        roundNumber,
        tournamentName: tournament.name,
        standings: standingsData,
        source: 'Tabuko Automated Checkpoint'
      };

      // Compile details into structured JSON blob
      const filename = `Standings_Checkpoint_${tournament.name.replace(/[^a-zA-Z0-9]/g, '_')}_Round_${roundNumber}_${Date.now()}.json`;
      
      // Day 163 Task 2: Pipe compiled standing JSON checkpoint blobs directly into cloud
      const uploadResult = await uploadFile(filename, JSON.stringify(backupPayload, null, 2), 'application/json');
      console.log(`[GDrive Backup] Standings checkpoint successfully streamed to Google Drive folder! File ID: ${uploadResult.id}`);
      
      if (window.AuditLog) {
        AuditLog.log('EXPORT_CHECKPOINT', tournamentId, { filename, roundNumber, driveFileId: uploadResult.id });
      }
      return uploadResult;
    } catch (err) {
      console.error(`[GDrive Backup] Standings checkpoint serialization failed:`, err);
      return null;
    }
  }

  return { 
    init, 
    authorize, 
    uploadFile, 
    exportStandingsCSV, 
    exportPairingsCSV, 
    exportTournamentBackup,
    serializeStandingsCheckpoint
  };
})();
