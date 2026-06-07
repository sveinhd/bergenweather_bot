import enWeatherTypeMap from './locals/en.json';

type WeatherTypeMap = Record<string, string>;

const weatherTypeMap = enWeatherTypeMap as WeatherTypeMap;

export function getWeatherTypeText(code: number) {
    if (!Number.isFinite(code)) {
        return 'no weather type: ';
    }

    const weatherCode = code.toFixed(0).padStart(2, '0');
    const mappedWeather = weatherTypeMap[weatherCode];

    if (mappedWeather) {
        return mappedWeather;
    }

    return `weather code ${code.toFixed(0)}`;
}
