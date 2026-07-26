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

  // One row per Detection Event, resolved to what it now counts as for every stat/figure:
  // - category: 'bat' (a real bat species, whether from BTO or manual review),
  //             'noise' (manually confirmed as not a bat call),
  //             'other-taxon' (BTO identified a non-bat species - e.g. dormouse, bush-cricket -
  //                            kept visible per Clara's own instruction, never folded into "noise"),
  //             'unidentified' (BTO could not classify it at all, and nobody's reviewed it yet -
  //                            may or may not be a real bat pass, so it counts toward total
  //                            activity but never toward species-level stats).
  function buildAnalysisDataset(events) {
    return (events || []).map((ev) => {
      const { finalId, source } = M.resolveFinalId(ev);
      let category;
      if (source === 'manual') {
        category = finalId === 'Noise / No ID' ? 'noise' : 'bat';
      } else if (ev.primaryBtoId) {
        category = (ev.primaryBtoId.group || 'bat').toLowerCase() === 'bat' ? 'bat' : 'other-taxon';
      } else {
        category = 'unidentified';
      }
      return { event: ev, finalId, source, category, dateTime: eventDateTime(ev), surveyDate: ev.surveyDate || ev.actualDate || null };
    });
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
  // nights/dates banners).
  function computeEffortStats(deployment, dataset) {
    const effort = deployment.surveyEffort || {};
    const surveyNights = new Set(dataset.map((d) => d.surveyDate).filter(Boolean));
    return {
      nights: effort.nights,
      validRecordingHours: effort.validRecordingHours,
      qaCompletionPct: effort.qaCompletionPct,
      detectorFailures: effort.detectorFailures,
      excludedPeriods: effort.excludedPeriods,
      nightsInData: surveyNights.size,
    };
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

  function computeAllStats(deployment, location) {
    const dataset = buildAnalysisDataset(deployment.detectionEvents || []);
    const effort = computeEffortStats(deployment, dataset);
    return {
      dataset,
      effort,
      activity: computeActivityStats(dataset, effort),
      species: computeSpeciesStats(dataset),
      timing: computeTimingStats(dataset, location),
    };
  }

  ns.Stats = {
    buildAnalysisDataset,
    computeEffortStats,
    computeActivityStats,
    computeSpeciesStats,
    computeTimingStats,
    computeAllStats,
    mean, median, stdDev, percentile,
  };
})(window.BatID);
