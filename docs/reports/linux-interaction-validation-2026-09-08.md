# Linux interaction validation — 8 September 2026

**Ten Linux profiles passed their supported scenarios. Hyprland has a remaining
click/focus defect; COSMIC could not be validated reliably in the preview.**
This is interaction coverage for the recorded versions, separate from the
user's visual approval or full distribution support.

Open the [video and screenshot gallery](../../artifacts/linux-interaction-validation-2026-09-08/index.html).
It includes **12 MP4 recordings and 289 per-step screenshots**, including the
failed checks. Each platform has raw observations, logs, package versions and
source metadata. The [machine-readable matrix](../../artifacts/linux-interaction-validation-2026-09-08/summary.json)
retains failed and unsupported results; the [media verification](../../artifacts/linux-interaction-validation-2026-09-08/media-verification.json)
checks the encoded videos and local links. These artifacts are local to this
checkout and are not published to GitHub.

If a chat or editor opens the gallery as source, serve it locally and open
`http://127.0.0.1:8764/` in a browser:

```bash
python3 -m http.server 8764 --bind 127.0.0.1 \
  --directory artifacts/linux-interaction-validation-2026-09-08
```

Each platform's recording is also available directly at
`http://127.0.0.1:8764/PLATFORM/review.mp4` (for example, `plasma/review.mp4`).

## Results

“Passed” means all applicable checks in that profile's recorded scenario passed.
Unsupported cases are excluded from the pass count. COSMIC's raw state-only
successes are excluded from native interaction coverage.

| Profile | Recorded version | Passed | Failed | Unsupported | Assessment |
| --- | --- | ---: | ---: | ---: | --- |
| [GNOME](../../artifacts/linux-interaction-validation-2026-09-08/index.html#gnome) | Shell 50.4 | 19 | 0 | 1 | Passed; native top panel only |
| [Plasma](../../artifacts/linux-interaction-validation-2026-09-08/index.html#plasma) | Workspace 6.7.4 | 26 | 0 | 0 | Passed |
| [Cinnamon](../../artifacts/linux-interaction-validation-2026-09-08/index.html#cinnamon) | 6.6.7 | 26 | 0 | 0 | Passed |
| [MATE](../../artifacts/linux-interaction-validation-2026-09-08/index.html#mate) | Panel 1.28.4 | 26 | 0 | 0 | Passed |
| [Xfce](../../artifacts/linux-interaction-validation-2026-09-08/index.html#xfce) | Panel 4.20.7 | 26 | 0 | 0 | Passed |
| [LXQt](../../artifacts/linux-interaction-validation-2026-09-08/index.html#lxqt) | Panel 2.4.1 | 26 | 0 | 0 | Passed |
| [Sway](../../artifacts/linux-interaction-validation-2026-09-08/index.html#sway) | 1.11 / Waybar 0.15.0 | 26 | 0 | 0 | Passed |
| [Hyprland](../../artifacts/linux-interaction-validation-2026-09-08/index.html#hyprland) | 0.56.2 / Waybar 0.15.0 | 23 | 3 | 0 | Needs click/focus fix |
| [Budgie](../../artifacts/linux-interaction-validation-2026-09-08/index.html#budgie) | Desktop 10.10.2 | 26 | 0 | 0 | Passed |
| [COSMIC](../../artifacts/linux-interaction-validation-2026-09-08/index.html#cosmic) | cosmic-comp 1.6.0 | — | — | — | Preview blocked; no sign-off |
| [i3](../../artifacts/linux-interaction-validation-2026-09-08/index.html#i3) | 4.25.1 / Polybar 3.7.2 | 24 | 0 | 2 | Passed final run; earlier transient alignment observation below |
| [bspwm](../../artifacts/linux-interaction-validation-2026-09-08/index.html#bspwm) | 0.9.9 / Polybar 3.7.2 | 24 | 0 | 2 | Passed |

## What was exercised

- Pin one provider and keep it fixed through six wheel notches, including
  wraparound in both directions. Pin two providers in a chosen order, keep a
  free scrolling slot, reduce the count to one, and release the pins. Tray
  integrations use independent tray pins/count settings and inspect the
  registered native tray items.
- Scroll the panel in both directions. Disable panel scrolling and check that
  wheel events leave the active provider unchanged.
- Scroll over the popup tabs/header in both directions, including reaching a
  pinned provider. Disable popup switching independently. For the port profiles,
  scroll an overflowing provider body and verify visible content moves without
  switching providers; switch to a shorter provider and verify the window shrinks.
- Open by clicking the native indicator, close with a second click, and dismiss
  by clicking the desktop.
- Move UsageStat between the start/center/end panel groups and before/after a
  neighboring item. Move the panel to bottom/left/right where supported and
  check actual popup coordinates. Set all three popup alignment values,
  reopen, and compare the anchor position.
- Open Preferences. The settings used by these scenarios are applied through
  GSettings or the desktop's native configuration/API. MATE's movement uses
  its actual context menu and pointer drag. This run does **not** click every
  settings widget or establish that every external settings launcher works.

The GNOME reference uses the native Shell extension and virtual pointer input;
the other profiles use real native panels and X11/Wayland mouse/wheel events,
with public D-Bus state plus observed window/layer geometry and screenshots.
This is not a mock of the input handlers. All usage/account data comes from
four synthetic providers in an isolated session.

## Fixes found and verified during this pass

- Panel scrolling previously included pinned providers in the rotation, causing
  a wheel notch to appear to do nothing. Effective pins are now excluded from
  the panel's rotating slots, while the popup can still select every provider.
- Tray count mode now supports its own ordered provider pins, leaving one free
  scrolling slot and respecting count reductions. The controls appear under
  **Preferences → Tray → Pinned providers**.
- MATE's click handler assumed a different return shape for translated widget
  coordinates and could fail before opening the popup. It now handles the
  installed PyGObject binding; its native Move/Lock/Remove menu is also restored.
- The fully transparent Wayland dismissal window produced no rendered buffer,
  so it never received outside clicks. A minimally visible alpha surface keeps
  it mapped; it occupies the work area below the popup and leaves panel input
  available. Outside dismissal passed on Sway, Hyprland and Budgie.
- Generic popups now rediscover moved panels instead of retaining their old
  rectangle. X11 discovery includes Polybar's override-redirect windows and
  i3's framed dock children. bspwm receives a floating-window ConfigureRequest.
  Long popups explicitly reserve the panel's space when the window manager's
  reported work area covers the entire monitor.

The shared contract suite passed **26/26** after updating two obsolete rendering
expectations to match the already-approved Unicode meters and tray designs.
Python compilation, shell syntax and whitespace checks passed. Native panel
builds and packaging are exercised by each isolated port installation.

## Remaining findings and review priorities

**Hyprland: second click can be swallowed.** With the pointer left in place,
opening the popup can take keyboard focus and prevent the next click from
reaching Waybar. Moving the pointer away and back restores it. The recording
contains the failed toggle and a placement step affected by the same behavior;
the missing placement observation also fails the group-distinctness check.
Disabling popup keyboard focus in a private diagnostic session avoided the
symptom, but that workaround was not applied because it would compromise
keyboard interaction. This needs a proper focus/input fix before sign-off.
See the [failed toggle screenshot](../../artifacts/linux-interaction-validation-2026-09-08/hyprland/10-second-click-toggles.png)
and [raw results](../../artifacts/linux-interaction-validation-2026-09-08/hyprland/result.json).

**COSMIC: preview environment blocked.** The selected recorded attempt has a
compositor panic with `Too many open files`, followed by an unavailable status
notifier watcher. Earlier isolated attempts also encountered EGL errors and
lost Wayland connections. COSMIC's native input route differs from the other
Wayland profiles and was not stable enough to establish coverage. Four raw
state/screen checks passed and ten failed; those four do not demonstrate a
working COSMIC integration. Repeat the complete matrix in a healthy COSMIC
session or VM, including tray pinning/scrolling and every placement case.
See the [compositor log](../../artifacts/linux-interaction-validation-2026-09-08/cosmic/wm.log)
and [raw results](../../artifacts/linux-interaction-validation-2026-09-08/cosmic/result.json).

**i3: review reopening under load.** One earlier run measured different popup
positions on reopening. The final run passed after the placement/work-area
changes, but that single observation does not establish the cause of the
earlier transient. Its [earlier raw result](../../artifacts/interaction-review-2026-09-08-followup/i3/result.json)
is retained. Include repeated open/close after moving the panel in manual review.

The placement harness itself needed corrections: LXQt centers groups with
expanding spacers, rather than an unsupported Center plugin alignment; Budgie's
actual panel was thinner than the estimated strip, so a broad color detector
clicked nearby wallpaper. The corrected native placement runs passed. These
were test setup defects and are not reported as application failures.

Minimal X11 labs do not run a full composited desktop, so screenshots may have
black wallpaper, square window frames, and different shadows. They demonstrate
input and geometry, not final theme approval. Visual inspection also found thin
body scrollbars in ordinary MATE/LXQt/i3 fixture popups, and a Cinnamon hover
tooltip overlapping the open popup while the pointer remains on the panel.
Those are remaining polish items; the passing scenarios do not assert absence
of scrollbars or tooltips. Polybar has no left/right panel mode;
the native GNOME panel is fixed at the top.

## Scope and reproduction

The runs cover Fedora 44 packages plus the Arch Hyprland lab, on one display per
session. They do not certify all distro versions, multi-monitor arrangements,
fractional scaling, touchpad momentum, global shortcuts, accessibility, reboot
or upgrade behavior, or live provider/network reliability. macOS and Windows
were not included in this Linux port validation. The user's running desktop
and live manual Cinnamon preview were left intact.

The recorded source is the dirty checkout based on `109979b`; each port's
`environment.json` records its exact source digest and image ID. GNOME records
the source commit, dirty state and installed versions; its result's older
`referenceCommit` field identifies the historical baseline, not the checkout
used for this run. Follow-up batches capture fixes found during validation.

```bash
python3 tests/linux/review.py all --output artifacts/new-interaction-review
USAGESTAT_TEST_INTERACTIONS=1 ./tests/gnome-session.sh --check
python3 tests/linux/report.py artifacts/new-interaction-review --output artifacts/new-review-gallery
```

See [the runner instructions](../LINUX.md#recorded-interaction-checks) for image
setup, single-platform runs and GNOME video encoding. Recordings are sampled
at 5 FPS, not performance benchmarks. The recorder now holds the previous
frame when capture is slow, avoiding accelerated playback; the Plasma clip
was rerun with this correction. Step seek links are approximate.
