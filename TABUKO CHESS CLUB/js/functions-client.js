// js/functions-client.js — Placeholder for Firebase Functions Client
const FunctionsClient = (() => {
  return {
    call: async (name, data) => {
      console.log(`[Functions] Calling ${name}`, data);
      return { data: { success: true } };
    }
  };
})();
window.FunctionsClient = FunctionsClient;
