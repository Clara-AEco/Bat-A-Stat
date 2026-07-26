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
      btoImports: [], // [{ id, fileName, importedAt, rowCount, eventIds: [...] }]
      detectionEvents: [],
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
      // True for a species the analyst spotted in the sonogram that BTO's classifier missed
      // entirely (no candidate row at all) - a distinct Detection Event added alongside the
      // BTO-derived one for the same call/part, tracked separately so it can be counted and later
      // factored into the Statistics error estimate as a known gap in BTO's automated coverage.
      addedManually: false,
      manualReview: {
        reviewed: false,
        finalId: null,
        reviewerNotes: '',
        reviewedAt: null,
        sonogramAnalysis: null, // { measurements, shape, decisionTreeResult }
      },
      qaStatus: null, // computed by qa-profiles.js against the deployment's active QA profile
      createdAt: nowIso(),
    };
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
    pickPrimaryCandidate,
    resolveFinalId,
    findLocation,
    findDeployment,
    touch,
  };
})(window.BatID);
