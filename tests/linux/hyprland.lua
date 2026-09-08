-- Private desktop for manually reviewing the native Waybar integration.
hl.monitor({
    output = "",
    mode = os.getenv("USAGESTAT_LAB_SIZE") or "1500x900",
    position = "auto",
    scale = 1,
})

if os.getenv("USAGESTAT_LAB_WAYVNC_SOCKET") then
    -- Labwc supplies EGL/DMABUF; WayVNC captures USAGESTAT-LAB directly.
    -- Never attach a buffer to Aquamarine's unconfigured nested window.
    hl.monitor({ output = "WAYLAND-1", disabled = true })
end

hl.config({
    misc = {
        disable_hyprland_logo = true,
        disable_splash_rendering = true,
        background_color = "rgb(20242b)",
    },
    general = { border_size = 0, resize_on_border = true },
    decoration = { rounding = 12, blur = { enabled = false }, shadow = { enabled = false } },
    animations = { enabled = false },
    debug = { disable_logs = false, enable_stdout_logs = false },
})

hl.window_rule({
    match = { class = [[io\.github\.HashimK\.UsageStatBar]] },
    float = true,
})

-- Usage positions itself beside Waybar; preferences use a regular window.
hl.window_rule({
    match = { class = [[io\.github\.HashimK\.UsageStatBar]], title = "UsageStat Preferences" },
    center = true,
})

-- Mouse-accessible launchers also live in Waybar: host shortcuts may consume
-- Super while the review window is not grabbing the keyboard.
if os.getenv("USAGESTAT_LAB_INTERACTIVE") == "1" then
    hl.bind("SUPER + Return", hl.dsp.exec_cmd("foot"))
    hl.bind("SUPER + R", hl.dsp.exec_cmd("wofi --show drun"))
    hl.bind("SUPER + E", hl.dsp.exec_cmd("thunar"))
    hl.bind("SUPER + Q", hl.dsp.window.close())
    hl.bind("SUPER + V", hl.dsp.window.float({ action = "toggle" }))
    hl.bind("SUPER + mouse:272", hl.dsp.window.drag(), { mouse = true })
    hl.bind("SUPER + mouse:273", hl.dsp.window.resize(), { mouse = true })
    for i = 1, 4 do
        hl.bind("SUPER + " .. i, hl.dsp.focus({ workspace = i }))
        hl.bind("SUPER + SHIFT + " .. i, hl.dsp.window.move({ workspace = i }))
    end
end
