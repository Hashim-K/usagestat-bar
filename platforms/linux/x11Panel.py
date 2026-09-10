#!/usr/bin/env python3
"""Place the app's own X11 popup beside its panel, including GTK shadow extents."""
import ctypes as C
import json
import math
import os
import shutil
import subprocess
import sys
import time


class ClientData(C.Union):
    _fields_ = [('b', C.c_char * 20), ('s', C.c_short * 10), ('l', C.c_long * 5)]


class ClientMessage(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int),
                ('display', C.c_void_p), ('window', C.c_ulong), ('message_type', C.c_ulong),
                ('format', C.c_int), ('data', ClientData)]


class Event(C.Union):
    _fields_ = [('client', ClientMessage), ('pad', C.c_long * 24)]


class Cookie(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int),
                ('display', C.c_void_p), ('extension', C.c_int), ('evtype', C.c_int),
                ('cookie', C.c_uint), ('data', C.c_void_p)]


class RawButton(C.Structure):
    _fields_ = Cookie._fields_[:6] + [('time', C.c_ulong), ('deviceid', C.c_int),
                                     ('sourceid', C.c_int), ('detail', C.c_int)]


class InputMask(C.Structure):
    _fields_ = [('deviceid', C.c_int), ('mask_len', C.c_int), ('mask', C.POINTER(C.c_ubyte))]


class WindowAttributes(C.Structure):
    _fields_ = [(key, C.c_int) for key in ('x', 'y', 'width', 'height', 'border_width', 'depth')] + [
        ('visual', C.c_void_p), ('root', C.c_ulong), ('window_class', C.c_int),
        ('bit_gravity', C.c_int), ('win_gravity', C.c_int), ('backing_store', C.c_int),
        ('backing_planes', C.c_ulong), ('backing_pixel', C.c_ulong), ('save_under', C.c_int),
        ('colormap', C.c_ulong), ('map_installed', C.c_int), ('map_state', C.c_int),
        ('all_event_masks', C.c_long), ('your_event_mask', C.c_long), ('do_not_propagate_mask', C.c_long),
        ('override_redirect', C.c_int), ('screen', C.c_void_p)]


def rectangle(value):
    if not isinstance(value, dict) or not all(isinstance(value.get(key), (int, float)) and
            math.isfinite(value[key]) for key in ('x', 'y', 'w', 'h')):
        raise ValueError('Invalid panel rectangle.')
    if value['w'] <= 0 or value['h'] <= 0: raise ValueError('Empty panel rectangle.')
    return {key: round(value[key]) for key in ('x', 'y', 'w', 'h')}


def clamp(value, low, high):
    return max(low, min(value, high))


def main():
    request = json.loads(sys.argv[1])
    xid = int(request['xid'])
    width, height = (max(1, min(32767, int(value))) for value in request.get('size', [1, 1]))
    screens = [rectangle(screen) for screen in request.get('screens', [])]
    if (not screens and not request.get('watch')) or xid <= 0: raise ValueError('No X11 usage surface.')
    x = C.CDLL('libX11.so.6')

    def function(name, result, *args):
        fn = getattr(x, name)
        fn.restype, fn.argtypes = result, args
        return fn

    ptr, ulong, integer = C.c_void_p, C.c_ulong, C.c_int
    open_display = function('XOpenDisplay', ptr, C.c_char_p)
    close = function('XCloseDisplay', integer, ptr)
    root_window = function('XDefaultRootWindow', ulong, ptr)
    intern = function('XInternAtom', ulong, ptr, C.c_char_p, integer)
    get_property = function('XGetWindowProperty', integer, ptr, ulong, ulong, C.c_long, C.c_long,
                            integer, ulong, C.POINTER(ulong), C.POINTER(integer), C.POINTER(ulong),
                            C.POINTER(ulong), C.POINTER(ptr))
    free = function('XFree', integer, ptr)
    sync = function('XSync', integer, ptr, integer)
    send = function('XSendEvent', integer, ptr, ulong, integer, C.c_long, C.POINTER(Event))
    get_geometry = function('XGetGeometry', integer, ptr, ulong, C.POINTER(ulong), C.POINTER(integer),
                            C.POINTER(integer), *([C.POINTER(C.c_uint)] * 4))
    translate = function('XTranslateCoordinates', integer, ptr, ulong, ulong, integer, integer,
                         C.POINTER(integer), C.POINTER(integer), C.POINTER(ulong))
    query_tree = function('XQueryTree', integer, ptr, ulong, C.POINTER(ulong), C.POINTER(ulong),
                          C.POINTER(C.POINTER(ulong)), C.POINTER(C.c_uint))
    get_attributes = function('XGetWindowAttributes', integer, ptr, ulong, C.POINTER(WindowAttributes))
    display = open_display(None)
    if not display: raise ValueError('Could not open this session’s X11 display.')
    # A closing panel/window may disappear between two property requests.
    error_type = C.CFUNCTYPE(integer, ptr, ptr)
    ignore_error = error_type(lambda *_: 0)
    function('XSetErrorHandler', ptr, error_type)(ignore_error)
    try:
        root = root_window(display)
        atom = lambda name: intern(display, name.encode(), 0)

        def prop(window, name):
            actual, fmt, count, left, data = ulong(), integer(), ulong(), ulong(), ptr()
            result = get_property(display, window, atom(name), 0, 4096, 0, 0,
                                  C.byref(actual), C.byref(fmt), C.byref(count), C.byref(left), C.byref(data))
            try:
                if result or not data: return []
                if fmt.value == 32: return list(C.cast(data, C.POINTER(ulong))[:count.value])
                return C.string_at(data, count.value) if fmt.value == 8 else []
            finally:
                if data: free(data)

        def bounds(window):
            root_id, child = ulong(), ulong()
            gx, gy, rx, ry = integer(), integer(), integer(), integer()
            gw, gh, border, depth = C.c_uint(), C.c_uint(), C.c_uint(), C.c_uint()
            if not get_geometry(display, window, C.byref(root_id), C.byref(gx), C.byref(gy),
                                C.byref(gw), C.byref(gh), C.byref(border), C.byref(depth)):
                return None
            translate(display, window, root, 0, 0, C.byref(rx), C.byref(ry), C.byref(child))
            return dict(x=rx.value, y=ry.value, w=gw.value, h=gh.value)

        def contains(rect, point):
            return rect and point and rect['x'] <= point['x'] < rect['x'] + rect['w'] and rect['y'] <= point['y'] < rect['y'] + rect['h']

        def panel_windows():
            # Polybar can use override-redirect windows, which are intentionally
            # absent from the manager's client list. Include mapped root children.
            candidates = set(prop(root, '_NET_CLIENT_LIST'))
            pending = [(root, 0)]
            while pending:
                current, depth = pending.pop()
                root_id, parent, children, count = ulong(), ulong(), C.POINTER(ulong)(), C.c_uint()
                try:
                    if query_tree(display, current, C.byref(root_id), C.byref(parent), C.byref(children), C.byref(count)):
                        descendants = list(children[:count.value])
                        candidates.update(descendants)
                        # i3 reparents docks into untyped frame windows. Look
                        # through those frames, without walking application UIs.
                        if depth < 2:
                            pending.extend((child, depth + 1) for child in descendants
                                           if not prop(child, '_NET_WM_WINDOW_TYPE'))
                finally:
                    if children: free(children)
            for window in candidates:
                if atom('_NET_WM_WINDOW_TYPE_DOCK') not in prop(window, '_NET_WM_WINDOW_TYPE'): continue
                attributes = WindowAttributes()
                if get_attributes(display, window, C.byref(attributes)) and attributes.map_state == 2:
                    yield window

        # GTK's WM_CLASS names the interpreter ("gjs"), not the application.
        # Check the application ID on this exact surface. Its properties may
        # still be arriving when the popup is first presented.
        for _ in range(25):
            application_id = prop(xid, '_GTK_APPLICATION_ID')
            if application_id: break
            time.sleep(0.02)
        if application_id != b'io.github.HashimK.UsageStatBar':
            raise ValueError('The X11 surface does not belong to UsageStat.')
        if request.get('watch'):
            # Observe button releases without grabbing them. Desktop/app clicks
            # still reach their original target; no keystrokes are monitored.
            xi = C.CDLL('libXi.so.6')
            xi.XIQueryVersion.argtypes = [ptr, C.POINTER(integer), C.POINTER(integer)]
            major, minor = integer(2), integer(2)
            if xi.XIQueryVersion(display, C.byref(major), C.byref(minor)):
                raise ValueError('XInput2 is needed to dismiss this popup on outside clicks.')
            xi.XISelectEvents.argtypes = [ptr, ulong, C.POINTER(InputMask), integer]
            mask = (C.c_ubyte * 3)(0, 0, 1)  # XI_RawButtonRelease (16), all master pointers (1)
            selection = InputMask(1, 3, mask)
            xi.XISelectEvents(display, root, C.byref(selection), 1)
            sync(display, 0)
            next_event = function('XNextEvent', integer, ptr, C.POINTER(Event))
            get_data = function('XGetEventData', integer, ptr, C.POINTER(Cookie))
            free_data = function('XFreeEventData', None, ptr, C.POINTER(Cookie))
            pointer = function('XQueryPointer', integer, ptr, ulong, C.POINTER(ulong), C.POINTER(ulong),
                               C.POINTER(integer), C.POINTER(integer), C.POINTER(integer), C.POINTER(integer), C.POINTER(C.c_uint))
            while True:
                event = Event()
                next_event(display, C.byref(event))
                cookie = C.cast(C.byref(event), C.POINTER(Cookie))
                if cookie.contents.type != 35 or cookie.contents.evtype != 16 or not get_data(display, cookie): continue
                try:
                    button = C.cast(cookie.contents.data, C.POINTER(RawButton)).contents.detail
                    if button not in (1, 2, 3): continue
                    root_id, child, px, py, wx, wy, buttons = ulong(), ulong(), integer(), integer(), integer(), integer(), C.c_uint()
                    pointer(display, root, C.byref(root_id), C.byref(child), C.byref(px), C.byref(py), C.byref(wx), C.byref(wy), C.byref(buttons))
                    rect = bounds(xid)
                    if not rect: return
                    if not contains(rect, dict(x=px.value, y=py.value)):
                        print('outside', flush=True)
                        return
                finally:
                    free_data(display, cookie)
        # Wait for the manager to adopt this exact surface before requesting
        # geometry. Its initial placement would otherwise race our request.
        for _ in range(40):
            if xid in prop(root, '_NET_CLIENT_LIST'): break
            time.sleep(0.02)
        else: raise ValueError('The window manager has not mapped UsageStat.')
        desktop_name = os.environ.get('XDG_CURRENT_DESKTOP', '').lower().split(':')
        if 'i3' in desktop_name and shutil.which('i3-msg'):
            subprocess.run(['i3-msg', f'[id="{xid}"] floating enable'], check=True, capture_output=True, timeout=2)
        elif 'bspwm' in desktop_name and shutil.which('bspc'):
            # bspc exits 1 when asked to float an already-floating node. That
            # is normal on reopen/resize, and must not skip popup placement.
            node = json.loads(subprocess.check_output(['bspc', 'query', '-T', '-n', hex(xid)], text=True, timeout=2))
            if node.get('client', {}).get('state') != 'floating':
                subprocess.run(['bspc', 'node', hex(xid), '-t', 'floating'], check=True, capture_output=True, timeout=2)
        anchor = request.get('anchor') or {}
        exact_anchor = bool(anchor.get('rect') and anchor.get('work'))
        if exact_anchor:
            rect, work = rectangle(anchor['rect']), rectangle(anchor['work'])
            edge = anchor.get('edge')
            if edge not in ('top', 'bottom', 'left', 'right'): raise ValueError('Invalid panel edge.')
        else:
            # Tray activation coordinates only identify a monitor/panel. The
            # popup aligns to that panel's fixed bounds, never the click point.
            point = anchor.get('point')
            screen = next((s for s in screens if contains(s, point)), screens[0])
            docks = [bounds(w) for w in panel_windows()]
            docks = [d for d in docks if d and d['w'] > 0 and d['h'] > 0 and
                     contains(screen, dict(x=d['x']+d['w']/2, y=d['y']+d['h']/2))]
            docks.sort(key=lambda d: (d['y'], d['x']))
            rect = next((d for d in docks if contains(d, point)), docks[0] if docks else None)
            work = dict(screen)
            desktop = (prop(root, '_NET_CURRENT_DESKTOP') or [0])[0]
            area = prop(root, '_NET_WORKAREA')[desktop * 4:desktop * 4 + 4]
            if len(area) == 4:
                left, top = max(screen['x'], area[0]), max(screen['y'], area[1])
                right = min(screen['x'] + screen['w'], area[0] + area[2])
                bottom = min(screen['y'] + screen['h'], area[1] + area[3])
                if right > left and bottom > top: work = dict(x=left, y=top, w=right-left, h=bottom-top)
            if rect:
                edge = ('left' if rect['x'] < screen['x'] + screen['w']/2 else 'right') if rect['h'] > rect['w'] else (
                    'top' if rect['y'] < screen['y'] + screen['h']/2 else 'bottom')
                # Some tiling managers leave _NET_WORKAREA equal to the entire
                # monitor even with a dock. Reserve its edge before capping a
                # long provider, otherwise the popup grows over the panel.
                right, bottom = work['x'] + work['w'], work['y'] + work['h']
                if edge == 'top': work['y'] = max(work['y'], rect['y'] + rect['h'])
                elif edge == 'bottom': bottom = min(bottom, rect['y'])
                elif edge == 'left': work['x'] = max(work['x'], rect['x'] + rect['w'])
                else: right = min(right, rect['x'])
                work['w'], work['h'] = max(1, right-work['x']), max(1, bottom-work['y'])
            else:
                edge = 'top'
                rect = dict(x=work['x'], y=work['y'], w=work['w'], h=1)
        gap = 8
        width, height = min(width, max(1, work['w'] - 2*gap)), min(height, max(1, work['h'] - 2*gap))
        fraction = {'left': 0, 'center': 0.5, 'right': 1}.get(request.get('alignment'), 0.5)
        left = rect['x'] + (rect['w'] - width) * fraction
        top = rect['y'] + (rect['h'] - height) * fraction
        if edge == 'top': top = max(rect['y'] + rect['h'], work['y']) + gap
        elif edge == 'bottom': top = min(rect['y'], work['y'] + work['h']) - height - gap
        elif edge == 'left': left = max(rect['x'] + rect['w'], work['x']) + gap
        else: left = min(rect['x'], work['x'] + work['w']) - width - gap
        left = round(clamp(left, work['x'] + gap, work['x'] + work['w'] - width - gap))
        top = round(clamp(top, work['y'] + gap, work['y'] + work['h'] - height - gap))
        # GTK's default size describes content. X11 surface geometry includes
        # the invisible client-side shadow; omitting it creates a false overflow.
        shadow = prop(xid, '_GTK_FRAME_EXTENTS')
        sl, sr, st, sb = shadow if len(shadow) == 4 else [0, 0, 0, 0]
        desired = (left-sl, top-st, width+sl+sr, height+st+sb)
        event = Event()
        event.client = ClientMessage(33, 0, 1, display, xid, atom('_NET_MOVERESIZE_WINDOW'), 32,
                                     ClientData(l=(C.c_long * 5)(10 | (15 << 8) | (1 << 12),
                                         *desired)))
        if not send(display, root, 0, (1 << 20) | (1 << 19), C.byref(event)):
            raise ValueError('The window manager rejected popup placement.')
        if 'bspwm' in desktop_name:
            # bspwm accepts ConfigureRequest for floating windows, but does not
            # implement the EWMH moveresize request used by other managers.
            attributes = WindowAttributes()
            get_attributes(display, xid, C.byref(attributes))
            border = attributes.border_width
            # ConfigureRequest coordinates include bspwm's window border,
            # while the measured client origin starts just inside that border.
            function('XMoveResizeWindow', integer, ptr, ulong, integer, integer, C.c_uint, C.c_uint)(
                display, xid, desired[0]-border, desired[1]-border, desired[2], desired[3])
        sync(display, 0)
        # The request reaches the server before the manager applies it. Wait
        # for its geometry to acknowledge the placement before returning.
        for _ in range(40):
            root_id, child = ulong(), ulong()
            gx, gy, rx, ry = integer(), integer(), integer(), integer()
            gw, gh, border, depth = C.c_uint(), C.c_uint(), C.c_uint(), C.c_uint()
            if not get_geometry(display, xid, C.byref(root_id), C.byref(gx), C.byref(gy),
                                C.byref(gw), C.byref(gh), C.byref(border), C.byref(depth)):
                raise ValueError('Usage window closed during placement.')
            translate(display, xid, root, 0, 0, C.byref(rx), C.byref(ry), C.byref(child))
            if (rx.value, ry.value, gw.value, gh.value) == desired: break
            time.sleep(0.01)
        else: raise ValueError(f'The window manager did not apply the requested popup geometry: requested {desired}, received {(rx.value, ry.value, gw.value, gh.value)}.')
        # Native adapters supply a fresh widget rectangle for every activation.
        # A tray/text fallback must rediscover its panel after it moves.
        print(json.dumps({'edge': edge, 'rect': rect, 'work': work} if exact_anchor else
                         {'edge': edge, 'point': {'x': screen['x'] + screen['w']/2, 'y': screen['y'] + screen['h']/2}}))
    finally:
        close(display)


if __name__ == '__main__':
    try: main()
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error: raise SystemExit(str(error))
