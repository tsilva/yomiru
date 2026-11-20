import { readPublishedTrack } from "./published-track.mjs";
import { mapBatches } from "./r2-publication.mjs";
import { reportServerError } from "./sentry-server.mjs";

function assTime(value) {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)\.(\d\d)$/.exec(value?.trim());
  if (!match) return NaN;
  const [, hours, minutes, seconds, centiseconds] = match.map(Number);
  return ((hours * 60 + minutes) * 60 + seconds) * 100 + centiseconds;
}

export function renderedPracticeTranslations(bytes) {
  const events = bytes.toString("utf8").split(/^\[Events\]\s*\r?$/m)[1]?.split(/^\[/m, 1)[0];
  const format = events?.match(/^Format:[ \t]*(.+)$/m)?.[1].split(",").map(field => field.trim().toLowerCase());
  if (format?.at(-1) !== "text") return new Map();
  const [start, end, style] = ["start", "end", "style"].map(name => format.indexOf(name));
  if ([start, end, style].includes(-1)) return new Map();

  const timings = new Map();
  const textIndex = format.length - 1;
  for (const [, row] of events.matchAll(/^Dialogue:[ \t]*(.+)$/gm)) {
    const parts = row.split(",");
    if (parts.length < format.length) continue;
    const begin = assTime(parts[start]), stop = assTime(parts[end]);
    if (!Number.isFinite(begin) || !(begin < stop)) continue;
    const kind = parts[style].trim().toLowerCase();
    if (!["japanese", "english", "translation"].includes(kind)) continue;
    const time = `${begin}:${stop}`;
    if (!timings.has(time)) timings.set(time, { japanese: 0, english: [] });
    const line = timings.get(time);
    if (kind === "japanese") line.japanese++;
    else line.english.push(parts.slice(textIndex).join(",").replace(/\{[^}]*\}|<[^>]*>/gu, "")
      .replace(/\\[Nnh]/gu, " ").replace(/\s+/gu, " ").trim());
  }
  // Require a one-to-one pair. Wrapped or overlapping lines can share a time.
  return new Map([...timings].flatMap(([time, { japanese, english }]) =>
    japanese === 1 && english.length === 1 && english[0] ? [[time, english[0]]] : []));
}

export function createRenderedPracticeReader(readTrack = readPublishedTrack) {
  const cache = new Map();
  async function load(track) {
    const key = track.sha256;
    let entry = cache.get(key);
    cache.delete(key);
    entry ??= readTrack(track).then(renderedPracticeTranslations);
    cache.set(key, entry);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    try {
      return await entry;
    } catch (error) {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    }
  }
  return async (request, result) => {
    if (!result?.valid) return result;
    if (request.order === "phrase") {
      const phrases = await mapBatches(result.phrases, async ({ rendered, ...phrase }) => {
        if (!rendered?.track) return phrase;
        try {
          const translated = await load(rendered.track);
          return { ...phrase, translation: translated.get(rendered.timings.join(":")) ?? null };
        } catch (error) {
          reportServerError(error, "practice-translation-coverage");
          return phrase;
        }
      });
      return { ...result, phrases };
    }
    if (!result.renderedPractice) return result;
    const { track, timings } = result.renderedPractice;
    const translated = await load(track);
    if (request.mode === "practice-translation") {
      return { ...result, translation: translated.get(timings.join(":")) ?? null };
    }
    const lines = Object.fromEntries(Object.entries(timings).flatMap(([cue, [start, end, words]]) =>
      translated.has(`${start}:${end}`) ? [[cue, words]] : []));
    return Object.keys(lines).length ? { ...result, lines } : result;
  };
}

export const addRenderedPractice = createRenderedPracticeReader();
