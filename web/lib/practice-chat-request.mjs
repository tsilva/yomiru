export const maxChatRequestBytes = 24 * 1024;

export function practiceChatRequest(context, messages, completedAnswers = []) {
  const body = { context, messages };
  if (!completedAnswers.length) return JSON.stringify(body);

  body.completedAnswers = [];
  const encoder = new TextEncoder();
  let bytes = encoder.encode(JSON.stringify(body)).length;
  const retained = [];
  for (let index = completedAnswers.length - 1; index >= 0; index--) {
    const answer = completedAnswers[index];
    bytes += encoder.encode(JSON.stringify(answer)).length + Number(retained.length > 0);
    if (bytes > maxChatRequestBytes) break;
    retained.push(answer);
  }
  if (retained.length) body.completedAnswers = retained.reverse();
  else delete body.completedAnswers;
  return JSON.stringify(body);
}
