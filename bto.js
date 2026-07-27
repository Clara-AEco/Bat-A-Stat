// BTO Acoustic Pipeline CSV import -> Detection Events.
// One BTO row = one candidate species for one call segment. A segment is identified by
// (ORIGINAL FILE NAME, ORIGINAL FILE PART) and can carry several candidate-species rows.
// We group rows into Detection Events so stats/figures never double-count candidates.
window.BatID = window.BatID || {};

(function (ns) {
  const M = ns.Models;

  // Minimal RFC4180-ish CSV parser: handles quoted fields, embedded commas, escaped quotes ("").
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    // Normalise line endings first so \r\n / \r / \n all behave.
    const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => !(r.length === 1 && r[0] === ''));
  }

  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  function parseBtoCsv(csvText) {
    const rows = parseCsv(stripBom(csvText));
    if (rows.length === 0) return [];
    const header = rows[0].map((h) => h.trim());
    const idx = {};
    header.forEach((h, i) => { idx[h] = i; });
    const required = ['ORIGINAL FILE NAME', 'ORIGINAL FILE PART', 'SPECIES'];
    for (const col of required) {
      if (!(col in idx)) throw new Error(`Not a recognised BTO export - missing column "${col}"`);
    }
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (cells.length === 1 && cells[0].trim() === '') continue;
      const get = (col) => (idx[col] !== undefined ? (cells[idx[col]] || '').trim() : '');
      const probRaw = get('PROBABILITY');
      out.push({
        recordingFileName: get('RECORDING FILE NAME'),
        originalFileName: get('ORIGINAL FILE NAME'),
        originalFilePart: get('ORIGINAL FILE PART'),
        latitude: get('LATITUDE') ? parseFloat(get('LATITUDE')) : null,
        longitude: get('LONGITUDE') ? parseFloat(get('LONGITUDE')) : null,
        species: get('SPECIES'),
        scientificName: get('SCIENTIFIC NAME'),
        englishName: get('ENGLISH NAME'),
        group: get('SPECIES GROUP'),
        probability: probRaw ? parseFloat(probRaw) : null,
        warnings: get('WARNINGS'),
        callType: get('CALL TYPE'),
        actualDate: get('ACTUAL DATE'),
        surveyDate: get('SURVEY DATE'),
        time: get('TIME'),
        classifierName: get('CLASSIFIER NAME'),
        batchName: get('BATCH NAME'),
        projectName: get('PROJECT NAME'),
      });
    }
    return out;
  }

  // The stable identity of one physical call segment - the same key Detection Events are grouped
  // by below, so "does this segment already exist in the deployment" and "which rows belong
  // together" always agree with each other.
  function segmentKey(originalFileName, originalFilePart) {
    return `${originalFileName}::${originalFilePart}`;
  }

  // Group parsed rows into Detection Events. "No ID" rows (blank species name/group) still
  // become their own single-candidate event - they are not discarded. `existingKeys` (optional Set
  // of segmentKey values already present in the target deployment) lets a re-import of the same
  // BTO export skip segments already imported, rather than duplicating every event and Species
  // Detection Record - see importBtoIntoDeployment, which is what actually populates this.
  function groupIntoDetectionEvents(parsedRows, sourceBtoImportId, existingKeys) {
    const groups = new Map(); // key: originalFileName + '::' + originalFilePart
    let duplicateRowCount = 0;
    for (const row of parsedRows) {
      const key = segmentKey(row.originalFileName, row.originalFilePart);
      if (existingKeys && existingKeys.has(key)) { duplicateRowCount++; continue; }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const events = [];
    for (const [, rowsForSegment] of groups) {
      const first = rowsForSegment[0];
      const isNoId = rowsForSegment.every((r) => !r.englishName && !r.group && r.species === 'No ID');
      const candidateSpecies = isNoId ? [] : rowsForSegment.map((r) => ({
        species: r.species,
        scientificName: r.scientificName,
        englishName: r.englishName,
        group: r.group,
        probability: r.probability,
        warnings: r.warnings,
      }));
      const event = M.createDetectionEvent({
        originalWav: first.originalFileName,
        partNumber: first.originalFilePart,
        candidateSpecies,
        sourceBtoImportId,
        actualDate: first.actualDate,
        surveyDate: first.surveyDate,
        time: first.time,
        latitude: first.latitude,
        longitude: first.longitude,
      });
      events.push(event);
    }
    return { events, duplicateRowCount };
  }

  // Mutates `deployment` in place: adds a btoImports entry and appends the new Detection Events.
  // Segments (file+part) already present in this deployment - from an earlier import of the same
  // or an overlapping BTO export - are skipped rather than re-added, so re-importing the same CSV
  // (or a re-export that includes previously-imported segments) can't duplicate events or Species
  // Detection Records. Reports what actually happened so the analyst can see it, not just trust it.
  function importBtoIntoDeployment(deployment, csvText, fileName) {
    const parsedRows = parseBtoCsv(csvText);
    const importId = M.uid();
    deployment.detectionEvents = deployment.detectionEvents || [];
    const existingKeys = new Set(deployment.detectionEvents.map((e) => segmentKey(e.originalWav, e.partNumber)));
    const { events, duplicateRowCount } = groupIntoDetectionEvents(parsedRows, importId, existingKeys);
    const recordCount = events.reduce((sum, e) => sum + M.resolveSpeciesRecords(e).length, 0);
    deployment.btoImports = deployment.btoImports || [];
    deployment.btoImports.push({
      id: importId,
      fileName,
      importedAt: new Date().toISOString(),
      rowCount: parsedRows.length,
      eventCount: events.length,
      duplicateRowCount,
      eventIds: events.map((e) => e.id),
    });
    deployment.detectionEvents.push(...events);
    return { rowCount: parsedRows.length, eventCount: events.length, duplicateRowCount, recordCount };
  }

  ns.Bto = {
    parseCsv,
    parseBtoCsv,
    segmentKey,
    groupIntoDetectionEvents,
    importBtoIntoDeployment,
  };
})(window.BatID);
