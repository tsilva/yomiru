export default function handler(_request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Access-Control-Allow-Origin", "*");
  return response.status(410).end();
}
