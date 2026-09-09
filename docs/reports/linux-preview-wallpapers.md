# Linux preview wallpapers

The preview sessions match the artwork selected by `app/data/desktops.ts` in [usagestat-web at ca2ee11](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/app/data/desktops.ts), checked on 9 September 2026. This supersedes the earlier distro-default mapping: GNOME uses dark Blobs, Plasma uses Waterfall, Hyprland uses Omarchy's sunset deer, and i3 uses i3wm-themer's `000.png`. The other eight selections retain the same original artwork.

| Desktop | Wallpaper | Website selection |
| --- | --- | --- |
| GNOME | GNOME Blobs — dark | [Website asset](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/public/desktops/fedora-blobs-dark.webp) |
| KDE Plasma | KDE Plasma 6.7 — Waterfall | [Website asset](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/public/desktops/plasma-waterfall.webp) |
| Cinnamon | Linux Mint 22.3 — default_background.jpg (sele_ring.jpg) | [Website asset](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/public/desktops/linux-mint.webp) |
| MATE | Ubuntu MATE — Green-Wall-Logo.png | [Website asset](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/public/desktops/ubuntu-mate.webp) |
| Xfce | Xubuntu 26.04 — xubuntu-resolute-plucky-remix.png | [Website asset](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/public/desktops/xubuntu.webp) |
| LXQt | Lubuntu 26.04 — 2604-raccoon.png | [Website asset](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/public/desktops/lubuntu.webp) |
| Budgie | Ubuntu Budgie — budgie-codename.png | [Website asset](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/public/desktops/ubuntu-budgie-hd.webp) |
| COSMIC | Pop!_OS — orion_nebula_nasa_heic0601a.jpg | [Website asset](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/public/desktops/pop-os.webp) |
| Hyprland | Omarchy / Tokyo Night / Sunset Lake deer | [Website asset](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/public/desktops/omarchy-sunset-deer.webp) |
| Sway | Fedora Sway Spin — Sway Wallpaper Blue | [Website asset](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/public/desktops/sway-blue.webp) |
| i3 | i3wm-themer — 000.png | [Website asset](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/public/desktops/i3-000.webp) |
| bspwm | Archcraft — nord.jpg | [Website asset](https://github.com/hashimkarim/usagestat-web/blob/ca2ee110e61b1c97969c4176a5786e2035bc2f5b/public/desktops/archcraft-hd.webp) |

These are artwork choices; the panel/compositor runtimes still come from the Fedora 44 and Arch lab images, with native host GNOME in an isolated session. Selecting a distro's wallpaper does not make its preview a full installation of that distro.

`tests/linux/backgrounds.json` records the website revision and selected file, upstream source URL, original image SHA-256, and the exact archive member for Mint. The lab uses the full-resolution originals behind the website's WebP exports. Every original checksum matches `public/desktops/sources.json` at the pinned website revision. Sway retains the exact artwork requested from Wikimedia. Omarchy's artwork credit remains Louis Coyle; the repository's MIT license does not replace that attribution.

The downloader verifies both the Mint archive and its selected image. COSMIC artwork is fetched through GitHub's media endpoint so a Git LFS pointer cannot be mistaken for an image. Wallpapers retain their upstream licensing and attribution; they are downloaded into private lab images, not bundled with UsageStat releases.

For existing lab images, refresh just their artwork without reinstalling packages or recompiling the tested compositors:

```bash
bash tests/linux/build-lab.sh backgrounds
```

New installations still use `bash tests/linux/build-lab.sh fedora` and `bash tests/linux/build-lab.sh hyprland`. Set `USAGESTAT_PODMAN_ROOT` when using an alternate Podman store. GNOME's session wrapper downloads its selected image into the user's cache before entering the disposable session; subsequent runs verify and reuse that file offline. `USAGESTAT_LAB_BACKGROUND_ROOT` can override this cache location.

Each session checks the selected original and writes `wallpaper.json` beside its screenshots, including the website provenance and displayed file path. WebP, SVG and JXL sources are decoded once to lossless PNG for loaders that need it. Only disposable preview settings change; host wallpaper and saved provider choices are preserved.

The [fresh behaviour recordings](linux-behaviour-web-wallpapers-2026-09-09.md) use this mapping. New UsageStat defaults remain **logo → usage bar → percentage**, using the **session / primary** meter. Existing explicit component and meter overrides remain effective.
