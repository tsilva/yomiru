import { vocabularyFromPractice } from "./practice-history.mjs";
import { gradePracticeCard, markPracticeTaught, presentPracticeCard, upgradePracticeProgress } from "./vocabulary-practice.mjs";

let connection;

function database() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("yomiru-vocabulary-practice", 3);
    request.onupgradeneeded = ({ oldVersion }) => {
      if (oldVersion === 0) {
        request.result.createObjectStore("words", { keyPath: "id" });
        request.result.createObjectStore("appearances", { keyPath: "id" });
      }
      if (oldVersion < 3) request.result.createObjectStore("conjugations", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      resolve(db);
    };
  }).catch(error => { connection = undefined; throw error; });
  return connection;
}

async function transaction(stores, mode, run) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.onabort = () => reject(tx.error ?? new Error("Vocabulary progress could not be saved."));
    tx.oncomplete = () => resolve(result);
    run(tx, value => { result = value; });
  });
}

function readProgress(store) {
  return transaction([store], "readonly", (tx, setResult) => {
    const request = tx.objectStore(store).getAll();
    request.onsuccess = () => setResult(new Map(request.result.map(word => [word.id, upgradePracticeProgress(word)])));
  });
}

export const readPracticeProgress = () => readProgress("words");
export const readConjugationProgress = () => readProgress("conjugations");

export function savePracticeAppearances(slots, shownAt, conjugation = false, episodeId) {
  const store = conjugation ? "conjugations" : "words";
  return transaction([store, "appearances"], "readwrite", (tx, setResult) => {
    const words = tx.objectStore(store);
    const appearances = tx.objectStore("appearances");
    const presented = [];
    setResult(presented);
    for (const { id, card, phrase, word: target, titleId } of slots) {
      const wordRequest = words.get(card.id);
      wordRequest.onsuccess = () => {
        const { word, event } = presentPracticeCard(card, wordRequest.result, id, shownAt);
        if (!conjugation) {
          word.vocabulary = vocabularyFromPractice(card);
          if (phrase && !word.reviewContext) {
            word.presentedContext = { titleId: titleId ?? episodeId, cue: phrase.cue,
              meaning: phrase.targets[target]?.[5]?.[0] ?? card.meaning };
          }
        }
        words.put(word);
        appearances.add(conjugation ? { ...event, lexemeId: card.wordId } : event);
        presented.push([card, word]);
      };
    }
  });
}

export function savePracticeTeaching(card) {
  return transaction(["words"], "readwrite", (tx, setResult) => {
    const words = tx.objectStore("words");
    const request = words.get(card.id);
    request.onsuccess = () => {
      const word = markPracticeTaught(card, request.result);
      if (word === request.result) return;
      words.put(word);
      setResult(word);
    };
  });
}

export function saveDictionaryAnswer(card, { shownAt, correct, choices, direction, at }) {
  return transaction(["words", "appearances"], "readwrite", (tx, setResult) => {
    const words = tx.objectStore("words");
    const request = words.get(card.id);
    request.onsuccess = () => {
      const previous = upgradePracticeProgress(request.result);
      if (previous && (previous.lastSeenAt > shownAt || previous.readingKey !== card.readingKey
        || !card.acceptable.has(previous.meaningKey))) return;
      const current = previous ? { ...card, meaningKey: previous.meaningKey } : card;
      const { word, event } = presentPracticeCard(current, previous, crypto.randomUUID(), shownAt);
      const rating = { correct, choices, spaced: true, review: event.due, at };
      const graded = { ...gradePracticeCard(word, event, rating),
        vocabulary: previous?.vocabulary ?? vocabularyFromPractice(current) };
      words.put(graded);
      tx.objectStore("appearances").add({ ...event, mode: "dictionary", direction, outcome: rating });
      setResult({ id: event.id, previous, word: graded });
    };
  });
}

export function savePracticeOutcome(id, outcome, conjugation = false) {
  const store = conjugation ? "conjugations" : "words";
  return transaction([store, "appearances"], "readwrite", (tx, setResult) => {
    const words = tx.objectStore(store);
    const appearances = tx.objectStore("appearances");
    const eventRequest = appearances.get(id);
    eventRequest.onsuccess = () => {
      const event = eventRequest.result;
      if (!event) { tx.abort(); return; }
      const wordRequest = words.get(event.wordId);
      wordRequest.onsuccess = () => {
        const previous = wordRequest.result;
        if (!previous) { tx.abort(); return; }
        if (event.outcome) { setResult({ previous, word: previous }); return; }
        const { context, ...rating } = outcome;
        let word = gradePracticeCard(previous, event, rating);
        if (context && previous.lastAppearanceId === id
          && (!rating.review || word !== previous || (event.previouslyPresented && !previous.halfLife && !previous.reviewContext))) {
          word = { ...word, reviewContext: { ...context, correct: rating.correct } };
        }
        if (conjugation && previous.lastAppearanceId === id) {
          word = { ...word, attemptedAt: Math.max(rating.at, previous.attemptedAt ?? 0), wordId: event.lexemeId };
        }
        appearances.put({ ...event, outcome: rating });
        if (word !== previous) words.put(word);
        setResult({ previous, word });
      };
    };
  });
}
