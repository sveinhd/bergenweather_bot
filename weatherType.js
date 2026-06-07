"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWeatherTypeText = getWeatherTypeText;
const en_json_1 = __importDefault(require("./locals/en.json"));
const weatherTypeMap = en_json_1.default;
function getWeatherTypeText(code) {
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
