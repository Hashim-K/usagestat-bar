#include "../gtk-panel/widget.h"
#include <json-glib/json-glib.h>

/* Waybar's documented CFFI v2 ABI, verified with Waybar 0.15.0.
 * https://github.com/Alexays/Waybar/tree/0.15.0/resources/custom_modules/cffi_example */
typedef struct wbcffi_module wbcffi_module;
typedef struct {
    wbcffi_module *obj;
    const char *waybar_version;
    GtkContainer *(*get_root_widget)(wbcffi_module *);
    void (*queue_update)(wbcffi_module *);
} wbcffi_init_info;
typedef struct { const char *key, *value; } wbcffi_config_entry;
const size_t wbcffi_version = 2;

void *wbcffi_init(const wbcffi_init_info *info, const wbcffi_config_entry *entries, size_t length) {
    int height = 28;
    gboolean vertical = FALSE;
    for (size_t i = 0; i < length; i++) {
        if (g_str_equal(entries[i].key, "height")) height = atoi(entries[i].value);
        if (g_str_equal(entries[i].key, "vertical")) vertical = g_str_has_prefix(entries[i].value, "true");
    }
    return usagestat_widget_new(info->get_root_widget(info->obj), height, vertical);
}
void wbcffi_deinit(void *instance) { usagestat_widget_free(instance); }
