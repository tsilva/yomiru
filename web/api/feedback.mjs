import { feedbackLinks, codePattern } from "../lib/feedback-links.mjs";
import { digestPattern } from "../lib/compatibility.mjs";
import { subtitleRatings, validRating } from "../lib/subtitle-ratings.mjs";
import { reportServerError } from "../lib/sentry-server.mjs";

const readingLabels = { romaji: "Rōmaji", hiragana: "Hiragana", katakana: "Katakana", japanese: "Original Japanese" };
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

function formMetadata({ episode, group, tracks, trackId }) {
  const [legacyShow, ...legacyTitle] = episode.title.split(" · ");
  const [ , season, number ] = episode.id.split(":");
  const readings = new Set(tracks.map(track => track.script));
  const script = trackId ? tracks.find(track => track.id === trackId).script
    : readings.size === 1 ? readings.values().next().value : null;
  const language = group.lang === "por" ? "Português (Portugal)" : languageNames.of(group.lang);
  const episodeTitle = episode.episodeTitle ?? legacyTitle.join(" · ");
  return {
    title: episode.showName || legacyShow,
    detail: [
      episode.type === "series" && season && number ? `Season ${Number(season)}, Episode ${Number(number)}` : "",
      episodeTitle === episode.id ? "" : episodeTitle,
    ].filter(Boolean).join(" · "),
    subtitles: `Yomiru · ${script ? `${readingLabels[script]} + ` : ""}${language}`,
  };
}

function readRating(request) {
  if (Number(request.headers["content-length"] || 0) > 8192) return null;
  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    if (!body || JSON.stringify(body).length > 8192 || typeof body.voter !== "string" || !digestPattern.test(body.voter)) return null;
    const rating = { stars: body.stars, comment: body.comment === undefined ? "" : body.comment };
    if (!validRating(rating)) return null;
    return { voter: body.voter, rating: { ...rating, comment: rating.comment.trim() } };
  } catch {
    return null;
  }
}

export function createHandler({ links = feedbackLinks, ratings = subtitleRatings, originProtocol = "https:" } = {}) {
  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const { code, form } = request.query;
    const isForm = form === "1";
    const posting = isForm && request.method === "POST";
    const allowed = isForm ? ["GET", "POST"] : ["GET", "HEAD"];
    if (!allowed.includes(request.method)) {
      response.setHeader("Allow", allowed.join(", "));
      return response.status(405).end();
    }
    if (typeof code !== "string" || !codePattern.test(code)) {
      return isForm ? response.status(404).json({ error: "Feedback link not found." }) : response.status(404).end();
    }
    if (posting && (request.headers.origin !== `${originProtocol}//${request.headers.host}`
      || !/^application\/json(?:;|$)/i.test(request.headers["content-type"] || ""))) {
      return response.status(403).json({ error: "Use the Yomiru feedback page." });
    }

    const submission = posting ? readRating(request) : null;
    const voter = request.headers["x-yomiru-voter"];
    if ((posting && !submission) || (isForm && voter !== undefined && !digestPattern.test(voter))) {
      return response.status(400).json({ error: "Choose 1–5 stars and keep the comment within 1,000 characters." });
    }
    try {
      const context = await links.get(code);
      if (!context) return isForm ? response.status(404).json({ error: "Feedback link not found." }) : response.status(404).end();
      if (!isForm) {
        response.setHeader("Location", `/compatibility?feedback=${code}`);
        return response.status(302).end();
      }
      if (submission) {
        await ratings.save(code, submission.voter, submission.rating);
        return response.status(204).end();
      }
      return response.status(200).json({
        ...formMetadata(context),
        rating: voter ? await ratings.get(code, voter) : null,
      });
    } catch (error) {
      reportServerError(error, "feedback");
      return isForm ? response.status(503).json({ error: "Feedback is temporarily unavailable. Try again." })
        : response.status(503).end("Feedback temporarily unavailable");
    }
  };
}
export default createHandler();
