// Native LXQt panel geometry; the service retains the shared popup and settings.
#include <ilxqtpanelplugin.h>
#include <QApplication>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QDBusServiceWatcher>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QMouseEvent>
#include <QScreen>
#include <QTimer>
#include <QWheelEvent>
#include <QWindow>
#include <cmath>

static const QString busName = QStringLiteral("io.github.HashimK.UsageStatBar");
static const QString objectPath = QStringLiteral("/io/github/HashimK/UsageStatBar");
static void call(const QString &method, const QVariantList &args = {}) {
    auto message = QDBusMessage::createMethodCall(busName, objectPath, busName + "1", method);
    message.setArguments(args);
    QDBusConnection::sessionBus().asyncCall(message);
}

class UsageStat final : public QLabel, public ILXQtPanelPlugin {
    Q_OBJECT
public:
    explicit UsageStat(const ILXQtPanelPluginStartupInfo &info) : QLabel(), ILXQtPanelPlugin(info) {
        setAlignment(Qt::AlignCenter);
        setContentsMargins(4, 2, 4, 2);
        setAccessibleName("UsageStat");
        setText("UsageStat");
        QDBusConnection::sessionBus().connect(busName, objectPath, busName + "1", "Changed", this, SLOT(snapshot(QString)));
        auto *watcher = new QDBusServiceWatcher(busName, QDBusConnection::sessionBus(),
            QDBusServiceWatcher::WatchForOwnerChange, this);
        connect(watcher, &QDBusServiceWatcher::serviceOwnerChanged, this,
            [this](const QString &, const QString &, const QString &owner) {
                if (!owner.isEmpty()) { lastAnchor.clear(); call("RequestSnapshot"); publishAnchor(); }
            });
        QTimer::singleShot(0, this, [] { call("RequestSnapshot"); });
    }
    QWidget *widget() override { return this; }
    QString themeId() const override { return "UsageStat"; }
    void realign() override { render(); publishAnchor(); }
public slots:
    void snapshot(const QString &value) {
        const auto document = QJsonDocument::fromJson(value.toUtf8());
        if (!document.isObject()) return;
        state = document.object();
        render();
        publishAnchor();
    }
protected:
    void resizeEvent(QResizeEvent *event) override { QLabel::resizeEvent(event); publishAnchor(); }
    void moveEvent(QMoveEvent *event) override { QLabel::moveEvent(event); publishAnchor(); }
    void showEvent(QShowEvent *event) override { QLabel::showEvent(event); publishAnchor(); }
    void changeEvent(QEvent *event) override {
        QLabel::changeEvent(event);
        if (event->type() == QEvent::PaletteChange) render();
    }
    void mouseReleaseEvent(QMouseEvent *event) override {
        if (!rect().contains(event->position().toPoint())) return;
        if (event->button() == Qt::LeftButton) call("ToggleDetailsAt", {"", anchor()});
        else if (event->button() == Qt::MiddleButton) call("Refresh");
        else QLabel::mouseReleaseEvent(event);
    }
    void wheelEvent(QWheelEvent *event) override {
        if (!state.value("interaction").toObject().value("panelScroll").toBool(true)) { event->ignore(); return; }
        const int delta = event->angleDelta().y() ? event->angleDelta().y() : event->angleDelta().x();
        if (delta) call("Scroll", {delta > 0 ? -1 : 1});
        event->accept();
    }
private:
    QJsonObject state;
    QString lastAnchor;
    void publishAnchor() {
        QTimer::singleShot(0, this, [this] {
            if (!isVisible() || !window()->windowHandle()) return;
            const QString current = anchor();
            if (current != lastAnchor) { lastAnchor = current; call("UpdateAnchor", {current}); }
        });
    }
    void render() {
        if (state.isEmpty()) return;
        const bool vertical = !panel()->isHorizontal();
        const bool light = palette().color(QPalette::WindowText).lightnessF() < .5;
        const QString key = vertical ? (light ? "panelImageVerticalLightPng" : "panelImageVerticalPng")
            : (light ? "panelImageLightPng" : "panelImagePng");
        QPixmap pixels(state.value(key).toString());
        if (pixels.isNull()) return;
        const qreal scale = devicePixelRatioF();
        const int size = std::max(12, std::min(panel()->iconSize(), vertical ? 40 : 28));
        pixels = vertical ? pixels.scaledToWidth(std::round(size * scale), Qt::SmoothTransformation)
            : pixels.scaledToHeight(std::round(size * scale), Qt::SmoothTransformation);
        pixels.setDevicePixelRatio(scale);
        setPixmap(pixels);
        updateGeometry();
    }
    QString anchor() const {
        // globalGeometry comes from LXQt's live panel layout. Widget offsets
        // are local to that panel, so this works without Wayland global queries.
        const auto *top = window();
        QRect section(panel()->globalGeometry().topLeft() + mapTo(top, QPoint()), size());
        auto *output = top->windowHandle() ? top->windowHandle()->screen() : screen();
        QRect screenRect = output->geometry(), work = output->availableGeometry();
        const auto panelRect = panel()->globalGeometry();
        QString edge;
        switch (panel()->position()) {
            case ILXQtPanel::PositionTop: edge = "top"; work.setTop(std::max(work.top(), panelRect.bottom() + 1)); break;
            case ILXQtPanel::PositionBottom: edge = "bottom"; work.setBottom(std::min(work.bottom(), panelRect.top() - 1)); break;
            case ILXQtPanel::PositionLeft: edge = "left"; work.setLeft(std::max(work.left(), panelRect.right() + 1)); break;
            case ILXQtPanel::PositionRight: edge = "right"; work.setRight(std::min(work.right(), panelRect.left() - 1)); break;
        }
        const bool x11 = QGuiApplication::platformName() == "xcb";
        const qreal scale = x11 ? output->devicePixelRatio() : 1;
        const auto jsonRect = [scale](const QRect &r) { return QJsonObject{{"x", std::round(r.x()*scale)},
            {"y", std::round(r.y()*scale)}, {"w", std::round(r.width()*scale)}, {"h", std::round(r.height()*scale)}}; };
        return QString::fromUtf8(QJsonDocument(QJsonObject{{"edge", edge}, {"rect", jsonRect(section)},
            {"work", jsonRect(work)}, {"screen", jsonRect(screenRect)}, {"output", output->name()},
            {"units", x11 ? "physical" : "logical"}}).toJson(QJsonDocument::Compact));
    }
};

class UsageStatPlugin final : public QObject, public ILXQtPanelPluginLibrary {
    Q_OBJECT
    Q_PLUGIN_METADATA(IID "lxqt.org/Panel/PluginInterface/3.0")
    Q_INTERFACES(ILXQtPanelPluginLibrary)
public:
    ILXQtPanelPlugin *instance(const ILXQtPanelPluginStartupInfo &info) const override { return new UsageStat(info); }
};
#include "plugin.moc"
