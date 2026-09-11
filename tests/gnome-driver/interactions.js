import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, equal} from './assert.js';

const delay = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve(); return GLib.SOURCE_REMOVE;
}));
const bounds = actor => {
    const [x,y] = actor.get_transformed_position(), [w,h] = actor.get_transformed_size();
    return {x,y,w,h};
};

export async function runInteractions(driver) {
    await driver._until(() => driver._app()?._indicator && !driver._app()._loading &&
        driver._app()._visibleProviders?.length === 4, 'four fixture providers');
    const app = driver._app(), settings = app._settings, results = [];
    Main.overview.hide(); await delay(700);
    const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const move = async (x,y) => { pointer.notify_absolute_motion(GLib.get_monotonic_time(),x,y); await delay(100); };
    const click = async (x,y) => {
        await move(x,y);
        pointer.notify_button(GLib.get_monotonic_time(),1,Clutter.ButtonState.PRESSED);
        await delay(70);
        pointer.notify_button(GLib.get_monotonic_time(),1,Clutter.ButtonState.RELEASED);
        await delay(300);
    };
    const wheel = async (direction, actor) => {
        const rect=bounds(actor); await move(rect.x+Math.min(rect.w/2,60),rect.y+rect.h/2);
        pointer.notify_discrete_scroll(GLib.get_monotonic_time(),direction>0?Clutter.ScrollDirection.DOWN:Clutter.ScrollDirection.UP,Clutter.ScrollSource.WHEEL);
        await delay(300);
    };
    const barClick = () => { const r=bounds(app._indicator); return click(r.x+r.w/2,r.y+r.h/2); };
    const shown = () => app._panelProviders(settings.get_int('panel-bar-count')).map(p=>p.instanceId||p.id);
    const output=GLib.getenv('USAGESTAT_TEST_OUTPUT_DIR');
    GLib.mkdir_with_parents(`${output}/frames`,0o700);
    let running=true, queue=Promise.resolve(), frame=0;
    const capture = name => {
        queue=queue.then(async () => {
            const stream=Gio.File.new_for_path(`${output}/${name}.png`).replace(null,false,Gio.FileCreateFlags.PRIVATE,null);
            try { await new Shell.Screenshot().screenshot(true,stream); } finally { stream.close(null); }
        });
        return queue;
    };
    const recording=(async () => {
        const start=GLib.get_monotonic_time();
        while(running) {
            await capture(`frames/${String(frame++).padStart(5,'0')}`);
            await delay(Math.max(1,(start+frame*200000-GLib.get_monotonic_time())/1000));
        }
    })();
    const started=GLib.get_monotonic_time();
    const check=async (name,action) => {
        const result={name,seconds:(GLib.get_monotonic_time()-started)/1e6};
        try { result.observation=await action(); result.status='passed'; }
        catch(error) { result.status='failed'; result.error=`${error.message}\n${error.stack}`; }
        result.screenshot=`${String(results.length+1).padStart(2,'0')}-${name}.png`;
        await capture(result.screenshot.slice(0,-4)); results.push(result);
    };
    const setupActive=id=>{app._activeId=id;app._render();};
    try {
        settings.set_int('panel-bar-count',2);
        settings.set_string('panel-position','left');
        settings.set_boolean('scroll-to-switch-provider',true);
        settings.set_boolean('scroll-popup-to-switch-provider',true);
        await delay(300);
        await check('initial-panel',()=>bounds(app._indicator));
        await check('pin-provider',async()=>{
            settings.set_string('panel-pinned-providers','["codex"]'); setupActive('claude'); await delay(300);
            equal(shown(),['codex','claude']); return shown();
        });
        await check('bar-scroll-both-directions',async()=>{
            const seen=[];
            for(const direction of [1,1,1,-1,-1,-1]) {
                const before=shown(); await wheel(direction,app._indicator);
                equal(shown()[0],'codex'); assert(shown()[1]!==before[1],'Wheel did not advance the free slot');
                assert(app._activeId!=='codex','Bar scrolling selected the pin'); seen.push(shown());
            }
            return seen;
        });
        await check('bar-scroll-disabled',async()=>{
            settings.set_boolean('scroll-to-switch-provider',false); const before=app._activeId;
            await wheel(1,app._indicator); equal(app._activeId,before);
            settings.set_boolean('scroll-to-switch-provider',true);
        });
        await check('click-opens-popup',async()=>{await barClick(); assert(app._indicator.menu.isOpen); return bounds(app._indicator.menu.actor);});
        await check('popup-scroll-both-directions',async()=>{
            setupActive('claude'); await delay(200); await wheel(-1,app._switcher); equal(app._activeId,'codex');
            await wheel(1,app._switcher); equal(app._activeId,'claude');
            settings.set_boolean('scroll-popup-to-switch-provider',false); await wheel(1,app._switcher); equal(app._activeId,'claude');
            settings.set_boolean('scroll-popup-to-switch-provider',true);
        });
        await check('outside-click-dismisses',async()=>{await click(1400,850); assert(!app._indicator.menu.isOpen);});
        await check('second-click-toggles',async()=>{await barClick();assert(app._indicator.menu.isOpen);await barClick();assert(!app._indicator.menu.isOpen);});
        await check('two-pins-and-free-slot',async()=>{
            settings.set_int('panel-bar-count',3); settings.set_string('panel-pinned-providers','["claude","codex"]');
            setupActive('copilot'); await delay(200); equal(shown(),['claude','codex','copilot']);
            await wheel(1,app._indicator); equal(shown(),['claude','codex','antigravity']);
            await wheel(-1,app._indicator); equal(shown(),['claude','codex','copilot']);return shown();
        });
        await check('reduce-provider-count',async()=>{
            settings.set_int('panel-bar-count',1); setupActive('claude');await delay(300);
            equal(shown(),['claude']); await wheel(1,app._indicator); equal(shown(),['copilot']);return shown();
        });
        settings.set_int('panel-bar-count',2);settings.set_string('panel-pinned-providers','[]');await delay(300);
        for(const region of ['left','center','right']) {
            await check(`panel-region-${region}`,async()=>{
                if(app._indicator.menu.isOpen) await barClick();
                settings.set_string('panel-position',region);settings.set_int('panel-index',0);await delay(300);
                equal(app._indicator.container.get_parent(),Main.panel[`_${region}Box`]);
                await barClick();assert(app._indicator.menu.isOpen); return {bar:bounds(app._indicator),popup:bounds(app._indicator.menu.actor)};
            });
        }
        await check('panel-item-index',async()=>{
            if(app._indicator.menu.isOpen) await barClick();
            settings.set_string('panel-position','left');settings.set_int('panel-index',0);await delay(300);
            const before=bounds(app._indicator);settings.set_int('panel-index',1);await delay(300);
            equal(Main.panel._leftBox.get_children().indexOf(app._indicator.container),1);
            assert(bounds(app._indicator).x!==before.x,'Item index did not move the indicator');
            await barClick();return {before,after:bounds(app._indicator),popup:bounds(app._indicator.menu.actor)};
        });
        const aligned={};
        for(const alignment of ['left','center','right']) {
            await check(`popup-alignment-${alignment}`,async()=>{
                if(app._indicator.menu.isOpen) await barClick();
                settings.set_string('panel-position','center');settings.set_string('popup-alignment',alignment);await delay(300);
                await barClick();const before=bounds(app._indicator.menu.actor);
                await barClick();await barClick();const after=bounds(app._indicator.menu.actor);
                assert(Math.abs(before.x-after.x)<2&&Math.abs(before.y-after.y)<2,'Reopening moved the popup');
                const section=bounds(app._indicator), f={left:0,center:.5,right:1}[alignment];
                const work=Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.findIndexForActor(app._indicator));
                const inset=app._indicator.menu.actor.get_theme_node().get_length('-arrow-rise');
                const desired=section.x+(section.w-after.w)*f;
                const expected=Math.max(work.x+inset,Math.min(desired,work.x+work.width-after.w-inset));
                const error=after.x-expected;
                assert(Math.abs(error)<=2,`Popup misses the UsageStat section by ${error}px (${alignment}): expected ${expected}, actual ${after.x}`);
                aligned[alignment]={section,popup:after,expectedStart:expected,errorPixels:error,clamped:expected!==desired};
                return aligned[alignment];
            });
        }
        await check('popup-alignment-section',()=>{equal(Object.keys(aligned).length,3);return aligned;});
        results.push({name:'panel-edge-bottom-left-right',status:'unsupported',reason:'The native GNOME Shell top panel has a fixed screen edge.'});
        if(app._indicator.menu.isOpen) await barClick();
        await check('preferences-window',async()=>{
            await app.openPreferences();await driver._until(()=>global.get_window_actors().some(a=>a.mapped&&a.meta_window.get_title()?.includes('UsageStat')),'preferences window');
        });
    } finally { running=false; await recording; driver._finish(results); }
}
