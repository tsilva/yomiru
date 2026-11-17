# Branding assets

Yomiru's fox holds two subtitle bars: pale yellow (`#FFEAB5`) above pale blue
(`#A8E6FF`). Cream edges and navy outlines preserve contrast on light and dark
backgrounds. The primary logo includes the name; small icons contain no text.

| Use | File |
| --- | --- |
| README logo | `logo.png` at the repository root |
| Square logo | `image-assets/logo/logo-1024.png` |
| Text-free icon | `image-assets/icon/icon-1024.png` |
| Favicons | `image-assets/web-seo/favicon/` (16, 32, 48 px and ICO) |
| Wide preview | `image-assets/web-seo/og-image-1200x630.png` |
| Transparent sources and original generation outputs | `image-assets/sources/` |

The add-on manifest serves the fox at `/assets/icon.png`, packaged in
`src/yomiru/assets/icon.png` from the 256 px export in `image-assets/stremio/`.
The export retains the existing selected artwork and generation provenance.
`image-assets/manifest.json` records the Stremio export
under `integrations`; HTTP tests independently verify the packaged PNG dimensions.
The README continues to use root `logo.png`.

The landing-page header pairs `/assets/fox.png` with live text: “Yomiru” above
smaller hiragana “よみる”. Both lines share a left edge, and the combined text
block is vertically centered beside the fox at every responsive size.

## Sources and exports

Artwork was created with native Codex ImageGen. The exact model and generation
timestamp were not exposed. `image-assets/prompts.json` records the final prompts.
Original generation bytes are retained in `*-source-keyed.png`. Their uniform
green background was removed with the shared image-generation chroma-key helper;
`*-source.png` files contain the resulting transparent artwork.

`image-assets/manifest.json` records export dimensions. The separate
`image-assets/provenance.json` records source and export SHA-256 fingerprints.
Matching fingerprints verify file identity, not a specific generation model.

To regenerate exports, set `BRANDING_SKILL` to the installed
`private-skills_create-image-assets` skill directory and run from the repository
root using an existing Python runtime with Pillow:

```sh
python3 "$BRANDING_SKILL/scripts/derive_assets.py" \
  --logo-source image-assets/sources/logo-source.png \
  --icon-source image-assets/sources/icon-source.png \
  --social-source image-assets/sources/social-source.png \
  --out-dir image-assets --root-dir . --project-name Yomiru \
  --targets web-seo --sync-root-logo
```

For the README, crop the transparent logo to its alpha bounds, fit the artwork
within 720 × 720 px without upscaling, and add 24 px of transparent margin on each
side. Update the `root-logo` dimensions in the manifest and export fingerprints
after placement. Inspect the logo and icon on white, off-white, dark and
checkerboard backgrounds, including 128/256 px logos and native favicon sizes.

```sh
python3 "$BRANDING_SKILL/scripts/verify_assets.py" \
  --out-dir image-assets --root-dir . --project-name Yomiru --targets web-seo
```
