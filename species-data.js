// Species reference ranges transcribed from Clara's "Bat Call Analysis Tool Full.xls" (List sheet),
// cross-checked against the BIG TOOL sheet's clean numeric min/max columns.
//
// Two single-cell typos were corrected using BIG TOOL's unambiguous numeric columns (mean sits
// outside the parsed range in the raw sheet, and BIG TOOL's plain numeric cell confirms the fix):
//   - Lesser horseshoe bat duration: sheet reads "43.6 (113 - 61.4)" -> min corrected to 11.9
//   - Serotine duration: sheet reads "51.1 (1.6 - 12.3)" -> mean corrected to 5.1
// Two genus spellings were corrected (Plectus -> Plecotus, the long-eared bat genus).
//
// NOT corrected: Noctule (qCF) vs Noctule (FM/qCF) have Start/End frequency values that look
// transposed between the List and BIG TOOL sheets (each sheet agrees on Start+End as a pair
// internally, but the two adjacent Noctule rows disagree on which pair belongs to which call
// type). Flagged for Clara to check against her source spreadsheet rather than silently guessed.
window.BatID = window.BatID || {};

(function (ns) {
  // range: [mean|null, min, max]
  function r(mean, min, max) { return { mean, min, max }; }

  const SPECIES = [
    { name: 'Greater horseshoe bat', sci: 'Rhinolophus ferrumequinum', shapeGroup: 'CF',
      ipi: r(90.2, 24.9, 186.6), duration: r(50.5, 16.3, 73.8), peak: r(81.3, 77.8, 83.8), start: r(70.2, 62.2, 78.5), end: r(67.3, 58.1, 80.9) },
    { name: 'Lesser horseshoe bat', sci: 'Rhinolophus hipposideros', shapeGroup: 'CF',
      ipi: r(70.4, 14.1, 113.7), duration: r(43.6, 11.9, 61.4), peak: r(111.1, 107.3, 114.0), start: r(99.0, 92.3, 107.8), end: r(96.6, 83.4, 110.3) },
    { name: 'Noctule (qCF)', sci: 'Nyctalus noctula', shapeGroup: 'qCF',
      ipi: r(372.2, 120.2, 807.2), duration: r(22.1, 13.2, 29.9), peak: r(19.3, 17.5, 23.6), start: r(23.7, 21.4, 32.2), end: r(18.3, 17.1, 23.0) },
    { name: "Leisler's bat (qCF)", sci: 'Nyctalus leisleri', shapeGroup: 'qCF',
      ipi: r(321.2, 100.2, 801.2), duration: r(17.1, 10.5, 25.1), peak: r(23.1, 21.9, 24.6), start: r(26.2, 23.5, 29.9), end: r(21.9, 20.9, 24.1) },
    { name: 'Noctule (FM/qCF)', sci: 'Nyctalus noctula', shapeGroup: 'FM-qCF',
      ipi: r(216.9, 120.3, 413.1), duration: r(14.7, 8.8, 23.4), peak: r(24.5, 22.4, 33.6), start: r(37.9, 23.8, 52.2), end: r(23.2, 18.2, 30.4) },
    { name: 'Serotine', sci: 'Eptesicus serotinus', shapeGroup: 'FM-qCF',
      ipi: r(126.0, 65.1, 159.0), duration: r(5.1, 1.6, 12.3), peak: r(25.9, 24.1, 32.2), start: r(58.4, 39.1, 78.0), end: r(27.5, 22.4, 32.0) },
    { name: "Leisler's bat (FM/qCF)", sci: 'Nyctalus leisleri', shapeGroup: 'FM-qCF',
      ipi: r(118.9, 107.3, 313.1), duration: r(8.3, 6.1, 18.4), peak: r(27.1, 25.0, 32.1), start: r(42.9, 29.8, 61.7), end: r(26.5, 24.2, 30.7) },
    { name: 'Grey long-eared bat', sci: 'Plecotus austriacus', shapeGroup: 'FM',
      ipi: r(105.0, 35.8, 194.0), duration: r(3.8, 1.4, 7.0), peak: r(32.6, 26.3, 60.5), start: r(43.4, 35.4, 55.9), end: r(23.6, 17.0, 31.7) },
    { name: 'Barbastelle (FM)', sci: 'Barbastella barbastellus', shapeGroup: 'FM',
      ipi: r(108.4, 41.8, 229.0), duration: r(3.4, 2.5, 5.1), peak: r(32.9, 29.2, 44.7), start: r(39.4, 35.2, 49.0), end: r(28.0, 23.8, 36.8) },
    { name: 'Brown long-eared bat', sci: 'Plecotus auritus', shapeGroup: 'FM',
      ipi: r(76.8, 21.8, 172.4), duration: r(2.3, 1.2, 3.8), peak: r(33.1, 25.5, 42.1), start: r(50.0, 31.9, 63.8), end: r(25.0, 19.0, 30.9) },
    { name: 'Greater mouse-eared bat', sci: 'Myotis myotis', shapeGroup: 'FM',
      ipi: r(109.6, 46.6, 159.1), duration: r(4.6, 2.5, 7.1), peak: r(36.1, 31.5, 53.9), start: r(79.6, 52.2, 104.5), end: r(27.9, 24.1, 37.0) },
    { name: "Nathusius' pipistrelle", sci: 'Pipistrellus nathusii', shapeGroup: 'FM-qCF',
      ipi: r(129.0, 88.6, 237.0), duration: r(5.88, 3.0, 7.9), peak: r(39.3, 35.5, 41.9), start: r(51.1, 40.0, 66.8), end: r(36.9, 35.2, 38.9) },
    { name: 'Barbastelle (FM/qCF)', sci: 'Barbastella barbastellus', shapeGroup: 'FM-qCF',
      ipi: r(72.4, 43.2, 144.9), duration: r(4.3, 2.0, 6.6), peak: r(41.6, 33.5, 43.8), start: r(44.1, 36.6, 47.3), end: r(28.9, 25.4, 31.9) },
    { name: 'Common pipistrelle', sci: 'Pipistrellus pipistrellus', shapeGroup: 'FM-qCF',
      ipi: r(102.5, 59.9, 211.0), duration: r(5.9, 3.2, 8.6), peak: r(46.6, 43.3, 49.9), start: r(68.8, 50.8, 95.2), end: r(45.9, 41.2, 50.6) },
    { name: "Brandt's Bat", sci: 'Myotis brandtii', shapeGroup: 'FM',
      ipi: r(88.0, 56.7, 161.0), duration: r(3.5, 1.5, 5.0), peak: r(46.7, 38.0, 78.4), start: r(91.6, 59.0, 121.9), end: r(34.0, 25.8, 41.8) },
    { name: "Natterer's bat", sci: 'Myotis nattereri', shapeGroup: 'FM',
      ipi: r(80.1, 31.6, 188.9), duration: r(4.7, 1.9, 7.1), peak: r(46.9, 36.0, 66.8), start: r(106.8, 72.1, 145.3), end: r(22.8, 14.9, 29.0) },
    { name: "Daubenton's bat", sci: 'Myotis daubentonii', shapeGroup: 'FM',
      ipi: r(75.5, 27.5, 186.0), duration: r(3.2, 1.4, 5.8), peak: r(47.0, 41.8, 56.5), start: r(81.1, 50.3, 109.7), end: r(29.4, 22.4, 38.6) },
    { name: 'Whiskered bat', sci: 'Myotis mystacinus', shapeGroup: 'FM',
      ipi: r(113.0, 66.7, 251.5), duration: r(4.2, 3.1, 6.4), peak: r(47.5, 39.2, 68.5), start: r(88.3, 69.9, 101.8), end: r(32.4, 25.6, 43.3) },
    { name: "Bechstein's bat", sci: 'Myotis bechsteinii', shapeGroup: 'FM',
      ipi: r(96.4, 79.4, 188.9), duration: r(2.4, 1.6, 3.5), peak: r(51.0, 45.1, 55.9), start: r(116.2, 65.0, 130.9), end: r(32.9, 28.0, 40.4) },
    { name: 'Alcathoe bat', sci: 'Myotis alcathoe', shapeGroup: 'FM',
      ipi: r(null, 47.0, 99.0), duration: r(null, 2.0, 4.0), peak: r(52.5, 42.9, 61.9), start: r(null, 110.0, 120.0), end: r(43.0, 40.0, 50.0) },
    { name: 'Soprano pipistrelle', sci: 'Pipistrellus pygmaeus', shapeGroup: 'FM-qCF',
      ipi: r(89.1, 51.0, 217.1), duration: r(5.5, 2.1, 8.2), peak: r(55.1, 50.2, 64.1), start: r(79.6, 63.8, 108.6), end: r(56.8, 53.2, 60.6) },
  ];

  const SHAPE_LABELS = ['CF', 'qCF', 'FM', 'FM-qCF', 'FM-CF-FM', 'unclassified'];

  function inRange(value, range) {
    if (value == null || range == null) return null; // not evaluable
    return value >= range.min && value <= range.max;
  }

  // Relative importance of each parameter in the ranking (Clara's call): peak frequency and
  // call shape matter most, duration next, start/end frequency matter least (and are weighted
  // equally with each other). These are weights, not pass/fail cutoffs - every check still
  // shows its own tick/cross in the UI so the reasoning stays visible.
  const CHECK_WEIGHTS = { shape: 4, peak: 4, duration: 2, start: 1, end: 1, ipi: 1 };

  // Scores every species against a measured call. `measured` = { peak, start, end, duration, ipi } (kHz/ms, any may be null).
  // `shapeGroup` (optional) is scored as its own weighted check (see CHECK_WEIGHTS) rather than
  // just a tie-breaker - matches the training material's own warning that automated classifiers
  // shouldn't be trusted blindly, so this stays a ranked suggestion, never a hard filter.
  function scoreSpecies(measured, shapeGroup) {
    const results = SPECIES.map((sp) => {
      const checks = {
        peak: inRange(measured.peak, sp.peak),
        start: inRange(measured.start, sp.start),
        end: inRange(measured.end, sp.end),
        duration: inRange(measured.duration, sp.duration),
        ipi: inRange(measured.ipi, sp.ipi),
        shape: shapeGroup ? sp.shapeGroup === shapeGroup : null,
      };
      const evaluatedKeys = Object.keys(checks).filter((k) => checks[k] !== null);
      const passed = evaluatedKeys.filter((k) => checks[k] === true).length;
      const weightTotal = evaluatedKeys.reduce((sum, k) => sum + CHECK_WEIGHTS[k], 0);
      const weightPassed = evaluatedKeys.filter((k) => checks[k] === true).reduce((sum, k) => sum + CHECK_WEIGHTS[k], 0);
      return {
        species: sp,
        checks,
        passed,
        evaluated: evaluatedKeys.length,
        score: weightTotal ? weightPassed / weightTotal : 0,
        shapeMatch: checks.shape,
      };
    });
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.passed - a.passed;
    });
    return results;
  }

  ns.SpeciesData = { SPECIES, SHAPE_LABELS, inRange, scoreSpecies };
})(window.BatID);
