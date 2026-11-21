import { toHiragana, toRomaji } from "wanakana";

const godan = {
  "う": ["わ", "い", "え", "お", "って"],
  "く": ["か", "き", "け", "こ", "いて"],
  "ぐ": ["が", "ぎ", "げ", "ご", "いで"],
  "す": ["さ", "し", "せ", "そ", "して"],
  "つ": ["た", "ち", "て", "と", "って"],
  "ぬ": ["な", "に", "ね", "の", "んで"],
  "ぶ": ["ば", "び", "べ", "ぼ", "んで"],
  "む": ["ま", "み", "め", "も", "んで"],
  "る": ["ら", "り", "れ", "ろ", "って"],
};
const endings = {
  v5u: "う", "v5u-s": "う", v5k: "く", "v5k-s": "く", v5g: "ぐ", v5s: "す", v5t: "つ",
  v5n: "ぬ", v5b: "ぶ", v5m: "む", v5r: "る", "v5r-i": "る", v5aru: "る",
  v1: "る", "v1-s": "る", vk: "る", "vs-i": "る", "vs-s": "る", vs: "る",
};

function stems(lemma, type, reading = false) {
  const ending = endings[type];
  if (!ending || !lemma.endsWith(ending)) return null;
  const base = lemma.slice(0, -1);
  if (type === "v1" || type === "v1-s") {
    return [base + "ない", base, base + "て", base + "られる", base + "よう", base + "れば", base + "られ"];
  }
  if (type === "vk") {
    const prefix = lemma.endsWith("くる") ? lemma.slice(0, -2) : null;
    if (prefix === null && (reading || !/[来來]る$/u.test(lemma))) return null;
    const [ki, ko, ku] = prefix === null ? [base, base, base] : ["き", "こ", "く"].map(kana => prefix + kana);
    return [ko + "ない", ki, ki + "て", ko + "られる", ko + "よう", ku + "れば", ko + "られ"];
  }
  if (type.startsWith("vs")) {
    // A bare verbal noun tagged vs is a noun in the dictionary. An explicit する spelling is a verb.
    const prefix = lemma.endsWith("する") ? lemma.slice(0, -2) : /^[為爲]る$/u.test(lemma) ? "" : null;
    if (prefix === null) return null;
    // Special する verbs vary by lemma in the negative and potential.
    const regular = type !== "vs-s";
    return [regular ? prefix + "しない" : null, prefix + "し", prefix + "して",
      regular ? prefix + "できる" : null, prefix + "しよう", prefix + "すれば", regular ? prefix + "でき" : null];
  }
  const [a, i, e, o, te] = godan[ending];
  const negative = type === "v5r-i"
    ? (lemma.endsWith("ある") ? lemma.slice(0, -2) : base.slice(0, -1)) + "ない"
    : base + a + "ない";
  const teEnding = { "v5k-s": "って", "v5u-s": "うて" }[type] ?? te;
  return [negative, base + (type === "v5aru" ? "い" : i), base + teEnding,
    type === "v5r-i" || type === "v5aru" ? null : base + e + "る", base + o + "う", base + e + "ば",
    type === "v5r-i" || type === "v5aru" ? null : base + e];
}

function verbClassGroup(type) {
  if (!Object.hasOwn(endings, type)) return null;
  return type.startsWith("v5") ? "godan" : type.startsWith("v1") ? "ichidan" : "irregular";
}

export function conjugationVerbGroup(kana, forms) {
  const polite = forms.find(form => form.id === "polite-nonpast")?.kana;
  if (!polite) return null;
  // Older dictionary imports saved the prepared forms without the class tags.
  const reading = toHiragana(kana, { passRomaji: true });
  const groups = new Set();
  for (const type of Object.keys(endings)) {
    const stem = stems(reading, type, true)?.[1];
    if (stem != null && stem + "ます" === polite) {
      groups.add(verbClassGroup(type));
    }
  }
  return groups.size === 1 ? groups.values().next().value : null;
}

export function dictionaryVerbGroup(reading, sources) {
  const groups = new Set(sources.flatMap(([classes, polite]) => classes?.length
    ? classes.map(verbClassGroup)
    : [conjugationVerbGroup(reading, [{ id: "polite-nonpast", kana: polite }])]));
  return groups.size === 1 ? groups.values().next().value : null;
}

function surfaces(lemma, type, reading) {
  const parts = stems(lemma, type, reading);
  if (!parts) return null;
  const [negative, polite, te, potential, volitional, conditional, potentialStem] = parts;
  const past = te.endsWith("て") ? te.slice(0, -1) + "た" : te.slice(0, -1) + "だ";
  return {
    "plain-negative": negative,
    "polite-nonpast": polite + "ます",
    "plain-past": past,
    "polite-past": polite + "ました",
    "plain-past-negative": negative && negative.slice(0, -1) + "かった",
    "polite-negative": polite + "ません",
    "polite-past-negative": polite + "ません でした",
    te,
    "plain-ongoing": te + " いる",
    "polite-ongoing": te + " います",
    "plain-potential": potential,
    "polite-potential": potentialStem && potentialStem + "ます",
    "plain-volitional": volitional,
    "polite-volitional": polite + "ましょう",
    conditional,
    "plain-desire": polite + "たい",
    "polite-desire": polite + "たい です",
  };
}

const labels = {
  "plain-negative": "Plain negative",
  "polite-nonpast": "Polite non-past",
  "plain-past": "Plain past",
  "polite-past": "Polite past",
  "plain-past-negative": "Plain past negative",
  "polite-negative": "Polite negative",
  "polite-past-negative": "Polite past negative",
  te: "Te-form",
  "plain-ongoing": "Plain ongoing",
  "polite-ongoing": "Polite ongoing",
  "plain-potential": "Plain potential",
  "polite-potential": "Polite potential",
  "plain-volitional": "Plain volitional",
  "polite-volitional": "Polite volitional",
  conditional: "Conditional (〜ば)",
  "plain-desire": "Plain desire (want to)",
  "polite-desire": "Polite desire (want to)",
};

function choicesFor(answer, forms) {
  const [register, ...rest] = answer.id.split("-");
  const kind = rest.join("-");
  const close = forms.filter(form => form.id !== answer.id).sort((a, b) => relevance(b) - relevance(a));
  function relevance(form) {
    const [otherRegister, ...other] = form.id.split("-");
    const otherKind = other.join("-");
    return 4 * Number(Boolean(kind) && kind === otherKind)
      + 2 * Number(Boolean(kind) && Boolean(otherKind) && (kind.includes(otherKind) || otherKind.includes(kind)))
      + Number(register === otherRegister);
  }
  const scripts = ["written", "kana", "romaji"];
  const seen = scripts.map(script => new Set([answer[script]]));
  const alternatives = [];
  for (const form of close) {
    if (scripts.some((script, index) => seen[index].has(form[script]))) continue;
    scripts.forEach((script, index) => seen[index].add(form[script]));
    alternatives.push(form.id);
    if (alternatives.length === 3) break;
  }
  return alternatives;
}

export function prepareConjugations(detail) {
  const kana = toHiragana(detail.reading, { passRomaji: true });
  const formsBySpelling = {};
  if (!/^[ぁ-ゖー]+$/u.test(kana)) return formsBySpelling;
  for (const written of detail.aliases) {
    const tags = [...new Set(detail.jmdictSenses.filter(sense => sense.forms.includes(written))
      .flatMap(sense => sense.verbClasses ?? []))];
    const types = tags.filter(type => type !== "vs" || (tags.length === 1 && kana.endsWith("する")));
    // Multiple classes or a classical tag require sense-specific editorial resolution.
    if (types.length !== 1) continue;
    const [type] = types;
    if (type === "v5k-s" && kana.endsWith("ゆく")) continue;
    const inflected = surfaces(written, type);
    const readings = surfaces(kana, type, true);
    if (!inflected || !readings) continue;
    if (["できる", "見える", "聞こえる", "聴こえる"].includes(written)
      || ["できる", "みえる", "きこえる"].includes(kana)) {
      delete inflected["plain-potential"];
      delete inflected["polite-potential"];
    }
    const forms = Object.entries(inflected).flatMap(([id, form]) => form && readings[id] ? [{
      id, label: labels[id], written: form.replaceAll(" ", ""), kana: readings[id].replaceAll(" ", ""),
      romaji: toRomaji(readings[id]),
    }] : []);
    const questions = forms.map(form => ({ ...form, alternatives: choicesFor(form, forms) }))
      .filter(form => form.alternatives.length === 3);
    if (questions.length) formsBySpelling[written] = questions;
  }
  return formsBySpelling;
}
