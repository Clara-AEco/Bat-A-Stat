// QA Profile logic: decides which Detection Events belong in the Manual Review queue.
window.BatID = window.BatID || {};

(function (ns) {
  // Deterministic hash of a string to [0, 1). Same event ID always maps to the same value,
  // so raising the sample % only ever ADDS calls to the queue - it never reshuffles or drops
  // ones already selected (and already reviewed).
  function stableHash01(str) {
    let h = 2166136261; // FNV-1a
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    // Unsigned 32-bit -> [0, 1)
    return (h >>> 0) / 4294967296;
  }

  // Returns { included, reason } for one event under the given profile.
  // reason: 'no-id' | 'below-threshold' | '100pct-species' | 'sampled' | 'not-selected'
  function computeQaInclusion(event, profile) {
    const primary = event.primaryBtoId;
    if (!primary) {
      return { included: !!profile.alwaysReviewNoId, reason: 'no-id' };
    }
    const label = primary.englishName || primary.species;
    const probabilityPct = primary.probability != null ? primary.probability * 100 : null;

    if (probabilityPct != null && probabilityPct < profile.probabilityThreshold) {
      return { included: true, reason: 'below-threshold' };
    }
    if ((profile.speciesRequiring100Percent || []).includes(label)) {
      return { included: true, reason: '100pct-species' };
    }
    const sampled = stableHash01(event.id) < (profile.samplePercent || 0) / 100;
    return { included: sampled, reason: sampled ? 'sampled' : 'not-selected' };
  }

  // Summary across a deployment's events: queue size, reviewed-within-queue, breakdown by reason.
  function computeQaSummary(events, profile) {
    const byReason = { 'no-id': 0, 'below-threshold': 0, '100pct-species': 0, sampled: 0, 'not-selected': 0 };
    let queued = 0;
    let queuedReviewed = 0;
    for (const ev of events) {
      const { included, reason } = computeQaInclusion(ev, profile);
      byReason[reason]++;
      if (included) {
        queued++;
        if (ev.manualReview && ev.manualReview.reviewed) queuedReviewed++;
      }
    }
    return {
      totalEvents: events.length,
      queued,
      queuedReviewed,
      queuedRemaining: queued - queuedReviewed,
      byReason,
    };
  }

  ns.QaProfiles = { stableHash01, computeQaInclusion, computeQaSummary };
})(window.BatID);
