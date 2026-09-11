#!/usr/bin/env python3
"""Exercise native panel input; inspect public state and actual popup geometry."""
import ast
import json
import os
from pathlib import Path
import re
import socket
import struct
import subprocess
import sys
import time
import traceback
from placement import assert_section_alignment
import gi
gi.require_version('Gio','2.0')
gi.require_version('GdkPixbuf','2.0')
from gi.repository import Gio, GLib, GdkPixbuf

OUT=Path('/out')
TARGET=sys.argv[1]
BUS='io.github.HashimK.UsageStatBar'
OBJECT='/io/github/HashimK/UsageStatBar'
bus=Gio.bus_get_sync(Gio.BusType.SESSION,None)
WAYLAND=os.environ.get('XDG_SESSION_TYPE')=='wayland'
TRAY=TARGET in ['lxqt','budgie','cosmic'] and os.environ.get('USAGESTAT_REVIEW_TRAY') == '1'
if TARGET=='hyprland': os.environ['PATH']='/out:'+os.environ['PATH']
checks=[]
started=time.monotonic()
EDGE='bottom' if TARGET == 'cinnamon' else 'top'
REGION='left'
INDEX=0
pointer=None
tray_monitor=None
tray_companion=None
anchor_monitor=None


class Pointer:
    """Keep one WayVNC virtual input device alive throughout the recording."""
    def __init__(self):
        self.log=(OUT/'input.log').open('w')
        env=dict(os.environ)
        if TARGET=='cosmic': env['WAYLAND_DISPLAY']=env['USAGESTAT_INPUT_DISPLAY']
        self.process=subprocess.Popen(['wayvnc','--unix-socket','/out/input.sock'],env=env,stdout=self.log,stderr=self.log)
        wait(lambda:(OUT/'input.sock').exists())
        self.connection=socket.socket(socket.AF_UNIX)
        self.connection.settimeout(5); self.connection.connect('/out/input.sock')
        assert self.receive(12)==b'RFB 003.008\n'
        self.connection.sendall(b'RFB 003.008\n')
        methods=self.receive(self.receive(1)[0]); assert 1 in methods,'Private input server requires authentication'
        self.connection.sendall(b'\1'); assert self.receive(4)==b'\0\0\0\0'
        self.connection.sendall(b'\1')
        header=self.receive(24)
        self.width,self.height=struct.unpack('>HH',header[:4]); self.receive(struct.unpack('>I',header[20:24])[0])
        self.x=self.y=0
    def receive(self,count):
        data=b''
        while len(data)<count:
            part=self.connection.recv(count-len(data))
            if not part: raise ConnectionError('Input connection closed')
            data+=part
        return data
    def event(self,mask=0): self.connection.sendall(struct.pack('>BBHH',5,mask,self.x,self.y))
    def move(self,x,y): self.x=max(0,min(self.width-1,x)); self.y=max(0,min(self.height-1,y)); self.event()
    def button(self,mask): self.event(mask); time.sleep(.07); self.event()
    def key(self,keysym):
        for down in [1,0]:
            self.connection.sendall(struct.pack('>BBHI',4,down,0,keysym));time.sleep(.07)


class X11PreviewPointer:
    """Feed the real COSMIC compositor through its private nested window."""
    def __init__(self):
        self.width,self.height=map(int,command('xdotool','getdisplaygeometry').split())
    def move(self,x,y):
        # Include motion inside the destination surface, as a physical pointer
        # does. A single warp may only send enter to an embedded Iced applet.
        command('xdotool','mousemove',str(max(0,x-2)),str(y));time.sleep(.05)
        command('xdotool','mousemove',str(x),str(y))
    def button(self,mask): command('xdotool','click',str({1:1,8:4,16:5}[mask]))
    def key(self,keysym): command('xdotool','key',hex(keysym))


def command(*args, check=True):
    return subprocess.run(list(args),check=check,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10).stdout.strip()


def call(method, signature=None, values=None):
    return bus.call_sync(BUS,OBJECT,BUS+'1',method,GLib.Variant(signature,values) if signature else None,
        None,Gio.DBusCallFlags.NONE,5000,None).unpack()


def state(): return json.loads(call('GetSnapshot')[0])


def shown():
    if not TRAY: return state()['panel']
    items=bus.call_sync('org.kde.StatusNotifierWatcher','/StatusNotifierWatcher','org.freedesktop.DBus.Properties',
        'Get',GLib.Variant('(ss)',('org.kde.StatusNotifierWatcher','RegisteredStatusNotifierItems')),None,
        Gio.DBusCallFlags.NONE,5000,None).unpack()[0]
    result=[]
    for item in items:
        name,_,suffix=item.partition('/')
        props=bus.call_sync(name,'/'+suffix if suffix else '/StatusNotifierItem','org.freedesktop.DBus.Properties','GetAll',
            GLib.Variant('(s)',('org.kde.StatusNotifierItem',)),None,Gio.DBusCallFlags.NONE,5000,None).unpack()[0]
        if props['Id'].startswith('usagestat-bar-'): result.append((int(name.split('.')[-1]),props['Title'].lower()))
    return [title for _,title in sorted(result)]


def companion_registered():
    name = (OUT/'companion-bus.txt').read_text().strip()
    items = bus.call_sync('org.kde.StatusNotifierWatcher','/StatusNotifierWatcher','org.freedesktop.DBus.Properties',
        'Get',GLib.Variant('(ss)',('org.kde.StatusNotifierWatcher','RegisteredStatusNotifierItems')),None,
        Gio.DBusCallFlags.NONE,5000,None).unpack()[0]
    return any(item.partition('/')[0] == name for item in items)


def tray_host_ready():
    return bool(bus.call_sync('org.kde.StatusNotifierWatcher','/StatusNotifierWatcher','org.freedesktop.DBus.Properties',
        'Get',GLib.Variant('(ss)',('org.kde.StatusNotifierWatcher','IsStatusNotifierHostRegistered')),None,
        Gio.DBusCallFlags.NONE,5000,None).unpack()[0])


def setting(key,value,tray=False):
    command('gsettings','set',BUS+('.Tray' if tray else ''),key,value)
    if TRAY and not tray and key in ['panel-bar-count','panel-pinned-providers','scroll-to-switch-provider']:
        mapped={'panel-bar-count':'provider-count','panel-pinned-providers':'pinned-providers','scroll-to-switch-provider':'scroll-to-switch-provider'}
        command('gsettings','set',BUS+'.Tray',mapped[key],value)
    time.sleep(.25)


def wait(predicate, timeout=8):
    deadline=time.monotonic()+timeout
    last=None
    while time.monotonic()<deadline:
        try:
            result=predicate()
            if result: return result
        except Exception as error: last=error
        time.sleep(.12)
    raise AssertionError(f'Expected state did not arrive. {last or ""}')


def screenshot(name):
    path=OUT/(name+'.png')
    if WAYLAND and os.environ.get('USAGESTAT_LAB_INPUT')!='x11': command('grim',str(path))
    else: command('magick','import','-window','root',str(path))
    return path


def measure(window):
    output=command('xdotool','getwindowgeometry','--shell',str(window),check=False)
    values=dict(re.findall(r'^(X|Y|WIDTH|HEIGHT)=(-?\d+)$',output,re.M))
    return {k:int(values[v]) for k,v in [('x','X'),('y','Y'),('w','WIDTH'),('h','HEIGHT')]} if len(values)==4 else None


def light_surface():
    # Actual screenshot pixels, for compositors without a layer geometry API.
    # The lab requests libadwaita's light theme. Match its flat window color,
    # not arbitrary white pixels: Sway's white wallpaper logo can otherwise
    # join the popup's component and inflate its measured rectangle.
    background=(250,250,251)
    if TARGET=='cosmic':
        css=Path(os.environ['XDG_CONFIG_HOME'])/'gtk-4.0/gtk.css'
        if css.exists():
            match=re.search(r'@define-color window_bg_color rgba\((\d+),\s*(\d+),\s*(\d+),',css.read_text())
            if match: background=tuple(map(int,match.groups()))
    pix=GdkPixbuf.Pixbuf.new_from_file(str(screenshot('.geometry')))
    data=pix.get_pixels(); width,height=pix.get_width(),pix.get_height()
    channels,stride=pix.get_n_channels(),pix.get_rowstride(); step=4
    white=set()
    for y in range(0,height,step):
        for x in range(0,width,step):
            index=y*stride+x*channels
            rgb=data[index:index+3]
            matches=all(abs(a-b)<=2 for a,b in zip(rgb,background))
            if matches: white.add((x//step,y//step))
    candidates=[]
    while white:
        point=white.pop(); stack=[point]; component=[point]
        while stack:
            x,y=stack.pop()
            for next_point in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                if next_point in white:
                    white.remove(next_point); stack.append(next_point); component.append(next_point)
        if len(component)<1000: continue
        left=min(p[0] for p in component)*step; top=min(p[1] for p in component)*step
        w=(max(p[0] for p in component)+1)*step-left; h=(max(p[1] for p in component)+1)*step-top
        if 340<=w<900 and 180<=h<height: candidates.append((len(component),dict(x=left,y=top,w=w,h=h)))
    return max(candidates,key=lambda item:item[0])[1] if candidates else None


def popup():
    if TARGET=='hyprland':
        layers=json.loads(command('hyprctl','layers','-j'))
        return next((dict(x=p['x'],y=p['y'],w=p['w'],h=p['h']) for m in layers.values() for level in m['levels'].values()
                     for p in level if p['namespace']=='usagestat-popup'),None)
    if WAYLAND: return light_surface()
    windows=command('xdotool','search','--onlyvisible','--class','gjs|plasmashell',check=False).splitlines()
    for window in reversed(windows):
        if 'Preferences' in command('xdotool','getwindowname',window,check=False): continue
        rect=measure(window)
        if rect and 340<=rect['w']<900 and 180<=rect['h']<=1064: return rect
    return None


def painted_popup():
    """Geometry alone also accepts the old nearly-black X11 opening frame."""
    rect = popup()
    if not rect: return None
    pix = GdkPixbuf.Pixbuf.new_from_file(str(screenshot('.popup-paint')))
    data = pix.get_pixels(); stride = pix.get_rowstride(); channels = pix.get_n_channels()
    light = blue = total = 0
    for y in range(max(0, rect['y']+24), min(pix.get_height(), rect['y']+rect['h']-12), 4):
        for x in range(max(0, rect['x']+20), min(pix.get_width(), rect['x']+rect['w']-20), 4):
            i = y*stride+x*channels; r,g,b = data[i:i+3]
            light += min(r,g,b) > 140 and max(r,g,b)-min(r,g,b) < 40
            blue += b > r+40 and b > g+15 and b > 150
            total += 1
    # Both light surfaces and dark themes have bright labels plus a blue
    # selected tab. A dim/black GTK frame has neither, regardless of theme.
    if light > 25 and blue > 25:
        return {'popup': rect, 'lightPixels': light, 'bluePixels': blue, 'sampledPixels': total}
    return None


def cinnamon_geometry():
    script='''(() => { const a=imports.ui.appletManager.get_object_for_uuid("usagestat-bar@hashimkarim","usagestat-bar@hashimkarim");
        const [x,y]=a.actor.get_transformed_position(); const [w,h]=a.actor.get_transformed_size();
        const s=imports.gi.St.Side; return {x,y,w,h,edge:{[s.TOP]:"top",[s.BOTTOM]:"bottom",[s.LEFT]:"left",[s.RIGHT]:"right"}[a._orientation]}; })()'''
    ok,output=bus.call_sync('org.Cinnamon','/org/Cinnamon','org.Cinnamon','Eval',GLib.Variant('(s)',(script,)),
        None,Gio.DBusCallFlags.NONE,5000,None).unpack()
    if not ok: raise RuntimeError('Cinnamon indicator is not mapped')
    return json.loads(output)


def panel():
    if TARGET=='cinnamon': return cinnamon_geometry()
    if TARGET=='hyprland':
        layers=json.loads(command('hyprctl','layers','-j'))
        return next(dict(x=p['x'],y=p['y'],w=p['w'],h=p['h']) for m in layers.values() for level in m['levels'].values()
                    for p in level if p['namespace']=='waybar')
    if WAYLAND:
        width,height=(pointer.width,pointer.height) if pointer else (1500,900)
        thickness=36
        if TARGET in ['sway','hyprland']:
            config=json.loads(Path('/tmp/waybar.json').read_text())
            thickness=config.get('width',40) if EDGE in ['left','right'] else config.get('height',36)
        return {'top':dict(x=0,y=0,w=width,h=thickness),'bottom':dict(x=0,y=height-thickness,w=width,h=thickness),
            'left':dict(x=0,y=0,w=thickness,h=height),'right':dict(x=width-thickness,y=0,w=thickness,h=height)}[EDGE]
    ids=re.findall(r'0x[0-9a-f]+',command('xprop','-root','_NET_CLIENT_LIST'))
    if TARGET in ['i3','bspwm']:
        ids+=command('xdotool','search','--onlyvisible','--class','polybar',check=False).splitlines()
    docks=[]
    for window in ids:
        if '_NET_WM_WINDOW_TYPE_DOCK' in command('xprop','-id',window,'_NET_WM_WINDOW_TYPE'):
            rect=measure(window)
            if rect and min(rect['w'],rect['h'])<100: docks.append(rect)
    if docks:
        vertical=EDGE in ['left','right']
        docks=[rect for rect in docks if (rect['h']>rect['w'])==vertical] or docks
        return sorted(docks,key=lambda p: {'top':p['y'],'bottom':-p['y'],'left':p['x'],'right':-p['x']}[EDGE])[0]
    raise RuntimeError('No panel mapped')


def _point():
    rect=panel()
    if TARGET=='cinnamon': return rect['x']+rect['w']/2,rect['y']+min(rect['h']/2,40)
    if TARGET=='mate':
        for process in Path('/proc').iterdir():
            if not process.name.isdigit(): continue
            try:
                args=(process/'cmdline').read_bytes().split(b'\0')
                if not any(arg.endswith(b'/platforms/mate/applet.py') for arg in args): continue
                for window in command('xdotool','search','--onlyvisible','--pid',process.name,check=False).splitlines():
                    actual=measure(window)
                    if actual and min(actual['w'],actual['h'])<100 and max(actual['w'],actual['h'])>50:
                        return actual['x']+min(actual['w']/2,40),actual['y']+min(actual['h']/2,40)
            except OSError: continue
    if TARGET=='plasma':
        actual=json.loads(plasma_script('var p=panels().find(p=>p.widgets().some(w=>w.type==="io.github.HashimK.usagestat")); print(JSON.stringify(p.widgets("io.github.HashimK.usagestat")[0].geometry));'))
        return rect['x']+actual['x']+min(40,actual['width']/2),rect['y']+actual['y']+min(30,actual['height']/2)
    if TARGET in ['xfce','sway','hyprland','cosmic','i3','bspwm','lxqt','budgie']:
        # Locate the actual blue usage meter in the native panel screenshot.
        # The fixture's only other panel item is a monochrome clock/label.
        pix=GdkPixbuf.Pixbuf.new_from_file(str(screenshot('.panel-geometry')))
        data=pix.get_pixels(); stride=pix.get_rowstride(); channels=pix.get_n_channels()
        for y in range(max(0,rect['y']),min(pix.get_height(),rect['y']+rect['h'])):
            for x in range(max(0,rect['x']),min(pix.get_width(),rect['x']+rect['w'])):
                i=y*stride+x*channels; r,g,b=data[i:i+3]
                # Tray hosts can make their panel thinner than its configured
                # size. Match the fixture's actual meter, not blue wallpaper
                # just outside that panel (notably Budgie's bottom/side edges).
                meter = abs(r-138)<=2 and abs(g-180)<=2 and abs(b-248)<=2
                if meter:
                    if TARGET=='cosmic':
                        # Aim inside the logo button, not the bottom edge of
                        # its two-pixel meter or a gap between tray buttons.
                        return (rect['x']+rect['w']/2,y-6) if EDGE in ['left','right'] else (x+4,rect['y']+16)
                    return x,y
        raise RuntimeError('No usage meter found in the configured panel')
    vertical=rect['h']>rect['w']
    length=rect['h'] if vertical else rect['w']
    module_length=state().get('panelVerticalHeight',120) if vertical else state().get('panelWidth',280)
    offset={'left':40,'center':length/2-module_length/2+40,'right':length-140}[REGION]
    if TARGET=='mate' and REGION=='center': offset=500+40
    return (rect['x']+rect['w']/2,rect['y']+offset) if vertical else (rect['x']+offset,rect['y']+rect['h']/2)


def point(): return wait(_point)


def section_anchor(log_offset=0):
    """Read widget bounds from native input, or measure the Polybar fixture.

    The colored Polybar format is drawn by the real module formatter. It lets
    this test measure that module independently of popup-placement code and
    without including the neighboring module in the expected rectangle.
    """
    if TARGET == 'cosmic' and not TRAY:
        bar=panel()
        pix=GdkPixbuf.Pixbuf.new_from_file(str(screenshot('.section-geometry')))
        data=pix.get_pixels(); stride=pix.get_rowstride(); channels=pix.get_n_channels()
        points=[]
        for y in range(max(0,bar['y']),min(pix.get_height(),bar['y']+bar['h'])):
            for x in range(max(0,bar['x']),min(pix.get_width(),bar['x']+bar['w'])):
                i=y*stride+x*channels
                if tuple(data[i:i+3]) == (47,62,82): points.append((x,y))
        if not points: return None
        x,y=min(p[0] for p in points),min(p[1] for p in points)
        rect=dict(x=x,y=y,w=max(p[0] for p in points)-x+1,h=max(p[1] for p in points)-y+1)
        width,height=pointer.width,pointer.height
        work={'top':dict(x=0,y=bar['h'],w=width,h=height-bar['h']),
              'bottom':dict(x=0,y=0,w=width,h=bar['y']),
              'left':dict(x=bar['w'],y=0,w=width-bar['w'],h=height),
              'right':dict(x=0,y=0,w=bar['x'],h=height)}[EDGE]
        return dict(rect=rect,work=work,edge=EDGE)
    if TARGET in ['i3', 'bspwm']:
        bar=panel()
        pix=GdkPixbuf.Pixbuf.new_from_file(str(screenshot('.section-geometry')))
        data=pix.get_pixels(); stride=pix.get_rowstride(); channels=pix.get_n_channels()
        xs=[]
        y=bar['y']+2
        for x in range(max(0,bar['x']),min(pix.get_width(),bar['x']+bar['w'])):
            i=y*stride+x*channels
            if tuple(data[i:i+3])==(47,62,82): xs.append(x)
        if xs:
            rect=dict(x=min(xs),y=bar['y'],w=max(xs)-min(xs)+1,h=bar['h'])
            width,height=map(int,command('xdotool','getdisplaygeometry').split())
            work=dict(x=0,y=bar['h'] if EDGE=='top' else 0,w=width,h=height-bar['h'])
            return dict(rect=rect,work=work,edge=EDGE)
        return None
    if TARGET=='plasma':
        bar=panel()
        rect=json.loads(plasma_script('var p=panels().find(p=>p.widgets().some(w=>w.type==="io.github.HashimK.usagestat")); print(JSON.stringify(p.widgets("io.github.HashimK.usagestat")[0].geometry));'))
        width,height=map(int,command('xdotool','getdisplaygeometry').split())
        work={'top':dict(x=0,y=bar['y']+bar['h'],w=width,h=height-bar['y']-bar['h']),
              'bottom':dict(x=0,y=0,w=width,h=bar['y']),
              'left':dict(x=bar['x']+bar['w'],y=0,w=width-bar['x']-bar['w'],h=height),
              'right':dict(x=0,y=0,w=bar['x'],h=height)}[EDGE]
        return dict(rect=dict(x=bar['x']+rect['x'],y=bar['y']+rect['y'],w=rect['width'],h=rect['height']),
                    work=work,edge=EDGE)
    # Capture the actual adapter's ToggleDetailsAt argument. There is no
    # screen/panel fallback: an absent section must fail this contract.
    log=OUT/'section-anchor.log'
    for line in reversed(log.read_text()[log_offset:].splitlines() if log.exists() else []):
        text=line.strip()
        if not text.startswith('string "'): continue
        value=text[8:-1]
        try: anchor=json.loads(value)
        except (ValueError,TypeError):
            try: anchor=json.loads(ast.literal_eval(text[7:]))
            except (ValueError,SyntaxError,TypeError): continue
        if isinstance(anchor,dict) and all(k in anchor for k in ['rect','work','edge']): return anchor
    return None

def desktop_click():
    rect=popup()
    width,height=(pointer.width,pointer.height) if pointer else (1600,1000)
    for x,y in [(width-100,height-100),(100,height-100),(width-100,100),(100,100)]:
        if not rect or not (rect['x']-10<x<rect['x']+rect['w']+10 and rect['y']-10<y<rect['y']+rect['h']+10):
            click(x,y); return
    raise RuntimeError('Could not find exposed desktop')


def plasma_script(script):
    return bus.call_sync('org.kde.plasmashell','/PlasmaShell','org.kde.PlasmaShell','evaluateScript',
        GLib.Variant('(s)',(script,)),None,Gio.DBusCallFlags.NONE,5000,None).unpack()[0]


def position(edge='top', region='left', index=0):
    global EDGE,REGION,INDEX
    if popup(): desktop_click(); time.sleep(.3)
    EDGE,REGION,INDEX=edge,region,index
    if TARGET=='cinnamon':
        command('gsettings','set','org.cinnamon','panels-enabled',json.dumps([f'1:0:{edge}']))
        command('gsettings','set','org.cinnamon','enabled-applets',json.dumps([
            f'panel1:{region}:{index}:usagestat-bar@hashimkarim:0', f'panel1:{region}:{1-index}:calendar@cinnamon.org:1']))
    elif TARGET=='plasma':
        order={'left':['app','clock','first','last'],'center':['first','app','clock','last'],'right':['first','last','app','clock']}[region]
        if index:
            a,b=order.index('app'),order.index('clock'); order[a],order[b]=order[b],order[a]
        types={'app':'io.github.HashimK.usagestat','clock':'org.kde.plasma.digitalclock','first':'org.kde.plasma.panelspacer','last':'org.kde.plasma.panelspacer'}
        plasma_script('var previous=panels().find(p=>p.widgets().some(w=>w.type==="io.github.HashimK.usagestat")); '+
            'if(previous) previous.remove(); var p=new Panel; p.location="'+edge+'"; p.height=38; p.floating=false; '+
            json.dumps([types[key] for key in order])+'.forEach(type=>p.addWidget(type));')
    elif TARGET=='mate':
        top='org.mate.panel.toplevel:/org/mate/panel/toplevels/top/'
        obj='org.mate.panel.object:/org/mate/panel/objects/usagestat/'
        command('gsettings','set',top,'orientation',edge)
        command('gsettings','set',obj,'locked','false'); time.sleep(.4)
        move(*point()); command('xdotool','click','3'); time.sleep(.3)
        screenshot('mate-move-menu')
        command('xdotool','key','m'); time.sleep(.2)
        bar=panel(); vertical=bar['h']>bar['w']; length=bar['h'] if vertical else bar['w']
        along={'left':20,'center':length/2,'right':length-20}[region]+index*80
        move(bar['x']+bar['w']/2 if vertical else along,along if vertical else bar['y']+bar['h']/2)
        command('xdotool','click','1')
    elif TARGET=='xfce':
        # Xfce saves item order on exit; stage native configuration while the
        # private panel is stopped so it cannot overwrite the requested order.
        command('xfce4-panel','--quit'); time.sleep(.4)
        def conf(path,kind,value): command('xfconf-query','-c','xfce4-panel','-p',path,'-n','-t',kind,'-s',str(value))
        conf('/panels/panel-1/mode','uint',1 if edge in ['left','right'] else 0)
        x,y={'top':(800,18),'bottom':(800,982),'left':(18,500),'right':(1582,500)}[edge]
        conf('/panels/panel-1/position','string',f'p=0;x={x};y={y}')
        for i in [2,3]:
            conf(f'/plugins/plugin-{i}','string','separator'); conf(f'/plugins/plugin-{i}/expand','bool','true')
        conf('/plugins/plugin-4','string','clock')
        order={'left':[1,4,2,3],'center':[2,1,4,3],'right':[2,3,1,4]}[region]
        if index:
            a,b=order.index(1),order.index(4); order[a],order[b]=order[b],order[a]
        command('xfconf-query','-c','xfce4-panel','-p','/panels/panel-1/plugin-ids','-r')
        args=['xfconf-query','-c','xfce4-panel','-p','/panels/panel-1/plugin-ids','-n','-a']
        for item in order: args+=['-t','int','-s',str(item)]
        command(*args)
        with (OUT/'panel.log').open('a') as log: subprocess.Popen(['xfce4-panel','--disable-wm-check'],stdout=log,stderr=log)
    elif TARGET in ['sway','hyprland']:
        path=Path('/tmp/waybar.json'); config=json.loads(path.read_text())
        if 'custom/neighbor' not in config:
            config['custom/neighbor']={'format':'Neighbor','tooltip':False}
            config['modules-left'].append('custom/neighbor')
            path.write_text(json.dumps(config)); command('pkill','-USR2','-x','waybar'); time.sleep(.6)
        helper='/tmp/usagestat-prefix/share/usagestat-bar/platforms/linux/waybar_config.py'
        for key,value in [('edge',edge),('alignment',region)]: command('python3',helper,key,value); time.sleep(.6)
        current=json.loads(path.read_text())
        group=current['modules-'+region]
        if 'custom/neighbor' not in group:
            for key in ['modules-left','modules-center','modules-right']:
                current[key]=[m for m in current.get(key,[]) if m!='custom/neighbor']
            current['modules-'+region].append('custom/neighbor')
            path.write_text(json.dumps(current)); command('pkill','-USR2','-x','waybar'); time.sleep(.6)
        command('python3',helper,'index',str(index))
    elif TARGET in ['i3','bspwm']:
        if edge in ['left','right']: raise NotImplementedError('Polybar supports horizontal panels only')
        import configparser
        path=Path('/tmp/polybar.ini'); config=configparser.RawConfigParser(); config.read(path)
        for key in ['modules-left','modules-center','modules-right']: config['bar/baseline'][key]=''
        config['bar/baseline']['modules-'+region]='neighbor usagestat' if index else 'usagestat neighbor'
        config['bar/baseline']['bottom']='true' if edge=='bottom' else 'false'
        config['module/neighbor']={'type':'custom/text','content':' Neighbor '}
        config['module/usagestat']['format-background']='#2f3e52'
        with path.open('w') as stream: config.write(stream)
        command('pkill','-x','usagestat-polyb',check=False)
        command('pkill','-x','usagestat-poly',check=False)
        command('pkill','-x','polybar',check=False)
        with (OUT/'panel.log').open('a') as log: subprocess.Popen(['usagestat-polybar','-c',str(path),'baseline'],stdout=log,stderr=log)
    elif TARGET=='budgie':
        setting('enabled','false',True)
        command('pkill','-x','budgie-panel')
        wait(lambda:not command('pgrep','-x','budgie-panel',check=False))
        time.sleep(.5)
        panel_schema='com.solus-project.budgie-panel.panel:/com/solus-project/budgie-panel/panels/{00000000-0000-0000-0000-000000000001}/'
        tray_schema='com.solus-project.budgie-panel.applet:/com/solus-project/budgie-panel/applets/{00000000-0000-0000-0000-000000000002}/'
        clock_schema='com.solus-project.budgie-panel.applet:/com/solus-project/budgie-panel/applets/{00000000-0000-0000-0000-000000000003}/'
        command('gsettings','set',clock_schema,'name','Clock')
        command('gsettings','set',panel_schema,'applets',"['00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003']")
        command('gsettings','set',panel_schema,'location',edge)
        for schema,i in [(tray_schema,index),(clock_schema,1-index)]:
            command('gsettings','set',schema,'alignment',{'left':'start','center':'center','right':'end'}[region])
            command('gsettings','set',schema,'position',str(i))
        with (OUT/'panel.log').open('a') as log:subprocess.Popen(['budgie-panel'],stdout=log,stderr=log)
        time.sleep(1)
        if TRAY: setting('enabled','true',True);time.sleep(1)
    elif TARGET=='lxqt':
        import configparser
        setting('enabled','false',True)
        command('pkill','-x','lxqt-panel');time.sleep(.5)
        path=Path(os.environ['XDG_CONFIG_HOME'])/'lxqt/panel.conf'
        config=configparser.RawConfigParser();config.optionxform=str
        config['General']={'panels':'panel1','__userfile__':'true'}
        module='statusnotifier' if TRAY else 'usagestat'
        plugins=['worldclock',module] if index else [module,'worldclock']
        if region=='center': plugins=['spacer-before',*plugins,'spacer-after']
        config['panel1']={'position':edge.capitalize(),'plugins':','.join(plugins),
            'desktop':'0','lineCount':'1','panelSize':'38','iconSize':'24','length':'100','lengthInPercents':'true'}
        # LXQt has left/right groups; symmetric expanding spacers center a group.
        for plugin in ['worldclock',module]:
            config[plugin]={'type':plugin,'alignment':'Right' if region=='right' else 'Left'}
        for plugin in ['spacer-before','spacer-after']:
            config[plugin]={'type':'spacer','alignment':'Left','expandable':'true'}
        path.parent.mkdir(parents=True,exist_ok=True)
        with path.open('w') as stream:config.write(stream)
        with (OUT/'panel.log').open('a') as log:subprocess.Popen(['usagestat-lxqt-panel'],stdout=log,stderr=log)
        time.sleep(1)
        if TRAY: setting('enabled','true',True);time.sleep(1)
    elif TARGET=='cosmic':
        setting('enabled','false',True)
        command('pkill','-x','cosmic-panel',check=False)
        wait(lambda:not command('pgrep','-x','cosmic-panel',check=False))
        folder=Path(os.environ['XDG_CONFIG_HOME'])/'cosmic/com.system76.CosmicPanel.Panel/v1'
        order=['com.system76.CosmicAppletStatusArea' if TRAY else 'io.github.HashimK.UsageStatApplet','com.system76.CosmicAppletTime']
        if index: order.reverse()
        group=json.dumps(order)
        (folder/'anchor').write_text(edge.capitalize())
        (folder/'plugins_center').write_text(f'Some({group})' if region=='center' else 'None')
        wings=f'Some(({group},[]))' if region=='left' else f'Some(([],{group}))' if region=='right' else 'None'
        (folder/'plugins_wings').write_text(wings)
        with (OUT/'panel.log').open('a') as log: subprocess.Popen(['cosmic-panel'],stdout=log,stderr=log)
        time.sleep(1)
        if TRAY: setting('enabled','true',True);time.sleep(1)
    else: raise NotImplementedError('Desktop tray placement requires its native panel settings')
    time.sleep(1.1)


def placement_checks():
    positions={}
    def at_position(edge,region,index):
        position(edge,region,index)
        indicator=point(); click(*indicator); actual=wait(popup)
        positions[(edge,region,index)]=indicator
        bar=panel()
        if edge=='top': assert actual['y']<150, f'Popup drifted from top panel: {actual}'
        if edge=='bottom': assert actual['y']+actual['h']>bar['y']-65, f'Popup drifted from bottom panel: {actual}'
        if edge=='left': assert actual['x']<bar['x']+bar['w']+65, f'Popup drifted from left panel: {actual}'
        if edge=='right': assert abs(actual['x']+actual['w']-bar['x'])<65, f'Popup drifted from right panel: {actual}'
        return dict(edge=edge,region=region,index=index,panel=bar,indicator=indicator,popup=actual)
    for region in ['left','center','right']:
        step('panel-region-'+region,lambda region=region:at_position('top',region,0))
    step('panel-regions-distinct',lambda:ensure(positions[('top','left',0)][0]<positions[('top','center',0)][0]<positions[('top','right',0)][0],str(positions)))
    def item_index():
        actual=at_position('top','center',1)
        ensure(abs(positions[('top','center',0)][0]-actual['indicator'][0])>8,'Item order did not move the indicator')
        return actual
    step('panel-item-index',item_index)
    for edge in ['bottom','left','right']:
        if TARGET in ['i3','bspwm'] and edge in ['left','right']:
            checks.append({'name':'panel-edge-'+edge,'status':'unsupported','reason':'Polybar supports horizontal panels only.'})
        else: step('panel-edge-'+edge,lambda edge=edge:at_position(edge,'center',0))
    def alignment(value, edge='top'):
        position(edge,'center',0); setting('popup-alignment',value)
        log=OUT/'section-anchor.log'; offset=log.stat().st_size if log.exists() else 0
        click(*point()); actual=wait(popup)
        anchor=section_anchor(offset)
        assert anchor, 'The integration did not supply measurable UsageStat section bounds; panel bounds are not accepted.'
        # Native popup hosts clamp flush to the work-area boundary; the
        # shared GTK layer/X11 window uses its own eight-pixel inset.
        inset = 0 if TARGET=='plasma' or (TARGET=='cosmic' and not TRAY) else 8
        observation=assert_section_alignment(actual,anchor['rect'],anchor['work'],anchor['edge'],value,inset=inset)
        desktop_click(); wait(lambda:not popup())
        click(*point()); repeated=wait(popup)
        assert abs(actual['x']-repeated['x'])<5 and abs(actual['y']-repeated['y'])<5,f'Reopening changed the popup anchor: {actual} → {repeated}'
        assert_section_alignment(repeated,anchor['rect'],anchor['work'],anchor['edge'],value,inset=inset)
        return observation
    aligned={}
    for value in ['left','center','right']:
        def check_alignment(value=value):
            aligned[value]=alignment(value); return aligned[value]
        step('popup-alignment-'+value,check_alignment)
    def aligned_to_section():
        ensure(len(aligned)==3,'All three alignments must match the UsageStat section; differing screen positions are insufficient.')
        return aligned
    step('popup-alignment-section',aligned_to_section)
    if TARGET not in ['i3','bspwm']:
        for edge in ['left','right']:
            for value in ['left','center','right']:
                step(f'popup-{edge}-panel-alignment-{value}',lambda value=value,edge=edge:alignment(value,edge))


def ensure(condition,message):
    if not condition: raise AssertionError(message)


def move(x,y):
    x,y=round(x),round(y)
    if pointer: pointer.move(x,y)
    elif WAYLAND:
        command('wlrctl','pointer','move','-10000','-10000')
        command('wlrctl','pointer','move',str(x),str(y))
    else: command('xdotool','mousemove',str(x),str(y))
    time.sleep(.15)


def click(x,y):
    move(x,y)
    if pointer: pointer.button(1)
    elif WAYLAND: command('wlrctl','pointer','click')
    else: command('xdotool','click','1')
    time.sleep(.35)


def wheel(direction,x,y):
    with (OUT/'input-events.jsonl').open('a') as log:
        log.write(json.dumps({'seconds':round(time.monotonic()-started,3),'event':'wheel','direction':direction,'x':x,'y':y})+'\n')
    move(x,y)
    if pointer: pointer.button(16 if direction>0 else 8)
    elif WAYLAND: command('wlrctl','pointer','scroll',str(direction*15),'0')
    else: command('xdotool','click','5' if direction>0 else '4')
    time.sleep(.25)


def step(name, action):
    timestamp=round(time.monotonic()-started,2)
    try:
        evidence=action()
        item={'name':name,'status':'passed','seconds':timestamp,'observation':evidence}
    except Exception as error:
        item={'name':name,'status':'failed','seconds':timestamp,'error':str(error),'traceback':traceback.format_exc()}
    checks.append(item)
    item['screenshot']=f'{len(checks):02d}-{name}.png'
    screenshot(item['screenshot'][:-4])
    print(json.dumps({k:v for k,v in item.items() if k!='traceback'}),flush=True)
    (OUT/'result.json').write_text(json.dumps({'target':TARGET,'status':'failed' if any(c['status']=='failed' for c in checks) else 'passed','checks':checks},indent=2))


def main():
    global pointer, started, tray_monitor, tray_companion, anchor_monitor
    wait(lambda:len(state()['providers'])==4 and not state()['loading'],30)
    # Keep screenshot geometry detection reproducible across desktop defaults.
    command('gsettings','set','org.gnome.desktop.interface','color-scheme','prefer-light')
    command('gsettings','set','org.gnome.desktop.interface','gtk-theme','Adwaita')
    if WAYLAND: pointer=X11PreviewPointer() if os.environ.get('USAGESTAT_LAB_INPUT')=='x11' else Pointer()
    (OUT/'capture-env.json').write_text(json.dumps({key:value for key,value in os.environ.items() if key in
        ['DISPLAY','XAUTHORITY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','XDG_SESSION_TYPE','DBUS_SESSION_BUS_ADDRESS','HYPRLAND_INSTANCE_SIGNATURE','XDG_CURRENT_DESKTOP','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_STATE_HOME','GSETTINGS_SCHEMA_DIR','GSETTINGS_BACKEND','PATH','SWAYSOCK','USAGESTAT_FIXTURE_STATE','USAGESTAT_INPUT_DISPLAY','USAGESTAT_LAB_INPUT']}))
    wait(lambda:(OUT/'recording.ready').exists(),20)
    started=time.monotonic()
    time.sleep(2)
    if TRAY:
        # The desktop's embedded status-area process can start after its panel
        # window. Wait for the actual native host before adding test clients.
        wait(tray_host_ready,30)
        with (OUT/'tray-input.log').open('w') as log:
            tray_monitor=subprocess.Popen(['dbus-monitor',"type='method_call',interface='org.kde.StatusNotifierItem'"],stdout=log,stderr=log)
        if os.environ.get('USAGESTAT_LAB_TRAY_COMPANION') == '1':
            with (OUT/'companion.log').open('w') as log:
                tray_companion = subprocess.Popen(['gjs','-m','/src/tests/linux/tray-companion.js'],
                    env={**os.environ, 'GSETTINGS_BACKEND':'memory', 'XDG_CURRENT_DESKTOP':'Fixture',
                         'USAGESTAT_BAR_SCHEMA_DIR':os.environ['GSETTINGS_SCHEMA_DIR']}, stdout=log,stderr=log)
            wait(companion_registered)
        setting('provider-mode','count',True); setting('provider-count','2',True)
        call('EnableTray'); time.sleep(2)
        if TARGET=='lxqt':position('bottom','left',0)
    setting('scroll-to-switch-provider','true')
    setting('scroll-popup-to-switch-provider','true')
    step('initial-panel',lambda:dict(panel=panel(),providers=state()['panel']))
    if TARGET != 'plasma' and not TRAY:
        def keyboard_toggle():
            # This is the command bound to the global shortcut, before any
            # pointer activation can seed a remembered popup rectangle.
            call('ToggleDetails','(s)',('',))
            try:
                wait(painted_popup)
                anchor=wait(section_anchor)
                # X11 maps the window before the WM acknowledges its position.
                # A window that stays centred on the screen still fails.
                return wait(lambda:assert_section_alignment(wait(popup),anchor['rect'],anchor['work'],anchor['edge'],'center',
                    inset=0 if TARGET=='cosmic' else 8))
            finally:
                if popup(): call('ToggleDetails','(s)',('',))
                wait(lambda:not popup())
        step('keyboard-toggle-before-panel-click',keyboard_toggle)
    def pins():
        setting('panel-bar-count','2'); setting('panel-pinned-providers','["codex"]')
        call('Select','(s)',('claude',))
        wait(lambda:shown()==['codex','claude'])
        return shown()
    step('pin-provider',pins)
    def scroll_bar():
        seen=[]
        for direction in [1,1,1,-1,-1,-1]:
            before=shown()
            wheel(direction,*point())
            wait(lambda:shown()!=before,2)
            after=state(); seen.append({'active':after['active'],'panel':shown()})
            assert shown()[0]=='codex','Pinned provider moved'
            assert shown()!=before,'A wheel notch did not advance the free provider slot'
            assert after['active']!='codex','Bar scrolling selected the pinned provider instead of the free slot'
        return seen
    step('bar-scroll-both-directions',scroll_bar)
    def disabled():
        setting('scroll-to-switch-provider','false'); before=state()['active']
        wheel(1,*point()); assert state()['active']==before,'Disabled bar scrolling still switched'
        setting('scroll-to-switch-provider','true')
    step('bar-scroll-disabled',disabled)
    def opening():
        click(*point()); rect=wait(popup)
        assert rect['w']>=360
        return rect
    step('click-opens-popup',opening)
    step('popup-painted',lambda:wait(painted_popup))
    def popup_scroll():
        rect=wait(popup); call('Select','(s)',('claude',)); before=state()['active']
        wheel(-1,rect['x']+100,rect['y']+100)
        wait(lambda:state()['active']=='codex')
        wheel(1,rect['x']+100,rect['y']+100)
        wait(lambda:state()['active']==before)
        setting('scroll-popup-to-switch-provider','false')
        wheel(1,rect['x']+100,rect['y']+100)
        assert state()['active']==before,'Disabled popup scrolling still switched'
        setting('scroll-popup-to-switch-provider','true')
        return 'Popup can reach pinned providers; disabling its wheel switch is respected.'
    step('popup-scroll-both-directions',popup_scroll)
    def compact_provider():
        call('Select','(s)',('codex',));time.sleep(.4);before=wait(popup)
        setting('provider-usage-settings',json.dumps({'claude':{'hiddenWindows':['primary','secondary']}}))
        try:
            call('Select','(s)',('claude',))
            after=wait(lambda:(r if (r:=popup()) and r['h']<before['h']-50 else None))
            return {'expanded':before,'compact':after}
        finally:setting('provider-usage-settings','{}')
    step('compact-provider-resizes',compact_provider)
    def body_scroll():
        fixture=Path(os.environ['USAGESTAT_FIXTURE_STATE'])
        fixture.write_text(json.dumps({'scenario':'normal','overrides':{'extraWindows':12}}))
        try:
            call('Refresh');wait(lambda:not state()['loading'] and len(state()['providers'][0]['windows'])>4,30)
            call('Select','(s)',('codex',));time.sleep(.5);rect=wait(popup)
            def body_pixels(path):
                pix=GdkPixbuf.Pixbuf.new_from_file(str(path));data=pix.get_pixels();stride=pix.get_rowstride();n=pix.get_n_channels()
                x=max(0,rect['x']+25);top=max(0,rect['y']+240);right=min(pix.get_width(),rect['x']+rect['w']-25);bottom=min(pix.get_height(),rect['y']+rect['h']-25)
                return b''.join(data[y*stride+x*n:y*stride+right*n] for y in range(top,bottom))
            before=body_pixels(screenshot('body-before-scroll'))
            for _ in range(4):wheel(1,rect['x']+120,rect['y']+min(350,rect['h']-30))
            ensure(state()['active']=='codex','Body scrolling unexpectedly switched provider')
            after=body_pixels(screenshot('body-after-scroll'))
            changed=sum(a!=b for a,b in zip(before,after));ensure(changed>500,'Overflow content did not visibly scroll')
            return {'popup':rect,'changedColorChannels':changed,'active':state()['active']}
        finally:
            fixture.write_text(json.dumps({'scenario':'normal'}));call('Refresh');wait(lambda:not state()['loading'],30);time.sleep(.4)
    step('long-content-body-scroll',body_scroll)
    def dismiss():
        assert popup(),'No open popup to dismiss'
        desktop_click(); wait(lambda:not popup())
    step('outside-click-dismisses',dismiss)
    def toggle():
        click(*point()); wait(popup); click(*point()); wait(lambda:not popup())
    step('second-click-toggles',toggle)
    def escape():
        click(*point());rect=wait(popup)
        # ON_DEMAND layers take keyboard focus when clicked, without stealing
        # pointer focus from the panel on map.
        click(rect['x']+30,rect['y']+30)
        if pointer: pointer.key(0xff1b)
        else: command('xdotool','key','Escape')
        wait(lambda:not popup())
        click(*point());wait(popup);desktop_click();wait(lambda:not popup())
        return 'Escape dismisses the focused popup and it reopens normally.'
    step('keyboard-escape-and-reopen',escape)
    def two_pins():
        # Isolate this check from any failed dismissal/toggle before it.
        if popup():desktop_click();time.sleep(.3)
        setting('panel-bar-count','3'); setting('panel-pinned-providers','["claude","codex"]')
        call('Select','(s)',('copilot',)); wait(lambda:shown()==['claude','codex','copilot'])
        wheel(1,*point()); wait(lambda:shown()==['claude','codex','antigravity'])
        wheel(-1,*point()); wait(lambda:shown()==['claude','codex','copilot'])
        return shown()
    step('two-pins-and-free-slot',two_pins)
    def reduce_count():
        setting('panel-bar-count','1');call('Select','(s)',('claude',));wait(lambda:shown()==['claude'])
        wheel(1,*point());wait(lambda:shown()==['copilot']);return shown()
    step('reduce-provider-count',reduce_count)
    if TRAY:
        def resize_tray():
            setting('panel-pinned-providers','[]')
            observations = []
            for count in [3, 1, 2, 1]:
                setting('panel-bar-count',str(count)); call('Select','(s)',('codex',))
                wait(lambda:len(shown())==count and shown()[0]=='codex')
                wheel(1,*point()); wait(lambda:shown()[0]=='claude')
                wheel(-1,*point()); wait(lambda:shown()[0]=='codex')
                if tray_companion: assert companion_registered(), 'An unrelated tray application disappeared'
                observations.append({'count':count,'providers':shown(),'companion':bool(tray_companion)})
            return observations
        step('tray-count-changes-preserve-scrolling',resize_tray)
    setting('panel-bar-count','2'); setting('panel-pinned-providers','[]')
    call('Select','(s)',('codex',))
    step('unpin-provider',lambda:wait(lambda:state()['panel']==['codex','claude']))
    if os.environ.get('USAGESTAT_LAB_CORE_ONLY')!='1': placement_checks()
    def preferences():
        call('Preferences','(s)',('',))
        if TARGET=='hyprland':
            return wait(lambda:next((dict(x=w['at'][0],y=w['at'][1],w=w['size'][0],h=w['size'][1])
                for w in json.loads(command('hyprctl','clients','-j')) if 'UsageStat' in w['title']),None))
        if WAYLAND:
            if TARGET in ['cosmic','budgie']:
                from toplevels import titles
                wait(lambda:any('UsageStat Preferences' in title for title in titles()))
            return wait(light_surface)
        return wait(lambda:next((measure(w) for w in command('xdotool','search','--onlyvisible','--name','UsageStat Preferences',check=False).splitlines()),None))
    step('preferences-window',preferences)


try:
    main()
except Exception as error:
    checks.append({'name':'session-setup','status':'failed','error':str(error),'traceback':traceback.format_exc()})
    (OUT/'result.json').write_text(json.dumps({'target':TARGET,'status':'failed','checks':checks},indent=2))
    print(traceback.format_exc(),flush=True)
finally:
    if tray_monitor: tray_monitor.terminate()
    if tray_companion: tray_companion.terminate()
    if anchor_monitor: anchor_monitor.terminate()
    (OUT/'recording.stop').touch()
    time.sleep(2)
