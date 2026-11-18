import { readFile } from "node:fs/promises";

const writtenSource = new URL("./vocabulary-data/ja-frequency-2026.tsv", import.meta.url);
const spokenSource = new URL("./vocabulary-data/yodas-ja000-frequency.tsv", import.meta.url);
let writtenRanks;
let spokenRanks;

async function loadRanks(source) {
  const text = await readFile(source, "utf8");
  const rows = text.trimEnd().split(/\r?\n/u).slice(1);
  return new Map(rows.map(row => {
    const [rank, key] = row.split("\t");
    return [key.normalize("NFC"), Number(rank)];
  }));
}

function writtenRank(word, lookup) {
  if (word.pos === "名詞/固有名詞") return null;
  const headwordRank = lookup.get(word.word.normalize("NFC"));
  // Use a kana spelling only if it is a known written form of this lexeme.
  if (!word.aliases?.includes(word.reading)) return headwordRank ?? null;
  const kanaRank = lookup.get(word.reading.normalize("NFC"));
  const rank = Math.min(headwordRank ?? Infinity, kanaRank ?? Infinity);
  return Number.isFinite(rank) ? rank : null;
}

export async function withCorpusRanks(words, { written, spoken }) {
  if (!written && !spoken) return words;
  const [writtenLookup, spokenLookup] = await Promise.all([
    written ? (writtenRanks ??= loadRanks(writtenSource)) : null,
    spoken ? (spokenRanks ??= loadRanks(spokenSource)) : null,
  ]);
  return words.map(word => ({
    ...word,
    writtenRank: writtenLookup ? writtenRank(word, writtenLookup) : undefined,
    spokenRank: spokenLookup ? spokenLookup.get(word.id) ?? null : undefined,
  }));
}
