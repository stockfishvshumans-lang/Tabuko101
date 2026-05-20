/**
 * PlayerRegistryService.js — Triple-Provider Search & Lazy Cache Engine
 * =====================================================================
 * Aggregates: 2700chess (live), NCFP (national), FIDE chunks (offline), Firestore (local)
 * Stores results in global_players collection for instant future lookups.
 */
const PlayerRegistryService = (() => {
  const PROXY = 'https://tabuko-proxy.giradojesster28.workers.dev/?url=';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0';

  // ━━━ PROVIDER A: 2700CHESS LIVE SNIPER ━━━
  async function search2700(query, statusEl) {
    if (!query || query.length < 3) return [];
    _stat(statusEl, '2700chess: searching...', '#a855f7');
    try {
      const sanitizeName = encodeURIComponent(query);
      const fideTarget = `https://2700chess.com/search?q=${sanitizeName}`;
      const fideProxyUrl = `https://tabuko-proxy.giradojesster28.workers.dev/?url=${encodeURIComponent(fideTarget)}`;
      
      const res = await fetch(fideProxyUrl, { 
        headers: { "X-Meta": "N8yu7Pq2Vxz4tLm3!cRw5" },
        signal: AbortSignal.timeout(8000) 
      });
      if (res.status === 429) {
        console.warn('[Scraper Interface Room] Endpoint throttled. Initiating graceful fallback extraction.');
        _stat(statusEl, 'Provider busy: switching to local offline shards...', '#fbbf24');
        return await RatingService.searchLocal(query); // Seamless fallback execution
      }
      if (!res.ok) throw new Error(`${res.status}`);
      // Cloudflare worker proxy might return direct HTML or JSON depending on how it's built
      const text = await res.text();
      let html = text;
      try { const json = JSON.parse(text); if (json.contents) html = json.contents; } catch(e) {}
      
      if (!html) { _stat(statusEl, '2700chess: empty response', '#64748b'); return []; }
      const results = _parse2700(html);
      _stat(statusEl, results.length ? `2700chess: ${results.length} found` : '2700chess: no results', results.length ? '#10b981' : '#64748b');
      return results;
    } catch (e) {
      if (e.name === 'AbortError' || e.name === 'TimeoutError') { 
        _stat(statusEl, 'Connection slow. Switching to local offline shards...', '#fbbf24'); 
        return await RatingService.searchLocal(query); 
      }
      console.warn('[2700chess]', e.message);
      _stat(statusEl, '2700chess: unavailable', '#ef4444');
      return [];
    }
  }

  function _parse2700(html) {
    const results = [];
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      // 2700chess search results: links to player profiles with rating info
      const links = doc.querySelectorAll('a[href*="/players/"]');
      const seen = new Set();
      links.forEach(a => {
        const href = a.getAttribute('href') || '';
        if (seen.has(href)) return;
        seen.add(href);
        const container = a.closest('tr') || a.closest('li') || a.closest('div') || a.parentElement;
        if (!container) return;
        const text = container.textContent || '';
        const name = (a.textContent || '').trim();
        if (!name || name.length < 2) return;
        // Extract FIDE ID from URL: /players/1503014 or similar
        const idMatch = href.match(/\/players\/(\d+)/);
        const fideId = idMatch ? idMatch[1] : '';
        // Extract rating: look for 4-digit number in context
        const ratingMatch = text.match(/\b(1[0-9]{3}|2[0-9]{3}|3[0-9]{3})\b/g);
        let liveRating = 0;
        if (ratingMatch) {
          // Take highest plausible rating
          liveRating = Math.max(...ratingMatch.map(Number).filter(n => n >= 1000 && n <= 3500));
        }
        // Try to extract decimal live rating (e.g., "2841.4")
        const decMatch = text.match(/(\d{4}\.\d)/);
        if (decMatch) liveRating = Math.round(parseFloat(decMatch[1]));
        if (name && (liveRating > 0 || fideId)) {
          results.push({ name, fideid: fideId, liveRating, source: '2700chess', confidence: 'live' });
        }
      });
      // Also try table rows
      if (results.length === 0) {
        doc.querySelectorAll('table tr').forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) return;
          const name = (cells[0]?.textContent || cells[1]?.textContent || '').trim();
          let rating = 0;
          cells.forEach(c => {
            const m = (c.textContent || '').match(/(\d{4}(\.\d)?)/);
            if (m && !rating) rating = Math.round(parseFloat(m[1]));
          });
          if (name && rating > 1000) {
            results.push({ name, fideid: '', liveRating: rating, source: '2700chess', confidence: 'live' });
          }
        });
      }
    } catch (e) { console.warn('[2700chess parse]', e); }
    return results;
  }

  // ━━━ PROVIDER B: NCFP SNIPER ━━━
  async function searchNCFP(query, statusEl) {
    if (!query || query.length < 3) return [];
    _stat(statusEl, 'NCFP: searching...', '#3b82f6');
    try {
      const sanitizeName = encodeURIComponent(query);
      const ncfpTarget = `https://chessportalph.org/ratings?search=${sanitizeName}`;
      const ncfpProxyUrl = `https://tabuko-proxy.giradojesster28.workers.dev/?url=${encodeURIComponent(ncfpTarget)}`;
      
      const res = await fetch(ncfpProxyUrl, { 
        headers: { "X-Meta": "N8yu7Pq2Vxz4tLm3!cRw5" },
        signal: AbortSignal.timeout(8000) 
      });
      if (res.status === 429) {
        console.warn('[Scraper Interface Room] Endpoint throttled. Initiating graceful fallback extraction.');
        _stat(statusEl, 'Provider busy: switching to local offline shards...', '#fbbf24');
        return await RatingService.searchLocal(query); // Seamless fallback execution
      }
      if (!res.ok) throw new Error(`${res.status}`);
      const text = await res.text();
      let html = text;
      try { const json = JSON.parse(text); if (json.contents) html = json.contents; } catch(e) {}

      if (!html) { _stat(statusEl, 'NCFP: empty', '#64748b'); return []; }
      const results = _parseNCFP(html);
      _stat(statusEl, results.length ? `NCFP: ${results.length} found` : 'NCFP: no results', results.length ? '#10b981' : '#64748b');
      return results;
    } catch (e) {
      if (e.name === 'AbortError' || e.name === 'TimeoutError') { 
        _stat(statusEl, 'Connection slow. Switching to local offline shards...', '#fbbf24'); 
        return await RatingService.searchLocal(query); 
      }
      console.warn('[NCFP]', e.message);
      _stat(statusEl, 'NCFP: unavailable', '#ef4444');
      return [];
    }
  }

  function _parseNCFP(html) {
    const results = [];
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const tables = doc.querySelectorAll('table');
      let tbl = null;
      for (const t of tables) {
        const txt = (t.textContent || '').toLowerCase();
        if (txt.includes('standard') || txt.includes('rapid') || txt.includes('blitz') || txt.includes('rating')) { tbl = t; break; }
      }
      if (!tbl) for (const t of tables) { if (t.querySelector('tr')?.querySelectorAll('td,th').length >= 4) { tbl = t; break; } }
      if (!tbl) return results;

      const hdrs = [];
      const hRow = tbl.querySelector('thead tr') || tbl.querySelector('tr:first-child');
      if (hRow) hRow.querySelectorAll('th,td').forEach(c => hdrs.push((c.textContent || '').trim().toLowerCase()));
      let nI=0,idI=1,sI=2,rI=3,bI=4;
      hdrs.forEach((h,i) => {
        if (h.includes('name')||h.includes('player')) nI=i;
        else if (h.includes('id')||h.includes('ncfp')) idI=i;
        else if (h.includes('standard')||h.includes('std')||h==='classic') sI=i;
        else if (h.includes('rapid')||h.includes('rap')) rI=i;
        else if (h.includes('blitz')||h.includes('blz')) bI=i;
      });
      tbl.querySelectorAll('tbody tr, tr').forEach((row,idx) => {
        if (idx===0 && row.querySelector('th')) return;
        if (row===hRow) return;
        const c = row.querySelectorAll('td');
        if (c.length < 3) return;
        const name = (c[nI]?.textContent||'').trim();
        const ncfpId = (c[idI]?.textContent||'').trim();
        const std = _pr(c[sI]), rap = _pr(c[rI]), blz = _pr(c[bI]);
        if (name && (std>0||rap>0||blz>0)) {
          results.push({ name, ncfpId, standard: std, rapid: rap, blitz: blz, source: 'ncfp', confidence: 'synced' });
        }
      });
    } catch (e) { console.warn('[NCFP parse]', e); }
    return results;
  }

  function _pr(cell) {
    if (!cell) return 0;
    const text = (cell.textContent || '').trim().replace(/[^0-9.]/g, '');
    const v = Math.round(parseFloat(text));
    return (isNaN(v) || v < 100 || v > 4000) ? 0 : v;
  }

  // ━━━ PROVIDER C: FIRESTORE LOCAL CACHE ━━━
  async function searchLocal(query, statusEl) {
    _stat(statusEl, 'Local DB: checking...', '#64748b');
    try {
      if (typeof db === 'undefined') return [];
      const snap = await db.collection('global_players').get();
      const q = query.toLowerCase();
      const results = snap.docs
        .map(d => ({id: d.id, ...d.data()}))
        .filter(p => (p.name||'').toLowerCase().includes(q) || (p.fideid||'') === query)
        .slice(0, 20)
        .map(p => ({...p, source: 'local', confidence: p.confidence || 'cached'}));
      _stat(statusEl, results.length ? `Local: ${results.length} cached` : 'Local: no cache', results.length ? '#10b981' : '#64748b');
      return results;
    } catch (e) { return []; }
  }

  // ━━━ TRIPLE-PROVIDER PARALLEL SEARCH ━━━
  async function search(query, opts = {}) {
    // Day 146 Task 2: Minimum Query Character Firewall
    if (!query || query.trim().length < 3) {
      const statusEls = opts.statusEls || {};
      Object.values(statusEls).forEach(el => {
        if (el) el.innerHTML = `<span style="font-size:0.55rem;font-weight:800;color:#ef4444">⚠️ Min 3 chars required</span>`;
      });
      return { chess2700: [], ncfp: [], local: [], merged: [] };
    }

    const statusEls = opts.statusEls || {};
    const result = { chess2700: [], ncfp: [], local: [], merged: [] };

    await Promise.allSettled([
      search2700(query, statusEls.chess2700).then(r => { result.chess2700 = r; }).catch(()=>{}),
      searchNCFP(query, statusEls.ncfp).then(r => { result.ncfp = r; }).catch(()=>{}),
      searchLocal(query, statusEls.local).then(r => { result.local = r; }).catch(()=>{}),
    ]);

    // Merge into unified profiles using FIDE ID as primary key
    result.merged = mergeResults(result);
    return result;
  }

  let _debounceTimeout = null;

  // Day 146 Task 1: Wrap search event handlers inside a strict input debouncer
  function debouncedSearch(query, opts, callback) {
    if (_debounceTimeout) clearTimeout(_debounceTimeout);

    if (!query || query.trim().length < 3) {
      const statusEls = opts.statusEls || {};
      Object.values(statusEls).forEach(el => {
        if (el) el.innerHTML = `<span style="font-size:0.55rem;font-weight:800;color:#ef4444">⚠️ Min 3 chars required</span>`;
      });
      if (typeof callback === 'function') callback({ merged: [] });
      return;
    }

    _debounceTimeout = setTimeout(async () => {
      try {
        const res = await search(query, opts);
        if (typeof callback === 'function') callback(res);
      } catch (err) {
        console.error("[Debounced Search Error]", err);
      }
    }, 300);
  }

  // ━━━ DATA MERGING (FIDE ID = Primary Key) ━━━
  function mergeResults({ chess2700, ncfp, local }) {
    const byFideId = {};
    const byName = {};

    // Priority 1: Local cache
    local.forEach(p => {
      const key = p.fideid || `name:${(p.name||'').toLowerCase()}`;
      byFideId[key] = { ...p };
    });

    // Priority 2: NCFP
    ncfp.forEach(p => {
      const nameKey = `name:${(p.name||'').toLowerCase()}`;
      // Try to match with existing
      let existing = null;
      for (const k in byFideId) {
        if ((byFideId[k].name||'').toLowerCase() === (p.name||'').toLowerCase()) { existing = byFideId[k]; break; }
      }
      if (existing) {
        existing.ncfpId = p.ncfpId || existing.ncfpId;
        existing.ncfpStandard = p.standard || existing.ncfpStandard || 0;
        existing.ncfpRapid = p.rapid || existing.ncfpRapid || 0;
        existing.ncfpBlitz = p.blitz || existing.ncfpBlitz || 0;
        existing.ncfpSynced = true;
      } else {
        byFideId[nameKey] = {
          name: p.name, ncfpId: p.ncfpId,
          ncfpStandard: p.standard, ncfpRapid: p.rapid, ncfpBlitz: p.blitz,
          source: 'ncfp', confidence: 'synced', ncfpSynced: true
        };
      }
    });

    // Priority 3 (HIGHEST for live rating): 2700chess
    chess2700.forEach(p => {
      const key = p.fideid || `name:${(p.name||'').toLowerCase()}`;
      let existing = byFideId[key];
      if (!existing) {
        // Try name match
        for (const k in byFideId) {
          if ((byFideId[k].name||'').toLowerCase() === (p.name||'').toLowerCase()) { existing = byFideId[k]; break; }
        }
      }
      if (existing) {
        existing.fideid = p.fideid || existing.fideid;
        if (p.liveRating > 0) existing.liveRating = p.liveRating;
        existing.chess2700Synced = true;
      } else {
        byFideId[key] = {
          name: p.name, fideid: p.fideid, liveRating: p.liveRating,
          source: '2700chess', confidence: 'live', chess2700Synced: true
        };
      }
    });

    // Build final sorted array
    return Object.values(byFideId).sort((a,b) => {
      const rA = a.liveRating || a.rating || a.ncfpStandard || 0;
      const rB = b.liveRating || b.rating || b.ncfpStandard || 0;
      return rB - rA;
    });
  }

  // ━━━ RATING HIERARCHY ENGINE ━━━
  function selectBestRating(profile) {
    // 1. 2700chess live (most current)
    if (profile.liveRating > 0) return { rating: profile.liveRating, source: '2700chess' };
    // 2. FIDE chunks
    if (profile.rating > 0) return { rating: profile.rating, source: 'fide' };
    // 3. NCFP standard
    if (profile.ncfpStandard > 0) return { rating: profile.ncfpStandard, source: 'ncfp' };
    // 4. Club rating
    if (profile.clubRating > 0) return { rating: profile.clubRating, source: 'local' };
    return { rating: 0, source: 'manual' };
  }

  // ━━━ LAZY CACHE (Save to Firestore) ━━━
  async function saveToGlobalCache(profile) {
    if (typeof db === 'undefined') return;
    
    // Deduplication Key Priority: FIDE ID -> NCFP ID -> Sanitized Name
    let sanitizedName = (profile.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!sanitizedName) sanitizedName = `manual_${Date.now()}`;
    const key = profile.fideid || profile.ncfpId || sanitizedName;
    
    try {
      const best = selectBestRating(profile);
      await db.collection('global_players').doc(key).set({
        name: profile.name || '',
        fideid: profile.fideid || '',
        ncfpId: profile.ncfpId || '',
        rating: best.rating,
        ratingSource: best.source,
        liveRating: profile.liveRating || 0,
        ncfpStandard: profile.ncfpStandard || 0,
        ncfpRapid: profile.ncfpRapid || 0,
        ncfpBlitz: profile.ncfpBlitz || 0,
        title: profile.title || '',
        country: profile.country || '',
        confidence: profile.confidence || 'cached',
        chess2700Synced: profile.chess2700Synced || false,
        ncfpSynced: profile.ncfpSynced || false,
        cachedAt: Date.now(),
        cachedDate: new Date().toISOString(),
      }, { merge: true });
      console.log(`[Registry] Cached: ${profile.name} → ${key}`);
    } catch (e) { console.warn('[Registry] Cache save failed:', e); }
  }

  // ━━━ UI: SYNC STATUS BADGES ━━━
  function renderSyncBadges(profile) {
    const c27 = profile.chess2700Synced;
    const cN = profile.ncfpSynced;
    const cL = profile.source === 'local' || profile.confidence === 'cached';
    return `<div style="display:flex;gap:6px;flex-wrap:wrap">
      <span style="font-size:0.55rem;font-weight:900;padding:2px 7px;border-radius:3px;${c27?'background:rgba(168,85,247,0.1);color:#a855f7;border:1px solid rgba(168,85,247,0.3)':'background:rgba(255,255,255,0.03);color:#334155;border:1px solid rgba(255,255,255,0.05)'}">${c27?'🟢':'⚫'} 2700chess</span>
      <span style="font-size:0.55rem;font-weight:900;padding:2px 7px;border-radius:3px;${cN?'background:rgba(59,130,246,0.1);color:#3b82f6;border:1px solid rgba(59,130,246,0.3)':'background:rgba(255,255,255,0.03);color:#334155;border:1px solid rgba(255,255,255,0.05)'}">${cN?'🔵':'⚫'} NCFP</span>
      <span style="font-size:0.55rem;font-weight:900;padding:2px 7px;border-radius:3px;${cL?'background:rgba(255,255,255,0.05);color:#94a3b8;border:1px solid rgba(255,255,255,0.08)':'background:rgba(255,255,255,0.03);color:#334155;border:1px solid rgba(255,255,255,0.05)'}">${cL?'⚪':'⚫'} Local DB</span>
    </div>`;
  }

  // ━━━ UI: SEARCH RESULTS DROPDOWN ━━━
  function renderSearchResults(merged, container, onSelect) {
    if (!container) return;
    if (!merged.length) { container.innerHTML = '<div style="padding:12px;text-align:center;color:#475569;font-size:0.7rem;font-weight:800">No results found</div>'; return; }
    container.innerHTML = `<div style="background:rgba(15,23,42,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:8px;max-height:240px;overflow-y:auto;margin-top:6px">
      ${merged.map((p, i) => {
        const best = selectBestRating(p);
        return `<div class="prs-row" data-idx="${i}" style="display:grid;grid-template-columns:1fr 70px 1fr;gap:6px;padding:8px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.03);transition:background 0.15s" onmouseenter="this.style.background='rgba(59,130,246,0.08)'" onmouseleave="this.style.background='transparent'">
          <div>
            <div style="font-weight:700;color:#e2e8f0;font-size:0.8rem">${p.name||'?'}</div>
            <div style="font-size:0.5rem;color:#475569;font-weight:700">${p.fideid?'FIDE:'+p.fideid:''}${p.ncfpId?' · NCFP:'+p.ncfpId:''}</div>
          </div>
          <div style="text-align:center">
            <div style="font-family:'JetBrains Mono',monospace;font-weight:900;font-size:0.9rem;color:#fff">${best.rating||'—'}</div>
            <div style="font-size:0.45rem;color:#475569;font-weight:800;text-transform:uppercase">${best.source}</div>
          </div>
          <div style="display:flex;align-items:center;justify-content:flex-end;gap:4px">
            ${p.chess2700Synced?'<span style="font-size:0.5rem;color:#a855f7;font-weight:900">🟢 LIVE</span>':''}
            ${p.ncfpSynced?'<span style="font-size:0.5rem;color:#3b82f6;font-weight:900">🔵 NCFP</span>':''}
            ${p.title?`<span style="font-size:0.5rem;font-weight:900;color:#fbbf24;background:rgba(251,191,36,0.1);padding:1px 4px;border-radius:2px">${p.title}</span>`:''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
    container.querySelectorAll('.prs-row').forEach(row => {
      row.addEventListener('click', async () => {
        const idx = parseInt(row.dataset.idx);
        const player = merged[idx];
        if (!player) return;
        // Save to global cache
        await saveToGlobalCache(player);
        if (onSelect) onSelect(player);
      });
    });
  }

  function _stat(el, text, color) {
    if (!el) return;
    const spin = color === '#3b82f6' || color === '#a855f7' || color === '#64748b' && text.includes('...') ? '<span class="spinner" style="width:8px;height:8px;border-width:1.5px;margin:0"></span>' : '';
    el.innerHTML = `<span style="font-size:0.55rem;font-weight:800;color:${color};display:inline-flex;align-items:center;gap:3px">${spin}${text}</span>`;
  }

  return {
    search, search2700, searchNCFP, searchLocal, debouncedSearch,
    mergeResults, selectBestRating,
    saveToGlobalCache,
    renderSyncBadges, renderSearchResults,
  };
})();

window.PlayerRegistryService = PlayerRegistryService;
