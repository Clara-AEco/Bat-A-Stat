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
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  function createLocation({ name = '', notes = '' } = {}) {
    return {
      id: uid(),
      type: 'location',
      name,
      notes,
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
      qaProfileId: null,
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
