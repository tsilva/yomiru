import { feedbackLinks, codePattern } from "../lib/feedback-links.mjs";
import { reportServerError } from "../lib/sentry-server.mjs";

export function createHandler({ links = feedbackLinks } = {}) {
  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(request.method)) return response.status(405).end();
    if (!codePattern.test(request.query.code || "")) return response.status(404).end();
    try {
      if (!await links.get(request.query.code)) return response.status(404).end();
      response.setHeader("Location", `/compatibility?feedback=${request.query.code}`);
      return response.status(302).end();
    } catch (error) {
      reportServerError(error, "feedback");
      return response.status(503).end("Feedback temporarily unavailable");
    }
  };
}
export default createHandler();
