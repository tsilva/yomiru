import { gradePracticeCard, presentPracticeCard } from "./vocabulary-practice.mjs";

let connection;

function database() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("yomiru-vocabulary-practice", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("words", { keyPath: "id" });
      request.result.createObjectStore("appearances", { keyPath: "id" });
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

export function readPracticeProgress() {
  return transaction(["words"], "readonly", (tx, setResult) => {
    const request = tx.objectStore("words").getAll();
    request.onsuccess = () => setResult(new Map(request.result.map(word => [word.id, word])));
  });
}

export function savePracticeAppearances(slots, shownAt) {
  return transaction(["words", "appearances"], "readwrite", tx => {
    const words = tx.objectStore("words");
    const appearances = tx.objectStore("appearances");
    for (const { id, card } of slots) {
      const wordRequest = words.get(card.id);
      wordRequest.onsuccess = () => {
        const { word, event } = presentPracticeCard(card, wordRequest.result, id, shownAt);
        words.put(word);
        appearances.add(event);
      };
    }
  });
}

export function savePracticeOutcome(id, outcome) {
  return transaction(["words", "appearances"], "readwrite", (tx, setResult) => {
    const words = tx.objectStore("words");
    const appearances = tx.objectStore("appearances");
    const eventRequest = appearances.get(id);
    eventRequest.onsuccess = () => {
      const event = eventRequest.result;
      if (!event) { tx.abort(); return; }
      const wordRequest = words.get(event.wordId);
      wordRequest.onsuccess = () => {
        const previous = wordRequest.result;
        if (!previous) { tx.abort(); return; }
        if (event.outcome) { setResult(previous); return; }
        const word = gradePracticeCard(previous, event, outcome);
        appearances.put({ ...event, outcome });
        if (word !== previous) words.put(word);
        setResult(word);
      };
    };
  });
}
