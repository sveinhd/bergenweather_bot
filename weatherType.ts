import enWeatherTypeMap from './locals/en.json' with { type: 'json' };

type WeatherTypeMap = Record<string, string>;

const weatherTypeMap = enWeatherTypeMap as WeatherTypeMap;

export function getWeatherTypeText(code: number) {
    if (!Number.isFinite(code)) {
        return '';
    }


    
    if (code >= 30 && code < 40) {
        return 'fog';
    }
    if (code >= 50 && code < 60) {
        return 'drizzle';
    }
    if (code >= 60 && code < 70) {
        return 'rain';
    }
    if (code >= 70 && code < 80) {
        return 'snow';
    }

    switch (code) {
        case 20:
            return 'drizzle';
        case 21:
            return 'rain';
        case 22:
            return 'snow';
        case 24:
            return 'hail';
        default:
            break;
    }
    const weatherCode = code.toFixed(0).padStart(2, '0');


    const mappedWeather = weatherTypeMap[weatherCode];


    if (mappedWeather) {
        return mappedWeather;
    }

    return '';
}
