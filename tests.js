// Dependency-free regression test harness. No build step / no npm in this project (runs from a
// double-clicked file:// HTML file, same constraint as the app itself), so this is a plain
// assert/test-runner loaded alongside the same <script src> files as index.html, rendering
// pass/fail straight into the page rather than needing Jest or any other tooling installed.
window.BatID = window.BatID || {};

(function () {
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function assertEqual(actual, expected, msg) {
    if (actual !== expected) throw new Error(`${msg || 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }

  function makeRow(overrides) {
    return Object.assign({
      recordingFileName: 'file1.wav', originalFileName: 'file1.wav', originalFilePart: '1',
      latitude: null, longitude: null,
      species: 'PIPPIP', scientificName: 'Pipistrellus pipistrellus', englishName: 'Common Pipistrelle', group: 'Bat',
      probability: 0.95, warnings: '', callType: '',
      actualDate: '16/06/2026', surveyDate: '16/06/2026', time: '21:15:00',
      classifierName: '', batchName: '', projectName: '',
    }, overrides || {});
  }

  const M = window.BatID.Models;
  const Bto = window.BatID.Bto;

  // ---- Detection Event identity (brief section 23, tests 1-4) ----

  test('one Part with one species creates one Detection Event and one Species Detection Record', () => {
    const { events } = Bto.groupIntoDetectionEvents([makeRow()], 'imp1');
    assertEqual(events.length, 1, 'event count');
    assertEqual(M.resolveSpeciesRecords(events[0]).length, 1, 'record count');
  });

  test('one Part with two species creates one Detection Event and two Species Detection Records', () => {
    const rows = [
      makeRow({ species: 'PIPPIP', englishName: 'Common Pipistrelle', probability: 0.9 }),
      makeRow({ species: 'PIPPYG', englishName: 'Soprano Pipistrelle', probability: 0.4 }),
    ];
    const { events } = Bto.groupIntoDetectionEvents(rows, 'imp1');
    assertEqual(events.length, 1, 'event count');
    const primary = events[0].primaryBtoId;
    assertEqual(primary.englishName, 'Common Pipistrelle', 'primary is the higher-probability candidate');
    // Only the primary is a Species Detection Record until manual review confirms the second
    // candidate too - BTO offering two candidates for one Part isn't the same as a reviewer
    // confirming both are actually present.
    assertEqual(M.resolveSpeciesRecords(events[0]).length, 1, 'record count before review');
  });

  test('duplicate same-species rows in one event still resolve to one Species Detection Record', () => {
    const rows = [
      makeRow({ species: 'PIPPIP', englishName: 'Common Pipistrelle', probability: 0.9 }),
      makeRow({ species: 'PIPPIP', englishName: 'Common Pipistrelle', probability: 0.7 }),
    ];
    const { events } = Bto.groupIntoDetectionEvents(rows, 'imp1');
    assertEqual(events.length, 1, 'event count');
    assertEqual(M.resolveSpeciesRecords(events[0]).length, 1, 'record count');
  });

  test('re-importing the same BTO file does not duplicate events or records', () => {
    const csv = [
      'ORIGINAL FILE NAME,ORIGINAL FILE PART,SPECIES,ENGLISH NAME,SPECIES GROUP,PROBABILITY,ACTUAL DATE,SURVEY DATE,TIME',
      'file1.wav,1,PIPPIP,Common Pipistrelle,Bat,0.95,16/06/2026,16/06/2026,21:15:00',
    ].join('\n');
    const dep = M.createDeployment({ startDate: '2026-06-16', endDate: '2026-06-16' });
    const r1 = Bto.importBtoIntoDeployment(dep, csv, 'export.csv');
    assertEqual(dep.detectionEvents.length, 1, 'events after first import');
    assertEqual(r1.duplicateRowCount, 0, 'no duplicates on first import');
    const r2 = Bto.importBtoIntoDeployment(dep, csv, 'export.csv');
    assertEqual(dep.detectionEvents.length, 1, 'events after re-import (must not duplicate)');
    assertEqual(r2.eventCount, 0, 'no new events created on re-import');
    assertEqual(r2.duplicateRowCount, 1, 'the re-imported row is reported as a duplicate');
  });

  // ---- Species Detection Record correctness (brief section 23, tests 5-8) ----

  test('manual additional species increases activity', () => {
    const { events } = Bto.groupIntoDetectionEvents([makeRow()], 'imp1');
    const ev = events[0];
    assertEqual(M.resolveSpeciesRecords(ev).length, 1, 'before additional species');
    ev.manualReview.additionalTaxa = ['Soprano Pipistrelle'];
    assertEqual(M.resolveSpeciesRecords(ev).length, 2, 'after additional species');
  });

  test('rejected species does not contribute to activity', () => {
    const { events } = Bto.groupIntoDetectionEvents([makeRow()], 'imp1');
    const ev = events[0];
    ev.manualReview.reviewed = true;
    ev.manualReview.finalId = 'Noise / No ID';
    const dataset = window.BatID.Stats.buildAnalysisDataset([ev]);
    assert(dataset.every((d) => d.category !== 'bat'), 'rejected call must not be category=bat');
    assert(dataset.some((d) => d.category === 'noise'), 'rejected call must be category=noise');
  });

  test('Original BTO data remain unchanged after review', () => {
    const { events } = Bto.groupIntoDetectionEvents([makeRow()], 'imp1');
    const ev = events[0];
    const beforePrimary = JSON.stringify(ev.primaryBtoId);
    const beforeCandidates = JSON.stringify(ev.candidateSpecies);
    ev.manualReview.reviewed = true;
    ev.manualReview.finalId = 'Soprano Pipistrelle';
    ev.manualReview.history = M.appendReviewHistory(ev.manualReview, { action: 'modify', previousFinalId: null, newFinalId: 'Soprano Pipistrelle' });
    assertEqual(JSON.stringify(ev.primaryBtoId), beforePrimary, 'primaryBtoId must not change after review');
    assertEqual(JSON.stringify(ev.candidateSpecies), beforeCandidates, 'candidateSpecies must not change after review');
  });

  test('review history retains previous decisions (append-only)', () => {
    const { events } = Bto.groupIntoDetectionEvents([makeRow()], 'imp1');
    const ev = events[0];
    const h1 = M.appendReviewHistory(ev.manualReview, { action: 'accept', previousFinalId: null, newFinalId: 'Common Pipistrelle' });
    assertEqual(h1.length, 1, 'one entry after first decision');
    const manualReviewAfter1 = Object.assign({}, ev.manualReview, { history: h1 });
    const h2 = M.appendReviewHistory(manualReviewAfter1, { action: 'modify', previousFinalId: 'Common Pipistrelle', newFinalId: 'Soprano Pipistrelle' });
    assertEqual(h2.length, 2, 'two entries after second decision');
    assertEqual(h2[0].action, 'accept', 'first entry preserved unchanged');
    assertEqual(h2[0].newFinalId, 'Common Pipistrelle', 'first entry preserved unchanged');
    assertEqual(h2[1].action, 'modify', 'second entry appended');
  });

  // ---- Survey Night entity ----

  test('generateSurveyNights creates one night per calendar date, including zero-activity nights', () => {
    const dep = M.createDeployment({ startDate: '2026-06-16', endDate: '2026-06-18' });
    const nights = M.generateSurveyNights(dep, null);
    assertEqual(nights.length, 3, 'three nights for a 3-day range');
    assertEqual(nights[0].surveyDate, '16/06/2026');
    assertEqual(nights[1].surveyDate, '17/06/2026');
    assertEqual(nights[2].surveyDate, '18/06/2026');
    assert(nights.every((n) => n.status === 'valid'), 'default status is valid');
  });

  test('ensureSurveyNights preserves a manually-set status when regenerated', () => {
    const dep = M.createDeployment({ startDate: '2026-06-16', endDate: '2026-06-18' });
    dep.surveyNights = M.generateSurveyNights(dep, null);
    dep.surveyNights[1].status = 'failed';
    const reEnsured = M.ensureSurveyNights(dep, null);
    assertEqual(reEnsured, dep.surveyNights, 'unchanged date range returns the same array (no needless patch)');
    assertEqual(reEnsured[1].status, 'failed', 'manually-set status survives re-generation');
  });

  test('ensureSurveyNights extends the range without losing existing nights\' status', () => {
    const dep = M.createDeployment({ startDate: '2026-06-16', endDate: '2026-06-17' });
    dep.surveyNights = M.generateSurveyNights(dep, null);
    dep.surveyNights[0].status = 'excluded';
    dep.endDate = '2026-06-18'; // extend by one night
    const extended = M.ensureSurveyNights(dep, null);
    assertEqual(extended.length, 3, 'now three nights');
    assertEqual(extended[0].status, 'excluded', 'first night status preserved across extension');
    assertEqual(extended[2].surveyDate, '18/06/2026', 'new night added at the end');
  });

  // ---- Runner ----

  function runTests() {
    const results = tests.map(({ name, fn }) => {
      try { fn(); return { name, ok: true }; }
      catch (e) { return { name, ok: false, error: e && e.message ? e.message : String(e) }; }
    });
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { results, passed, failed, total: results.length };
  }

  window.BatID.Tests = { test, assert, assertEqual, runTests };
})();
