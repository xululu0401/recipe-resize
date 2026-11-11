/* 批次 55 浏览器验收脚本：改方子（recipe-resize）
 * 用法：先确保没有别的会话占用 profile，再
 *   node 验收脚本.cjs --tag 本地
 *   node 验收脚本.cjs --tag 线上 --url https://xululu0401.github.io/recipe-resize/
 * 脚本自己会 close --all 再带 --download-path 起一次（该选项只在守护进程启动时生效）。
 * 断言全部走真实 DOM 事件；控制台先自证采集器有效再清零；四种下载真实点击并核对落盘。
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const AB = '/Users/xululu/.workbuddy/binaries/node/versions/22.22.2-6/bin/agent-browser';
const SESSION = process.env.B55_SESSION || 'codex55';
const TAG = (process.argv.indexOf('--tag') >= 0 ? process.argv[process.argv.indexOf('--tag') + 1] : '') || '本地';
const DL = process.env.B55_DL || '/tmp/rr55-dl';
const URL_ARG = (process.argv.indexOf('--url') >= 0 ? process.argv[process.argv.indexOf('--url') + 1] : '');
const LOCAL = 'file://' + path.join(__dirname, 'index.html');
const APP_URL = URL_ARG || LOCAL;
const OUT = path.join(ROOT, 'evidence', '浏览器验收结果-' + TAG + '.txt');
const SUM = path.join(ROOT, 'evidence', '浏览器验收摘要-' + TAG + '.json');

let lines = [], pass = 0, fail = 0, evals = 0;
const groups = {};
let curGroup = 'G0';
function group(n) { curGroup = n; groups[n] = groups[n] || { pass: 0, fail: 0 }; lines.push(''); lines.push('## ' + n); }
function ok(c, label, extra) {
  const line = (c ? 'PASS  ' : 'FAIL  ') + '[' + curGroup + '] ' + label + (extra !== undefined && extra !== '' ? '  :: ' + extra : '');
  lines.push(line);
  if (c) { pass++; groups[curGroup].pass++; } else { fail++; groups[curGroup].fail++; }
}
function note(t) { lines.push('      ' + t); }
function asObj(v) { if (v && typeof v === 'object') return v; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return {}; } } return {}; }

function ev(js) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    evals++;
    try {
      const raw = execFileSync(AB, ['--session', SESSION, '--json', 'eval', js],
        { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180000 });
      const last = raw.trim().split('\n').filter(Boolean).pop();
      const o = JSON.parse(last);
      if (!o.success) throw new Error('eval 失败: ' + JSON.stringify(o.error));
      let r = o.data && ('result' in o.data ? o.data.result : o.data);
      while (typeof r === 'string') {
        const t = r.trim();
        if (!(t.charAt(0) === '{' || t.charAt(0) === '[')) break;
        try { const n = JSON.parse(r); if (n === r) break; r = n; } catch (e) { break; }
      }
      return r;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
function cli(args) { return execFileSync(AB, ['--session', SESSION].concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 }); }
/* agent-browser 的视口命令是 set viewport w h（不是 --window-size） */
function launchAt(w, h) { return cli(['set', 'viewport', String(w), String(h)]); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* 采集器自证：先制造一条 warn 与一条 error，确认能记到，再清零 */
const ARM = `(()=>{window.__errs=window.__errs||[];window.__warns=window.__warns||[];
  if(!window.__armed){
    window.__armed=1;
    window.addEventListener('error',function(e){window.__errs.push(String(e.message));});
    window.addEventListener('unhandledrejection',function(e){window.__errs.push('rej:'+String(e.reason));});
    var ow=console.warn,oe=console.error;
    console.warn=function(){window.__warns.push([].slice.call(arguments).join(' '));ow.apply(console,arguments);};
    console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments);};
  }
  return 'armed';})()`;
const PROBE_ARMED = `(()=>{var w0=window.__warns.length,e0=window.__errs.length;
  console.warn('采集器自证-warn');console.error('采集器自证-error');
  var w=window.__warns.length-w0,e=window.__errs.length-e0;
  window.__warns.length=0;window.__errs.length=0;
  return JSON.stringify({w:w,e:e});})()`;
const PROBE_CLEAN = `(()=>{return JSON.stringify({errs:window.__errs.slice(),warns:window.__warns.slice()});})()`;

const REAL_CLICK = `function realClick(el){
  if(!el) return 'no-el';
  el.scrollIntoView({block:'center'});
  var r=el.getBoundingClientRect();
  var opts={bubbles:true,cancelable:true,composed:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,view:window};
  ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){
    var E = (t.indexOf('pointer')===0 && window.PointerEvent) ? PointerEvent : MouseEvent;
    el.dispatchEvent(new E(t,opts));
  });
  return 'clicked';
}`;
function clickSel(sel) { return ev('(()=>{' + REAL_CLICK + ';var el=document.querySelector(' + JSON.stringify(sel) + ');return realClick(el);})()'); }
function clickText(sel, text) {
  return ev(`(()=>{${REAL_CLICK};var els=[].slice.call(document.querySelectorAll(${JSON.stringify(sel)}));
    var t=${JSON.stringify(text)};
    var el=els.filter(function(e){return e.textContent.indexOf(t)>=0;})[0];
    if(!el) return 'no-el'; return realClick(el);})()`);
}
function setVal(sel, val) {
  return ev(`(()=>{var el=document.querySelector(${JSON.stringify(sel)});if(!el)return 'no-el';
    el.value=${JSON.stringify(String(val))};
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return el.value;})()`);
}
function setCheck(sel, v) {
  return ev(`(()=>{var el=document.querySelector(${JSON.stringify(sel)});if(!el)return 'no-el';
    if(el.checked!==${v}){el.checked=${v};el.dispatchEvent(new Event('change',{bubbles:true}));}
    return el.checked;})()`);
}

function readState() {
  return asObj(ev(`(()=>{return JSON.stringify({
    ticketAmt:document.getElementById('ticket-vt').textContent,
    ticketWhy:document.getElementById('ticket-vw').textContent,
    sameH:document.getElementById('diag-sameheight').textContent,
    readout:[].slice.call(document.querySelectorAll('#readout .ro')).map(function(d){
      return [d.querySelector('.l').textContent,d.querySelector('.v').textContent,d.querySelector('.s').textContent].join('|');}),
    bars:[].slice.call(document.querySelectorAll('#bars .bar')).map(function(b){
      return b.querySelector('.bl').textContent+'='+b.querySelector('.bv').textContent;}),
    barW:[].slice.call(document.querySelectorAll('#bars .bf')).map(function(f){return f.style.width;}),
    geo:[].slice.call(document.querySelectorAll('#geo-body tr')).map(function(t){return t.innerText.replace(/\\s+/g,' ').trim();}),
    geoNotes:document.querySelectorAll('#geo-notes li').length,
    newRows:document.querySelectorAll('#new-body tr').length,
    newText:[].slice.call(document.querySelectorAll('#new-body tr')).map(function(t){return t.innerText.replace(/\\s+/g,' ').trim();}),
    newSum:document.getElementById('new-sum').textContent,
    closeA:document.getElementById('closeA-body').innerText.replace(/\\s+/g,' ').trim(),
    closeB:document.getElementById('closeB-body').innerText.replace(/\\s+/g,' ').trim(),
    closeBody:[].slice.call(document.querySelectorAll('#close-body tr')).map(function(t){return t.innerText.replace(/\\s+/g,' ').trim();}),
    choice:document.getElementById('close-choice').textContent,
    aPressed:document.getElementById('btn-apply-A').getAttribute('aria-pressed'),
    bPressed:document.getElementById('btn-apply-B').getAttribute('aria-pressed'),
    advice:[].slice.call(document.querySelectorAll('#advice-body .advice')).map(function(d){return d.innerText.replace(/\\s+/g,' ').trim();}),
    adviceBtns:document.querySelectorAll('#advice-body .advice .btn').length,
    revEgg:document.querySelectorAll('#rev-egg tr').length,
    revEggText:[].slice.call(document.querySelectorAll('#rev-egg tr')).map(function(t){return t.innerText.replace(/\\s+/g,' ').trim();}),
    revShape:[].slice.call(document.querySelectorAll('#rev-shape tr')).map(function(t){return t.innerText.replace(/\\s+/g,' ').trim();}),
    revInch:[].slice.call(document.querySelectorAll('#rev-inch tr')).map(function(t){return t.innerText.replace(/\\s+/g,' ').trim();}),
    diaRows:document.querySelectorAll('#dia-body tr').length,
    diaText:[].slice.call(document.querySelectorAll('#dia-body tr')).map(function(t){return t.innerText.replace(/\\s+/g,' ').trim();}),
    htRows:document.querySelectorAll('#ht-body tr').length,
    chk:document.querySelectorAll('#sc-body .ck').length,
    chkFail:document.querySelectorAll('#sc-body .ck.f').length,
    scCount:document.getElementById('sc-count').textContent,
    notes:document.querySelectorAll('#notes li').length,
    scenarios:document.querySelectorAll('#scenarios .chip').length,
    rowInputs:document.querySelectorAll('#rows-body tr[data-row]').length,
    rowNames:[].slice.call(document.querySelectorAll('#rows-body input[id$="-name"]')).map(function(i){return i.value;}),
    liquid:[].slice.call(document.querySelectorAll('#rows-body input[type=checkbox]')).map(function(c){return c.checked;}),
    chipStep:[].slice.call(document.querySelectorAll('#f-roundStep .chip')).map(function(c){return c.getAttribute('data-v')+'='+c.getAttribute('aria-pressed');}),
    chipMode:[].slice.call(document.querySelectorAll('#f-roundMode .chip')).map(function(c){return c.getAttribute('data-v')+'='+c.getAttribute('aria-pressed');}),
    chipSrc:[].slice.call(document.querySelectorAll('#f-srcShape .chip')).map(function(c){return c.getAttribute('data-v')+'='+c.getAttribute('aria-pressed');}),
    chipDst:[].slice.call(document.querySelectorAll('#f-dstShape .chip')).map(function(c){return c.getAttribute('data-v')+'='+c.getAttribute('aria-pressed');}),
    inputs:(function(){var o={};['srcDia','srcLen','srcWid','srcHeight','dstDia','dstLen','dstWid','dstHeight','flourG','eggCount','eggG','label'].forEach(function(k){
      var e=document.getElementById('f-'+k);o[k]=e?e.value:null;});return o;})(),
    errShown:!document.getElementById('sec-errors').classList.contains('hidden'),
    errText:document.getElementById('err-list').innerText.replace(/\\s+/g,' ').trim(),
    errCount:document.querySelectorAll('#err-list li').length,
    badFields:[].slice.call(document.querySelectorAll('input.bad')).map(function(e){return e.id;}),
    hiddenCards:[].slice.call(document.querySelectorAll('section.card.hidden')).map(function(s){return s.id;}),
    shownCards:[].slice.call(document.querySelectorAll('section.card:not(.hidden)')).map(function(s){return s.id;}),
    fb:{k:document.getElementById('fb-k').textContent,flour:document.getElementById('fb-flour').textContent,
        egg:document.getElementById('fb-egg').textContent,sc:document.getElementById('fb-sc').textContent},
    docW:document.documentElement.scrollWidth, winW:window.innerWidth,
    bodyOverflow:document.body.scrollWidth>window.innerWidth+1,
    lsKey:window.__app.lsKey,
    hasStore:(function(){try{return !!localStorage.getItem(window.__app.lsKey);}catch(e){return false;}})()
  });})()`));
}

function snap(st) {
  return [st.ticketAmt, st.readout.join('~'), st.geo.join('~'), st.newText.join('~'), st.closeA, st.closeB, st.choice].join('||');
}

(async () => {
  fs.mkdirSync(path.join(ROOT, 'evidence'), { recursive: true });
  fs.mkdirSync(DL, { recursive: true });
  const startedAt = new Date().toISOString();
  lines.push('# 批次 55 浏览器验收 · ' + TAG + ' · ' + startedAt);
  lines.push('# URL ' + APP_URL + ' · 会话 ' + SESSION + ' · 下载目录 ' + DL);

  /* ── G0 ─────────────────────────────────────────────────────────── */
  group('G0 采集器自检');
  execFileSync(AB, ['close', '--all'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
  await sleep(1000);
  execFileSync(AB, ['--profile', process.env.B55_PROFILE || '/Users/xululu/.agent-browser/zhihu-profile',
    '--session', SESSION, '--download-path', DL, 'open', APP_URL],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 });
  await sleep(1600);
  await ev(ARM);
  const probe = asObj(ev(PROBE_ARMED));
  ok(probe.w === 1 && probe.e === 1, '故意制造的 1 条 warn + 1 条 error 都被采集器记到（采集器不是永远为空）', JSON.stringify(probe));
  const clean0 = asObj(ev(PROBE_CLEAN));
  ok(clean0.errs.length === 0 && clean0.warns.length === 0, '清零后页面自身 0 错 0 警', JSON.stringify(clean0));
  await ev(`(()=>{try{localStorage.removeItem(window.__app.lsKey);}catch(e){}window.__app.reset();return 'reset';})()`);

  /* ── G1 默认渲染与锚点 ─────────────────────────────────────────── */
  group('G1 默认渲染与锚点');
  let st = readState();
  ok(st.ticketAmt.indexOf('0.5625') >= 0, '结论句含料量比 0.5625', st.ticketAmt);
  ok(st.sameH.indexOf('等高') >= 0, '标注两模等高 → k 就是面积比', st.sameH);
  ok(st.readout.length === 5, '读数条 5 格', String(st.readout.length));
  const ro = st.readout.join(' § ');
  ok(ro.indexOf('面粉|56.25 g|按刻度称 56 g') >= 0, '读数条面粉 56.25 g / 按刻度 56 g', ro.slice(0, 80));
  ok(ro.indexOf('鸡蛋|2 个|目标 1.6875 个') >= 0, '读数条鸡蛋 2 个 / 目标 1.6875 个', ro.slice(0, 160));
  ok(ro.indexOf('新方总料重|222.19 g|原方 395 g') >= 0, '读数条总料重 222.19 g（原方 395 g）', ro.slice(0, 200));
  ok(ro.indexOf('按直径比缩会多放|33.33%|直径比 0.75 ≠ k 0.5625') >= 0, '读数条写明按直径比缩会多放 33.33%', ro.slice(0, 260));
  ok(st.bars.length === 3, '条形对比 3 条', JSON.stringify(st.bars));
  ok(st.bars[0].indexOf('0.75') >= 0 && st.bars[2].indexOf('0.5625') >= 0, '条形对比：错的 0.75 与对的 0.5625 并排', JSON.stringify(st.bars));
  ok(st.barW.length === 3 && st.barW.every(function (w) { return /%$/.test(w); }), '三条条都有宽度（不是 0）', JSON.stringify(st.barW));
  ok(st.geo.length === 4, '几何账 4 行', String(st.geo.length));
  ok(st.geo[0].indexOf('324.2928') >= 0 && st.geo[0].indexOf('182.4147') >= 0 && st.geo[0].indexOf('0.5625') >= 0,
    '几何账面积行：324.2928 / 182.4147 / 0.5625', st.geo[0]);
  ok(st.geo[0].indexOf('πD²/4') >= 0, '几何账写明面积公式 πD²/4', st.geo[0].slice(0, 90));
  ok(st.geo[2].indexOf('1945.7567') >= 0 && st.geo[2].indexOf('1094.4882') >= 0, '几何账容积行 1945.7567 / 1094.4882', st.geo[2]);
  ok(st.geo[3].indexOf('面积比 0.5625 × 高度比 1') >= 0, '几何账末行写明 k 的构成', st.geo[3]);
  ok(st.geoNotes === 3, '几何账脚注 3 条', String(st.geoNotes));
  ok(st.newRows === 6, '新方对照表 6 行（面粉+3 配料+蛋+合计）', String(st.newRows));
  const nt = st.newText.join(' § ');
  ok(nt.indexOf('面粉（基准） 100% 100 56.25 56') >= 0, '面粉行 100 → 56.25 → 56', st.newText[0]);
  ok(nt.indexOf('牛奶（液体） 60% 60 33.75 34') >= 0, '牛奶行 60 → 33.75 → 34', st.newText[1]);
  ok(nt.indexOf('细砂糖 45% 45 25.3125 25') >= 0, '细砂糖行 45 → 25.3125 → 25', st.newText[2]);
  ok(nt.indexOf('玉米油 40% 40 22.5 23') >= 0, '玉米油行 40 → 22.5 → 23（半格向上）', st.newText[3]);
  ok(nt.indexOf('3 个 = 150 g') >= 0 && nt.indexOf('目标 84.375 g（1.6875 个）') >= 0, '鸡蛋行写明原方 150 g → 目标 84.375 g（1.6875 个）', st.newText[4]);
  ok(nt.indexOf('合计（含蛋液）') >= 0 && st.newText[5].indexOf('222.1875') >= 0, '合计行含精确总料重 222.1875', st.newText[5]);
  ok(st.newSum.indexOf('k = 0.5625') >= 0, '表头角标写明 k 与总料', st.newSum);
  ok(st.closeA.indexOf('84.375') >= 0 && st.closeA.indexOf('100 g') >= 0 && st.closeA.indexOf('15.625') >= 0, '收口①写明 84.375 g → 100 g、差额 15.625 g', st.closeA.slice(0, 120));
  ok(st.closeA.indexOf('33.75 → 18.125') >= 0, '收口①把牛奶从 33.75 扣到 18.125', st.closeA);
  ok(st.closeA.indexOf('118.125 g = 改完 118.125 g') >= 0, '收口①总液体守恒在 118.125 g 两侧相等', st.closeA);
  ok(st.closeB.indexOf('66.6667') >= 0 && st.closeB.indexOf('0.666667') >= 0, '收口②写明面粉″ 66.6667 与 k″ 0.666667', st.closeB.slice(0, 140));
  ok(st.closeB.indexOf('18.518%') >= 0, '收口②写明与目标 k 相差 18.518%', st.closeB);
  ok(st.closeB.indexOf('φ16.59') >= 0, '收口②给出等价的 φ16.59 cm', st.closeB);
  ok(st.closeBody.length === 5, '两种收口并排表 5 行', String(st.closeBody.length));
  ok(st.closeBody[0].indexOf('56.25 66.6667 56.25') >= 0, '并排表面粉行 = ①56.25 / ②66.6667 / 只按 k 56.25', st.closeBody[0]);
  ok(st.choice.indexOf('还没定') >= 0, '收口选择初始为「还没定」', st.choice);
  ok(st.advice.length === 5, '处方 5 块', String(st.advice.length));
  ok(st.adviceBtns === 3, '处方里 3 个能改输入的按钮', String(st.adviceBtns));
  ok(st.advice.join(' § ').indexOf('多 18.75 g') >= 0, '处方写明按直径比缩会多 18.75 g', st.advice[0].slice(0, 100));
  ok(st.advice.join(' § ').indexOf('改成 16.59 cm') >= 0, '处方给出改成 φ16.59 的可执行建议', st.advice[1].slice(0, 90));
  ok(st.advice.join(' § ').indexOf('13.51 × 13.51') >= 0, '处方给出等面积方模 13.51 × 13.51', st.advice[2].slice(0, 90));
  ok(st.revEgg === 6, '反推表 6 行（0–5 个蛋）', String(st.revEgg));
  ok(st.revEggText[2].indexOf('66.67') >= 0 && st.revEggText[2].indexOf('收口②选的那一行') >= 0, '反推表 2 个蛋那行 = 66.67 g 且标注与收口②同一行', st.revEggText[2]);
  ok(st.revEggText[2].indexOf('每个蛋配 33.33') >= 0, '反推表口径写对：每个蛋配 33.33 g 面粉（不是"每 g 面粉配 33 g 蛋液"）', st.revEggText[2]);
  ok(st.revShape.length === 3, '圆↔方等价表 3 行', String(st.revShape.length));
  ok(st.revShape.join(' § ').indexOf('13.5061') >= 0, '等面积方模边长 13.5061 cm', st.revShape[1]);
  ok(st.revInch.length === 5, '寸换算表 5 行', String(st.revInch.length));
  ok(st.revInch[2].indexOf('20.32') >= 0 && st.revInch[2].indexOf('18.01') >= 0, '8 寸行：直径 20.32、等面积方模 18.01', st.revInch[2]);
  ok(st.diaRows === 5, '目标尺寸对照 5 行', String(st.diaRows));
  ok(st.diaText[2].indexOf('0.5625') >= 0 && st.diaText[2].indexOf('56.25') >= 0, '对照表 ×1.00 行与主结论一致（0.5625 / 56.25）', st.diaText[2]);
  ok(st.htRows === 5, '目标高度对照 5 行', String(st.htRows));
  ok(st.chk === 35 && st.chkFail === 0, '算式自检 35 条全部通过（0 条 FAIL）', st.scCount);
  ok(st.scCount.indexOf('35 / 35') >= 0, '自检计数文案与条目数一致', st.scCount);
  ok(st.fb.sc === '35/35', '底栏自检计数与自检区一致', st.fb.sc);
  ok(st.fb.k === '0.5625' && st.fb.flour === '56 g' && st.fb.egg === '2 个', '底栏三个读数与结论一致', JSON.stringify(st.fb));
  ok(st.notes === 6, '模型边界 6 条', String(st.notes));
  ok(st.scenarios === 6, '6 个内置场景', String(st.scenarios));
  ok(st.chipSrc.join() === 'round=true,rect=false', '原模形状默认圆模', JSON.stringify(st.chipSrc));
  ok(st.chipDst.join() === 'round=true,rect=false', '目标模形状默认圆模', JSON.stringify(st.chipDst));
  ok(st.chipStep.join() === '0.1=false,1=true,5=false', '刻度默认 1 g', JSON.stringify(st.chipStep));
  ok(st.chipMode.join() === 'nearest=true,up=false', '舍入口径默认四舍五入', JSON.stringify(st.chipMode));
  ok(st.inputs.srcDia === '20.32' && st.inputs.dstDia === '15.24' && st.inputs.flourG === '100', '尺寸与面粉输入框按默认填入', JSON.stringify(st.inputs).slice(0, 120));
  ok(st.inputs.eggCount === '3' && st.inputs.eggG === '50', '鸡蛋输入框 3 个 / 50 g', st.inputs.eggCount + '/' + st.inputs.eggG);
  ok(st.rowInputs === 3 && st.liquid.join() === 'true,false,false', '三行配料，只有牛奶勾成液体', JSON.stringify(st.liquid));
  ok(!st.errShown && st.hiddenCards.length === 0, '初始没有错误区、没有结果卡被藏起来', JSON.stringify(st.hiddenCards));

  /* ── G2 改条件与交互 ───────────────────────────────────────────── */
  group('G2 改条件与交互');
  const baseSnap = snap(st);
  await setVal('#f-dstDia', '20.32');
  st = readState();
  ok(st.ticketAmt.indexOf('k = 1') >= 0 || st.ticketAmt.indexOf('不用改') >= 0, '目标改成 φ20.32 → k = 1、提示不用改', st.ticketAmt);
  ok(st.readout.join(' § ').indexOf('面粉|100 g') >= 0, 'k=1 时面粉 100 g', st.readout[1]);
  ok(st.readout.join(' § ').indexOf('鸡蛋|3 个') >= 0, 'k=1 时鸡蛋 3 个', st.readout[2]);
  ok(st.bars.some(function (b) { return b.indexOf('0.75') >= 0; }) === false, 'k=1 时不再显示「按直径比缩」那条（无意义）', JSON.stringify(st.bars));
  await setVal('#f-dstDia', '15.24');
  st = readState();
  ok(snap(st) === baseSnap, '把尺寸改回去后逐字复原（与改动前完全一致）');

  await setVal('#f-dstHeight', '7.5');
  st = readState();
  ok(st.readout.join(' § ').indexOf('0.7031') >= 0, '目标模加高到 7.5 → k = 0.7031（0.5625 × 1.25）', st.readout[0]);
  ok(st.sameH.indexOf('不等高') >= 0, '标注两模不等高 → k 含高度比', st.sameH);
  ok(st.readout.join(' § ').indexOf('面粉|70.31 g') >= 0, '不等高时面粉 70.31 g', st.readout[1]);
  await setVal('#f-dstHeight', '6');

  await clickText('#f-dstShape .chip', '方模');
  st = readState();
  ok(st.chipDst.join() === 'round=false,rect=true', '切成方模后 chip 状态正确', JSON.stringify(st.chipDst));
  ok(st.inputs.dstLen !== '' && st.inputs.dstWid !== '', '切方模后长宽字段有值', st.inputs.dstLen + '×' + st.inputs.dstWid);
  await setVal('#f-dstLen', '18');
  await setVal('#f-dstWid', '18');
  st = readState();
  ok(st.geo[0].indexOf('324') >= 0 && st.geo[0].indexOf('πD²/4') >= 0 && st.geo[0].indexOf('长 × 宽') >= 0, '方模面积按长×宽算（同时保留原模的 πD²/4）', st.geo[0]);
  ok(st.readout.join(' § ').indexOf('0.9991') >= 0 || st.readout.join(' § ').indexOf('0.999') >= 0, '18×18 方模与 φ20.32 圆模的 k ≈ 0.999', st.readout[0]);
  ok(st.bars.length === 2, '圆对方才谈直径比 → 切成方模后只剩 2 条', JSON.stringify(st.bars));
  const advTxt = st.advice.join(' § ');
  ok(advTxt.indexOf('手边只有方模') < 0, '已经是方模时不再给「手边只有方模」这条（不给自相矛盾的建议）', advTxt.slice(0, 100));
  ok(advTxt.indexOf('整好用完') < 0, '18×18 方模与 φ20.32 圆模几乎等面积（k≈1），不再给多余的等价模建议', advTxt.slice(0, 100));
  ok(advTxt.indexOf('φ cm') < 0, '建议文案里没有漏数字的空模板（"φ cm"这种）', advTxt.slice(0, 120));
  await clickText('#f-dstShape .chip', '圆模');
  await setVal('#f-dstDia', '15.24');
  st = readState();
  ok(snap(st) === baseSnap, '切回圆模 + 原尺寸后逐字复原');

  await clickSel('#f-roundStep .chip[data-v="0.1"]');
  st = readState();
  ok(st.chipStep.join() === '0.1=true,1=false,5=false', '刻度切到 0.1 g', JSON.stringify(st.chipStep));
  ok(st.newText[0].indexOf('56.3') >= 0, '0.1 g 刻度下 56.25 → 56.3（半格向上）', st.newText[0]);
  await clickSel('#f-roundMode .chip[data-v="up"]');
  st = readState();
  ok(st.chipMode.join() === 'nearest=false,up=true', '口径切到一律向上', JSON.stringify(st.chipMode));
  ok(st.newText[0].indexOf('56.3') >= 0, '一律向上 + 0.1 刻度 → 面粉 56.3', st.newText[0]);
  await clickSel('#f-roundMode .chip[data-v="nearest"]');
  await clickSel('#f-roundStep .chip[data-v="1"]');
  st = readState();
  ok(snap(st) === baseSnap, '刻度与口径改回后逐字复原');

  await setVal('#f-eggCount', '0');
  st = readState();
  ok(st.closeA.indexOf('没有鸡蛋') >= 0 && st.closeB.indexOf('没有鸡蛋') >= 0, '0 个蛋时两条收口都写明"没有鸡蛋、不适用"', st.closeA.slice(0, 40) + ' / ' + st.closeB.slice(0, 40));
  ok(/hidden/.test(await ev(`document.getElementById('btn-apply-A').className`)), '0 个蛋时"采用"按钮收起来（不给死按钮）');
  ok(st.newText[4].indexOf('0 个 = 0 g') >= 0, '0 个蛋时新方鸡蛋行显示 0 g', st.newText[4]);
  await setVal('#f-eggCount', '3');

  await setCheck('#f-row0-liquid', false);
  st = readState();
  ok(st.closeA.indexOf('没有任何一行被勾成') >= 0 && st.closeA.indexOf('无处可扣') >= 0, '一行液体都不勾时收口①写明原因', st.closeA.slice(0, 60));
  ok(st.closeB.indexOf('66.6667') >= 0, '收口②不受影响，仍然可用', st.closeB.slice(0, 40));
  ok(st.advice.join(' § ').indexOf('让收口①能用起来') >= 0, '处方里出现「让收口①能用起来」的可执行建议', st.advice[3].slice(0, 60));
  await setCheck('#f-row0-liquid', true);
  st = readState();
  ok(snap(st) === baseSnap, '勾回液体后逐字复原');

  await clickText('#btn-add-row', '加一行');
  st = readState();
  ok(st.rowInputs === 4, '加一行后 4 行', String(st.rowInputs));
  await setVal('#f-row3-name', '柠檬皮屑');
  await setVal('#f-row3-pct', '5');
  st = readState();
  ok(st.newText.length === 7, '新方表随之多一行', String(st.newText.length));
  ok(st.newText[4].indexOf('柠檬皮屑') >= 0, '新行出现在表里（在鸡蛋行之前）', st.newText[4]);
  await clickText('#rows-body tr[data-row="3"] .btn', '删除');
  st = readState();
  ok(st.rowInputs === 3, '删掉后回到 3 行', String(st.rowInputs));
  await clickText('#rows-body tr[data-row="0"] .btn', '↓');
  st = readState();
  ok(st.rowNames.join() === '细砂糖,牛奶,玉米油', '第 1 行下移后顺序变为 细砂糖/牛奶/玉米油', JSON.stringify(st.rowNames));
  ok(st.newText[1].indexOf('细砂糖') >= 0, '新方表第一行跟着变成细砂糖', st.newText[1].slice(0, 30));
  await clickText('#rows-body tr[data-row="1"] .btn', '↑');
  st = readState();
  ok(st.rowNames.join() === '牛奶,细砂糖,玉米油', '上移回去后顺序复原', JSON.stringify(st.rowNames));

  await clickText('#scenarios .chip', '8 寸圆模 → 8 寸方模');
  st = readState();
  ok(st.chipDst.join() === 'round=false,rect=true', '场景 2 把目标切成方模', JSON.stringify(st.chipDst));
  ok(st.inputs.dstLen === '18.01' && st.inputs.dstWid === '18.01', '场景 2 填入 18.01 × 18.01', st.inputs.dstLen + '×' + st.inputs.dstWid);
  ok(st.chkFail === 0, '场景 2 自检全过', st.scCount);
  await clickText('#scenarios .chip', '无蛋方子');
  st = readState();
  ok(st.inputs.eggCount === '0', '场景 5 把蛋数设为 0', st.inputs.eggCount);
  ok(st.rowNames.join() === '黄油,糖粉', '场景 5 换成黄油/糖粉两行', JSON.stringify(st.rowNames));
  await clickText('#scenarios .chip', '方盘 30×20');
  st = readState();
  ok(st.chipSrc.join() === 'round=false,rect=true' && st.chipDst.join() === 'round=false,rect=true', '场景 6 两个模都是方模', JSON.stringify(st.chipSrc));
  ok(st.inputs.srcLen === '30' && st.inputs.dstLen === '28', '场景 6 尺寸 30×20 → 28×28', st.inputs.srcLen + ',' + st.inputs.dstLen);
  ok(st.chkFail === 0, '场景 6 自检全过', st.scCount);

  /* 6 个场景逐个切一遍，每个都要自检全过 */
  let scenOK = 0, scenNote = [];
  for (let i = 0; i < st.scenarios; i++) {
    await ev(`(()=>{${REAL_CLICK};var b=document.querySelectorAll('#scenarios .chip')[${i}];return realClick(b);})()`);
    const s2 = readState();
    if (s2.chkFail === 0 && !s2.errShown && s2.chk >= 33) scenOK++;
    else scenNote.push(i + ':' + s2.scCount + (s2.errShown ? '/err' : ''));
  }
  ok(scenOK === 6, '6 个内置场景逐个切换，每个都 0 条自检不通过、无错误（条数随收口是否适用在 33–35 之间）', scenNote.length ? scenNote.join(' ') : '6/6');

  await ev(`(()=>{window.__app.reset();return 'ok';})()`);
  st = readState();
  ok(snap(st) === baseSnap, '恢复默认示例后逐字复原到初始状态');

  await clickSel('#btn-apply-B');
  st = readState();
  ok(st.bPressed === 'true' && st.choice.indexOf('② 按整蛋配平') >= 0, '点「采用这条」后收口②被标记为已采用', st.choice);
  const csvChoice = await ev(`(()=>{return window.__app.csvText().split('\\n').filter(function(l){return l.indexOf('已采用的收口')===0;})[0];})()`);
  ok(String(csvChoice).indexOf('② 按整蛋配平') >= 0, '采用了哪一条写进 CSV 导出（免得三天后忘了照哪张表称）', String(csvChoice));
  const mdChoice = await ev(`(()=>{return window.__app.mdText().split('\\n').filter(function(l){return l.indexOf('- 鸡蛋的收口')===0;})[0];})()`);
  ok(String(mdChoice).indexOf('② 按整蛋配平') >= 0, 'MD 导出同样写明采用的收口', String(mdChoice));
  await clickSel('#btn-apply-B');
  st = readState();
  ok(st.bPressed === 'false' && st.choice.indexOf('还没定') >= 0, '再点一次取消采用', st.choice);

  const beforeAdvice = readState();
  const clickAdvice = (needle) => ev(`(()=>{${REAL_CLICK};
    var box=[].slice.call(document.querySelectorAll('#advice-body .advice')).filter(function(d){return d.innerText.indexOf(${JSON.stringify(needle)})>=0;})[0];
    if(!box) return 'no-block';
    var b=box.querySelector('.btn'); if(!b) return 'no-btn'; return realClick(b);})()`);
  const c1 = await clickAdvice('手边只有方模');
  st = readState();
  ok(c1 === 'clicked', '找到「手边只有方模」那一块处方并点到它的按钮', String(c1));
  ok(st.chipDst.join() === 'round=false,rect=true', '点这一条真的把目标模改成方模', JSON.stringify(st.chipDst));
  ok(st.inputs.dstLen === '13.51' && st.inputs.dstWid === '13.51', '方模边长按建议填成 13.51', st.inputs.dstLen + '×' + st.inputs.dstWid);
  ok(!st.errShown, '改完没有报错', st.errText);
  note('处方点击前：' + beforeAdvice.readout[0]);
  note('处方点击后：' + st.readout[0]);

  /* 方模 + 偏差大时，等价模建议要用"长宽各改成"措辞 */
  await setVal('#f-dstLen', '12');
  await setVal('#f-dstWid', '12');
  st = readState();
  const advRect = st.advice.join(' § ');
  ok(advRect.indexOf('长宽各改成') >= 0, '方模且偏差大时，等价模建议按长宽措辞（不是给直径）', advRect.slice(0, 140));
  ok(advRect.indexOf('φ cm') < 0, '建议文案里没有漏数字的空模板', advRect.slice(0, 140));

  const c2 = await clickAdvice('恢复默认示例');
  st = readState();
  ok(c2 === 'clicked' && snap(st) === baseSnap, '点处方的「恢复默认示例」回到初始状态', String(c2));

  /* ── G3 非法输入 ───────────────────────────────────────────────── */
  group('G3 非法输入');
  await setVal('#f-flourG', '');
  st = readState();
  ok(st.errShown && st.errCount >= 1, '面粉留空 → 报错', st.errText.slice(0, 60));
  ok(st.badFields.indexOf('f-flourG') >= 0, '面粉那一格被标红', JSON.stringify(st.badFields));
  ok(st.hiddenCards.length === 8, '报错时结论/对照/收口/处方/反推/表格/自检 8 张卡全部收起（不给半截结果）', JSON.stringify(st.hiddenCards));
  ok(st.fb.k === '—' && st.fb.flour === '—' && st.fb.sc === '—', '报错时底栏读数清空为「—」', JSON.stringify(st.fb));
  await setVal('#f-flourG', '-1');
  st = readState();
  ok(st.errShown && st.errText.indexOf('面粉基准') >= 0, '面粉 -1 → 报出范围', st.errText.slice(0, 70));
  await setVal('#f-flourG', '5001');
  st = readState();
  ok(st.errShown, '面粉 5001 → 超上限报错', st.errText.slice(0, 50));
  await setVal('#f-flourG', '100');

  await setVal('#f-srcDia', '4');
  st = readState();
  ok(st.errShown && st.badFields.indexOf('f-srcDia') >= 0, '原模直径 4 cm → 低于下限并标红', st.errText.slice(0, 60));
  await setVal('#f-srcDia', '20.32');

  await setVal('#f-eggG', '0');
  st = readState();
  ok(st.errShown && st.badFields.indexOf('f-eggG') >= 0, '每个蛋的蛋液 0 g → 报错并标红', st.errText.slice(0, 60));
  await setVal('#f-eggG', '50');

  await setVal('#f-dstHeight', '0');
  st = readState();
  ok(st.errShown && st.badFields.indexOf('f-dstHeight') >= 0, '目标模高度 0 → 报错并标红', st.errText.slice(0, 60));
  await setVal('#f-dstHeight', '6');

  await setVal('#f-row1-pct', '');
  st = readState();
  ok(st.errShown && st.errCount >= 1 && st.errText.indexOf('细砂糖') >= 0, '某一行百分比留空 → 报错并点名那一行', st.errText.slice(0, 70));
  await setVal('#f-row1-pct', '45');

  await setVal('#f-flourG', 'abc');
  await setVal('#f-srcDia', '99');
  await setVal('#f-eggCount', '25');
  st = readState();
  ok(st.errCount >= 3, '一次多错一起报（≥3 条），不是只报第一条', st.errText.slice(0, 120));
  ok(st.badFields.length >= 3, '三格同时标红', JSON.stringify(st.badFields));
  await ev(`(()=>{window.__app.reset();return 'ok';})()`);
  st = readState();
  ok(!st.errShown && st.badFields.length === 0 && st.hiddenCards.length === 0, '恢复默认后错误区收起、红框消失、结果卡回来');
  ok(snap(st) === baseSnap, '恢复后数值逐字复原');

  /* ── G3c 退化与无解 ────────────────────────────────────────────── */
  group('G3c 退化与无解');
  await setVal('#f-dstDia', '6');
  st = readState();
  ok(st.readout.join(' § ').indexOf('鸡蛋|0 个') >= 0, '目标 φ6 cm → 建议 0 个蛋', st.readout[2]);
  ok(st.closeA.indexOf('用不上') >= 0 && st.closeB.indexOf('用不上') >= 0, '连一个蛋都用不上时两条收口都如实标"不适用"并给原因', st.closeA.slice(0, 80));
  ok(st.chkFail === 0, '这种退化输入下自检仍然全过（不该挂）', st.scCount);
  await clickSel('#f-roundStep .chip[data-v="5"]');
  st = readState();
  ok(st.newText.some(function (t, i) { return i > 0 && / 0 5| 0$/.test(t); }) || st.newText.join(' § ').indexOf(' 0 ') >= 0, '5 g 刻度下小数值被取整成 0 并如实显示', st.newText.slice(1, 4).join(' / '));
  await clickSel('#f-roundStep .chip[data-v="1"]');
  await setVal('#f-dstDia', '15.24');

  await setVal('#f-dstDia', '20.32');
  await setVal('#f-dstHeight', '6');
  st = readState();
  ok(st.ticketAmt.indexOf('不用改') >= 0, '同尺寸同高度 → 明确说"方子不用改"', st.ticketAmt);
  ok(snap(st) !== baseSnap, '这一组输入确实与默认不同（不是假通过）');
  await ev(`(()=>{window.__app.reset();return 'ok';})()`);

  /* ── G4 持久化与备份 ───────────────────────────────────────────── */
  group('G4 持久化与备份');
  await clickText('#scenarios .chip', '6 寸圆模放大到 8 寸圆模');
  await setVal('#f-label', 'G4 持久化用的备注');
  await setVal('#f-flourG', '120');
  await ev(`(()=>{window.__app.save();return 'saved';})()`);
  st = readState();
  ok(st.hasStore, '保存后本机存储里确实有记录', st.lsKey);
  const beforeReload = snap(st);
  await cli(['reload']);
  await sleep(1500);
  await ev(ARM);
  st = readState();
  ok(st.inputs.label === 'G4 持久化用的备注' && st.inputs.flourG === '120', '刷新后备注与面粉从本机恢复', st.inputs.label + ' / ' + st.inputs.flourG);
  ok(snap(st) === beforeReload, '刷新后整页读数逐字复原');
  const jsonTxt = await ev(`(()=>{return window.__app.jsonText();})()`);
  const jsonStr = typeof jsonTxt === 'string' ? jsonTxt : JSON.stringify(jsonTxt);
  await ev(`(()=>{window.__app.reset();return 'ok';})()`);
  const imported = await ev(`(()=>{return window.__app.importText(${JSON.stringify(jsonStr)});})()`);
  st = readState();
  ok(imported === 'imported', 'JSON 备份能被导回来', String(imported));
  ok(st.inputs.flourG === '120' && st.inputs.label === 'G4 持久化用的备注', '导入后输入与备份一致', st.inputs.flourG);
  ok(snap(st) === beforeReload, '导入后整页读数与备份那次逐字一致');
  const bad = await ev(`(()=>{return window.__app.importText('{不是 json');})()`);
  ok(String(bad).indexOf('err') === 0, '坏 JSON 被拒绝且不破坏现有输入', String(bad).slice(0, 30));
  st = readState();
  ok(snap(st) === beforeReload, '拒绝坏备份之后页面没被改坏');
  await ev(`(()=>{window.__app.clearStore();window.__app.reset();return 'ok';})()`);
  st = readState();
  ok(snap(st) === baseSnap, '清掉本机存储并重置后回到默认示例');

  /* ── G6 四种下载真实落盘 ───────────────────────────────────────── */
  group('G6 四种下载');
  const beforeFiles = new Set(fs.readdirSync(DL));
  function freshFiles() { return fs.readdirSync(DL).filter(function (f) { return !beforeFiles.has(f); }); }
  async function waitFor(ext, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 14000)) {
      const hits = freshFiles().filter(function (f) { return f.toLowerCase().endsWith(ext); });
      if (hits.length) return hits[hits.length - 1];
      await sleep(400);
    }
    return null;
  }
  const csvCount0 = await ev(`(()=>{return Number(document.body.getAttribute('data-dl-csv')||0);})()`);
  await clickSel('#btn-export-csv');
  const csvFile = await waitFor('.csv');
  ok(!!csvFile, 'CSV 真实点击后落盘', String(csvFile));
  if (csvFile) {
    const txt = fs.readFileSync(path.join(DL, csvFile), 'utf8');
    ok(txt.charCodeAt(0) === 0xFEFF, 'CSV 带 BOM（Excel 打开不乱码）', 'U+FEFF');
    ok(txt.indexOf('料量比 k,0.5625') >= 0, 'CSV 含料量比 0.5625', txt.slice(0, 60));
    ok(txt.indexOf('牛奶,60,60,33.75,34,是') >= 0, 'CSV 逐行含牛奶 33.75 → 34', 'ok');
    ok(txt.indexOf('玉米油,40,40,22.5,23,否') >= 0, 'CSV 逐行含玉米油 22.5 → 23', 'ok');
    ok(txt.indexOf('收口① 扣液体') >= 0 && txt.indexOf('收口② 按整蛋配平') >= 0, 'CSV 含两种收口', 'ok');
    ok(txt.indexOf('66.666667') >= 0, 'CSV 含收口②的面粉″ 66.666667', 'ok');
    const selfRows = txt.split('\n').filter(function (l) { return /^\d+,/.test(l) && l.indexOf('通过') >= 0; });
    ok(selfRows.length === 35, 'CSV 自检行数 35 条', String(selfRows.length));
    const pageCsv = await ev(`(()=>{return window.__app.csvText();})()`);
    const norm = function (s) { return String(s).replace(/\ufeff/g, '').split('\n').filter(function (l) { return l.indexOf('导出时间') !== 1 && l.indexOf('导出时间') !== 0; }).join('\n'); };
    ok(norm(txt) === norm(pageCsv), '落盘 CSV 与页面里同一次导出的文本逐字符一致（只差导出时间行）');
  }
  await clickSel('#btn-export-md');
  const mdFile = await waitFor('.md');
  ok(!!mdFile, 'Markdown 真实点击后落盘', String(mdFile));
  if (mdFile) {
    const txt = fs.readFileSync(path.join(DL, mdFile), 'utf8');
    ok(txt.indexOf('# 改方子') >= 0, 'MD 有标题', txt.slice(0, 20));
    ok(txt.indexOf('料量比 k = 0.5625') >= 0, 'MD 含料量比', 'ok');
    ok(txt.indexOf('| 面粉（基准） | 100% | 100 | 56.25 | **56** |') >= 0, 'MD 新方表面粉行正确', 'ok');
    ok(txt.indexOf('## 对照表：目标尺寸 ±20%') >= 0 && txt.indexOf('## 对照表：目标高度') >= 0, 'MD 含两张对照表', 'ok');
    ok(txt.indexOf('## 自检 35/35') >= 0, 'MD 含自检 35/35', 'ok');
    ok(txt.indexOf('不给烘烤温度与时间建议') >= 0, 'MD 写明不给温度与时间建议', 'ok');
    const pageMd = await ev(`(()=>{return window.__app.mdText();})()`);
    ok(String(txt) === String(pageMd), '落盘 MD 与页面同一次导出的文本逐字符一致');
  }
  await clickSel('#btn-export-json');
  const jsonFile = await waitFor('.json');
  ok(!!jsonFile, 'JSON 真实点击后落盘', String(jsonFile));
  if (jsonFile) {
    const o = JSON.parse(fs.readFileSync(path.join(DL, jsonFile), 'utf8'));
    ok(o.app === 'recipe-resize' && o.version === 1, 'JSON 带 app 与版本标记', o.app + '/v' + o.version);
    ok(!!o.cfg && !!o.out && o.out.selfChecks.length === 35, 'JSON 含完整 cfg 与 35 条自检', String(o.out.selfChecks.length));
    ok(o.out.k === 0.5625 && o.out.flour.dstG === 56.25, 'JSON 里 k 与面粉是同一套数', o.out.k + '/' + o.out.flour.dstG);
    ok(o.out.rows[0].rounded === 34, 'JSON 里牛奶按刻度 34 g', String(o.out.rows[0].rounded));
  }
  await clickSel('#btn-export-png');
  const pngFile = await waitFor('.png', 22000);
  ok(!!pngFile, 'PNG 结果卡真实点击后落盘', String(pngFile));
  if (pngFile) {
    const buf = fs.readFileSync(path.join(DL, pngFile));
    ok(buf.length > 20000, 'PNG 字节数 > 20 KB（不是空图）', String(buf.length));
    const sig = buf.slice(0, 8).toString('hex');
    ok(sig === '89504e470d0a1a0a', 'PNG 文件头正确', sig);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    ok(w === 1080 && h === 1350, '结果卡尺寸 1080×1350', w + '×' + h);
  }
  const cardSize = asObj(await ev(`(()=>{return JSON.stringify(window.__app.cardSize());})()`));
  ok(cardSize.w === 1080 && cardSize.h === 1350, '页面内绘制的卡片尺寸也是 1080×1350', JSON.stringify(cardSize));
  const coverSize = asObj(await ev(`(()=>{return JSON.stringify(window.__app.coverSize());})()`));
  ok(coverSize.w === 1200 && coverSize.h === 1200, '封面绘制尺寸 1200×1200', JSON.stringify(coverSize));
  note('下载目录 ' + DL + ' 本轮新文件：' + freshFiles().join(', '));

  /* ── G5 视口 ───────────────────────────────────────────────────── */
  group('G5 视口与窄屏');
  launchAt(375, 812);
  await sleep(900);
  await setVal('#f-label', '这是一条特别长的备注，用来检查窄屏下长文本会不会把整页顶出横向溢出，并且确认每一张表都折成了堆叠卡而不是要靠横向滑动才能看到结论列');
  st = readState();
  ok(st.winW <= 400 && st.winW >= 320, '窗口确实收窄到手机宽度', String(st.winW));
  ok(!st.bodyOverflow, '375px 下没有横向溢出', 'docW ' + st.docW + ' vs ' + st.winW);
  const overflow = asObj(await ev(`(()=>{var bad=[];document.querySelectorAll('.wrap *').forEach(function(e){
      var r=e.getBoundingClientRect(); if(r.width>0 && r.right>window.innerWidth+1.5) bad.push(e.tagName+'.'+(e.className||'')+'@'+Math.round(r.right));
    });return JSON.stringify({n:bad.length,list:bad.slice(0,6)});})()`));
  ok(overflow.n === 0, '375px 下没有任何元素越出右边界', JSON.stringify(overflow.list));
  const stack = asObj(await ev(`(()=>{var td=document.querySelector('#new-body td');var th=document.querySelector('#new-table thead');
    var cs=getComputedStyle(td);var before=getComputedStyle(td,'::before');
    return JSON.stringify({display:cs.display, theadTh:getComputedStyle(th).display, label:before.content, tw:document.querySelector('#sec-newrecipe .tw').scrollWidth, cw:document.querySelector('#sec-newrecipe .tw').clientWidth});})()`));
  ok(stack.display === 'block', '窄屏下表格单元格折成块（堆叠卡）', JSON.stringify(stack));
  ok(stack.theadTh === 'none', '窄屏下表头隐藏（列名改由每格前面的标签承担）', stack.theadTh);
  ok(String(stack.label).indexOf('配料') >= 0, '堆叠卡每一格前面有列名标签（::before 内容）', String(stack.label));
  ok(stack.tw <= stack.cw + 1, '新方那张表在窄屏下不需要横向滚动', stack.tw + ' ≤ ' + stack.cw);
  ok(st.newRows === 6 && st.chkFail === 0, '窄屏下新方仍是 6 行、自检仍全过', st.newRows + ' 行 / ' + st.scCount);
  ok(st.rowInputs === 3, '窄屏下配方行输入仍是 3 行（没有被藏掉）', String(st.rowInputs));
  const wide = asObj(await ev(`(()=>{var bad=[];document.querySelectorAll('td,th,.ro,.kv li').forEach(function(e){
      if(e.scrollWidth>e.clientWidth+2 && e.clientWidth>0) bad.push((e.className||e.tagName)+':'+e.scrollWidth+'>'+e.clientWidth);
    });return JSON.stringify({n:bad.length,list:bad.slice(0,6)});})()`));
  ok(wide.n === 0, '窄屏下没有被裁掉的单元格', JSON.stringify(wide.list));
  fs.mkdirSync(path.join(ROOT, 'evidence', '截图'), { recursive: true });
  const shotSmall = path.join(ROOT, 'evidence', '截图', '窄屏375-' + TAG + '.png');
  execFileSync(AB, ['--session', SESSION, 'screenshot', shotSmall], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  ok(fs.existsSync(shotSmall) && fs.statSync(shotSmall).size > 10000, '窄屏整页截图落盘', path.basename(shotSmall));

  launchAt(320, 700);
  await sleep(700);
  st = readState();
  ok(st.winW <= 340, '窗口收到 320px', String(st.winW));
  ok(!st.bodyOverflow, '320px 下也没有横向溢出', 'docW ' + st.docW);
  const shot320 = path.join(ROOT, 'evidence', '截图', '窄屏320-' + TAG + '.png');
  execFileSync(AB, ['--session', SESSION, 'screenshot', shot320], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  ok(fs.existsSync(shot320) && fs.statSync(shot320).size > 10000, '320px 截图落盘', path.basename(shot320));

  launchAt(1280, 900);
  await sleep(800);
  await ev(`(()=>{window.__app.reset();window.__app.save();return 'ok';})()`);
  st = readState();
  ok(st.winW >= 1200 && !st.bodyOverflow, '回到 1280px 宽屏正常', String(st.winW));
  ok(snap(st) === baseSnap, '宽屏下重置后回到默认数值');
  const shotWide = path.join(ROOT, 'evidence', '截图', '宽屏1280-' + TAG + '.png');
  execFileSync(AB, ['--session', SESSION, 'screenshot', shotWide], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  ok(fs.existsSync(shotWide) && fs.statSync(shotWide).size > 10000, '宽屏整页截图落盘', path.basename(shotWide));

  /* ── G7 控制台 ─────────────────────────────────────────────────── */
  group('G7 控制台');
  await setVal('#f-dstDia', '17.78');
  await clickText('#scenarios .chip', '无蛋方子');
  await clickSel('#f-roundStep .chip');
  const console1 = asObj(ev(PROBE_CLEAN));
  ok(console1.errs.length === 0, '整轮交互之后 0 条控制台错误', JSON.stringify(console1.errs.slice(0, 3)));
  ok(console1.warns.length === 0, '整轮交互之后 0 条控制台警告', JSON.stringify(console1.warns.slice(0, 3)));
  const finalState = await ev(`(()=>{return JSON.stringify({fails:window.__app.checks().filter(function(c){return !c.pass;}).map(function(c){return c.label;}), total:window.__app.checks().length});})()`);
  ok(asObj(finalState).fails.length === 0, '收尾时自检仍然 0 条不通过', String(asObj(finalState).total) + ' 条');

  /* ── 汇总 ──────────────────────────────────────────────────────── */
  lines.push('');
  lines.push('汇总：PASS ' + pass + ' / FAIL ' + fail + '（eval ' + evals + ' 次）');
  const summary = {
    tag: TAG, url: APP_URL, session: SESSION, startedAt,
    finishedAt: new Date().toISOString(),
    pass, fail, evals,
    groups: Object.keys(groups).map(function (g) { return { group: g, pass: groups[g].pass, fail: groups[g].fail }; }),
    downloads: { dir: DL, files: freshFiles() }
  };
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  fs.writeFileSync(SUM, JSON.stringify(summary, null, 2));
  console.log('PASS ' + pass + ' / FAIL ' + fail + '  （eval ' + evals + ' 次）');
  console.log('明细：' + OUT);
  if (fail) process.exitCode = 1;
})();
