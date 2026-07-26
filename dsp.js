// FFT / spectrogram / oscillogram / measurement / shape-classification engine.
window.BatID = window.BatID || {};

(function (ns) {
  // ---------------- FFT ----------------

  // In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` are Float64Array of length n (power of 2).
  function fftInPlace(re, im) {
    const n = re.length;
    // Bit-reversal permutation.
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curWr = 1, curWi = 0;
        for (let k = 0; k < len / 2; k++) {
          const uRe = re[i + k], uIm = im[i + k];
          const vRe = re[i + k + len / 2] * curWr - im[i + k + len / 2] * curWi;
          const vIm = re[i + k + len / 2] * curWi + im[i + k + len / 2] * curWr;
          re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
          re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
          const nextWr = curWr * wr - curWi * wi;
          curWi = curWr * wi + curWi * wr;
          curWr = nextWr;
        }
      }
    }
  }

  function hannWindow(size) {
    const w = new Float32Array(size);
    for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    return w;
  }

  // ---------------- Spectrogram ----------------

  const FFT_SIZES = [64, 128, 256, 512, 1024, 2048];
  // Some detectors save long continuous recordings rather than short trigger clips. Analysing
  // the whole thing at full STFT resolution can mean tens of millions of samples - capping
  // keeps compute time and memory bounded. The caller is told when truncation happened.
  const MAX_ANALYSIS_DURATION_SEC = 30;

  function computeSpectrogram(samples, sampleRate, fftSize, hopSize, maxDurationSec) {
    hopSize = hopSize || Math.floor(fftSize / 2);
    maxDurationSec = maxDurationSec == null ? MAX_ANALYSIS_DURATION_SEC : maxDurationSec;
    const maxSamples = Math.floor(maxDurationSec * sampleRate);
    const truncated = samples.length > maxSamples;
    if (truncated) samples = samples.subarray(0, maxSamples);

    const window = hannWindow(fftSize);
    const numBins = fftSize / 2 + 1;
    const numFrames = Math.max(1, Math.floor((samples.length - fftSize) / hopSize) + 1);
    const magDb = new Float32Array(numFrames * numBins);
    const frameTimes = new Float32Array(numFrames);
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    const EPS = 1e-9;

    for (let f = 0; f < numFrames; f++) {
      const start = f * hopSize;
      for (let i = 0; i < fftSize; i++) {
        const s = start + i < samples.length ? samples[start + i] : 0;
        re[i] = s * window[i];
        im[i] = 0;
      }
      fftInPlace(re, im);
      for (let b = 0; b < numBins; b++) {
        const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]) / fftSize;
        magDb[f * numBins + b] = 20 * Math.log10(mag + EPS);
      }
      frameTimes[f] = (start + fftSize / 2) / sampleRate;
    }

    const freqs = new Float32Array(numBins);
    for (let b = 0; b < numBins; b++) freqs[b] = (b * sampleRate) / fftSize;

    return { numFrames, numBins, magDb, frameTimes, freqs, sampleRate, fftSize, hopSize, durationSec: samples.length / sampleRate, truncated };
  }

  function frameIndexForTime(spec, t) {
    if (spec.numFrames <= 1) return 0;
    const dt = spec.frameTimes[1] - spec.frameTimes[0];
    const idx = Math.round((t - spec.frameTimes[0]) / dt);
    return Math.min(spec.numFrames - 1, Math.max(0, idx));
  }

  function binIndexForFreq(spec, freqHz) {
    const dHz = spec.freqs[1] - spec.freqs[0];
    const idx = Math.round(freqHz / dHz);
    return Math.min(spec.numBins - 1, Math.max(0, idx));
  }

  // ---------------- Colour mapping (brightness / contrast / saturation) ----------------

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1, g1, b1;
    if (h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
  }

  // floorDb = "brightness" (quietest level still rendered as signal); rangeDb = "contrast" (dB span
  // mapped from floor to full-brightness); saturation 0..1 (0 = grayscale, useful on noisy files).
  function makeColorLut(floorDb, rangeDb, saturation) {
    const steps = 256;
    const lut = new Uint8ClampedArray(steps * 3);
    for (let i = 0; i < steps; i++) {
      const norm = i / (steps - 1); // 0..1 after floor/range mapping
      const hue = 220 - norm * 205; // blue (quiet) -> yellow/orange (loud)
      const lightness = 0.04 + norm * 0.62;
      const [r, g, b] = hslToRgb(hue, saturation, lightness);
      lut[i * 3] = r; lut[i * 3 + 1] = g; lut[i * 3 + 2] = b;
    }
    return lut;
  }

  function dbToLutIndex(db, floorDb, rangeDb) {
    const norm = (db - floorDb) / rangeDb;
    return Math.min(255, Math.max(0, Math.round(norm * 255)));
  }

  // Browsers cap canvas/ImageData dimensions (commonly ~16384-32767px per side). A long
  // continuous recording can have far more STFT frames than that, so this always caps the
  // rendered width to MAX_DISPLAY_COLUMNS, grouping multiple frames per column and taking the
  // loudest one per bin (max, not average) so brief pulses stay visible even when compressed.
  const MAX_DISPLAY_COLUMNS = 4000;

  // Renders spec into an offscreen ImageData sized to (frame range x bin range, capped in width),
  // then the caller draws it scaled to fill the visible canvas.
  function renderSpectrogramImageData(spec, opts) {
    const { frameFrom, frameTo, binFrom, binTo, floorDb, rangeDb, saturation } = opts;
    const totalFrames = frameTo - frameFrom + 1;
    const w = Math.min(MAX_DISPLAY_COLUMNS, totalFrames);
    const h = binTo - binFrom + 1;
    const framesPerCol = totalFrames / w;
    const lut = makeColorLut(floorDb, rangeDb, saturation);
    const img = new ImageData(w, h);
    for (let c = 0; c < w; c++) {
      const groupStart = frameFrom + Math.floor(c * framesPerCol);
      const groupEnd = Math.max(groupStart + 1, frameFrom + Math.floor((c + 1) * framesPerCol));
      for (let b = 0; b < h; b++) {
        const binIdx = binFrom + b;
        let maxDb = -Infinity;
        for (let frameIdx = groupStart; frameIdx < groupEnd; frameIdx++) {
          const db = spec.magDb[frameIdx * spec.numBins + binIdx];
          if (db > maxDb) maxDb = db;
        }
        const lutIdx = dbToLutIndex(maxDb, floorDb, rangeDb);
        // Flip vertically: bin 0 (low freq) should render at the bottom.
        const py = h - 1 - b;
        const pixelOffset = (py * w + c) * 4;
        img.data[pixelOffset] = lut[lutIdx * 3];
        img.data[pixelOffset + 1] = lut[lutIdx * 3 + 1];
        img.data[pixelOffset + 2] = lut[lutIdx * 3 + 2];
        img.data[pixelOffset + 3] = 255;
      }
    }
    return img;
  }

  // ---------------- Oscillogram ----------------

  // Per-pixel-column min/max envelope for a fast, resolution-independent waveform draw.
  function computeOscillogramColumns(samples, sampleRate, t0, t1, numColumns) {
    const i0 = Math.max(0, Math.floor(t0 * sampleRate));
    const i1 = Math.min(samples.length, Math.ceil(t1 * sampleRate));
    const span = Math.max(1, i1 - i0);
    const perCol = Math.max(1, Math.floor(span / numColumns));
    const mins = new Float32Array(numColumns);
    const maxs = new Float32Array(numColumns);
    for (let c = 0; c < numColumns; c++) {
      const s0 = i0 + c * perCol;
      const s1 = Math.min(i1, s0 + perCol);
      let mn = 1, mx = -1;
      for (let i = s0; i < s1; i++) {
        const v = samples[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (s1 <= s0) { mn = 0; mx = 0; }
      mins[c] = mn; maxs[c] = mx;
    }
    return { mins, maxs };
  }

  // ---------------- Measurement ----------------

  const DEFAULT_THRESHOLD_DB = 20; // how far below the box's own peak still counts as "signal"

  function measureBox(spec, samples, sampleRate, box, thresholdDb) {
    thresholdDb = thresholdDb == null ? DEFAULT_THRESHOLD_DB : thresholdDb;
    const nyquist = sampleRate / 2;
    const f0 = box.f0 == null ? 0 : box.f0;
    const f1 = box.f1 == null ? nyquist : box.f1;
    const frameFrom = frameIndexForTime(spec, box.t0);
    const frameTo = Math.max(frameFrom, frameIndexForTime(spec, box.t1));
    const binFrom = binIndexForFreq(spec, Math.min(f0, f1));
    const binTo = Math.max(binFrom, binIndexForFreq(spec, Math.max(f0, f1)));

    let peakDb = -Infinity;
    for (let fr = frameFrom; fr <= frameTo; fr++) {
      for (let b = binFrom; b <= binTo; b++) {
        const db = spec.magDb[fr * spec.numBins + b];
        if (db > peakDb) peakDb = db;
      }
    }
    const activeFloor = peakDb - thresholdDb;

    let maxBin = -1, minBin = Infinity;
    const ridge = [];
    // Power-spectrum sum per bin (linear power, not dB) for a robust peak-frequency reading.
    const powerSum = new Float64Array(binTo - binFrom + 1);

    for (let fr = frameFrom; fr <= frameTo; fr++) {
      let frameBestBin = -1, frameBestDb = -Infinity;
      for (let b = binFrom; b <= binTo; b++) {
        const db = spec.magDb[fr * spec.numBins + b];
        if (db >= activeFloor) {
          if (b > maxBin) maxBin = b;
          if (b < minBin) minBin = b;
        }
        if (db > frameBestDb) { frameBestDb = db; frameBestBin = b; }
        powerSum[b - binFrom] += Math.pow(10, db / 10);
      }
      if (frameBestBin >= 0 && frameBestDb >= activeFloor) {
        ridge.push({ timeSec: spec.frameTimes[fr], freqHz: spec.freqs[frameBestBin], db: frameBestDb });
      }
    }

    let peakBinRel = 0;
    for (let i = 1; i < powerSum.length; i++) if (powerSum[i] > powerSum[peakBinRel]) peakBinRel = i;
    const peakFreqHz = spec.freqs[binFrom + peakBinRel];

    const maxFreqHz = maxBin >= 0 ? spec.freqs[maxBin] : null;
    const minFreqHz = minBin <= binTo ? spec.freqs[minBin] : null;

    function avgFreqOf(points) {
      if (points.length === 0) return null;
      return points.reduce((s, p) => s + p.freqHz, 0) / points.length;
    }
    const startFreqHz = ridge.length ? avgFreqOf(ridge.slice(0, Math.min(3, ridge.length))) : null;
    const endFreqHz = ridge.length ? avgFreqOf(ridge.slice(Math.max(0, ridge.length - 3))) : null;

    const rawDurationMs = (box.t1 - box.t0) * 1000;
    const refined = refineDurationFromOscillogram(samples, sampleRate, box.t0, box.t1);

    return {
      maxFreqHz, minFreqHz, peakFreqHz, startFreqHz, endFreqHz,
      durationMs: refined != null ? refined : rawDurationMs,
      rawDurationMs,
      durationRefined: refined != null,
      ridge,
      peakDb,
      thresholdDb,
    };
  }

  // Finds amplitude-envelope crossings near t0/t1 to refine call duration, per the training
  // material's guidance to measure duration from the oscillogram where possible.
  function refineDurationFromOscillogram(samples, sampleRate, t0, t1, thresholdRatio) {
    thresholdRatio = thresholdRatio == null ? 0.1 : thresholdRatio;
    const padSec = Math.max(0.001, (t1 - t0) * 0.5);
    const i0 = Math.max(0, Math.floor((t0 - padSec) * sampleRate));
    const i1 = Math.min(samples.length, Math.ceil((t1 + padSec) * sampleRate));
    if (i1 - i0 < 8) return null;

    let peak = 0;
    for (let i = i0; i < i1; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
    if (peak <= 0) return null;
    const thresh = peak * thresholdRatio;

    const centerStart = Math.floor(t0 * sampleRate);
    const centerEnd = Math.floor(t1 * sampleRate);

    let startIdx = null;
    for (let i = Math.min(centerStart, i1 - 1); i >= i0; i--) {
      if (Math.abs(samples[i]) < thresh) { startIdx = i; break; }
    }
    let endIdx = null;
    for (let i = Math.max(centerEnd, i0); i < i1; i++) {
      if (Math.abs(samples[i]) < thresh) { endIdx = i; break; }
    }
    if (startIdx == null || endIdx == null || endIdx <= startIdx) return null;
    return ((endIdx - startIdx) / sampleRate) * 1000;
  }

  // ---------------- Shape classification (suggestion only, always editable) ----------------

  function classifyShape(ridge) {
    if (!ridge || ridge.length < 3) return { shape: 'unclassified', confidence: 0 };

    const freqs = ridge.map((p) => p.freqHz);
    const times = ridge.map((p) => p.timeSec);
    const fMax = Math.max(...freqs), fMin = Math.min(...freqs);
    const range = fMax - fMin;
    const peakRef = Math.max(fMax, 1);

    if (range / peakRef < 0.05 || range < 1500) {
      return { shape: 'CF', confidence: 0.7 };
    }

    const n = ridge.length;
    const thirdLen = Math.max(1, Math.floor(n / 3));
    const seg1 = ridge.slice(0, thirdLen);
    const seg2 = ridge.slice(thirdLen, n - thirdLen);
    const seg3 = ridge.slice(n - thirdLen);

    function slope(seg) {
      if (seg.length < 2) return 0;
      const dt = seg[seg.length - 1].timeSec - seg[0].timeSec;
      if (dt === 0) return 0;
      return (seg[seg.length - 1].freqHz - seg[0].freqHz) / dt; // Hz/sec
    }

    const s1 = Math.abs(slope(seg1));
    const s2 = seg2.length >= 2 ? Math.abs(slope(seg2)) : (s1);
    const s3 = Math.abs(slope(seg3));
    const maxSlope = Math.max(s1, s2, s3, 1);

    const flat1 = s1 / maxSlope < 0.25;
    const flat2 = s2 / maxSlope < 0.25;
    const flat3 = s3 / maxSlope < 0.25;

    if (!flat1 && flat2 && !flat3) {
      return { shape: 'FM-CF-FM', confidence: 0.55 };
    }
    if (!flat1 && (flat2 || flat3) && range / peakRef > 0.1) {
      return { shape: 'FM-qCF', confidence: 0.6 };
    }
    if (!flat1 && !flat2 && !flat3) {
      return { shape: range / peakRef > 0.2 ? 'FM' : 'qCF', confidence: 0.55 };
    }
    return { shape: 'qCF', confidence: 0.4 };
  }

  ns.Dsp = {
    FFT_SIZES,
    DEFAULT_THRESHOLD_DB,
    MAX_ANALYSIS_DURATION_SEC,
    computeSpectrogram,
    frameIndexForTime,
    binIndexForFreq,
    renderSpectrogramImageData,
    computeOscillogramColumns,
    measureBox,
    refineDurationFromOscillogram,
    classifyShape,
  };
})(window.BatID);
