// test-image.ts
import { generateWeatherImage } from './weatherImage.js';

const imageBuffer = await generateWeatherImage({
  temperature: 14.9,
  feelsLike: 14.4,
  windSpeed: 5.0,
  windDirection: 177,
  windGust: 11.0,
  windMax: 7.0,
  pressure: 1011.2,
  pressureTendency: 1.5,
  humidity: 91.6,
  cloudCover: 8,
  weatherTypeCode: 2,
  observationTime: new Date().toISOString(),
  sunrise: '04:14',
  sunset: '23:06',
  moonrise: '22:31',
  moonset: '05:12',
  moonPhase: 288.54,
  isNight: false,
  tempMin: 12.1,
  tempMax: 16.2,
  precip1h: 2.4,
  precip12h: 12.7,
  stationInfo: {
    name: 'BERGEN - FLORIDA',
    lat: 60.383,
    lon: 5.3327,
    elevation: '12 m',
    wmo: '1317',
    wigos: '0-20000-0-01317',
  },
});

import { writeFileSync } from 'fs';
writeFileSync('preview.png', imageBuffer);
console.log('Saved preview.png');