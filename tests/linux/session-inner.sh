#!/usr/bin/env bash
set -euo pipefail
target="$1"
Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp -ac > /out/display.log 2>&1 &
export DISPLAY=:99
export XDG_SESSION_TYPE=x11 GSK_RENDERER=cairo
unset WAYLAND_DISPLAY
dbus-update-activation-environment DISPLAY XDG_SESSION_TYPE GSK_RENDERER XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_RUNTIME_DIR PATH GSETTINGS_SCHEMA_DIR USAGESTAT_CLI USAGESTAT_FIXTURE_STATE USAGESTAT_FIXTURE_LOG GTK_A11Y NO_AT_BRIDGE
for attempt in $(seq 1 50); do
    if xdotool getdisplaygeometry >/dev/null 2>&1; then break; fi
    sleep 0.1
done
gsettings set io.github.HashimK.UsageStatBar usagestat-cli-path /src/tests/fixtures/usagestat
gsettings set io.github.HashimK.UsageStatBar refresh-interval 0
gsettings set io.github.HashimK.UsageStatBar panel-bar-count 2
gsettings set io.github.HashimK.UsageStatBar panel-components 'bar,percent,logo,text'
case "$target" in
    lxqt)
        export XDG_CURRENT_DESKTOP=LXQt
        dunst -print > /out/notifications.log 2>&1 &
        openbox > /out/wm.log 2>&1 &
        lxqt-panel > /out/panel.log 2>&1 &
        ;;
    xfce)
        export XDG_CURRENT_DESKTOP=XFCE
        openbox > /out/wm.log 2>&1 &
        mkdir -p "$XDG_CONFIG_HOME/xfce4/xfconf/xfce-perchannel-xml"
        cp /src/tests/linux/xfce4-panel.xml "$XDG_CONFIG_HOME/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml"
        xfce4-panel --disable-wm-check > /out/panel.log 2>&1 &
        ;;
    plasma)
        export XDG_CURRENT_DESKTOP=KDE
        kwin_x11 --replace > /out/wm.log 2>&1 &
        plasmashell > /out/panel.log 2>&1 &
        for attempt in $(seq 1 100); do
            if gdbus call --session --dest org.kde.plasmashell --object-path /PlasmaShell --method org.kde.PlasmaShell.evaluateScript 'var panel = new Panel; panel.location = "top"; panel.height = 38; panel.addWidget("io.github.HashimK.usagestat");' > /out/panel-setup.log 2>&1; then break; fi
            sleep 0.2
        done
        ;;
    cinnamon)
        export XDG_CURRENT_DESKTOP=X-Cinnamon
        gsettings set org.cinnamon.desktop.input-sources sources "[('xkb', 'us')]"
        gsettings set org.cinnamon enabled-applets "['panel1:left:0:usagestat-bar@hashimkarim:0']"
        cinnamon --replace > /out/panel.log 2>&1 &
        ;;
    mate)
        export XDG_CURRENT_DESKTOP=MATE
        openbox > /out/wm.log 2>&1 &
        export MATE_PANEL_APPLETS_DIR="$XDG_DATA_HOME/mate-panel/applets:/usr/share/mate-panel/applets"
        gsettings set org.mate.panel toplevel-id-list "['top']"
        gsettings set org.mate.panel.toplevel:/org/mate/panel/toplevels/top/ orientation top
        gsettings set org.mate.panel.toplevel:/org/mate/panel/toplevels/top/ size 36
        gsettings set org.mate.panel object-id-list "['usagestat']"
        gsettings set org.mate.panel.object:/org/mate/panel/objects/usagestat/ object-type applet
        gsettings set org.mate.panel.object:/org/mate/panel/objects/usagestat/ applet-iid 'UsageStatAppletFactory::UsageStatApplet'
        gsettings set org.mate.panel.object:/org/mate/panel/objects/usagestat/ toplevel-id top
        mate-panel > /out/panel.log 2>&1 &
        ;;
    i3|bspwm)
        export XDG_CURRENT_DESKTOP="$target"
        if [[ "$target" == i3 ]]; then
            printf '%s\n' 'font pango:DejaVu Sans 10' 'focus_follows_mouse no' > /tmp/i3.conf
            i3 -c /tmp/i3.conf > /out/wm.log 2>&1 &
        else
            bspwm > /out/wm.log 2>&1 &
        fi
        cat > /tmp/polybar.ini <<'CONFIG'
[bar/baseline]
width = 100%
height = 34
background = #20242b
foreground = #e6edf3
font-0 = DejaVu Sans:size=11;2
modules-left = usagestat
CONFIG
        cat /src/platforms/polybar/config.ini >> /tmp/polybar.ini
        polybar -c /tmp/polybar.ini baseline > /out/panel.log 2>&1 &
        ;;
    sway|budgie|cosmic|hyprland)
        export XDG_CURRENT_DESKTOP=sway WLR_BACKENDS=x11 WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1
        export XDG_SESSION_TYPE=wayland
        if [[ "$target" == sway ]]; then
            printf '%s\n' 'output * resolution 1500x900' 'seat * hide_cursor 5000' > /tmp/sway.conf
            # Fedora's file capabilities cannot be granted by a rootless runtime.
            # A plain copy runs with the container user's existing permissions.
            cp /usr/bin/sway /tmp/sway-lab
            /tmp/sway-lab -c /tmp/sway.conf > /out/wm.log 2>&1 &
        elif [[ "$target" == budgie ]]; then
            budgie-daemon > /out/desktop-daemon.log 2>&1 &
            export XDG_CURRENT_DESKTOP=Budgie
            labwc > /out/wm.log 2>&1 &
        else
            export XDG_CURRENT_DESKTOP="$target"
            unset LIBGL_ALWAYS_SOFTWARE
            # A parent Wayland compositor provides a reliable EGL backend for
            # COSMIC and Hyprland without connecting to the host display.
            WLR_BACKENDS=headless WLR_RENDERER=gles2 labwc > /out/parent-wm.log 2>&1 &
        fi
        for attempt in $(seq 1 100); do
            socket=("$XDG_RUNTIME_DIR"/wayland-*); if [[ -S "${socket[0]}" ]]; then export WAYLAND_DISPLAY="${socket[0]}"; break; fi
            sleep 0.2
        done
        if [[ "$target" == cosmic ]]; then
            parent_display="$WAYLAND_DISPLAY"
            export XDG_CURRENT_DESKTOP=COSMIC
            COSMIC_BACKEND=winit cosmic-comp > /out/wm.log 2>&1 &
            for attempt in $(seq 1 100); do
                for socket in "$XDG_RUNTIME_DIR"/wayland-*; do
                    if [[ -S "$socket" && "$socket" != "$parent_display" ]]; then export WAYLAND_DISPLAY="$socket"; break 2; fi
                done
                sleep 0.2
            done
        fi
        if [[ "$target" == hyprland ]]; then
            export XDG_CURRENT_DESKTOP=Hyprland
            printf '%s\n' 'monitor = , 1500x900, auto, 1' 'misc:disable_hyprland_logo = true' 'misc:disable_splash_rendering = true' 'debug:disable_logs = false' > /tmp/hyprland.conf
            Hyprland --config /tmp/hyprland.conf > /out/wm.log 2>&1 &
            for attempt in $(seq 1 100); do
                hypr_display="$(hyprctl instances -j 2>/dev/null | python3 -c 'import json,sys; values=json.load(sys.stdin); print(values[-1]["wl_socket"] if values else "")' 2>/dev/null || true)"
                if [[ -n "$hypr_display" && -S "$XDG_RUNTIME_DIR/$hypr_display" ]]; then export WAYLAND_DISPLAY="$XDG_RUNTIME_DIR/$hypr_display"; break; fi
                sleep 0.2
            done
            export HYPRLAND_INSTANCE_SIGNATURE="$(basename "$(dirname "$XDG_RUNTIME_DIR"/hypr/*/.socket.sock)")"
            hyprctl output create headless USAGESTAT-LAB > /out/output-setup.log
            hyprctl monitors -j > /out/monitors.json
        fi
        dbus-update-activation-environment WAYLAND_DISPLAY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE
        if [[ "$target" == cosmic ]]; then
            mkdir -p "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel/v1" "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel.Panel/v1"
            printf '%s' '["Panel"]' > "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel/v1/entries"
            # Keep the default clock so an initially empty tray cannot collapse
            # the whole panel to one pixel before the first item registers.
            printf '%s' 'Some(["com.system76.CosmicAppletTime"])' > "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel.Panel/v1/plugins_center"
            printf '%s' 'Some(([],["com.system76.CosmicAppletStatusArea"]))' > "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel.Panel/v1/plugins_wings"
            printf '%s' '0' > "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel.Panel/v1/padding_overlap"
            printf '%s' 'false' > "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel.Panel/v1/keep_style_on_maximize"
            dunst > /out/notifications.log 2>&1 &
            cosmic-panel > /out/panel.log 2>&1 &
        elif [[ "$target" == budgie ]]; then
            gsettings set com.solus-project.budgie-panel panels "['00000000-0000-0000-0000-000000000001']"
            gsettings set 'com.solus-project.budgie-panel.panel:/com/solus-project/budgie-panel/panels/{00000000-0000-0000-0000-000000000001}/' location top
            gsettings set 'com.solus-project.budgie-panel.panel:/com/solus-project/budgie-panel/panels/{00000000-0000-0000-0000-000000000001}/' applets "['00000000-0000-0000-0000-000000000002']"
            gsettings set 'com.solus-project.budgie-panel.applet:/com/solus-project/budgie-panel/applets/{00000000-0000-0000-0000-000000000002}/' name 'System Tray'
            budgie-panel > /out/panel.log 2>&1 &
            sleep 1
            dconf dump /com/solus-project/budgie-panel/ > /out/panel-settings.txt
        else
        python3 - <<'PY'
import json
from pathlib import Path
p=json.loads(Path('/src/platforms/waybar/config.jsonc').read_text())
p.update({'layer':'top', 'height':36, 'modules-left':['custom/usagestat']})
Path('/tmp/waybar.json').write_text(json.dumps(p))
PY
        waybar -c /tmp/waybar.json -s /src/platforms/waybar/style.css > /out/panel.log 2>&1 &
        fi
        ;;
    *) echo "Unknown target: $target" >&2; exit 2 ;;
esac
usagestat-bar service > /out/app.log 2>&1 &
app_pid=$!
trap 'kill "$app_pid" 2>/dev/null || true' EXIT
result=0
python3 /src/tests/linux/desktop-check.py "$target" || result=$?
if [[ "${USAGESTAT_LAB_HOLD:-0}" != 0 ]]; then sleep "$USAGESTAT_LAB_HOLD"; fi
exit "$result"
