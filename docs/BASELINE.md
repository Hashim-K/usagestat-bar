# Current-version port baseline

Tracking: [baseline #3](https://github.com/Hashim-K/usagestat-bar/issues/3),
[GNOME #4](https://github.com/Hashim-K/usagestat-bar/issues/4),
[porting roadmap #2](https://github.com/Hashim-K/usagestat-bar/issues/2).

The reference is GNOME commit
[`9436c383`](https://github.com/Hashim-K/usagestat-bar/tree/9436c3834522745076c60937dc7c4c4a1649e6e8).
It includes changes newer than the remote `main` when the porting work began.
Use its implemented behavior and the checklist below, not just the older
README or the planned section of `FEATURES.md`.

The initial objective is to reproduce the current product on Linux desktops
and panels. Windows and macOS follow. Large shared-code refactoring and a
coordinated release pipeline belong to Phase 2; working, repeatable checks
belong to every Phase 1 port.

## Feature contract

Each port must report every row as **passed**, **failed**, **untested**, or
**platform limitation** with an explanation and linked follow-up. A platform
limitation needs an explicit review before counting toward baseline completion.
Do not silently omit a current feature because a generic tray API lacks it.
Desktop-specific controls may use a documented native equivalent.

| ID | Required behavior | Reference implementation | Current automated coverage |
| --- | --- | --- | --- |
| CLI-1 | Discover the backend, respect an explicit executable path, and pass config/plugin/source options as separate arguments. | `cli.js`: `findAiUsage`, `fetchProviderUsage` | Contract tests |
| CLI-2 | Discover provider manifests; normalize metric and legacy usage payloads without losing valid windows or provider metadata. | `cli.js`: `fetchProviderManifests`, `normalizeBackendSnapshot` | Contract tests |
| CLI-3 | Report missing CLI, empty/malformed/failed responses; bound command execution, cancel a running command, and recover on the next refresh. | `cli.js`: `runAsync`, fetch functions; extension error rendering | Contract tests; native error/recovery check |
| CFG-1 | Preserve provider IDs/aliases, enabled state, order, distinct account/source instance IDs, custom names, and parent/child grouping. | `config.js`; `extension.js`: `_loadProviders`, `_childProviders` | Contract and native checks |
| CFG-2 | Persist config, custom commands, source/credential fields and provider settings privately; keep separate stable/dev config files. | `config.js`: `loadConfig`, `saveConfig` | Contract tests, including quoted commas and typed arrays |
| CFG-3 | Support adding/removing/reordering sources and providers, custom commands/icons, API tracking, hidden providers and per-source setup. | `prefs.js`: `ProvidersPage` | Config round trips covered; UI flows require manual checks |
| DATA-1 | Preserve quota units, periods, reset metadata and all standard/extra windows; clamp displayed percentages to 0–100. | `cli.js`; extension window rendering | Contract tests |
| DATA-2 | Explicit window selection uses the selected visible window; hidden selection falls back to automatic behavior. | `extension.js`: `_selectedPanelWindow` | Native checks |
| DATA-3 | Automatic panel usage is the mean of visible standard windows, with paid-usage fallback when primary quota is exhausted and the extra-usage window is available. | `extension.js`: `_automaticPanelWindow`, `_providerCostWindow` | Mean/visibility covered; paid fallback requires follow-up coverage |
| DATA-4 | Used/remaining modes change meter fill, text and logo fill consistently; thresholds still refer to **used** quota. | `extension.js`: `_displayPercent`, `_formatPercent`, `_panelProviderIcon` | Native checks and screenshots |
| DATA-5 | Display optional provider cost, today/yesterday/period cost summaries, badges/text, and pace information. Missing cost must not hide quota. | `cli.js`: `normalizeCostSummary`; extension cost/pace renderers | Cost/text/badges covered; pace/provider-cost views require follow-up coverage |
| VIEW-1 | Show a visible panel indicator, provider switcher, details, child sources, refresh/loading/error states and timestamps. | `extension.js`: `_render`, `_renderProvider`, `_renderChildProvider` | Native checks and screenshots; loading interaction still manual |
| VIEW-2 | Configure bar/percent/logo/text components and ordering, multiple providers, pinned providers, multiple usage bars, spacing and orientation. | GNOME settings schema; `_renderPanel`, `AppearancePage` | Multiple providers/bars covered; pinning, drag ordering and all combinations still manual |
| VIEW-3 | Configure normal/threshold/neutral colors, provider icon styles, custom icons, and full/vertical/horizontal/pie logo fills. Preserve SVG presentation attributes. | `extension.js`: icon helpers; `prefs.js`: `AppearancePage` | Fill geometry and used/remaining screenshots covered; custom icons/themes still manual |
| VIEW-4 | Support panel placement/index, popup alignment, scroll switching, keyboard interaction and readable scaled/multi-monitor layouts. | GNOME panel/settings handlers | Default placement rendered; input/scaling/multi-monitor checks still manual |
| ALERT-1 | Choose the highest crossed custom threshold. First observation does not notify; repeated/downward readings do not notify; a later enabled upward crossing does. | `extension.js`: `_thresholdForUsedPercent`, `_maybeNotifyThreshold` | Actual native notification creation checked |
| PREF-1 | Open usable Behaviour, Appearance, Providers and Tools preferences, including per-provider edit entry points. | `prefs.js`; `_openProviderPreferences` | Mapped preferences window and first page screenshot; all page flows still manual |
| ACTION-1 | Expose the current status/dashboard links, reset formats, refresh controls, CLI/plugin setup and terminal/tool actions. | `extension.js`, `prefs.js` | Metadata and command arguments covered; launching real external tools still manual |
| LIFE-1 | Disable/re-enable cleanly, preserve settings, cancel pending work, and restore the indicator without duplicate instances. | Extension lifecycle; `cli.js` | Idle disable/re-enable and direct-process cancellation covered; full in-flight UI lifecycle still manual |
| LIFE-2 | Clean install, upgrade preserving existing config, login/session restart, uninstall, and documented runtime dependencies. | Build/install scripts and target-specific packaging | Archive contents and temporary installation checked; clean VM lifecycle is still required |

## Shared fixture contract

[`tests/fixtures/scenarios.json`](../tests/fixtures/scenarios.json) records
the baseline revision, synthetic manifests, and named scenarios.
[`tests/fixtures/usagestat`](../tests/fixtures/usagestat) implements the
backend commands used by this app:

```text
usagestat --json [--config PATH] [--plugin-dir PATH] list
usagestat --json [--config PATH] [--plugin-dir PATH] usage --provider ID [--source SOURCE]
usagestat --json [--config PATH] [--plugin-dir PATH] cost --provider ID
```

These fixtures never call a provider or load real credentials. They include
normal/zero/75%/90%/full/over-limit usage, extra windows, missing optional
fields, legacy and array payloads, unavailable costs, empty/malformed/error
responses, and a hanging command. The config fixture has two visible providers
and an additional grouped account, without credentials.

Fetched/reset timestamps are deliberately fixed synthetic values. Cost dates
are generated for today and yesterday in the process timezone; automated runs
use UTC. These are behavioral fixtures, not pixel-perfect golden images.

Every future frontend should exercise these same scenarios, even if it uses
a different language/toolkit. The current GJS tests exercise the real GNOME
adapter. They are not a requirement to use GJS for other platforms.

## Defects fixed while capturing the baseline

- A timed-out CLI could leave a stale GLib timer ID and an unhelpful process
  status. Timeout now clears its source and returns an explicit error.
- Cancelling I/O did not terminate the directly launched CLI process. It now
  does; already-cancelled operations do not spawn a process. Custom shell
  commands that create their own process trees need separate coverage.
- Config always used `~/.config`, ignoring `XDG_CONFIG_HOME`. It now follows
  GLib's config-directory resolution, allowing disposable test settings.
- Config privacy depended on a later `chmod` subprocess. File replacement now
  requests private permissions when writing.
- Commas inside array strings split paths incorrectly and numeric/boolean
  array elements disappeared when loading. The parser now respects quoted
  commas, escapes and nested arrays, preserving the value types it writes.
- Installation copied the whole working directory, including development
  files, and could operate through a development symlink. It now installs
  the runtime-only release archive, replacing a symlink without touching its
  source. Build/install commands also work outside the checkout directory.

The config parser remains a limited TOML reader for the format this app writes;
it is not a general TOML implementation. Further parser or current-product
defects should be tracked and fixed explicitly, not adopted as desired port
behavior.

## Acceptance procedure

1. Record app commit (and dirty status), backend version, OS/distro, desktop,
   panel/compositor, session type, architecture and relevant dependencies.
2. Install in a clean target environment and run the contract fixtures.
3. Exercise the native indicator, detail/settings UI and notification path;
   retain logs, screenshots, commands and pass/fail results.
4. Check clean install, upgrade, restart/login and uninstall in a VM or real
   target session. Check keyboard access, themes, scaling and multiple displays.
5. Run a separate live-provider smoke check when an appropriate test account is
   available. Record the provider/version and outcome without uploading secrets
   or private usage data.
6. Attach a row-by-row parity report. A successful build, fixture check or one
   GNOME test session alone does not establish support for another desktop,
   distro, architecture or GNOME version.

See [testing instructions](TESTING.md) and the
[initial GNOME report](reports/gnome-50.4.md). The
[initial Linux ports report](reports/linux-ports.md) records the new desktop
checks and remaining parity work.
