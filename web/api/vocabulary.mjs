import { readPublishedLibrary } from "../lib/published-library.mjs";
import { servingPublicationStore } from "../lib/database.mjs";
import { dictionaryRevision } from "../lib/library.mjs";
import { databaseEnabled } from "../lib/storage-config.mjs";
import { createBlobVocabularyReader } from "../lib/episode-vocabulary.mjs";
import { reportServerError } from "../lib/sentry-server.mjs";
import { englishDictionaries } from "../src/vocabulary-export.mjs";

const english = values => values.eng === undefined ? {} : { eng: values.eng };

function publicWord(word) {
  const { meanings, sources, meaningStatus, dictionaries, ...detail } = word;
  return { ...detail, meanings: english(meanings),
    ...(sources && { sources: english(sources) }),
    ...(meaningStatus && { meaningStatus: english(meaningStatus) }),
    ...(dictionaries && { dictionaries: englishDictionaries(word) }) };
}

export function createHandler({ readLibrary = readPublishedLibrary, fetcher = fetch,
  store = () => databaseEnabled() ? servingPublicationStore() : null } = {}) {
  const readVocabulary = createBlobVocabularyReader(fetcher);
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      return response.status(405).end();
    }
    const { episode, revision, registry } = request.query;
    if (typeof episode !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(episode)
      || typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)
      || (registry !== undefined && (typeof registry !== "string" || !/^[a-f0-9]{64}$/.test(registry)))) {
      return response.status(400).json({ error: "Choose an episode and vocabulary revision." });
    }
    try {
      const { index, publication } = await readLibrary();
      const entry = index.vocabulary?.find(v => v.videoIds.includes(episode));
      if (!entry) return response.status(404).json({ error: "Vocabulary is not available for this episode yet." });
      if (entry.sha256 !== revision || dictionaryRevision(index) !== registry) {
        return response.status(409).json({ error: "The library changed. Clear the selection and select the episodes again." });
      }
      const db = await store();
      const document = db ? (await db.documents(publication, [episode])).get(episode) : await readVocabulary(index, entry);
      if (document?.anchor !== entry.anchor || document.words.length !== entry.words || document.registry !== registry) {
        throw new Error("Vocabulary rows do not match the publication");
      }
      response.setHeader("Cache-Control", "public, max-age=30");
      response.setHeader("X-Yomiru-Publication", publication);
      if (request.method === "HEAD") return response.status(200).end();
      return response.status(200).json({ ...document, words: document.words.map(publicWord) });
    } catch (error) {
      reportServerError(error, "vocabulary");
      return response.status(503).json({ error: "Vocabulary is temporarily unavailable. Try again." });
    }
  };
}

export default createHandler();
