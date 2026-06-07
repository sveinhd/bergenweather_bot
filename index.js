"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@atproto/api");
const dotenv = __importStar(require("dotenv"));
const cron_1 = require("cron");
const process = __importStar(require("process"));
const weatherType_js_1 = require("./weatherType.js");
dotenv.config();
const frostBaseUrl = 'https://frost.met.no/api/v1/obs/base?stationids=50540&elementids=air_pressure_at_sea_level,weather_type,wind_from_direction,air_temperature,wind_speed&time=latest&incobs=true';
// Create a Bluesky Agent 
const agent = new api_1.BskyAgent({
    service: 'https://bsky.social',
});
async function fetchLatestFrostObservation() {
    const frostId = process.env.FROST_ID;
    if (!frostId) {
        throw new Error('Missing FROST_ID in .env');
    }
    const basicAuth = btoa(`${frostId}:`);
    const response = await fetch(frostBaseUrl, {
        headers: {
            Authorization: `Basic ${basicAuth}`,
            Accept: 'application/json',
        },
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Frost API request failed (${response.status}): ${body}`);
    }
    return (await response.json());
}
function getLatestObservation(series) {
    const observations = series?.observations;
    return Array.isArray(observations) && observations.length > 0
        ? observations[observations.length - 1]
        : undefined;
}
function getObservationTime(frostData) {
    const allSeries = frostData.data?.tseries ?? [];
    const airPressureSeries = allSeries.find((series) => series.header?.extra?.element?.id === 'air_pressure_at_sea_level');
    const temperatureSeries = allSeries.find((series) => series.header?.extra?.element?.id === 'air_temperature');
    const windSeries = allSeries.find((series) => series.header?.extra?.element?.id === 'wind_speed');
    const windDirectionSeries = allSeries.find((series) => series.header?.extra?.element?.id === 'wind_from_direction');
    return (getLatestObservation(temperatureSeries)?.time ??
        getLatestObservation(windSeries)?.time ??
        getLatestObservation(windDirectionSeries)?.time ??
        temperatureSeries?.header?.available?.from ??
        windSeries?.header?.available?.from ??
        airPressureSeries?.header?.available?.from);
}
function getStationCoordinates(frostData) {
    const allSeries = frostData.data?.tseries ?? [];
    for (const series of allSeries) {
        const location = series.header?.extra?.station?.location?.[0]?.value;
        const latitude = Number.parseFloat(location?.latitude ?? '');
        const longitude = Number.parseFloat(location?.longitude ?? '');
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            return { latitude, longitude };
        }
    }
    return undefined;
}
function getTimeZoneOffsetString(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset',
    });
    const offsetPart = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value;
    const match = offsetPart?.match(/^GMT([+-]\d{1,2})(?::?(\d{2}))?$/);
    if (!match) {
        return '+00:00';
    }
    const signedHour = Number.parseInt(match[1], 10);
    const sign = signedHour < 0 ? '-' : '+';
    const hours = Math.abs(signedHour).toString().padStart(2, '0');
    const minutes = (match[2] ?? '00').padStart(2, '0');
    return `${sign}${hours}:${minutes}`;
}
function formatSunEventTime(value) {
    if (!value) {
        return 'n/a';
    }
    return new Date(value).toLocaleTimeString('no-NO', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Oslo',
    });
}
async function fetchSunriseSunsetText(frostData) {
    const coordinates = getStationCoordinates(frostData);
    const observationTime = getObservationTime(frostData);
    if (!coordinates || !observationTime) {
        return undefined;
    }
    const observationDate = new Date(observationTime);
    const date = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Europe/Oslo',
    }).format(observationDate);
    const offset = getTimeZoneOffsetString(observationDate, 'Europe/Oslo');
    const createUrl = (path) => {
        const url = new URL(`https://api.met.no/weatherapi/sunrise/3.0/${path}`);
        url.searchParams.set('lat', coordinates.latitude.toString());
        url.searchParams.set('lon', coordinates.longitude.toString());
        url.searchParams.set('date', date);
        url.searchParams.set('offset', offset);
        return url.toString();
    };
    const fetchCelestial = async (path) => {
        const response = await fetch(createUrl(path), {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'bergenweather-bot/1.0 github.com/bergenweather_bot',
            },
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`${path} API request failed (${response.status}): ${body}`);
        }
        return (await response.json());
    };
    const [sunData, moonData] = await Promise.all([
        fetchCelestial('sun'),
        fetchCelestial('moon'),
    ]);
    const sunrise = formatSunEventTime(sunData.properties?.sunrise?.time);
    const sunset = formatSunEventTime(sunData.properties?.sunset?.time);
    const moonrise = formatSunEventTime(moonData.properties?.moonrise?.time);
    const moonset = formatSunEventTime(moonData.properties?.moonset?.time);
    return `Sun: up ${sunrise}, down ${sunset}\nMoon: up ${moonrise}, down ${moonset}`;
}
function formatLatestWeatherPost(frostData) {
    const allSeries = frostData.data?.tseries ?? [];
    const stationName = allSeries[0]?.header?.extra?.station?.shortname ?? 'Bergen';
    const pressureSeries = allSeries.find((series) => series.header?.extra?.element?.id === 'air_pressure_at_sea_level');
    const temperatureSeries = allSeries.find((series) => series.header?.extra?.element?.id === 'air_temperature');
    const windSeries = allSeries.find((series) => series.header?.extra?.element?.id === 'wind_speed');
    const latestPressureObservation = getLatestObservation(pressureSeries);
    const latestTemperatureObservation = getLatestObservation(temperatureSeries);
    const latestWindObservation = getLatestObservation(windSeries);
    const latestWindDirectionObservation = getLatestObservation(allSeries.find((series) => series.header?.extra?.element?.id === 'wind_from_direction'));
    const latestWeatherTypeObservation = getLatestObservation(allSeries.find((series) => series.header?.extra?.element?.id === 'weather_type'));
    const pressureRaw = latestPressureObservation?.body?.value;
    const temperatureRaw = latestTemperatureObservation?.body?.value;
    const windRaw = latestWindObservation?.body?.value;
    const windDirectionRaw = latestWindDirectionObservation?.body?.value;
    const weatherTypeRaw = latestWeatherTypeObservation?.body?.value;
    const pressure = typeof pressureRaw === 'string' ? Number.parseFloat(pressureRaw) : Number.NaN;
    const temperature = typeof temperatureRaw === 'string' ? Number.parseFloat(temperatureRaw) : Number.NaN;
    const windSpeed = typeof windRaw === 'string' ? Number.parseFloat(windRaw) : Number.NaN;
    const windDirection = typeof windDirectionRaw === 'string' ? Number.parseFloat(windDirectionRaw) : Number.NaN;
    const rotatedWindDirection = Number.isFinite(windDirection)
        ? rotateWindDirection(windDirection)
        : Number.NaN;
    const weatherTypeCode = typeof weatherTypeRaw === 'string' ? Number.parseFloat(weatherTypeRaw) : Number.NaN;
    const observationTime = latestPressureObservation?.time ??
        latestTemperatureObservation?.time ??
        latestWindObservation?.time ??
        latestWindDirectionObservation?.time ??
        pressureSeries?.header?.available?.from ??
        temperatureSeries?.header?.available?.from ??
        windSeries?.header?.available?.from;
    if (!observationTime) {
        throw new Error('Could not parse observation date from Frost response');
    }
    const date = new Date(observationTime);
    const formattedDate = date.toLocaleString('no-NO', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Oslo',
    });
    if (!Number.isFinite(pressure) && !Number.isFinite(temperature) && !Number.isFinite(windSpeed)) {
        return `${stationName}: no pressure, temperature or wind observation available (${formattedDate})`;
    }
    const temperatureText = Number.isFinite(temperature)
        ? `${temperature.toFixed(1)} °C`
        : 'no temperature';
    const pressureText = Number.isFinite(pressure) ? `${pressure.toFixed(1)} hPa` : 'no pressure';
    const windText = Number.isFinite(windSpeed)
        ? `${windSpeed.toFixed(1)} m/s`
        : 'no wind';
    const windDirectionArrow = Number.isFinite(rotatedWindDirection)
        ? getWindDirectionArrow(rotatedWindDirection)
        : '';
    const windDirectionText = Number.isFinite(rotatedWindDirection)
        ? `${windDirectionArrow}`
        : 'no wind direction';
    const weatherTypeText = (0, weatherType_js_1.getWeatherTypeText)(weatherTypeCode);
    return `${stationName}: ${temperatureText}, ${pressureText}, ${windText} ${windDirectionText}, ${weatherTypeText} (${formattedDate})`;
}
function rotateWindDirection(degrees) {
    const normalized = ((degrees % 360) + 360) % 360;
    const rotated = normalized + 180;
    return rotated > 360 ? rotated - 360 : rotated;
}
function getWindDirectionArrow(degrees) {
    const normalized = ((degrees % 360) + 360) % 360;
    if (normalized >= 337.5 || normalized < 22.5)
        return '↑';
    if (normalized < 67.5)
        return '↗';
    if (normalized < 112.5)
        return '→';
    if (normalized < 157.5)
        return '↘';
    if (normalized < 202.5)
        return '↓';
    if (normalized < 247.5)
        return '↙';
    if (normalized < 292.5)
        return '←';
    return '↖';
}
function createLinkFacet(text, linkText, uri) {
    const start = text.indexOf(linkText);
    if (start === -1) {
        return undefined;
    }
    const encoder = new TextEncoder();
    const byteStart = encoder.encode(text.slice(0, start)).length;
    const byteEnd = byteStart + encoder.encode(linkText).length;
    return {
        index: { byteStart, byteEnd },
        features: [
            {
                $type: 'app.bsky.richtext.facet#link',
                uri,
            },
        ],
    };
}
async function main() {
    const frostData = await fetchLatestFrostObservation();
    console.log('Frost latest observation summary:', {
        tstype: frostData.data?.tstype,
        seriesCount: frostData.data?.tseries?.length ?? 0,
    });
    const weatherText = formatLatestWeatherPost(frostData);
    const sunriseSunsetText = await fetchSunriseSunsetText(frostData);
    const creditLinkText = 'frost.met.no';
    const postText = `${weatherText}${sunriseSunsetText ? `\n${sunriseSunsetText}` : ''}\nData from The Norwegian Meteorological Institute (${creditLinkText})`;
    const creditFacet = createLinkFacet(postText, creditLinkText, 'https://frost.met.no');
    console.log('Post text:\n' + postText);
    await agent.login({ identifier: process.env.BLUESKY_USERNAME, password: process.env.BLUESKY_PASSWORD });
    await agent.post({
        text: postText,
        facets: creditFacet ? [creditFacet] : undefined,
    });
    console.log("Just posted!");
}
main();
// Run this on a cron job
// const scheduleExpressionMinute = '* * * * *'; // Run once every minute for testing
const scheduleExpression = '10 * * * *'; // Run once every three hours in prod
const job = new cron_1.CronJob(scheduleExpression, main); // change to scheduleExpressionMinute for testing
job.start();
