import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Tray} from '../../platforms/linux/tray.js';
import {settings, TRAY_SCHEMA_ID} from '../../platforms/linux/settings.js';

// An independent native tray application, to check that UsageStat's slot
// replacement leaves other applications registered.
Adw.init();
const config = settings(TRAY_SCHEMA_ID);
config.set_string('provider-mode', 'active');
config.set_string('icon-style', 'logo');
const tray = new Tray(config, {}, () => {});
tray.update({revision: 0, active: 'companion', providers: [{key: 'companion', name: 'Other tray application',
    iconId: 'github', percent: 100, text: 'Native tray companion', windows: []}]});
const item = tray.items.get('active');
item.Id = 'usagestat-review-companion';
Gio.File.new_for_path('/out/companion-bus.txt').replace_contents(item.connection.get_unique_name(), null,
    false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
new GLib.MainLoop(null, false).run();
