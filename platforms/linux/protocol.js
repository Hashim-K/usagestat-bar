export const BUS = 'io.github.HashimK.UsageStatBar';
export const OBJECT = '/io/github/HashimK/UsageStatBar';
export const INTERFACE = 'io.github.HashimK.UsageStatBar1';
export const XML = `<node><interface name="${INTERFACE}">
  <property name="Snapshot" type="s" access="read"/>
  <method name="GetSnapshot"><arg type="s" direction="out"/></method>
  <method name="RequestSnapshot"/>
  <method name="Refresh"/>
  <method name="Select"><arg name="provider" type="s" direction="in"/></method>
  <method name="Cycle"><arg name="direction" type="i" direction="in"/></method>
  <method name="Scroll"><arg name="direction" type="i" direction="in"/></method>
  <method name="Details"><arg name="provider" type="s" direction="in"/></method>
  <method name="ToggleDetails"><arg name="provider" type="s" direction="in"/></method>
  <method name="ToggleDetailsAt"><arg name="provider" type="s" direction="in"/><arg name="anchor" type="s" direction="in"/></method>
  <method name="RegisterPopup"><arg name="object" type="o" direction="in"/></method>
  <method name="UpdateAnchor"><arg name="anchor" type="s" direction="in"/></method>
  <method name="Preferences"><arg name="provider" type="s" direction="in"/></method>
  <method name="EnableTray"/>
  <method name="Quit"/>
  <signal name="Changed"><arg name="snapshot" type="s"/></signal>
</interface></node>`;
