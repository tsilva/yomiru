// Original scene dialogue, separate from published episode subtitles or audio sync.
// Keep source spelling, pronunciation and meaning distinct.
export const heroCaptions = [
  {
    start: 0, end: 3800,
    japanese: "ここは落ち着くね。",
    reading: "Koko wa ochitsuku ne.",
    meaning: "It’s peaceful here, isn’t it?",
  },
  {
    start: 3900, end: 7300,
    japanese: "海がきれいだね。",
    reading: "Umi ga kirei da ne.",
    meaning: "The sea is beautiful, isn’t it?",
  },
  {
    start: 7400, end: 11200,
    japanese: "風が気持ちいいね。",
    reading: "Kaze ga kimochi ii ne.",
    meaning: "The breeze feels nice, doesn’t it?",
  },
  {
    start: 11300, end: 14700,
    japanese: "今日はいい一日だった。",
    reading: "Kyō wa ii ichinichi datta.",
    meaning: "Today was a good day.",
  },
  {
    start: 14800, end: 18800,
    japanese: "もう少し、ここにいよう。",
    reading: "Mō sukoshi, koko ni iyō.",
    meaning: "Let’s stay here a little longer.",
  },
  {
    start: 18900, end: 22500,
    japanese: "次の電車を待とう。",
    reading: "Tsugi no densha o matō.",
    meaning: "Let’s wait for the next train.",
  },
];

export const heroLoopDuration = 22600;

// One clock for both lines; boundaries are end-exclusive, including silent gaps.
export function heroFrameAt(elapsed) {
  const position = Math.max(0, elapsed) % heroLoopDuration;
  for (const caption of heroCaptions) {
    if (position < caption.start) return { caption: null, nextChange: caption.start - position };
    if (position < caption.end) return { caption, nextChange: caption.end - position };
  }
  return { caption: null, nextChange: heroLoopDuration - position };
}
