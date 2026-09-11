# Budgie panel applet

Build the Linux bundle and install it with `--native budgie`. Restart the
panel/session and add **UsageStat Bar** in Budgie Desktop Settings.
See [Linux setup](../../docs/LINUX.md#native-lxqt-budgie-and-cosmic-widgets)
for dependencies and user-plugin discovery.

The applet embeds the shared GTK 3 panel widget. It reads the live panel
orientation and allocation, including panels anchored on only one side,
and publishes the occupied UsageStat section for clicks and shortcuts.
The build supports libpeas 1 and 2 and does not replace Budgie's system tray.
