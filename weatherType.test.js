"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const weatherType_js_1 = require("./weatherType.js");
(0, vitest_1.describe)('getWeatherTypeText', () => {
    (0, vitest_1.it)('returns mapped text for a known code', () => {
        (0, vitest_1.expect)((0, weatherType_js_1.getWeatherTypeText)(60)).toBe('rain, intermittent slight');
    });
    (0, vitest_1.it)('pads single digit codes before lookup', () => {
        (0, vitest_1.expect)((0, weatherType_js_1.getWeatherTypeText)(1)).toBe('clouds generally dissolving');
    });
    (0, vitest_1.it)('returns fallback text for unknown code', () => {
        (0, vitest_1.expect)((0, weatherType_js_1.getWeatherTypeText)(123)).toBe('weather code 123');
    });
    (0, vitest_1.it)('returns no weather type for NaN', () => {
        const code = Number.NaN;
        (0, vitest_1.expect)((0, weatherType_js_1.getWeatherTypeText)(code)).toBe('no weather type: ');
    });
});
