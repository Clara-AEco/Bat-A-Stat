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

  // surveyDate is stored dd/mm/yyyy (BTO's own convention) - a plain string sort gets month
  // boundaries backwards (e.g. "01/07/2026" sorts before "28/06/2026" lexicographically, even
  // though July 1st is later). Every place that orders survey nights chronologically goes through
  // this instead of a bare .sort() or .localeCompare().
  function compareSurveyDates(a, b) {
    const pa = parseDdMmYyyy(a), pb = parseDdMmYyyy(b);
    if (!pa || !pb) return (a || '').localeCompare(b || '');
    return pa.y - pb.y || pa.m - pb.m || pa.d - pb.d;
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

  // Wilson score interval for a proportion - chosen over the plain normal-approximation interval
  // because it stays sensible (never dips below 0% or above 100%) at the small sample sizes and
  // near-extreme proportions a single deployment's reviewed sample regularly produces. z=1.96 is
  // the standard 95% figure. Returns null when there's no sample to speak of.
  function wilsonInterval(successes, n, z) {
    if (!n) return null;
    z = z || 1.96;
    const p = successes / n;
    const denom = 1 + (z * z) / n;
    const center = p + (z * z) / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return {
      lowerPct: Math.max(0, (center - margin) / denom) * 100,
      upperPct: Math.min(1, (center + margin) / denom) * 100,
    };
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
      nightlyBreakdown: Array.from(byNight.entries()).map(([surveyDate, count]) => ({ surveyDate, count })).sort((a, b) => compareSurveyDates(a.surveyDate, b.surveyDate)),
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
    const nightsSorted = Array.from(new Set(batRows.map((d) => d.surveyDate).filter(Boolean))).sort(compareSurveyDates);
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

  // Stage 5 (Level 1A): nightly variation within a single deployment - a richer per-night view than
  // Activity's plain nightly counts (above), pairing each night's activity total with its own
  // richness and dominant species, and flagging nights whose total activity is a statistical
  // outlier against the rest of the deployment.
  //
  // Outlier detection uses the median/MAD-based modified z-score (Iglewicz & Hoaglin 1993:
  // 0.6745 * (x - median) / MAD, flagged at |M| > 3.5) rather than mean/SD - deliberately, not the
  // more familiar choice. A single extreme night pulls the mean and SD toward itself, which masks
  // exactly the outlier it should be flagging, and that masking gets worse the fewer nights there
  // are. Bat surveys are usually short (3 nights minimum by convention, 5 typical for a consultancy
  // deployment) - too few for mean/SD to stay stable once an outlier is folded in. The median and
  // MAD barely move when one value is extreme, so this stays sensitive even at n=4-5.
  //
  // MAD can come out exactly 0 (more than half the nights had identical activity) - a plain
  // division would blow up, so that case is handled directly instead: with every "normal" night
  // literally equal to the median, any night that differs at all is unambiguously the outlier.
  function computeNightlyStats(dataset) {
    const activityRows = dataset.filter((d) => d.category === 'bat' || d.category === 'unidentified');
    const batRows = dataset.filter((d) => d.category === 'bat');
    const nights = Array.from(new Set(dataset.map((d) => d.surveyDate).filter(Boolean))).sort(compareSurveyDates);

    const perNight = nights.map((night) => {
      const nightActivity = activityRows.filter((d) => d.surveyDate === night);
      const nightBat = batRows.filter((d) => d.surveyDate === night);
      const counts = {};
      for (const d of nightBat) counts[d.finalId] = (counts[d.finalId] || 0) + 1;
      const composition = Object.entries(counts).map(([species, count]) => ({ species, count })).sort((a, b) => b.count - a.count);
      return {
        surveyDate: night,
        totalDetections: nightActivity.length,
        batDetections: nightBat.length,
        richness: composition.length,
        dominantSpecies: composition[0] ? composition[0].species : null,
        dominantCount: composition[0] ? composition[0].count : null,
      };
    });

    const totals = perNight.map((n) => n.totalDetections);
    const nightlyMedian = median(totals);
    const mad = median(totals.map((v) => Math.abs(v - nightlyMedian)));
    for (const n of perNight) {
      if (mad > 0) {
        n.modifiedZScore = (0.6745 * (n.totalDetections - nightlyMedian)) / mad;
        n.isOutlier = Math.abs(n.modifiedZScore) > 3.5;
      } else {
        n.modifiedZScore = n.totalDetections === nightlyMedian ? 0 : null;
        n.isOutlier = n.totalDetections !== nightlyMedian;
      }
    }

    return {
      perNight,
      nightlyMedian,
      mad,
      outlierNights: perNight.filter((n) => n.isOutlier),
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

  // Shared groundwork for both hourly-activity functions below: which bins/nights to show (always
  // derived from EVERY bat/unidentified detection in the deployment, unfiltered, so a filtered or
  // QA-adjusted view still shows a 0 for a bin/night where only something else was active -
  // absence within the deployment's own recording activity is real data, not something to hide by
  // omitting the row/column), plus the hour-value/bin-start helpers and the bin ordering.
  function hourlyActivityFrame(dataset, location, binSizeHours) {
    const bin = binSizeHours || 1;
    const hasLocation = location && location.latitude != null && location.longitude != null;

    function hourValueOf(d) {
      if (hasLocation) {
        const rel = ns.Sun.hoursRelativeToSunset(d.dateTime, location.latitude, location.longitude);
        if (rel != null) return rel;
      }
      return d.dateTime.getHours() + d.dateTime.getMinutes() / 60;
    }
    function binStartOf(hourValue) {
      return Math.floor(hourValue / bin) * bin;
    }

    const allActivityRows = dataset.filter((d) => (d.category === 'bat' || d.category === 'unidentified') && d.dateTime);
    const binsSeen = new Set();
    for (const d of allActivityRows) binsSeen.add(binStartOf(hourValueOf(d)));
    const nights = Array.from(new Set(allActivityRows.map((d) => d.surveyDate).filter(Boolean))).sort(compareSurveyDates);

    // Order bins as one continuous overnight sequence. Sunset-relative bins are already continuous
    // (negative = before sunset, positive = after) so a plain ascending sort is correct. Clock-hour
    // bins wrap at midnight, so a raw ascending sort would put "00:00" before "21:00" and split one
    // continuous night's activity across the two ends of the row - instead they're sorted rotated
    // around midday (the point bats are least active), which keeps any overnight span contiguous
    // regardless of what clock hours it actually falls on.
    const bins = Array.from(binsSeen).sort((a, b) => {
      if (hasLocation) return a - b;
      const rotate = (h) => ((h + 12) % 24 + 24) % 24;
      return rotate(a) - rotate(b);
    });

    return { hasLocation, bin, hourValueOf, binStartOf, bins, nights };
  }

  // Hourly activity pattern (raw) - how activity is distributed across the night, per survey
  // night, so nights can be compared against each other directly (does the peak stay at the same
  // time each night, or does it shift?) rather than only seeing each night's single total
  // (computeNightlyStats, above). Filterable to a single species, a genus ("group of species"), or
  // all bats combined. Sunset-relative hours when the Location has coordinates (same convention as
  // computeTimingStats), clock hours otherwise. binSizeHours defaults to 1 (an "hourly" pattern,
  // per the name) but is a parameter since a finer/coarser bin may turn out more useful in practice.
  function computeHourlyActivity(dataset, location, filter, binSizeHours) {
    filter = filter || { type: 'all', value: null };
    const { hasLocation, bin, hourValueOf, binStartOf, bins, nights } = hourlyActivityFrame(dataset, location, binSizeHours);

    const filteredRows = dataset.filter((d) => d.category === 'bat' && d.dateTime).filter((d) => {
      if (filter.type === 'species') return d.finalId === filter.value;
      if (filter.type === 'group') return ns.SpeciesData && ns.SpeciesData.genusOf(d.finalId) === filter.value;
      return true;
    });
    const byNight = new Map(); // surveyDate -> Map(binStart -> count)
    for (const d of filteredRows) {
      if (!d.surveyDate) continue;
      const b = binStartOf(hourValueOf(d));
      if (!byNight.has(d.surveyDate)) byNight.set(d.surveyDate, new Map());
      const nightMap = byNight.get(d.surveyDate);
      nightMap.set(b, (nightMap.get(b) || 0) + 1);
    }

    const rows = nights.map((night) => {
      const nightMap = byNight.get(night) || new Map();
      const counts = bins.map((b) => nightMap.get(b) || 0);
      return { surveyDate: night, counts, total: counts.reduce((a, b) => a + b, 0) };
    });
    const binMeans = bins.map((b, i) => (nights.length ? rows.reduce((sum, r) => sum + r.counts[i], 0) / nights.length : 0));

    return { sunsetRelative: hasLocation, binSizeHours: bin, bins, rows, binMeans };
  }

  // Hourly activity pattern (QA-adjusted) - same shape as computeHourlyActivity above, but each
  // still-unreviewed detection's contribution is redistributed across computeConfusionBreakdown's
  // targets in the same proportions reviewed calls of that primary actually turned out to be,
  // exactly like computeSpeciesStatsQaAdjusted - just keeping the per-night/per-bin granularity
  // instead of collapsing to a single deployment-wide total. Counts become fractional (weights),
  // and only the fraction that lands on a species/genus matching the current filter is kept - e.g.
  // filtering to "Leisler's Bat" after finding 90% of its reviewed calls were actually Serotine
  // shows the 10% that stayed Leisler's, not the 90% that moved elsewhere (that 90% shows up
  // instead when filtering to Serotine). Species with fewer than minSample reviewed calls are left
  // as raw counts, same low-frequency-species handling as computeSpeciesStatsQaAdjusted.
  function computeHourlyActivityQaAdjusted(dataset, location, filter, confusionBreakdown, minSample, binSizeHours) {
    filter = filter || { type: 'all', value: null };
    minSample = minSample || MIN_RELIABLE_SAMPLE;
    const { hasLocation, bin, hourValueOf, binStartOf, bins, nights } = hourlyActivityFrame(dataset, location, binSizeHours);
    const confusionBySpecies = new Map((confusionBreakdown || []).map((c) => [c.species, c]));

    function matchesFilter(species) {
      if (filter.type === 'species') return species === filter.value;
      if (filter.type === 'group') return ns.SpeciesData && ns.SpeciesData.genusOf(species) === filter.value;
      return true;
    }

    const byNight = new Map(); // surveyDate -> Map(binStart -> weight)
    function addWeight(night, b, w) {
      if (!byNight.has(night)) byNight.set(night, new Map());
      const m = byNight.get(night);
      m.set(b, (m.get(b) || 0) + w);
    }

    for (const row of dataset) {
      if (row.category !== 'bat' || !row.dateTime || !row.surveyDate) continue;
      const b = binStartOf(hourValueOf(row));
      if (row.source !== 'primary-bto') {
        if (matchesFilter(row.finalId)) addWeight(row.surveyDate, b, 1);
        continue;
      }
      const confusion = confusionBySpecies.get(row.finalId);
      if (!confusion || confusion.reviewedSampleSize < minSample) {
        if (matchesFilter(row.finalId)) addWeight(row.surveyDate, b, 1);
        continue;
      }
      for (const target of confusion.breakdown) {
        if (target.pct > 0 && matchesFilter(target.finalId)) addWeight(row.surveyDate, b, target.pct / 100);
      }
    }

    const rows = nights.map((night) => {
      const nightMap = byNight.get(night) || new Map();
      const counts = bins.map((b) => nightMap.get(b) || 0);
      return { surveyDate: night, counts, total: counts.reduce((a, b) => a + b, 0) };
    });
    const binMeans = bins.map((b, i) => (nights.length ? rows.reduce((sum, r) => sum + r.counts[i], 0) / nights.length : 0));

    return { sunsetRelative: hasLocation, binSizeHours: bin, bins, rows, binMeans };
  }

  function computeAllStats(deployment, location, knownBatSpeciesNames) {
    const dataset = buildAnalysisDataset(deployment.detectionEvents || []);
    const effort = computeEffortStats(deployment, dataset);
    const events = deployment.detectionEvents || [];
    const confusionBreakdown = computeConfusionBreakdown(events);
    return {
      dataset,
      totalDetectionEvents: events.length,
      totalSpeciesRecords: dataset.length,
      effort,
      activity: computeActivityStats(dataset, effort),
      species: computeSpeciesStats(dataset),
      speciesQaAdjusted: computeSpeciesStatsQaAdjusted(dataset, confusionBreakdown),
      nightly: computeNightlyStats(dataset),
      timing: computeTimingStats(dataset, location),
      reliability: computeReliabilityStats(events, knownBatSpeciesNames),
      reliabilityByProbabilityBand: computeReliabilityByProbabilityBand(events, knownBatSpeciesNames),
      reliabilityBySpecies: computeReliabilityBySpecies(events, knownBatSpeciesNames),
      confusionBreakdown,
    };
  }

  // Stage 6 (Level 1B): compares every Deployment at the same Location, in chronological order, to
  // see how activity/richness/dominance shift through the year. Each row's species turnover
  // (gained/lost) is against the immediately preceding deployment only - a simple presence/absence
  // diff, not a similarity index (Jaccard/Sørensen/Bray-Curtis are separate, later work - not
  // duplicated here). Deliberately reads each deployment through the same building blocks as
  // computeAllStats (buildAnalysisDataset -> computeActivityStats/computeSpeciesStats) rather than
  // a parallel calculation, so a deployment's numbers here always match what its own Statistics tab
  // shows.
  function computeLocationComparison(location) {
    const deployments = (location.deployments || [])
      .slice()
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    let previousSpeciesSet = null;
    const rows = deployments.map((dep) => {
      const dataset = buildAnalysisDataset(dep.detectionEvents || []);
      const effort = computeEffortStats(dep, dataset);
      const activity = computeActivityStats(dataset, effort);
      const species = computeSpeciesStats(dataset);
      const speciesSet = new Set(species.composition.map((s) => s.species));
      const speciesGained = previousSpeciesSet ? Array.from(speciesSet).filter((s) => !previousSpeciesSet.has(s)) : [];
      const speciesLost = previousSpeciesSet ? Array.from(previousSpeciesSet).filter((s) => !speciesSet.has(s)) : [];
      previousSpeciesSet = speciesSet;
      return {
        deploymentId: dep.id,
        deploymentName: dep.name,
        startDate: dep.startDate,
        endDate: dep.endDate,
        nights: effort.nightsInData,
        totalDetections: activity.totalDetections,
        detectionsPerNight: activity.detectionsPerNight,
        richness: species.richness,
        dominantSpecies: species.dominantSpecies ? species.dominantSpecies.species : null,
        dominantPct: species.dominantSpecies ? species.dominantSpecies.pct : null,
        speciesGained,
        speciesLost,
      };
    });

    return { deployments: rows };
  }

  // Below this many judged calls, a reliability percentage swings too wildly on one or two more
  // reviews to stand on its own - Stage 3's fallback hierarchy (computeReliabilityBySpecies, below)
  // and Stage 4's QA-adjusted redistribution (computeSpeciesStatsQaAdjusted) both use this as the
  // point where they stop trusting a level's own number and borrow a coarser one instead. Raised
  // from 10 to 50 per Clara's call - 10 wasn't a large enough sample to trust a correction against.
  const MIN_RELIABLE_SAMPLE = 50;

  // First cut at "how good is BTO's own primary identification, given what manual review actually
  // found" - the three headline measures from Clara's QA-reliability spec. Only counts reviewed
  // events that had a BTO primary result at all - there's no "was the primary correct" question to
  // ask of an event BTO never proposed anything for.
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
  //
  // Each percentage carries a 95% Wilson confidence interval (ciLowerPct/ciUpperPct) alongside it -
  // the sample size behind these numbers is often small enough that the point estimate alone
  // overstates how precisely it's known (e.g. "67.6%" from a sample of 3 reads as far more solid
  // than it is). Stratified breakdowns (probability band, species/genus) are separate functions
  // below - this one stays the single whole-deployment headline.
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
    const primaryCi = wilsonInterval(primaryCorrect, primaryJudged);
    const completeCi = wilsonInterval(complete, n);
    const additionalCi = wilsonInterval(withAdditional, n);
    return {
      reviewedSampleSize: n,
      primaryIdJudgedSampleSize: primaryJudged,
      primaryIdReliabilityPct: primaryJudged > 0 ? (primaryCorrect / primaryJudged) * 100 : null,
      primaryIdReliabilityCiLowerPct: primaryCi ? primaryCi.lowerPct : null,
      primaryIdReliabilityCiUpperPct: primaryCi ? primaryCi.upperPct : null,
      completeEventReliabilityPct: n > 0 ? (complete / n) * 100 : null,
      completeEventReliabilityCiLowerPct: completeCi ? completeCi.lowerPct : null,
      completeEventReliabilityCiUpperPct: completeCi ? completeCi.upperPct : null,
      additionalSpeciesRatePct: n > 0 ? (withAdditional / n) * 100 : null,
      additionalSpeciesRateCiLowerPct: additionalCi ? additionalCi.lowerPct : null,
      additionalSpeciesRateCiUpperPct: additionalCi ? additionalCi.upperPct : null,
      genusLevelRatePct: n > 0 ? (genusLevel / n) * 100 : null,
      byOutcome,
    };
  }

  // BTO's own reported probability is a natural stratifier for reliability - it directly answers
  // "does a higher-confidence primary actually turn out right more often", which is what the QA
  // profile's probability threshold is a bet on in the first place. Bands match the shape of a
  // typical QA profile (a below-threshold band that gets reviewed in full, then broadening bands
  // of increasing BTO confidence) rather than being evenly spaced.
  const PROBABILITY_BANDS = [
    { label: '<50%', min: 0, max: 50 },
    { label: '50-70%', min: 50, max: 70 },
    { label: '70-90%', min: 70, max: 90 },
    { label: '90-100%', min: 90, max: 100.001 },
  ];

  function computeReliabilityByProbabilityBand(events, knownBatSpeciesNames) {
    const reviewed = (events || []).filter((ev) => ev.manualReview && ev.manualReview.reviewed && ev.primaryBtoId);
    return PROBABILITY_BANDS.map((band) => {
      const inBand = reviewed.filter((ev) => {
        const p = ev.primaryBtoId.probability != null ? ev.primaryBtoId.probability * 100 : null;
        return p != null && p >= band.min && p < band.max;
      });
      let primaryCorrect = 0, primaryJudged = 0, genusLevel = 0;
      for (const ev of inBand) {
        const outcome = ns.QaProfiles.computeQaOutcome(ev, knownBatSpeciesNames);
        if (outcome.qaOutcome === 'incorrect-identification-level') {
          genusLevel++;
        } else if (outcome.primaryIdCorrect != null) {
          primaryJudged++;
          if (outcome.primaryIdCorrect) primaryCorrect++;
        }
      }
      const ci = wilsonInterval(primaryCorrect, primaryJudged);
      return {
        label: band.label,
        reviewedSampleSize: inBand.length,
        primaryIdJudgedSampleSize: primaryJudged,
        primaryIdReliabilityPct: primaryJudged > 0 ? (primaryCorrect / primaryJudged) * 100 : null,
        primaryIdReliabilityCiLowerPct: ci ? ci.lowerPct : null,
        primaryIdReliabilityCiUpperPct: ci ? ci.upperPct : null,
        genusLevelRatePct: inBand.length > 0 ? (genusLevel / inBand.length) * 100 : null,
        insufficientSample: primaryJudged < MIN_RELIABLE_SAMPLE,
      };
    });
  }

  // Per-species reliability with a fallback hierarchy for when a species doesn't have enough
  // reviewed calls of its own to trust: species -> genus -> whole deployment. Below
  // MIN_RELIABLE_SAMPLE judged calls at a level, the estimate shown is borrowed from the next
  // coarser level instead (and flagged as such via fallbackLevel/fallbackNote) rather than
  // presenting a shaky species-specific number as if it were solid.
  function computeReliabilityBySpecies(events, knownBatSpeciesNames) {
    const SpeciesData = ns.SpeciesData;
    const reviewed = (events || []).filter((ev) => ev.manualReview && ev.manualReview.reviewed && ev.primaryBtoId);

    function judgeAll(evs) {
      let primaryCorrect = 0, primaryJudged = 0;
      for (const ev of evs) {
        const outcome = ns.QaProfiles.computeQaOutcome(ev, knownBatSpeciesNames);
        if (outcome.qaOutcome === 'incorrect-identification-level') continue;
        if (outcome.primaryIdCorrect != null) {
          primaryJudged++;
          if (outcome.primaryIdCorrect) primaryCorrect++;
        }
      }
      return { primaryCorrect, primaryJudged };
    }

    const bySpecies = new Map();
    for (const ev of reviewed) {
      const label = ev.primaryBtoId.englishName || ev.primaryBtoId.species;
      if (!bySpecies.has(label)) bySpecies.set(label, []);
      bySpecies.get(label).push(ev);
    }

    const deploymentWide = judgeAll(reviewed);
    const deploymentCi = wilsonInterval(deploymentWide.primaryCorrect, deploymentWide.primaryJudged);

    return Array.from(bySpecies.entries()).map(([species, evs]) => {
      const own = judgeAll(evs);
      if (own.primaryJudged >= MIN_RELIABLE_SAMPLE) {
        const ci = wilsonInterval(own.primaryCorrect, own.primaryJudged);
        return {
          species,
          reviewedSampleSize: evs.length,
          primaryIdJudgedSampleSize: own.primaryJudged,
          primaryIdReliabilityPct: (own.primaryCorrect / own.primaryJudged) * 100,
          primaryIdReliabilityCiLowerPct: ci ? ci.lowerPct : null,
          primaryIdReliabilityCiUpperPct: ci ? ci.upperPct : null,
          fallbackLevel: 'species',
          fallbackNote: null,
        };
      }
      const genus = SpeciesData ? SpeciesData.genusOf(species) : null;
      const genusEvs = genus
        ? reviewed.filter((ev) => SpeciesData.genusOf(ev.primaryBtoId.englishName || ev.primaryBtoId.species) === genus)
        : [];
      const genusJudged = genus ? judgeAll(genusEvs) : { primaryCorrect: 0, primaryJudged: 0 };
      if (genus && genusJudged.primaryJudged >= MIN_RELIABLE_SAMPLE) {
        const ci = wilsonInterval(genusJudged.primaryCorrect, genusJudged.primaryJudged);
        return {
          species,
          reviewedSampleSize: evs.length,
          primaryIdJudgedSampleSize: own.primaryJudged,
          primaryIdReliabilityPct: (genusJudged.primaryCorrect / genusJudged.primaryJudged) * 100,
          primaryIdReliabilityCiLowerPct: ci ? ci.lowerPct : null,
          primaryIdReliabilityCiUpperPct: ci ? ci.upperPct : null,
          fallbackLevel: 'genus',
          fallbackNote: `Only ${own.primaryJudged} judged call(s) for ${species} - showing ${genus} genus-level reliability (n=${genusJudged.primaryJudged}) instead.`,
        };
      }
      return {
        species,
        reviewedSampleSize: evs.length,
        primaryIdJudgedSampleSize: own.primaryJudged,
        primaryIdReliabilityPct: deploymentWide.primaryJudged > 0 ? (deploymentWide.primaryCorrect / deploymentWide.primaryJudged) * 100 : null,
        primaryIdReliabilityCiLowerPct: deploymentCi ? deploymentCi.lowerPct : null,
        primaryIdReliabilityCiUpperPct: deploymentCi ? deploymentCi.upperPct : null,
        fallbackLevel: 'deployment',
        fallbackNote: `Only ${own.primaryJudged} judged call(s) for ${species}${genus ? ` (and too few across the whole ${genus} genus)` : ''} - showing whole-deployment reliability (n=${deploymentWide.primaryJudged}) instead.`,
      };
    }).sort((a, b) => b.reviewedSampleSize - a.reviewedSampleSize);
  }

  // For each BTO-primary species, what did manually reviewed calls with that primary actually
  // resolve to (including staying correct)? This is the piece reliability alone can't show: a 0%
  // reliability figure says BTO's primary was wrong, not what it should have been instead. If one
  // alternate ID dominates the breakdown (e.g. 96% of reviewed "Leisler's Bat" calls turned out to
  // be Serotine), that's the evidence needed to judge whether bulk-relabelling the rest is safe;
  // if it's scattered across several corrections, it isn't. Feeds both the Statistics tab's
  // per-species drill-down and the QA-adjusted species estimate below.
  function computeConfusionBreakdown(events) {
    const reviewed = (events || []).filter((ev) => ev.manualReview && ev.manualReview.reviewed && ev.primaryBtoId);
    const bySpecies = new Map();
    for (const ev of reviewed) {
      const primary = ev.primaryBtoId.englishName || ev.primaryBtoId.species;
      const finalId = ev.manualReview.finalId;
      if (!bySpecies.has(primary)) bySpecies.set(primary, new Map());
      const targets = bySpecies.get(primary);
      targets.set(finalId, (targets.get(finalId) || 0) + 1);
    }
    return Array.from(bySpecies.entries()).map(([species, targets]) => {
      const total = Array.from(targets.values()).reduce((a, b) => a + b, 0);
      const breakdown = Array.from(targets.entries())
        .map(([finalId, count]) => ({ finalId, count, pct: (count / total) * 100, isPrimaryRetained: finalId === species }))
        .sort((a, b) => b.count - a.count);
      return { species, reviewedSampleSize: total, breakdown };
    }).sort((a, b) => b.reviewedSampleSize - a.reviewedSampleSize);
  }

  // Stage 4: Raw vs QA-adjusted species composition. Raw (computeSpeciesStats, above - what's used
  // everywhere else in the app) takes every still-unreviewed event's BTO primary at face value.
  // QA-adjusted goes a step further for species with enough reviewed calls to trust a correction:
  // each unreviewed event's single count is redistributed across computeConfusionBreakdown's
  // targets in the same proportions reviewed calls with that primary actually turned out to be -
  // e.g. if 96% of reviewed "Leisler's Bat" calls were actually Serotine, an unreviewed Leisler's
  // call contributes 0.96 to Serotine and 0.04 to Leisler's, rather than 1 full count to Leisler's.
  // Species/primaries with fewer than minSample reviewed calls are left entirely as raw ("low-
  // frequency species handling") - there isn't enough evidence yet to trust a correction, and
  // guessing one would just swap one kind of error for another.
  //
  // Caveat (documented, not hidden): this assumes a species' reviewed-call confusion pattern
  // generalises to that species' still-unreviewed calls in this deployment. Because the QA profile
  // samples more heavily at low BTO confidence, that assumption is weakest exactly where the
  // correction matters most - cross-check the by-probability-band reliability before trusting a
  // QA-adjusted figure for a species whose reviewed sample skews toward one confidence band.
  function computeSpeciesStatsQaAdjusted(dataset, confusionBreakdown, minSample) {
    minSample = minSample || MIN_RELIABLE_SAMPLE;
    const confusionBySpecies = new Map((confusionBreakdown || []).map((c) => [c.species, c]));
    const weights = {};
    const nightsBySpecies = {};
    // Two distinct reasons a species' QA-adjusted number can differ from its raw one - worth
    // showing separately since they read differently: "ownCallsReassigned" means this species'
    // own unreviewed calls turned out to mostly be something else (its count likely dropped);
    // "receivedReassignedCalls" means it gained calls that were originally a different BTO primary
    // (its count likely rose). A species can be both at once.
    const ownCallsReassigned = new Set();
    const receivedReassignedCalls = new Set();
    const unadjustedLowSampleSpeciesNames = new Set();

    function addWeight(species, w, surveyDate) {
      weights[species] = (weights[species] || 0) + w;
      if (surveyDate) {
        nightsBySpecies[species] = nightsBySpecies[species] || new Set();
        nightsBySpecies[species].add(surveyDate);
      }
    }

    for (const row of dataset) {
      if (row.category !== 'bat') continue;
      if (row.source !== 'primary-bto') {
        // Already the reviewer's own finding (manual or manual-additional) - nothing to adjust.
        addWeight(row.finalId, 1, row.surveyDate);
        continue;
      }
      const confusion = confusionBySpecies.get(row.finalId);
      if (!confusion || confusion.reviewedSampleSize < minSample) {
        unadjustedLowSampleSpeciesNames.add(row.finalId);
        addWeight(row.finalId, 1, row.surveyDate);
        continue;
      }
      const retained = confusion.breakdown.find((t) => t.finalId === row.finalId);
      if (!retained || retained.pct < 100) ownCallsReassigned.add(row.finalId);
      for (const target of confusion.breakdown) {
        if (target.pct <= 0) continue;
        addWeight(target.finalId, target.pct / 100, row.surveyDate);
        if (target.finalId !== row.finalId) receivedReassignedCalls.add(target.finalId);
      }
    }

    const totalNightsInData = new Set(dataset.filter((d) => d.category === 'bat').map((d) => d.surveyDate).filter(Boolean)).size;
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    const composition = Object.entries(weights)
      .map(([species, weight]) => ({
        species, weight,
        pct: totalWeight ? (weight / totalWeight) * 100 : 0,
        activeNights: nightsBySpecies[species] ? nightsBySpecies[species].size : 0,
        detectionFrequencyPct: totalNightsInData && nightsBySpecies[species] ? (nightsBySpecies[species].size / totalNightsInData) * 100 : null,
        ownCallsReassigned: ownCallsReassigned.has(species),
        receivedReassignedCalls: receivedReassignedCalls.has(species),
      }))
      .sort((a, b) => b.weight - a.weight);

    return {
      richness: composition.length,
      totalWeight,
      composition,
      dominantSpecies: composition[0] || null,
      unadjustedLowSampleSpeciesNames: Array.from(unadjustedLowSampleSpeciesNames),
    };
  }

  ns.Stats = {
    buildAnalysisDataset,
    computeEffortStats,
    suggestValidRecordingHours,
    computeActivityStats,
    computeSpeciesStats,
    computeSpeciesStatsQaAdjusted,
    computeNightlyStats,
    computeHourlyActivity,
    computeHourlyActivityQaAdjusted,
    computeTimingStats,
    computeReliabilityStats,
    computeReliabilityByProbabilityBand,
    computeReliabilityBySpecies,
    computeConfusionBreakdown,
    computeAllStats,
    computeLocationComparison,
    mean, median, stdDev, percentile, wilsonInterval, compareSurveyDates,
  };
})(window.BatID);
