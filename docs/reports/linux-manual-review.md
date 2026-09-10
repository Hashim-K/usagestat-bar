# Remaining Linux desktops — prepared for manual review

The [Plasma manual review](plasma-manual-review.md) is the visual baseline.
Its feedback has been carried into the other Linux integrations. All ten
profiles below remain **pending the user's manual review**.

The subsequent [recorded interaction validation on 2026-09-09](linux-interaction-validation-2026-09-09.md)
adds native input checks, videos and screenshots for all Linux profiles. Its
results supersede the earlier statements below about automated checks not yet
being run. It also documents the compositor fixes for Hyprland and COSMIC and
the [requested distro wallpapers](linux-preview-wallpapers.md). These
chronological notes retain the user's manual review status.

## Open the review queue

From the repository, using the same backend as the host GNOME extension:

```bash
python3 tests/linux/manual.py remaining --backend /usr/bin/usagestat-dev
```

Close each viewer to advance. Ctrl+C stops the queue. To open or resume a
single desktop, replace `remaining` with its target name in the table.
Each desktop uses the real host backend through the private bridge; its
settings are disposable. No automated interactions or screenshots run.

| Target | Integration to review | Status |
| --- | --- | --- |
| `cinnamon` | Native applet and shared usage application | Pending |
| `mate` | Native applet and shared usage application | Pending |
| `xfce` | Native panel plugin and shared usage application | Pending |
| `lxqt` | Tray icons and shared usage application | Pending |
| `budgie` | Tray icons and shared usage application | Pending |
| `cosmic` | Status-area icons and shared usage application | Pending |
| `sway` | Native Waybar widget and shared usage application | Pending |
| `hyprland` | Native Waybar widget and shared usage application | Pending |
| `i3` | Polybar module and shared usage application | Pending |
| `bspwm` | Polybar module and shared usage application | Pending |

## Feedback applied

- The application uses the approved provider tiles, one selected provider
  with grouped accounts, compact quota sections and aligned cost rows.
  Money and token counts use the same formatting as the Plasma review.
  Tabs remain visible while details scroll vertically.
  Quotas appear as soon as their request finishes, while optional cost totals
  load separately; previous totals stay visible during refresh.
- Native adapters use the shared rasterized panel images, including logo
  fills. Cinnamon follows panel sizing and scale changes; MATE redraws on
  theme and scale changes. GTK panel buttons have a transparent background
  and inherit the panel's foreground color.
- Cinnamon, MATE, Xfce and native Waybar handle smooth and discrete scrolling.
  Left click now toggles the usage window open/closed. Hyprland positions it
  beside the clicked Waybar panel, using the monitor's available area instead
  of centering it. The text fallbacks use the same toggle command.
  Polybar and the Waybar text fallback receive live updates instead of waiting
  for a two-second poll. Text percentages include `%`; text meters distinguish
  the empty track from the usage fill.
- All tray integrations share the approved logo/meter design, fixed provider
  count with scrolling, custom provider selection, vertical/horizontal/pie
  logo fill, adjustable horizontal/vertical bars and contrasting empty tracks.
  Tray desktops open preferences on the Tray page and hide unrelated native
  panel controls. Tray property notifications only fire when those values change.
- Desktop placement and appearance controls now open each desktop's available
  settings or explain its own panel/configuration controls.
  Sway and Hyprland now have working Waybar edge, module alignment, position index and
  System/Light/Dark controls. They retain JSONC comments and other modules,
  back up the edited config/style and reload only that session's Waybar.
  Position index is zero-based within the selected module group and preserves
  the order of its other items. Its range follows the available insertion slots.
- Panel-opened usage now measures the current provider's natural height.
  Loading, errors and short providers shrink; long views scroll within the
  monitor's available area. Hyprland keeps the popup attached to its panel.
- COSMIC and Hyprland now have interactive previews. Startup waits for the
  service to finish initializing before starting panels. Tiling-desktop
  previews float the application, and usage times follow the host timezone.

## Scope and remaining limits

Build, syntax and startup-log checks support preparing these previews; they
do not constitute visual approval. No automated acceptance suite was run for
this pass. Earlier [acceptance results](linux-acceptance.md) refer to older
revisions.

The first Hyprland manual opening on 2026-09-07 showed a black viewer despite
successful application startup. Protocol logs identified a rejected initial
Aquamarine window commit (`xdg_surface has never been configured`). Its
manual launcher now disables that nested output and streams Hyprland's own
headless `USAGESTAT-LAB` output through WayVNC. The private host relay selects
VNC password authentication to avoid the bundled NeatVNC's Apple DH abort.
The preview uses `start-hyprland` and a Lua configuration to remove startup
warning banners, with rounded floating windows and a slate desktop background.
Live inspection confirmed frame delivery and populated Codex quota/cost rows.
These changes repair the preview transport; Hyprland's UI still needs the
user's manual review.

The next Hyprland review found that panel clicks only presented the window
and the preview's rule centered it. Panel adapters now use `ToggleDetails`.
The Hyprland opening waits for GTK to map a nonzero-opacity first frame, then
uses the compositor's Lua dispatch API (or legacy commands for .conf sessions)
to place the window beside Waybar. Startup also waits for Waybar's geometry.
Read-only compositor inspection confirmed usage at `(8, 44)` below the
36-pixel top panel, at `460 × 680`, without placement or configuration errors.
The preview remains open for manual interaction review; no scripted clicks
or screenshots were used.

For the subsequent performance/blank-space review, the preview now enables
GPU rendering for GTK and WayVNC, raises the stream limit from 30 to 60 FPS,
and raises container shared memory from 64 to 512 MiB. CPU and RAM remain
uncapped. Hyprland blur/animations are disabled for this preview, and the VNC
relay uses TCP_NODELAY and separate input/frame forwarding to avoid input
waiting behind a large frame. Read-only startup inspection confirmed the GL
renderer, working Waybar config discovery and a popup growing from 249 to
573 pixels as Codex loaded, with no application diagnostics. Responsiveness,
settings changes and switching to shorter providers remain for manual review.

The first Cinnamon review found an unanchored popup, an unnecessary scrollbar
and an almost empty desktop. Its applet now sends its actual rectangle, panel
edge and workspace work area. X11 placement targets the application's own
surface and includes GTK's shadow extents when sizing it, so the measured
provider content has the space it requested.

The manual Cinnamon preview now uses a regular container account and the
normal `cinnamon-session`, with Nemo, wallpaper, the menu, task list, workspaces,
tray, clock, settings and terminal. This also fixes Nemo refusing to run as
root. The Hyprland preview now includes its packaged wallpaper, launcher,
terminal, file manager, notification daemon, workspaces and clock, with both
keyboard shortcuts and mouse-accessible Waybar launchers. These additions
apply to manual previews; the minimal acceptance profiles remain separate.
Popup interactions and the richer desktops still require the user's visual
review. No automated interaction scenarios or screenshots were run.

The subsequent alignment/side-panel pass exposes **Popup alignment** in every
Linux preferences window and includes it in the shared state. Native GNOME
alignment is retained; Plasma uses an aligned anchor for its native popup.
Cinnamon, MATE, Xfce and native Waybar send fixed indicator geometry. The
shared Wayland popup now uses GTK4 Layer Shell on Sway, Hyprland, Budgie and
COSMIC; X11 uses EWMH placement including GTK shadow extents. Tray/text
fallbacks align to their panel's edge instead of a pointer position. Left /
Right maps to Top / Bottom on side panels. Vertical panel images stack the
enabled components and providers with upright text and logos rather than
rotating the complete strip. Provider count, scrolling and fill styles remain
shared with horizontal panels.

Both lab images include gtk4-layer-shell. Syntax checks, native Waybar/Xfce
builds and runtime packaging passed. Read-only Hyprland startup inspection
reported a `usagestat-popup` layer at `(520, 44)`, `460 × 572`, beneath the
36-pixel panel with no application diagnostics. The earlier IPC placement
observations above describe the superseded implementation. Alignment choices,
side-panel appearance and provider switching still need manual review.

Outside-click dismissal is included in the shared popup: transparent Wayland
work-area surfaces dismiss it while leaving panel input available; X11 watches
button releases without grabbing them. A short guard prevents that same click
from reopening the popup through the panel's D-Bus toggle. The separate
application remains open. The Linux Shortcuts page links desktop keyboard
settings, copies installed commands and supplies Hyprland/Sway/i3/sxhkd
examples. GNOME gets native opt-in shortcut recording and registration.
No global bindings were assigned on the host or in the previews. These
interaction changes remain pending manual review.
The updated Hyprland startup placed the transparent dismissal surface at
`(0, 36)`, `1500 × 864`, leaving the bar's 36-pixel strip uncovered; the popup
was in the layer above it. Cinnamon was reopened with UsageStat on a right
panel for the next manual review. Package/schema checks and QML lint passed.

The next Cinnamon review exposed an X11 identity check that prevented both
placement and dismissal: GTK advertises `gjs` as `WM_CLASS`, while UsageStat's
identity is in `_GTK_APPLICATION_ID`. The helper now checks that application
ID on the exact popup surface, allowing for its initial property publication.
Repairing the live right-panel popup moved it from `(38, 90)` to `(992, 286)`
at `460 × 297`, eight pixels inside the panel at x=1460, using its saved Center
alignment. These are native geometry observations, not an automated click
test. The manual launcher also supports `--detach` so the preview and its
host backend bridge survive the launching terminal closing. The prior
orphaned preview had lost its bridge and showed connection-refused errors.

Plasma has a native panel popup. The other ports open the shared GTK popup
from their panel/tray integration, with a separately launchable application.
Polybar now uses the bundled provider-logo font; add it to the bar's font list
as described in [Linux setup](../LINUX.md#waybar-text-fallback-and-polybar).
The Waybar text fallback still uses initials; native Waybar supports graphical
panel rendering, including partial logo fills.

Tray placement, slot size and ordering belong to each desktop. Automatic
tray contrast follows Budgie's independent panel theme when available and
otherwise the application light/dark preference. Use **Icon contrast** when a
custom panel theme has a different background. The empty
track contrasts with that selected surface and the fill color.

Budgie currently logs a `WindowId` type warning: its tray expects an unsigned
integer while the [KDE interface](https://github.com/KDE/kstatusnotifieritem/blob/master/src/org.kde.StatusNotifierItem.xml)
specifies a signed integer. The item uses the specified type with value zero;
this warning does not prevent registration. Desktop service/portal warnings
from the minimal preview environment are separate from application errors.

These are isolated desktop previews, not full login sessions on every
distribution. Review panel/tray appearance, provider switching, long details,
light/dark colors and the preferences you use before marking a desktop complete.
