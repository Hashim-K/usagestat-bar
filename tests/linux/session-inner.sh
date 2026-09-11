#!/usr/bin/env bash
set -euo pipefail
target="$1"
desktop_size="${USAGESTAT_LAB_SIZE:-1500x900}"
# COSMIC's nested backend starts at 1280x800. Capture the parent X11 display
# at that size: resizing/screencopy in the software EGL backend is unreliable.
if [[ "$target" == cosmic ]]; then desktop_size=1280x800; fi
direct_wayland=0
if [[ "$target" == hyprland && -n "${USAGESTAT_LAB_WAYVNC_SOCKET:-}" ]]; then
    direct_wayland=1
    unset DISPLAY XAUTHORITY
elif [[ -n "${USAGESTAT_LAB_DISPLAY:-}" ]]; then
    export DISPLAY="$USAGESTAT_LAB_DISPLAY"
else
    x11_size=1600x1000
    if [[ "$target" == cosmic ]]; then x11_size="$desktop_size"; fi
    Xvfb :99 -screen 0 "${x11_size}x24" -nolisten tcp -ac > /out/display.log 2>&1 &
    export DISPLAY=:99
fi
export XDG_SESSION_TYPE=x11 GSK_RENDERER=cairo
if [[ "$direct_wayland" == 1 ]]; then
    export GSK_RENDERER=gl
    mkdir -p "$XDG_CONFIG_HOME/gtk-4.0"
    printf '%s\n' '[Settings]' 'gtk-enable-animations=false' > "$XDG_CONFIG_HOME/gtk-4.0/settings.ini"
fi
unset WAYLAND_DISPLAY
dbus-update-activation-environment XDG_SESSION_TYPE GSK_RENDERER XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_RUNTIME_DIR PATH GSETTINGS_SCHEMA_DIR USAGESTAT_CLI GTK_A11Y NO_AT_BRIDGE
if [[ "$direct_wayland" == 0 ]]; then dbus-update-activation-environment DISPLAY; fi
if [[ "${USAGESTAT_LAB_INTERACTIVE:-0}" == 1 ]]; then
    dbus-update-activation-environment USAGESTAT_BACKEND_SOCKET
    if [[ "$direct_wayland" == 0 ]]; then dbus-update-activation-environment XAUTHORITY; fi
else
    dbus-update-activation-environment USAGESTAT_FIXTURE_STATE USAGESTAT_FIXTURE_LOG
fi
if [[ "$direct_wayland" == 0 ]]; then
    for attempt in $(seq 1 50); do
        if xdotool getdisplaygeometry >/dev/null 2>&1; then break; fi
        sleep 0.1
    done
fi
gsettings set io.github.HashimK.UsageStatBar usagestat-cli-path "$USAGESTAT_CLI"
gsettings set io.github.HashimK.UsageStatBar refresh-interval "${USAGESTAT_LAB_INTERACTIVE:-0}"
gsettings set io.github.HashimK.UsageStatBar panel-bar-count 2
gsettings reset io.github.HashimK.UsageStatBar panel-components
wallpaper="$(python3 /src/tests/linux/background.py "$target")"
if [[ "${USAGESTAT_LAB_INTERACTIONS:-0}" == 1 ]]; then
    dbus-monitor "type='method_call',interface='io.github.HashimK.UsageStatBar1',member='ToggleDetailsAt'" \
        "type='method_call',interface='io.github.HashimK.UsageStatBar1',member='UpdateAnchor'" \
        > /out/section-anchor.log 2>&1 &
fi

case "$target" in
    plasma) export XDG_CURRENT_DESKTOP=KDE ;;
    cinnamon) export XDG_CURRENT_DESKTOP=X-Cinnamon XDG_SESSION_DESKTOP=cinnamon DESKTOP_SESSION=cinnamon ;;
    mate) export XDG_CURRENT_DESKTOP=MATE ;;
    xfce) export XDG_CURRENT_DESKTOP=XFCE ;;
    lxqt) export XDG_CURRENT_DESKTOP=LXQt ;;
    *) export XDG_CURRENT_DESKTOP="$target" ;;
esac
start_service() {
    dbus-update-activation-environment XDG_CURRENT_DESKTOP TZ
    usagestat-bar service > /out/app.log 2>&1 &
    app_pid=$!
    trap 'kill "$app_pid" 2>/dev/null || true' EXIT
    # Own the service before panels try D-Bus activation. Waiting on a second
    # short-lived GJS client would otherwise close the whole review session.
    gdbus wait --session --timeout 20 io.github.HashimK.UsageStatBar
    for attempt in $(seq 1 100); do
        if ! kill -0 "$app_pid" 2>/dev/null; then echo 'UsageStat exited during startup; see app.log.' >&2; return 1; fi
        if gdbus call --session --timeout 2 --dest io.github.HashimK.UsageStatBar \
            --object-path /io/github/HashimK/UsageStatBar --method io.github.HashimK.UsageStatBar1.GetSnapshot >/dev/null 2>&1; then return; fi
        sleep 0.1
    done
    echo 'UsageStat did not finish starting; see app.log.' >&2
    return 1
}
case "$target" in sway|budgie|cosmic|hyprland) ;; *) start_service ;; esac
case "$target" in
    lxqt)
        export XDG_CURRENT_DESKTOP=LXQt
        dunst -print > /out/notifications.log 2>&1 &
        openbox > /out/wm.log 2>&1 &
        mkdir -p "$XDG_CONFIG_HOME/lxqt"
        printf '%s\n' '[General]' 'theme=light' 'icon_theme=Adwaita' > "$XDG_CONFIG_HOME/lxqt/lxqt.conf"
        printf '%s\n' '[General]' 'panels=panel1' '__userfile__=true' '[panel1]' 'position=Top' 'plugins=usagestat,worldclock' 'desktop=0' 'lineCount=1' 'panelSize=38' 'iconSize=24' 'length=100' 'lengthInPercents=true' '[usagestat]' 'type=usagestat' '[worldclock]' 'type=worldclock' > "$XDG_CONFIG_HOME/lxqt/panel.conf"
        usagestat-lxqt-panel > /out/panel.log 2>&1 &
        ;;
    xfce)
        export XDG_CURRENT_DESKTOP=XFCE
        if [[ "${USAGESTAT_LAB_INTERACTIVE:-0}" == 1 ]]; then xfsettingsd > /out/settings.log 2>&1 & fi
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
        wallpaper_script="$(python3 -c 'import json,sys; print("desktops().forEach(d => { d.wallpaperPlugin = \"org.kde.image\"; d.currentConfigGroup = [\"Wallpaper\", \"org.kde.image\", \"General\"]; d.writeConfig(\"Image\", " + json.dumps("file://"+sys.argv[1]) + "); });")' "$wallpaper")"
        gdbus call --session --dest org.kde.plasmashell --object-path /PlasmaShell \
            --method org.kde.PlasmaShell.evaluateScript "$wallpaper_script" > /out/background.log
        ;;
    cinnamon)
        export XDG_CURRENT_DESKTOP=X-Cinnamon
        gsettings set org.cinnamon.desktop.input-sources sources "[('xkb', 'us')]"
        gsettings set org.cinnamon.desktop.background picture-uri "file://$wallpaper"
        gsettings set org.cinnamon.desktop.background picture-options zoom
        if [[ "${USAGESTAT_LAB_INTERACTIVE:-0}" == 1 ]]; then
            gsettings set org.cinnamon.desktop.default-applications.terminal exec gnome-terminal
            gsettings set org.cinnamon panels-enabled "['1:0:bottom']"
            gsettings set org.cinnamon enabled-applets "['panel1:left:0:menu@cinnamon.org:1', 'panel1:left:1:show-desktop@cinnamon.org:2', 'panel1:left:2:grouped-window-list@cinnamon.org:3', 'panel1:right:0:usagestat-bar@hashimkarim:0', 'panel1:right:1:workspace-switcher@cinnamon.org:4', 'panel1:right:2:systray@cinnamon.org:5', 'panel1:right:3:xapp-status@cinnamon.org:6', 'panel1:right:4:notifications@cinnamon.org:7', 'panel1:right:5:calendar@cinnamon.org:8']"
            gsettings set org.cinnamon next-applet-id 9
            gsettings set org.cinnamon.desktop.screensaver lock-enabled false
            gsettings set org.cinnamon.desktop.session idle-delay 0
            mkdir -p "$HOME/Desktop" "$HOME/Documents" "$HOME/Downloads" "$HOME/.config/autostart" "$XDG_CONFIG_HOME/autostart"
            cinnamon-session --session cinnamon > /out/panel.log 2>&1 &
            wm_pid=$!
            gdbus wait --session --timeout 30 org.Cinnamon
        else
            gsettings set org.cinnamon enabled-applets "['panel1:left:0:usagestat-bar@hashimkarim:0']"
            cinnamon --replace > /out/panel.log 2>&1 &
            # csd-background waits for SessionRunning, which this minimal
            # session does not emit. Paint the same configured image directly.
            feh --no-fehbg --bg-fill "$wallpaper" > /out/background.log 2>&1
        fi
        ;;
    mate)
        export XDG_CURRENT_DESKTOP=MATE
        gsettings set org.mate.background picture-filename "$wallpaper"
        gsettings set org.mate.background picture-options zoom
        if [[ "${USAGESTAT_LAB_INTERACTIVE:-0}" == 1 ]]; then /usr/libexec/mate-settings-daemon > /out/settings.log 2>&1 & fi
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
            printf '%s\n' 'font pango:DejaVu Sans 10' 'focus_follows_mouse no' \
                'for_window [class="io.github.HashimK.UsageStatBar"] floating enable' > /tmp/i3.conf
            i3 -c /tmp/i3.conf > /out/wm.log 2>&1 &
        else
            mkdir -p "$XDG_CONFIG_HOME/bspwm"
            printf '%s\n' '#!/bin/sh' 'bspc monitor -d Review' \
                'bspc rule -a io.github.HashimK.UsageStatBar state=floating' > "$XDG_CONFIG_HOME/bspwm/bspwmrc"
            chmod +x "$XDG_CONFIG_HOME/bspwm/bspwmrc"
            bspwm > /out/wm.log 2>&1 &
        fi
        cat > /tmp/polybar.ini <<'CONFIG'
[bar/baseline]
width = 100%
height = 34
background = #20242b
foreground = #e6edf3
font-0 = DejaVu Sans:size=11;2
font-1 = UsageStat Provider Icons:pixelsize=20;3
modules-left = usagestat
CONFIG
        cat /src/platforms/polybar/config.ini >> /tmp/polybar.ini
        if [[ "${USAGESTAT_LAB_INTERACTIONS:-0}" == 1 ]]; then
            printf '\nformat-background = #2f3e52\n' >> /tmp/polybar.ini
        fi
        usagestat-polybar -c /tmp/polybar.ini baseline > /out/panel.log 2>&1 &
        ;;
    sway|budgie|cosmic|hyprland)
        mkdir -p "$XDG_CONFIG_HOME/labwc"
        printf '%s\n' '#!/bin/sh' '# Background is set explicitly by this lab session.' > "$XDG_CONFIG_HOME/labwc/autostart"
        chmod +x "$XDG_CONFIG_HOME/labwc/autostart"
        export XDG_CURRENT_DESKTOP=sway WLR_BACKENDS=x11 WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1
        export XDG_SESSION_TYPE=wayland
        if [[ "$target" == cosmic ]]; then
            export XDG_CURRENT_DESKTOP=COSMIC USAGESTAT_LAB_INPUT=x11
            # COSMIC still owns every client, panel and layer surface. Only its
            # outer preview window/input travels through the private X server.
            # Avoid a second Wayland compositor and its DMABUF/resize failures.
            COSMIC_BACKEND=winit WINIT_UNIX_BACKEND=x11 XDG_SESSION_TYPE=x11 \
                cosmic-comp > /out/wm.log 2>&1 &
            wm_pid=$!
        elif [[ "$target" == sway ]]; then
            printf '%s\n' "output * resolution $desktop_size" 'seat * hide_cursor 5000' \
                'for_window [app_id="io.github.HashimK.UsageStatBar"] floating enable' > /tmp/sway.conf
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
            # A private parent provides EGL/DMABUF for the nested compositor.
            # Hyprland's manual preview streams its headless output directly;
            # its Aquamarine window can fail the parent's initial configure.
            parent_backend=headless
            if [[ "${USAGESTAT_LAB_INTERACTIVE:-0}" == 1 && "$direct_wayland" == 0 ]]; then parent_backend=x11; fi
            WLR_BACKENDS="$parent_backend" WLR_RENDERER=gles2 labwc > /out/parent-wm.log 2>&1 &
        fi
        for attempt in $(seq 1 100); do
            if [[ "$target" == cosmic ]] && ! kill -0 "$wm_pid" 2>/dev/null; then
                echo 'COSMIC compositor exited; see wm.log.' >&2; exit 1
            fi
            socket=("$XDG_RUNTIME_DIR"/wayland-*); if [[ -S "${socket[0]}" ]]; then export WAYLAND_DISPLAY="${socket[0]}"; break; fi
            sleep 0.2
        done
        if [[ "$target" == sway ]]; then
            export SWAYSOCK="$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -name 'sway-ipc.*.sock' -print -quit)"
        fi
        if [[ "$target" == cosmic ]]; then
            cosmic_window=''
            for attempt in $(seq 1 100); do
                kill -0 "$wm_pid" 2>/dev/null || { echo 'COSMIC compositor exited; see wm.log.' >&2; exit 1; }
                cosmic_window="$(xdotool search --onlyvisible --class '^cosmic-comp$' 2>/dev/null | head -1)" || true
                if [[ -n "$cosmic_window" ]]; then break; fi
                sleep 0.2
            done
            [[ -n "$cosmic_window" ]] || { echo 'COSMIC preview did not map; see wm.log.' >&2; exit 1; }
            xdotool windowmove "$cosmic_window" 0 0 windowfocus "$cosmic_window"
            xdotool getwindowgeometry --shell "$cosmic_window" > /out/preview-geometry.txt
            export GDK_BACKEND=wayland
        fi
        if [[ "$target" == hyprland ]]; then
            export XDG_CURRENT_DESKTOP=Hyprland
            start-hyprland -- --config /src/tests/linux/hyprland.lua > /out/wm.log 2>&1 &
            wm_pid=$!
            for attempt in $(seq 1 100); do
                hypr_display="$(hyprctl instances -j 2>/dev/null | python3 -c 'import json,sys; values=json.load(sys.stdin); print(values[-1]["wl_socket"] if values else "")' 2>/dev/null || true)"
                if [[ -n "$hypr_display" && -S "$XDG_RUNTIME_DIR/$hypr_display" ]]; then export WAYLAND_DISPLAY="$XDG_RUNTIME_DIR/$hypr_display"; break; fi
                sleep 0.2
            done
            export HYPRLAND_INSTANCE_SIGNATURE="$(basename "$(dirname "$XDG_RUNTIME_DIR"/hypr/*/.socket.sock)")"
            if [[ "${USAGESTAT_LAB_INTERACTIVE:-0}" != 1 || "$direct_wayland" == 1 ]]; then
                hyprctl output create headless USAGESTAT-LAB > /out/output-setup.log
            fi
            hyprctl monitors -j > /out/monitors.json
            if [[ "${USAGESTAT_LAB_INTERACTIVE:-0}" == 1 ]]; then
                dunst > /out/notifications.log 2>&1 &
            fi
        fi
        swaybg -i "$wallpaper" -m fill > /out/background.log 2>&1 &
        dbus-update-activation-environment WAYLAND_DISPLAY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE
        if [[ "$target" == hyprland ]]; then dbus-update-activation-environment HYPRLAND_INSTANCE_SIGNATURE; fi
        if [[ "$target" == cosmic ]]; then cosmic-settings-daemon > /out/settings.log 2>&1 & fi
        start_service
        if [[ "$target" == cosmic ]]; then
            if [[ "${USAGESTAT_LAB_INTERACTIONS:-0}" == 1 ]]; then
                # Paint only the real applet allocation, to measure it in
                # screenshots independently of the popup positioning code.
                mkdir -p "$XDG_CONFIG_HOME/gtk-4.0"
                printf '%s\n' '.usagestat-cosmic-button { background: #2f3e52; border-radius: 0; }' >> "$XDG_CONFIG_HOME/gtk-4.0/gtk.css"
            fi
            mkdir -p "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel/v1" "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel.Panel/v1"
            printf '%s' '["Panel"]' > "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel/v1/entries"
            # Keep the default clock so an initially empty tray cannot collapse
            # the whole panel to one pixel before the first item registers.
            printf '%s' 'Some(["com.system76.CosmicAppletTime"])' > "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel.Panel/v1/plugins_center"
            printf '%s' 'Some((["io.github.HashimK.UsageStatApplet"],["com.system76.CosmicAppletStatusArea"]))' > "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel.Panel/v1/plugins_wings"
            printf '%s' '0' > "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel.Panel/v1/padding_overlap"
            printf '%s' 'false' > "$XDG_CONFIG_HOME/cosmic/com.system76.CosmicPanel.Panel/v1/keep_style_on_maximize"
            dunst > /out/notifications.log 2>&1 &
            cosmic-panel > /out/panel.log 2>&1 &
        elif [[ "$target" == budgie ]]; then
            if [[ "${USAGESTAT_LAB_INTERACTIVE:-0}" == 1 ]]; then /usr/libexec/gsd-xsettings > /out/settings.log 2>&1 & fi
            gsettings set com.solus-project.budgie-panel panels "['00000000-0000-0000-0000-000000000001']"
            gsettings set 'com.solus-project.budgie-panel.panel:/com/solus-project/budgie-panel/panels/{00000000-0000-0000-0000-000000000001}/' location top
            gsettings set 'com.solus-project.budgie-panel.panel:/com/solus-project/budgie-panel/panels/{00000000-0000-0000-0000-000000000001}/' applets "['00000000-0000-0000-0000-000000000002']"
            gsettings set 'com.solus-project.budgie-panel.applet:/com/solus-project/budgie-panel/applets/{00000000-0000-0000-0000-000000000002}/' name 'UsageStat Bar'
            budgie-panel > /out/panel.log 2>&1 &
            sleep 1
            dconf dump /com/solus-project/budgie-panel/ > /out/panel-settings.txt
        else
        USAGESTAT_LAB_TARGET="$target" python3 - <<'PY'
import json, os
from pathlib import Path
p=json.loads(Path('/tmp/usagestat-prefix/share/usagestat-bar/platforms/waybar/native.jsonc').read_text())
p.update({'layer':'top', 'height':36, 'modules-left':['cffi/usagestat']})
if os.environ['USAGESTAT_LAB_TARGET'] == 'hyprland' and os.environ.get('USAGESTAT_LAB_INTERACTIVE') == '1':
    p.update({'modules-left': ['custom/apps', 'custom/terminal', 'custom/files', 'hyprland/workspaces'],
              'modules-right': ['cffi/usagestat', 'tray', 'clock'],
              'custom/apps': {'format': 'Apps', 'tooltip-format': 'Applications · Super+R', 'on-click': 'wofi --show drun'},
              'custom/terminal': {'format': 'Terminal', 'tooltip-format': 'Terminal · Super+Return', 'on-click': 'foot'},
              'custom/files': {'format': 'Files', 'tooltip-format': 'Files · Super+E', 'on-click': 'thunar'},
              'hyprland/workspaces': {'format': '{name}', 'persistent-workspaces': {'*': [1, 2, 3, 4]}},
              'clock': {'format': '{:%a %H:%M}', 'tooltip-format': '<big>{:%B %Y}</big>\n<tt>{calendar}</tt>'},
              'tray': {'spacing': 8}})
Path('/tmp/waybar.json').write_text(json.dumps(p))
PY
        cp /src/platforms/waybar/style.css /tmp/waybar.css
        if [[ "$target" == hyprland && "${USAGESTAT_LAB_INTERACTIVE:-0}" == 1 ]]; then
            cat >> /tmp/waybar.css <<'CSS'
#custom-apps, #custom-terminal, #custom-files, #clock, #tray { padding: 0 10px; }
#custom-apps:hover, #custom-terminal:hover, #custom-files:hover { background: alpha(currentColor, 0.1); border-radius: 6px; }
#workspaces button { padding: 0 8px; min-width: 20px; }
#workspaces button.active { background: alpha(currentColor, 0.15); border-radius: 6px; }
CSS
        fi
        waybar -c /tmp/waybar.json -s /tmp/waybar.css > /out/panel.log 2>&1 &
        if [[ "$target" == hyprland ]]; then
            # The startup usage window needs the panel's mapped geometry, just
            # as it does when the reviewer opens it by clicking the bar.
            panel_ready=0
            for attempt in $(seq 1 100); do
                if hyprctl layers -j | python3 -c 'import json,sys; data=json.load(sys.stdin); sys.exit(not any(layer.get("namespace") == "waybar" and layer.get("w", 0) > 0 and layer.get("h", 0) > 0 for output in data.values() for level in output["levels"].values() for layer in level))'; then
                    panel_ready=1; break
                fi
                sleep 0.1
            done
            if [[ "$panel_ready" != 1 ]]; then echo 'Waybar did not map; see panel.log.' >&2; exit 1; fi
        fi
        fi
        ;;
    *) echo "Unknown target: $target" >&2; exit 2 ;;
esac
case "$target" in
    mate|xfce|lxqt|i3|bspwm) feh --no-fehbg --bg-fill "$wallpaper" > /out/background.log 2>&1 ;;
esac
if [[ "${USAGESTAT_LAB_INTERACTIVE:-0}" == 1 ]]; then
    # Plasma has its own popup. Opening the separate GTK window on startup
    # presents two different surfaces before the reviewer even clicks the bar.
    usagestat-bar snapshot > /dev/null 2>> /out/app.log
    if [[ "$direct_wayland" == 1 ]]; then
        if ! command -v wayvnc >/dev/null; then
            echo 'Rebuild the Hyprland lab image to include WayVNC: bash tests/linux/build-lab.sh hyprland' >&2
            exit 1
        fi
        # Unix socket only: manual.py relays authenticated VNC over loopback.
        # The guest keeps --network none and never connects to the host desktop.
        wayvnc -C /display/wayvnc.conf -o USAGESTAT-LAB -g -f "${USAGESTAT_LAB_FPS:-60}" -Linfo -p \
            --unix-socket "$USAGESTAT_LAB_WAYVNC_SOCKET" > /out/display.log 2>&1 &
        display_pid=$!
        for attempt in $(seq 1 100); do
            kill -0 "$display_pid" 2>/dev/null || { echo 'WayVNC exited; see display.log.' >&2; exit 1; }
            if [[ -S "$USAGESTAT_LAB_WAYVNC_SOCKET" ]]; then break; fi
            sleep 0.1
        done
        [[ -S "$USAGESTAT_LAB_WAYVNC_SOCKET" ]] || { echo 'WayVNC did not open its socket; see display.log.' >&2; exit 1; }
        touch /out/interactive-ready
        wait -n "$app_pid" "$wm_pid" "$display_pid"
    else
        touch /out/interactive-ready
        if [[ "$target" == cinnamon ]]; then wait -n "$app_pid" "$wm_pid"; else wait "$app_pid"; fi
    fi
    exit $?
fi
result=0
if [[ "${USAGESTAT_LAB_INTERACTIONS:-0}" == 1 ]]; then
    python3 /src/tests/linux/interactions.py "$target" || result=$?
else
    python3 /src/tests/linux/desktop-check.py "$target" || result=$?
fi
if [[ "${USAGESTAT_LAB_HOLD:-0}" != 0 ]]; then sleep "$USAGESTAT_LAB_HOLD"; fi
exit "$result"
