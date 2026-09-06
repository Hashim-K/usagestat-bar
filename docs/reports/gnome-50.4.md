# Initial GNOME baseline result

Date: 2026-09-06. Reference: `9436c3834522745076c60937dc7c4c4a1649e6e8`.
Implementation branch: `linux-baseline-checks`, including the baseline harness
and corrections described in [BASELINE.md](../BASELINE.md).

Environment: Fedora Workstation 44, x86_64, Linux
`7.1.10-200.fc44.x86_64`, GNOME Shell/Mutter 50.4, GJS 1.88.1.
Native tests ran in an isolated headless Wayland session, using the AMD render
device and a 1600×1000 virtual monitor. The backend was fixture v1; no live
provider/account was used. Config and runtime directories were disposable.

| Check | Result |
| --- | --- |
| `./tests/run.sh` | 36 contract checks passed |
| `./test-nested.sh` | 12 native GNOME checks passed |
| `./tests/package.sh` | Runtime-only archive and temporary installation checks passed |
| `./dev-shell.sh --fixtures` | Devkit session started and loaded fixture providers; bounded shutdown cleaned temporary state |
| Provider details, grouped account, quota and costs | Rendered and visually inspected |
| Multiple providers, used/remaining mode and logo fill | Rendered and visually inspected |
| Backend failure and recovery | Error screenshot inspected; recovery assertion passed |
| Preferences | Visible Behaviour page inspected; four page tabs present |
| Threshold crossings | Actual GNOME notifications observed and counted |
| Disable/re-enable | Indicator restored and settings retained |

Release-archive evidence was written locally to `artifacts/gnome.0bP7jE/`; rerunning
the command creates a new directory with environment metadata, JSON results,
five screenshots, and logs. Generated evidence is ignored by Git and is not
promised to exist in a fresh clone. The commands above reproduce it.
The interactive launch smoke check used `artifacts/gnome.E1iFnG/` and was
deliberately stopped after 25 seconds; the timeout's exit status 124 is expected.

Visual review caught and corrected a test false positive: the initial
preferences check saw a window title before the window was painted. The
driver now waits for a mapped, visible window before capturing the screenshot.

No application JavaScript errors appeared in the successful native run.
The private session logged unavailable host services (including PipeWire and
the authentication agent), and shutdown messages from desktop services.
These do not establish coverage for the missing services.

## Remaining acceptance work

- Full manual preferences flows: add/remove/reorder accounts and sources,
  custom icons/commands, pinned providers, all window/layout combinations.
- Real keyboard, screen-reader, scrolling and drag/drop interaction.
- Light/dark theme matrix, fractional scaling and multiple monitors.
- Paid-usage fallback, pace rendering, every reset format and live external
  browser/terminal/provider action.
- Disable during an in-flight refresh and custom-command process trees.
- A real-provider smoke test using a suitable test account.
- Clean VM install, upgrade, login/session restart and uninstall.
- GNOME 45–49 and any other declared environments/architectures.

This is a verified initial development baseline, not completion of every
acceptance criterion in issues #3 and #4. Those issues remain open. KDE and
the other platform ports have not yet been implemented.
