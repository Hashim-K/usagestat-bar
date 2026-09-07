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
