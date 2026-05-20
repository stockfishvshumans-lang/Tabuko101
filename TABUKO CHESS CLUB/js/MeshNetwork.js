/**
 * MeshNetwork.js — Local P2P LAN Discovery & Sync
 * Day 189: Native BroadcastChannel API (same-origin tabs) + WebRTC data channels
 * for floor tablet discovery across local Wi-Fi without external internet.
 * @version 2.0.0 — Day 189
 */
const MeshNetwork = (() => {
  'use strict';

  // ── LOCAL BROADCAST CHANNEL (same-origin tabs) ─
  const _broadcastChannel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('tabuko_venue_mesh') : null;

  const _peers    = new Map();
  let   _nodeId   = crypto.randomUUID();
  let   _venueCode= null;
  let   _isConnected = false;
  let   _heartbeatInterval = null;
  let   _onMutationReceived = null;
  const _rtcPeerConnections = new Map();

  const _metrics = { messagesSent: 0, messagesReceived: 0, peersDiscovered: 0, reconnectAttempts: 0, lastHeartbeat: 0, latencyMap: {} };

  // ── DAY 189: BROADCASTCHANNEL MESH ────────────
  function _initBroadcastMesh(venueCode, onMutation) {
    _venueCode = venueCode || 'default_venue';
    _onMutationReceived = onMutation;

    if (!_broadcastChannel) {
      console.warn('[MeshNetwork] BroadcastChannel unavailable — local mesh disabled.');
      return;
    }

    _broadcastChannel.onmessage = (e) => {
      try {
        const msg = e.data;
        if (!msg || msg.nodeId === _nodeId) return;
        _metrics.messagesReceived++;

        switch (msg.type) {
          case 'PEER_ANNOUNCE':   _registerPeer(msg); break;
          case 'SCORE_MUTATION':
            if (typeof _onMutationReceived === 'function') _onMutationReceived(msg.payload);
            if (window.DistributedEventBus) window.DistributedEventBus.publish('MESH_SCORE_MUTATION', msg.payload);
            break;
          case 'STANDINGS_SYNC':
            if (window.DistributedEventBus) window.DistributedEventBus.publish('MESH_STANDINGS_UPDATE', msg.payload);
            break;
          case 'MESH_HEARTBEAT':  _handleHeartbeat(msg); break;
          case 'PEER_DISCONNECT': _peers.delete(msg.nodeId); break;
          case 'RTC_OFFER':       _handleRTCOffer(msg); break;
          case 'RTC_ANSWER':      _handleRTCAnswer(msg); break;
          case 'RTC_ICE':         _handleRTCIce(msg); break;
        }
      } catch (err) { console.warn('[MeshNetwork] Broadcast parse error:', err.message); }
    };

    _isConnected = true;

    // Announce presence
    _send({ type: 'PEER_ANNOUNCE', nodeId: _nodeId, capabilities: ['SCORE_MUTATION','STANDINGS_SYNC','HEARTBEAT'], venueCode: _venueCode, timestamp: Date.now() });

    // Heartbeat every 5 seconds
    _heartbeatInterval = setInterval(_broadcastHeartbeat, 5000);

    console.log(`[MeshNetwork] BroadcastChannel mesh active — venue:${_venueCode} node:${_nodeId.slice(0,8)}...`);
    if (window.DistributedEventBus) window.DistributedEventBus.publish('MESH_CONNECTED', { venueCode: _venueCode, nodeId: _nodeId });
  }

  function _send(data) {
    if (!_broadcastChannel) return false;
    try {
      _broadcastChannel.postMessage({ ...data, nodeId: _nodeId, venueCode: _venueCode, timestamp: Date.now() });
      _metrics.messagesSent++;
      return true;
    } catch (e) { console.warn('[MeshNetwork] Send failed:', e.message); return false; }
  }

  // ── PEER MANAGEMENT ───────────────────────────
  function _registerPeer(msg) {
    if (msg.nodeId === _nodeId) return;
    _peers.set(msg.nodeId, { nodeId: msg.nodeId, capabilities: msg.capabilities || [], lastSeen: Date.now(), latencyMs: 0, status: 'active' });
    _metrics.peersDiscovered++;
    console.log(`[MeshNetwork] Peer discovered: ${msg.nodeId.slice(0,8)}...`);
  }

  function _broadcastHeartbeat() {
    _metrics.lastHeartbeat = Date.now();
    _send({ type: 'MESH_HEARTBEAT', status: 'ALIVE', peerCount: _peers.size });
    // Prune stale peers
    const now = Date.now();
    for (const [id, peer] of _peers) {
      if (now - peer.lastSeen > 60000) _peers.delete(id);
      else if (now - peer.lastSeen > 30000) peer.status = 'stale';
    }
  }

  function _handleHeartbeat(msg) {
    if (msg.nodeId === _nodeId) return;
    const peer = _peers.get(msg.nodeId);
    if (peer) { peer.lastSeen = Date.now(); peer.latencyMs = Math.max(0, Date.now() - (msg.timestamp || Date.now())); peer.status = 'active'; }
    else _registerPeer(msg);
  }

  // ── DAY 189: WEBRTC DATA CHANNEL PATH ─────────
  function _createRTCPeer(targetNodeId, isInitiator) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    _rtcPeerConnections.set(targetNodeId, pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        _send({ type: 'RTC_ICE', targetNodeId, candidate: e.candidate });
      }
    };

    if (isInitiator) {
      const dc = pc.createDataChannel('tabuko_mesh');
      _setupDataChannel(dc, targetNodeId);
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        _send({ type: 'RTC_OFFER', targetNodeId, offer });
      }).catch(e => console.warn('[MeshNetwork] RTC offer failed:', e.message));
    } else {
      pc.ondatachannel = (e) => _setupDataChannel(e.channel, targetNodeId);
    }
    return pc;
  }

  function _setupDataChannel(dc, peerId) {
    dc.onopen    = () => console.log(`[MeshNetwork] RTC data channel open to ${peerId.slice(0,8)}...`);
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'SCORE_MUTATION' && typeof _onMutationReceived === 'function') _onMutationReceived(msg.payload);
      } catch {}
    };
    dc.onerror   = () => console.warn('[MeshNetwork] RTC data channel error');
    dc.onclose   = () => _rtcPeerConnections.delete(peerId);
  }

  async function _handleRTCOffer(msg) {
    if (msg.targetNodeId && msg.targetNodeId !== _nodeId) return;
    const pc = _createRTCPeer(msg.nodeId, false);
    await pc.setRemoteDescription(msg.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    _send({ type: 'RTC_ANSWER', targetNodeId: msg.nodeId, answer });
  }

  async function _handleRTCAnswer(msg) {
    if (msg.targetNodeId && msg.targetNodeId !== _nodeId) return;
    const pc = _rtcPeerConnections.get(msg.nodeId);
    if (pc) await pc.setRemoteDescription(msg.answer);
  }

  async function _handleRTCIce(msg) {
    if (msg.targetNodeId && msg.targetNodeId !== _nodeId) return;
    const pc = _rtcPeerConnections.get(msg.nodeId);
    if (pc && msg.candidate) await pc.addIceCandidate(msg.candidate).catch(() => {});
  }

  // ── PUBLIC MESH ENTRYPOINTS ───────────────────
  function initializeMeshNode(venueCode, onMutationReceived) {
    _initBroadcastMesh(venueCode, onMutationReceived);
  }

  function broadcastScoreMutation(payload) {
    return _send({ type: 'SCORE_MUTATION', payload: JSON.parse(JSON.stringify(payload)) });
  }

  function broadcastStandingsUpdate(payload) {
    return _send({ type: 'STANDINGS_SYNC', payload: JSON.parse(JSON.stringify(payload)) });
  }

  function initiateRTCConnectionTo(targetNodeId) {
    if (!_rtcPeerConnections.has(targetNodeId)) _createRTCPeer(targetNodeId, true);
  }

  function disconnect() {
    _send({ type: 'PEER_DISCONNECT', nodeId: _nodeId });
    clearInterval(_heartbeatInterval);
    if (_broadcastChannel) _broadcastChannel.close();
    _rtcPeerConnections.forEach(pc => pc.close());
    _rtcPeerConnections.clear();
    _peers.clear();
    _isConnected = false;
    console.log('[MeshNetwork] Disconnected from local mesh.');
  }

  // ── STATUS UI ─────────────────────────────────
  function renderMeshStatusMatrix(containerId = 'mesh-status-root') {
    const root = document.getElementById(containerId);
    if (!root) return;
    const peers       = [..._peers.values()];
    const statusColor = _isConnected ? '#10b981' : '#ef4444';
    root.innerHTML = `
      <div style="background:rgba(15,23,42,0.95);border:1px solid rgba(168,85,247,0.15);border-radius:12px;padding:1rem;font-family:'JetBrains Mono',monospace;color:#e2e8f0;font-size:0.7rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <div style="font-weight:900;font-size:0.65rem;text-transform:uppercase;letter-spacing:2px;color:#a855f7;">🌐 Venue Mesh Network</div>
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};display:inline-block;"></span>
            <span style="font-size:0.55rem;color:${statusColor};font-weight:900;">${_isConnected ? 'MESH ACTIVE' : 'DISCONNECTED'}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-bottom:0.75rem;">
          ${[['PEERS',_peers.size,'#a855f7'],['SENT',_metrics.messagesSent,'#10b981'],['RECV',_metrics.messagesReceived,'#3b82f6'],['RTC',_rtcPeerConnections.size,'#f59e0b']].map(([label,val,color]) => `
          <div style="background:rgba(0,0,0,0.3);padding:0.4rem;border-radius:6px;text-align:center;">
            <div style="font-size:1rem;font-weight:900;color:${color};">${val}</div>
            <div style="font-size:0.45rem;color:#64748b;font-weight:800;">${label}</div>
          </div>`).join('')}
        </div>
        ${peers.length ? peers.map(p => `<div style="display:grid;grid-template-columns:20px 1fr 60px;gap:4px;padding:3px 0;font-size:0.55rem;border-bottom:1px solid rgba(255,255,255,0.03);">
          <span>${p.status === 'active' ? '🟢' : '🟡'}</span>
          <span style="color:#94a3b8;">${p.nodeId.slice(0,14)}...</span>
          <span style="color:${p.latencyMs < 50 ? '#10b981' : p.latencyMs < 200 ? '#f59e0b' : '#ef4444'};text-align:right;">${p.latencyMs}ms</span>
        </div>`).join('') : '<div style="font-size:0.55rem;color:#475569;text-align:center;padding:0.5rem;">No peers discovered</div>'}
      </div>`;
  }

  return {
    initializeMeshNode,
    broadcastScoreMutation,
    broadcastStandingsUpdate,
    initiateRTCConnectionTo,
    renderMeshStatusMatrix,
    disconnect,
    getNodeId:  () => _nodeId,
    getPeers:   () => [..._peers.values()],
    isConnected:() => _isConnected,
    getMetrics: () => ({ ..._metrics })
  };
})();

window.MeshNetwork = MeshNetwork;
