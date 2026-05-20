/**
 * ExportPipeline.js — Programmatic TRF/PGN/CSV Streaming Export Engine
 * Day 256 & 280 & 297: File serialization for FIDE TRF submission, PGN game archives,
 * and CSV spreadsheet-compatible standings exports.
 *
 * @version 1.0.0 — Day 256/280/297 Sprint
 */
const ExportPipeline = (() => {
  'use strict';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TRF — FIDE Tournament Report File
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * generateTRF: Produces a FIDE-compliant TRF string.
   * Spec: https://www.fide.com/FIDE/handbook/C04Annex2_TRF16.pdf
   *
   * @param {Object} tournament - Tournament metadata
   * @param {Array} players - Ranked player list with results
   * @param {number} totalRounds - Number of completed rounds
   * @returns {string} TRF file content
   */
  function generateTRF(tournament, players, totalRounds) {
    const lines = [];
    const tName = (tournament.name || 'Unnamed Tournament').substring(0, 60);
    const tCity = (tournament.venue || tournament.city || 'Unknown').substring(0, 30);
    const tFed = tournament.federation || 'PHI';
    const tDate = formatTRFDate(tournament.startDate) || formatTRFDate(new Date());
    const tEndDate = formatTRFDate(tournament.endDate) || tDate;
    const arbiter = (tournament.arbiter || tournament.chiefArbiter || 'Chief Arbiter').substring(0, 40);

    // Header records
    lines.push(`012 ${tName}`);
    lines.push(`022 ${tCity}`);
    lines.push(`032 ${tFed}`);
    lines.push(`042 ${tDate}`);
    lines.push(`052 ${tEndDate}`);
    lines.push(`062 ${players.length}`);
    lines.push(`072 ${totalRounds}`);
    lines.push(`082 Swiss`);
    lines.push(`092 ${arbiter}`);
    lines.push(`102 0`); // Time control placeholder

    // XX record — round dates
    for (let r = 1; r <= totalRounds; r++) {
      lines.push(`132 ${tDate}`);
    }

    // Player records (001 lines)
    const sortedPlayers = [...players].sort((a, b) => {
      const rankA = a.rank || a.startingRank || 0;
      const rankB = b.rank || b.startingRank || 0;
      return rankA - rankB;
    });

    // Build player index for opponent references
    const playerIndex = new Map();
    sortedPlayers.forEach((p, i) => playerIndex.set(p.id, i + 1));

    sortedPlayers.forEach((p, idx) => {
      const sno = String(idx + 1).padStart(4, ' ');
      const sex = (p.gender || '').substring(0, 1).toUpperCase() || ' ';
      const title = (p.title || '').padEnd(3, ' ').substring(0, 3);
      const name = (p.name || 'Unknown').padEnd(33, ' ').substring(0, 33);
      const rating = String(p.selectedRating || p.rating || 0).padStart(4, ' ');
      const fed = (p.country || p.federation || 'PHI').padEnd(3, ' ').substring(0, 3);
      const fideid = String(p.fideid || p.fideId || '').padStart(11, ' ');
      const birthDate = formatTRFDate(p.birthDate) || '          ';
      const score = String(parseFloat(p.score || 0).toFixed(1)).padStart(4, ' ');
      const rank = String(p.rank || idx + 1).padStart(4, ' ');

      // Build round results
      let roundResults = '';
      for (let r = 0; r < totalRounds; r++) {
        const result = (p.results && p.results[r]) ? p.results[r] : null;

        if (!result || result.isUnplayed) {
          if (result && result.result === 1) {
            // Full-point bye
            roundResults += '  0000 - U';
          } else if (result && result.result === 0.5) {
            // Half-point bye
            roundResults += '  0000 - H';
          } else {
            // Zero-point forfeit or unplayed
            roundResults += '  0000 - Z';
          }
        } else {
          const oppIdx = playerIndex.get(result.opponentId) || 0;
          const oppStr = String(oppIdx).padStart(4, ' ');
          const colorChar = result.color === 'White' ? 'w' : (result.color === 'Black' ? 'b' : '-');
          let resultChar = '0';
          if (result.result === 1) resultChar = '1';
          else if (result.result === 0.5) resultChar = '=';
          else resultChar = '0';

          roundResults += `  ${oppStr} ${colorChar} ${resultChar}`;
        }
      }

      lines.push(`001 ${sno} ${sex}${title} ${name} ${rating} ${fed} ${fideid} ${birthDate} ${score} ${rank}${roundResults}`);
    });

    return lines.join('\n');
  }

  function formatTRFDate(dateInput) {
    if (!dateInput) return '';
    try {
      const d = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
      if (isNaN(d.getTime())) return '';
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    } catch (e) { return ''; }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PGN — Portable Game Notation Export
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function generatePGN(tournament, matches, players) {
    const playerMap = new Map();
    (players || []).forEach(p => playerMap.set(p.id, p));

    const games = [];
    const tName = tournament.name || 'Unknown Tournament';
    const tSite = tournament.venue || 'Online';
    const tDate = formatPGNDate(tournament.startDate);

    (matches || []).forEach(m => {
      if (!m.result) return;
      const result = typeof m.result === 'object' ? m.result : null;
      if (!result) return;

      const white = playerMap.get(m.whiteId);
      const black = playerMap.get(m.blackId);
      const whiteName = white?.name || 'Unknown';
      const blackName = black?.name || 'Unknown';
      const whiteRating = white?.selectedRating || white?.rating || '';
      const blackRating = black?.selectedRating || black?.rating || '';

      let resultStr = '*';
      if (result.whiteScore === 1 && result.blackScore === 0) resultStr = '1-0';
      else if (result.whiteScore === 0 && result.blackScore === 1) resultStr = '0-1';
      else if (result.whiteScore === 0.5) resultStr = '1/2-1/2';

      const pgn = [
        `[Event "${tName}"]`,
        `[Site "${tSite}"]`,
        `[Date "${tDate}"]`,
        `[Round "${m.round || m.roundNumber || '?'}"]`,
        `[Board "${m.board || '?'}"]`,
        `[White "${whiteName}"]`,
        `[Black "${blackName}"]`,
        whiteRating ? `[WhiteElo "${whiteRating}"]` : null,
        blackRating ? `[BlackElo "${blackRating}"]` : null,
        `[Result "${resultStr}"]`,
        '',
        resultStr,
        ''
      ].filter(Boolean).join('\n');

      games.push(pgn);
    });

    return games.join('\n');
  }

  function formatPGNDate(dateInput) {
    if (!dateInput) return '????.??.??';
    try {
      const d = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
      if (isNaN(d.getTime())) return '????.??.??';
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    } catch (e) { return '????.??.??'; }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CSV — Spreadsheet Export
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function generateCSV(standings, tiebreakColumns = ['BH', 'SB', 'WIN']) {
    const headers = ['Rank', 'Name', 'Rating', 'Score', ...tiebreakColumns, 'Country', 'Title'];
    const rows = [headers.join(',')];

    (standings || []).forEach((p, idx) => {
      const values = [
        p.rank || idx + 1,
        `"${(p.name || '').replace(/"/g, '""')}"`,
        p.selectedRating || p.rating || '',
        p.score || 0,
        ...tiebreakColumns.map(col => {
          if (p.tieBreaks && p.tieBreaks[col] !== undefined) return p.tieBreaks[col];
          if (p[col.toLowerCase()] !== undefined) return p[col.toLowerCase()];
          return '';
        }),
        p.country || p.federation || '',
        p.title || ''
      ];
      rows.push(values.join(','));
    });

    return rows.join('\n');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FILE DOWNLOAD UTILITY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function downloadFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 100);

    // Log export to OperationalLedger
    if (window.OperationalLedger) {
      window.OperationalLedger.logStandardAction('FILE_EXPORTED', {
        filename, mimeType, sizeBytes: content.length
      }).catch(() => {});
    }

    // Publish export event
    if (window.DistributedEventBus) {
      window.DistributedEventBus.publish('FILE_EXPORTED', {
        filename, format: filename.split('.').pop(), timestamp: Date.now()
      });
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ONE-CLICK EXPORT ORCHESTRATORS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function exportTRF(tournament, players, totalRounds) {
    const trfContent = generateTRF(tournament, players, totalRounds);
    const safeName = (tournament.name || 'tournament').replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadFile(trfContent, `${safeName}_TRF.txt`, 'text/plain');
    if (window.UI) window.UI.showToast('TRF file exported successfully', 'success');
  }

  function exportPGN(tournament, matches, players) {
    const pgnContent = generatePGN(tournament, matches, players);
    const safeName = (tournament.name || 'tournament').replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadFile(pgnContent, `${safeName}_Games.pgn`, 'application/x-chess-pgn');
    if (window.UI) window.UI.showToast('PGN file exported successfully', 'success');
  }

  function exportCSV(tournament, standings) {
    const csvContent = generateCSV(standings);
    const safeName = (tournament.name || 'tournament').replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadFile(csvContent, `${safeName}_Standings.csv`, 'text/csv');
    if (window.UI) window.UI.showToast('CSV file exported successfully', 'success');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLIC API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    generateTRF,
    // Day 201: Canonical alias — resolves ReferenceError: generateFideTRF is not defined
    generateFideTRF: generateTRF,
    generatePGN,
    generateCSV,
    exportTRF,
    // Day 201: Alias exportTRF under canonical FIDE name for tournament.js call sites
    exportFideTRF: exportTRF,
    exportPGN,
    exportCSV,
    downloadFile
  };
})();

window.ExportPipeline = ExportPipeline;

// Day 201: Global safety shim — prevents ReferenceError if generateFideTRF is called
// before ExportPipeline is initialized or from an inline onclick handler.
if (typeof window.generateFideTRF === 'undefined') {
  window.generateFideTRF = (...args) => {
    if (window.ExportPipeline?.generateFideTRF) return window.ExportPipeline.generateFideTRF(...args);
    console.error('[Day 201] generateFideTRF called before ExportPipeline loaded.');
    return '';
  };
}
