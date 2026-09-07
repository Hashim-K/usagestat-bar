/* Native GTK3 panel content shared by the Xfce and Waybar adapters. */
#include "widget.h"
#include <json-glib/json-glib.h>

#define BUS "io.github.HashimK.UsageStatBar"
#define OBJECT "/io/github/HashimK/UsageStatBar"
#define IFACE BUS "1"

struct UsageStatWidget {
    GtkWidget *button, *image;
    GDBusConnection *bus;
    guint subscription, watch;
    int height;
    gboolean vertical;
    gboolean scroll_enabled;
    double scroll_amount;
    gint64 scroll_time;
    char *dark_path, *light_path;
};

static void call(UsageStatWidget *self, const char *method, GVariant *args) {
    if (self->bus)
        g_dbus_connection_call(self->bus, BUS, OBJECT, IFACE, method, args, NULL,
                               G_DBUS_CALL_FLAGS_NONE, 3000, NULL, NULL, NULL);
}

static void render(UsageStatWidget *self) {
    GdkRGBA foreground;
    gtk_style_context_get_color(gtk_widget_get_style_context(self->button), GTK_STATE_FLAG_NORMAL, &foreground);
    gboolean light = foreground.red + foreground.green + foreground.blue < 1.5;
    const char *path = light ? self->light_path : self->dark_path;
    if (!path) return;
    int scale = gtk_widget_get_scale_factor(self->image);
    GError *error = NULL;
    GdkPixbuf *pixels = gdk_pixbuf_new_from_file_at_scale(path, -1, self->height * scale, TRUE, &error);
    if (!pixels) {
        gtk_widget_set_tooltip_text(self->button, error->message);
        g_clear_error(&error);
        return;
    }
    if (self->vertical) {
        GdkPixbuf *rotated = gdk_pixbuf_rotate_simple(pixels, GDK_PIXBUF_ROTATE_CLOCKWISE);
        g_object_unref(pixels);
        pixels = rotated;
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

static void appeared(GDBusConnection *bus, const char *name, const char *owner, gpointer data) {
    call(data, "RequestSnapshot", NULL);
}

static void vanished(GDBusConnection *bus, const char *name, gpointer data) {
    UsageStatWidget *self = data;
    gtk_image_set_from_icon_name(GTK_IMAGE(self->image), "dialog-warning-symbolic", GTK_ICON_SIZE_MENU);
    gtk_widget_set_tooltip_text(self->button, "UsageStat is stopped. Click to start and open usage.");
}

static void clicked(GtkButton *button, gpointer data) { call(data, "ToggleDetails", g_variant_new("(s)", "")); }
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
    g_signal_connect(self->button, "button-press-event", G_CALLBACK(press), self);
    g_signal_connect(self->button, "scroll-event", G_CALLBACK(scroll), self);
    g_signal_connect(self->button, "style-updated", G_CALLBACK(style), self);
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
    if (self->watch) g_bus_unwatch_name(self->watch);
    if (self->subscription) g_dbus_connection_signal_unsubscribe(self->bus, self->subscription);
    g_signal_handlers_disconnect_by_data(self->button, self);
    g_signal_handlers_disconnect_by_data(self->image, self);
    g_clear_object(&self->bus);
    g_free(self->dark_path); g_free(self->light_path); g_free(self);
}
