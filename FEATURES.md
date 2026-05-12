# Features

## Implemented

- [x] Remove the broken overview tab.
- [x] Provider switcher with provider logos and mini usage bars.
- [x] Loading placeholders that do not block provider tabs/logos from rendering.
- [x] Show last refreshed time in the provider popup header.
- [x] Popup edit button opens Preferences on the Providers page and expands the active provider.
- [x] Choose which usage window drives the top bar per provider: auto, session, or weekly.
- [x] Top bar component controls:
  - [x] Usage bar
  - [x] Usage percent
  - [x] Logo
  - [x] Text
  - [x] Enable/disable components
  - [x] Drag enabled components to set order
- [x] Custom usage thresholds.
- [x] Add more thresholds.
- [x] Per-threshold settings:
  - [x] Name
  - [x] Percent used
  - [x] Color
  - [x] Notification on/off
  - [x] Delete threshold
- [x] Threshold color picker and hex field stay synced.
- [x] Improved provider settings layout:
  - [x] Enabled and disabled providers are separated.
  - [x] Disabled providers are not draggable.
  - [x] Disabled providers become draggable after enabling.
  - [x] Add API tracking action for providers with API-key support.
- [x] GNOME 50 nested shell development helper.

## Planned

- [ ] Validate threshold behavior with real provider data and edge cases.
- [ ] Refine the threshold UI after testing in the nested GNOME Shell.
- [ ] Improve notification text and notification frequency controls if needed.
- [ ] Make provider popup actions richer:
  - [ ] Add account flow
  - [ ] Usage dashboard link
  - [ ] Status page link
  - [ ] Settings/about/quit style actions if useful on GNOME
- [ ] Improve provider-specific settings:
  - [ ] Clearer wording for API tracking vs extra tracking.
  - [ ] Better provider-specific add/setup actions.
  - [ ] Provider icons in preferences.
- [ ] Add visual QA screenshots for the popup and preferences pages.
- [ ] Document the GNOME 50 development workflow in README.
