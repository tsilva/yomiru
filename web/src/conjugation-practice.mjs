import { practiceReviewSize } from "./practice-deck.mjs";
import { nextPracticeReviewAt, practiceDisplayKana, shufflePracticeItems } from "./vocabulary-practice.mjs";

export function conjugationQuestions(verbs) {
  return verbs.flatMap(({ id: wordId, written, kana, romaji, meaning, forms }) => {
    const prompt = { written, kana: practiceDisplayKana(kana, written), romaji, meaning };
    const idFor = formId => `conjugation:${wordId}:${formId}`;
    const choices = new Map(forms.map(form => [form.id,
      { ...form, kana: practiceDisplayKana(form.kana, form.written), id: idFor(form.id) }]));
    return forms.map(form => {
      const readingKey = form.kana;
      const meaningKey = form.id;
      return {
        card: { id: idFor(form.id), wordId, written: form.written, kana: form.kana, romaji: form.romaji,
          readingKey, meaningKey, acceptable: new Set([meaningKey]), meaning: form.label },
        conjugation: { prompt, label: form.label },
        choices: shufflePracticeItems([form.id, ...form.alternatives].map(id => choices.get(id))),
      };
    });
  });
}

export function conjugationDeckWordIds(progress) {
  return [...new Set([...progress.values()].filter(record => record.attemptedAt && record.wordId)
    .map(record => record.wordId))];
}

export function sameConjugation(card, record) {
  return Boolean(record?.attemptedAt && card.readingKey === record.readingKey);
}

export function episodeConjugationRound(questions, progress, now = Date.now()) {
  const due = [], fresh = [], early = [];
  for (const question of questions) {
    const record = progress.get(question.card.id);
    if (!sameConjugation(question.card, record)) {
      fresh.push(question);
      continue;
    }
    const dueAt = nextPracticeReviewAt(record) ?? 0;
    (dueAt <= now ? due : early).push({ question, dueAt, lastSeenAt: record.lastSeenAt });
  }
  const bySchedule = (a, b) => a.dueAt - b.dueAt || a.lastSeenAt - b.lastSeenAt;
  due.sort(bySchedule);
  if (!due.length && !fresh.length) return early.sort(bySchedule).slice(0, practiceReviewSize).map(row => row.question);
  const round = [];
  for (let i = 0; round.length < practiceReviewSize && (i < due.length || i < fresh.length); i++) {
    if (due[i]) round.push(due[i].question);
    if (fresh[i] && round.length < practiceReviewSize) round.push(fresh[i]);
  }
  return round;
}
