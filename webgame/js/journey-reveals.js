// Remember discoveries per player; pending celebrations survive a reload.
export function createJourneyReveals(storage) {
  let owner = null;
  let state = null;
  function save() {
    try { storage.setItem(`weston-journey-reveals-v1:${owner}`, JSON.stringify(state)); } catch { /* Session-only when storage is unavailable. */ }
  }
  return {
    observe(nextOwner, reached) {
      if (!nextOwner) { owner = null; state = null; return; }
      if (owner !== nextOwner || !state) {
        owner = nextOwner;
        let cached;
        try { cached = JSON.parse(storage.getItem(`weston-journey-reveals-v1:${owner}`)); } catch { /* Start at the existing progress. */ }
        state = Number.isInteger(cached?.seen) && Number.isInteger(cached?.known)
          && cached.seen >= 0 && cached.seen <= cached.known && cached.known <= 5
          ? cached : { seen: reached, known: reached };
      }
      state.known = Math.max(state.known, reached);
      save();
    },
    next(reached) { return state && state.seen < Math.min(state.known, reached) ? state.seen + 1 : null; },
    acknowledge(stage) {
      if (state && stage === state.seen + 1 && stage <= state.known) { state.seen = stage; save(); }
    },
    reset(reached = 0) {
      if (state) { state = { seen: reached, known: reached }; save(); }
    },
  };
}
