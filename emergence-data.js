// Reference emergence/return times per UK bat species, for overlaying on the hourly activity
// chart so a night's activity can be read against "is this within the normal window for this
// species". Digitized from Clara's own source report:
//
//   Andrews H & Pearson L 2017 (June, v4). A Review of Empirical Data in Respect of Emergence
//   and Return Times Reported for the UK's 17 Native Bat Species. AEcol.
//   (c) AEcol 2017 - not reproduced here beyond the numeric figures needed for this overlay.
//
// The source report is NOT a single clean dataset - it collates multiple published studies per
// species, often split by sex/season, reported as mean/median/SD/"actual range" in inconsistent
// combinations, and several species have partial or no data for one direction (emergence/return).
// Rather than average across studies (which the source report itself explicitly avoids doing,
// see its own rationale section), ONE representative study was picked per species/direction using
// this priority order: (1) prefer a result with a genuine reported numeric range over a mean-only
// or median-only result, since the range is what actually gets drawn as a band on the chart;
// (2) prefer female data over male (most reported figures ARE female-only - maternity roost
// studies dominate this literature - so this also keeps species comparable to each other);
// (3) prefer a study covering a broad part of the season over one season-specific figure, where
// both exist and are otherwise similar in quality.
//
// Every entry's `source` field names exactly which figure was used, and `note` records anything
// that had to be derived (e.g. a mean computed as a range's midpoint because the source only gave
// a range) or any caveat worth knowing before trusting the number. Nothing here is invented -
// where the source has no usable figure for a species/direction, that field is null.
//
// Sign convention: emergence.meanMinutes is minutes AFTER sunset (negative = before sunset).
// return.meanMinutes is minutes BEFORE sunrise (negative = after sunrise). Converting a return
// figure into the hourly-activity chart's sunset-relative x-axis needs that specific night's own
// sunset->sunrise duration (via Sun.sunTimes) - done at chart-render time, not baked in here.
window.BatID = window.BatID || {};

(function (ns) {
  const DATA = {
    'barbastelle': {
      emergence: { meanMinutes: 24, rangeMinutes: [12, 36], source: 'Zeale et al. 2012 (F)', note: null },
      return: { meanMinutes: 194, rangeMinutes: [135, 254], source: 'Zeale et al. 2012 (F, pregnancy May/June)', note: 'Range is the study\'s own SD band, not an observed actual range - no actual range reported for return.' },
    },
    'serotine': {
      emergence: { meanMinutes: 11.6, rangeMinutes: [-15.75, 42], source: 'Catto et al. 1995 (mean, F)', note: 'Range taken from a different study (Petrzelkova & Zakul 2001) since Catto et al. reported no range of its own.' },
      return: { meanMinutes: 159, rangeMinutes: [9, 309], source: 'Catto et al. 1995 (F, pregnancy May/June)', note: 'No mean reported for return - mean is the midpoint of the study\'s own reported range.' },
    },
    "bechstein's bat": {
      emergence: { meanMinutes: 47, rangeMinutes: [-2, 92], source: 'Dietz & Pir 2011 (F)', note: 'Male figures also reported separately (mean 56, range 25-87) but not used here - F chosen as the more completely reported dataset.' },
      return: { meanMinutes: 60, rangeMinutes: [9, 77], source: 'Fitzsimons et al. 2002 (mean, F, all seasons)', note: 'Range taken from a different study (Dietz & Pir 2011, pregnancy) since Fitzsimons et al. reported no range of its own.' },
    },
    'alcathoe bat': {
      emergence: { meanMinutes: -1.1, rangeMinutes: [-33, 17], source: 'R. Baker, L. Whitfield & D. Whitby pers. comm. 2016 (F, n=11)', note: null },
      return: { meanMinutes: null, rangeMinutes: null, source: null, note: 'No return data reported for this species in the source.' },
    },
    "brandt's bat": {
      emergence: { meanMinutes: 27.3, rangeMinutes: [20, 35], source: 'Schmidt 2007 (F, May/June)', note: 'A broader but range-less figure also exists (Berge 2007, mean 43.3 min after, no season split) - the Schmidt figure was preferred here because it comes with an actual range to plot.' },
      return: { meanMinutes: 135.5, rangeMinutes: null, source: 'Berge 2007 (F, pregnancy May/June)', note: 'No range reported for return.' },
    },
    "daubenton's bat": {
      emergence: { meanMinutes: 46.1, rangeMinutes: [17, 94], source: 'Dietz & Kalko 2007 (F, May)', note: null },
      return: { meanMinutes: 40.5, rangeMinutes: [10, 90], source: 'Dietz & Kalko 2007 (F, lactation-June)', note: null },
    },
    'whiskered bat': {
      emergence: { meanMinutes: 33.3, rangeMinutes: null, source: 'Berge 2007 (F)', note: 'No range reported for emergence (a single "earliest starting 28 minutes after" observation exists from a different study, Jones & Rydell 1994, but that is not a full range).' },
      return: { meanMinutes: 126.9, rangeMinutes: null, source: 'Berge 2007 (F, pregnancy May/June)', note: 'No range reported for return.' },
    },
    "natterer's bat": {
      emergence: { meanMinutes: 55.9, rangeMinutes: [54.1, 57.7], source: 'Swift 1997 (median, F)', note: 'Reported as a median, not a mean.' },
      return: { meanMinutes: 40, rangeMinutes: [30, 50], source: 'Siemers et al. 1999 (F, weaning-August)', note: null },
    },
    "leisler's bat": {
      emergence: { meanMinutes: 18.6, rangeMinutes: [8.3, 26.9], source: 'Waters et al. 1999 (F)', note: null },
      return: { meanMinutes: 12, rangeMinutes: [0, 24], source: 'Waters et al. 1999 (F, lactation-July)', note: 'Assumes two foraging bouts per the source\'s own caveat.' },
    },
    'noctule': {
      emergence: { meanMinutes: 11, rangeMinutes: [7, 26], source: 'Kaňuch 2007 (mean, F)', note: null },
      return: { meanMinutes: null, rangeMinutes: null, source: null, note: 'Source reports return as "onset of civil twilight up to 3 minutes before sunrise" (Kaňuch 2007) - not expressed as clean minutes-before-sunrise, so not converted into a number here rather than guess one.' },
    },
    "nathusius' pipistrelle": {
      emergence: { meanMinutes: 30, rangeMinutes: [11, 50], source: 'Gelhaus & Zahn 2010 (F)', note: null },
      return: { meanMinutes: 30, rangeMinutes: [0, 60], source: 'Gelhaus & Zahn 2010 (F, pregnancy May/June)', note: 'No mean reported for return - mean is the midpoint of the study\'s own reported range ("60 minutes before up to sunrise").' },
    },
    'common pipistrelle': {
      emergence: { meanMinutes: 24.8, rangeMinutes: [6.9, 42.7], source: 'Davidson-Watts & Jones 2006 (mean, F)', note: null },
      return: { meanMinutes: 177.8, rangeMinutes: [66.1, 289.5], source: 'Davidson-Watts & Jones 2006 (F, pregnancy May/June)', note: null },
    },
    'soprano pipistrelle': {
      emergence: { meanMinutes: 33.5, rangeMinutes: [12, 55], source: 'Davidson-Watts & Jones 2006 (mean, F)', note: 'Preferred over Swift 1980\'s seasonal figures (mean 27-35 min after depending on month) since it uses the same method as the Common Pipistrelle figure above, keeping the two directly comparable.' },
      return: { meanMinutes: 268.8, rangeMinutes: [159.6, 378], source: 'Davidson-Watts & Jones 2006 (F, pregnancy May/June)', note: null },
    },
    'grey long-eared bat': {
      emergence: { meanMinutes: 36, rangeMinutes: [20, 52], source: 'Razgour et al. 2011 (mean, F)', note: 'Male figures also reported separately (mean 39, range 33-42) but not used here.' },
      return: { meanMinutes: 140, rangeMinutes: null, source: 'Scheunert et al. 2010 (F, pregnancy May/June)', note: 'No range reported. Other seasonal means also reported (lactation: at dawn i.e. 0; weaning: 55 min before) but not used here - pregnancy chosen as the most standard season to align with other species.' },
    },
    'brown long-eared bat': {
      emergence: { meanMinutes: 61.7, rangeMinutes: [57.4, 66], source: 'Entwistle et al. 1996 (mean, F)', note: null },
      return: { meanMinutes: 82.6, rangeMinutes: [73.5, 91.9], source: 'Entwistle et al. 1996 (F, pregnancy May/June)', note: null },
    },
    'greater horseshoe bat': {
      emergence: { meanMinutes: 28, rangeMinutes: [-4, 64], source: 'Robinson et al. 2000 (mean, F, May/June)', note: null },
      return: { meanMinutes: 34, rangeMinutes: [17, 49], source: 'Robinson et al. 2000 (F, pregnancy May/June)', note: null },
    },
    'lesser horseshoe bat': {
      emergence: { meanMinutes: 33, rangeMinutes: [30, 36], source: 'Knight 2006 (mean, F, May/June)', note: null },
      return: { meanMinutes: 36, rangeMinutes: [33, 39], source: 'Knight 2006 (F, pregnancy May/June)', note: null },
    },
  };
  // Greater mouse-eared bat is not covered by the source report (it is not one of the UK's 17
  // native breeding species the report reviews - effectively a vagrant with a single known UK
  // roost) - deliberately absent rather than guessed.

  function normalize(name) {
    return (name || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
  }

  function lookup(name) {
    return DATA[normalize(name)] || null;
  }

  ns.EmergenceData = { lookup };
})(window.BatID);
