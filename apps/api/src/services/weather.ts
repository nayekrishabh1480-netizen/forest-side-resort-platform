import type { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

type ForecastDay = { date: string; minC: number | null; maxC: number | null; rainProbabilityPct: number | null; conditionCode: number | null };
type WeatherPayload = {
  available: boolean;
  location: string;
  source: string | null;
  current: { temperatureC: number | null; humidityPct: number | null; precipitationMm: number | null; rainProbabilityPct: number | null; conditionCode: number | null } | null;
  forecast: ForecastDay[];
  lastUpdated: string | null;
  stale: boolean;
};

async function fetchJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('WEATHER_PROVIDER_UNAVAILABLE');
  return response.json() as Promise<Record<string, unknown>>;
}

export function createWeatherService(prisma: PrismaClient, fetcher: typeof fetch = fetch) {
  const request = async (url: string) => {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8_000), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('WEATHER_PROVIDER_UNAVAILABLE');
    return response.json() as Promise<Record<string, unknown>>;
  };

  async function providerData() {
      const geo = await request(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(config.WEATHER_LOCATION_NAME)}&count=5&countryCode=IN&language=en&format=json`);
    const results = geo.results as Array<{ latitude?: number; longitude?: number; name?: string }> | undefined;
    const point = results?.[0];
    if (typeof point?.latitude !== 'number' || typeof point.longitude !== 'number') throw new Error('WEATHER_LOCATION_NOT_FOUND');
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: String(point.latitude), longitude: String(point.longitude), timezone: 'Asia/Kolkata',
      current: 'temperature_2m,relative_humidity_2m,precipitation,rain,weather_code',
      daily: 'temperature_2m_min,temperature_2m_max,precipitation_probability_max,weather_code',
      forecast_days: '5',
    }).toString();
    const forecast = await request(url.toString());
    const current = forecast.current as Record<string, unknown> | undefined;
    const daily = forecast.daily as Record<string, unknown> | undefined;
    const list = (key: string): unknown[] => Array.isArray(daily?.[key]) ? daily[key] as unknown[] : [];
    const dates = list('time');
    const days = dates.map((date, index): ForecastDay => ({
      date: typeof date === 'string' ? date : '',
      minC: numberOrNull(list('temperature_2m_min')[index]),
      maxC: numberOrNull(list('temperature_2m_max')[index]),
      rainProbabilityPct: numberOrNull(list('precipitation_probability_max')[index]),
      conditionCode: numberOrNull(list('weather_code')[index]),
    }));
    return {
      location: typeof point.name === 'string' ? point.name : config.WEATHER_LOCATION_NAME,
      current: {
        temperatureC: numberOrNull(current?.temperature_2m),
        humidityPct: numberOrNull(current?.relative_humidity_2m),
        precipitationMm: numberOrNull(current?.precipitation),
        rainProbabilityPct: null,
        conditionCode: numberOrNull(current?.weather_code),
      },
      forecast: days,
      lastUpdated: typeof current?.time === 'string' ? current.time : new Date().toISOString(),
    };
  }

  async function get(): Promise<WeatherPayload> {
    const latest = await prisma.weatherRecord.findFirst({ where: { locationName: config.WEATHER_LOCATION_NAME }, orderBy: { fetchedAt: 'desc' } });
    if (latest && latest.expiresAt.getTime() > Date.now()) return serialize(latest, false);
    try {
      const data = await providerData();
      const fetchedAt = new Date();
      const saved = await prisma.weatherRecord.create({ data: {
        locationName: config.WEATHER_LOCATION_NAME, source: 'Open-Meteo',
        temperatureC: data.current.temperatureC, relativeHumidityPct: data.current.humidityPct,
        precipitationMm: data.current.precipitationMm, rainProbabilityPct: data.current.rainProbabilityPct,
        conditionCode: data.current.conditionCode, forecast: data.forecast,
        fetchedAt, expiresAt: new Date(fetchedAt.getTime() + config.WEATHER_CACHE_TTL_SECONDS * 1000),
      } });
      return { available: true, location: data.location, source: saved.source, current: data.current, forecast: data.forecast, lastUpdated: fetchedAt.toISOString(), stale: false };
    } catch {
      return latest ? serialize(latest, true) : unavailable();
    }
  }

  return { get };
}

function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

function unavailable(): WeatherPayload {
  return { available: false, location: config.WEATHER_LOCATION_NAME, source: null, current: null, forecast: [], lastUpdated: null, stale: false };
}

function serialize(record: { source: string; temperatureC: unknown; relativeHumidityPct: number | null; precipitationMm: unknown; rainProbabilityPct: number | null; conditionCode: number | null; forecast: unknown; fetchedAt: Date }, stale: boolean): WeatherPayload {
  const days = Array.isArray(record.forecast) ? record.forecast as ForecastDay[] : [];
  return {
    available: true, location: config.WEATHER_LOCATION_NAME, source: record.source,
    current: { temperatureC: numberOrNull(record.temperatureC), humidityPct: record.relativeHumidityPct, precipitationMm: numberOrNull(record.precipitationMm), rainProbabilityPct: record.rainProbabilityPct, conditionCode: record.conditionCode },
    forecast: days, lastUpdated: record.fetchedAt.toISOString(), stale,
  };
}

export { fetchJson as fetchWeatherJson };
