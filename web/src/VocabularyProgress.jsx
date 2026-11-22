const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 });

export function VocabularyProgress({ progress: { introduced, mastered, total }, className = "", labelId, hideLabel = false }) {
  const introducedFraction = total ? introduced / total : 0;
  const masteredFraction = total ? mastered / total : 0;
  const learningFraction = total ? (introduced - mastered) / total : 0;
  return <span className={`vocabulary-progress ${className}`}>
    <span className="vocabulary-progress__track" aria-hidden="true">
      <span className="vocabulary-progress__mastered" style={{ width: `${masteredFraction * 100}%` }} />
      <span className="vocabulary-progress__introduced" style={{ width: `${learningFraction * 100}%` }} />
    </span>
    <span id={labelId} className={hideLabel ? "sr-only" : "vocabulary-progress__label"}>
      <span>{percent.format(introducedFraction)} introduced</span>
      <span aria-hidden="true"> · </span>
      <span>{percent.format(masteredFraction)} mastered</span>
    </span>
  </span>;
}
