#pragma once
#include <gtk/gtk.h>

typedef struct UsageStatWidget UsageStatWidget;
UsageStatWidget *usagestat_widget_new(GtkContainer *container, int height, gboolean vertical);
void usagestat_widget_size(UsageStatWidget *widget, int height, gboolean vertical);
void usagestat_widget_free(UsageStatWidget *widget);
