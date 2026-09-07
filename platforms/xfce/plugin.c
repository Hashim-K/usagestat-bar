#include <libxfce4panel/libxfce4panel.h>
#include "../gtk-panel/widget.h"

static gboolean size_changed(XfcePanelPlugin *plugin, gint size, gpointer data) {
    usagestat_widget_size(data, MAX(16, size - 6), xfce_panel_plugin_get_orientation(plugin) == GTK_ORIENTATION_VERTICAL);
    return TRUE;
}
static void orientation_changed(XfcePanelPlugin *plugin, GtkOrientation orientation, gpointer data) {
    size_changed(plugin, xfce_panel_plugin_get_size(plugin), data);
}
static void free_data(XfcePanelPlugin *plugin, gpointer data) { usagestat_widget_free(data); }
static void construct(XfcePanelPlugin *plugin) {
    UsageStatWidget *widget = usagestat_widget_new(GTK_CONTAINER(plugin), MAX(16, xfce_panel_plugin_get_size(plugin) - 6),
        xfce_panel_plugin_get_orientation(plugin) == GTK_ORIENTATION_VERTICAL);
    g_signal_connect(plugin, "size-changed", G_CALLBACK(size_changed), widget);
    g_signal_connect(plugin, "orientation-changed", G_CALLBACK(orientation_changed), widget);
    g_signal_connect(plugin, "free-data", G_CALLBACK(free_data), widget);
    gtk_widget_show(GTK_WIDGET(plugin));
}
XFCE_PANEL_PLUGIN_REGISTER(construct)
