import { Inflectors } from "en-inflectors";

export function conjugationMeaning(meaning, formId) {
  // Use the first alternative and keep parenthesized details with its verb phrase.
  const gloss = meaning?.trim().match(/^(?:\([^()]*\)|[^();/,])*/u)[0].trim();
  const match = gloss?.match(/^to\s+([a-z]+(?:-[a-z]+)*)(?=$|[\s(])(.*)$/iu);
  if (!match) return null;
  const [, verb, rest] = match;
  const base = verb.toLowerCase();
  const kind = formId.replace(/^(plain|polite)-/u, "");
  const present = base === "be" ? "am" : base;
  const inflection = new Inflectors(base.endsWith("ic") ? `${base}k` : base);
  switch (kind) {
    case "nonpast": return `${present}${rest}`;
    case "past": return `${base === "be" ? "was" : inflection.toPast()}${rest}`;
    case "negative": return `${base === "be" ? "am not" : `do not ${base}`}${rest}`;
    case "past-negative": return `${base === "be" ? "was not" : `did not ${base}`}${rest}`;
    case "ongoing": return `am ${inflection.toGerund()}${rest}`;
    case "potential": return `can ${base}${rest}`;
    case "volitional": return `let’s ${base}${rest}`;
    case "desire": return `want to ${base}${rest}`;
    case "conditional": return `if I ${present}${rest}`;
    case "te": return `${base}${rest} and …`;
    default: return null;
  }
}
