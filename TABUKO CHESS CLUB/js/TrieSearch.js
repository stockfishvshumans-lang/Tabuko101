/**
 * TrieSearch.js — In-Memory Prefix Trie Fuzzy Parser & Registry Lookup Engine
 * Day 259 & 271 & 296: Character-level trie for instant player name searches.
 *
 * Architecture:
 *   Player registry → Trie.insert(name, playerObj)
 *   Search input → Trie.search(prefix) → sorted results (0ms lookups)
 *
 * @version 1.0.0 — Day 259/271/296 Sprint
 */
const TrieSearch = (() => {
  'use strict';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TRIE NODE STRUCTURE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  class TrieNode {
    constructor() {
      this.children = {};
      this.entries = []; // Player objects stored at terminal nodes
      this.isTerminal = false;
    }
  }

  let _root = new TrieNode();
  let _totalEntries = 0;
  let _buildTime = 0;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // INSERT — Add Player to Trie
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function insert(name, playerObj) {
    if (!name || typeof name !== 'string') return;

    const normalizedName = name.trim().toLowerCase().replace(/[^a-z0-9\s\-\.]/g, '');
    let node = _root;

    for (const char of normalizedName) {
      if (!node.children[char]) {
        node.children[char] = new TrieNode();
      }
      node = node.children[char];
    }

    node.isTerminal = true;
    node.entries.push(playerObj);
    _totalEntries++;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SEARCH — Prefix Lookup
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function search(prefix, maxResults = 20) {
    if (!prefix || typeof prefix !== 'string' || prefix.length < 1) return [];

    const normalizedPrefix = prefix.trim().toLowerCase().replace(/[^a-z0-9\s\-\.]/g, '');
    let node = _root;

    // Traverse to prefix endpoint
    for (const char of normalizedPrefix) {
      if (!node.children[char]) return []; // No match
      node = node.children[char];
    }

    // Collect all entries under this prefix
    const results = [];
    collectEntries(node, results, maxResults);

    return results;
  }

  function collectEntries(node, results, maxResults) {
    if (results.length >= maxResults) return;

    if (node.isTerminal) {
      for (const entry of node.entries) {
        if (results.length >= maxResults) return;
        results.push(entry);
      }
    }

    // DFS through children (alphabetical order)
    const sortedKeys = Object.keys(node.children).sort();
    for (const key of sortedKeys) {
      if (results.length >= maxResults) return;
      collectEntries(node.children[key], results, maxResults);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FUZZY SEARCH — Levenshtein Distance Matching
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function fuzzySearch(query, maxResults = 15, maxDistance = 2) {
    if (!query || query.length < 2) return [];

    const normalizedQuery = query.trim().toLowerCase();
    const candidates = [];

    // Collect all terminal entries
    const allEntries = [];
    collectEntries(_root, allEntries, 5000);

    for (const entry of allEntries) {
      const entryName = (entry.name || '').toLowerCase();
      const distance = levenshteinDistance(normalizedQuery, entryName.substring(0, normalizedQuery.length + 2));

      if (distance <= maxDistance || entryName.includes(normalizedQuery)) {
        candidates.push({ ...entry, _fuzzyScore: distance });
      }
    }

    // Sort by relevance (lower distance = better match)
    candidates.sort((a, b) => a._fuzzyScore - b._fuzzyScore);
    return candidates.slice(0, maxResults);
  }

  function levenshteinDistance(s1, s2) {
    const len1 = s1.length, len2 = s2.length;
    const dp = Array.from({ length: len1 + 1 }, () => new Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) dp[i][0] = i;
    for (let j = 0; j <= len2; j++) dp[0][j] = j;

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // deletion
          dp[i][j - 1] + 1,     // insertion
          dp[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return dp[len1][len2];
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BATCH BUILD — Load Entire Registry
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function buildFromRegistry(players) {
    const t0 = performance.now();
    _root = new TrieNode();
    _totalEntries = 0;

    (players || []).forEach(p => {
      if (!p.name) return;

      // Insert by full name
      insert(p.name, {
        id: p.id || p.fideid || '',
        name: p.name,
        rating: p.rating || p.selectedRating || p.fideRating || 0,
        country: p.country || p.federation || '',
        title: p.title || '',
        source: p.source || 'local'
      });

      // Also insert by last name (for "Carlsen" → "Carlsen, Magnus")
      const nameParts = p.name.split(/[,\s]+/);
      if (nameParts.length > 1) {
        const lastName = nameParts[nameParts.length - 1];
        if (lastName.length >= 2) {
          insert(lastName, {
            id: p.id || p.fideid || '',
            name: p.name,
            rating: p.rating || p.selectedRating || p.fideRating || 0,
            country: p.country || p.federation || '',
            title: p.title || '',
            source: p.source || 'local'
          });
        }
      }
    });

    _buildTime = performance.now() - t0;
    console.log(`[TrieSearch] Index built: ${_totalEntries} entries in ${_buildTime.toFixed(2)}ms`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PREDICTIVE SEARCH SUGGESTION UI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function attachPredictiveSearch(inputId, onSelect) {
    const input = document.getElementById(inputId);
    if (!input) return;

    // Create dropdown container
    let dropdown = document.getElementById(`${inputId}-trie-suggestions`);
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = `${inputId}-trie-suggestions`;
      dropdown.style.cssText = `
        position:absolute;z-index:9999;background:rgba(15,23,42,0.98);
        border:1px solid rgba(0,242,255,0.15);border-radius:8px;
        max-height:220px;overflow-y:auto;width:100%;display:none;
        box-shadow:0 8px 32px rgba(0,0,0,0.6);margin-top:2px;
      `;
      input.parentElement.style.position = 'relative';
      input.parentElement.appendChild(dropdown);
    }

    let debounceTimer = null;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const query = input.value.trim();
        if (query.length < 1) {
          dropdown.style.display = 'none';
          return;
        }

        // Try exact prefix first, then fuzzy
        let results = search(query, 10);
        if (results.length === 0 && query.length >= 2) {
          results = fuzzySearch(query, 10);
        }

        if (results.length === 0) {
          dropdown.style.display = 'none';
          return;
        }

        dropdown.style.display = 'block';
        dropdown.innerHTML = results.map((r, i) => `
          <div data-idx="${i}" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.03);transition:background 0.15s;font-family:'Inter',sans-serif;"
            onmouseenter="this.style.background='rgba(0,242,255,0.08)'"
            onmouseleave="this.style.background='transparent'">
            <div>
              <div style="font-size:0.75rem;font-weight:700;color:#e2e8f0;">${highlightMatch(r.name, query)}</div>
              <div style="font-size:0.55rem;color:#475569;">${r.country || ''} ${r.title ? `• ${r.title}` : ''} ${r.source ? `• ${r.source.toUpperCase()}` : ''}</div>
            </div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:900;color:${r.rating > 2000 ? '#10b981' : r.rating > 1600 ? '#f59e0b' : '#64748b'};">
              ${r.rating || '—'}
            </div>
          </div>
        `).join('');

        dropdown.querySelectorAll('[data-idx]').forEach(row => {
          row.addEventListener('click', () => {
            const idx = parseInt(row.dataset.idx);
            if (results[idx] && typeof onSelect === 'function') {
              onSelect(results[idx]);
              input.value = results[idx].name;
              dropdown.style.display = 'none';
            }
          });
        });
      }, 120); // 120ms debounce
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  }

  function highlightMatch(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return text.substring(0, idx) +
      `<span style="color:#00f2ff;font-weight:900;">${text.substring(idx, idx + query.length)}</span>` +
      text.substring(idx + query.length);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLIC API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    insert,
    search,
    fuzzySearch,
    buildFromRegistry,
    attachPredictiveSearch,
    getStats: () => ({ totalEntries: _totalEntries, buildTimeMs: _buildTime }),
    clear: () => { _root = new TrieNode(); _totalEntries = 0; }
  };
})();

window.TrieSearch = TrieSearch;
