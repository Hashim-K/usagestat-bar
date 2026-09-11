/* Native GTK3 panel content shared by the Xfce and Waybar adapters. */
#include "widget.h"
#include <json-glib/json-glib.h>
#include <gmodule.h>
#ifdef GDK_WINDOWING_X11
#include <gdk/gdkx.h>
#endif

/* Waybar already loads GTK3 Layer Shell. Resolve it optionally so the Xfce
 * plugin keeps working on systems without that library. */
static gboolean (*layer_window)(GtkWindow *);
static GdkMonitor *(*layer_monitor)(GtkWindow *);
static gboolean (*layer_anchor)(GtkWindow *, int);
static int (*layer_margin)(GtkWindow *, int);
enum { EDGE_LEFT, EDGE_RIGHT, EDGE_TOP, EDGE_BOTTOM };

static void load_layer_api(void) {
    static gboolean loaded;
    if (loaded) return;
    loaded = TRUE;
    GModule *module = g_module_open(NULL, G_MODULE_BIND_LAZY);
    if (!module) return;
    if (!g_module_symbol(module, "gtk_layer_is_layer_window", (gpointer *)&layer_window)
        || !g_module_symbol(module, "gtk_layer_get_monitor", (gpointer *)&layer_monitor)
        || !g_module_symbol(module, "gtk_layer_get_anchor", (gpointer *)&layer_anchor)
        || !g_module_symbol(module, "gtk_layer_get_margin", (gpointer *)&layer_margin)) layer_window = NULL;
    g_module_close(module);
}

#define BUS "io.github.HashimK.UsageStatBar"
#define OBJECT "/io/github/HashimK/UsageStatBar"
#define IFACE BUS "1"

struct UsageStatWidget {
    GtkWidget *button, *image;
    GDBusConnection *bus;
    guint subscription, watch, anchor_idle;
    char *last_anchor;
    int height;
    gboolean vertical;
    gboolean scroll_enabled;
    double scroll_amount;
    gint64 scroll_time;
    char *dark_path, *light_path, *dark_vertical_path, *light_vertical_path;
};

static void call(UsageStatWidget *self, const char *method, GVariant *args) {
    if (self->bus)
        g_dbus_connection_call(self->bus, BUS, OBJECT, IFACE, method, args, NULL,
                               G_DBUS_CALL_FLAGS_NONE, 3000, NULL, NULL, NULL);
}

static void render(UsageStatWidget *self) {
    GtkWidget *top = gtk_widget_get_toplevel(self->button);
    if (GTK_IS_WINDOW(top) && layer_window && layer_window(GTK_WINDOW(top))) {
        // Read the live panel orientation, including changes made outside our
        // preferences. A side panel anchors to both top and bottom.
        // Some hosts (Budgie) centre a side panel with only LEFT/RIGHT
        // anchored. Its allocated shape is authoritative for both hosts.
        int width = gtk_widget_get_allocated_width(top), height = gtk_widget_get_allocated_height(top);
        if (width > 1 && height > 1) self->vertical = height > width;
    }
    GdkRGBA foreground;
    gtk_style_context_get_color(gtk_widget_get_style_context(self->button), GTK_STATE_FLAG_NORMAL, &foreground);
    gboolean light = foreground.red + foreground.green + foreground.blue < 1.5;
    const char *path = self->vertical ? (light ? self->light_vertical_path : self->dark_vertical_path)
        : (light ? self->light_path : self->dark_path);
    if (!path) return;
    int scale = gtk_widget_get_scale_factor(self->image);
    int size = MIN(self->height, self->vertical ? 40 : 28);
    GError *error = NULL;
    GdkPixbuf *pixels = gdk_pixbuf_new_from_file_at_scale(path, self->vertical ? size * scale : -1,
        self->vertical ? -1 : size * scale, TRUE, &error);
    if (!pixels) {
        gtk_widget_set_tooltip_text(self->button, error->message);
        g_clear_error(&error);
        return;
    }
    cairo_surface_t *surface = gdk_cairo_surface_create_from_pixbuf(pixels, scale, NULL);
    gtk_image_set_from_surface(GTK_IMAGE(self->image), surface);
    cairo_surface_destroy(surface);
    g_object_unref(pixels);
}

static void changed(GDBusConnection *bus, const char *sender, const char *path,
                    const char *interface, const char *signal, GVariant *parameters, gpointer data) {
    UsageStatWidget *self = data;
    const char *text;
    g_variant_get(parameters, "(&s)", &text);
    JsonParser *parser = json_parser_new();
    if (json_parser_load_from_data(parser, text, -1, NULL)) {
        JsonNode *root = json_parser_get_root(parser);
        if (JSON_NODE_HOLDS_OBJECT(root)) {
            JsonObject *state = json_node_get_object(root);
            JsonObject *interaction = json_object_has_member(state, "interaction") ? json_object_get_object_member(state, "interaction") : NULL;
            self->scroll_enabled = !interaction || !json_object_has_member(interaction, "panelScroll")
                || json_object_get_boolean_member(interaction, "panelScroll");
            if (json_object_has_member(state, "panelImage") && json_object_has_member(state, "panelImageLight")) {
                g_free(self->dark_path); g_free(self->light_path);
                self->dark_path = g_strdup(json_object_get_string_member(state, json_object_has_member(state, "panelImagePng") ? "panelImagePng" : "panelImage"));
                self->light_path = g_strdup(json_object_get_string_member(state, json_object_has_member(state, "panelImageLightPng") ? "panelImageLightPng" : "panelImageLight"));
                g_free(self->dark_vertical_path); g_free(self->light_vertical_path);
                self->dark_vertical_path = g_strdup(json_object_has_member(state, "panelImageVerticalPng") ? json_object_get_string_member(state, "panelImageVerticalPng") : self->dark_path);
                self->light_vertical_path = g_strdup(json_object_has_member(state, "panelImageVerticalLightPng") ? json_object_get_string_member(state, "panelImageVerticalLightPng") : self->light_path);
                GString *tooltip = g_string_new("UsageStat");
                JsonArray *providers = json_object_get_array_member(state, "providers");
                for (guint i = 0; providers && i < json_array_get_length(providers); i++) {
                    JsonObject *provider = json_array_get_object_element(providers, i);
                    const char *error = json_object_get_string_member(provider, "error");
                    g_string_append_printf(tooltip, "\n%s: %s", json_object_get_string_member(provider, "name"),
                        error && *error ? error : json_object_get_string_member(provider, "text"));
                }
                gtk_widget_set_tooltip_text(self->button, tooltip->str);
                atk_object_set_name(gtk_widget_get_accessible(self->button), tooltip->str);
                g_string_free(tooltip, TRUE);
                render(self);
            }
        }
    }
    g_object_unref(parser);
}

static void queue_anchor(UsageStatWidget *self);

static void appeared(GDBusConnection *bus, const char *name, const char *owner, gpointer data) {
    UsageStatWidget *self = data;
    g_clear_pointer(&self->last_anchor, g_free);
    queue_anchor(self);
    call(data, "RequestSnapshot", NULL);
}

static void vanished(GDBusConnection *bus, const char *name, gpointer data) {
    UsageStatWidget *self = data;
    gtk_image_set_from_icon_name(GTK_IMAGE(self->image), "dialog-warning-symbolic", GTK_ICON_SIZE_MENU);
    gtk_widget_set_tooltip_text(self->button, "UsageStat is stopped. Click to start and open usage.");
}

static void send_anchor(UsageStatWidget *self, gboolean toggle) {
    GtkWidget *button = self->button;
    if (!gtk_widget_get_mapped(button)) return;
    GtkWidget *top = gtk_widget_get_toplevel(GTK_WIDGET(button));
    GdkWindow *window = gtk_widget_get_window(top);
    int x = 0, y = 0, dx = 0, dy = 0, scale = 1;
    if (!window || !gtk_widget_translate_coordinates(GTK_WIDGET(button), top, 0, 0, &dx, &dy)) {
        if (toggle) call(self, "ToggleDetails", g_variant_new("(s)", ""));
        return;
    }
    GdkMonitor *monitor = gdk_display_get_monitor_at_window(gdk_window_get_display(window), window);
    gboolean layered = GTK_IS_WINDOW(top) && layer_window && layer_window(GTK_WINDOW(top));
    if (layered && layer_monitor(GTK_WINDOW(top))) monitor = layer_monitor(GTK_WINDOW(top));
    if (!monitor) { if (toggle) call(self, "ToggleDetails", g_variant_new("(s)", "")); return; }
    GdkRectangle screen, work;
    gdk_monitor_get_geometry(monitor, &screen);
    gdk_monitor_get_workarea(monitor, &work);
    if (layered) {
        GtkWindow *win = GTK_WINDOW(top);
        int width = gtk_widget_get_allocated_width(top), height = gtk_widget_get_allocated_height(top);
        x = screen.x + (layer_anchor(win, EDGE_LEFT) ? layer_margin(win, EDGE_LEFT)
            : layer_anchor(win, EDGE_RIGHT) ? screen.width - width - layer_margin(win, EDGE_RIGHT) : (screen.width - width) / 2);
        y = screen.y + (layer_anchor(win, EDGE_TOP) ? layer_margin(win, EDGE_TOP)
            : layer_anchor(win, EDGE_BOTTOM) ? screen.height - height - layer_margin(win, EDGE_BOTTOM) : (screen.height - height) / 2);
        work = screen;
        if (self->vertical) {
            if (x < screen.x + screen.width / 2) { work.x = x + width; work.width = screen.x + screen.width - work.x; }
            else work.width = x - screen.x;
        } else {
            if (y < screen.y + screen.height / 2) { work.y = y + height; work.height = screen.y + screen.height - work.y; }
            else work.height = y - screen.y;
        }
    } else {
#ifdef GDK_WINDOWING_X11
        if (!GDK_IS_X11_WINDOW(window)) { if (toggle) call(self, "ToggleDetails", g_variant_new("(s)", "")); return; }
#endif
        gdk_window_get_origin(window, &x, &y);
        scale = gtk_widget_get_scale_factor(top);
    }
    const char *edge = self->vertical ? (x < screen.x + screen.width / 2 ? "left" : "right")
        : (y < screen.y + screen.height / 2 ? "top" : "bottom");
    char *anchor = g_strdup_printf("{\"edge\":\"%s\",\"units\":\"%s\","
        "\"rect\":{\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d},"
        "\"work\":{\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d},"
        "\"screen\":{\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d}}", edge, layered ? "logical" : "physical",
        (x + dx) * scale, (y + dy) * scale, gtk_widget_get_allocated_width(GTK_WIDGET(button)) * scale,
        gtk_widget_get_allocated_height(GTK_WIDGET(button)) * scale,
        work.x * scale, work.y * scale, work.width * scale, work.height * scale,
        screen.x * scale, screen.y * scale, screen.width * scale, screen.height * scale);
    if (toggle) call(self, "ToggleDetailsAt", g_variant_new("(ss)", "", anchor));
    else if (g_strcmp0(anchor, self->last_anchor)) {
        g_free(self->last_anchor); self->last_anchor = g_strdup(anchor);
        call(self, "UpdateAnchor", g_variant_new("(s)", anchor));
    }
    g_free(anchor);
}
static void clicked(GtkButton *button, gpointer data) { send_anchor(data, TRUE); }
static gboolean update_anchor(gpointer data) {
    UsageStatWidget *self = data; self->anchor_idle = 0;
    send_anchor(self, FALSE); return G_SOURCE_REMOVE;
}
static void queue_anchor(UsageStatWidget *self) {
    if (!self->anchor_idle) self->anchor_idle = g_idle_add(update_anchor, self);
}
static void allocated(GtkWidget *widget, GtkAllocation *allocation, gpointer data) { queue_anchor(data); }
static gboolean press(GtkWidget *widget, GdkEventButton *event, gpointer data) {
    if (event->button == 2) { call(data, "Refresh", NULL); return TRUE; }
    if (event->button == 3) { call(data, "Preferences", g_variant_new("(s)", "")); return TRUE; }
    return FALSE;
}
static gboolean scroll(GtkWidget *widget, GdkEventScroll *event, gpointer data) {
    UsageStatWidget *self = data;
    if (!self->scroll_enabled) return FALSE;
    if (event->direction == GDK_SCROLL_SMOOTH) {
        double dx = 0, dy = 0;
        if (!gdk_event_get_scroll_deltas((GdkEvent *)event, &dx, &dy)) return FALSE;
        double delta = ABS(dy) >= ABS(dx) ? dy : dx;
        gint64 now = g_get_monotonic_time();
        if (now - self->scroll_time > 250000 || delta * self->scroll_amount < 0) self->scroll_amount = 0;
        self->scroll_time = now;
        self->scroll_amount += delta;
        if (ABS(self->scroll_amount) >= 1) {
            call(self, "Scroll", g_variant_new("(i)", self->scroll_amount > 0 ? 1 : -1));
            self->scroll_amount = 0;
        }
        return TRUE;
    }
    if (event->direction == GDK_SCROLL_UP || event->direction == GDK_SCROLL_DOWN
        || event->direction == GDK_SCROLL_LEFT || event->direction == GDK_SCROLL_RIGHT) {
        self->scroll_amount = 0;
        call(self, "Scroll", g_variant_new("(i)", event->direction == GDK_SCROLL_DOWN || event->direction == GDK_SCROLL_RIGHT ? 1 : -1));
        return TRUE;
    }
    return FALSE;
}
static void style(GtkWidget *widget, gpointer data) { render(data); }
static void scale(GtkWidget *widget, GParamSpec *spec, gpointer data) { render(data); }

UsageStatWidget *usagestat_widget_new(GtkContainer *container, int height, gboolean vertical) {
    load_layer_api();
    UsageStatWidget *self = g_new0(UsageStatWidget, 1);
    self->height = CLAMP(height, 16, 96); self->vertical = vertical;
    self->scroll_enabled = TRUE;
    self->button = gtk_button_new(); self->image = gtk_image_new_from_icon_name("view-refresh-symbolic", GTK_ICON_SIZE_MENU);
    gtk_button_set_relief(GTK_BUTTON(self->button), GTK_RELIEF_NONE);
    gtk_widget_set_name(self->button, "usagestat-panel");
    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css,
        "#usagestat-panel { padding: 0 4px; border: none; box-shadow: none; background: transparent; color: inherit; }"
        "#usagestat-panel:hover { background: alpha(currentColor, 0.08); border-radius: 6px; }", -1, NULL);
    gtk_style_context_add_provider(gtk_widget_get_style_context(self->button), GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_object_unref(css);
    gtk_widget_set_can_focus(self->button, TRUE);
    gtk_widget_add_events(self->button, GDK_SCROLL_MASK | GDK_SMOOTH_SCROLL_MASK);
    gtk_container_add(GTK_CONTAINER(self->button), self->image);
    gtk_container_add(container, self->button);
    g_signal_connect(self->button, "clicked", G_CALLBACK(clicked), self);
    g_signal_connect(self->button, "size-allocate", G_CALLBACK(allocated), self);
    g_signal_connect(self->button, "button-press-event", G_CALLBACK(press), self);
    g_signal_connect(self->button, "scroll-event", G_CALLBACK(scroll), self);
    g_signal_connect(self->button, "style-updated", G_CALLBACK(style), self);
    g_signal_connect(self->button, "map", G_CALLBACK(style), self);
    g_signal_connect(self->image, "notify::scale-factor", G_CALLBACK(scale), self);
    self->bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, NULL);
    if (self->bus) {
        self->subscription = g_dbus_connection_signal_subscribe(self->bus, BUS, IFACE, "Changed", OBJECT,
                                                               NULL, G_DBUS_SIGNAL_FLAGS_NONE, changed, self, NULL);
        self->watch = g_bus_watch_name_on_connection(self->bus, BUS, G_BUS_NAME_WATCHER_FLAGS_AUTO_START,
                                                     appeared, vanished, self, NULL);
    }
    gtk_widget_show_all(self->button);
    return self;
}

void usagestat_widget_size(UsageStatWidget *self, int height, gboolean vertical) {
    self->height = CLAMP(height, 16, 96); self->vertical = vertical; render(self);
}
void usagestat_widget_free(UsageStatWidget *self) {
    if (!self) return;
    if (self->anchor_idle) g_source_remove(self->anchor_idle);
    g_free(self->last_anchor);
    if (self->watch) g_bus_unwatch_name(self->watch);
    if (self->subscription) g_dbus_connection_signal_unsubscribe(self->bus, self->subscription);
    g_signal_handlers_disconnect_by_data(self->button, self);
    g_signal_handlers_disconnect_by_data(self->image, self);
    g_clear_object(&self->bus);
    g_free(self->dark_path); g_free(self->light_path);
    g_free(self->dark_vertical_path); g_free(self->light_vertical_path); g_free(self);
}
