import {ExtensionPreferences, gettext} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {fillPreferencesWindow} from './preferences.js';

export default class AIUsageBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        fillPreferencesWindow(window, this.getSettings(), {gettext});
    }
}
