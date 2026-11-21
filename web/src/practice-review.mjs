import { practiceMembership, practiceReviewSize, toPracticeCard } from "./practice-deck.mjs";
import { isFirstRecallDue, isPracticeReviewDue, practiceReviewDueAt } from "./vocabulary-practice.mjs";
import { phraseExample, preparedQuizChoices, quizKeys } from "./vocabulary-quiz.mjs";

function meaningKey(meaning) {
  return meaning.normalize("NFKC").toLowerCase().trim().replace(/^to\s+/u, "")
    .replace(/\s+/gu, " ").replace(/[.!?]+$/u, "");
}

export function dueReviewWords(progress, now) {
  return [...progress.values()].filter(word => isPracticeReviewDue(word, now) || isFirstRecallDue(word, now))
    .sort((a, b) => reviewPriority(a) - reviewPriority(b));
}

function reviewPriority(word) {
  return word.halfLife ? practiceReviewDueAt(word) : word.dueAt ?? word.updatedAt;
}

export function buildPracticeReview(sources, due) {
  const pending = new Map(due.map(word => [word.id, {
    word, meaning: meaningKey(word.reviewContext?.meaning ?? word.meaningKey ?? ""),
  }]));
  const best = new Map();
  for (const { id: titleId, cards, phrases } of sources) {
    const byId = new Map(cards.map(row => [row[0], toPracticeCard(row)]));
    for (const phrase of phrases) {
      for (const [word, target] of phrase.targets.entries()) {
        const [id, , , , , prepared] = target;
        const requested = pending.get(id);
        if (!requested?.meaning || prepared?.length !== quizKeys.length || meaningKey(prepared[0]) !== requested.meaning) continue;
        const card = byId.get(id);
        const record = requested.word;
        if (practiceMembership(card, record.readingKey, record.meaningKey) !== "2") continue;
        const context = record.reviewContext;
        const priority = context?.titleId && context.titleId !== titleId ? 2 : Number(context?.cue !== phrase.cue);
        if (best.has(id) && best.get(id).priority >= priority) continue;
        best.set(id, { priority, question: { card, phrase, word, titleId,
          example: phraseExample(phrase, target), choices: preparedQuizChoices(id, prepared) } });
      }
    }
  }
  const questions = due.flatMap(word => best.has(word.id) ? [best.get(word.id).question] : []).slice(0, practiceReviewSize);
  return { questions, missing: due.length - best.size };
}
