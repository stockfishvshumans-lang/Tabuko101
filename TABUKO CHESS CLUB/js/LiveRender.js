/**
 * LiveRender.js — GPU-Accelerated Virtual Element Patching Framework
 * Day 198 Sprint: Native element-level tree diffing replaces full innerHTML rewrites.
 * Smooth animations on projector displays without layout jumping.
 * Day 261 & 268 & 293: Flicker-free DOM updates via element-level diffing.
 *
 * Architecture:
 *   New standings data → keyed tree diff → patch only changed nodes
 *   → CSS transform: translate3d() for GPU-accelerated animations
 *   → Auto-focus on updated boards for venue projectors
 *
 * @version 2.0.0 — Day 198/261/268/293 Sprint
 */
const LiveRender = (() => {
  'use strict';

  let _autoScrollInterval = null;
  let _autoScrollSpeed = 40;
  let _autoScrollPaused = false;

  // Day 261/263: Viewport cache — read once on init, updated on resize
  // Prevents calculateOptimalSignageGrid from triggering layout reflow mid-render
  const _vpCache = {
    w: typeof window !== 'undefined' ? window.innerWidth  : 1920,
    h: typeof window !== 'undefined' ? window.innerHeight : 1080
  };
  if (typeof window !== 'undefined') {
    let _vpResizeTimer = null;
    window.addEventListener('resize', () => {
      // Debounce — only update cache when resize settles (16ms = 1 frame)
      clearTimeout(_vpResizeTimer);
      _vpResizeTimer = setTimeout(() => {
        _vpCache.w = window.innerWidth;
        _vpCache.h = window.innerHeight;
      }, 16);
    }, { passive: true });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DAY 198: NATIVE ELEMENT-LEVEL TREE DIFFING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /**
   * patchElement: Applies minimal DOM mutations via native tree diffing.
   * NO full innerHTML rewrites — compares nodes attribute-by-attribute
   * and text-node-by-text-node to prevent layout jumps on projector displays.
   */
  function patchElement(containerEl, newHtml) {
    if (!containerEl) return;

    // Build virtual new tree in a detached container
    const vNew = document.createElement('div');
    vNew.innerHTML = newHtml;

    // Day 198: Native keyed tree diff — no innerHTML wholesale replacement
    _diffChildren(containerEl, vNew);
  }

  /**
   * _diffChildren: Recursively diff old vs new children, patching in-place.
   * Key: data-id, data-player-id, data-board attributes for stable matching.
   */
  function _diffChildren(oldParent, newParent) {
    const oldKids = [...oldParent.childNodes];
    const newKids = [...newParent.childNodes];

    // Build keyed index from old children
    const oldKeyMap = new Map();
    oldKids.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const key = node.dataset?.id || node.dataset?.playerId || node.dataset?.board || node.dataset?.rank;
        if (key) oldKeyMap.set(key, node);
      }
    });

    let oldCursor = 0;
    newKids.forEach((newNode, i) => {
      if (newNode.nodeType === Node.TEXT_NODE) {
        // Text node diff
        const oldText = oldKids[oldCursor];
        if (oldText && oldText.nodeType === Node.TEXT_NODE) {
          if (oldText.textContent !== newNode.textContent) {
            oldText.textContent = newNode.textContent;
          }
          oldCursor++;
        } else {
          oldParent.insertBefore(newNode.cloneNode(true), oldKids[oldCursor] || null);
        }
        return;
      }

      if (newNode.nodeType !== Node.ELEMENT_NODE) return;

      // Try keyed match first
      const newKey = newNode.dataset?.id || newNode.dataset?.playerId || newNode.dataset?.board || newNode.dataset?.rank;
      let matchedOld = newKey ? oldKeyMap.get(newKey) : null;

      if (matchedOld) {
        // Patch attributes + recurse into children
        _patchAttributes(matchedOld, newNode);
        _diffChildren(matchedOld, newNode);

        // Move to correct position if needed
        const expectedSibling = oldParent.childNodes[i] || null;
        if (matchedOld !== expectedSibling) {
          oldParent.insertBefore(matchedOld, expectedSibling);
          // GPU-accelerate the repositioned element
          matchedOld.style.transform = 'translate3d(0,0,0)';
          matchedOld.classList.add('live-updated');
          setTimeout(() => matchedOld.classList.remove('live-updated'), 1500);
        }
        oldKeyMap.delete(newKey);
        oldCursor++;
      } else {
        // No key match — try positional match
        const oldNode = oldKids[oldCursor];
        if (oldNode && oldNode.nodeType === Node.ELEMENT_NODE && oldNode.tagName === newNode.tagName) {
          _patchAttributes(oldNode, newNode);
          _diffChildren(oldNode, newNode);
          oldCursor++;
        } else {
          // Insert new node with entrance animation
          const clone = newNode.cloneNode(true);
          clone.style.cssText += ';opacity:0;transform:translate3d(20px,0,0);will-change:transform,opacity;';
          oldParent.insertBefore(clone, oldNode || null);
          requestAnimationFrame(() => {
            clone.style.transition = 'transform 0.35s ease, opacity 0.35s ease';
            clone.style.transform  = 'translate3d(0,0,0)';
            clone.style.opacity    = '1';
          });
        }
      }
    });

    // Remove leftover unmatched old nodes
    for (const [, stale] of oldKeyMap) {
      stale.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      stale.style.opacity    = '0';
      stale.style.transform  = 'translate3d(-20px,0,0)';
      setTimeout(() => stale.remove(), 260);
    }

    // Remove excess positional nodes
    while (oldParent.childNodes.length > newParent.childNodes.length) {
      const excess = oldParent.lastChild;
      if (excess) oldParent.removeChild(excess);
    }
  }

  function _patchAttributes(oldEl, newEl) {
    // Add / update attributes
    for (const attr of newEl.attributes) {
      if (oldEl.getAttribute(attr.name) !== attr.value) {
        oldEl.setAttribute(attr.name, attr.value);
      }
    }
    // Remove attributes no longer present
    for (const attr of [...oldEl.attributes]) {
      if (!newEl.hasAttribute(attr.name)) oldEl.removeAttribute(attr.name);
    }
    // Patch class list only if changed
    if (oldEl.className !== newEl.className) {
      oldEl.className = newEl.className;
    }
  }



  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LEADERBOARD PATCH — GPU-Accelerated Position Updates
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function patchLeaderboard(containerId, standings) {
    const container = document.getElementById(containerId);
    if (!container || !Array.isArray(standings)) return;

    const existingRows = container.querySelectorAll('[data-player-id]');
    const existingMap = new Map();
    existingRows.forEach(row => {
      existingMap.set(row.dataset.playerId, row);
    });

    standings.forEach((player, index) => {
      const rank = index + 1;
      const playerId = player.id || player.playerId || `p_${index}`;
      const existingRow = existingMap.get(playerId);

      if (existingRow) {
        // Update in place with GPU animation
        const oldRank = parseInt(existingRow.dataset.rank || '0');
        const scoreEl = existingRow.querySelector('.standings-pts, .pts');
        const rankEl = existingRow.querySelector('.standings-rank, .rank');

        if (scoreEl) scoreEl.textContent = parseFloat(player.score || 0).toFixed(1);
        if (rankEl) rankEl.textContent = rank;

        // Animate position change
        if (oldRank !== rank) {
          const direction = rank < oldRank ? -1 : 1;
          existingRow.style.transform = `translate3d(0, ${direction * 20}px, 0)`;
          existingRow.style.transition = 'none';

          requestAnimationFrame(() => {
            existingRow.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
            existingRow.style.transform = 'translate3d(0, 0, 0)';
          });

          existingRow.classList.add('rank-changed');
          setTimeout(() => existingRow.classList.remove('rank-changed'), 2000);
        }

        existingRow.dataset.rank = rank;
        existingMap.delete(playerId);
      } else {
        // New player — create and animate in
        const row = document.createElement('div');
        row.className = 'tv-standings-row gpu-animated';
        row.dataset.playerId = playerId;
        row.dataset.rank = rank;
        row.style.transform = 'translate3d(100px, 0, 0)';
        row.style.opacity = '0';
        row.innerHTML = `
          <div class="standings-rank">${rank}</div>
          <div class="standings-name">${player.name || 'Unknown'}</div>
          <div class="standings-pts">${parseFloat(player.score || 0).toFixed(1)}</div>
        `;
        container.appendChild(row);

        requestAnimationFrame(() => {
          row.style.transition = 'transform 0.5s ease, opacity 0.5s ease';
          row.style.transform = 'translate3d(0, 0, 0)';
          row.style.opacity = '1';
        });
      }
    });

    // Remove players no longer in standings
    for (const [, row] of existingMap) {
      row.style.transition = 'opacity 0.3s ease';
      row.style.opacity = '0';
      setTimeout(() => row.remove(), 300);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // AUTO-FOCUS ACTIVE BOARD (Day 261)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function autoFocusUpdatedBoard(boardElement) {
    if (!boardElement) return;

    // Scale animation
    boardElement.style.transition = 'transform 0.4s ease, box-shadow 0.4s ease';
    boardElement.style.transform = 'scale(1.03) translate3d(0, 0, 0)';
    boardElement.style.boxShadow = '0 0 20px rgba(0, 242, 255, 0.3)';

    // Scroll into view smoothly
    boardElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Reset after animation
    setTimeout(() => {
      boardElement.style.transform = 'scale(1) translate3d(0, 0, 0)';
      boardElement.style.boxShadow = '';
    }, 3000);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // AUTO-SCALING DISPLAY GRID (Day 268/293)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Day 261: calculateOptimalSignageGrid reads from _vpCache — zero layout reflow
  // Wrapped results are rAF-safe; caller may batch inside requestAnimationFrame.
  function calculateOptimalSignageGrid(totalItems) {
    // Use cached dimensions — NEVER call window.innerWidth inside a render loop
    const vw = _vpCache.w;
    const vh = _vpCache.h;
    const aspect = vw / vh;

    let columns = 1;
    if (totalItems > 30 && aspect > 1.5) columns = 3;
    else if (totalItems > 12) columns = 2;

    const rowsPerColumn = Math.ceil(totalItems / columns);
    const rowHeight = Math.max(36, Math.floor((vh * 0.85) / rowsPerColumn));
    const fontSize  = Math.max(12, Math.min(32, Math.floor(rowHeight * 0.4)));

    return { columns, rowsPerColumn, rowHeight, fontSize, viewportWidth: vw, viewportHeight: vh };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NON-BLOCKING AUTO-SCROLL (Day 268/293)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function startAutoScroll(containerId, speed = 1) {
    const container = document.getElementById(containerId);
    if (!container) return;

    _autoScrollSpeed = speed;
    stopAutoScroll();

    _autoScrollInterval = setInterval(() => {
      if (_autoScrollPaused) return;

      container.scrollTop += _autoScrollSpeed;

      // Reset to top when reaching bottom
      if (container.scrollTop >= container.scrollHeight - container.clientHeight) {
        setTimeout(() => {
          container.scrollTop = 0;
        }, 3000); // Pause 3s at bottom before resetting
        _autoScrollPaused = true;
        setTimeout(() => { _autoScrollPaused = false; }, 4000);
      }
    }, 50);
  }

  function stopAutoScroll() {
    if (_autoScrollInterval) {
      clearInterval(_autoScrollInterval);
      _autoScrollInterval = null;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // INJECT GPU ANIMATION STYLES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function injectRenderStyles() {
    if (document.getElementById('live-render-styles')) return;
    const style = document.createElement('style');
    style.id = 'live-render-styles';
    style.textContent = `
      .gpu-animated { will-change: transform, opacity; transform: translate3d(0, 0, 0); }
      .live-updated { animation: live-highlight 1.5s ease; }
      .rank-changed { animation: rank-shift 0.8s ease; }
      @keyframes live-highlight {
        0% { background: rgba(0, 242, 255, 0.15); }
        100% { background: transparent; }
      }
      @keyframes rank-shift {
        0% { border-left-color: #f59e0b; }
        50% { border-left-color: #10b981; }
        100% { border-left-color: var(--accent-primary, #a855f7); }
      }
    `;
    document.head.appendChild(style);
  }

  // Auto-inject styles
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectRenderStyles);
    } else {
      injectRenderStyles();
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLIC API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    patchElement,
    patchLeaderboard,
    autoFocusUpdatedBoard,
    calculateOptimalSignageGrid,
    startAutoScroll,
    stopAutoScroll,
    injectRenderStyles
  };
})();

window.LiveRender = LiveRender;
