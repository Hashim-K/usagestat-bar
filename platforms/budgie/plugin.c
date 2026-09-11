#include <plugin.h>
#include <libpeas.h>
#include "../gtk-panel/widget.h"

typedef struct { BudgieApplet parent; UsageStatWidget *widget; int size; gboolean vertical; } UsageStatApplet;
typedef BudgieAppletClass UsageStatAppletClass;
G_DEFINE_TYPE(UsageStatApplet, usage_stat_applet, BUDGIE_TYPE_APPLET)

static void size_changed(BudgieApplet *applet, int size, int icon_size, int small_icon_size) {
    UsageStatApplet *self = (UsageStatApplet *)applet;
    self->size = MAX(12, icon_size);
    usagestat_widget_size(self->widget, self->size, self->vertical);
}
static void position_changed(BudgieApplet *applet, BudgiePanelPosition position) {
    UsageStatApplet *self = (UsageStatApplet *)applet;
    self->vertical = position == BUDGIE_PANEL_POSITION_LEFT || position == BUDGIE_PANEL_POSITION_RIGHT;
    usagestat_widget_size(self->widget, self->size, self->vertical);
}
static void dispose(GObject *object) {
    UsageStatApplet *self = (UsageStatApplet *)object;
    if (self->widget) { usagestat_widget_free(self->widget); self->widget = NULL; }
    G_OBJECT_CLASS(usage_stat_applet_parent_class)->dispose(object);
}
static void usage_stat_applet_class_init(UsageStatAppletClass *klass) {
    klass->panel_size_changed = size_changed;
    klass->panel_position_changed = position_changed;
    G_OBJECT_CLASS(klass)->dispose = dispose;
}
static void usage_stat_applet_init(UsageStatApplet *self) {
    self->size = 28;
    self->widget = usagestat_widget_new(GTK_CONTAINER(self), self->size, FALSE);
    gtk_widget_show_all(GTK_WIDGET(self));
}

typedef GObject UsageStatPlugin;
typedef GObjectClass UsageStatPluginClass;
static void plugin_interface_init(BudgiePluginIface *iface);
G_DEFINE_DYNAMIC_TYPE_EXTENDED(UsageStatPlugin, usage_stat_plugin, G_TYPE_OBJECT, 0,
    G_IMPLEMENT_INTERFACE_DYNAMIC(BUDGIE_TYPE_PLUGIN, plugin_interface_init))
static BudgieApplet *get_widget(BudgiePlugin *plugin, gchar *uuid) {
    return g_object_new(usage_stat_applet_get_type(), NULL);
}
static void plugin_interface_init(BudgiePluginIface *iface) { iface->get_panel_widget = get_widget; }
static void usage_stat_plugin_init(UsageStatPlugin *self) {}
static void usage_stat_plugin_class_init(UsageStatPluginClass *klass) {}
static void usage_stat_plugin_class_finalize(UsageStatPluginClass *klass) {}
G_MODULE_EXPORT void peas_register_types(PeasObjectModule *module) {
    usage_stat_plugin_register_type(G_TYPE_MODULE(module));
    peas_object_module_register_extension_type(module, BUDGIE_TYPE_PLUGIN, usage_stat_plugin_get_type());
}
