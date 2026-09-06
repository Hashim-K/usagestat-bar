export const BUS = 'io.github.HashimK.UsageStatBar';
export const OBJECT = '/io/github/HashimK/UsageStatBar';
export const INTERFACE = 'io.github.HashimK.UsageStatBar1';
export const XML = `<node><interface name="${INTERFACE}">
  <method name="GetSnapshot"><arg type="s" direction="out"/></method>
  <method name="Refresh"/>
  <method name="Select"><arg name="provider" type="s" direction="in"/></method>
  <method name="Cycle"><arg name="direction" type="i" direction="in"/></method>
  <method name="Details"><arg name="provider" type="s" direction="in"/></method>
  <method name="Preferences"><arg name="provider" type="s" direction="in"/></method>
  <method name="EnableTray"/>
  <method name="Quit"/>
  <signal name="Changed"><arg name="snapshot" type="s"/></signal>
</interface></node>`;
