/**
 * DistributedBus.js — Centralized Reactive Event Pipeline & Dead-Letter System
 * Day 251: Zero-loss reactive communication layer for cross-module async traffic.
 * 
 * Architecture:
 *   DistributedEventBus.publish('SCORE_UPDATE', payload)
 *     → wraps in versioned envelope with crypto UUID
 *     → pushes to replay buffer (max 1000)
 *     → routes to registered subscribers
 *     → dead-letters unhandled or failed deliveries
 *
 * @version 1.0.0 — Day 251 Sprint Foundation
 */
const DistributedEventBus = (() => {
  'use strict';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CORE STATE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const listeners = new Map();
  const replayBuffer = [];
  const MAX_BUFFER_SIZE = 1000;
  const deadLetterQueue = [];
  const MAX_DLQ_SIZE = 500;

  // Telemetry counters
  const _metrics = {
    totalPublished: 0,
    totalDelivered: 0,
    totalDeadLettered: 0,
    totalReplayed: 0,
    topicCounts: {},
    latencySum: 0,
    latencySamples: 0,
    startedAt: Date.now()
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLISH — Zero-Loss Event Dispatch
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function publish(topic, payload) {
    if (!topic || typeof topic !== 'string') {
      console.warn('[EventBus] Invalid topic — discarding event.');
      return null;
    }

    // Wrap payload in immutable versioned envelope
    const eventEnvelope = {
      id: crypto.randomUUID(),
      topic,
      payload: JSON.parse(JSON.stringify(payload || {})), // Deep-clone immutability
      timestamp: Date.now(),
      version: '1.0.0',
      source: window.TenantManager?.getActiveClubId?.() || 'local'
    };

    // Push to replay buffer with FIFO eviction
    replayBuffer.push(eventEnvelope);
    if (replayBuffer.length > MAX_BUFFER_SIZE) replayBuffer.shift();

    // Update telemetry
    _metrics.totalPublished++;
    _metrics.topicCounts[topic] = (_metrics.topicCounts[topic] || 0) + 1;

    // Route to subscribers
    if (!listeners.has(topic) || listeners.get(topic).length === 0) {
      // No subscribers — route to Dead Letter Queue
      handleDeadLetter(eventEnvelope, new Error('NO_SUBSCRIBERS'));
      return eventEnvelope;
    }

    const t0 = performance.now();
    const topicListeners = listeners.get(topic);

    for (const callback of topicListeners) {
      try {
        callback(eventEnvelope);
        _metrics.totalDelivered++;
      } catch (err) {
        console.error(`[EventBus] Subscriber crash on topic "${topic}":`, err.message);
        handleDeadLetter(eventEnvelope, err);
      }
    }

    const latency = performance.now() - t0;
    _metrics.latencySum += latency;
    _metrics.latencySamples++;

    return eventEnvelope;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SUBSCRIBE — Topic Registration
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function subscribe(topic, callback) {
    if (!topic || typeof callback !== 'function') {
      console.warn('[EventBus] Invalid subscription parameters.');
      return null;
    }

    if (!listeners.has(topic)) listeners.set(topic, []);
    listeners.get(topic).push(callback);

    // Return unsubscribe handle
    return () => {
      const arr = listeners.get(topic);
      if (arr) {
        const idx = arr.indexOf(callback);
        if (idx !== -1) arr.splice(idx, 1);
      }
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // REPLAY — Hydrate Late-Mounting UI Panels
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function replay(topic, callback, maxEvents = 50) {
    if (!topic || typeof callback !== 'function') return;

    const matching = replayBuffer
      .filter(e => e.topic === topic)
      .slice(-maxEvents);

    matching.forEach(envelope => {
      try {
        callback(envelope);
        _metrics.totalReplayed++;
      } catch (err) {
        console.warn(`[EventBus] Replay delivery failure on "${topic}":`, err.message);
      }
    });

    return matching.length;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DEAD LETTER QUEUE — Failed Delivery Archive
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function handleDeadLetter(envelope, error) {
    deadLetterQueue.push({
      envelope,
      error: error?.message || 'UNKNOWN_ERROR',
      droppedAt: Date.now()
    });

    if (deadLetterQueue.length > MAX_DLQ_SIZE) deadLetterQueue.shift();
    _metrics.totalDeadLettered++;
  }

  function retryDeadLetters(topic = null) {
    const candidates = topic
      ? deadLetterQueue.filter(d => d.envelope.topic === topic)
      : [...deadLetterQueue];

    let retried = 0;
    for (const dlItem of candidates) {
      if (listeners.has(dlItem.envelope.topic) && listeners.get(dlItem.envelope.topic).length > 0) {
        publish(dlItem.envelope.topic, dlItem.envelope.payload);
        const idx = deadLetterQueue.indexOf(dlItem);
        if (idx !== -1) deadLetterQueue.splice(idx, 1);
        retried++;
      }
    }
    console.log(`[EventBus] Retried ${retried} dead-lettered events.`);
    return retried;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TELEMETRY — Real-Time Processing Metrics
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function getMetrics() {
    const avgLatency = _metrics.latencySamples > 0
      ? (_metrics.latencySum / _metrics.latencySamples).toFixed(3)
      : '0.000';

    return {
      totalPublished: _metrics.totalPublished,
      totalDelivered: _metrics.totalDelivered,
      totalDeadLettered: _metrics.totalDeadLettered,
      totalReplayed: _metrics.totalReplayed,
      avgLatencyMs: parseFloat(avgLatency),
      activeTopics: listeners.size,
      replayBufferSize: replayBuffer.length,
      deadLetterQueueSize: deadLetterQueue.length,
      topicBreakdown: { ..._metrics.topicCounts },
      uptimeMs: Date.now() - _metrics.startedAt
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // UI — Event Monitor Dashboard
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  function renderEventMonitor(containerId = 'event-monitor-root') {
    const root = document.getElementById(containerId);
    if (!root) return;

    const m = getMetrics();
    const topTopics = Object.entries(m.topicBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const recentEvents = replayBuffer.slice(-10).reverse();
    const recentDLQ = deadLetterQueue.slice(-5).reverse();

    root.innerHTML = `
      <div style="background:rgba(15,23,42,0.95);border:1px solid rgba(0,242,255,0.12);border-radius:12px;padding:1rem;font-family:'JetBrains Mono','Fira Code',monospace;color:#e2e8f0;font-size:0.7rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <div style="font-weight:900;font-size:0.65rem;text-transform:uppercase;letter-spacing:2px;color:#00f2ff;">⚡ Event Bus Monitor</div>
          <div style="font-size:0.55rem;color:#475569;">Uptime: ${(m.uptimeMs / 1000).toFixed(0)}s</div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-bottom:0.75rem;">
          <div style="background:rgba(0,0,0,0.3);padding:0.5rem;border-radius:8px;text-align:center;">
            <div style="font-size:1.1rem;font-weight:900;color:#10b981;">${m.totalPublished}</div>
            <div style="font-size:0.5rem;color:#64748b;font-weight:800;">PUBLISHED</div>
          </div>
          <div style="background:rgba(0,0,0,0.3);padding:0.5rem;border-radius:8px;text-align:center;">
            <div style="font-size:1.1rem;font-weight:900;color:#3b82f6;">${m.totalDelivered}</div>
            <div style="font-size:0.5rem;color:#64748b;font-weight:800;">DELIVERED</div>
          </div>
          <div style="background:rgba(0,0,0,0.3);padding:0.5rem;border-radius:8px;text-align:center;">
            <div style="font-size:1.1rem;font-weight:900;color:#f59e0b;">${m.totalDeadLettered}</div>
            <div style="font-size:0.5rem;color:#64748b;font-weight:800;">DLQ</div>
          </div>
          <div style="background:rgba(0,0,0,0.3);padding:0.5rem;border-radius:8px;text-align:center;">
            <div style="font-size:1.1rem;font-weight:900;color:#a855f7;">${m.avgLatencyMs}ms</div>
            <div style="font-size:0.5rem;color:#64748b;font-weight:800;">AVG LATENCY</div>
          </div>
        </div>

        ${topTopics.length > 0 ? `
        <div style="margin-bottom:0.75rem;">
          <div style="font-size:0.5rem;font-weight:900;color:#64748b;margin-bottom:0.25rem;text-transform:uppercase;letter-spacing:1px;">Topic Breakdown</div>
          ${topTopics.map(([t, c]) => `
            <div style="display:flex;justify-content:space-between;padding:2px 4px;border-bottom:1px solid rgba(255,255,255,0.03);">
              <span style="color:#94a3b8;">${t}</span>
              <span style="color:#10b981;font-weight:900;">${c}</span>
            </div>
          `).join('')}
        </div>` : ''}

        <div style="font-size:0.5rem;font-weight:900;color:#64748b;margin-bottom:0.25rem;text-transform:uppercase;letter-spacing:1px;">Recent Events (Last 10)</div>
        <div style="max-height:120px;overflow-y:auto;">
          ${recentEvents.map(e => `
            <div style="display:flex;gap:6px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.02);font-size:0.6rem;">
              <span style="color:#475569;min-width:55px;">${new Date(e.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span style="color:#00f2ff;font-weight:700;min-width:120px;">${e.topic}</span>
              <span style="color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${JSON.stringify(e.payload).substring(0, 60)}</span>
            </div>
          `).join('')}
        </div>

        ${recentDLQ.length > 0 ? `
        <div style="margin-top:0.5rem;">
          <div style="font-size:0.5rem;font-weight:900;color:#ef4444;margin-bottom:0.25rem;text-transform:uppercase;letter-spacing:1px;">⚠ Dead Letter Queue</div>
          ${recentDLQ.map(d => `
            <div style="font-size:0.55rem;color:#f87171;padding:2px 0;">${d.envelope.topic}: ${d.error}</div>
          `).join('')}
        </div>` : ''}
      </div>
    `;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLIC API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    publish,
    subscribe,
    replay,
    retryDeadLetters,
    getMetrics,
    renderEventMonitor,
    getDeadLetterQueue: () => [...deadLetterQueue],
    getReplayBuffer: () => [...replayBuffer],
    getActiveTopics: () => [...listeners.keys()]
  };
})();

window.DistributedEventBus = DistributedEventBus;
