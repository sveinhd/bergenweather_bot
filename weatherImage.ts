import { createCanvas, CanvasRenderingContext2D, loadImage } from 'canvas';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WeatherImageData = {
  temperature: number;          // °C
  feelsLike?: number;           // °C (wind chill)
  windSpeed: number;            // m/s
  windDirection: number;        // degrees (meteorological, from)
  windGust?: number;            // m/s hourly max gust
  windMax?: number;             // m/s hourly max mean
  pressure: number;             // hPa at sea level
  pressureTendency?: number;    // hPa change over 3 h (positive = rising)
  humidity?: number;            // %
  cloudCover?: number;          // oktas 0–8 (cloud_area_fraction)
  weatherTypeCode: number;      // WW synop code 0–99
  observationTime: string;      // ISO 8601
  sunrise?: string;             // HH:MM local
  sunset?: string;              // HH:MM local
  moonrise?: string;            // HH:MM local
  moonset?: string;             // HH:MM local
  moonPhase?: number;           // degrees 0-360: 0=new, 90=first quarter, 180=full, 270=last quarter
  isNight?: boolean;            // true when current time is before sunrise or after sunset
  tempMin?: number;             // °C daily minimum (min(air_temperature PT1D))
  tempMax?: number;             // °C daily maximum (max(air_temperature PT1D))
  precip1h?: number;            // mm precipitation last hour
  precip12h?: number;           // mm precipitation last 12 hours
  precipAnomaly3M?: number;     // % deviation from 1961-1990 normal over last 3 months
  precipYTD?: number;           // mm total precipitation this year
  lightningCount?: number;      // total strikes in southern Norway last 24h
  lightningCTG?: number;        // cloud-to-ground strikes only
  stationInfo?: {
    name: string;
    shortname?: string;
    lat?: number;
    lon?: number;
    elevation?: string;
    wmo?: string;
    wigos?: string;
  };
};

// ─── Colour palette ───────────────────────────────────────────────────────────

const C = {
  bg:          '#ffffff',
  bgCard:      '#f8fafc',
  line:        '#e2e8f0',
  muted:       '#94a3b8',
  secondary:   '#64748b',
  label:       '#475569',
  primary:     '#0f172a',
  accent:      '#2563eb',   // blue – wind / info
  sun:         '#d97706',   // amber – sun (dark enough on white)
  rain:        '#1d6ea8',   // blue – rain
  snow:        '#5b8dd9',   // medium blue – snow
  thunder:     '#7c3aed',   // purple – thunder
  cloud:       '#64748b',   // slate – cloud
  green:       '#16a34a',   // rising pressure
  red:         '#dc2626',   // falling pressure
};

// ─── Weather icon classification ──────────────────────────────────────────────

type IconKind = 'sun' | 'partcloud' | 'moon' | 'partcloudnight' | 'cloud' | 'rain' | 'sleet' | 'snow' | 'thunder' | 'fog';

/**
 * Classify the weather icon to display.
 *
 * Priority:
 * 1. WW code signals precipitation or special phenomena → use that (rain/snow/thunder/fog).
 * 2. Otherwise use cloud_area_fraction (oktas) as the primary sky-cover signal:
 *      0–1  → clear  (sun / moon)
 *      2–4  → partly cloudy
 *      5–6  → mostly cloudy (cloud icon, no sun)
 *      7–8  → overcast
 * 3. Fall back to WW code if oktas are unavailable.
 */
export function classifyWeatherIcon(wwCode: number, isNight = false, oktas?: number): IconKind {
  const w = Number.isFinite(wwCode) ? Math.round(wwCode) : -1;

  // WW codes that signal actual weather phenomena take priority over cloud cover
  if (w >= 10 && w <= 19) return 'fog';
  if (w >= 30 && w <= 39) return 'fog';
  if (w >= 40 && w <= 49) return 'fog';
  if (w >= 50 && w <= 69) return 'rain';
  if (w >= 70 && w <= 79) return 'snow';
  if (w >= 80 && w <= 84) return 'rain';
  if (w >= 85 && w <= 86) return 'snow';
  if (w >= 87 && w <= 89) return 'sleet';
  if (w >= 90 && w <= 99) return 'thunder';

  // For WW 0–9 (no significant weather) use oktas as the sky-cover truth
  if (Number.isFinite(oktas)) {
    if (oktas! <= 1) return isNight ? 'moon'           : 'sun';
    if (oktas! <= 4) return isNight ? 'partcloudnight' : 'partcloud';
    return 'cloud';   // 5–8 oktas: cloudy / overcast
  }

  // Fallback: WW code only
  if (w <= 2)  return isNight ? 'moon'           : 'sun';
  if (w <= 9)  return isNight ? 'partcloudnight' : 'partcloud';
  return 'cloud';
}

export function weatherIconLabel(kind: IconKind): string {
  const map: Record<IconKind, string> = {
    sun:            'Clear',
    partcloud:      'Partly cloudy',
    moon:           'Clear night',
    partcloudnight: 'Partly cloudy night',
    cloud:          'Cloudy',
    rain:           'Rain',
    sleet:          'Sleet',
    snow:           'Snow',
    thunder:        'Thunderstorm',
    fog:            'Fog / mist',
  };
  return map[kind];
}

// ─── Wind direction helpers ───────────────────────────────────────────────────

function windDirectionLabel(deg: number): string {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

/** Arrow pointing in the direction the wind BLOWS TOWARD (i.e. inverted from "from") */
function windArrow(fromDeg: number): string {
  const toDeg = (fromDeg + 180) % 360;
  const arrows = ['↑','↗','→','↘','↓','↙','←','↖'];
  return arrows[Math.round(toDeg / 45) % 8];
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────

function setFont(ctx: CanvasRenderingContext2D, size: number, weight: string = 'normal') {
  ctx.font = `${weight} ${size}px "Courier New", monospace`;
}

function hline(ctx: CanvasRenderingContext2D, y: number, x0 = 40, x1 = 760) {
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ─── Yr.no weather symbol mapping ────────────────────────────────────────────
//
// Icons from https://nrkno.github.io/yr-weather-symbols/
// Free to use with credit to Yr / NRK.
// Suffix: d = day, n = night, m = polar night (mørketid). Some icons are
// day/night-neutral and have no suffix.

const YR_BASE = 'https://nrkno.github.io/yr-weather-symbols/symbols/lightmode';

function yrSymbolCode(kind: IconKind, isNight: boolean): string {
  switch (kind) {
    case 'sun':            return isNight ? '01n' : '01d';
    case 'partcloud':      return isNight ? '02n' : '02d';
    case 'moon':           return '01n';
    case 'partcloudnight': return '02n';
    case 'cloud':          return '04';
    case 'fog':            return '15';
    case 'rain':           return isNight ? '05n' : '09';
    case 'sleet':          return isNight ? '07n' : '12';
    case 'snow':           return isNight ? '08n' : '13';
    case 'thunder':        return isNight ? '06n' : '22';
  }
}

async function fetchYrIcon(kind: IconKind, isNight: boolean): Promise<ReturnType<typeof loadImage>> {
  const code = yrSymbolCode(kind, isNight);
  const url = `${YR_BASE}/${code}.svg`;
  return loadImage(url);
}

// ─── Accent bar for icon kind ─────────────────────────────────────────────────

function accentColor(kind: IconKind): string {
  switch (kind) {
    case 'sun':            return C.sun;
    case 'partcloud':      return C.sun;
    case 'moon':           return '#f59e0b';   // amber crescent
    case 'partcloudnight': return '#f59e0b';
    case 'cloud':          return C.cloud;
    case 'rain':           return C.rain;
    case 'sleet':          return C.rain;
    case 'snow':           return C.snow;
    case 'thunder':        return C.thunder;
    case 'fog':            return C.cloud;
  }
}

// ─── Rain gauge illustration ──────────────────────────────────────────────────

function drawRainGauge(ctx: CanvasRenderingContext2D, cx: number, cy: number, mm1h?: number, mm12h?: number) {
  ctx.save();

  const gaugeW = 22;
  const gaugeH = 64;
  const gaugeX = cx - gaugeW / 2;
  const gaugeY = cy - gaugeH;

  // Funnel top
  ctx.beginPath();
  ctx.moveTo(gaugeX - 10, gaugeY - 12);
  ctx.lineTo(gaugeX + gaugeW + 10, gaugeY - 12);
  ctx.lineTo(gaugeX + gaugeW, gaugeY);
  ctx.lineTo(gaugeX, gaugeY);
  ctx.closePath();
  ctx.fillStyle = '#bfdbfe';
  ctx.fill();
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Gauge body outline
  ctx.beginPath();
  ctx.roundRect(gaugeX, gaugeY, gaugeW, gaugeH, [0, 0, 4, 4]);
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Water fill — scale to max 20mm for full gauge
  const maxMm = 20;
  const fillMm = Math.min(mm1h ?? 0, maxMm);
  const fillH = (fillMm / maxMm) * (gaugeH - 4);
  if (fillH > 0) {
    ctx.beginPath();
    ctx.roundRect(gaugeX + 1.5, gaugeY + gaugeH - fillH - 1.5, gaugeW - 3, fillH, [0, 0, 3, 3]);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
  }

  // Tick marks (every 5mm)
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 1;
  for (let t = 5; t <= maxMm; t += 5) {
    const tickY = gaugeY + gaugeH - (t / maxMm) * (gaugeH - 4) - 1.5;
    ctx.beginPath();
    ctx.moveTo(gaugeX + gaugeW - 8, tickY);
    ctx.lineTo(gaugeX + gaugeW - 1, tickY);
    ctx.stroke();
  }

  // Stand legs
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(gaugeX + 3, gaugeY + gaugeH);
  ctx.lineTo(gaugeX - 4, gaugeY + gaugeH + 10);
  ctx.moveTo(gaugeX + gaugeW - 3, gaugeY + gaugeH);
  ctx.lineTo(gaugeX + gaugeW + 4, gaugeY + gaugeH + 10);
  ctx.stroke();

  // 1h label
  const label1h = mm1h !== undefined ? `${mm1h.toFixed(1)} mm` : '— mm';
  setFont(ctx, 13, 'bold');
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label1h, cx + gaugeW / 2 + 14, gaugeY + gaugeH * 0.35);

  setFont(ctx, 10, 'normal');
  ctx.fillStyle = '#64748b';
  ctx.fillText('last hour', cx + gaugeW / 2 + 14, gaugeY + gaugeH * 0.35 + 16);

  // 12h label if available
  if (mm12h !== undefined) {
    setFont(ctx, 12, 'normal');
    ctx.fillStyle = '#475569';
    ctx.fillText(`${mm12h.toFixed(1)} mm / 12h`, cx + gaugeW / 2 + 14, gaugeY + gaugeH * 0.35 + 34);
  }

  ctx.restore();
}



// ─── Moon phase ───────────────────────────────────────────────────────────────

export function moonPhaseLabel(deg: number): string {
  if (deg < 5 || deg >= 355)  return 'New moon';
  if (deg < 85)               return 'Waxing crescent';
  if (deg < 95)               return 'First quarter';
  if (deg < 175)              return 'Waxing gibbous';
  if (deg < 185)              return 'Full moon';
  if (deg < 265)              return 'Waning gibbous';
  if (deg < 275)              return 'Last quarter';
  return 'Waning crescent';
}

function drawMoonPhaseDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, deg: number) {
  ctx.save();

  // Dark base disc
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#cbd5e1';
  ctx.fill();

  const waxing = deg <= 180;
  // termX: cos(0)=1 (new, unlit), cos(180)=-1 (full, all lit)
  const termX = Math.cos(deg * Math.PI / 180) * r;

  if (deg > 5 && deg < 355) {
    ctx.save();
    // Clip to disc
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Fill lit semicircle
    ctx.beginPath();
    if (waxing) {
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2);
    } else {
      ctx.arc(cx, cy, r, Math.PI / 2, -Math.PI / 2);
    }
    ctx.closePath();
    ctx.fillStyle = '#fef9c3';
    ctx.fill();

    // Terminator ellipse
    const ellipseRx = Math.abs(termX);
    if (ellipseRx > 1) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, ellipseRx, r, 0, 0, Math.PI * 2);
      ctx.fillStyle = waxing
        ? (termX > 0 ? '#cbd5e1' : '#fef9c3')   // waxing: dark cuts crescent or light adds gibbous
        : (termX < 0 ? '#cbd5e1' : '#fef9c3');   // waning: mirror
      ctx.fill();
    }
    ctx.restore();
  }

  // Full moon — bright disc
  if (deg >= 175 && deg <= 185) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fef9c3';
    ctx.fill();
  }

  // Outline
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

// ─── Wind compass rose ────────────────────────────────────────────────────────

function drawCompass(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fromDeg: number) {
  // Outer circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cardinal ticks
  ctx.strokeStyle = C.muted;
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const ang = (i * Math.PI) / 4 - Math.PI / 2;
    const inner = i % 2 === 0 ? r - 8 : r - 5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
    ctx.lineTo(cx + Math.cos(ang) * r,     cy + Math.sin(ang) * r);
    ctx.stroke();
  }

  // Cardinal labels
  setFont(ctx, Math.max(9, Math.round(r * 0.28)), 'normal');
  ctx.fillStyle = C.secondary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cardinals = ['N','E','S','W'];
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2 - Math.PI / 2;
    const lr = r - 18;
    ctx.fillText(cardinals[i], cx + Math.cos(ang) * lr, cy + Math.sin(ang) * lr);
  }

  // Arrow points TOWARD where wind blows: fromDeg + 180°.
  // Meteorological degrees map directly to canvas radians (both 0=up=north).
  const arrowRad = (fromDeg + 180) * (Math.PI / 180);
  const arrowR = r - 10;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(arrowRad);

  // Arrowhead
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.moveTo(0, -arrowR);
  ctx.lineTo(-7, -arrowR + 16);
  ctx.lineTo(7,  -arrowR + 16);
  ctx.closePath();
  ctx.fill();

  // Tail
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -arrowR + 16);
  ctx.lineTo(0, arrowR - 10);
  ctx.stroke();

  ctx.restore();   // undo translate + rotate
}

// ─── Pressure trend bar ───────────────────────────────────────────────────────

function pressureTrendText(tendency?: number): { label: string; color: string } {
  if (tendency === undefined || !Number.isFinite(tendency)) {
    return { label: 'stable', color: C.label };
  }
  if (tendency > 0.5)  return { label: `↑ +${tendency.toFixed(1)} hPa`, color: C.green };
  if (tendency < -0.5) return { label: `↓ ${tendency.toFixed(1)} hPa`, color: C.red };
  return { label: `→ ${tendency > 0 ? '+' : ''}${tendency.toFixed(1)} hPa`, color: C.label };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate a weather card PNG as a Buffer.
 * Card size: 800 × 420 px (works well on Bluesky's image preview).
 */
export async function generateWeatherImage(data: WeatherImageData): Promise<Buffer> {
  const W = 800;
  const H = 520;
  const PAD = 44;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const iconKind = classifyWeatherIcon(data.weatherTypeCode, data.isNight ?? false, data.cloudCover);
  const accent = accentColor(iconKind);

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = C.bg;
  ctx.roundRect(0, 0, W, H, 16);
  ctx.fill();

  // ── Top accent bar ──────────────────────────────────────────────────────────
  ctx.fillStyle = C.line;
  ctx.fillRect(0, 0, W, 5);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 220, 5);

  // ── Station / date header ───────────────────────────────────────────────────
  const date = new Date(data.observationTime);
  const formattedDate = date.toLocaleString('no-NO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Oslo',
  }).replace(',', ' ·');

  setFont(ctx, 12, 'normal');
  ctx.fillStyle = C.secondary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('BERGEN · FLORIDA STATION', PAD, 22);

  ctx.textAlign = 'right';
  ctx.fillText(formattedDate.toUpperCase(), W - PAD, 22);

  // ── Weather icon (right side) — yr.no SVG ────────────────────────────────────
  const ICON_SIZE = 120;
  const iconX = W - PAD - ICON_SIZE;
  const iconY = 30;
  try {
    const yrIcon = await fetchYrIcon(iconKind, data.isNight ?? false);
    ctx.drawImage(yrIcon, iconX, iconY, ICON_SIZE, ICON_SIZE);
  } catch (err) {
    // Fallback: draw a simple circle if fetch fails
    console.warn('Failed to fetch yr icon:', err);
    ctx.beginPath();
    ctx.arc(iconX + ICON_SIZE / 2, iconY + ICON_SIZE / 2, 40, 0, Math.PI * 2);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Icon label
  setFont(ctx, 12, 'normal');
  ctx.fillStyle = C.label;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(weatherIconLabel(iconKind).toUpperCase(), iconX + ICON_SIZE / 2, iconY + ICON_SIZE + 4);

  // ── Temperature (main) ───────────────────────────────────────────────────────
  setFont(ctx, 96, 'bold');
  ctx.fillStyle = C.primary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${data.temperature.toFixed(1)}°`, PAD, 46);

  // Feels like
  if (data.feelsLike !== undefined && Math.abs(data.feelsLike - data.temperature) >= 0.5) {
    setFont(ctx, 13, 'normal');
    ctx.fillStyle = C.label;
    ctx.fillText(`feels like ${data.feelsLike.toFixed(1)}°C`, PAD + 2, 152);
  }

  // Daily min / max
  if (data.tempMin !== undefined || data.tempMax !== undefined) {
    setFont(ctx, 13, 'normal');
    ctx.fillStyle = C.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const parts: string[] = [];
    if (data.tempMax !== undefined) parts.push(`↑ ${data.tempMax.toFixed(1)}°`);
    if (data.tempMin !== undefined) parts.push(`↓ ${data.tempMin.toFixed(1)}°`);
    ctx.fillText(parts.join('   '), PAD + 2, 170);
  }

  // ── Divider ──────────────────────────────────────────────────────────────────
  hline(ctx, 188, PAD, W - PAD);

  // ── Stats section (Wind / Pressure / Humidity) ───────────────────────────────
  //
  // Canvas is 800px wide, PAD=44 each side → usable width = 712px
  // Three equal columns: 712 / 3 ≈ 237px each
  // Col starts: c1=44, c2=281, c3=518  separators at 277 and 514
  //
  const STATS_TOP  = 196;   // top of stats area (below divider)
  const STATS_BOT  = 316;   // bottom of stats area (above bottom divider)
  const colW       = Math.floor((W - PAD * 2) / 3);   // 237
  const c1X        = PAD;                               // 44
  const c2X        = PAD + colW;                        // 281
  const c3X        = PAD + colW * 2;                    // 518
  const sep1X      = c2X - 1;
  const sep2X      = c3X - 1;

  // Separators
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  for (const sx of [sep1X, sep2X]) {
    ctx.beginPath();
    ctx.moveTo(sx, STATS_TOP + 8);
    ctx.lineTo(sx, STATS_BOT - 8);
    ctx.stroke();
  }

  const LABEL_Y  = STATS_TOP + 10;   // 206  section label
  const VALUE_Y  = LABEL_Y + 16;     // 222  main value
  const SUB_Y    = VALUE_Y + 34;     // 256  sub-line (direction / trend)
  const GUST_Y   = SUB_Y + 16;       // 272  gust line

  // ── Column 1: Wind ───────────────────────────────────────────────────────────
  // Compass: 36px radius, centred vertically in the stats block, left-anchored
  const compassR  = 38;
  const compassCX = c1X + compassR + 4;
  const compassCY = STATS_TOP + Math.floor((STATS_BOT - STATS_TOP) / 2);
  drawCompass(ctx, compassCX, compassCY, compassR, data.windDirection);

  const windTextX = compassCX + compassR + 12;   // text starts just right of compass

  setFont(ctx, 10, 'normal');
  ctx.fillStyle = C.secondary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('WIND', windTextX, LABEL_Y);

  setFont(ctx, 20, 'bold');
  ctx.fillStyle = C.primary;
  ctx.fillText(`${data.windSpeed.toFixed(1)} m/s`, windTextX, VALUE_Y);

  setFont(ctx, 11, 'normal');
  ctx.fillStyle = C.accent;
  const wArrow = windArrow(data.windDirection);
  const wDir   = windDirectionLabel(data.windDirection);
  ctx.fillText(`${wArrow} from ${wDir} · ${data.windDirection.toFixed(0)}°`, windTextX, SUB_Y);

  if (data.windGust !== undefined) {
    ctx.fillStyle = C.label;
    setFont(ctx, 10, 'normal');
    const gustParts = [`gust ${data.windGust.toFixed(1)}`];
    if (data.windMax !== undefined) gustParts.push(`max ${data.windMax.toFixed(1)}`);
    ctx.fillText(gustParts.join(' · ') + ' m/s', windTextX, GUST_Y);
  }

  // ── Column 2: Pressure ────────────────────────────────────────────────────────
  const p2X = c2X + 16;

  setFont(ctx, 10, 'normal');
  ctx.fillStyle = C.secondary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('PRESSURE', p2X, LABEL_Y);

  // Pressure value + unit on same baseline
  setFont(ctx, 20, 'bold');
  ctx.fillStyle = C.primary;
  const pressStr = `${data.pressure.toFixed(1)}`;
  ctx.fillText(pressStr, p2X, VALUE_Y);
  const pressStrWidth = ctx.measureText(pressStr).width;  // measure while font is still 20px bold
  setFont(ctx, 12, 'normal');
  ctx.fillStyle = C.label;
  ctx.fillText(' hPa', p2X + pressStrWidth, VALUE_Y);

  const trend = pressureTrendText(data.pressureTendency);
  setFont(ctx, 11, 'normal');
  ctx.fillStyle = trend.color;
  ctx.fillText(trend.label, p2X, SUB_Y);

  // ── Column 3: Humidity ────────────────────────────────────────────────────────
  const p3X  = c3X + 16;
  const barW = W - PAD - p3X - 4;

  setFont(ctx, 10, 'normal');
  ctx.fillStyle = C.secondary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('HUMIDITY', p3X, LABEL_Y);

  if (data.humidity !== undefined) {
    setFont(ctx, 20, 'bold');
    ctx.fillStyle = C.primary;
    ctx.fillText(`${data.humidity.toFixed(0)}%`, p3X, VALUE_Y);

    // Bar
    const barY = SUB_Y + 2;
    const barH = 5;
    ctx.fillStyle = C.line;
    ctx.roundRect(p3X, barY, barW, barH, 2);
    ctx.fill();
    ctx.fillStyle = C.accent;
    ctx.roundRect(p3X, barY, barW * (data.humidity / 100), barH, 2);
    ctx.fill();
  } else {
    setFont(ctx, 16, 'normal');
    ctx.fillStyle = C.muted;
    ctx.fillText('—', p3X, VALUE_Y);
  }

  // ── Bottom divider ────────────────────────────────────────────────────────────
  hline(ctx, 316, PAD, W - PAD);

  // ── Precipitation ─────────────────────────────────────────────────────────────
  if (data.precip1h !== undefined || data.precip12h !== undefined) {
    drawRainGauge(ctx, PAD + 50, 410, data.precip1h, data.precip12h);
  }

  // Climate precipitation stats — to the right of gauge
  console.log('precipYTD:', data.precipYTD, 'precipAnomaly3M:', data.precipAnomaly3M);
  if (data.precipYTD !== undefined || data.precipAnomaly3M !== undefined) {
    const csX = PAD + 160;
    const csY = 340;
    const lineH = 16;

    setFont(ctx, 10, 'normal');
    ctx.fillStyle = C.secondary;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('PRECIPITATION STATS', csX, csY);

    if (data.precipYTD !== undefined) {
      setFont(ctx, 12, 'bold');
      ctx.fillStyle = C.primary;
      ctx.fillText(`${data.precipYTD.toFixed(0)} mm`, csX, csY + lineH);
      setFont(ctx, 10, 'normal');
      ctx.fillStyle = C.label;
      ctx.fillText('year to date', csX, csY + lineH * 2);
    }

    if (data.precipAnomaly3M !== undefined) {
      const anomalyColor = data.precipAnomaly3M >= 100 ? C.rain : '#f97316';
      const sign = data.precipAnomaly3M >= 100 ? '+' : '';
      setFont(ctx, 12, 'bold');
      ctx.fillStyle = anomalyColor;
      ctx.fillText(`${sign}${(data.precipAnomaly3M - 100).toFixed(0)}%`, csX, csY + lineH * 3);
      setFont(ctx, 10, 'normal');
      ctx.fillStyle = C.label;
      ctx.fillText('vs 1961–1990 normal (3 months)', csX, csY + lineH * 4);
    }
  }

  // ── Lightning ─────────────────────────────────────────────────────────────────
  if (data.lightningCount !== undefined && data.lightningCount > 0) {
    const lx = 500;
    const ly = 340;

    // Lightning bolt icon
    ctx.save();
    ctx.fillStyle = '#a855f7';
    ctx.beginPath();
    ctx.moveTo(lx + 10, ly);
    ctx.lineTo(lx + 2,  ly + 14);
    ctx.lineTo(lx + 8,  ly + 14);
    ctx.lineTo(lx,      ly + 28);
    ctx.lineTo(lx + 14, ly + 12);
    ctx.lineTo(lx + 8,  ly + 12);
    ctx.lineTo(lx + 14, ly);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    setFont(ctx, 10, 'normal');
    ctx.fillStyle = C.secondary;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('LIGHTNING (24H)', lx + 22, ly);

    setFont(ctx, 20, 'bold');
    ctx.fillStyle = '#a855f7';
    ctx.fillText(`${data.lightningCount}`, lx + 22, ly + 14);

    setFont(ctx, 10, 'normal');
    ctx.fillStyle = C.label;
    ctx.fillText('total strikes · Vestland', lx + 22, ly + 36);

    if (data.lightningCTG !== undefined && data.lightningCTG > 0) {
      ctx.fillText(`${data.lightningCTG} cloud-to-ground`, lx + 22, ly + 50);
    }
  }
  if (data.stationInfo) {
    const s = data.stationInfo;
    const sx = 340;
    const sy = 330;
    const lineH = 16;

    setFont(ctx, 10, 'normal');
    ctx.fillStyle = C.secondary;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('OBS STATION', sx, sy);

    setFont(ctx, 12, 'bold');
    ctx.fillStyle = C.primary;
    ctx.fillText(s.name, sx, sy + lineH);

    setFont(ctx, 11, 'normal');
    ctx.fillStyle = C.label;
    const lines: string[] = [];
    if (s.lat !== undefined && s.lon !== undefined) {
      lines.push(`${s.lat.toFixed(4)}° N  ${s.lon.toFixed(4)}° E`);
    }
    if (s.elevation)  lines.push(`Elevation: ${s.elevation}`);
    if (s.wmo)        lines.push(`WMO: ${s.wmo}`);
    if (s.wigos)      lines.push(`WIGOS: ${s.wigos}`);

    lines.forEach((line, i) => {
      ctx.fillText(line, sx, sy + lineH * 2 + i * lineH);
    });
  }

  // ── Sunrise / sunset + moonrise / moonset ─────────────────────────────────────
  const celestialY = 436;
  let celestialX = PAD;

  function drawMiniSun(x: number, y: number) {
    ctx.save();
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 9.5, y + Math.sin(a) * 9.5);
      ctx.lineTo(x + Math.cos(a) * 12,  y + Math.sin(a) * 12);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMiniMoon(x: number, y: number) {
    ctx.save();
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x + 4, y - 1, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  if (data.sunrise || data.sunset) {
    drawMiniSun(celestialX + 13, celestialY);
    setFont(ctx, 12, 'normal');
    ctx.fillStyle = C.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (data.sunrise) {
      ctx.fillText(`↑ ${data.sunrise}`, celestialX + 28, celestialY);
      celestialX += 28 + ctx.measureText(`↑ ${data.sunrise}`).width + 10;
    }
    if (data.sunset) {
      ctx.fillText(`↓ ${data.sunset}`, celestialX, celestialY);
      celestialX += ctx.measureText(`↓ ${data.sunset}`).width + 24;
    }
  }

  if (data.moonrise || data.moonset) {
    drawMiniMoon(celestialX + 13, celestialY);
    setFont(ctx, 12, 'normal');
    ctx.fillStyle = C.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    celestialX += 28;
    if (data.moonrise) {
      ctx.fillText(`↑ ${data.moonrise}`, celestialX, celestialY);
      celestialX += ctx.measureText(`↑ ${data.moonrise}`).width + 10;
    }
    if (data.moonset) {
      ctx.fillText(`↓ ${data.moonset}`, celestialX, celestialY);
      celestialX += ctx.measureText(`↓ ${data.moonset}`).width + 24;
    }
  }

  // Moon phase disc + label
  if (data.moonPhase !== undefined) {
    const discR = 10;
    drawMoonPhaseDisc(ctx, celestialX + discR, celestialY, discR, data.moonPhase);
    setFont(ctx, 12, 'normal');
    ctx.fillStyle = C.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(moonPhaseLabel(data.moonPhase), celestialX + discR * 2 + 6, celestialY);
  }

  // ── Credit ────────────────────────────────────────────────────────────────────
  setFont(ctx, 11, 'normal');
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('Data: MET Norway · frost.met.no  |  Icons: Yr / NRK · yr.no', W - PAD, 462);

  // ── Bottom label ─────────────────────────────────────────────────────────────
  setFont(ctx, 11, 'normal');
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('bergenweather.bsky.social', PAD, H - 14);

  return canvas.toBuffer('image/png');
}