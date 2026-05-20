/**
 * team-logo-modal.js
 * Fullscreen modal for selecting team logos
 */

const TeamLogoModal = (() => {
  let _activeCallback = null;
  let _currentFilter = 'all';
  let _searchQuery = '';

  function open(currentLogoId, onSelectCallback) {
    _activeCallback = onSelectCallback;
    _currentFilter = 'all';
    _searchQuery = '';

    const overlay = document.createElement('div');
    overlay.id = 'team-logo-modal-overlay';
    overlay.innerHTML = `
      <style>
        #team-logo-modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.85);
          backdrop-filter: blur(10px); z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Inter', sans-serif;
        }
        .tlm-box {
          width: 90vw; height: 90vh; max-width: 1200px;
          background: #0f172a; border: 1px solid #334155;
          border-radius: 12px; display: flex; flex-direction: column;
          overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
        }
        .tlm-header {
          padding: 1.5rem; border-bottom: 1px solid #1e293b;
          display: flex; justify-content: space-between; align-items: center;
          background: #020617;
        }
        .tlm-title { font-weight: 900; font-size: 1.5rem; color: #fff; letter-spacing: -0.5px; }
        .tlm-title span { color: #3b82f6; }
        .tlm-close {
          background: none; border: none; color: #64748b;
          font-size: 2rem; cursor: pointer; line-height: 1;
        }
        .tlm-close:hover { color: #fff; }
        
        .tlm-controls {
          padding: 1rem 1.5rem; background: #0f172a; border-bottom: 1px solid #1e293b;
          display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
        }
        .tlm-search {
          flex: 1; min-width: 200px; background: #020617;
          border: 1px solid #334155; color: #fff; padding: 0.75rem 1rem;
          border-radius: 8px; outline: none; font-weight: 600;
        }
        .tlm-search:focus { border-color: #3b82f6; }
        .tlm-filter {
          background: #1e293b; border: 1px solid #334155; color: #cbd5e1;
          padding: 0.5rem 1rem; border-radius: 20px; cursor: pointer;
          font-weight: 700; font-size: 0.8rem; text-transform: uppercase;
          transition: 0.2s;
        }
        .tlm-filter:hover { background: #334155; color: #fff; }
        .tlm-filter.active { background: #3b82f6; color: #fff; border-color: #3b82f6; }

        .tlm-grid {
          flex: 1; padding: 1.5rem; overflow-y: auto;
          display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 1.5rem;
        }
        
        .tlm-card {
          background: #020617; border: 1px solid #1e293b;
          border-radius: 8px; padding: 1rem; cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex; flex-direction: column; align-items: center;
          position: relative; overflow: hidden;
        }
        .tlm-card:hover {
          transform: translateY(-5px); border-color: #3b82f6;
          box-shadow: 0 10px 25px -5px rgba(59,130,246,0.2);
        }
        .tlm-card.selected {
          border-color: #10b981; background: rgba(16,185,129,0.05);
        }
        .tlm-logo-wrap {
          width: 80px; height: 80px; margin-bottom: 1rem;
          display: flex; align-items: center; justify-content: center;
        }
        .tlm-logo-wrap svg { width: 100%; height: 100%; }
        .tlm-name {
          font-weight: 800; font-size: 0.75rem; color: #e2e8f0;
          text-align: center; width: 100%; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
        }
        .tlm-cat {
          font-size: 0.55rem; color: #64748b; text-transform: uppercase;
          font-weight: 900; letter-spacing: 1px; margin-top: 4px;
        }
        .tlm-rarity {
          position: absolute; top: 0; right: 0;
          width: 20px; height: 20px;
          border-bottom-left-radius: 8px;
        }
        .tlm-rarity.legendary { background: #eab308; }
        .tlm-rarity.epic { background: #a855f7; }
        .tlm-rarity.rare { background: #3b82f6; }
      </style>
      <div class="tlm-box">
        <div class="tlm-header">
          <div class="tlm-title">TEAM IDENTITY <span>SYSTEM</span></div>
          <button class="tlm-close" id="tlm-close-btn">&times;</button>
        </div>
        <div class="tlm-controls">
          <input type="text" class="tlm-search" id="tlm-search" placeholder="Search team identities...">
          <button class="tlm-filter active" data-cat="all">All</button>
          <button class="tlm-filter" data-cat="tactical">Tactical</button>
          <button class="tlm-filter" data-cat="esports">Esports</button>
          <button class="tlm-filter" data-cat="neon">Neon</button>
          <button class="tlm-filter" data-cat="academic">Academic</button>
          <button class="tlm-filter" data-cat="philippine">Philippine</button>
        </div>
        <div class="tlm-grid" id="tlm-grid"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('tlm-close-btn').onclick = close;
    
    document.getElementById('tlm-search').addEventListener('input', (e) => {
      _searchQuery = e.target.value.toLowerCase();
      renderGrid(currentLogoId);
    });

    document.querySelectorAll('.tlm-filter').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tlm-filter').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        _currentFilter = e.target.dataset.cat;
        renderGrid(currentLogoId);
      });
    });

    renderGrid(currentLogoId);
  }

  function renderGrid(currentLogoId) {
    const grid = document.getElementById('tlm-grid');
    const logos = window.LogoLibrary.getLogos();
    
    const filtered = logos.filter(l => {
      const matchCat = _currentFilter === 'all' || l.category === _currentFilter;
      const matchSearch = l.name.toLowerCase().includes(_searchQuery) || l.id.includes(_searchQuery);
      return matchCat && matchSearch;
    });

    grid.innerHTML = filtered.map(l => `
      <div class="tlm-card ${l.id === currentLogoId ? 'selected' : ''}" data-id="${l.id}">
        ${l.rarity !== 'common' ? `<div class="tlm-rarity ${l.rarity}"></div>` : ''}
        <div class="tlm-logo-wrap">${l.svg}</div>
        <div class="tlm-name">${l.name}</div>
        <div class="tlm-cat">${l.category}</div>
      </div>
    `).join('');

    grid.querySelectorAll('.tlm-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const logo = window.LogoLibrary.getLogoById(id);
        if (_activeCallback && logo) {
          _activeCallback(logo);
        }
        close();
      });
    });
  }

  function close() {
    const el = document.getElementById('team-logo-modal-overlay');
    if (el) el.remove();
  }

  return { open, close };
})();

window.TeamLogoModal = TeamLogoModal;
