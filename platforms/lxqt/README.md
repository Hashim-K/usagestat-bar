# LXQt panel widget

Build the Linux bundle and install it with `--native lxqt`. Start the panel
with `usagestat-lxqt-panel`, then add **UsageStat Bar** in its widget picker.
The wrapper makes the user-installed plugin discoverable without modifying
system libraries. See [Linux setup](../../docs/LINUX.md#native-lxqt-budgie-and-cosmic-widgets).

This Qt 6 plugin scales the shared panel artwork using the current panel
orientation, icon size and palette. It sends its widget bounds and the panel's
native screen geometry over D-Bus; the shared popup aligns to this section.
Geometry changes are published before activation, so a shortcut can open the
popup before the first click. Provider pins, counts and scrolling use the
shared service's panel settings, independently of optional tray settings.
