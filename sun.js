// Sunrise/sunset calculation (the standard "sunrise equation" - Meeus/NOAA solar position
// formulas), so activity timing can be expressed relative to dusk/dawn rather than raw clock
// time. No network call, no external service - just the astronomy.
window.BatID = window.BatID || {};

(function (ns) {
  const DEG = Math.PI / 180;

  // Uses the date's LOCAL calendar day, not its UTC one - deliberately. Every caller in this app
  // builds these Date objects via `new Date(y, m-1, d, ...)`, which is local-time construction, so
  // the local getters are the only ones guaranteed to give back the calendar date the caller
  // actually meant. Using the UTC getters instead is a real bug this project shipped with and only
  // surfaced in British Summer Time (UTC+1): a local time in the first hour after midnight (e.g.
  // 00:28 BST) is still the PREVIOUS day in UTC, so getUTCDate() silently returns one day earlier
  // than intended - which then throws every sunset-relative hour computed from it off by a full 24
  // hours for any detection in that window (the "+27h" values Clara spotted on the activity chart).
  // Only the y/m/d matter here - the sunrise equation below re-derives its own time-of-day from the
  // date's fractional Julian day component, so the hour/minute/second on the input date are never
  // read at all, in UTC or local.
  function toJulianDay(date) {
    const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    const a = Math.floor((14 - m) / 12);
    const y2 = y + 4800 - a;
    const m2 = m + 12 * a - 3;
    return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
  }

  function fromJulianDay(jd) {
    // Julian date -> JS Date (UTC), via the standard Fliegel-Van Flandern inverse.
    const z = Math.floor(jd + 0.5);
    const f = jd + 0.5 - z;
    let a = z;
    if (z >= 2299161) {
      const alpha = Math.floor((z - 1867216.25) / 36524.25);
      a = z + 1 + alpha - Math.floor(alpha / 4);
    }
    const b = a + 1524;
    const c = Math.floor((b - 122.1) / 365.25);
    const d = Math.floor(365.25 * c);
    const e = Math.floor((b - d) / 30.6001);
    const day = b - d - Math.floor(30.6001 * e) + f;
    const month = e < 14 ? e - 1 : e - 13;
    const year = month > 2 ? c - 4716 : c - 4715;
    const dayFloor = Math.floor(day);
    const hoursFloat = (day - dayFloor) * 24;
    const hours = Math.floor(hoursFloat);
    const minutesFloat = (hoursFloat - hours) * 60;
    const minutes = Math.floor(minutesFloat);
    const seconds = Math.round((minutesFloat - minutes) * 60);
    return new Date(Date.UTC(year, month - 1, dayFloor, hours, minutes, seconds));
  }

  // Returns { sunrise, sunset, solarNoon } as JS Date objects (UTC instants), or null values for
  // sunrise/sunset on days with no sunset/sunrise (polar day/night - not a UK concern, but safe).
  // lon: degrees, positive East (matches GPS/GUANO convention). zenith 90.833 = standard
  // atmospheric refraction + solar radius correction used for "official" sunrise/sunset.
  function sunTimes(date, lat, lon, zenith) {
    zenith = zenith == null ? 90.833 : zenith;
    const jd = toJulianDay(date);
    const n = jd - 2451545.0 + 0.0008;
    const jStar = n - lon / 360;
    const M = (357.5291 + 0.98560028 * jStar) % 360;
    const Mrad = M * DEG;
    const C = 1.9148 * Math.sin(Mrad) + 0.02 * Math.sin(2 * Mrad) + 0.0003 * Math.sin(3 * Mrad);
    let lambda = (M + C + 180 + 102.9372) % 360;
    if (lambda < 0) lambda += 360;
    const lambdaRad = lambda * DEG;
    const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(Mrad) - 0.0069 * Math.sin(2 * lambdaRad);
    const sinDelta = Math.sin(lambdaRad) * Math.sin(23.4397 * DEG);
    const delta = Math.asin(sinDelta);
    const latRad = lat * DEG;
    const cosOmega = (Math.sin((90 - zenith) * DEG) - Math.sin(latRad) * sinDelta) / (Math.cos(latRad) * Math.cos(delta));
    if (cosOmega > 1) return { sunrise: null, sunset: null, solarNoon: fromJulianDay(jTransit), polar: 'night' };
    if (cosOmega < -1) return { sunrise: null, sunset: null, solarNoon: fromJulianDay(jTransit), polar: 'day' };
    const omega = Math.acos(cosOmega) / DEG;
    return {
      sunrise: fromJulianDay(jTransit - omega / 360),
      sunset: fromJulianDay(jTransit + omega / 360),
      solarNoon: fromJulianDay(jTransit),
      polar: null,
    };
  }

  // Hours after sunset (negative = before sunset) for a given instant, using the sunset of the
  // night the instant belongs to. Bat activity spans midnight, so "the night of" a small-hours
  // detection is the previous calendar date's sunset, not that calendar date's own sunset.
  function hoursRelativeToSunset(instant, lat, lon) {
    const hour = instant.getHours();
    // Before ~noon local, treat the instant as belonging to the previous evening's sunset.
    const nightDate = new Date(instant);
    if (hour < 12) nightDate.setDate(nightDate.getDate() - 1);
    const { sunset } = sunTimes(nightDate, lat, lon);
    if (!sunset) return null;
    return (instant.getTime() - sunset.getTime()) / (1000 * 60 * 60);
  }

  ns.Sun = { toJulianDay, fromJulianDay, sunTimes, hoursRelativeToSunset };
})(window.BatID);
