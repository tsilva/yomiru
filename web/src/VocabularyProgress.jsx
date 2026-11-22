const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 });
const wordCount = new Intl.NumberFormat();

export function VocabularyProgress({
  progress: { introduced, mastered, total }, className = "", labelId, hideLabel = false, showCounts = false,
}) {
  const introducedFraction = total ? introduced / total : 0;
  const masteredFraction = total ? mastered / total : 0;
  const learningFraction = total ? (introduced - mastered) / total : 0;
  const introducedPercent = percent.format(introducedFraction);
  const masteredPercent = percent.format(masteredFraction);
  return <span className={`vocabulary-progress ${className}`}>
    <span className="vocabulary-progress__track" aria-hidden="true">
      <span className="vocabulary-progress__mastered" style={{ width: `${masteredFraction * 100}%` }} />
      <span className="vocabulary-progress__introduced" style={{ width: `${learningFraction * 100}%` }} />
    </span>
    <span id={labelId} className={hideLabel ? "sr-only" : "vocabulary-progress__label"}>
      <span>{showCounts ? `${wordCount.format(introduced)} introduced (${introducedPercent})` : `${introducedPercent} introduced`}</span>
      <span aria-hidden="true"> · </span>
      <span>{showCounts ? `${wordCount.format(mastered)} mastered (${masteredPercent})` : `${masteredPercent} mastered`}</span>
    </span>
  </span>;
}
