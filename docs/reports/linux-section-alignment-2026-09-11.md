# Correction: popup alignment uses the UsageStat section

This is the historical failure audit. The subsequent
[fixes and native review](linux-section-alignment-fixes-2026-09-11.md) contain
the replacement adapters, corrected captures and current results.

The earlier alignment pass was incorrect. Left aligns the popup's left edge
with the left edge of the UsageStat section; center aligns their centers;
right aligns their right edges. On a side panel, the corresponding references
are the section's top, center and bottom. Other panel modules are excluded.
Only the screen/work-area boundary may clamp a popup away from that alignment.

The old test merely checked that three horizontal positions differed and were
repeatable. Worse, it explicitly expected the opposite ordering for Polybar
and generic tray hosts, accepting whole-panel placement. That target-specific
exception has been removed. The supplied
[bspwm screenshot](../../artifacts/linux-fixes-2026-09-11-gallery/bspwm/27-popup-alignment-distinct.png)
does not satisfy the requirement.

## Measured reproduction

A fresh native bspwm run gives the UsageStat section a distinct background in
the test fixture. Its bounds are measured from the actual Polybar rendering,
independently of the popup implementation. The neighboring module is excluded.
The section starts at x=637 and is 258 pixels wide. The popup is 460 pixels wide.

| Alignment | Expected popup x | Actual popup x | Error |
| --- | ---: | ---: | ---: |
| Left | 637 | 7 | −630 px |
| Center | 536 | 569 | +33 px |
| Right | 435 | 1131 | +696 px |

All three now fail. Distinct positions alone cannot pass. Missing section
bounds also fail rather than silently substituting the whole panel.

The [corrected native audit](http://127.0.0.1:34985/section-audit/index.html)
contains the fresh videos and per-step screenshots. **bspwm: 22 passed, four
failed, two unsupported. MATE: 28 passed.** MATE's left, center and right
positions each match the native section with zero measured pixel error. Its
successful result is a reference for the required behavior, not evidence that
the fallback hosts have been fixed.

The corrected native run and its screenshots are retained under
`artifacts/linux-section-alignment-2026-09-11/bspwm`. A MATE reference run in the
same batch checks the bounds supplied by its real native widget. Native
`ToggleDetailsAt` calls are captured in `section-anchor.log`; no fake anchor
is injected into the application by the tests. Five focused placement tests
also cover rejection of the reported frame, both axes, screen clamping and
missing section geometry.

## Implementation gap

The shared popup can already use an exact section rectangle through
`ToggleDetailsAt`. Native MATE, Xfce, Cinnamon and Waybar adapters supply it;
GNOME and Plasma position their own native popups.

The stock Polybar script callback supplies no module rectangle. The existing
X11 fallback therefore uses a dock's full bounds. Generic tray activation
likewise supplies no section rectangle, and COSMIC's status-area implementation
even sends `(0, 0)` for activation. The Wayland fallback then aligns against
the full output. These are missing native geometry integrations, not just an
incorrect horizontal offset.

**i3, bspwm, LXQt, Budgie and COSMIC must not be marked complete for section
alignment.** They need real section bounds from their respective panel/tray
integrations. A click coordinate, a configured group name, the whole tray, or
the full monitor is not an equivalent reference. The gallery now flags these
profiles for correction. Original captures and mechanical results are retained
for comparison; earlier aggregate pass counts are not acceptance of this
feature. This audit changes the tests and report, not those missing runtime
integrations.
