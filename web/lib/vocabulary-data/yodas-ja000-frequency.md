# Yomiru spoken Japanese frequency

`yodas-ja000-frequency.tsv` is Yomiru's aggregate word-frequency adaptation
of the Japanese `ja000` subset of [YODAS](https://huggingface.co/datasets/espnet/yodas),
credited to Xinjian Li, Shinnosuke Takamichi, Takaaki Saeki, William Chen, Sayaka
Shiota, and Shinji Watanabe. The source and this derived table are licensed
under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
See [YODAS: YouTube-Oriented Dataset for Audio and Speech](https://arxiv.org/abs/2406.00899).

The input is the complete [Japanese uploader-caption text set](https://huggingface.co/datasets/espnet/yodas/tree/0cad6a0ebec75e945fef92084052be69457fe9d1/data/ja000/text).
Yomiru strips common bracketed sound descriptions and applies the same pinned
UniDic-lite analysis used for episode vocabulary. It counts by vocabulary ID,
excludes proper nouns and keeps entries with at least ten occurrences. Ranks
start at 1 and equal counts share a rank. The TSV contains ranks, vocabulary
IDs and counts. The source videos and their caption practices shape the result.

The table covers 23,414 lexemes, from 10,628,077 counted tokens in 920,699
caption segments across 14,471 videos. The analysis is
`unidic-lite-1.0.8-words-v3`. The caption SHA-256 covers all 112 original text
shards concatenated by shard number.

To rebuild from the pinned public caption files with the locked project runtime:

```sh
uv run --locked python scripts/build_spoken_frequency.py web/lib/vocabulary-data/yodas-ja000-frequency.tsv
```
