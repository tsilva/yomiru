# Public landing page

The landing page at `https://yomiru.tsilva.eu` introduces Yomiru with one subtitle
preview and one installation action. Artwork fills the viewport behind the logo
and copy, with a subtle dark overlay to emphasize the headline and install
action; portrait screens use a dedicated composition to retain the subtitle
example. The button opens hosted add-on installation instructions. The same
domain serves the manifest and exact-episode subtitle API. Immutable ASS assets
are delivered from the administrator-managed Vercel Blob bucket; old website
asset URLs redirect there. Viewers need no local process. Public
requests never trigger generation. See [publishing](publishing.md).

The raised violet install button has a centered label and depresses while
pressed. Its hit area stays stationary, keyboard focus remains visible, and
reduced-motion settings remove the transition while retaining the pressed state.

## Development

The frontend lives in `web/` and uses the committed pnpm lockfile. Use Node.js
22 or newer and the package manager version declared in `web/package.json`.

```sh
cd web
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev -- --port auto
```

The server prints its selected URL and refuses an occupied explicit port.
Terminate it when finished. To create the static build:

```sh
pnpm build
pnpm test:sites
```

`web/dist/client/` contains the public files. Keep generated builds and
`node_modules` out of Git. The bundled hosting worker is retained for optional
Sites compatibility.

## Vercel

The `yomiru` project uses `web/` as the application directory when deploying
from this checkout. Its settings are in `web/vercel.json`. The build requires
no application secrets and includes no generated subtitles. The add-on reads the
current library from Vercel Blob at runtime. Adding episodes uses the separate
[administrator upload command](publishing.md), without a website deployment.
The protected Production upload endpoint uses the store's OIDC connection.
Domain assignment and authoritative DNS are separate
from deployment; preserve unrelated DNS records.

Direct CLI deployment does not establish automatic delivery from Git. For Git
delivery, configure a remote, set up the maintained production-delivery workflow,
and verify its CI and exact-commit production gates.

## Artwork

The fox is the existing Yomiru brand asset. The original generated
station-courtyard scene
includes the synthetic example “Koko wa ochitsuku ne.” / “It’s peaceful here, isn’t it?”
in both compositions, with editable page copy
and controls rendered separately. Desktop uses the wide scene, cropped toward
the right; narrow screens use the portrait scene with a centered crop so both
subtitle lines remain legible. The reader sits on a bench under the station
awning, with broad paving and a railing separating the courtyard from the sea.
