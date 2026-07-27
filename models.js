// Data model: Project -> Location -> Deployment -> DetectionEvent
// Plain global namespace (no build step / no ES modules, so this works from a double-clicked file:// HTML file).
window.BatID = window.BatID || {};

(function (ns) {
  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createProject({ client = '', projectName = '', siteName = '', notes = '' } = {}) {
    return {
      id: uid(),
      type: 'project',
      client,
      projectName,
      siteName,
      notes,
      locations: [],
      // Species labels the analyst has typed in manually (e.g. "Myotis sp") that BTO never
      // flagged at all - once added here they show up as quick-label buttons project-wide.
      customLabels: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  function createLocation({ name = '', notes = '', latitude = null, longitude = null } = {}) {
    return {
      id: uid(),
      type: 'location',
      name,
      notes,
      // Drives sunset/sunrise-relative timing statistics and figures (sun.js) - a Location is the
      // right place for this (a persistent monitoring point), not per-Detection-Event GPS, which
      // BTO only sometimes reports and can jitter or be missing entirely.
      latitude,
      longitude,
      deployments: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  function createDeployment({
    name = '',
    startDate = '',
    endDate = '',
    detectorInfo = '',
    weather = '',
    notes = '',
  } = {}) {
    return {
      id: uid(),
      type: 'deployment',
      name,
      startDate,
      endDate,
      detectorInfo,
      weather,
      notes,
      surveyEffort: {
        nights: null,
        validRecordingHours: null,
        detectorFailures: '',
        excludedPeriods: '',
        qaCompletionPct: null,
      },
      // Drives the Manual Review queue: sample % for everything else, a probability floor
      // below which every call is queued regardless of species, species that always get
      // reviewed in full, and whether unidentified ("No ID") calls are always queued too.
      qaProfile: {
        samplePercent: 10,
        probabilityThreshold: 50,
        // Per-species overrides where the automated model is known to be reliable, so those
        // species don't get pulled into "below threshold" review as readily as the rest.
        speciesThresholds: [
          { species: 'Common Pipistrelle', threshold: 60 },
          { species: 'Soprano Pipistrelle', threshold: 60 },
        ],
        speciesRequiring100Percent: [],
        alwaysReviewNoId: true,
      },
      // Probability floor (%) for the separate "Original BTO" baseline statistic only (Stats.
      // computeOriginalBtoStats) - NOT applied to the resolved-observed dataset every other
      // statistic reads from, which keeps the existing rule that an unreviewed BTO primary always
      // counts toward analysis regardless of its probability. This is a distinct, clearly-labeled
      // "what would the numbers say from automated IDs alone, before any human review" baseline.
      analyticalConfidenceThreshold: 50,
      btoImports: [], // [{ id, fileName, importedAt, rowCount, eventIds: [...] }]
      detectionEvents: [],
      // One entry per calendar night the deployment ran, generated from Start/End date (see
      // generateSurveyNights) - the canonical denominator for nightly stats, so a night with truly
      // zero bat activity (no BTO rows at all for it) still exists and isn't silently invisible to
      // means/medians/Detection Frequency the way "nights inferred from detections" would leave it.
      surveyNights: [],
      // Real-world detector placement isn't always acoustically ideal (theft/vandalism risk,
      // concealment, low mounting) - recording this alongside results means QA-derived
      // reliability reads as "observed performance under THIS deployment's conditions", not a
      // universal BTO accuracy figure. Every field optional - nothing here blocks analysis, it's
      // context to show alongside it (never an automatic correction to activity counts).
      microphonePlacement: {
        heightMetres: null,
        orientation: '', // e.g. "horizontal" | "vertical" | "angled" - free text, no fixed list imposed
        mountingType: '', // e.g. "tree-mounted" | "pole-mounted" | "building" | "ground"
        enclosureUsed: null,
        nearbyVegetation: null,
        vegetationDistanceMetres: null,
        leavesWithinImmediateField: null,
        nearbyPath: null,
        nearbyRoad: null,
        nearbyWater: null,
        nearbyLighting: null,
        theftRiskConstraint: null,
        vandalismRiskConstraint: null,
        placementQuality: null, // 'recommended' | 'partially-constrained' | 'strongly-constrained'
        notes: '',
      },
      acousticConditions: {
        vegetationNoise: null, // 'low' | 'moderate' | 'high'
        windNoise: null,
        rainNoise: null,
        anthropogenicNoise: null,
        clippingOrOverloadObserved: null,
        weakSignalPrevalence: null,
        notes: '',
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  // One acoustic call segment. May carry several BTO candidate-species rows.
  function createDetectionEvent({
    originalWav = '',
    partNumber = null,
    candidateSpecies = [], // [{ species, scientificName, englishName, group, probability, warnings }]
    sourceBtoImportId = null,
    actualDate = '',
    surveyDate = '',
    time = '',
    latitude = null,
    longitude = null,
  } = {}) {
    const primary = pickPrimaryCandidate(candidateSpecies);
    return {
      id: uid(),
      type: 'detectionEvent',
      originalWav,
      partNumber,
      candidateSpecies,
      primaryBtoId: primary, // { species, englishName, group, probability, warnings } | null
      sourceBtoImportId,
      actualDate,
      surveyDate,
      time,
      latitude,
      longitude,
      manualReview: {
        reviewed: false,
        finalId: null,
        reviewerNotes: '',
        reviewedAt: null,
        sonogramAnalysis: null, // { measurements, shape, decisionTreeResult }
        // Extra species confirmed present in this SAME 5-second Detection Event (e.g. a mixed
        // recording where BTO's primary result only reflects the most prominent species) - each
        // one becomes its own Species Detection Record alongside finalId, per Clara's ecological
        // model: one Detection Event may resolve to several Species Detection Records.
        additionalTaxa: [],
        // Append-only audit trail of every review decision on this event - never overwritten, so
        // the original BTO classification and every prior reviewer decision stay reconstructable
        // even after a later re-review changes the resolved result. See Models.appendReviewHistory.
        history: [],
      },
      qaStatus: null, // computed by qa-profiles.js against the deployment's active QA profile
      createdAt: nowIso(),
    };
  }

  // One calendar night of survey effort - the canonical denominator for nightly stats (means,
  // medians, Detection Frequency, etc). Deliberately NOT inferred from Detection Events: a night
  // with truly zero bat activity produces zero BTO rows, so a "nights seen in the data" approach
  // would never know that night existed at all. status defaults to 'valid' since most nights in a
  // normal deployment are; the analyst downgrades individual nights (detector failure, excluded
  // period) rather than the software ever guessing a failure from absence of data.
  function createSurveyNight({
    surveyDate = '',
    recordingStart = null,
    recordingEnd = null,
    sunset = null,
    sunrise = null,
    nominalDurationHours = null,
    validDurationHours = null,
    excludedDurationHours = null,
    failureDurationHours = null,
    validHours = null,
    status = 'valid', // 'valid' | 'partial' | 'failed' | 'excluded' | 'unknown-effort'
    recordingConditions = '',
    notes = '',
  } = {}) {
    return {
      id: uid(),
      type: 'surveyNight',
      surveyDate,
      recordingStart,
      recordingEnd,
      sunset,
      sunrise,
      nominalDurationHours,
      validDurationHours,
      excludedDurationHours,
      failureDurationHours,
      validHours,
      status,
      recordingConditions,
      notes,
    };
  }

  // Parses a deployment's own dd-mm-yyyy-agnostic Start/End date inputs (HTML <input type="date">
  // gives yyyy-mm-dd) into a plain {y,m,d}, or null if absent/invalid.
  function parseIsoDate(str) {
    if (!str) return null;
    const [y, m, d] = str.split('-').map(Number);
    if (!y || !m || !d) return null;
    return { y, m, d };
  }

  function toDdMmYyyy(y, m, d) {
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }

  // Builds one Survey Night per calendar date from deployment.startDate to deployment.endDate
  // (inclusive), preserving any already-generated night's status/hours/notes by surveyDate so
  // re-running this after an analyst has downgraded a night (detector failure, excluded period)
  // never clobbers that decision - only the date range changes what set of nights exists at all.
  // Returns the new surveyNights array; does not mutate the deployment (caller persists it).
  function generateSurveyNights(deployment, location) {
    const start = parseIsoDate(deployment.startDate);
    const end = parseIsoDate(deployment.endDate);
    if (!start || !end) return deployment.surveyNights || [];
    const existingByDate = new Map((deployment.surveyNights || []).map((n) => [n.surveyDate, n]));
    const hasLocation = location && location.latitude != null && location.longitude != null;
    const Sun = window.BatID.Sun;

    const nights = [];
    const d = new Date(start.y, start.m - 1, start.d);
    const endDate = new Date(end.y, end.m - 1, end.d);
    while (d <= endDate) {
      const surveyDate = toDdMmYyyy(d.getFullYear(), d.getMonth() + 1, d.getDate());
      const existing = existingByDate.get(surveyDate);
      if (existing) {
        nights.push(existing);
      } else {
        let sunset = null, sunrise = null;
        if (hasLocation && Sun) {
          const nextDay = new Date(d); nextDay.setDate(nextDay.getDate() + 1);
          const times = Sun.sunTimes(d, location.latitude, location.longitude);
          const nextTimes = Sun.sunTimes(nextDay, location.latitude, location.longitude);
          sunset = times.sunset ? times.sunset.toISOString() : null;
          sunrise = nextTimes.sunrise ? nextTimes.sunrise.toISOString() : null;
        }
        nights.push(createSurveyNight({ surveyDate, sunset, sunrise, status: 'valid' }));
      }
      d.setDate(d.getDate() + 1);
    }
    return nights;
  }

  // Backfills surveyNights for a deployment that predates this entity (e.g. Clara's real live
  // Victoria Pleasure Ground data), or regenerates it after Start/End date changes. Safe to call on
  // every deployment load - a no-op if the night set already matches the current date range.
  function ensureSurveyNights(deployment, location) {
    if (!deployment.startDate || !deployment.endDate) return deployment.surveyNights || [];
    const generated = generateSurveyNights(deployment, location);
    const current = deployment.surveyNights || [];
    const sameLength = current.length === generated.length;
    const sameDates = sameLength && current.every((n, i) => n.surveyDate === generated[i].surveyDate);
    return sameDates ? current : generated;
  }

  // Appends one entry to a Detection Event's manualReview.history - never overwrites a prior entry,
  // so the original BTO classification and every earlier reviewer decision stay reconstructable
  // even after a later re-review changes the resolved result. `reviewer` is free text (this app has
  // no login/auth concept - single local user), blank if not supplied.
  function appendReviewHistory(manualReview, { action, previousFinalId, newFinalId, previousAdditionalTaxa, newAdditionalTaxa, reviewer, comments } = {}) {
    const history = manualReview.history || [];
    const entry = {
      version: history.length + 1,
      reviewer: reviewer || '',
      timestamp: nowIso(),
      action, // 'accept' | 'modify' | 'reject' | 'add-additional' | 'remove-additional'
      previousFinalId: previousFinalId != null ? previousFinalId : null,
      newFinalId: newFinalId != null ? newFinalId : null,
      previousAdditionalTaxa: previousAdditionalTaxa || [],
      newAdditionalTaxa: newAdditionalTaxa || [],
      comments: comments || '',
    };
    return [...history, entry];
  }

  // Highest-probability candidate is the Primary BTO ID. "No ID" rows have no candidates.
  function pickPrimaryCandidate(candidateSpecies) {
    if (!candidateSpecies || candidateSpecies.length === 0) return null;
    // Seed the reduce with the first candidate (not null) so a single candidate with a
    // missing/non-numeric probability is still returned as primary, rather than being lost.
    return candidateSpecies.reduce((best, c) => {
      const p = typeof c.probability === 'number' ? c.probability : -Infinity;
      const bestP = typeof best.probability === 'number' ? best.probability : -Infinity;
      return p > bestP ? c : best;
    }, candidateSpecies[0]);
  }

  // Final ID resolution rule (confirmed with Clara):
  // - If manually reviewed, the manual Final ID always wins.
  // - Otherwise, the Primary BTO ID is used even if it fails QA (flagged via qaStatus, not excluded).
  function resolveFinalId(detectionEvent) {
    if (detectionEvent.manualReview && detectionEvent.manualReview.reviewed) {
      return {
        finalId: detectionEvent.manualReview.finalId,
        source: 'manual',
      };
    }
    if (detectionEvent.primaryBtoId) {
      return {
        finalId: detectionEvent.primaryBtoId.englishName || detectionEvent.primaryBtoId.species,
        source: 'primary-bto',
      };
    }
    return { finalId: 'No ID', source: 'none' };
  }

  // A Detection Event (one 5-second BTO analysis window) may resolve to more than one species -
  // e.g. a mixed recording where BTO's primary result only reflects the most prominent call.
  // Returns one entry per Species Detection Record: the primary resolution (resolveFinalId, above)
  // plus any additionalTaxa confirmed during manual review. Deduplicated so confirming the same
  // species twice (as primary and separately as "additional") never double-counts it.
  function resolveSpeciesRecords(detectionEvent) {
    const primary = resolveFinalId(detectionEvent);
    const additional = (detectionEvent.manualReview && detectionEvent.manualReview.additionalTaxa) || [];
    const records = [primary, ...additional.map((finalId) => ({ finalId, source: 'manual-additional' }))];
    const seen = new Set();
    return records.filter((r) => {
      if (!r.finalId || seen.has(r.finalId)) return false;
      seen.add(r.finalId);
      return true;
    });
  }

  function findLocation(project, locationId) {
    return (project.locations || []).find((l) => l.id === locationId) || null;
  }

  function findDeployment(project, deploymentId) {
    for (const loc of project.locations || []) {
      const dep = (loc.deployments || []).find((d) => d.id === deploymentId);
      if (dep) return { location: loc, deployment: dep };
    }
    return null;
  }

  function touch(obj) {
    obj.updatedAt = nowIso();
  }

  ns.Models = {
    uid,
    createProject,
    createLocation,
    createDeployment,
    createDetectionEvent,
    createSurveyNight,
    generateSurveyNights,
    ensureSurveyNights,
    appendReviewHistory,
    pickPrimaryCandidate,
    resolveFinalId,
    resolveSpeciesRecords,
    findLocation,
    findDeployment,
    touch,
  };
})(window.BatID);
