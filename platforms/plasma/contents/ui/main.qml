import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import QtQuick.Window
import org.kde.kirigami as Kirigami
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.workspace.dbus as DBus
import org.kde.plasma.plasma5support as Plasma5Support

PlasmoidItem {
    id: root
    property var snapshot: ({providers: [], panel: [], active: "", loading: true})
    property string failure: "Starting UsageStat…"
    property string launcher: "usagestat-bar" // Set to the absolute installed launcher by install.py.
    property bool starting: false
    property real wheelRemainder: 0
    property double lastWheel: 0
    readonly property bool vertical: Plasmoid.formFactor === PlasmaCore.Types.Vertical
    readonly property bool lightPanel: Kirigami.Theme.textColor.hslLightness < 0.5
    readonly property real popupAlignment: ({left: 0, center: 0.5, right: 1})[snapshot.popupAlignment || "center"] ?? 0.5
    readonly property var representationWindow: fullRepresentationItem ? fullRepresentationItem.Window.window : null
    readonly property var popupWindow: representationWindow && representationWindow.visualParent !== undefined ? representationWindow : null
    readonly property var activeProvider: snapshot.providers.find(p => p.key === snapshot.active) || null
    readonly property var sections: activeProvider
        ? [activeProvider].concat(snapshot.providers.filter(p => p.parent === snapshot.active)) : []
    Plasmoid.backgroundHints: PlasmaCore.Types.DefaultBackground
    preferredRepresentation: compactRepresentation
    toolTipMainText: "UsageStat Bar"
    toolTipSubText: snapshot.providers.filter(p => !p.parent).map(p => p.name + ": " + (p.error || p.text)).join("\n") || failure

    function quote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'" }

    function acceptSnapshot(value) {
        if (!value) return
        try {
            const next = JSON.parse(value)
            if (next.revision < (snapshot.revision || 0)) return
            snapshot = next
            failure = ""
            const providers = next.providers.filter(p => !p.parent)
            const changed = providers.length !== providerTabs.count || providers.some((p, i) => providerTabs.get(i).key !== p.key)
            if (changed) providerTabs.clear()
            providers.forEach((p, i) => {
                const tab = {key: p.key, name: p.name, summary: p.text, error: !!p.error,
                    percent: p.percent || 0, loading: !!p.loading, statusColor: p.statusColor || "#33d17a",
                    meterColor: p.color, logo: p.logo || "", logoLight: p.logoLight || ""}
                if (changed) providerTabs.append(tab)
                else providerTabs.set(i, tab)
            })
        } catch (error) { failure = "Could not read UsageStat: " + error }
    }

    function call(member, signature, args, success) {
        DBus.SessionBus.asyncCall({service: "io.github.HashimK.UsageStatBar",
            path: "/io/github/HashimK/UsageStatBar", iface: "io.github.HashimK.UsageStatBar1",
            member: member, signature: signature || "()", arguments: args || []},
            reply => { if (success) success(reply.value) },
            reply => {
                failure = reply.error.message
                if (!service.registered && !starting) {
                    starting = true
                    bootstrap.connectSource(quote(launcher) + " snapshot")
                }
            })
    }

    function switchFromWheel(event, popup) {
        const enabled = snapshot.interaction && (popup ? snapshot.interaction.popupScroll : snapshot.interaction.panelScroll)
        if (!enabled) { event.accepted = false; return }
        const angle = event.angleDelta.y || event.angleDelta.x
        const delta = angle || (event.pixelDelta.y || event.pixelDelta.x) * 4
        if (!delta) { event.accepted = false; return }
        const now = Date.now()
        if (now - lastWheel > 250 || delta * wheelRemainder < 0) wheelRemainder = 0
        lastWheel = now
        wheelRemainder += delta
        const steps = Math.min(3, Math.floor(Math.abs(wheelRemainder) / 120))
        if (steps) {
            const direction = wheelRemainder > 0 ? -1 : 1
            wheelRemainder += direction * steps * 120
            for (let i = 0; i < steps; i++) call(popup ? "Cycle" : "Scroll", "(i)", [new DBus.int32(direction)])
        }
        event.accepted = true
    }

    ListModel { id: providerTabs }
    DBus.Properties {
        id: live
        busType: DBus.BusType.Session
        service: "io.github.HashimK.UsageStatBar"
        path: "/io/github/HashimK/UsageStatBar"
        iface: "io.github.HashimK.UsageStatBar1"
        onPropertiesChanged: (_interface, changed, _invalidated) => {
            if (changed.Snapshot !== undefined) root.acceptSnapshot(changed.Snapshot)
        }
        onRefreshed: root.acceptSnapshot(properties.Snapshot)
    }
    DBus.DBusServiceWatcher {
        id: service
        busType: DBus.BusType.Session
        watchedService: "io.github.HashimK.UsageStatBar"
        onRegisteredChanged: {
            if (registered) { live.updateAll(); root.call("GetSnapshot", "()", [], root.acceptSnapshot) }
            else {
                root.snapshot = {providers: [], panel: [], active: "", loading: true}
                root.failure = "UsageStat is restarting…"
                root.starting = false
                root.call("GetSnapshot", "()", [], root.acceptSnapshot)
            }
        }
    }
    // Only a missing service needs the installed launcher. Interaction and
    // updates use D-Bus directly, without shell processes or polling.
    Plasma5Support.DataSource {
        id: bootstrap
        engine: "executable"
        onNewData: (source, data) => {
            disconnectSource(source)
            root.starting = false
            if (data["exit code"] === 0) root.acceptSnapshot(data.stdout)
            else root.failure = data.stderr || "Could not start UsageStat Bar."
        }
    }
    Component.onCompleted: call("GetSnapshot", "()", [], acceptSnapshot)

    // Plasma centers its native popup on visualParent. Offset that invisible
    // anchor to implement the same indicator alignment as GNOME on either axis.
    Binding {
        target: root.popupWindow
        property: "visualParent"
        value: root.compactRepresentationItem ? root.compactRepresentationItem.popupAnchor : null
        when: root.expanded && root.popupWindow !== null && root.compactRepresentationItem !== null
        restoreMode: Binding.RestoreBindingOrValue
    }

    compactRepresentation: MouseArea {
        property alias popupAnchor: popupAnchor
        Item {
            id: popupAnchor
            width: parent.width
            height: parent.height
            x: !root.vertical && root.popupWindow ? (root.popupWindow.width - width) * (0.5 - root.popupAlignment) : 0
            y: root.vertical && root.popupWindow ? (root.popupWindow.height - height) * (0.5 - root.popupAlignment) : 0
            function reposition() {
                if (root.expanded && root.popupWindow && typeof root.popupWindow.queuePositionUpdate === "function") {
                    root.popupWindow.queuePositionUpdate()
                    root.popupWindow.update()
                }
            }
            onXChanged: reposition()
            onYChanged: reposition()
        }
        implicitWidth: root.vertical ? 40 : (root.snapshot.panelWidth || 160)
        implicitHeight: root.vertical ? (root.snapshot.panelVerticalHeight || 80) * width / (root.snapshot.panelVerticalWidth || 40) : 28
        Layout.minimumWidth: implicitWidth
        Layout.minimumHeight: root.vertical ? implicitHeight : 20
        acceptedButtons: Qt.LeftButton | Qt.RightButton | Qt.MiddleButton
        activeFocusOnTab: true
        Accessible.name: root.toolTipMainText + ". " + root.toolTipSubText
        Accessible.role: Accessible.Button
        onClicked: mouse => {
            if (mouse.button === Qt.RightButton) root.call("Preferences", "(s)", [""])
            else if (mouse.button === Qt.MiddleButton) root.call("Refresh")
            else root.expanded = !root.expanded
        }
        onWheel: wheel => root.switchFromWheel(wheel, false)
        Keys.onReturnPressed: root.expanded = !root.expanded
        Keys.onSpacePressed: root.expanded = !root.expanded
        Image {
            anchors.centerIn: parent
            width: parent.width
            height: parent.height
            source: root.snapshot.panelImagePng ? "file://" + (root.vertical
                ? root.lightPanel ? root.snapshot.panelImageVerticalLightPng : root.snapshot.panelImageVerticalPng
                : root.lightPanel ? root.snapshot.panelImageLightPng : root.snapshot.panelImagePng)
                + "?v=" + root.snapshot.panelImageKey : ""
            fillMode: Image.PreserveAspectFit
            visible: !root.failure
        }
        PlasmaComponents.Label { anchors.centerIn: parent; text: "UsageStat"; visible: !!root.failure }
    }

    fullRepresentation: PlasmaComponents.Page {
        id: popup
        Layout.minimumWidth: 360
        Layout.minimumHeight: 280
        Layout.preferredWidth: 440
        Layout.preferredHeight: Math.min(650, Math.max(280,
            Math.ceil(popupLayout.implicitHeight + topPadding + bottomPadding)))
        padding: 12
        // Plasma supplies the popup's rounded frame and shadow.
        background: null
        Keys.onEscapePressed: root.expanded = false
        WheelHandler { target: null; onWheel: event => root.switchFromWheel(event, true) }
        ColumnLayout {
            id: popupLayout
            anchors.fill: parent
            spacing: 10
            RowLayout {
                id: popupHeader
                spacing: 4
                PlasmaComponents.Label { text: "UsageStat Bar"; font.pixelSize: 14; font.weight: Font.Bold; Layout.fillWidth: true }
                PlasmaComponents.ToolButton {
                    icon.name: "view-refresh"
                    icon.width: 16
                    icon.height: 16
                    enabled: !root.snapshot.loading
                    Accessible.name: "Refresh usage"
                    PlasmaComponents.ToolTip.text: "Refresh usage"
                    PlasmaComponents.ToolTip.visible: hovered
                    onClicked: root.call("Refresh")
                }
                PlasmaComponents.ToolButton {
                    icon.name: "document-edit"
                    icon.width: 16
                    icon.height: 16
                    Accessible.name: "Edit current provider"
                    PlasmaComponents.ToolTip.text: "Edit current provider"
                    PlasmaComponents.ToolTip.visible: hovered
                    onClicked: { root.call("Preferences", "(s)", [root.snapshot.active]); root.expanded = false }
                }
                PlasmaComponents.ToolButton {
                    icon.name: "configure"
                    icon.width: 16
                    icon.height: 16
                    Accessible.name: "Preferences"
                    PlasmaComponents.ToolTip.text: "Preferences"
                    PlasmaComponents.ToolTip.visible: hovered
                    onClicked: { root.call("Preferences", "(s)", [""]); root.expanded = false }
                }
            }
            PlasmaComponents.Label {
                text: root.failure
                textFormat: Text.PlainText
                visible: !!text
                wrapMode: Text.Wrap
                Layout.fillWidth: true
            }
            PlasmaComponents.TabBar {
                id: tabs
                Layout.fillWidth: true
                visible: providerTabs.count > 0
                spacing: 4
                currentIndex: Math.max(0, root.snapshot.providers.filter(p => !p.parent).findIndex(p => p.key === root.snapshot.active))
                Repeater {
                    model: providerTabs
                    delegate: PlasmaComponents.TabButton {
                        id: providerTab
                        required property string key
                        required property string name
                        required property string summary
                        required property bool error
                        required property real percent
                        required property bool loading
                        required property string statusColor
                        required property string meterColor
                        required property string logo
                        required property string logoLight
                        readonly property bool active: key === root.snapshot.active
                        width: 76
                        implicitHeight: 72
                        topPadding: 7
                        bottomPadding: 6
                        leftPadding: 4
                        rightPadding: 4
                        Accessible.name: name + ", " + (error ? "Error" : summary)
                        Accessible.selected: active
                        PlasmaComponents.ToolTip.text: name + ": " + (error ? "Error" : summary)
                        PlasmaComponents.ToolTip.visible: hovered
                        onClicked: root.call("Select", "(s)", [key])
                        background: Rectangle {
                            radius: 10
                            color: providerTab.active ? "#2f7df6" : providerTab.hovered
                                ? Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.08) : "transparent"
                            border.width: providerTab.visualFocus ? 1 : 0
                            border.color: Kirigami.Theme.highlightColor
                        }
                        contentItem: ColumnLayout {
                            spacing: 3
                            Image {
                                Layout.alignment: Qt.AlignHCenter
                                source: "file://" + (!providerTab.active && root.lightPanel ? providerTab.logoLight : providerTab.logo)
                                sourceSize: Qt.size(22, 22)
                                Layout.preferredWidth: 22
                                Layout.preferredHeight: 22
                                opacity: providerTab.active ? 1 : 0.72
                            }
                            PlasmaComponents.Label {
                                text: providerTab.name
                                textFormat: Text.PlainText
                                color: providerTab.active ? "white" : Kirigami.Theme.textColor
                                elide: Text.ElideRight
                                horizontalAlignment: Text.AlignHCenter
                                Layout.fillWidth: true
                                font.pixelSize: 12
                                font.weight: Font.DemiBold
                            }
                            Rectangle {
                                Layout.fillWidth: true
                                implicitHeight: 5
                                radius: 3
                                color: providerTab.active ? "#40ffffff"
                                    : Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.16)
                                Rectangle {
                                    height: parent.height
                                    width: providerTab.loading ? 18 : parent.width * (providerTab.error ? 100 : providerTab.percent) / 100
                                    radius: 3
                                    color: providerTab.error ? "#ff5f57" : providerTab.meterColor
                                }
                            }
                            Rectangle {
                                Layout.alignment: Qt.AlignHCenter
                                implicitWidth: 6
                                implicitHeight: 6
                                radius: 3
                                color: providerTab.statusColor
                            }
                        }
                    }
                }
            }
            PlasmaComponents.ScrollView {
                id: providerScroll
                Layout.fillWidth: true
                Layout.fillHeight: true
                contentWidth: availableWidth
                contentHeight: providerContent.implicitHeight
                QQC2.ScrollBar.horizontal.policy: QQC2.ScrollBar.AlwaysOff
                QQC2.ScrollBar.vertical.policy: QQC2.ScrollBar.AsNeeded
                clip: true
                Flickable {
                    id: providerViewport
                    contentWidth: width
                    contentHeight: providerContent.implicitHeight
                    flickableDirection: Flickable.VerticalFlick
                    boundsBehavior: Flickable.StopAtBounds
                    ColumnLayout {
                        id: providerContent
                        width: providerViewport.width
                        spacing: 16
                        Repeater {
                            model: root.sections
                            delegate: ProviderPage {
                                required property var modelData
                                Layout.fillWidth: true
                                provider: modelData
                                updatedAt: root.snapshot.updatedAt || ""
                                refreshing: root.snapshot.loading
                                onConfigure: key => { root.call("Preferences", "(s)", [key]); root.expanded = false }
                            }
                        }
                        PlasmaComponents.Label {
                            visible: !root.activeProvider && !root.failure
                            text: "Enable a provider in Preferences to see your usage."
                            wrapMode: Text.Wrap
                            Layout.fillWidth: true
                        }
                    }
                }
            }
        }
    }
}
