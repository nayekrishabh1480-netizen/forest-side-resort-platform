import type { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

type ForecastHour = {
  time: string;
  temperatureC: number | null;
  condition: string | null;
  icon: string | null;
  rainProbabilityPct: number | null;
  precipitationMm: number | null;
  windKph: number | null;
  humidityPct: number | null;
};
type ForecastDay = {
  date: string;
  minC: number | null;
  maxC: number | null;
  avgC: number | null;
  rainProbabilityPct: number | null;
  precipitationMm: number | null;
  condition: string | null;
  icon: string | null;
  sunrise: string | null;
  sunset: string | null;
};
type WeatherPayload = {
  available: boolean;
  location: string;
  source: string | null;
  current: null | {
    temperatureC: number | null; feelsLikeC: number | null; condition: string | null; icon: string | null;
    humidityPct: number | null; precipitationMm: number | null; windKph: number | null; windDirection: string | null;
    pressureHpa: number | null; cloudPct: number | null; visibilityKm: number | null; uvIndex: number | null;
    gustKph: number | null; sunrise: string | null; sunset: string | null;
  };
  forecast: ForecastDay[];
  hourly: ForecastHour[];
  lastUpdated: string | null;
  observedAt: string | null;
  stale: boolean;
  providerStatus: 'ready' | 'not_configured' | 'invalid_key' | 'rate_limited' | 'unavailable' | 'error';
};

type OpenWeatherEntry = Record<string, unknown>;
type OpenWeatherResponse = { list?: OpenWeatherEntry[]; city?: Record<string, unknown> } & OpenWeatherEntry;
class WeatherProviderError extends Error {
  constructor(readonly status: WeatherPayload['providerStatus']) { super('WEATHER_PROVIDER_ERROR'); }
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function first(value: unknown): Record<string, unknown> { return Array.isArray(value) ? record(value[0]) : {}; }
function isoFromUnix(value: unknown): string | null {
  const seconds = numberOrNull(value);
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}
function localDate(unixSeconds: number, timezoneOffset: number): string {
  return new Date((unixSeconds + timezoneOffset) * 1000).toISOString().slice(0, 10);
}
function condition(entry: OpenWeatherEntry): { text: string | null; icon: string | null; code: number | null } {
  const weather = first(entry.weather);
  return {
    text: typeof weather.description === 'string' ? weather.description : null,
    icon: typeof weather.icon === 'string' ? `https://openweathermap.org/img/wn/${weather.icon}@2x.png` : null,
    code: numberOrNull(weather.id),
  };
}
function convertHour(entry: OpenWeatherEntry): ForecastHour {
  const main = record(entry.main); const wind = record(entry.wind); const rain = record(entry.rain);
  const sky = condition(entry);
  return {
    time: isoFromUnix(entry.dt) ?? '', temperatureC: numberOrNull(main.temp), condition: sky.text, icon: sky.icon,
    rainProbabilityPct: numberOrNull(entry.pop) === null ? null : Math.round((numberOrNull(entry.pop) as number) * 100),
    precipitationMm: numberOrNull(rain['3h']), windKph: numberOrNull(wind.speed) === null ? null : Math.round((numberOrNull(wind.speed) as number) * 3.6),
    humidityPct: numberOrNull(main.humidity),
  };
}
function statusForHttp(status: number): WeatherPayload['providerStatus'] {
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

async function fetchJson(url: string, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try { response = await fetcher(url, { signal: AbortSignal.timeout(8_000), headers: { accept: 'application/json' } }); }
    catch {
      if (attempt === 0) continue;
      throw new WeatherProviderError('unavailable');
    }
    if (!response.ok) {
      const status = statusForHttp(response.status);
      if (attempt === 0 && response.status >= 500) continue;
      throw new WeatherProviderError(status);
    }
    try { return await response.json() as Record<string, unknown>; }
    catch { throw new WeatherProviderError('unavailable'); }
  }
  throw new WeatherProviderError('unavailable');
}

export function createWeatherService(prisma: PrismaClient, fetcher: typeof fetch = fetch, settings = {
  apiKey: config.WEATHER_API_KEY, locationName: config.WEATHER_LOCATION_NAME,
  latitude: config.WEATHER_LATITUDE, longitude: config.WEATHER_LONGITUDE,
  cacheTtlSeconds: config.WEATHER_CACHE_TTL_SECONDS,
}) {
  async function providerData() {
    if (!settings.apiKey) throw new WeatherProviderError('not_configured');
    let latitude = settings.latitude;
    let longitude = settings.longitude;
    if (latitude === undefined || longitude === undefined) {
      const geocodeUrl = new URL('https://api.openweathermap.org/geo/1.0/direct');
      geocodeUrl.search = new URLSearchParams({ q: `${settings.locationName},IN`, limit: '1', appid: settings.apiKey }).toString();
      const results = await fetchJson(geocodeUrl.toString(), fetcher) as unknown as Array<Record<string, unknown>>;
      const point = Array.isArray(results) ? results[0] : undefined;
      latitude = numberOrNull(point?.lat) ?? undefined;
      longitude = numberOrNull(point?.lon) ?? undefined;
      if (latitude === undefined || longitude === undefined) throw new WeatherProviderError('unavailable');
    }

    const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude), units: 'metric', appid: settings.apiKey });
    const [currentResponse, forecastResponse] = await Promise.all([
      fetchJson(`https://api.openweathermap.org/data/2.5/weather?${params}`, fetcher),
      fetchJson(`https://api.openweathermap.org/data/2.5/forecast?${params}`, fetcher),
    ]);
    const current = currentResponse as OpenWeatherResponse;
    const city = record(forecastResponse.city);
    const offset = numberOrNull(city.timezone) ?? 19_800;
    const entries = Array.isArray(forecastResponse.list) ? forecastResponse.list.map(record) : [];
    if (!entries.length) throw new WeatherProviderError('unavailable');
    const main = record(current.main); const wind = record(current.wind); const sys = record(current.sys); const rain = record(current.rain);
    const sky = condition(current);
    const currentUnix = numberOrNull(current.dt) ?? Math.floor(Date.now() / 1000);
    const currentDate = localDate(currentUnix, offset);
    const hours = entries.map(convertHour);
    const grouped = new Map<string, OpenWeatherEntry[]>();
    for (const entry of entries) {
      const dt = numberOrNull(entry.dt);
      if (dt === null) continue;
      const day = localDate(dt, offset);
      if (day < currentDate) continue;
      const group = grouped.get(day) ?? [];
      group.push(entry); grouped.set(day, group);
    }
    const days = [...grouped.entries()].slice(0, 3).map(([date, samples]): ForecastDay => {
      const temperatures = samples.map((sample) => numberOrNull(record(sample.main).temp)).filter((value): value is number => value !== null);
      const probabilities = samples.map((sample) => numberOrNull(sample.pop)).filter((value): value is number => value !== null);
      const precipitation = samples.reduce((sum, sample) => sum + (numberOrNull(record(sample.rain)['3h']) ?? 0), 0);
      const representative = samples[Math.floor(samples.length / 2)] ?? samples[0] ?? {};
      const representativeCondition = condition(representative);
      const isCurrentDay = date === currentDate;
      return {
        date, minC: temperatures.length ? Math.min(...temperatures) : null, maxC: temperatures.length ? Math.max(...temperatures) : null,
        avgC: temperatures.length ? temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length : null,
        rainProbabilityPct: probabilities.length ? Math.round(Math.max(...probabilities) * 100) : null,
        precipitationMm: precipitation, condition: representativeCondition.text, icon: representativeCondition.icon,
        sunrise: isCurrentDay ? isoFromUnix(sys.sunrise) : null, sunset: isCurrentDay ? isoFromUnix(sys.sunset) : null,
      };
    });
    const currentData = {
      temperatureC: numberOrNull(main.temp), feelsLikeC: numberOrNull(main.feels_like), condition: sky.text, icon: sky.icon,
      humidityPct: numberOrNull(main.humidity), precipitationMm: numberOrNull(rain['1h']) ?? numberOrNull(rain['3h']),
      windKph: numberOrNull(wind.speed) === null ? null : Math.round((numberOrNull(wind.speed) as number) * 3.6),
      windDirection: typeof wind.deg === 'number' ? `${wind.deg}°` : null, pressureHpa: numberOrNull(main.pressure),
      cloudPct: numberOrNull(record(current.clouds).all), visibilityKm: numberOrNull(current.visibility) === null ? null : (numberOrNull(current.visibility) as number) / 1000,
      uvIndex: null, gustKph: numberOrNull(wind.gust) === null ? null : Math.round((numberOrNull(wind.gust) as number) * 3.6),
      sunrise: isoFromUnix(sys.sunrise), sunset: isoFromUnix(sys.sunset),
    };
    return {
      location: typeof city.name === 'string' ? city.name : config.WEATHER_LOCATION_NAME,
      current: currentData, forecast: days, hourly: hours,
      observedAt: isoFromUnix(current.dt),
    };
  }

  async function get(): Promise<WeatherPayload> {
    const latest = await prisma.weatherRecord.findFirst({ where: { locationName: settings.locationName }, orderBy: { fetchedAt: 'desc' } });
    if (latest?.source === 'OpenWeatherMap' && latest.expiresAt.getTime() > Date.now()) return serialize(latest, false);
    try {
      const data = await providerData();
      const fetchedAt = new Date();
      const saved = await prisma.weatherRecord.create({ data: {
        locationName: settings.locationName, source: 'OpenWeatherMap',
        temperatureC: data.current.temperatureC, relativeHumidityPct: data.current.humidityPct,
        precipitationMm: data.current.precipitationMm, rainProbabilityPct: data.forecast[0]?.rainProbabilityPct ?? null,
        conditionCode: null, forecast: { current: data.current, days: data.forecast, hourly: data.hourly, observedAt: data.observedAt } as never,
        fetchedAt, expiresAt: new Date(fetchedAt.getTime() + settings.cacheTtlSeconds * 1000),
      } });
      return { available: true, location: data.location, source: saved.source, current: data.current, forecast: data.forecast, hourly: data.hourly, lastUpdated: fetchedAt.toISOString(), observedAt: data.observedAt, stale: false, providerStatus: 'ready' };
    } catch (error) {
      const providerStatus = error instanceof WeatherProviderError ? error.status : 'error';
      return latest?.source === 'OpenWeatherMap' ? serialize(latest, true, providerStatus) : unavailable(providerStatus);
    }
  }

  return { get };
}

function unavailable(providerStatus: WeatherPayload['providerStatus']): WeatherPayload {
  return { available: false, location: config.WEATHER_LOCATION_NAME, source: null, current: null, forecast: [], hourly: [], lastUpdated: null, observedAt: null, stale: false, providerStatus };
}

function serialize(record: { source: string; temperatureC: unknown; relativeHumidityPct: number | null; precipitationMm: unknown; rainProbabilityPct: number | null; conditionCode: number | null; forecast: unknown; fetchedAt: Date }, stale: boolean, providerStatus: WeatherPayload['providerStatus'] = 'ready'): WeatherPayload {
  const saved = record.forecast && typeof record.forecast === 'object' && !Array.isArray(record.forecast) ? record.forecast as Record<string, unknown> : {};
  const current = saved.current && typeof saved.current === 'object' ? saved.current as WeatherPayload['current'] : null;
  const days = Array.isArray(saved.days) ? saved.days as ForecastDay[] : Array.isArray(record.forecast) ? record.forecast as ForecastDay[] : [];
  const hourly = Array.isArray(saved.hourly) ? saved.hourly as ForecastHour[] : [];
  return {
    available: true, location: config.WEATHER_LOCATION_NAME, source: record.source,
    current: current ?? { temperatureC: numberOrNull(record.temperatureC), feelsLikeC: null, condition: null, icon: null, humidityPct: record.relativeHumidityPct, precipitationMm: numberOrNull(record.precipitationMm), windKph: null, windDirection: null, pressureHpa: null, cloudPct: null, visibilityKm: null, uvIndex: null, gustKph: null, sunrise: null, sunset: null },
    forecast: days, hourly, lastUpdated: record.fetchedAt.toISOString(), observedAt: typeof saved.observedAt === 'string' ? saved.observedAt : null, stale, providerStatus,
  };
}

export { fetchJson as fetchWeatherJson };
