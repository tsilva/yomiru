// The index arrives in frequency order, which also breaks ties in both directions.
export function orderVocabularyByMastery(index, scores, direction) {
  const byScore = Array.from({ length: 101 }, () => []);
  const unscored = [];
  for (const [id, eligible] of index) {
    const score = eligible ? scores.get(id) : undefined;
    if (score === undefined) unscored.push(id);
    else byScore[score].push(id);
  }
  if (direction === "descending") byScore.reverse();
  return byScore.flat().concat(unscored);
}
