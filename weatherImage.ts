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
  isNight?: boolean;            // true when current time is before sunrise or after sunset
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

// ─── Wind compass rose ────────────────────────────────────────────────────────

function drawCompass(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fromDeg: number) {
  ctx.save();

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
  setFont(ctx, 11, 'normal');
  ctx.fillStyle = C.secondary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cardinals = ['N','E','S','W'];
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2 - Math.PI / 2;
    const lr = r - 18;
    ctx.fillText(cardinals[i], cx + Math.cos(ang) * lr, cy + Math.sin(ang) * lr);
  }

  // Wind arrow – points FROM origin (where wind comes from)
  const fromRad = (fromDeg - 90) * (Math.PI / 180);
  const arrowR = r - 12;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(fromRad + Math.PI); // arrow points toward origin (where wind blows to)

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

  ctx.restore();
  ctx.restore();
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
  const H = 420;
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
    setFont(ctx, 14, 'normal');
    ctx.fillStyle = C.label;
    ctx.fillText(`feels like ${data.feelsLike.toFixed(1)}°C`, PAD + 2, 156);
  }

  // ── Divider ──────────────────────────────────────────────────────────────────
  hline(ctx, 188, PAD, W - PAD);

  // ── Wind section ─────────────────────────────────────────────────────────────
  const compassCX = PAD + 36;
  const compassCY = 262;
  drawCompass(ctx, compassCX, compassCY, 36, data.windDirection);

  setFont(ctx, 11, 'normal');
  ctx.fillStyle = C.secondary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('WIND', PAD + 86, 206);

  setFont(ctx, 28, 'bold');
  ctx.fillStyle = C.primary;
  ctx.fillText(`${data.windSpeed.toFixed(1)} m/s`, PAD + 86, 222);

  setFont(ctx, 13, 'normal');
  ctx.fillStyle = C.accent;
  const wArrow = windArrow(data.windDirection);
  const wDir = windDirectionLabel(data.windDirection);
  ctx.fillText(`${wArrow} from ${wDir}  ·  ${data.windDirection.toFixed(0)}°`, PAD + 86, 256);

  if (data.windGust !== undefined) {
    ctx.fillStyle = C.label;
    setFont(ctx, 12, 'normal');
    const gustParts = [`gust ${data.windGust.toFixed(1)} m/s`];
    if (data.windMax !== undefined) gustParts.push(`max ${data.windMax.toFixed(1)} m/s`);
    ctx.fillText(gustParts.join('  ·  '), PAD + 86, 276);
  }

  // ── Vertical separator ────────────────────────────────────────────────────────
  const col2X = 320;
  ctx.beginPath();
  ctx.moveTo(col2X, 196);
  ctx.lineTo(col2X, 306);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Pressure section ─────────────────────────────────────────────────────────
  setFont(ctx, 11, 'normal');
  ctx.fillStyle = C.secondary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('PRESSURE', col2X + 24, 206);

  setFont(ctx, 28, 'bold');
  ctx.fillStyle = C.primary;
  ctx.fillText(`${data.pressure.toFixed(1)}`, col2X + 24, 222);

  setFont(ctx, 14, 'normal');
  ctx.fillStyle = C.label;
  ctx.fillText('hPa', col2X + 24 + ctx.measureText(`${data.pressure.toFixed(1)}`).width + 6, 232);

  const trend = pressureTrendText(data.pressureTendency);
  setFont(ctx, 13, 'normal');
  ctx.fillStyle = trend.color;
  ctx.fillText(trend.label, col2X + 24, 258);

  // ── Vertical separator ────────────────────────────────────────────────────────
  const col3X = 560;
  ctx.beginPath();
  ctx.moveTo(col3X, 196);
  ctx.lineTo(col3X, 306);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Humidity section ─────────────────────────────────────────────────────────
  setFont(ctx, 11, 'normal');
  ctx.fillStyle = C.secondary;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('HUMIDITY', col3X + 24, 206);

  if (data.humidity !== undefined) {
    setFont(ctx, 28, 'bold');
    ctx.fillStyle = C.primary;
    ctx.fillText(`${data.humidity.toFixed(0)}%`, col3X + 24, 222);
  } else {
    setFont(ctx, 16, 'normal');
    ctx.fillStyle = C.muted;
    ctx.fillText('—', col3X + 24, 226);
  }

  // Humidity bar
  if (data.humidity !== undefined) {
    const barX = col3X + 24;
    const barY = 260;
    const barW = W - PAD - col3X - 24;
    const barH = 6;
    ctx.fillStyle = C.line;
    ctx.roundRect(barX, barY, barW, barH, 3);
    ctx.fill();
    ctx.fillStyle = C.accent;
    ctx.roundRect(barX, barY, barW * (data.humidity / 100), barH, 3);
    ctx.fill();
  }

  // ── Bottom divider ────────────────────────────────────────────────────────────
  hline(ctx, 316, PAD, W - PAD);

  // ── Sunrise / sunset ──────────────────────────────────────────────────────────
  if (data.sunrise && data.sunset) {
    setFont(ctx, 12, 'normal');
    ctx.fillStyle = C.secondary;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`☀  ${data.sunrise} ↑   ${data.sunset} ↓`, PAD, 330);
  }

  // ── Credit ────────────────────────────────────────────────────────────────────
  setFont(ctx, 11, 'normal');
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('Data: The Norwegian Meteorological Institute · frost.met.no', W - PAD, 330);

  // ── Bottom label ─────────────────────────────────────────────────────────────
  setFont(ctx, 11, 'normal');
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('bergenweather.bsky.social', PAD, H - 14);

  return canvas.toBuffer('image/png');
}