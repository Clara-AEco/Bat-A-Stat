// WAV/RIFF parser -> Float32Array samples + format info, plus GUANO metadata chunk parsing.
window.BatID = window.BatID || {};

(function (ns) {
  // Parses an ArrayBuffer into { sampleRate, numChannels, bitsPerSample, samples: Float32Array (mono, channel 0), durationSec, guano }
  function parseWav(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (view.getUint32(0, false) !== 0x52494646) throw new Error('Not a RIFF file'); // "RIFF"
    if (view.getUint32(8, false) !== 0x57415645) throw new Error('Not a WAVE file'); // "WAVE"

    let pos = 12;
    let fmt = null;
    let dataOffset = null;
    let dataLength = null;
    let guano = null;

    while (pos + 8 <= view.byteLength) {
      const chunkId = String.fromCharCode(
        view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3)
      );
      const chunkSize = view.getUint32(pos + 4, true);
      const bodyStart = pos + 8;

      if (chunkId === 'fmt ') {
        fmt = {
          audioFormat: view.getUint16(bodyStart, true),
          numChannels: view.getUint16(bodyStart + 2, true),
          sampleRate: view.getUint32(bodyStart + 4, true),
          byteRate: view.getUint32(bodyStart + 8, true),
          blockAlign: view.getUint16(bodyStart + 12, true),
          bitsPerSample: view.getUint16(bodyStart + 14, true),
        };
      } else if (chunkId === 'data') {
        dataOffset = bodyStart;
        dataLength = chunkSize;
      } else if (chunkId === 'guan') {
        const bytes = new Uint8Array(arrayBuffer, bodyStart, chunkSize);
        guano = parseGuano(new TextDecoder('utf-8').decode(bytes));
      }

      pos = bodyStart + chunkSize + (chunkSize % 2); // chunks are word-aligned
    }

    if (!fmt) throw new Error('No fmt chunk found');
    if (dataOffset === null) throw new Error('No data chunk found');

    const samples = decodeSamples(view, dataOffset, dataLength, fmt);
    return {
      sampleRate: fmt.sampleRate,
      numChannels: fmt.numChannels,
      bitsPerSample: fmt.bitsPerSample,
      samples,
      durationSec: samples.length / fmt.sampleRate,
      guano,
    };
  }

  function decodeSamples(view, offset, length, fmt) {
    const channels = fmt.numChannels || 1;
    const bytesPerSample = fmt.bitsPerSample / 8;
    const frameCount = Math.floor(length / (bytesPerSample * channels));
    const out = new Float32Array(frameCount);

    for (let i = 0; i < frameCount; i++) {
      const base = offset + i * bytesPerSample * channels; // channel 0 only
      let v;
      if (fmt.audioFormat === 3 && fmt.bitsPerSample === 32) {
        v = view.getFloat32(base, true);
      } else if (fmt.bitsPerSample === 16) {
        v = view.getInt16(base, true) / 32768;
      } else if (fmt.bitsPerSample === 8) {
        v = (view.getUint8(base) - 128) / 128;
      } else if (fmt.bitsPerSample === 32) {
        v = view.getInt32(base, true) / 2147483648;
      } else if (fmt.bitsPerSample === 24) {
        const b0 = view.getUint8(base), b1 = view.getUint8(base + 1), b2 = view.getUint8(base + 2);
        let s = (b2 << 16) | (b1 << 8) | b0;
        if (s & 0x800000) s -= 0x1000000;
        v = s / 8388608;
      } else {
        throw new Error(`Unsupported bit depth: ${fmt.bitsPerSample}`);
      }
      out[i] = v;
    }
    return out;
  }

  // GUANO is "key: value" lines, with a "Namespace|Key: value" convention for vendor sections,
  // and starts with "GUANO|Version: x.y". We just flatten every line into a lookup by its last key segment.
  function parseGuano(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const fields = {};
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const rawKey = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      const key = rawKey.split('|').pop().trim();
      fields[key] = value;
    }
    let lat = null, lon = null;
    if (fields['Loc Position']) {
      const parts = fields['Loc Position'].split(/\s+/).map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) { lat = parts[0]; lon = parts[1]; }
    }
    return {
      make: fields['Make'] || null,
      model: fields['Model'] || null,
      serial: fields['Serial'] || null,
      firmware: fields['Firmware Version'] || null,
      timestamp: fields['Timestamp'] || null,
      lengthSec: fields['Length'] ? parseFloat(fields['Length']) : null,
      tempExt: fields['Temperature Ext'] ? parseFloat(fields['Temperature Ext']) : null,
      elevation: fields['Loc Elevation'] ? parseFloat(fields['Loc Elevation']) : null,
      triggerFreq: fields['Frequency'] ? parseFloat(fields['Frequency']) : null,
      latitude: lat,
      longitude: lon,
      raw: fields,
    };
  }

  // Attempts to find a "_YYYYMMDD_HHMMSS" timestamp in a filename (common detector naming
  // convention, e.g. S4U00485_20260617_221122.wav). Returns a Date or null.
  function parseTimestampFromFilename(fileName) {
    const m = fileName.match(/(\d{8})_(\d{6})/);
    if (!m) return null;
    const [, ymd, hms] = m;
    const year = +ymd.slice(0, 4), month = +ymd.slice(4, 6), day = +ymd.slice(6, 8);
    const hour = +hms.slice(0, 2), min = +hms.slice(2, 4), sec = +hms.slice(4, 6);
    const d = new Date(year, month - 1, day, hour, min, sec);
    return isNaN(d.getTime()) ? null : d;
  }

  ns.Wav = { parseWav, parseGuano, parseTimestampFromFilename };
})(window.BatID);
