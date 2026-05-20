/**
 * RatingService.js — Unified Rating Provider Abstraction Layer
 * =============================================================
 * Handles FIDE (via Google Drive chunks), NCFP (via proxy), and local ratings
 * through a single search interface with IndexedDB caching.
 *
 * Architecture:
 *   RatingService.search("Carlsen")
 *     → checks IndexedDB cache for "ca" chunk
 *     → if miss, fetches ca.json from Google Drive
 *     → caches in IndexedDB for offline use
 *     → returns filtered results
 *
 * Providers:
 *   FIDE   — Chunked JSON from Google Drive (shredder.py output)
 *   NCFP   — Cloudflare proxy scrape of chessportalph.org
 *   LOCAL  — Club member database (Firestore)
 */
const RatingService = (() => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CONFIGURATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const CONFIG = {
    // Google Drive folder containing shredder.py output
    // Set via RatingService.configure({ driveBaseUrl: '...' })
    driveBaseUrl: '',

    // NCFP proxy (Cloudflare Worker or allorigins fallback)
    ncfpProxyUrl: 'https://api.allorigins.win/raw?url=',
    ncfpBaseUrl: 'https://chessportalph.org/ratings',

    // IndexedDB config
    dbName: 'TabukoRatingCache',
    dbVersion: 1,
    storeName: 'fide_chunks',

    // Cache TTL (7 days in ms)
    cacheTTL: 7 * 24 * 60 * 60 * 1000,
  };

  let _manifest = null;
  let _dbPromise = null;
  let _pendingFetches = {};

  // Day 149 Task 2: Automated Local Cache Cleaning Scheduler
  async function runAutomatedCachePurge() {
    console.log('[RatingService] Starting automated local cache cleaning scan...');
    try {
      const db = await openDB();
      if (!db) return;

      const tx = db.transaction(CONFIG.storeName, 'readwrite');
      const store = tx.objectStore(CONFIG.storeName);
      const req = store.openCursor();

      let purgedCount = 0;
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const record = cursor.value;
          const age = Date.now() - (record.ts || 0);
          if (age > CONFIG.cacheTTL) {
            cursor.delete();
            purgedCount++;
            console.log(`[RatingService Cache Purge] Deleted stale cache key: ${record.key}`);
          }
          cursor.continue();
        } else {
          console.log(`[RatingService Cache Purge] Scan completed. Purged ${purgedCount} stale entries.`);
        }
      };
      req.onerror = (err) => {
        console.error('[RatingService Cache Purge] Scan failed:', err);
      };
    } catch (e) {
      console.warn('[RatingService Cache Purge] Scan exception:', e);
    }
  }

  function openDB() {
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(CONFIG.dbName, CONFIG.dbVersion);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(CONFIG.storeName)) {
          db.createObjectStore(CONFIG.storeName, { keyPath: 'key' });
        }
      };

      req.onsuccess = () => {
        const dbInstance = req.result;
        // Day 149 Task 2: Trigger automated local cache cleaning scan
        setTimeout(() => {
          runAutomatedCachePurge();
        }, 1000);
        resolve(dbInstance);
      };
      req.onerror = () => {
        console.warn('[RatingService] IndexedDB unavailable, using memory cache');
        resolve(null);
      };
    });

    return _dbPromise;
  }

  // In-memory fallback cache
  const _memCache = {};

  let _useMemoryFallback = false;
  function activateMemoryFallbackMode() {
    _useMemoryFallback = true;
  }

  async function getCachedChunk(key) {
    // Day 149 Task 1: Prepend tenant's active workspace ID key
    const activeClub = window.TenantManager?.getActiveClubId?.() || 'default';
    const partitionedKey = "tenant_" + activeClub + "_cache_chunk_" + key;

    if (_useMemoryFallback) return _memCache[partitionedKey] || null;

    try {
      const db = await openDB();
      if (!db) return _memCache[partitionedKey] || null;

      return new Promise((resolve) => {
        // Day 220 Task 1 & 2: Strict 2-Second Timeout Execution Gates
        const storageTimeout = setTimeout(() => {
          console.warn('[IndexedDB Guard] Storage lookup operation exceeded strict 2-second safety threshold. Aborting transaction and switching to memory fallback.');
          RatingService.activateMemoryFallbackMode();
          resolve(_memCache[partitionedKey] || null);
        }, 2000); // Strict 2-second execution gate

        const tx = db.transaction(CONFIG.storeName, 'readonly');
        const store = tx.objectStore(CONFIG.storeName);
        const req = store.get(partitionedKey);
        req.onsuccess = () => {
          clearTimeout(storageTimeout);
          const record = req.result;
          if (!record) return resolve(null);

          // Check TTL
          if (Date.now() - record.ts > CONFIG.cacheTTL) {
            resolve(null); // Expired
          } else {
            resolve(record.data);
          }
        };
        req.onerror = () => {
          clearTimeout(storageTimeout);
          RatingService.activateMemoryFallbackMode();
          resolve(_memCache[partitionedKey] || null);
        };
      });
    } catch (e) {
      RatingService.activateMemoryFallbackMode();
      return _memCache[partitionedKey] || null;
    }
  }

  async function setCachedChunk(key, data) {
    // Day 149 Task 1: Prepend tenant's active workspace ID key
    const activeClub = window.TenantManager?.getActiveClubId?.() || 'default';
    const partitionedKey = "tenant_" + activeClub + "_cache_chunk_" + key;

    _memCache[partitionedKey] = data; // Always set memory cache

    try {
      const db = await openDB();
      if (!db) return;

      const tx = db.transaction(CONFIG.storeName, 'readwrite');
      const store = tx.objectStore(CONFIG.storeName);
      store.put({ key: partitionedKey, data, ts: Date.now() });
    } catch (e) {
      // Silent fail — memory cache is backup
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MANIFEST LOADER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function loadManifest() {
    if (_manifest) return _manifest;

    // Try cache first
    const cached = await getCachedChunk('__manifest__');
    if (cached) {
      _manifest = cached;
      return _manifest;
    }

    if (!CONFIG.driveBaseUrl) {
      console.warn('[RatingService] No driveBaseUrl configured. FIDE search disabled.');
      return null;
    }

    try {
      const url = CONFIG.driveBaseUrl.replace(/\/$/, '') + '/manifest.json';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
      _manifest = await res.json();
      await setCachedChunk('__manifest__', _manifest);
      return _manifest;
    } catch (e) {
      console.error('[RatingService] Manifest load failed:', e);
      return null;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CHUNK LOADER (Smart Fetching)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function loadChunk(prefix) {
    const secureCacheKey = `${window.TenantManager?.getActiveClubId()}_chunk_${prefix}`;
    // 1. Check cache
    const cached = await getCachedChunk(secureCacheKey);
    if (cached) return cached;

    // 2. Deduplicate concurrent fetches for same chunk
    if (_pendingFetches[prefix]) return _pendingFetches[prefix];

    // 3. Fetch from Drive
    const fetchPromise = (async () => {
      if (!CONFIG.driveBaseUrl) return [];

      try {
        const url = CONFIG.driveBaseUrl.replace(/\/$/, '') + `/${prefix}.json`;
        const res = await fetch(url);
        if (!res.ok) {
          if (res.status === 404) return []; // Chunk doesn't exist
          throw new Error(`Chunk fetch failed: ${res.status}`);
        }
        const data = await res.json();
        await setCachedChunk(secureCacheKey, data);
        return data;
      } catch (e) {
        console.warn(`[RatingService] Chunk "${prefix}" fetch failed:`, e);
        return [];
      } finally {
        delete _pendingFetches[prefix];
      }
    })();

    _pendingFetches[prefix] = fetchPromise;
    return fetchPromise;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FIDE SEARCH
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function getPrefix(query) {
    let prefix = '';
    for (const ch of query.toLowerCase()) {
      if (/[a-z]/.test(ch)) {
        prefix += ch;
        if (prefix.length === 2) break;
      }
    }
    return prefix.length >= 2 ? prefix : null;
  }

  /**
   * Search FIDE database by name prefix.
   * Only fetches the required chunk(s).
   * @param {string} query - Search string (min 2 alpha chars)
   * @param {number} limit - Max results to return
   * @returns {Array} Expanded player objects
   */
  async function searchFIDE(query, limit = 20) {
    if (!query || query.length < 2) return [];

    const prefix = getPrefix(query);
    if (!prefix) return [];

    const manifest = await loadManifest();
    if (!manifest) return [];

    // Verify chunk exists in manifest
    const chunkExists = manifest.chunks.some(c => c.k === prefix);
    if (!chunkExists) return [];

    const players = await loadChunk(prefix);
    if (!players.length) return [];

    // Filter by full query (case-insensitive)
    const q = query.toLowerCase();
    const results = players
      .filter(p => (p.n || '').toLowerCase().includes(q))
      .slice(0, limit);

    // Expand minified keys for consumer
    return results.map(expandPlayer);
  }

  /**
   * Lookup a single FIDE player by ID.
   * Searches all cached chunks first, then brute-forces if needed.
   */
  async function lookupFIDE(fideId) {
    if (!fideId) return null;
    const id = String(fideId);

    // Search memory cache first
    for (const key in _memCache) {
      if (!key.startsWith('chunk_')) continue;
      const found = _memCache[key].find(p => String(p.i) === id);
      if (found) return expandPlayer(found);
    }

    return null; // Full lookup would require manifest scan — too expensive
  }

  function expandPlayer(p) {
    return {
      fideid: p.i || '',
      name: p.n || '',
      rating: p.r || 0,
      birthday: p.b || '',
      country: p.c || '',
      title: p.t || '',
      sex: p.s || '',
      source: 'fide',
      confidence: 'synced',
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NCFP PROVIDER (Live Scraper with Proxy)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let _ncfpAbort = null;

  async function searchNCFP(query, statusEl) {
    if (!query || query.length < 3) return [];
    if (_ncfpAbort) { _ncfpAbort.abort(); _ncfpAbort = null; }
    _ncfpAbort = new AbortController();

    _setStatus(statusEl, 'Searching NCFP Portal...', '#3b82f6');

    try {
      const targetUrl = `${CONFIG.ncfpBaseUrl}?search=${encodeURIComponent(query)}`;
      const proxyUrl = `${CONFIG.ncfpProxyUrl}${encodeURIComponent(targetUrl)}`;
      _setStatus(statusEl, 'Proxy handshake...', '#f59e0b');

      const res = await fetch(proxyUrl, {
        signal: _ncfpAbort.signal,
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
      });
      if (!res.ok) throw new Error(`Proxy ${res.status}`);

      const html = await res.text();
      const results = parseNCFPHtml(html);

      if (results.length === 0) _setStatus(statusEl, 'No NCFP results', '#64748b');
      else if (results.length === 1) _setStatus(statusEl, `✓ Found: ${results[0].name}`, '#10b981');
      else _setStatus(statusEl, `${results.length} matches — select below`, '#3b82f6');

      return results;
    } catch (e) {
      if (e.name === 'AbortError') { _setStatus(statusEl, 'Cancelled', '#64748b'); return []; }
      console.warn('[RatingService] NCFP failed:', e.message);
      _setStatus(statusEl, 'NCFP unavailable', '#ef4444');
      return [];
    } finally { _ncfpAbort = null; }
  }

  function _setStatus(el, text, color) {
    if (!el) return;
    const spin = (color === '#f59e0b' || color === '#3b82f6') ? '<span class="spinner" style="width:10px;height:10px;border-width:2px;margin:0"></span>' : '';
    el.innerHTML = `<span style="font-size:0.65rem;font-weight:800;color:${color};display:flex;align-items:center;gap:4px">${spin}${text}</span>`;
  }

  function parseNCFPHtml(html) {
    const results = [];
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const tables = doc.querySelectorAll('table');
      let targetTable = null;

      for (const t of tables) {
        const txt = (t.textContent || '').toLowerCase();
        if (txt.includes('standard') || txt.includes('rapid') || txt.includes('blitz') || txt.includes('rating')) { targetTable = t; break; }
      }
      if (!targetTable) { for (const t of tables) { if (t.querySelector('tr')?.querySelectorAll('td,th').length >= 4) { targetTable = t; break; } } }
      if (!targetTable) return results;

      // Detect column mapping from headers
      const headers = [];
      const headerRow = targetTable.querySelector('thead tr') || targetTable.querySelector('tr:first-child');
      if (headerRow) headerRow.querySelectorAll('th,td').forEach(c => headers.push((c.textContent || '').trim().toLowerCase()));

      let nI=0, idI=1, sI=2, rI=3, bI=4;
      headers.forEach((h, i) => {
        if (h.includes('name') || h.includes('player')) nI = i;
        else if (h.includes('id') || h.includes('ncfp')) idI = i;
        else if (h.includes('standard') || h.includes('std') || h === 'classic') sI = i;
        else if (h.includes('rapid') || h.includes('rap')) rI = i;
        else if (h.includes('blitz') || h.includes('blz')) bI = i;
      });

      targetTable.querySelectorAll('tbody tr, tr').forEach((row, idx) => {
        if (idx === 0 && row.querySelector('th')) return;
        if (row === headerRow) return;
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) return;
        const name = (cells[nI]?.textContent || '').trim();
        const ncfpId = (cells[idI]?.textContent || '').trim();
        const standard = _pR(cells[sI]);
        const rapid = _pR(cells[rI]);
        const blitz = _pR(cells[bI]);
        if (name && (standard > 0 || rapid > 0 || blitz > 0)) {
          results.push({ name, ncfpId, standard, rapid, blitz, source: 'ncfp', confidence: 'synced' });
        }
      });
    } catch (e) { console.warn('[RatingService] NCFP parse error:', e); }
    return results;
  }

  function _pR(cell) {
    if (!cell) return 0;
    const v = parseInt((cell.textContent || '').trim().replace(/[^0-9]/g, ''), 10);
    return (isNaN(v) || v < 100 || v > 4000) ? 0 : v;
  }

  function renderNcfpPicker(results, container, onSelect) {
    if (!container || !results.length) return;
    container.innerHTML = `<div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:8px;padding:8px;margin-top:6px;max-height:180px;overflow-y:auto">
      <div style="font-size:0.55rem;font-weight:900;color:#3b82f6;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;padding:0 4px">🔵 ${results.length} NCFP matches — select one:</div>
      ${results.map((r, i) => `<div class="ncfp-pick-row" data-idx="${i}" style="display:grid;grid-template-columns:1fr 60px 60px 60px;gap:4px;padding:6px 8px;cursor:pointer;border-radius:4px;font-size:0.75rem;transition:background 0.15s;border-bottom:1px solid rgba(255,255,255,0.03)" onmouseenter="this.style.background='rgba(59,130,246,0.1)'" onmouseleave="this.style.background='transparent'">
        <div><div style="font-weight:700;color:#e2e8f0">${r.name}</div><div style="font-size:0.55rem;color:#475569;font-weight:700">ID: ${r.ncfpId||'—'}</div></div>
        <div style="text-align:center"><div style="font-family:'JetBrains Mono',monospace;font-weight:900;color:${r.standard>0?'#10b981':'#334155'}">${r.standard||'—'}</div><div style="font-size:0.45rem;color:#475569;font-weight:800">STD</div></div>
        <div style="text-align:center"><div style="font-family:'JetBrains Mono',monospace;font-weight:900;color:${r.rapid>0?'#f59e0b':'#334155'}">${r.rapid||'—'}</div><div style="font-size:0.45rem;color:#475569;font-weight:800">RAP</div></div>
        <div style="text-align:center"><div style="font-family:'JetBrains Mono',monospace;font-weight:900;color:${r.blitz>0?'#a855f7':'#334155'}">${r.blitz||'—'}</div><div style="font-size:0.45rem;color:#475569;font-weight:800">BLZ</div></div>
      </div>`).join('')}
    </div>`;
    container.querySelectorAll('.ncfp-pick-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.idx);
        if (onSelect && results[idx]) onSelect(results[idx]);
        container.innerHTML = `<span style="font-size:0.6rem;font-weight:900;color:#10b981">✓ Selected: ${results[idx].name}</span>`;
      });
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // UNIFIED SEARCH
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * Search all providers in parallel.
   * @param {string} query
   * @param {Object} opts - { providers: ['fide','ncfp','local'], limit: 20 }
   * @returns {{ fide: [], ncfp: [], local: [] }}
   */
  async function search(query, opts = {}) {
    const providers = opts.providers || ['fide', 'ncfp'];
    const limit = opts.limit || 20;
    const result = { fide: [], ncfp: [], local: [] };

    const promises = [];

    if (providers.includes('fide')) {
      promises.push(
        searchFIDE(query, limit)
          .then(r => { result.fide = r; })
          .catch(() => {})
      );
    }

    if (providers.includes('ncfp')) {
      promises.push(
        searchNCFP(query)
          .then(r => { result.ncfp = r; })
          .catch(() => {})
      );
    }

    if (providers.includes('local') && typeof db !== 'undefined') {
      promises.push(
        searchLocal(query, limit)
          .then(r => { result.local = r; })
          .catch(() => {})
      );
    }

    await Promise.allSettled(promises);
    return result;
  }

  async function searchLocal(query, limit = 20) {
    try {
      const clubId = window.TenantManager?.getClubId?.();
      if (!clubId) return [];

      const snap = await db.collection('clubs').doc(clubId).collection('members').get();
      const q = query.toLowerCase();
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(m => (m.name || '').toLowerCase().includes(q))
        .slice(0, limit)
        .map(m => ({
          id: m.id,
          name: m.name,
          rating: m.ratings?.club || m.ratings?.fide || 0,
          fideId: m.fideId || '',
          source: 'local',
          confidence: 'manual',
        }));
    } catch (e) {
      return [];
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RATING SNAPSHOT (Tournament Integrity)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * Create an immutable rating snapshot for tournament registration.
   * This snapshot is what the pairing engine MUST use.
   *
   * @param {Object} player - Player data from any provider
   * @param {string} source - 'fide' | 'ncfp' | 'manual'
   * @returns {Object} Frozen snapshot object
   */
  function createSnapshot(player, source = 'manual') {
    const snapshot = {
      // Identity
      name: player.name || '',
      fideid: player.fideid || player.fideId || '',
      ncfpId: player.ncfpId || '',

      // Ratings at time of registration
      fideRating: player.rating || player.fideRating || 0,
      ncfpStandard: player.standard || player.ncfpStandard || 0,
      ncfpRapid: player.rapid || player.ncfpRapid || 0,
      ncfpBlitz: player.blitz || player.ncfpBlitz || 0,
      clubRating: player.clubRating || player.ratings?.club || 0,

      // Metadata
      source: source,
      confidence: player.confidence || (source === 'manual' ? 'manual' : 'synced'),
      snapshotAt: Date.now(),
      snapshotDate: new Date().toISOString(),

      // Derived: selected rating for pairing
      selectedRating: 0,
    };

    // Determine the "selected" rating based on priority
    // FIDE > NCFP Standard > Club > 0
    snapshot.selectedRating =
      snapshot.fideRating ||
      snapshot.ncfpStandard ||
      snapshot.clubRating ||
      0;

    return Object.freeze(snapshot);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CONFIDENCE BADGES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function getConfidenceBadge(source) {
    switch (source) {
      case 'fide':   return { icon: '🟢', label: 'FIDE Synced',  color: '#10b981' };
      case 'ncfp':   return { icon: '🔵', label: 'NCFP Synced',  color: '#3b82f6' };
      case 'manual': return { icon: '⚪', label: 'Manual Entry', color: '#64748b' };
      default:       return { icon: '⚪', label: 'Unknown',      color: '#475569' };
    }
  }

  function renderConfidenceBadge(source) {
    const b = getConfidenceBadge(source);
    return `<span style="font-size:0.6rem;font-weight:900;color:${b.color};display:inline-flex;align-items:center;gap:3px">${b.icon} ${b.label}</span>`;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CACHE MANAGEMENT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async function clearCache() {
    _manifest = null;
    for (const key in _memCache) delete _memCache[key];
    for (const key in _pendingFetches) delete _pendingFetches[key];

    try {
      const db = await openDB();
      if (!db) return;
      const tx = db.transaction(CONFIG.storeName, 'readwrite');
      tx.objectStore(CONFIG.storeName).clear();
    } catch (e) {
      console.warn('[RatingService] Cache clear failed:', e);
    }
  }

  async function getCacheStats() {
    const manifest = await loadManifest();
    return {
      manifestLoaded: !!manifest,
      totalPlayers: manifest?.totalPlayers || 0,
      totalChunks: manifest?.totalChunks || 0,
      cachedChunks: Object.keys(_memCache).filter(k => k.startsWith('chunk_')).length,
      lastSync: manifest?.generated || null,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CONFIGURATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function configure(opts) {
    if (opts.driveBaseUrl) CONFIG.driveBaseUrl = opts.driveBaseUrl;
    if (opts.ncfpProxyUrl) CONFIG.ncfpProxyUrl = opts.ncfpProxyUrl;
    if (opts.ncfpBaseUrl)  CONFIG.ncfpBaseUrl = opts.ncfpBaseUrl;
    if (opts.cacheTTL)     CONFIG.cacheTTL = opts.cacheTTL;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLIC API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    // Configuration
    configure,

    // Search
    search,
    searchFIDE,
    searchNCFP,
    searchLocal,
    lookupFIDE,

    // Snapshot
    createSnapshot,

    // UI Helpers
    getConfidenceBadge,
    renderConfidenceBadge,
    renderNcfpPicker,

    // Cache
    clearCache,
    getCacheStats,
    loadManifest,
    activateMemoryFallbackMode,
    runAutomatedCachePurge,
  };
})();

window.RatingService = RatingService;
