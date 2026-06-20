import { createCanvas, CanvasRenderingContext2D } from 'canvas';

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
  weatherTypeCode: number;      // WW synop code 0–99
  observationTime: string;      // ISO 8601
  sunrise?: string;             // HH:MM local
  sunset?: string;              // HH:MM local
  isNight?: boolean;            // true when current time is before sunrise or after sunset
};

// ─── Colour palette ───────────────────────────────────────────────────────────

const C = {
  bg:          '#18181b',
  bgCard:      '#1c1c1f',
  line:        '#27272a',
  muted:       '#52525b',
  secondary:   '#71717a',
  label:       '#a1a1aa',
  primary:     '#f4f4f5',
  accent:      '#60a5fa',   // blue – wind / info
  sun:         '#facc15',   // yellow – sun
  rain:        '#93c5fd',   // light blue – rain
  snow:        '#bfdbfe',   // pale blue – snow
  thunder:     '#a78bfa',   // purple – thunder
  cloud:       '#9ca3af',   // grey – cloud
  green:       '#34d399',   // rising pressure
  red:         '#f87171',   // falling pressure
};

// ─── Weather icon classification ──────────────────────────────────────────────

type IconKind = 'sun' | 'partcloud' | 'moon' | 'partcloudnight' | 'cloud' | 'rain' | 'sleet' | 'snow' | 'thunder' | 'fog';

export function classifyWeatherIcon(wwCode: number, isNight = false): IconKind {
  if (!Number.isFinite(wwCode)) return 'cloud';
  const w = Math.round(wwCode);
  if (w <= 2)              return isNight ? 'moon' : 'sun';
  if (w <= 9)              return isNight ? 'partcloudnight' : 'partcloud';
  if (w >= 10 && w <= 19) return 'fog';
  if (w >= 20 && w <= 29) return 'cloud';
  if (w >= 30 && w <= 39) return 'fog';       // dust / sand / haze
  if (w >= 40 && w <= 49) return 'fog';
  if (w >= 50 && w <= 69) return 'rain';
  if (w >= 70 && w <= 79) return 'snow';
  if (w >= 80 && w <= 84) return 'rain';
  if (w >= 85 && w <= 86) return 'snow';
  if (w >= 87 && w <= 89) return 'sleet';
  if (w >= 90 && w <= 99) return 'thunder';
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

// ─── Icon drawing ─────────────────────────────────────────────────────────────

function drawSun(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.strokeStyle = C.sun;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  // Circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Rays
  const rayLen = r * 0.45;
  const rayStart = r + 6;
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * rayStart, cy + Math.sin(angle) * rayStart);
    ctx.lineTo(cx + Math.cos(angle) * (rayStart + rayLen), cy + Math.sin(angle) * (rayStart + rayLen));
    ctx.stroke();
  }
  ctx.restore();
}

function drawCloud(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, color = C.cloud) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  // Simple cloud from overlapping circles
  ctx.arc(cx,          cy,          scale * 22, 0, Math.PI * 2);
  ctx.arc(cx + scale * 28, cy - scale * 6,  scale * 16, 0, Math.PI * 2);
  ctx.arc(cx - scale * 22, cy + scale * 4,  scale * 14, 0, Math.PI * 2);
  ctx.arc(cx + scale * 10, cy - scale * 18, scale * 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRaindrops(ctx: CanvasRenderingContext2D, cx: number, cy: number, count: number, color = C.rain) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  const spacing = 16;
  const startX = cx - ((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    ctx.moveTo(startX + i * spacing, cy);
    ctx.lineTo(startX + i * spacing - 4, cy + 18);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSnowflakes(ctx: CanvasRenderingContext2D, cx: number, cy: number, count: number) {
  ctx.save();
  ctx.fillStyle = C.snow;
  const spacing = 16;
  const startX = cx - ((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    const x = startX + i * spacing;
    ctx.beginPath();
    ctx.arc(x, cy + 8, 4, 0, Math.PI * 2);
    ctx.fill();
    // Cross lines
    ctx.strokeStyle = C.snow;
    ctx.lineWidth = 2;
    for (let a = 0; a < 3; a++) {
      const ang = (a * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(ang) * 7, cy + 8 - Math.sin(ang) * 7);
      ctx.lineTo(x + Math.cos(ang) * 7, cy + 8 + Math.sin(ang) * 7);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawThunderBolt(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  ctx.fillStyle = C.thunder;
  ctx.beginPath();
  ctx.moveTo(cx + 8,  cy);
  ctx.lineTo(cx - 4,  cy + 22);
  ctx.lineTo(cx + 2,  cy + 22);
  ctx.lineTo(cx - 8,  cy + 48);
  ctx.lineTo(cx + 6,  cy + 26);
  ctx.lineTo(cx,      cy + 26);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFog(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  ctx.strokeStyle = C.cloud;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - 36, cy + i * 18);
    ctx.lineTo(cx + 36, cy + i * 18);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMoon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  // Crescent: full circle minus an offset circle clipped away
  ctx.fillStyle = '#e2e8f0';  // cool silver-white
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Erase a chunk to make the crescent using destination-out
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx + r * 0.55, cy - r * 0.1, r * 0.82, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // A couple of faint stars nearby
  ctx.fillStyle = '#94a3b8';
  const stars = [
    { x: cx + r + 18, y: cy - r - 10, s: 2.5 },
    { x: cx + r + 32, y: cy - 4,      s: 1.8 },
    { x: cx + r + 8,  y: cy + r + 8,  s: 2.0 },
  ];
  for (const star of stars) {
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawWeatherIcon(ctx: CanvasRenderingContext2D, kind: IconKind, cx: number, cy: number) {
  switch (kind) {
    case 'sun':
      drawSun(ctx, cx, cy, 36);
      break;
    case 'partcloud':
      drawSun(ctx, cx - 16, cy - 16, 24);
      drawCloud(ctx, cx + 8, cy + 12, 0.8);
      break;
    case 'moon':
      drawMoon(ctx, cx, cy, 36);
      break;
    case 'partcloudnight':
      drawMoon(ctx, cx - 14, cy - 18, 24);
      drawCloud(ctx, cx + 8, cy + 12, 0.8);
      break;
    case 'cloud':
      drawCloud(ctx, cx, cy, 1.0);
      break;
    case 'rain':
      drawCloud(ctx, cx, cy - 18, 0.9);
      drawRaindrops(ctx, cx, cy + 22, 4);
      break;
    case 'sleet':
      drawCloud(ctx, cx, cy - 18, 0.9);
      drawRaindrops(ctx, cx - 8, cy + 22, 2);
      drawSnowflakes(ctx, cx + 12, cy + 22, 2);
      break;
    case 'snow':
      drawCloud(ctx, cx, cy - 18, 0.9);
      drawSnowflakes(ctx, cx, cy + 22, 4);
      break;
    case 'thunder':
      drawCloud(ctx, cx, cy - 18, 0.9);
      drawThunderBolt(ctx, cx - 8, cy + 14);
      break;
    case 'fog':
      drawFog(ctx, cx, cy);
      break;
  }
}

// ─── Accent bar for icon kind ─────────────────────────────────────────────────

function accentColor(kind: IconKind): string {
  switch (kind) {
    case 'sun':            return C.sun;
    case 'partcloud':      return C.sun;
    case 'moon':           return '#94a3b8';   // cool silver
    case 'partcloudnight': return '#94a3b8';
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
export function generateWeatherImage(data: WeatherImageData): Buffer {
  const W = 800;
  const H = 420;
  const PAD = 44;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const iconKind = classifyWeatherIcon(data.weatherTypeCode, data.isNight ?? false);
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

  // ── Weather icon (right side) ────────────────────────────────────────────────
  drawWeatherIcon(ctx, iconKind, 660, 120);

  // Icon label
  setFont(ctx, 12, 'normal');
  ctx.fillStyle = C.label;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(weatherIconLabel(iconKind).toUpperCase(), 660, 180);

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