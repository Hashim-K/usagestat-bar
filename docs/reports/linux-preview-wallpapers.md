# Linux preview wallpapers

The preview sessions use the distro wallpaper mapping requested on 9 September 2026. These are artwork choices; the panel/compositor runtimes still come from the Fedora 44 and Arch lab images.

| Desktop | Wallpaper | Default-selection source |
| --- | --- | --- |
| GNOME | Fedora 44 packaged default | `org.gnome.desktop.background picture-uri` in the isolated session |
| KDE Plasma | CachyOS — north.png | [Source](https://github.com/CachyOS/cachyos-kde-settings/blob/717481de49f3ca21f7b885b3cf11bac58bd160b8/etc/skel/.config/plasma-org.kde.plasma.desktop-appletsrc) |
| Cinnamon | Linux Mint 22.3 — default_background.jpg (sele_ring.jpg) | [Source](https://fastly.linuxmint.io/list.php?release=zena) |
| MATE | Ubuntu MATE — Green-Wall-Logo.png | [Source](https://github.com/ubuntu-mate/ubuntu-mate-settings/blob/20334b09c7737241bfca4e0bee219414331398b2/usr/share/glib-2.0/schemas/30_ubuntu-mate.gschema.override) |
| Xfce | Xubuntu 26.04 — xubuntu-resolute-plucky-remix.png | [Source](https://github.com/Xubuntu/xubuntu-artwork/blob/875a9f3d79df3b4f6e5828b90903786710ef95ee/debian/xubuntu-wallpapers.links) |
| LXQt | Lubuntu 26.04 — 2604-raccoon.png | [Source](https://github.com/lubuntu-team/lubuntu-artwork/blob/78db680b1937e74267960c58c355d84fa142d68e/src/usr/share/lubuntu/wallpapers/lubuntu-default-wallpaper.png) |
| Budgie | Ubuntu Budgie — budgie-codename.png | [Source](https://github.com/UbuntuBudgie/budgie-desktop-environment/blob/3faf552c6039f769458c2dd2747b181c7b7207bb/schemas/25_budgie-desktop-environment.gschema.override) |
| COSMIC | Pop!_OS — orion_nebula_nasa_heic0601a.jpg | [Source](https://github.com/pop-os/cosmic-bg/blob/1685f7fc99cbb9cbe981ac672d6451ba6faff7db/data/v1/all) |
| Hyprland | Omarchy 4.0.3 — Tokyo Night / Winding Road | [Source](https://github.com/omacom/omarchy/blob/v4.0.3/install/user/theme.sh) |
| Sway | Fedora Sway Spin — Sway Wallpaper Blue | [Source](https://commons.wikimedia.org/wiki/File:Sway_Wallpaper_Blue_1920x1080.png) |
| i3 | EndeavourOS — endeavouros-wallpaper.png | [Source](https://github.com/endeavouros-team/Branding) |
| bspwm | Archcraft — nord.jpg | [Source](https://github.com/archcraft-os/archcraft-bspwm/blob/e20af9b2b0b89aece7ecdf7a6946ba92ed5bc136/files/themes/default/wallpaper) |

i3 uses EndeavourOS from the requested Arch / EndeavourOS option. Sway uses the exact artwork linked on Wikimedia, downloaded from the original upstream revision named on that page. Omarchy uses the first Tokyo Night background selected by a fresh Omarchy 4.0.3 installation.

The manifest records immutable source revisions, asset hashes, and the exact archive member for Mint. The downloader verifies both the Mint archive and its selected image. COSMIC artwork is fetched through GitHub’s media endpoint so a Git LFS pointer cannot be mistaken for an image. Wallpapers retain their upstream licensing and attribution; they are downloaded into private lab images, not bundled with UsageStat releases.

Run `bash tests/linux/build-lab.sh fedora` after changing this mapping. Each session verifies its installed image and writes `wallpaper.json` beside its screenshots. Only disposable preview settings change; host wallpaper and saved provider choices are preserved.

New UsageStat defaults are **logo → usage bar → percentage**, using the **session / primary** meter. Existing explicit component and meter overrides remain effective.
