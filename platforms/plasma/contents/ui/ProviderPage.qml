import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents

ColumnLayout {
    id: page
    required property var provider
    property string updatedAt: ""
    property bool refreshing: false
    signal configure(string key)
    spacing: 11

    function updatedText() {
        if (refreshing) return "Refreshing…"
        if (!updatedAt) return "Waiting for usage…"
        const minutes = Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000))
        return minutes < 1 ? "Updated just now" : minutes < 60 ? "Updated " + minutes + "m ago"
            : "Updated " + Math.floor(minutes / 60) + "h ago"
    }

    Rectangle {
        visible: !!page.provider.parent
        Layout.fillWidth: true
        implicitHeight: 1
        color: Kirigami.Theme.textColor
        opacity: 0.12
    }
    RowLayout {
        spacing: 6
        Rectangle { width: 9; height: 9; radius: 5; color: page.provider.statusColor || "#33d17a" }
        PlasmaComponents.Label {
            text: page.provider.name
            textFormat: Text.PlainText
            font.pixelSize: 15
            font.weight: Font.Bold
            elide: Text.ElideRight
            Layout.maximumWidth: 160
        }
        Repeater {
            model: [page.provider.plan, page.provider.source].filter(Boolean)
            delegate: Rectangle {
                required property string modelData
                implicitWidth: chipText.implicitWidth + 8
                implicitHeight: 17
                radius: 4
                color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.09)
                PlasmaComponents.Label {
                    id: chipText
                    anchors.centerIn: parent
                    text: modelData
                    textFormat: Text.PlainText
                    font.pixelSize: 11
                    font.weight: Font.DemiBold
                    opacity: 0.8
                }
            }
        }
        Item { Layout.fillWidth: true }
        PlasmaComponents.ToolButton {
            visible: !!page.provider.dashboardUrl
            icon.name: "view-statistics"
            icon.width: 16
            icon.height: 16
            Accessible.name: "Usage dashboard"
            PlasmaComponents.ToolTip.text: "Usage dashboard"
            PlasmaComponents.ToolTip.visible: hovered
            onClicked: Qt.openUrlExternally(page.provider.dashboardUrl)
        }
        PlasmaComponents.ToolButton {
            visible: !!page.provider.statusUrl
            icon.name: "network-connect"
            icon.width: 16
            icon.height: 16
            Accessible.name: "Service status"
            PlasmaComponents.ToolTip.text: "Service status"
            PlasmaComponents.ToolTip.visible: hovered
            onClicked: Qt.openUrlExternally(page.provider.statusUrl)
        }
        PlasmaComponents.ToolButton {
            visible: !!page.provider.parent
            icon.name: "document-edit"
            icon.width: 16
            icon.height: 16
            Accessible.name: "Edit " + page.provider.name
            onClicked: page.configure(page.provider.key)
        }
    }
    PlasmaComponents.Label {
        visible: !page.provider.parent
        text: page.updatedText()
        font.pixelSize: 12
        opacity: 0.65
    }
    Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: Kirigami.Theme.textColor; opacity: 0.12 }
    PlasmaComponents.Label {
        text: page.provider.serviceStatus && !["none", "unknown"].includes(page.provider.serviceStatus.indicator)
            ? page.provider.serviceStatus.description || "" : ""
        textFormat: Text.PlainText
        visible: !!text
        color: Kirigami.Theme.neutralTextColor
        wrapMode: Text.Wrap
        Layout.fillWidth: true
    }
    PlasmaComponents.Label {
        text: page.provider.error || ""
        textFormat: Text.PlainText
        visible: !!text
        color: Kirigami.Theme.negativeTextColor
        wrapMode: Text.Wrap
        Layout.fillWidth: true
    }
    PlasmaComponents.BusyIndicator { visible: page.provider.loading; running: visible; Layout.alignment: Qt.AlignHCenter }
    Repeater {
        model: page.provider.error ? [] : page.provider.windows
        delegate: ColumnLayout {
            required property var modelData
            Layout.fillWidth: true
            spacing: 7
            PlasmaComponents.Label {
                text: modelData.label
                textFormat: Text.PlainText
                font.pixelSize: 14
                font.weight: Font.Bold
                Layout.fillWidth: true
            }
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: 7
                radius: 4
                color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.12)
                Accessible.role: Accessible.ProgressBar
                Accessible.name: modelData.label + ", " + modelData.text
                Rectangle { height: parent.height; width: parent.width * modelData.percent / 100; radius: parent.radius; color: modelData.color }
            }
            RowLayout {
                PlasmaComponents.Label { text: modelData.text; textFormat: Text.PlainText; font.pixelSize: 12; font.weight: Font.Bold; Layout.fillWidth: true }
                PlasmaComponents.Label { text: modelData.reset || ""; textFormat: Text.PlainText; font.pixelSize: 12; opacity: 0.65 }
            }
            PlasmaComponents.Label {
                text: modelData.quantityText || ""
                textFormat: Text.PlainText
                visible: !!text
                font.pixelSize: 12
                opacity: 0.65
            }
            Item { implicitHeight: 4 }
        }
    }
    PlasmaComponents.Label {
        visible: !page.provider.error && !page.provider.loading && !page.provider.windows.length
        text: "No quota windows reported"
        font.pixelSize: 12
        opacity: 0.65
    }
    PlasmaComponents.Label {
        visible: !page.provider.error && !!page.provider.pace
        text: page.provider.pace && page.provider.pace.stage ? "Pace: " + page.provider.pace.stage.replace(/_/g, " ") : ""
        textFormat: Text.PlainText
        font.pixelSize: 12
        wrapMode: Text.Wrap
        Layout.fillWidth: true
    }
    Repeater {
        model: page.provider.error ? [] : (page.provider.badges || []).concat(page.provider.lines || [])
        delegate: PlasmaComponents.Label {
            required property var modelData
            text: [modelData.label, modelData.value || modelData.text].filter(Boolean).join(": ")
            textFormat: Text.PlainText
            font.pixelSize: 12
            font.weight: Font.DemiBold
            wrapMode: Text.Wrap
            Layout.fillWidth: true
        }
    }
    ColumnLayout {
        visible: !page.provider.error && !!page.provider.cost && page.provider.cost.lines.length > 0
        Layout.fillWidth: true
        spacing: 7
        PlasmaComponents.Label { text: "Cost"; font.pixelSize: 14; font.weight: Font.Bold }
        Repeater {
            model: !page.provider.error && page.provider.cost ? page.provider.cost.lines : []
            delegate: RowLayout {
                required property var modelData
                Layout.fillWidth: true
                spacing: 12
                PlasmaComponents.Label {
                    text: modelData.label
                    textFormat: Text.PlainText
                    font.pixelSize: 12
                    opacity: 0.65
                    Layout.fillWidth: true
                }
                PlasmaComponents.Label {
                    text: modelData.moneyText + " · " + modelData.tokensText
                    textFormat: Text.PlainText
                    font.pixelSize: 12
                    font.weight: Font.DemiBold
                }
            }
        }
    }
    PlasmaComponents.Label {
        visible: !page.provider.error && page.provider.credits !== null
        text: "Credits: " + page.provider.credits + " left"
        font.pixelSize: 12
        font.weight: Font.DemiBold
    }
    PlasmaComponents.Label {
        visible: !page.provider.error && page.provider.codeReview !== null
        text: "Code review: " + Math.round(page.provider.codeReview) + "% left"
        font.pixelSize: 12
        font.weight: Font.DemiBold
    }
}
