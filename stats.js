// Statistics engine: resolves a Deployment's Detection Events into the "Analysis Dataset" (one
// resolved identification per event, manual review winning over BTO's own primary candidate - see
// Models.resolveFinalId), then computes Effort/Activity/Species/Timing statistics over it. Every
// figure in the app should read from this, never straight from raw BTO rows, so multi-candidate
// segments are never double-counted.
window.BatID = window.BatID || {};

(function (ns) {
  const M = ns.Models;

  function parseDdMmYyyy(str) {
    if (!str) return null;
    const [d, m, y] = str.split('/').map(Number);
    if (!y || !m || !d) return null;
    return { y, m, d };
  }

  // The real wall-clock instant a Detection Event happened, from its Actual Date (the true
  // calendar date, not the BTO-resolved Survey Date - which deliberately re-attributes a 01:30
  // recording to the *previous* night for grouping purposes, and would otherwise make an
  // after-midnight detection sort as if it happened before that same evening's earlier calls).
  // Survey Date stays the grouping key (see surveyDate on the resolved row below) - this is
  // purely for anything that needs true chronological order or a real timestamp (first/last
  // detection, sunset-relative hour).
  function eventDateTime(ev) {
    const parsed = parseDdMmYyyy(ev.actualDate);
    if (!parsed) return null;
    const [hh, mm, ss] = (ev.time || '').split(':').map(Number);
    const dt = new Date(parsed.y, parsed.m - 1, parsed.d, hh || 0, mm || 0, ss || 0);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // One row per Species Detection Record - a single 5-second Detection Event may resolve to
  // more than one (e.g. a mixed recording where manual review confirms a species BTO's primary
  // result didn't reflect), via Models.resolveSpeciesRecords. Each row's category:
  // - 'bat' (a real bat species, whether from BTO or manual review),
  // - 'noise' (manually confirmed as not a bat call),
  // - 'other-taxon' (BTO identified a non-bat species - e.g. dormouse, bush-cricket - kept
  //                  visible per Clara's own instruction, never folded into "noise"),
  // - 'unidentified' (BTO could not classify it at all, and nobody's reviewed it yet - may or may
  //                   not be a real bat pass, so it counts toward total activity but never toward
  //                   species-level stats).
  // Activity/species stats deliberately just iterate this dataset without special-casing multi-
  // record events - a 2-species event naturally contributes twice, once per resolved species,
  // which is what "both species carried into activity totals" requires.
  function buildAnalysisDataset(events) {
    const rows = [];
    for (const ev of events || []) {
      const dateTime = eventDateTime(ev);
      const surveyDate = ev.surveyDate || ev.actualDate || null;
      for (const { finalId, source } of M.resolveSpeciesRecords(ev)) {
        let category;
        if (source === 'manual' || source === 'manual-additional') {
          category = finalId === 'Noise / No ID' ? 'noise' : 'bat';
        } else if (ev.primaryBtoId) {
          category = (ev.primaryBtoId.group || 'bat').toLowerCase() === 'bat' ? 'bat' : 'other-taxon';
        } else {
          category = 'unidentified';
        }
        rows.push({ event: ev, eventId: ev.id, finalId, source, category, dateTime, surveyDate, isAdditional: source === 'manual-additional' });
      }
    }
    return rows;
  }

  function mean(values) {
    if (!values.length) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
  }
  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function stdDev(values, avg) {
    if (values.length < 2) return null;
    const m = avg == null ? mean(values) : avg;
    const variance = values.reduce((s, v) => s + (v - m) * (v - m), 0) / (values.length - 1);
    return Math.sqrt(variance);
  }
  function percentile(sortedValues, p) {
    if (!sortedValues.length) return null;
    const idx = (sortedValues.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sortedValues[lo];
    return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
  }

  // Pass-through of the manually-entered effort fields, plus a cross-check against what the data
  // itself suggests (same "suggestion, never silently substituted" pattern as the Overview tab's
  // nights/dates banners). QA completion % is the one exception - it's fully derivable from the
  // QA profile and detection events with no judgement call involved, so it's always computed
  // directly rather than relying on a manual field nobody remembers to keep updated.
  function computeEffortStats(deployment, dataset) {
    const effort = deployment.surveyEffort || {};
    const surveyNights = new Set(dataset.map((d) => d.surveyDate).filter(Boolean));
    const qaSummary = ns.QaProfiles.computeQaSummary(deployment.detectionEvents || [], deployment.qaProfile || {});
    return {
      nights: effort.nights,
      validRecordingHours: effort.validRecordingHours,
      qaCompletionPct: qaSummary.queued > 0 ? (qaSummary.queuedReviewed / qaSummary.queued) * 100 : 100,
      detectorFailures: effort.detectorFailures,
      excludedPeriods: effort.excludedPeriods,
      nightsInData: surveyNights.size,
    };
  }

  // Suggests total Valid Recording Hours for the whole deployment from its own date range and the
  // Location's coordinates: for each calendar night from Start Date to End Date, the recording
  // window is assumed to run from 30 minutes before sunset to 30 minutes after the following
  // sunrise (a standard emergence/return survey convention), summed across every night. A
  // suggestion only, same as nights/dates elsewhere - detector failures/exclusions are real-world
  // reasons the actual figure can come in lower, and are why this stays manually editable.
  function suggestValidRecordingHours(deployment, location) {
    if (!location || location.latitude == null || location.longitude == null) return null;
    if (!deployment.startDate || !deployment.endDate) return null;
    const [sy, sm, sd] = deployment.startDate.split('-').map(Number);
    const [ey, em, ed] = deployment.endDate.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return null;

    let totalHours = 0, nights = 0;
    const PAD_MS = 30 * 60 * 1000;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const nextDay = new Date(d); nextDay.setDate(nextDay.getDate() + 1);
      const { sunset } = ns.Sun.sunTimes(d, location.latitude, location.longitude);
      const { sunrise } = ns.Sun.sunTimes(nextDay, location.latitude, location.longitude);
      if (!sunset || !sunrise) continue; // polar day/night - not a UK concern, but don't crash
      const hours = (sunrise.getTime() + PAD_MS - (sunset.getTime() - PAD_MS)) / (1000 * 60 * 60);
      if (hours > 0) { totalHours += hours; nights++; }
    }
    return nights > 0 ? { totalHours, nights } : null;
  }

  // Total activity, nightly breakdown, and the summary statistics of that nightly breakdown -
  // both raw and effort-standardised (per-night, per-hour where valid recording hours are set).
  // Counts everything except confirmed noise and other-taxon identifications - an unreviewed BTO
  // "No ID" still counts here (it may well be a real, just-unidentifiable bat pass), per the
  // project's founding rule that nothing is silently excluded from the Analysis Dataset.
  function computeActivityStats(dataset, effort) {
    const activityRows = dataset.filter((d) => d.category === 'bat' || d.category === 'unidentified');
    const byNight = new Map();
    for (const d of activityRows) {
      if (!d.surveyDate) continue;
      byNight.set(d.surveyDate, (byNight.get(d.surveyDate) || 0) + 1);
    }
    const nightlyCounts = Array.from(byNight.values());
    const totalDetections = activityRows.length;
    const nights = effort.nights != null ? effort.nights : effort.nightsInData;
    const avg = mean(nightlyCounts);
    return {
      totalDetections,
      nightlyBreakdown: Array.from(byNight.entries()).map(([surveyDate, count]) => ({ surveyDate, count })).sort((a, b) => a.surveyDate.localeCompare(b.surveyDate)),
      detectionsPerNight: nights ? totalDetections / nights : null,
      detectionsPerHour: effort.validRecordingHours ? totalDetections / effort.validRecordingHours : null,
      nightlyMean: avg,
      nightlyMedian: median(nightlyCounts),
      nightlyMin: nightlyCounts.length ? Math.min(...nightlyCounts) : null,
      nightlyMax: nightlyCounts.length ? Math.max(...nightlyCounts) : null,
      nightlySd: stdDev(nightlyCounts, avg),
      nightlyCv: avg ? stdDev(nightlyCounts, avg) / avg : null,
    };
  }

  // Richness, composition, dominance, per-species active-nights/detection-frequency, and a species
  // accumulation curve. Scoped to category === 'bat' only - "other-taxon" and "unidentified" rows
  // can't be attributed to a species so they're excluded here (though still counted in Activity).
  function computeSpeciesStats(dataset) {
    const batRows = dataset.filter((d) => d.category === 'bat');
    const counts = {};
    const nightsBySpecies = {};
    for (const d of batRows) {
      counts[d.finalId] = (counts[d.finalId] || 0) + 1;
      if (d.surveyDate) {
        nightsBySpecies[d.finalId] = nightsBySpecies[d.finalId] || new Set();
        nightsBySpecies[d.finalId].add(d.surveyDate);
      }
    }
    const totalNightsInData = new Set(batRows.map((d) => d.surveyDate).filter(Boolean)).size;
    const total = batRows.length;
    const composition = Object.entries(counts)
      .map(([species, count]) => ({
        species, count,
        pct: total ? (count / total) * 100 : 0,
        activeNights: nightsBySpecies[species] ? nightsBySpecies[species].size : 0,
        detectionFrequencyPct: totalNightsInData && nightsBySpecies[species] ? (nightsBySpecies[species].size / totalNightsInData) * 100 : null,
      }))
      .sort((a, b) => b.count - a.count);

    // Accumulation curve: cumulative unique species by survey night, in chronological order -
    // the basis flagged as an assumption in the original build plan; confirm/adjust if a
    // different basis (e.g. by detector-hour) is wanted.
    const nightsSorted = Array.from(new Set(batRows.map((d) => d.surveyDate).filter(Boolean))).sort();
    const seenSoFar = new Set();
    const accumulation = nightsSorted.map((night) => {
      for (const d of batRows) if (d.surveyDate === night) seenSoFar.add(d.finalId);
      return { surveyDate: night, cumulativeRichness: seenSoFar.size };
    });

    return {
      richness: composition.length,
      totalBatDetections: total,
      composition,
      dominantSpecies: composition[0] || null,
      accumulation,
    };
  }

  // First/last detection, peak activity windows, and cumulative-activity percentiles. Uses
  // sunset-relative hours when a Location's lat/lon is available (Sun.hoursRelativeToSunset),
  // falling back to raw clock time otherwise - sunset-relative is what actually makes activity
  // comparable across nights of different length, per the project's original R-script design.
  function computeTimingStats(dataset, location) {
    const batRows = dataset.filter((d) => d.category === 'bat' && d.dateTime);
    if (!batRows.length) {
      return { firstDetection: null, lastDetection: null, sunsetRelative: false, peakHalfHour: null, peakRollingHour: null, percentiles: {} };
    }
    const hasLocation = location && location.latitude != null && location.longitude != null;
    const values = batRows.map((d) => {
      if (hasLocation) {
        const rel = ns.Sun.hoursRelativeToSunset(d.dateTime, location.latitude, location.longitude);
        if (rel != null) return rel;
      }
      return d.dateTime.getHours() + d.dateTime.getMinutes() / 60;
    }).sort((a, b) => a - b);

    // Peak 30-minute window and peak 60-minute rolling window, both found by sliding over the
    // sorted values (values are already hours - either sunset-relative or clock hours).
    function peakWindow(windowHours) {
      let bestStart = values[0], bestCount = 0;
      for (const v of values) {
        const count = values.filter((x) => x >= v && x < v + windowHours).length;
        if (count > bestCount) { bestCount = count; bestStart = v; }
      }
      return { startHour: bestStart, count: bestCount };
    }

    const pcts = {};
    for (const p of [10, 25, 50, 75, 90]) pcts[p] = percentile(values, p / 100);

    return {
      firstDetection: batRows.reduce((min, d) => (min == null || d.dateTime < min ? d.dateTime : min), null),
      lastDetection: batRows.reduce((max, d) => (max == null || d.dateTime > max ? d.dateTime : max), null),
      sunsetRelative: hasLocation,
      medianHour: median(values),
      peakHalfHour: peakWindow(0.5),
      peakRollingHour: peakWindow(1),
      percentiles: pcts,
    };
  }

  function computeAllStats(deployment, location, knownBatSpeciesNames) {
    const dataset = buildAnalysisDataset(deployment.detectionEvents || []);
    const effort = computeEffortStats(deployment, dataset);
    const events = deployment.detectionEvents || [];
    return {
      dataset,
      totalDetectionEvents: events.length,
      totalSpeciesRecords: dataset.length,
      effort,
      activity: computeActivityStats(dataset, effort),
      species: computeSpeciesStats(dataset),
      timing: computeTimingStats(dataset, location),
      reliability: computeReliabilityStats(events, knownBatSpeciesNames),
    };
  }

  // First cut at "how good is BTO's own primary identification, given what manual review actually
  // found" - the three headline measures from Clara's QA-reliability spec (Stage 1 of that work;
  // stratifying by species/probability band/recording-condition, confidence intervals and a
  // fallback hierarchy for small samples are follow-on work, not done here yet). Only counts
  // reviewed events that had a BTO primary result at all - there's no "was the primary correct"
  // question to ask of an event BTO never proposed anything for.
  //
  // A. Primary-ID reliability: was BTO's primary species kept as (one of) the resolved species?
  //    A "correct but incomplete" event (primary kept, but another species also added) still
  //    counts as correct here - the primary identification itself wasn't wrong. Events downgraded
  //    to genus level ('incorrect-identification-level' - a sonogram too degraded to call to
  //    species, Clara's own practice for most sub-50%-confidence Myotis/Barbastella primaries) are
  //    EXCLUDED from this denominator entirely: BTO's species-level primary can't be judged right
  //    or wrong when the reviewer never had enough signal to confirm or refute it.
  // B. Complete-event reliability: did the event need no change at all - no reassignment, no
  //    added species? Stricter than (A): a "correct but incomplete" event fails this one.
  // C. Additional-species rate: how often did manual review find a species BTO's primary result
  //    didn't represent - most relevant where field conditions may mask weaker/overlapping calls.
  function computeReliabilityStats(events, knownBatSpeciesNames) {
    const reviewed = (events || []).filter((ev) => ev.manualReview && ev.manualReview.reviewed && ev.primaryBtoId);
    const n = reviewed.length;
    let primaryCorrect = 0, primaryJudged = 0, complete = 0, withAdditional = 0, genusLevel = 0;
    const byOutcome = {};
    for (const ev of reviewed) {
      const outcome = ns.QaProfiles.computeQaOutcome(ev, knownBatSpeciesNames);
      byOutcome[outcome.qaOutcome] = (byOutcome[outcome.qaOutcome] || 0) + 1;
      if (outcome.qaOutcome === 'incorrect-identification-level') {
        genusLevel++;
      } else if (outcome.primaryIdCorrect != null) {
        primaryJudged++;
        if (outcome.primaryIdCorrect) primaryCorrect++;
      }
      if (outcome.eventComplete) complete++;
      if ((ev.manualReview.additionalTaxa || []).length > 0) withAdditional++;
    }
    return {
      reviewedSampleSize: n,
      primaryIdJudgedSampleSize: primaryJudged,
      primaryIdReliabilityPct: primaryJudged > 0 ? (primaryCorrect / primaryJudged) * 100 : null,
      completeEventReliabilityPct: n > 0 ? (complete / n) * 100 : null,
      additionalSpeciesRatePct: n > 0 ? (withAdditional / n) * 100 : null,
      genusLevelRatePct: n > 0 ? (genusLevel / n) * 100 : null,
      byOutcome,
    };
  }

  ns.Stats = {
    buildAnalysisDataset,
    computeEffortStats,
    suggestValidRecordingHours,
    computeActivityStats,
    computeSpeciesStats,
    computeTimingStats,
    computeReliabilityStats,
    computeAllStats,
    mean, median, stdDev, percentile,
  };
})(window.BatID);
