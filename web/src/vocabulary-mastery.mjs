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

export function orderVocabularyByNextReview(index, dates, direction) {
  const scheduled = [];
  const unscheduled = [];
  for (const [id, eligible] of index) {
    const dueAt = eligible ? dates.get(id) : undefined;
    if (dueAt === undefined) unscheduled.push(id);
    else scheduled.push({ id, dueAt });
  }
  const multiplier = direction === "descending" ? -1 : 1;
  scheduled.sort((a, b) => multiplier * (a.dueAt - b.dueAt));
  return scheduled.map(({ id }) => id).concat(unscheduled);
}
