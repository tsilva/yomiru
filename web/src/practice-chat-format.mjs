const corners = /[「」『』]/gu;
const emphasis = new RegExp([
  /(?<japaneseQuote>「[^」\r\n]+」|『[^』\r\n]+』)/u,
  /(?<doubleQuote>“[^”\r\n]+”|"[^"\r\n]+")/u,
  /(?<singleQuote>‘[^\r\n]+?’(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])'[^\r\n]+?'(?![\p{L}\p{N}]))/u,
  /(?<japanese>[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3099\u309aーｰ]+)/u,
  corners,
].map(pattern => pattern.source).join("|"), "gu");

export function formatPracticeReply(text) {
  const parts = [];
  let end = 0;
  for (const { 0: match, index, groups } of text.matchAll(emphasis)) {
    if (index > end) parts.push(text.slice(end, index));
    if (groups.japaneseQuote || groups.japanese) {
      parts.push({ text: match.replace(corners, ""), lang: "ja" });
    } else if (groups.doubleQuote || groups.singleQuote) {
      parts.push(match[0], { text: match.slice(1, -1).replace(corners, "") }, match.at(-1));
    }
    end = index + match.length;
  }
  if (end < text.length) parts.push(text.slice(end));
  return parts;
}
