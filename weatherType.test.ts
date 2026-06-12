import { describe, expect, it } from 'vitest';
import { getWeatherTypeText } from './weatherType.js';

describe('getWeatherTypeText', () => {
    it('returns mapped text for a known code', () => {
        expect(getWeatherTypeText(60)).toBe('rain, intermittent slight');
    });

    it('pads single digit codes before lookup', () => {
        expect(getWeatherTypeText(1)).toBe('clouds generally dissolving');
    });

    it('returns fallback text for unknown code', () => {
        expect(getWeatherTypeText(123)).toBe('');
    });

    it('returns no weather type for NaN', () => {
        const code = Number.NaN;
        expect(getWeatherTypeText(code)).toBe('');
    });
});
