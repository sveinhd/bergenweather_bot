import { BskyAgent } from '@atproto/api';
import * as dotenv from 'dotenv';
import { CronJob } from 'cron';
import * as process from 'process';
import { getWeatherTypeText } from './weatherType.js';
import { generateWeatherImage, WeatherImageData, classifyWeatherIcon, weatherIconLabel } from './weatherImage.js';

dotenv.config();

const frostBaseUrl =
  'https://frost.met.no/api/v1/obs/base?stationids=50540&elementids=' +
  'air_pressure_at_sea_level,' +
  'over_time(tendency_of_surface_air_pressure PT3H),' +
  'weather_type,' +
  'wind_from_direction,' +
  'air_temperature,' +
  'wind_speed,' +
  'max(wind_speed_of_gust PT1H),' +
  'max(wind_speed PT1H),' +
  'relative_humidity,' +
  'cloud_area_fraction' +
  '&time=latest&incobs=true';

const agent = new BskyAgent({ service: 'https://bsky.social' });

// ─── Frost types ──────────────────────────────────────────────────────────────

type FrostObservation = {
  time?: string;
  body?: {
    value?: number | string;
    qualitycode?: string;
  };
};

type FrostSeries = {
  header?: {
    available?: { from?: string };
    extra?: {
      element?: { id?: string };
      station?: {
        shortname?: string;
        location?: Array<{ value?: { latitude?: string; longitude?: string } }>;
      };
    };
  };
  observations?: FrostObservation[] | null;
};

type FrostResponse = {
  data?: { tstype?: string; tseries?: FrostSeries[] };
};

type CelestialResponse = {
  properties?: {
    sunrise?: { time?: string | null } | null;
    sunset?:  { time?: string | null } | null;
    moonrise?: { time?: string | null } | null;
    moonset?:  { time?: string | null } | null;
  };
};

// ─── Frost helpers ────────────────────────────────────────────────────────────

async function fetchLatestFrostObservation(): Promise<FrostResponse> {
  const frostId = process.env.FROST_ID;
  if (!frostId) throw new Error('Missing FROST_ID in .env');

  const response = await fetch(frostBaseUrl, {
    headers: {
      Authorization: `Basic ${btoa(`${frostId}:`)}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Frost API request failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<FrostResponse>;
}

function getLatestObservation(series?: FrostSeries): FrostObservation | undefined {
  const obs = series?.observations;
  return Array.isArray(obs) && obs.length > 0 ? obs[obs.length - 1] : undefined;
}

function findSeries(frostData: FrostResponse, elementId: string): FrostSeries | undefined {
  return frostData.data?.tseries?.find(s => s.header?.extra?.element?.id === elementId);
}

function obsNumber(series: FrostSeries | undefined): number {
  const raw = getLatestObservation(series)?.body?.value;
  const n = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function getStationCoordinates(frostData: FrostResponse) {
  for (const series of frostData.data?.tseries ?? []) {
    const loc = series.header?.extra?.station?.location?.[0]?.value;
    const lat = parseFloat(loc?.latitude ?? '');
    const lon = parseFloat(loc?.longitude ?? '');
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  return undefined;
}

function getTimeZoneOffsetString(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' });
  const offsetPart = formatter.formatToParts(date).find(p => p.type === 'timeZoneName')?.value;
  const match = offsetPart?.match(/^GMT([+-]\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return '+00:00';
  const signedHour = parseInt(match[1], 10);
  const sign = signedHour < 0 ? '-' : '+';
  const hours = Math.abs(signedHour).toString().padStart(2, '0');
  const minutes = (match[2] ?? '00').padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function formatSunEventTime(value?: string | null): string | undefined {
  if (!value) return undefined;
  return new Date(value).toLocaleTimeString('no-NO', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo',
  });
}

async function fetchSunriseSunset(frostData: FrostResponse): Promise<{ sunrise?: string; sunset?: string; moonrise?: string; moonset?: string }> {
  const coords = getStationCoordinates(frostData);
  const allSeries = frostData.data?.tseries ?? [];
  const observationTime =
    getLatestObservation(findSeries(frostData, 'air_temperature'))?.time ??
    getLatestObservation(findSeries(frostData, 'wind_speed'))?.time ??
    allSeries[0]?.header?.available?.from;

  if (!coords || !observationTime) return {};

  const obsDate = new Date(observationTime);
  const date = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Oslo',
  }).format(obsDate);
  const offset = getTimeZoneOffsetString(obsDate, 'Europe/Oslo');

  const makeUrl = (path: 'sun' | 'moon') => {
    const url = new URL(`https://api.met.no/weatherapi/sunrise/3.0/${path}`);
    url.searchParams.set('lat', coords.lat.toString());
    url.searchParams.set('lon', coords.lon.toString());
    url.searchParams.set('date', date);
    url.searchParams.set('offset', offset);
    return url.toString();
  };

  const fetchCelestial = async (path: 'sun' | 'moon') => {
    const r = await fetch(makeUrl(path), {
      headers: { Accept: 'application/json', 'User-Agent': 'bergenweather-bot/1.0 github.com/bergenweather_bot' },
    });
    if (!r.ok) throw new Error(`${path} API failed (${r.status}): ${await r.text()}`);
    return r.json() as Promise<CelestialResponse>;
  };

  const [sunData, moonData] = await Promise.all([fetchCelestial('sun'), fetchCelestial('moon')]);
  return {
    sunrise:  formatSunEventTime(sunData.properties?.sunrise?.time),
    sunset:   formatSunEventTime(sunData.properties?.sunset?.time),
    moonrise: formatSunEventTime(moonData.properties?.moonrise?.time),
    moonset:  formatSunEventTime(moonData.properties?.moonset?.time),
  };
}

// ─── Wind helpers (kept from original) ───────────────────────────────────────

function rotateWindDirection(degrees: number): number {
  const normalized = ((degrees % 360) + 360) % 360;
  const rotated = normalized + 180;
  return rotated > 360 ? rotated - 360 : rotated;
}

function getWindDirectionArrow(degrees: number): string {
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return '↑';
  if (normalized < 67.5)  return '↗';
  if (normalized < 112.5) return '→';
  if (normalized < 157.5) return '↘';
  if (normalized < 202.5) return '↓';
  if (normalized < 247.5) return '↙';
  if (normalized < 292.5) return '←';
  return '↖';
}

function windChill(temperature: number, windSpeed: number): number {
  if (windSpeed <= 1.34) return temperature;
  const wc = 13.12 + 0.6215 * temperature
    - 11.37 * Math.pow(windSpeed * 3.6, 0.16)
    + 0.3965 * temperature * Math.pow(windSpeed * 3.6, 0.16);
  return Number.isFinite(wc) ? wc : temperature;
}

// ─── Bluesky helpers ──────────────────────────────────────────────────────────

function createLinkFacet(text: string, linkText: string, uri: string) {
  const start = text.indexOf(linkText);
  if (start === -1) return undefined;
  const encoder = new TextEncoder();
  const byteStart = encoder.encode(text.slice(0, start)).length;
  const byteEnd = byteStart + encoder.encode(linkText).length;
  return { index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#link', uri }] };
}

async function uploadWeatherImage(imageBuffer: Buffer) {
  const response = await agent.uploadBlob(imageBuffer, { encoding: 'image/png' });
  return response.data.blob;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const frostData = await fetchLatestFrostObservation();
  console.log('Frost series count:', frostData.data?.tseries?.length ?? 0);

  // Extract observations
  const temperature     = obsNumber(findSeries(frostData, 'air_temperature'));
  const windSpeed       = obsNumber(findSeries(frostData, 'wind_speed'));
  const windDirection   = obsNumber(findSeries(frostData, 'wind_from_direction'));
  const pressure        = obsNumber(findSeries(frostData, 'air_pressure_at_sea_level'));
  const pressureTendency = obsNumber(findSeries(frostData, 'over_time(tendency_of_surface_air_pressure PT3H)'));
  const windGust        = obsNumber(findSeries(frostData, 'max(wind_speed_of_gust PT1H)'));
  const windMax         = obsNumber(findSeries(frostData, 'max(wind_speed PT1H)'));
  const humidity        = obsNumber(findSeries(frostData, 'relative_humidity'));
  const weatherTypeCode = obsNumber(findSeries(frostData, 'weather_type'));
  const cloudCover      = obsNumber(findSeries(frostData, 'cloud_area_fraction')); // oktas 0–8

  console.log('cloud_area_fraction (oktas):', cloudCover, '  weather_type (WW):', weatherTypeCode);

  const observationTime =
    getLatestObservation(findSeries(frostData, 'air_temperature'))?.time ??
    getLatestObservation(findSeries(frostData, 'wind_speed'))?.time ??
    getLatestObservation(findSeries(frostData, 'air_pressure_at_sea_level'))?.time ??
    new Date().toISOString();

  const feelsLike = windChill(temperature, windSpeed);

  // Sunrise / sunset
  const { sunrise, sunset, moonrise, moonset } = await fetchSunriseSunset(frostData);

  // ── Night detection ───────────────────────────────────────────────────────
  function parseLocalHHMM(hhmm: string, referenceDate: Date): Date {
    // hhmm is in Europe/Oslo local time e.g. "04:14"
    const [h, m] = hhmm.split(':').map(Number);
    // Build a date string in Oslo time and parse it
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(referenceDate);
    return new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+02:00`);
  }

  const obsDate = new Date(observationTime);
  let isNight = false;
  if (sunrise && sunset) {
    const sunriseDate = parseLocalHHMM(sunrise, obsDate);
    const sunsetDate  = parseLocalHHMM(sunset, obsDate);
    isNight = obsDate < sunriseDate || obsDate > sunsetDate;
  }

  // ── Generate image ────────────────────────────────────────────────────────
  const imageData: WeatherImageData = {
    temperature,
    feelsLike,
    windSpeed,
    windDirection,
    windGust:         Number.isFinite(windGust)  ? windGust  : undefined,
    windMax:          Number.isFinite(windMax)   ? windMax   : undefined,
    pressure,
    pressureTendency: Number.isFinite(pressureTendency) ? pressureTendency : undefined,
    humidity:         Number.isFinite(humidity)  ? humidity  : undefined,
    cloudCover:       Number.isFinite(cloudCover) ? cloudCover : undefined,
    weatherTypeCode,
    observationTime,
    sunrise,
    sunset,
    isNight,
  };

  const imageBuffer = generateWeatherImage(imageData);
  console.log('Image generated, size:', imageBuffer.length, 'bytes');

  // ── Build post text (kept short – card carries the data) ──────────────────
  const stationName = frostData.data?.tseries?.[0]?.header?.extra?.station?.shortname ?? 'Bergen';
  const date = new Date(observationTime);
  const formattedDate = date.toLocaleString('no-NO', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Oslo',
  });

  const tempText  = Number.isFinite(temperature) ? `${temperature.toFixed(1)} °C` : '?°C';
  const windText  = Number.isFinite(windSpeed)   ? `${windSpeed.toFixed(1)} m/s` : '?';
  const rotatedDir = Number.isFinite(windDirection) ? rotateWindDirection(windDirection) : NaN;
  const windArrow = Number.isFinite(rotatedDir) ? getWindDirectionArrow(rotatedDir) : '';
  const weatherTypeText = getWeatherTypeText(weatherTypeCode);
  const iconKind = classifyWeatherIcon(weatherTypeCode, isNight, cloudCover);
  const iconLabel = weatherIconLabel(iconKind);

  const sunText  = sunrise && sunset ? `\n☀ ${sunrise} ↑  ${sunset} ↓` : '';
  const moonText = moonrise ? `  🌙 ${moonrise} ↑  ${moonset ?? '?'} ↓` : '';

  const creditLinkText = 'frost.met.no';
  const postText = [
    `Bergen ${tempText}  ${windText} ${windArrow}  ${iconLabel}`,
    `(${formattedDate})`,
    sunText + moonText,
    `Data: The Norwegian Meteorological Institute (${creditLinkText})`,
  ].filter(Boolean).join('\n');

  const creditFacet = createLinkFacet(postText, creditLinkText, 'https://frost.met.no');

  console.log('Post text:\n' + postText);

  // ── Login & post ──────────────────────────────────────────────────────────
  await agent.login({
    identifier: process.env.BLUESKY_USERNAME!,
    password:   process.env.BLUESKY_PASSWORD!,
  });

  const imageBlob = await uploadWeatherImage(imageBuffer);

  await agent.post({
    text: postText,
    facets: creditFacet ? [creditFacet] : undefined,
    embed: {
      $type: 'app.bsky.embed.images',
      images: [
        {
          image: imageBlob,
          alt: `Bergen weather: ${tempText}, wind ${windText} ${windArrow}, ${iconLabel}. Pressure ${Number.isFinite(pressure) ? pressure.toFixed(1) + ' hPa' : 'n/a'}. ${formattedDate}`,
        },
      ],
    },
  });

  console.log('Posted!');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (process.env.CI) {
  main().catch(console.error);
} else {
  main().catch(console.error);
  // const scheduleExpressionMinute = '* * * * *'; // every minute – for testing
  const scheduleExpression = '10 * * * *'; // every hour at :10
  new CronJob(scheduleExpression, main).start();
}