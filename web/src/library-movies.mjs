// These editions match the published subtitle cues and the gallery artwork.
export const rebuildMovies = new Map([
  ["tt0923811", ["1.11", "1.0", "You Are (Not) Alone"]],
  ["tt0860906", ["2.22", "2.0", "You Can (Not) Advance"]],
  ["tt0860907", ["3.33", "3.0", "You Can (Not) Redo"]],
  ["tt2458948", ["3.0+1.01", "3.0+1.0", "Thrice Upon a Time"]],
].map(([id, [edition, theatrical, subtitle]]) => [id, {
  title: `Evangelion: ${edition} ${subtitle}`,
  theatricalTitle: `Evangelion: ${theatrical} ${subtitle}`,
}]));
export const movieCollections = new Map([
  ["Rebuild of Evangelion", [...rebuildMovies.keys()]],
  ["One Piece Movies", [
    "tt0814243", "tt0832449", "tt0997084", "tt1006926", "tt1010435",
    "tt1018764", "tt1059950", "tt1037116", "tt1206326", "tt1485763",
    "tt1865467", "tt2375379", "tt5251328", "tt9430698", "tt16183464",
  ]],
]);
export const otherMovies = "Other Movies";
export const movieGroups = new Set([...movieCollections.keys(), otherMovies].map(name => `movie:${name}`));
export const moviePositions = [...movieCollections].flatMap(([name, ids], group) =>
  ids.map((id, index) => ({ id, name, group, number: index + 1, ...rebuildMovies.get(id) })));
