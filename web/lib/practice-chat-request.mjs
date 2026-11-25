export const maxChatRequestBytes = 24 * 1024;

function requestQuestion({ readings, id, ...question }) {
  return question;
}

export function practiceChatRequest(context, messages, completedAnswers = []) {
  const payload = context.question ? { ...context, question: requestQuestion(context.question) } : context;
  const body = { context: payload, messages };
  const encoder = new TextEncoder();
  while (body.messages.length > 1 && encoder.encode(JSON.stringify(body)).length > maxChatRequestBytes) {
    body.messages = body.messages.slice(2);
  }
  if (!completedAnswers.length) return JSON.stringify(body);

  body.completedAnswers = [];
  let bytes = encoder.encode(JSON.stringify(body)).length;
  const retained = [];
  for (let index = completedAnswers.length - 1; index >= 0; index--) {
    const answer = requestQuestion(completedAnswers[index]);
    bytes += encoder.encode(JSON.stringify(answer)).length + Number(retained.length > 0);
    if (bytes > maxChatRequestBytes) break;
    retained.push(answer);
  }
  if (retained.length) body.completedAnswers = retained.reverse();
  else delete body.completedAnswers;
  return JSON.stringify(body);
}
