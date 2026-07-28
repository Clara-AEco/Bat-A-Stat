// Data/figure export engine (corrective brief section 21). Every function here serializes data
// that has ALREADY been computed by stats.js and is already on screen somewhere - nothing in this
// file recalculates a statistic itself, so an exported number can never silently disagree with
// what the UI shows for the same deployment (brief section 25's "exported activity equals the
// activity shown in the UI"). No bundled library: CSV is plain text; the "Excel" export is
// SpreadsheetML (Office's 2003 XML workbook format) - genuinely opens in Excel with separate named
// sheets, but is just a string template, so it needs nothing vendored for Clara's locked-down
// laptop. Figure export (PNG/SVG) uses only the browser's native Canvas/Blob APIs.
window.BatID = window.BatID || {};

(function (ns) {
  function csvEscape(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function rowsToCsv(header, rows) {
    return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
  }

  function downloadTextFile(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------------- CSV builders (brief section 21.1) ----------------

  // One row per Survey Night, including zero-activity and non-valid ones - the brief's own test
  // #49 ("CSV exports zero-activity nights") is exactly what this guarantees by reading
  // deployment.surveyNights directly rather than only nights that appear in activity.nightlyBreakdown.
  function surveyNightsToCsv(deployment) {
    const header = ['Survey Date', 'Status', 'Valid Hours', 'Sunset', 'Sunrise', 'Recording Condition Notes', 'Notes'];
    const rows = (deployment.surveyNights || []).map((n) => [
      n.surveyDate, n.status, n.validHours, n.sunset || '', n.sunrise || '', n.recordingConditions || '', n.notes || '',
    ]);
    return rowsToCsv(header, rows);
  }

  // One row per Species Detection Record - per the project's own definition (brief section 1.2),
  // that means retained BAT taxa only; a multi-species event produces multiple rows here. Noise/
  // other-taxon/still-unidentified rows are real data too but are a different thing, not a
  // Species Detection Record - they're covered by the QA-coverage and Original-BTO exports instead.
  function speciesDetectionRecordsToCsv(stats) {
    const header = ['Survey Date', 'Final ID', 'Source', 'Timestamp'];
    const rows = (stats.dataset || []).filter((d) => d.category === 'bat').map((d) => [
      d.surveyDate || '', d.finalId, d.source, d.dateTime ? d.dateTime.toISOString() : '',
    ]);
    return rowsToCsv(header, rows);
  }

  // Append-only manual-review decision log across every Detection Event (brief section 5.2 /
  // Phase 1's Models.appendReviewHistory) - one row per historical decision, not just the latest.
  function reviewHistoryToCsv(deployment) {
    const header = ['Original WAV', 'Part', 'Version', 'Action', 'Previous Final ID', 'New Final ID', 'Reviewer', 'Timestamp', 'Comments'];
    const rows = [];
    for (const ev of deployment.detectionEvents || []) {
      for (const h of (ev.manualReview && ev.manualReview.history) || []) {
        rows.push([ev.originalWav, ev.partNumber, h.version, h.action, h.previousFinalId || '', h.newFinalId || '', h.reviewer || '', h.timestamp, h.comments || '']);
      }
    }
    return rowsToCsv(header, rows);
  }

  // Original BTO baseline (brief section 6.1) - automated IDs alone at the configured confidence
  // floor, no manual review consulted. Kept separate from resolved observed (below) so the two
  // never get merged into one ambiguous table (brief section 21.2's explicit warning).
  function originalBtoStatsToCsv(stats) {
    const header = ['Survey Date', 'Bat Detections (Original BTO)'];
    const rows = (stats.originalBto.nightlyBreakdown || []).map((n) => [n.surveyDate, n.count]);
    rows.push(['TOTAL', stats.originalBto.totalActivity]);
    rows.push(['Confidence threshold used', `>=${stats.originalBto.threshold}%`]);
    return rowsToCsv(header, rows);
  }

  // Resolved observed species composition (brief section 6.2) - the deployment's working
  // analysis figure: manual review applied where it exists, otherwise BTO's primary regardless of
  // its confidence.
  function resolvedObservedStatsToCsv(stats) {
    const header = ['Species', 'Count', '% of Total', 'Active Nights', 'Detection Frequency %'];
    const rows = (stats.species.composition || []).map((s) => [
      s.species, s.count, s.pct.toFixed(2), s.activeNights, s.detectionFrequencyPct != null ? s.detectionFrequencyPct.toFixed(2) : '',
    ]);
    return rowsToCsv(header, rows);
  }

  // QA-adjusted ESTIMATE (brief section 6.3) - modelled, never overwrites the resolved observed
  // table above; "Estimated" is in every relevant column header, not left implicit.
  function qaAdjustedEstimatesToCsv(stats) {
    const header = ['Species', 'Estimated Count', '% of Total (Estimated)', 'Active Nights', 'Detection Frequency % (Estimated)'];
    const rows = (stats.speciesQaAdjusted.composition || []).map((s) => [
      s.species, s.weight.toFixed(2), s.pct.toFixed(2), s.activeNights, s.detectionFrequencyPct != null ? s.detectionFrequencyPct.toFixed(2) : '',
    ]);
    return rowsToCsv(header, rows);
  }

  // Per-night activity (Level 1A) including the descriptive influential-night metrics added in
  // the corrective brief pass (no statistical-significance claim - see computeNightlyStats).
  function nightlyActivityToCsv(stats) {
    const header = ['Survey Date', 'Bat Detections', 'Richness', 'Dominant Species', '% of Total Activity', 'Rank', 'High Contribution'];
    const rows = (stats.nightly.perNight || []).map((n) => [
      n.surveyDate, n.batDetections, n.richness, n.dominantSpecies || '', n.contributionPct.toFixed(2), n.rank, n.isHighContribution ? 'Yes' : 'No',
    ]);
    return rowsToCsv(header, rows);
  }

  // 15-minute (or whatever binSizeHours the caller used) activity table - one row per Survey
  // Night, one column per bin, plus Mean/Median/Pooled summary rows (brief section 11).
  function hourlyActivityToCsv(hourly) {
    const binLabel = (b) => (hourly.sunsetRelative ? `${b >= 0 ? '+' : ''}${b}h` : `${String(((b % 24) + 24) % 24).padStart(2, '0')}:00`);
    const header = ['Survey Date', ...hourly.bins.map(binLabel)];
    const rows = hourly.rows.map((r) => [r.surveyDate, ...r.counts.map((c) => (Number.isInteger(c) ? c : c.toFixed(2)))]);
    rows.push(['Mean', ...hourly.binMeans.map((m) => m.toFixed(2))]);
    rows.push(['Median', ...hourly.binMedians.map((m) => m.toFixed(2))]);
    rows.push(['Pooled (sum)', ...hourly.binTotals]);
    return rowsToCsv(header, rows);
  }

  // QA calibration diagnostics: confusion breakdown (what reviewed calls of each BTO primary
  // actually resolved to) and per-species reliability with its fallback level - the evidence
  // behind every QA-adjusted number, not just the number itself.
  function qaCalibrationToCsv(stats) {
    const header = ['BTO Primary', 'Resolved To', 'Count', '% of Reviewed', 'Reliability Fallback Level', 'Reliability %', '95% CI Lower', '95% CI Upper'];
    const reliabilityBySpecies = new Map((stats.reliabilityBySpecies || []).map((r) => [r.species, r]));
    const rows = [];
    for (const c of stats.confusionBreakdown || []) {
      const rel = reliabilityBySpecies.get(c.species);
      for (const t of c.breakdown) {
        rows.push([
          c.species, t.finalId, t.count, t.pct.toFixed(2),
          rel ? rel.fallbackLevel : '', rel && rel.primaryIdReliabilityPct != null ? rel.primaryIdReliabilityPct.toFixed(2) : '',
          rel && rel.primaryIdReliabilityCiLowerPct != null ? rel.primaryIdReliabilityCiLowerPct.toFixed(2) : '',
          rel && rel.primaryIdReliabilityCiUpperPct != null ? rel.primaryIdReliabilityCiUpperPct.toFixed(2) : '',
        ]);
      }
    }
    return rowsToCsv(header, rows);
  }

  // ---------------- "Excel" multi-sheet export (brief section 21.2) ----------------

  function xmlEscape(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // One SpreadsheetML (Office 2003 XML) cell - numbers get a Number type so Excel sorts/sums them
  // correctly instead of treating everything as text.
  function xmlCell(v) {
    if (typeof v === 'number' && isFinite(v)) return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
    return `<Cell><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`;
  }

  // Builds one .xls file (SpreadsheetML) containing several separately-named worksheets - Excel
  // opens this natively as a real multi-sheet workbook. `sheets`: [{ name, header, rows }].
  // Deliberately NOT a real .xlsx binary (that needs a vendored library, e.g. SheetJS, which isn't
  // included here) - SpreadsheetML is plain XML text that needs nothing bundled, at the cost of a
  // larger file than a real .xlsx would be. Sheet names are truncated to Excel's 31-character
  // limit and de-duplicated so two similarly-named sheets don't collide.
  function buildWorkbookXml(sheets) {
    const usedNames = new Set();
    const worksheets = sheets.map((sheet) => {
      let name = (sheet.name || 'Sheet').slice(0, 31);
      let suffix = 1;
      while (usedNames.has(name)) { name = `${sheet.name.slice(0, 28)}(${++suffix})`; }
      usedNames.add(name);
      const rowsXml = [sheet.header, ...sheet.rows]
        .map((r) => `<Row>${r.map(xmlCell).join('')}</Row>`)
        .join('');
      return `<Worksheet ss:Name="${xmlEscape(name)}"><Table>${rowsXml}</Table></Worksheet>`;
    }).join('');
    return `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${worksheets}</Workbook>`;
  }

  function downloadWorkbook(filename, sheets) {
    downloadTextFile(filename, buildWorkbookXml(sheets), 'application/vnd.ms-excel');
  }

  // Assembles the full brief-section-21.2 sheet set for one deployment: Survey Nights, Species
  // Records, Review History, Observed (resolved) Activity, Estimated (QA-adjusted) Activity,
  // Nightly Activity, QA Calibration - kept as separate sheets rather than merged into one
  // ambiguous table, per the brief's own explicit instruction.
  function deploymentWorkbookSheets(deployment, stats) {
    function parseCsvBack(csvText) {
      // Reuses the CSV builders above (single source of the actual values) rather than
      // duplicating each table's construction a second time for the XML format - splits the CSV
      // back into header + rows. Safe here because none of these tables contain embedded newlines
      // inside a quoted field (species names/dates/numbers only).
      const lines = csvText.trim().split('\n');
      return { header: lines[0].split(',').map((c) => c.replace(/^"|"$/g, '')), rows: lines.slice(1).map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, ''))) };
    }
    const surveyNights = parseCsvBack(surveyNightsToCsv(deployment));
    const records = parseCsvBack(speciesDetectionRecordsToCsv(stats));
    const history = parseCsvBack(reviewHistoryToCsv(deployment));
    const originalBto = parseCsvBack(originalBtoStatsToCsv(stats));
    const observed = parseCsvBack(resolvedObservedStatsToCsv(stats));
    const estimated = parseCsvBack(qaAdjustedEstimatesToCsv(stats));
    const nightly = parseCsvBack(nightlyActivityToCsv(stats));
    const calibration = parseCsvBack(qaCalibrationToCsv(stats));
    return [
      { name: 'Survey Nights', header: surveyNights.header, rows: surveyNights.rows },
      { name: 'Species Records', header: records.header, rows: records.rows },
      { name: 'Review History', header: history.header, rows: history.rows },
      { name: 'Original BTO Activity', header: originalBto.header, rows: originalBto.rows },
      { name: 'Observed Activity', header: observed.header, rows: observed.rows },
      { name: 'Estimated Activity', header: estimated.header, rows: estimated.rows },
      { name: 'Nightly Activity', header: nightly.header, rows: nightly.rows },
      { name: 'QA Calibration', header: calibration.header, rows: calibration.rows },
    ];
  }

  // ---------------- Figure export (brief section 21.3: PNG/SVG; PDF is out of scope here - see
  // the Reports tab's browser-print path instead, which needs no bundled library) ----------------

  function downloadSvgAsSvgFile(svgEl, filename) {
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgEl);
    if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
      source = source.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    downloadTextFile(filename, source, 'image/svg+xml');
  }

  // Rasterises the SVG onto an offscreen canvas at 2x for print-quality output, then downloads a
  // PNG - native Canvas/Image APIs only, nothing bundled.
  function downloadSvgAsPng(svgEl, filename, scale) {
    scale = scale || 2;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    const viewBox = (svgEl.getAttribute('viewBox') || '0 0 720 240').split(/\s+/).map(Number);
    const width = viewBox[2] || 720, height = viewBox[3] || 240;
    const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    return new Promise((resolve, reject) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width * scale; canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#14171a'; // matches the app's own dark background, so the PNG isn't transparent-onto-white
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          const pngUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = pngUrl; a.download = filename;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(pngUrl);
          resolve();
        }, 'image/png');
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  ns.Exports = {
    csvEscape, rowsToCsv, downloadTextFile,
    surveyNightsToCsv, speciesDetectionRecordsToCsv, reviewHistoryToCsv,
    originalBtoStatsToCsv, resolvedObservedStatsToCsv, qaAdjustedEstimatesToCsv,
    nightlyActivityToCsv, hourlyActivityToCsv, qaCalibrationToCsv,
    buildWorkbookXml, downloadWorkbook, deploymentWorkbookSheets,
    downloadSvgAsSvgFile, downloadSvgAsPng,
  };
})(window.BatID);
