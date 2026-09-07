# Remaining Linux desktops — prepared for manual review

The [Plasma manual review](plasma-manual-review.md) is the visual baseline.
Its feedback has been carried into the other Linux integrations. All ten
profiles below remain **pending the user's manual review**.

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

Plasma has a native panel popup. The other ports open the shared application
from their panel/tray integration. Polybar and the Waybar text fallback still
use initials in place of image logos. Native Waybar supports the graphical
panel rendering.

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
