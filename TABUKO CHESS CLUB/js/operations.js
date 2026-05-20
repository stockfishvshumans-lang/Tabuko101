/**
 * operations.js — Event-Sourced Operations Queue
 * Pillar 2: Reliability & Event-Sourcing
 */
const OperationsQueue = (() => {
  const queue = [];
  let isProcessing = false;

  async function push(type, payload) {
    const op = {
      id: crypto.randomUUID(),
      type,
      payload,
      status: 'pending',
      timestamp: Date.now()
    };
    queue.push(op);
    console.log(`[OpsQueue] Pushed: ${type}`, op);
    
    // Auto-process for now
    await processQueue();
    return op;
  }

  async function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;

    while (queue.length > 0) {
      const op = queue[0];
      try {
        if (op.type === 'SUBMIT_RESULT') {
          if (op.payload.matchNumber) {
            // Team Match
            await Tournament.submitTeamResult(
              op.payload.tournamentId, 
              op.payload.roundNumber, 
              op.payload.matchNumber, 
              [{ boardNum: op.payload.boardNumber, result: op.payload.result }],
              0, 0 // BP will be recalculated by submitTeamResult internally if needed or provided
            );
          } else {
            // Individual Match
            await Tournament.submitResultAndUpdate(
              op.payload.tournamentId, 
              op.payload.roundNumber, 
              op.payload.board, 
              op.payload.whiteScore, 
              op.payload.blackScore
            );
          }
        }
        op.status = 'completed';
      } catch (err) {
        console.error(`[OpsQueue] Failed: ${op.type}`, err);
        op.status = 'failed';
        op.error = err.message;
      }
      queue.shift();
    }

    isProcessing = false;
  }

  return { push, init: () => console.log("[OpsQueue] Initialized") };
})();

window.OperationsQueue = OperationsQueue;
