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

  // A species can override the global probability threshold (e.g. "the model is good with
  // Common/Soprano Pipistrelle, accept anything above 60% instead of the usual 50%").
  function effectiveThreshold(label, profile) {
    const override = (profile.speciesThresholds || []).find((s) => s.species === label);
    return override ? override.threshold : profile.probabilityThreshold;
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
    const threshold = effectiveThreshold(label, profile);

    if (probabilityPct != null && probabilityPct < threshold) {
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

  // Informational only - Clara confirmed the original rule stands: an unreviewed event's BTO
  // primary always counts toward analysis (flagged if below threshold), never silently excluded,
  // so stats stay usable at any point during QA rather than swinging as review work progresses.
  // 'pending-required-qa' is purely a highlight for species marked for mandatory full review -
  // it does NOT mean the event is left out of any statistic.
  function computeAnalysisStatus(event, profile) {
    if (event.manualReview && event.manualReview.reviewed) return 'included';
    const { reason } = computeQaInclusion(event, profile);
    return reason === '100pct-species' ? 'pending-required-qa' : 'included';
  }

  // Grades a reviewed event's BTO primary result against what manual review actually found.
  // knownBatSpeciesNames (optional): the app's own reference species list, used to tell "reviewer
  // reassigned to a different real bat species" apart from a custom/non-bat/genus-level label -
  // without it, anything not matching the primary just falls into the 'reassigned-other' bucket.
  // Does NOT yet distinguish incorrect-identification-level / false-positive-non-bat / bat-
  // present-unidentifiable from each other - that needs the reviewer to record which one
  // explicitly (a structured taxonomy/outcome picker), not string-matching a free-text label.
  function computeQaOutcome(event, knownBatSpeciesNames) {
    if (!event.manualReview || !event.manualReview.reviewed) {
      return { primaryIdCorrect: null, eventComplete: null, qaOutcome: 'unresolved' };
    }
    const finalId = event.manualReview.finalId;
    const hasAdditional = ((event.manualReview.additionalTaxa) || []).length > 0;
    const primary = event.primaryBtoId;
    const primaryLabel = primary ? (primary.englishName || primary.species) : null;

    if (finalId === 'Noise / No ID') {
      return { primaryIdCorrect: primaryLabel ? false : null, eventComplete: false, qaOutcome: 'false-positive-noise' };
    }
    if (!primaryLabel) {
      return { primaryIdCorrect: null, eventComplete: !hasAdditional, qaOutcome: 'no-bto-primary' };
    }
    const primaryRetained = finalId === primaryLabel;
    if (primaryRetained) {
      return hasAdditional
        ? { primaryIdCorrect: true, eventComplete: false, qaOutcome: 'correct-but-incomplete' }
        : { primaryIdCorrect: true, eventComplete: true, qaOutcome: 'correct' };
    }
    const isKnownBatSpecies = !knownBatSpeciesNames || knownBatSpeciesNames.includes(finalId);
    return isKnownBatSpecies
      ? { primaryIdCorrect: false, eventComplete: false, qaOutcome: 'incorrect-species' }
      : { primaryIdCorrect: false, eventComplete: false, qaOutcome: 'reassigned-other' };
  }

  ns.QaProfiles = {
    stableHash01, effectiveThreshold, computeQaInclusion, computeQaSummary,
    computeAnalysisStatus, computeQaOutcome,
  };
})(window.BatID);
