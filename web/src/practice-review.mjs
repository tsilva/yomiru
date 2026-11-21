import { practiceMembership, toPracticeCard } from "./practice-deck.mjs";
import { nextPracticeReviewAt } from "./vocabulary-practice.mjs";
import { phraseExample, preparedQuizChoices, quizKeys } from "./vocabulary-quiz.mjs";

function meaningKey(meaning) {
  return meaning.normalize("NFKC").toLowerCase().trim().replace(/^to\s+/u, "")
    .replace(/\s+/gu, " ").replace(/[.!?]+$/u, "");
}

export function orderPracticeReview(questions, progress) {
  return questions.map(question => {
    const word = progress.get(question.card.id);
    return { question, dueAt: nextPracticeReviewAt(word) ?? Infinity,
      lastSeenAt: word?.lastSeenAt ?? word?.updatedAt ?? 0 };
  }).sort((a, b) => a.dueAt === b.dueAt ? a.lastSeenAt - b.lastSeenAt : a.dueAt - b.dueAt)
    .map(({ question }) => question);
}

export function createPracticeReview(progress) {
  const pending = new Map([...progress].map(word => [word.id, {
    word, meaning: meaningKey(word.reviewContext?.meaning ?? word.meaningKey ?? ""),
  }]));
  const best = new Map();
  function addSources(sources) {
    for (const { id: titleId, cards, phrases } of sources) {
      const byId = new Map(cards.filter(row => pending.has(row[0])).map(row => [row[0], toPracticeCard(row)]));
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
  }
  return {
    addSources,
    questions: () => [...best.values()].map(({ question }) => question),
  };
}
