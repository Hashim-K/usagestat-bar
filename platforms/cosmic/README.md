# COSMIC panel applet

Build the Linux bundle and install it with `--native cosmic`, then add
**UsageStat Bar** in COSMIC's Panel settings. No Rust build is required;
the applet uses the same GJS/GTK runtime as the application.
See [Linux setup](../../docs/LINUX.md#native-lxqt-budgie-and-cosmic-widgets).

COSMIC hosts this undecorated Wayland surface inside the panel. Its GTK
popover belongs to that surface, so alignment uses the actual UsageStat
widget. The shared provider view supplies tabs, meters, formatting and
content sizing. The native popup handles outside-click dismissal and work-area
clamping. Its exported D-Bus endpoint also serves the global toggle command.

Do not add external margins or shadows to the popover: COSMIC's panel proxy
requires the buffer dimensions to match its configured window geometry.
The rounded content background is contained inside the surface.
