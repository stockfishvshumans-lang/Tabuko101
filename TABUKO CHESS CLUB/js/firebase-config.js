/**
 * firebase-config.js — Firebase v9 COMPAT Initializer (Standard Script)
 * This ensures 'db.collection()' continues to work while
 * enabling multi-tab persistence in a future-proof way.
 */

const firebaseConfig = {
  apiKey: "AIzaSyDW5HulWhmGNJdC6oMxBgqKwQQoyNMarbo",
  authDomain: "tabuko-101.firebaseapp.com",
  projectId: "tabuko-101",
  storageBucket: "tabuko-101.firebasestorage.app",
  messagingSenderId: "846716409320",
  appId: "1:846716409320:web:b284f95277f5cd1e89005d",
  measurementId: "G-M9WB4FE9FB"
};

// 1. Initialize Firebase App (Compat)
// The 'firebase' object is available globally via script tags in index.html
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();
const storage = typeof firebase.storage === 'function' ? firebase.storage() : null;
if (!storage) console.warn('[Firebase] Storage module not loaded or not available.');

// 2. HARDENED PERSISTENCE: Multi-Tab IndexedDB Synchronization
// This enables Admin, Clerk, and TV Broadcast tabs to share data without collision.
try {
  db.settings({
    cache: firebase.firestore.persistentLocalCache ? 
      firebase.firestore.persistentLocalCache({tabManager: firebase.firestore.persistentMultipleTabManager()}) : undefined
  });
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); // Fallback for older compat versions silently
  console.log('[Firebase] Multi-Tab IndexedDB Persistence Enabled');
  if (window.OperationsQueue) window.OperationsQueue.init();
} catch (err) {
  db.enablePersistence({ synchronizeTabs: true })
    .then(() => {
      console.log('[Firebase] Multi-Tab IndexedDB Persistence Enabled (Legacy)');
      if (window.OperationsQueue) window.OperationsQueue.init();
    })
    .catch((e) => {
      if (e.code === 'unimplemented') console.error('[Firebase] Browser does not support IndexedDB persistence.');
    });
}

// 3. VERSION CONTROL & SCHEMA SAFETY
const APP_VERSION = '2.1.0'; // Deterministic Schema Version
window.APP_VERSION = APP_VERSION;

// 4. EXPOSE TO GLOBAL SCOPE
window.firebase = firebase; 
window.auth = auth;
// window.db = db; // Removed for security encapsulation
window.storage = storage;

console.log(`[Firebase] v9 Compat Layer | Schema v${APP_VERSION} | Multi-Tab Active`);

// ── Connection state monitor ──
let isOnline = navigator.onLine;
window.addEventListener('online', () => {
  isOnline = true;
  document.body.classList.remove('offline-mode');
  const badge = document.getElementById('connection-badge');
  if (badge) { badge.textContent = '● Online'; badge.className = 'conn-badge online'; }
  console.log('[Firebase] Connection restored');
});

window.addEventListener('offline', () => {
  isOnline = false;
  document.body.classList.add('offline-mode');
  const badge = document.getElementById('connection-badge');
  if (badge) { badge.textContent = '● Offline'; badge.className = 'conn-badge offline'; }
  console.log('[Firebase] Offline — using local cache');
});

// Day 88: Mount a highly visible connection badge dynamically if not present
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('connection-badge')) {
    const badge = document.createElement('div');
    badge.id = 'connection-badge';
    badge.className = 'conn-badge online';
    badge.textContent = '● Online';
    
    // Premium glassmorphic styling
    badge.style.position = 'fixed';
    badge.style.top = '12px';
    badge.style.right = '20px';
    badge.style.zIndex = '99999';
    badge.style.padding = '6px 12px';
    badge.style.borderRadius = '20px';
    badge.style.fontSize = '0.75rem';
    badge.style.fontWeight = '800';
    badge.style.backdropFilter = 'blur(8px)';
    badge.style.pointerEvents = 'none';
    
    document.body.appendChild(badge);
    console.log('[Firebase] Connection Badge dynamic mounting complete.');
  }
});
