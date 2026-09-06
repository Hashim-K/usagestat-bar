import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {assert, equal} from '../assert.js';
import {settings, ROOT} from '../../platforms/linux/settings.js';
import {Model, selectedUsage, panelProviders, thresholds, thresholdAt, windows, resetText, safeUrl} from '../../platforms/linux/model.js';
import {escapeXml, escapePolybar, panelSvg, waybarOutput, logoSvg} from '../../platforms/linux/render.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const prefs = settings();
const usage = {primary:{usedPercent:25}, secondary:{usedPercent:80}};
test('automatic panel usage averages standard windows', () => equal(selectedUsage(usage),52.5));
test('a selected window overrides the automatic mean', () => equal(selectedUsage(usage,{panelUsageTier:'secondary'}),80));
test('hidden selection falls back to the visible average', () => equal(selectedUsage(usage,{panelUsageTier:'secondary',hiddenWindows:['secondary']}),25));
test('automatic excludes extra windows while explicit selection supports them', () => {
    const data = {...usage,extraRateWindows:[{id:'extra',title:'Extra',window:{usedPercent:100}}]};
    equal(selectedUsage(data),52.5); equal(selectedUsage(data,{panelUsageTier:'extra'}),100);
});
test('exhausted primary falls back to paid quota', () => equal(selectedUsage({primary:{usedPercent:100},providerCost:{used:20,limit:80}}),25));
test('hidden paid quota does not override standard usage', () => equal(selectedUsage({primary:{usedPercent:100},providerCost:{used:20,limit:80}},{hiddenWindows:['extraUsage']}),100));
test('no quota is unavailable rather than reported as unused', () => equal(selectedUsage({}),null));
test('clamp each standard window before averaging', () => equal(selectedUsage({primary:{usedPercent:125},secondary:{usedPercent:-10}}),50));
test('all extra window units and reset metadata survive', () => {
    const data={extraRateWindows:[{id:'api',title:'API',window:{usedPercent:22,used:22,limit:100,format:{kind:'count'},resetsAt:'2099-01-01'}}]};
    equal(windows(data)[0],{id:'api',label:'API',...data.extraRateWindows[0].window});
});
test('pinned provider order is stable and child sources never occupy panel slots', () => {
    const providers=[{key:'a',parent:''},{key:'b',parent:''},{key:'child',parent:'a'},{key:'c',parent:''}];
    equal(panelProviders(providers,'b',['c'],2).map(p=>p.key),['c','b']);
});
test('highest threshold wins', () => equal(thresholdAt(95,thresholds(prefs)).id,'danger'));
test('threshold order is numeric and invalid colors cannot enter SVG', () => {
    prefs.set_string('usage-thresholds',JSON.stringify([{percent:90,id:'high',color:'"/><script>'},{percent:75,id:'low'}]));
    equal(thresholds(prefs).map(t=>t.id),['low','high']); equal(thresholds(prefs)[1].color,'#f6d32d');
    prefs.reset('usage-thresholds');
});
test('window reset description takes precedence', () => equal(resetText({resetDescription:'Daily',resetsAt:'2099-01-01'}),'Daily'));
test('invalid reset timestamps do not render Invalid Date', () => equal(resetText({resetsAt:'garbage'}),''));
test('relative reset uses the supplied clock', () => equal(resetText({resetsAt:'2026-01-15T13:30:00Z'},'relative',new Date('2026-01-15T12:00:00Z')),'Resets 1h 30m'));
test('non-web provider links are not executable', () => { equal(safeUrl('file:///etc/passwd'),''); equal(safeUrl('https://example.test'),'https://example.test'); });
test('XML text cannot introduce elements', () => equal(escapeXml('<b a="x">&'), '&lt;b a=&quot;x&quot;&gt;&amp;'));
test('Polybar provider text cannot inject click actions', () => { assert(!escapePolybar('%{A:danger:}x\ny').includes('%{')); assert(!escapePolybar('x\ny').includes('\n')); });
test('SVG provider labels and color settings cannot introduce markup', () => {
    const provider = {key:'a',name:'<script>&',percent:0,used:0,color:'#8ab4f8',windows:[],iconId:'codex'};
    const state={providers:[provider],panel:['a'],appearance:{components:['bar','text'],bars:1,layout:'vertical',spacing:4,neutral:'#e6edf3'}};
    const svg=panelSvg(state); assert(svg.includes('&lt;script&gt;&amp;')); assert(!svg.includes('<script>'));
});
test('Waybar emits JSON with escaped text and used-quota threshold classes', () => {
    const p={key:'a',name:'A & B',percent:5,used:95,text:'5% left',parent:'',error:''};
    const result=waybarOutput({providers:[p],panel:['a'],active:'a',appearance:{components:['text','percent']}});
    equal(result.class,'danger'); assert(result.text.includes('A &amp; B'));
});
test('logo SVG preserves root fill and has intrinsic pixel dimensions', () => {
    const svg=logoSvg({iconId:'codex',percent:25},{neutral:'#23262e',fill:'vertical'});
    assert(svg.includes('fill="#23262e"')); assert(svg.includes('quotaClip')); assert(svg.includes('<path'));
});

const loop=new GLib.MainLoop(null,false);
let failure=0;
(async()=>{
    const fixture=`${ROOT}/tests/fixtures/usagestat`;
    prefs.set_string('usagestat-cli-path',fixture);
    prefs.set_int('refresh-interval',0);
    for(const [i,[name,fn]] of tests.entries()){
        try {await fn(); print(`ok ${i+1} - ${name}`);}
        catch(error){failure++;printerr(`not ok - ${name}: ${error.message}`);}
    }
    let model;
    try {
        const notifications=[];
        model=new Model(prefs,()=>{},(title,body)=>notifications.push({title,body}));
        await model.refresh();
        equal(model.snapshot().providers.length,3);
        equal(model.snapshot().providers[0].used,52.5);
        prefs.set_string('usage-thresholds',JSON.stringify([{id:'warning',label:'Warning',percent:75,color:'#f6d32d',notify:true}]));
        model.checkThreshold(model.providers[0],{usage:{primary:{usedPercent:80}}});
        equal(notifications.length,1);
        model.checkThreshold(model.providers[0],{usage:{primary:{usedPercent:80}}});
        model.checkThreshold(model.providers[0],{usage:{primary:{usedPercent:20}}});
        equal(notifications.length,1);
        model.checkThreshold(model.providers[0],{usage:{primary:{usedPercent:90}}});
        equal(notifications.length,2);
        print(`ok ${tests.length+1} - real fixture refresh, notifications suppress first/repeated/downward observations`);
    } catch(error){failure++;printerr(`not ok - model integration: ${error.message}\n${error.stack}`);}
    finally{model?.close();}
    print(`1..${tests.length+1}`);
})().finally(()=>loop.quit());
loop.run();
System.exit(failure?1:0);
