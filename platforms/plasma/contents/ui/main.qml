import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import org.kde.kirigami as Kirigami
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasma5support as Plasma5Support

PlasmoidItem {
    id: root
    property var snapshot: ({providers: [], panel: [], active: "", loading: true})
    property string failure: "Starting UsageStat…"
    readonly property bool vertical: Plasmoid.formFactor === PlasmaCore.Types.Vertical
    Plasmoid.backgroundHints: PlasmaCore.Types.DefaultBackground
    preferredRepresentation: compactRepresentation
    toolTipMainText: "UsageStat Bar"
    toolTipSubText: snapshot.providers.filter(p => !p.parent).map(p => p.name + ": " + (p.error || p.text)).join("\n") || failure

    function quote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'" }
    function action(command) { actions.connectSource("usagestat-bar " + command) }

    Plasma5Support.DataSource {
        id: poll
        engine: "executable"
        connectedSources: ["usagestat-bar snapshot"]
        interval: 2000
        onNewData: (source, data) => {
            if (data["exit code"] !== 0) {
                root.failure = data.stderr || "Install UsageStat Bar and ensure usagestat-bar is on PATH."
                return
            }
            try { root.snapshot = JSON.parse(data.stdout); root.failure = "" }
            catch (error) { root.failure = "Could not read UsageStat: " + error }
        }
    }
    Plasma5Support.DataSource {
        id: actions
        engine: "executable"
        onNewData: (source, data) => disconnectSource(source)
    }

    compactRepresentation: MouseArea {
        implicitWidth: root.vertical ? 32 : (root.snapshot.panelWidth || 160)
        implicitHeight: root.vertical ? (root.snapshot.panelWidth || 160) : 28
        Layout.minimumWidth: implicitWidth
        Layout.minimumHeight: root.vertical ? implicitHeight : 20
        acceptedButtons: Qt.LeftButton | Qt.RightButton | Qt.MiddleButton
        activeFocusOnTab: true
        Accessible.name: root.toolTipMainText + ". " + root.toolTipSubText
        Accessible.role: Accessible.Button
        onClicked: mouse => {
            if (mouse.button === Qt.RightButton) root.action("preferences")
            else if (mouse.button === Qt.MiddleButton) root.action("refresh")
            else root.expanded = !root.expanded
        }
        onWheel: wheel => root.action(wheel.angleDelta.y > 0 ? "previous" : "next")
        Keys.onReturnPressed: root.expanded = !root.expanded
        Keys.onSpacePressed: root.expanded = !root.expanded
        Image {
            anchors.centerIn: parent
            width: root.vertical ? parent.height : parent.width
            height: root.vertical ? parent.width : parent.height
            rotation: root.vertical ? 90 : 0
            source: root.snapshot.panelImage ? "file://" + (Kirigami.Theme.textColor.hslLightness < 0.5 ? root.snapshot.panelImageLight : root.snapshot.panelImage) + "?v=" + root.snapshot.revision : ""
            cache: false
            fillMode: Image.PreserveAspectFit
            visible: !root.failure
        }
        Label { anchors.centerIn: parent; text: "UsageStat"; visible: !!root.failure }
    }

    fullRepresentation: ColumnLayout {
        Layout.minimumWidth: 360
        Layout.minimumHeight: 240
        Layout.preferredWidth: 460
        Layout.preferredHeight: 580
        spacing: 10
        Label { text: "UsageStat Bar"; font.bold: true; font.pixelSize: 20; Layout.margins: 8 }
        Label { text: root.failure; visible: !!text; wrapMode: Text.Wrap; Layout.fillWidth: true }
        RowLayout {
            Button { text: "Refresh"; enabled: !root.snapshot.loading; onClicked: root.action("refresh") }
            Button { text: "Details"; onClicked: root.action("details") }
            Button { text: "Preferences"; onClicked: root.action("preferences") }
        }
        ScrollView {
            id: providerScroll
            Layout.fillWidth: true
            Layout.fillHeight: true
            contentWidth: availableWidth
            clip: true
            ColumnLayout {
                width: providerScroll.availableWidth
                Repeater {
                    model: root.snapshot.providers
                    delegate: Frame {
                        required property var modelData
                        Layout.fillWidth: true
                        ColumnLayout {
                            anchors.fill: parent
                            RowLayout {
                                Label { text: modelData.name; font.bold: true; Layout.fillWidth: true }
                                Button { text: "Edit"; onClicked: root.action("preferences " + root.quote(modelData.key)) }
                            }
                            Label { text: modelData.error || modelData.text; wrapMode: Text.Wrap; Layout.fillWidth: true }
                            Repeater {
                                model: modelData.error ? [] : modelData.windows
                                delegate: ColumnLayout {
                                    required property var modelData
                                    Layout.fillWidth: true
                                    Label { text: modelData.label + " · " + modelData.text }
                                    ProgressBar { value: modelData.percent / 100; Layout.fillWidth: true }
                                    Label { text: modelData.reset; visible: !!text; font.pixelSize: 11; wrapMode: Text.Wrap; Layout.fillWidth: true }
                                }
                            }
                            Button { text: "Select provider"; visible: !modelData.parent; onClicked: root.action("select " + root.quote(modelData.key)) }
                        }
                    }
                }
            }
        }
    }
}
