/* 改方子 · 界面（ui.js）
 * 形态：对照表式（原方 ↔ 新方逐行并排）+ 体检报告式（先诊断、再依据、再处方）
 * 只用 core.js 的 AppCore 算，界面里不另写一套公式。
 */
(function () {
  'use strict';
  var A = window.AppCore;
  var CFG = A.normCfg(A.DEFAULTS);
  var RES = null, SC = [];
  var LS_KEY = 'recipe-resize-v1';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function num(v) { var n = Number(String(v === undefined || v === null ? '' : v).replace(/[,，\s]/g, '')); return isFinite(n) ? n : NaN; }
  function fmt(x, d) { return isFinite(x) ? Number(x).toFixed(d === undefined ? 2 : d) : '—'; }
  function fmtg(x, d) {
    if (!isFinite(x)) return '—';
    var s = Number(x).toFixed(d === undefined ? 2 : d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  function pctFrac(x, d) { return isFinite(x) ? fmt(x * 100, d === undefined ? 2 : d) + '%' : '—'; }
  function approx(a, b) { return a === null || b === null ? false : Math.abs(a - b) < 1e-9; }

  /* ─── 场景预设（全是虚构示例） ─────────────────────────────────────── */
  var SCENARIOS = [
    { label: '8 寸圆模 → 6 寸圆模', patch: {} },
    { label: '8 寸圆模 → 8 寸方模（等面积）', patch: { dstShape: 'rect', dstLen: 18.01, dstWid: 18.01 } },
    { label: '6 寸圆模放大到 8 寸圆模', patch: { srcDia: 15.24, dstDia: 20.32, flourG: 100 } },
    { label: '同一个模，只把高度从 6 改到 7.5 cm', patch: { dstHeight: 7.5 } },
    { label: '无蛋方子：6 寸 → 8 寸', patch: { eggCount: 0, rows: [{ name: '黄油', pct: 60, liquid: false }, { name: '糖粉', pct: 45, liquid: false }] } },
    { label: '方盘 30×20 → 28×28（蛋糕卷）', patch: { srcShape: 'rect', srcLen: 30, srcWid: 20, srcHeight: 3, dstShape: 'rect', dstLen: 28, dstWid: 28, dstHeight: 3, flourG: 80 } }
  ];

  /* ─── chips ───────────────────────────────────────────────────────── */
  function chipVal(id, fallback) {
    var box = $(id); if (!box) return fallback;
    var btns = box.querySelectorAll('button[data-v]');
    for (var i = 0; i < btns.length; i++) if (btns[i].getAttribute('aria-pressed') === 'true') return btns[i].getAttribute('data-v');
    return fallback;
  }
  function setChip(id, v) {
    var box = $(id); if (!box) return;
    var btns = box.querySelectorAll('button[data-v]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-v') === String(v)));
  }

  /* ─── 表单读写 ────────────────────────────────────────────────────── */
  var FIELDS = ['srcDia', 'srcLen', 'srcWid', 'srcHeight', 'dstDia', 'dstLen', 'dstWid', 'dstHeight', 'flourG', 'eggCount', 'eggG', 'label'];
  var CLOSE_LABEL = { none: '还没定', A: '① 扣液体', B: '② 按整蛋配平' };
  function fillInputs() {
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i], box = $('f-' + f);
      if (box) box.value = CFG[f] === undefined || CFG[f] === null ? '' : String(CFG[f]);
    }
    setChip('f-srcShape', CFG.srcShape);
    setChip('f-dstShape', CFG.dstShape);
    setChip('f-roundStep', CFG.roundStep);
    setChip('f-roundMode', CFG.roundMode);
    $('close-choice').textContent = '已采用：' + (CLOSE_LABEL[CFG.closeChoice] || '还没定');
    $('btn-apply-A').setAttribute('aria-pressed', String(CFG.closeChoice === 'A'));
    $('btn-apply-B').setAttribute('aria-pressed', String(CFG.closeChoice === 'B'));
    $('btn-apply-A').textContent = CFG.closeChoice === 'A' ? '已采用这一条' : '采用这条';
    $('btn-apply-B').textContent = CFG.closeChoice === 'B' ? '已采用这一条' : '采用这条';
    renderRows();
    syncShape();
  }
  function renderRows() {
    var tb = $('rows-body'); clear(tb);
    for (var i = 0; i < CFG.rows.length; i++) {
      (function (i) {
        var r = CFG.rows[i];
        var tr = el('tr'); tr.setAttribute('data-row', String(i));
        var td1 = el('td'); td1.setAttribute('data-l', '配料');
        var nm = el('input'); nm.type = 'text'; nm.id = 'f-row' + i + '-name'; nm.value = r.name;
        td1.appendChild(nm); tr.appendChild(td1);
        var td2 = el('td', 'num'); td2.setAttribute('data-l', '烘焙百分比（相对面粉）%');
        var pc = el('input'); pc.type = 'text'; pc.id = 'f-row' + i + '-pct'; pc.value = String(r.pct); pc.inputMode = 'decimal';
        td2.appendChild(pc); tr.appendChild(td2);
        var td3 = el('td'); td3.setAttribute('data-l', '算不算液体');
        var lab = el('label'); lab.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:13px;color:#54514a';
        var cb = el('input'); cb.type = 'checkbox'; cb.id = 'f-row' + i + '-liquid'; cb.checked = !!r.liquid;
        lab.appendChild(cb); lab.appendChild(document.createTextNode('算液体'));
        td3.appendChild(lab); tr.appendChild(td3);
        var td4 = el('td'); td4.setAttribute('data-l', '');
        td4.className = 'blank';
        var ctl = el('div', 'rowctl');
        var up = el('button', 'btn sm', '↑'); up.type = 'button'; up.title = '上移';
        var dn = el('button', 'btn sm', '↓'); dn.type = 'button'; dn.title = '下移';
        var rm = el('button', 'btn sm', '删除'); rm.type = 'button';
        up.addEventListener('click', function () { moveRow(i, -1); });
        dn.addEventListener('click', function () { moveRow(i, 1); });
        rm.addEventListener('click', function () { delRow(i); });
        ctl.appendChild(up); ctl.appendChild(dn); ctl.appendChild(rm);
        td4.appendChild(ctl); tr.appendChild(td4);
        tb.appendChild(tr);
      })(i);
    }
  }
  function moveRow(i, d) {
    readRows(); var j = i + d;
    if (j < 0 || j >= CFG.rows.length) return;
    var t = CFG.rows[i]; CFG.rows[i] = CFG.rows[j]; CFG.rows[j] = t;
    renderRows(); refresh(); saveLocal();
  }
  function delRow(i) {
    readRows();
    if (CFG.rows.length <= 1) { return; }
    CFG.rows.splice(i, 1); renderRows(); refresh(); saveLocal();
  }
  function addRow() {
    readRows();
    if (CFG.rows.length >= A.MAX_ROWS) return;
    CFG.rows.push({ name: '配料 ' + (CFG.rows.length + 1), pct: 20, liquid: false });
    renderRows(); refresh(); saveLocal();
  }
  function readRows() {
    var trs = $('rows-body').querySelectorAll('tr[data-row]');
    var out = [];
    for (var i = 0; i < trs.length; i++) {
      var idx = trs[i].getAttribute('data-row');
      var nm = $('f-row' + idx + '-name'), pc = $('f-row' + idx + '-pct'), cb = $('f-row' + idx + '-liquid');
      out.push({ name: nm ? nm.value : '', pct: pc ? pc.value : '', liquid: cb ? cb.checked : false });
    }
    CFG.rows = out;
  }
  function readInputs() {
    CFG.srcShape = chipVal('f-srcShape', 'round');
    CFG.closeChoice = CFG.closeChoice || 'none';
    CFG.dstShape = chipVal('f-dstShape', 'round');
    CFG.roundMode = chipVal('f-roundMode', 'nearest');
    var rs = chipVal('f-roundStep', '1');
    CFG.roundStep = num(rs);
    readRows();
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i], box = $('f-' + f);
      if (!box || f === 'label') continue;
      CFG[f] = box.value;                     // 空串会在 normCfg 里变成 NaN → validate 报出来
    }
    var lb = $('f-label'); if (lb) CFG.label = lb.value;
    CFG = A.normCfg(CFG);
  }
  function syncShape() {
    var s = chipVal('f-srcShape', 'round'), d = chipVal('f-dstShape', 'round');
    $('wrap-srcDia').className = 'field' + (s === 'round' ? '' : ' hidden');
    $('wrap-srcLen').className = 'field' + (s === 'rect' ? '' : ' hidden');
    $('wrap-srcWid').className = 'field' + (s === 'rect' ? '' : ' hidden');
    $('wrap-dstDia').className = 'field' + (d === 'round' ? '' : ' hidden');
    $('wrap-dstLen').className = 'field' + (d === 'rect' ? '' : ' hidden');
    $('wrap-dstWid').className = 'field' + (d === 'rect' ? '' : ' hidden');
  }

  /* ─── 存本机 ──────────────────────────────────────────────────────── */
  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, cfg: CFG, at: new Date().toISOString() })); return true; }
    catch (e) { return false; }
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.cfg) return null;
      return A.normCfg(o.cfg);
    } catch (e) { return null; }
  }
  function restoreOrSeed() {
    var v = loadLocal();
    if (!v) { CFG = A.normCfg(A.DEFAULTS); return null; }
    CFG = v; return v;
  }

  /* ─── 渲染：错误 ──────────────────────────────────────────────────── */
  function markBad(errs) {
    var ids = ['f-srcDia', 'f-srcLen', 'f-srcWid', 'f-srcHeight', 'f-dstDia', 'f-dstLen', 'f-dstWid', 'f-dstHeight', 'f-flourG', 'f-eggCount', 'f-eggG'];
    ids.forEach(function (id) { var e = $(id); if (e) e.className = ''; });
    var boxes = $('rows-body').querySelectorAll('input');
    for (var i = 0; i < boxes.length; i++) boxes[i].className = '';
    errs.forEach(function (e) {
      if (/^row(\d+)$/.test(e.field)) {
        var idx = e.field.replace('row', '');
        var pc = $('f-row' + idx + '-pct'); if (pc) pc.className = 'bad';
        var nm = $('f-row' + idx + '-name'); if (nm) nm.className = 'bad';
        return;
      }
      var box = $('f-' + e.field);
      if (box) box.className = 'bad';
    });
  }
  function renderErrors(errs) {
    var sec = $('sec-errors'), ul = $('err-list');
    clear(ul);
    if (!errs.length) { sec.className = 'err hidden'; return; }
    sec.className = 'err';
    errs.forEach(function (e) { ul.appendChild(el('li', null, e.msg)); });
  }

  /* ─── 渲染：诊断 ──────────────────────────────────────────────────── */
  function renderDiagnosis(r) {
    $('badge-scene').textContent = r.label || '（没写备注）';
    $('badge-src').textContent = '原方：' + r.src.label;
    $('badge-dst').textContent = '目标：' + r.dst.label;
    $('diag-sameheight').textContent = r.sameHeight ? '两模等高 → k 就是面积比' : '两模不等高 → k 含高度比';
    $('src-tag').textContent = r.src.label;
    $('dst-tag').textContent = r.dst.label;

    var dir = r.k > 1.0000005 ? '放大' : (r.k < 0.9999995 ? '缩小' : '基本不变');
    var vt, vw, cls = '';
    if (r.k < 1) {
      vt = '新方 = 原方 × ' + fmtg(r.k, 4) + '（' + dir + '）';
      vw = '面粉从 ' + fmtg(r.flour.srcG, 2) + ' g 变成 ' + fmtg(r.flour.dstG, 2) + ' g，鸡蛋从 ' + r.egg.srcCount + ' 个（' + fmtg(r.egg.srcG, 0) + ' g 蛋液）变成目标 ' + fmtg(r.egg.exactCount, 4) + ' 个 —— 蛋不能切，下面有两种收口。';
    } else if (r.k > 1) {
      vt = '新方 = 原方 × ' + fmtg(r.k, 4) + '（' + dir + '）';
      vw = '面粉从 ' + fmtg(r.flour.srcG, 2) + ' g 变成 ' + fmtg(r.flour.dstG, 2) + ' g，蛋液目标 ' + fmtg(r.egg.dstG, 2) + ' g，约 ' + fmtg(r.egg.exactCount, 4) + ' 个蛋。';
    } else {
      vt = '两个模的容积一样 → k = 1，方子不用改';
      vw = '还是照着原方称：面粉 ' + fmtg(r.flour.dstG, 2) + ' g。';
    }
    if (r.naive && r.naive.extraPct > 0.005) cls = 'warn';
    $('ticket').className = 'ticket ' + cls;
    $('ticket-vt').textContent = vt;
    $('ticket-vw').textContent = vw;

    /* 读数 */
    var ro = $('readout'); clear(ro);
    function card(l, v, s, hi) {
      var d = el('div', 'ro' + (hi ? ' hi' : ''));
      d.appendChild(el('div', 'l', l));
      d.appendChild(el('div', 'v', v));
      d.appendChild(el('div', 's', s));
      ro.appendChild(d);
    }
    card('料量比 k', fmtg(r.k, 4), r.sameHeight ? '面积比 = 容积比' : '面积比 ' + fmtg(r.kArea, 4) + ' × 高度比 ' + fmtg(r.kHeight, 4), true);
    card('面粉', fmtg(r.flour.dstG, 2) + ' g', '按刻度称 ' + fmtg(r.flour.rounded, 2) + ' g');
    card('鸡蛋', r.egg.suggestedCount + ' 个', '目标 ' + fmtg(r.egg.exactCount, 4) + ' 个 / 蛋液 ' + fmtg(r.egg.dstG, 2) + ' g');
    card('新方总料重', fmtg(r.totals.dstG, 2) + ' g', '原方 ' + fmtg(r.totals.srcG, 2) + ' g（都含蛋液）');
    if (r.naive) card('按直径比缩会多放', pctFrac(r.naive.extraPct, 2), '直径比 ' + fmtg(r.naive.diaRatio, 4) + ' ≠ k ' + fmtg(r.k, 4));

    /* 条形对比 */
    var bars = $('bars'); clear(bars);
    function bar(label, v, on) {
      var b = el('div', 'bar');
      b.appendChild(el('div', 'bl', label));
      var t = el('div', 'bt');
      var f = el('div', 'bf' + (on ? ' on' : ''));
      var maxV = Math.max(r.k, r.kArea, r.naive ? r.naive.kByDia : 0, 1e-9);   // 高度比不是"料量比"，不进标尺
      f.style.width = Math.max(1, Math.min(100, v / maxV * 100)) + '%';
      t.appendChild(f); b.appendChild(t);
      b.appendChild(el('div', 'bv', fmtg(v, 4)));
      bars.appendChild(b);
    }
    if (r.naive) bar('按直径比缩（常见的那一步错）', r.naive.kByDia, false);
    bar('面积比（两个模等高时这就是 k）', r.kArea, false);
    bar('料量比 k = 容积比', r.k, true);
    var p = el('p', 'note-inline');
    p.appendChild(document.createTextNode('为什么不是直径比：面积跟直径的平方走。直径比 ' + fmtg(r.naive ? r.naive.diaRatio : r.kArea, 4) + ' 平方之后才是 ' + fmtg(r.k, 4) + '。'));
    bars.appendChild(p);
  }

  /* ─── 渲染：几何账 ────────────────────────────────────────────────── */
  function renderGeometry(r) {
    var tb = $('geo-body'); clear(tb);
    function row(name, a, b, ratio, how) {
      var tr = el('tr');
      var td = el('td', null, name); td.setAttribute('data-l', '量'); tr.appendChild(td);
      var t2 = el('td', 'num', fmtg(a, 4)); t2.setAttribute('data-l', '原模'); tr.appendChild(t2);
      var t3 = el('td', 'num', fmtg(b, 4)); t3.setAttribute('data-l', '目标模'); tr.appendChild(t3);
      var t4 = el('td', 'num', fmtg(ratio, 6)); t4.setAttribute('data-l', '比（目标 ÷ 原）'); tr.appendChild(t4);
      var t5 = el('td', null, how); t5.setAttribute('data-l', '怎么算的'); tr.appendChild(t5);
      tb.appendChild(tr);
    }
    function howArea(x) {
      return x.shape === 'round' ? ('圆 πD²/4，D = ' + fmtg(x.diaCm, 2) + ' cm') : ('方 长 × 宽 = ' + fmtg(x.lenCm, 2) + ' × ' + fmtg(x.widCm, 2) + ' cm');
    }
    row('面积 cm²', r.src.areaCm2, r.dst.areaCm2, r.kArea, '原：' + howArea(r.src) + '；目标：' + howArea(r.dst));
    row('高度 cm', r.src.heightCm, r.dst.heightCm, r.kHeight, '侧壁内高（直接量）');
    row('容积 cm³', r.src.volumeCm3, r.dst.volumeCm3, r.k, '面积 × 高度');
    var tr = el('tr', 'total');
    var td1 = el('td', null, '料量比 k'); td1.setAttribute('data-l', '量'); tr.appendChild(td1);
    var td2 = el('td', 'num', '—'); td2.setAttribute('data-l', '原模'); tr.appendChild(td2);
    var td3 = el('td', 'num', '—'); td3.setAttribute('data-l', '目标模'); tr.appendChild(td3);
    var td4 = el('td', 'num', fmtg(r.k, 6)); td4.setAttribute('data-l', '比（目标 ÷ 原）'); tr.appendChild(td4);
    var td5 = el('td', null, '面积比 ' + fmtg(r.kArea, 6) + ' × 高度比 ' + fmtg(r.kHeight, 6)); td5.setAttribute('data-l', '怎么算的'); tr.appendChild(td5);
    tb.appendChild(tr);

    var ul = $('geo-notes'); clear(ul);
    function li(txt) { ul.appendChild(el('li', null, txt)); }
    li('两个模' + (r.sameHeight ? '等高，高度在 k 里约掉了，所以 k 就等于面积比。' : '不等高，k 里除了面积比还乘了高度比 ' + fmtg(r.kHeight, 4) + ' —— 只按面积比缩会不对。'));
    li('圆形寸说的是直径，' + (r.src.shape === 'round' ? '原模 φ' + fmtg(r.src.diaCm, 2) + ' cm' : '原模是方模') + '；' + (r.dst.shape === 'round' ? '目标模 φ' + fmtg(r.dst.diaCm, 2) + ' cm' : '目标模 ' + fmtg(r.dst.lenCm, 2) + ' × ' + fmtg(r.dst.widCm, 2) + ' cm') + '。');
    li('本页的「几寸」按 1 英寸 = 2.54 cm 换算，是长度单位换算，不是任何行业标准。');
  }

  /* ─── 渲染：新方对照表 ────────────────────────────────────────────── */
  function renderNew(r) {
    var tb = $('new-body'); clear(tb);
    function row(name, pct, srcTxt, exactTxt, roundTxt, note, cls) {
      var tr = el('tr', cls || '');
      var t1 = el('td', null, name); t1.setAttribute('data-l', '配料'); tr.appendChild(t1);
      var t2 = el('td', 'num', pct); t2.setAttribute('data-l', '烘焙 %'); tr.appendChild(t2);
      var t3 = el('td', 'num', srcTxt); t3.setAttribute('data-l', '原方 g'); tr.appendChild(t3);
      var t4 = el('td', 'num', exactTxt); t4.setAttribute('data-l', '新方精确 g'); tr.appendChild(t4);
      var t5 = el('td', 'num'); var sp = el('span', 'mark', roundTxt); t5.appendChild(sp); t5.setAttribute('data-l', '按刻度 g'); tr.appendChild(t5);
      var t6 = el('td', null, note); t6.setAttribute('data-l', '说明'); tr.appendChild(t6);
      tb.appendChild(tr);
    }
    row('面粉（基准）', '100%', fmtg(r.flour.srcG, 2), fmtg(r.flour.dstG, 4), fmtg(r.flour.rounded, 2), '基准行，其它配料都按它的百分比算');
    r.rows.forEach(function (x) {
      row(x.name + (x.liquid ? '（液体）' : ''), fmtg(x.pct, 2) + '%', fmtg(x.srcG, 4), fmtg(x.dstG, 4), fmtg(x.rounded, 2),
        '= ' + fmtg(x.pct / 100 * 100, 4) + '% × 面粉′');
    });
    row('鸡蛋', '—', r.egg.srcCount + ' 个 = ' + fmtg(r.egg.srcG, 2) + ' g',
      '目标 ' + fmtg(r.egg.dstG, 4) + ' g（' + fmtg(r.egg.exactCount, 4) + ' 个）',
      r.egg.suggestedCount + ' 个 = ' + fmtg(r.egg.suggestedG, 2) + ' g',
      '蛋不能切 → 见下面两种收口', 'egg');
    var tr = el('tr', 'total');
    var t1 = el('td', null, '合计（含蛋液）'); t1.setAttribute('data-l', '配料'); tr.appendChild(t1);
    var t2 = el('td', 'num', '—'); t2.setAttribute('data-l', '烘焙 %'); tr.appendChild(t2);
    var t3 = el('td', 'num', fmtg(r.totals.srcG, 4)); t3.setAttribute('data-l', '原方 g'); tr.appendChild(t3);
    var t4 = el('td', 'num', fmtg(r.totals.dstG, 4)); t4.setAttribute('data-l', '新方精确 g'); tr.appendChild(t4);
    var t5 = el('td', 'num', fmtg(r.totals.dstRowsRoundedG + r.egg.suggestedG, 2)); t5.setAttribute('data-l', '按刻度 g'); tr.appendChild(t5);
    var t6 = el('td', null, '刻度 ' + fmtg(r.totals.roundStepG, 2) + ' g / ' + (r.totals.roundMode === 'up' ? '一律向上' : '四舍五入')); t6.setAttribute('data-l', '说明'); tr.appendChild(t6);
    tb.appendChild(tr);
    $('new-sum').textContent = 'k = ' + fmtg(r.k, 4) + '，总料 ' + fmtg(r.totals.dstG, 2) + ' g';
  }

  /* ─── 渲染：鸡蛋两种收口 ──────────────────────────────────────────── */
  function renderEgg(r) {
    var aBody = $('closeA-body'); clear(aBody);
    if (r.closeA.available) {
      var ul = el('ul', 'notes');
      function li(t) { ul.appendChild(el('li', null, t)); }
      li('蛋液目标 ' + fmtg(r.egg.dstG, 4) + ' g（' + fmtg(r.egg.exactCount, 4) + ' 个），取整到 ' + r.closeA.eggCount + ' 个 = ' + fmtg(r.closeA.eggG, 2) + ' g。');
      li('差额 ' + (r.closeA.eggDiffG > 0 ? '多 ' : '少 ') + fmtg(Math.abs(r.closeA.eggDiffG), 4) + ' g，' + (r.closeA.eggDiffG > 0 ? '从' : '补给') + '勾成液体的行里' + (r.closeA.eggDiffG > 0 ? '扣掉' : '补上') + '（占它们总百分比的 ' + fmtg(r.closeA.liquidPctSum, 2) + '% 那一份）。');
      r.closeA.rows.filter(function (x) { return x.liquid; }).forEach(function (x) {
        li('「' + x.name + '」' + fmtg(x.dstG, 4) + ' → ' + fmtg(x.after, 4) + ' g（' + (x.deduct > 0 ? '扣 ' : '补 ') + fmtg(Math.abs(x.deduct), 4) + ' g）');
      });
      li('总液体：目标 ' + fmtg(r.closeA.targetLiquidG, 4) + ' g = 改完 ' + fmtg(r.closeA.actualLiquidG, 4) + ' g（守恒，一分不多一分不少）');
      aBody.appendChild(ul);
      if (r.closeA.negativeWarning) {
        var w = el('p', 'note-inline');
        w.appendChild(el('span', 'pill r', '注意'));
        w.appendChild(document.createTextNode(' 有液体行被扣成了负数 —— 这个方子不适合用扣液体收口，请看收口②。'));
        aBody.appendChild(w);
      }
      $('btn-apply-A').className = 'btn primary sm';
    } else {
      aBody.appendChild(el('p', 'note-inline', r.closeA.reason));
      $('btn-apply-A').className = 'btn sm hidden';
    }

    var bBody = $('closeB-body'); clear(bBody);
    if (r.closeB.available) {
      var ul2 = el('ul', 'notes');
      function li2(t) { ul2.appendChild(el('li', null, t)); }
      li2('先定整蛋：' + r.closeB.eggCount + ' 个 = ' + fmtg(r.closeB.eggG, 2) + ' g 蛋液。');
      li2('再反推面粉：面粉″ = ' + fmtg(r.closeB.eggG, 2) + ' ÷ (原蛋液 ' + fmtg(r.egg.srcG, 2) + ' ÷ 面粉 ' + fmtg(r.flour.srcG, 2) + ') = ' + fmtg(r.closeB.flourG, 4) + ' g。');
      li2('k″ = ' + fmtg(r.closeB.flourG, 4) + ' ÷ ' + fmtg(r.flour.srcG, 2) + ' = ' + fmtg(r.closeB.kActual, 6) + '，与目标 k ' + fmtg(r.k, 6) + ' 相差 ' + pctFrac(r.closeB.kDeviation, 3) + '。');
      if (r.closeB.kDeviation > 0) li2('料比目标多 ' + pctFrac(r.closeB.kDeviation, 2) + ' —— 相当于要一个 φ' + fmtg(r.closeB.equivDiaCm, 2) + ' cm 的模才装得下（你现在是 φ' + fmtg(r.dst.diaCm, 2) + '）。');
      else if (r.closeB.kDeviation < 0) li2('料比目标少 ' + pctFrac(-r.closeB.kDeviation, 2) + '，模具会装不满。');
      else li2('正好对上，没有偏差。');
      li2('好处是：整条方子的相对比例一点没动（每行还是那个百分比）。');
      bBody.appendChild(ul2);
      $('btn-apply-B').className = 'btn primary sm';
    } else {
      bBody.appendChild(el('p', 'note-inline', r.closeB.reason));
      $('btn-apply-B').className = 'btn sm hidden';
    }

    var tb = $('close-body'); clear(tb);
    var names = [], i;
    names.push({ n: '面粉（基准）', a: r.closeA.available ? r.closeA.flourG : null, b: r.closeB.available ? r.closeB.flourG : null, k: r.flour.dstG, note: r.closeA.available ? '收口①不动面粉' : '—' });
    for (i = 0; i < r.rows.length; i++) {
      var ra = r.closeA.available ? r.closeA.rows[i] : null;
      var rb = r.closeB.available ? r.closeB.rows[i] : null;
      names.push({ n: r.rows[i].name + (r.rows[i].liquid ? '（液体）' : ''), a: ra ? ra.after : null, b: rb ? rb.bG : null, k: r.rows[i].dstG, note: r.rows[i].liquid ? '勾成液体' : '不算液体' });
    }
    names.push({ n: '鸡蛋', a: r.closeA.available ? r.closeA.eggG : null, b: r.closeB.available ? r.closeB.eggG : null, k: r.egg.dstG, note: '整蛋，不切' });
    names.forEach(function (x) {
      var tr = el('tr');
      var t1 = el('td', null, x.n); t1.setAttribute('data-l', '配料'); tr.appendChild(t1);
      var t2 = el('td', 'num', x.a === null ? '—' : fmtg(x.a, 4)); t2.setAttribute('data-l', '① 扣完 g'); tr.appendChild(t2);
      var t3 = el('td', 'num', x.b === null ? '—' : fmtg(x.b, 4)); t3.setAttribute('data-l', '② 配平 g'); tr.appendChild(t3);
      var t4 = el('td', 'num', fmtg(x.k, 4)); t4.setAttribute('data-l', '只按 k g'); tr.appendChild(t4);
      var t5 = el('td', null, x.note); t5.setAttribute('data-l', '口径'); tr.appendChild(t5);
      tb.appendChild(tr);
    });
  }

  /* ─── 渲染：处方（每条都能按下去改输入） ──────────────────────────── */
  function buildAdvice(r) {
    var out = [];
    if (r.naive && r.naive.extraPct > 0.005) {
      out.push({
        kind: 'note',
        t: '别按直径比缩',
        d: '直径比是 ' + fmtg(r.naive.diaRatio, 4) + '，直接乘它的话面粉要放 ' + fmtg(r.naive.flourByDiaG, 2) + ' g，比正确的 ' + fmtg(r.flour.dstG, 2) + ' g 多 ' + fmtg(r.naive.flourExtraG, 2) + ' g（多 ' + pctFrac(r.naive.extraPct, 2) + '）。这一条不需要改输入，是提醒你别那样算。'
      });
    }
    var nowSize = r.dst.shape === 'round'
      ? ('φ' + fmtg(r.dst.diaCm, 2) + ' cm')
      : (fmtg(r.dst.lenCm, 2) + ' × ' + fmtg(r.dst.widCm, 2) + ' cm');
    if (r.closeB.available && Math.abs(r.closeB.kDeviation) > 0.002 &&
        (r.closeB.equivDiaCm || r.closeB.equivLenCm)) {
      var want = (r.dst.shape === 'round')
        ? ('直径改成 ' + fmtg(r.closeB.equivDiaCm, 2) + ' cm')
        : ('长宽各改成 ' + fmtg(r.closeB.equivLenCm, 2) + ' × ' + fmtg(r.closeB.equivWidCm, 2) + ' cm');
      out.push({
        kind: 'patch',
        t: '想让 ' + r.closeB.eggCount + ' 个蛋整好用完、比例也对',
        d: '把目标模的' + want + '（现在的 ' + nowSize + ' 装这 ' + r.closeB.eggCount + ' 个蛋的方子会差 ' + pctFrac(r.closeB.kDeviation, 2) + '）。',
        patch: (r.dst.shape === 'round')
          ? { dstShape: 'round', dstDia: Math.round(r.closeB.equivDiaCm * 100) / 100 }
          : { dstLen: Math.round(r.closeB.equivLenCm * 100) / 100, dstWid: Math.round(r.closeB.equivWidCm * 100) / 100 }
      });
    }
    if (r.reverse && r.reverse.shape && r.reverse.shape.sideCm) {
      out.push({
        kind: 'patch',
        t: '手边只有方模',
        d: '用 ' + fmtg(r.reverse.shape.sideCm, 2) + ' × ' + fmtg(r.reverse.shape.sideCm, 2) + ' cm 的方模（面积 ' + fmtg(r.reverse.shape.areaCm2, 2) + ' cm²，与目标圆模几乎一样大）。',
        patch: { dstShape: 'rect', dstLen: Math.round(r.reverse.shape.sideCm * 100) / 100, dstWid: Math.round(r.reverse.shape.sideCm * 100) / 100 }
      });
    }
    if (!r.closeA.available && r.egg.srcCount > 0) {
      out.push({
        kind: 'patch',
        t: '让收口①能用起来',
        d: '现在没有任何一行勾成液体，' + r.closeA.reason,
        patch: (function () {
          var rows = CFG.rows.map(function (x) { return { name: x.name, pct: x.pct, liquid: x.liquid }; });
          if (rows.length) rows[0].liquid = true;
          return { rows: rows };
        })()
      });
    }
    if (r.k < 1 && r.k > 0) {
      out.push({
        kind: 'note',
        t: '缩小的方子不是「少放一点」这么简单',
        d: '各行的百分比一个都没变，变的只是面粉基准：从 ' + fmtg(r.flour.srcG, 2) + ' g 变成 ' + fmtg(r.flour.dstG, 2) + ' g。所有配料乘的都是同一个 k，别给某一行单独打折。'
      });
    }
    out.push({
      kind: 'patch',
      t: '把这一页恢复成默认虚构示例',
      d: '如果你只是想看看这个工具怎么用。',
      patch: null
    });
    return out.slice(0, 5);
  }
  function renderAdvice(r) {
    var box = $('advice-body'); clear(box);
    var list = ADVICE_CACHE = buildAdvice(r);
    list.forEach(function (a, i) {
      var d = el('div', 'advice' + (a.kind === 'note' ? ' dead' : ''));
      var head = el('div', 'ah');
      var n = el('div', 'at', a.t);
      head.appendChild(n);
      d.appendChild(head);
      d.appendChild(el('div', 'ad', a.d));
      if (a.kind === 'patch') {
        var row = el('div', 'btnrow');
        var b = el('button', 'btn primary sm', a.patch === null ? '恢复默认示例' : '按这条改一下');
        b.type = 'button';
        b.id = 'advice-btn-' + i;
        b.addEventListener('click', function () {
          if (a.patch === null) { CFG = A.normCfg(A.DEFAULTS); }
          else { for (var k in a.patch) if (Object.prototype.hasOwnProperty.call(a.patch, k)) CFG[k] = a.patch[k]; CFG = A.normCfg(CFG); }
          fillInputs(); refresh(); saveLocal();
        });
        row.appendChild(b);
        d.appendChild(row);
      } else {
        d.appendChild(el('div', 'note-inline', '（不需要改输入）'));
      }
      box.appendChild(d);
    });
  }
  var ADVICE_CACHE = [];

  /* ─── 渲染：反推 ──────────────────────────────────────────────────── */
  function renderReverse(r) {
    var tb = $('rev-egg'); clear(tb);
    if (r.reverse.egg) {
      r.reverse.egg.ratios.forEach(function (x) {
        var tr = el('tr', x.eggs === r.closeB.eggCount && r.closeB.available ? 'egg' : '');
        var t1 = el('td', 'num', String(x.eggs)); t1.setAttribute('data-l', '鸡蛋 个'); tr.appendChild(t1);
        var t2 = el('td', 'num', fmtg(x.flourG, 2)); t2.setAttribute('data-l', '成比例的面粉 g'); tr.appendChild(t2);
        var t3 = el('td', 'num', fmtg(x.k, 4)); t3.setAttribute('data-l', '相当于料量比 k'); tr.appendChild(t3);
        var note = x.eggs === 0 ? '没有蛋' : ('每个蛋配 ' + fmtg(r.reverse.egg.perEggFlourG, 4) + ' g 面粉');
        if (r.closeB.available && x.eggs === r.closeB.eggCount) note += '；这就是收口②选的那一行';
        var t4 = el('td', null, note); t4.setAttribute('data-l', '说明'); tr.appendChild(t4);
        tb.appendChild(tr);
      });
    } else {
      var tr = el('tr'); var td = el('td', null, '这个方子没有鸡蛋，反推不适用'); td.setAttribute('colspan', '4'); tr.appendChild(td); tb.appendChild(tr);
    }

    var ts = $('rev-shape'); clear(ts);
    r.tables.shape.forEach(function (x) {
      var tr = el('tr');
      var t1 = el('td', null, x.what); t1.setAttribute('data-l', '换算'); tr.appendChild(t1);
      var t2 = el('td', 'num', fmtg(x.areaCm2, 4)); t2.setAttribute('data-l', '面积 cm²'); tr.appendChild(t2);
      var t3 = el('td', 'num', x.volumeCm3 === undefined ? '—' : fmtg(x.volumeCm3, 4)); t3.setAttribute('data-l', '体积 cm³'); tr.appendChild(t3);
      var txt = x.equivSideCm !== undefined ? ('等面积方模边长 ' + fmtg(x.equivSideCm, 4) + ' cm') : ('等面积圆模 φ' + fmtg(x.equivDiaCm, 4) + ' cm');
      var t4 = el('td', null, txt); t4.setAttribute('data-l', '等容积的另一形状'); tr.appendChild(t4);
      ts.appendChild(tr);
    });
    var sw = r.reverse.shape;
    var tr2 = el('tr', 'egg');
    var c1 = el('td', null, '结论'); c1.setAttribute('data-l', '换算'); tr2.appendChild(c1);
    var c2 = el('td', 'num', fmtg(sw.areaCm2, 4)); c2.setAttribute('data-l', '面积 cm²'); tr2.appendChild(c2);
    var c3 = el('td', 'num', fmtg(sw.volumeCm3, 4)); c3.setAttribute('data-l', '体积 cm³'); tr2.appendChild(c3);
    var c4 = el('td', null, sw.from === 'round'
      ? ('目标圆模 φ' + fmtg(sw.diaCm, 4) + ' 换成长方形，边长 ' + fmtg(sw.sideCm, 4) + ' cm（不是把直径当边长）')
      : ('目标方模换成正圆，直径 ' + fmtg(sw.diaCm, 4) + ' cm'));
    c4.setAttribute('data-l', '等容积的另一形状'); tr2.appendChild(c4);
    ts.appendChild(tr2);

    var ti = $('rev-inch'); clear(ti);
    r.reverse.roundSizes.forEach(function (x) {
      var tr = el('tr');
      var t1 = el('td', 'num', String(x.inch)); t1.setAttribute('data-l', '寸'); tr.appendChild(t1);
      var t2 = el('td', 'num', fmtg(x.diaCm, 2)); t2.setAttribute('data-l', '直径 cm'); tr.appendChild(t2);
      var t3 = el('td', 'num', fmtg(x.areaCm2, 2)); t3.setAttribute('data-l', '面积 cm²'); tr.appendChild(t3);
      var t4 = el('td', 'num', fmtg(x.equivSideCm, 2)); t4.setAttribute('data-l', '等面积方模边长 cm'); tr.appendChild(t4);
      var t5 = el('td', 'num', fmtg(x.kVsSrc, 4)); t5.setAttribute('data-l', '相对原模的 k'); tr.appendChild(t5);
      ti.appendChild(tr);
    });
  }

  /* ─── 渲染：对照表 ────────────────────────────────────────────────── */
  function renderTables(r) {
    var tb = $('dia-body'); clear(tb);
    r.tables.dia.forEach(function (x) {
      var tr = el('tr', x.factor === 1 ? 'egg' : '');
      var t1 = el('td', 'num', x.diaCm === null ? '—' : fmtg(x.diaCm, 4)); t1.setAttribute('data-l', '目标尺寸 cm'); tr.appendChild(t1);
      var t2 = el('td', 'num', '×' + fmtg(x.factor, 2)); t2.setAttribute('data-l', '系数'); tr.appendChild(t2);
      var t3 = el('td', 'num', fmtg(x.k, 6)); t3.setAttribute('data-l', 'k'); tr.appendChild(t3);
      var t4 = el('td', 'num', fmtg(x.flourG, 2)); t4.setAttribute('data-l', '面粉 g'); tr.appendChild(t4);
      var t5 = el('td', 'num', fmtg(x.firstRowG, 2)); t5.setAttribute('data-l', (x.firstRowName || '首个配料') + ' g'); tr.appendChild(t5);
      var t6 = el('td', 'num', String(x.eggCount)); t6.setAttribute('data-l', '建议蛋数'); tr.appendChild(t6);
      var t7 = el('td', 'num', fmtg(x.totalG, 2)); t7.setAttribute('data-l', '总料 g'); tr.appendChild(t7);
      tb.appendChild(tr);
    });
    var th = $('ht-body'); clear(th);
    r.tables.height.forEach(function (x) {
      var tr = el('tr', approx(x.heightCm, r.dst.heightCm) ? 'egg' : '');
      var t1 = el('td', 'num', fmtg(x.heightCm, 2)); t1.setAttribute('data-l', '目标高度 cm'); tr.appendChild(t1);
      var t2 = el('td', 'num', fmtg(x.k, 6)); t2.setAttribute('data-l', 'k'); tr.appendChild(t2);
      var t3 = el('td', 'num', fmtg(x.flourG, 2)); t3.setAttribute('data-l', '面粉 g'); tr.appendChild(t3);
      var t4 = el('td', 'num', fmtg(x.totalG, 2)); t4.setAttribute('data-l', '总料 g'); tr.appendChild(t4);
      th.appendChild(tr);
    });
  }

  /* ─── 渲染：自检 / 说明 / 底栏 ────────────────────────────────────── */
  function renderSelfChecks() {
    var box = $('sc-body'); clear(box);
    SC.forEach(function (c) {
      var d = el('div', 'ck' + (c.pass ? '' : ' f'));
      d.appendChild(el('div', 'dot', c.pass ? '✓' : '✕'));
      var w = el('div');
      w.appendChild(el('div', null, c.label));
      if (c.detail) w.appendChild(el('div', 'dtx', c.detail));
      d.appendChild(w);
      box.appendChild(d);
    });
    $('sc-count').textContent = RES ? (RES.passCount + ' / ' + RES.totalCount + ' 通过') : '—';
    $('fb-sc').textContent = RES ? (RES.passCount + '/' + RES.totalCount) : '—';
  }
  function renderNotes(r) {
    var ul = $('notes'); clear(ul);
    function li(t) { ul.appendChild(el('li', null, t)); }
    li('料量比 k = 目标容积 ÷ 原容积 = ' + fmtg(r.k, 6) + '（本页用' + (r.sameHeight ? '面积比，两模等高时它等于容积比' : '容积比（两模不等高）') + '）。');
    li('本页把每个模都当成一个规整的柱体：圆模是圆柱、方模是长方体；实际的收口、圆角、斜壁会让真实容积略小于这个数。');
    li('鸡蛋按你填的「每个蛋的蛋液 ' + fmtg(r.egg.gPerEgg, 2) + ' g」折算；不同大小的蛋差别不小，写清楚比写"3 个蛋"更准。');
    li('称量刻度 ' + fmtg(r.totals.roundStepG, 2) + ' g、' + (r.totals.roundMode === 'up' ? '一律向上' : '四舍五入（半格向上）') + '：这一项只影响"照着称"的那一列，精确值一列不受它影响。');
    li('勾成液体的行：' + (r.rows.filter(function (x) { return x.liquid; }).map(function (x) { return x.name; }).join('、') || '（一行都没勾）') + '（只用于收口①）。');
    li('默认示例是虚构的，数字是为了好核对而挑的干净值，不是你或任何人的真实配方。');
  }
  function renderFoot(r) {
    $('fb-k').textContent = fmtg(r.k, 4);
    $('fb-flour').textContent = fmtg(r.flour.rounded, 2) + ' g';
    $('fb-egg').textContent = r.egg.suggestedCount + ' 个';
  }

  /* ─── 主刷新 ──────────────────────────────────────────────────────── */
  function refresh() {
    readInputs();
    syncShape();
    var errs = A.validate(CFG);
    markBad(errs);
    renderErrors(errs);
    if (errs.length) {
      ['sec-diagnosis', 'sec-geometry', 'sec-newrecipe', 'sec-egg', 'sec-advice', 'sec-reverse', 'sec-tables'].forEach(function (id) {
        $(id).className = 'card hidden';
      });
      $('sec-selfcheck').className = 'card hidden';
      $('badge-scene').textContent = '输入有问题，结果先收起来';
      $('badge-src').textContent = '—'; $('badge-dst').textContent = '—';
      $('fb-k').textContent = '—'; $('fb-flour').textContent = '—'; $('fb-egg').textContent = '—'; $('fb-sc').textContent = '—';
      RES = null; SC = [];
      return null;
    }
    ['sec-diagnosis', 'sec-geometry', 'sec-newrecipe', 'sec-egg', 'sec-advice', 'sec-reverse', 'sec-tables', 'sec-selfcheck'].forEach(function (id) {
      $(id).className = 'card';
    });
    RES = A.compute(CFG, {});
    SC = RES.selfChecks;
    renderDiagnosis(RES);
    renderGeometry(RES);
    renderNew(RES);
    renderEgg(RES);
    renderAdvice(RES);
    renderReverse(RES);
    renderTables(RES);
    renderSelfChecks();
    renderNotes(RES);
    renderFoot(RES);
    return RES;
  }

  /* ─── 导出 ────────────────────────────────────────────────────────── */
  function ts() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }
  function csvText() { return A.toCSV(CFG, RES); }
  function mdText() { return A.toMD(CFG, RES); }
  function jsonText() { return A.toJSON(CFG, RES); }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.style.position = 'fixed'; a.style.left = '-9999px';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
    return name;
  }
  function downloadPng() {
    var cv = drawCard(RES);
    return new Promise(function (resolve) {
      if (!cv.toBlob) { resolve(null); return; }
      cv.toBlob(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = '改方子-结果卡-' + ts() + '.png'; a.style.position = 'fixed'; a.style.left = '-9999px';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 2000);
        resolve(a.download);
      }, 'image/png');
    });
  }

  /* ─── 结果卡（1080×1350）与封面（1200×1200） ─────────────────────── */
  function wrapText(g, text, x, y, maxW, lh, maxLines) {
    var line = '', lines = [], i;
    for (i = 0; i < text.length; i++) {
      var t = line + text[i];
      if (g.measureText(t).width > maxW && line) {
        /* 先找最近的一个空格断行：数字被从中间劈开（"324." / "2928"）看起来像写错了 */
        var cut = line.lastIndexOf(' ');
        if (cut > 0 && line.length - cut <= 16) { lines.push(line.slice(0, cut)); line = line.slice(cut + 1) + text[i]; }
        else { lines.push(line); line = text[i]; }
        if (lines.length >= maxLines) break;
      } else line = t;
    }
    if (lines.length < maxLines && line) lines.push(line);
    lines.forEach(function (l, k) { g.fillText(l, x, y + k * lh); });
    return lines.length;
  }
  function drawCard(r) {
    var W = 1080, H = 1350;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#8a5a1e'; g.fillRect(0, 0, W, 10);
    g.textBaseline = 'top';
    g.fillStyle = '#1b1a17'; g.font = '700 54px -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif';
    g.fillText('改方子', 70, 62);
    g.fillStyle = '#54514a'; g.font = '26px -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif';
    wrapText(g, r.label, 70, 132, W - 140, 36, 2);
    g.fillStyle = '#837f76'; g.font = '23px -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif';
    g.fillText(r.src.label + '  →  ' + r.dst.label, 70, 210);

    g.fillStyle = '#f6eee0'; g.fillRect(70, 258, W - 140, 148);
    g.fillStyle = '#8a5a1e'; g.font = '700 30px -apple-system,"PingFang SC",sans-serif';
    g.fillText('料量比 k', 100, 282);
    g.font = '700 62px -apple-system,"PingFang SC",sans-serif';
    g.fillText(String(r.k), 100, 320);
    g.fillStyle = '#1b1a17'; g.font = '26px -apple-system,"PingFang SC",sans-serif';
    g.fillText('面粉 ' + r.flour.srcG + ' g  →  ' + r.flour.dstG + ' g（按刻度称 ' + r.flour.rounded + ' g）', 430, 292);
    g.fillStyle = '#54514a'; g.font = '24px -apple-system,"PingFang SC",sans-serif';
    g.fillText('鸡蛋 ' + r.egg.srcCount + ' 个  →  目标 ' + r.egg.exactCount + ' 个，取整 ' + r.egg.suggestedCount + ' 个', 430, 336);

    var y = 440;
    g.fillStyle = '#1b1a17'; g.font = '700 30px -apple-system,"PingFang SC",sans-serif';
    g.fillText('新方（照着称）', 70, y); y += 48;
    g.font = '25px -apple-system,"PingFang SC",sans-serif';
    g.fillStyle = '#54514a';
    g.fillText('配料', 70, y); g.fillText('原方', 560, y); g.fillText('新方精确', 720, y); g.fillText('按刻度', 910, y);
    y += 34;
    g.strokeStyle = '#e6e2d9'; g.beginPath(); g.moveTo(70, y - 6); g.lineTo(W - 70, y - 6); g.stroke();
    function line(name, a, b, c, bold) {
      g.fillStyle = bold ? '#1b1a17' : '#33312c';
      g.font = (bold ? '700 ' : '') + '26px -apple-system,"PingFang SC",sans-serif';
      g.fillText(String(name).slice(0, 16), 70, y);
      g.fillText(String(a), 560, y); g.fillText(String(b), 720, y);
      g.fillStyle = '#8a5a1e'; g.fillText(String(c), 910, y);
      y += 40;
    }
    line('面粉（基准）', r.flour.srcG, r.flour.dstG, r.flour.rounded, true);
    r.rows.slice(0, 5).forEach(function (x) { line(x.name, x.srcG, x.dstG, x.rounded); });
    line('鸡蛋', r.egg.srcCount + ' 个', r.egg.exactCount + ' 个', r.egg.suggestedCount + ' 个', true);
    y += 10;
    g.strokeStyle = '#cfc9bb'; g.beginPath(); g.moveTo(70, y - 8); g.lineTo(W - 70, y - 8); g.stroke();
    y += 12;

    g.fillStyle = '#1b1a17'; g.font = '700 30px -apple-system,"PingFang SC",sans-serif';
    g.fillText('鸡蛋不能切：两条路', 70, y); y += 44;
    g.font = '25px -apple-system,"PingFang SC",sans-serif'; g.fillStyle = '#33312c';
    if (r.closeA.available) {
      y += wrapText(g, '① 扣液体：用 ' + r.closeA.eggCount + ' 个蛋（' + r.closeA.eggG + ' g），差额 ' + r.closeA.eggDiffG + ' g 从液体行扣掉，改完总液体 ' + r.closeA.actualLiquidG + ' g（守恒）。', 70, y, W - 140, 34, 2) * 34 + 6;
    } else { y += wrapText(g, '① 扣液体：不适用（' + r.closeA.reason + '）', 70, y, W - 140, 34, 2) * 34 + 6; }
    if (r.closeB.available) {
      y += wrapText(g, '② 按整蛋配平：' + r.closeB.eggCount + ' 个蛋 → 面粉 ' + r.closeB.flourG + ' g，与目标 k 相差 ' + (r.closeB.kDeviation * 100).toFixed(2) + '%。', 70, y, W - 140, 34, 2) * 34 + 6;
    } else { y += wrapText(g, '② 按整蛋配平：不适用（' + r.closeB.reason + '）', 70, y, W - 140, 34, 2) * 34 + 6; }
    if (r.naive) {
      y += wrapText(g, '按直径比缩会多放 ' + (r.naive.extraPct * 100).toFixed(2) + '% 的料 —— 面积跟直径的平方走。', 70, y, W - 140, 34, 2) * 34 + 14;
    }
    g.fillStyle = '#1b1a17'; g.font = '700 30px -apple-system,"PingFang SC",sans-serif';
    g.fillText('换算依据', 70, y); y += 44;
    g.font = '25px -apple-system,"PingFang SC",sans-serif'; g.fillStyle = '#33312c';
    y += wrapText(g, '面积 ' + r.src.areaCm2 + ' → ' + r.dst.areaCm2 + ' cm2（圆 πD x D / 4，方 长 x 宽）；容积 ' + r.src.volumeCm3 + ' → ' + r.dst.volumeCm3 + ' cm3；k = 面积比 ' + r.kArea + ' x 高度比 ' + r.kHeight + '。', 70, y, W - 140, 34, 3) * 34 + 14;
    g.fillStyle = '#1b1a17'; g.font = '700 30px -apple-system,"PingFang SC",sans-serif';
    g.fillText('下一步', 70, y); y += 44;
    g.font = '25px -apple-system,"PingFang SC",sans-serif'; g.fillStyle = '#33312c';
    var pe = r.reverse.egg ? Math.round(r.reverse.egg.perEggFlourG * 100) / 100 : null;
    var nextTxt = r.reverse.egg ? ('每个蛋配 ' + pe + ' g 面粉：想用 2 个蛋就配 ' + Math.round(pe * 2 * 100) / 100 + ' g 面粉。') : '这个方子没有鸡蛋，按 k 缩放即可。';
    if (r.reverse.shape && r.reverse.shape.sideCm) nextTxt += '等面积方模边长 ' + r.reverse.shape.sideCm + ' cm。';
    if (r.closeB.available && r.closeB.equivDiaCm) nextTxt += '想让 ' + r.closeB.eggCount + ' 个蛋整好用完，目标模改成 φ' + r.closeB.equivDiaCm + ' cm。';
    y += wrapText(g, nextTxt, 70, y, W - 140, 34, 3) * 34;

    g.fillStyle = '#f0efe9'; g.fillRect(0, H - 118, W, 118);
    g.fillStyle = '#54514a'; g.font = '23px -apple-system,"PingFang SC",sans-serif';
    g.fillText('算式自检 ' + r.passCount + '/' + r.totalCount + ' 通过　·　默认值是虚构示例　·　页面不联网', 70, H - 92);
    g.fillStyle = '#837f76'; g.font = '21px -apple-system,"PingFang SC",sans-serif';
    g.fillText('改方子 · 按容积比换算配方，并处理鸡蛋不能切', 70, H - 58);
    return cv;
  }
  function drawCover(r) {
    var W = 1200, H = 1200;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.fillStyle = '#fbf8f2'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#8a5a1e'; g.fillRect(0, 0, W, 16);
    g.textBaseline = 'top';
    g.fillStyle = '#1b1a17'; g.font = '700 96px -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif';
    g.fillText('改方子', 90, 118);
    g.fillStyle = '#54514a'; g.font = '34px -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif';
    wrapText(g, '8 寸的方子换到 6 寸模：要乘的不是 0.75，是 0.5625', 90, 246, W - 180, 48, 2);
    g.fillStyle = '#837f76'; g.font = '28px -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif';
    wrapText(g, '圆模换方模、高矮不一样的模、鸡蛋不能切 —— 一次算清', 90, 352, W - 180, 40, 2);

    g.fillStyle = '#ffffff'; g.strokeStyle = '#e6e2d9'; g.lineWidth = 2;
    g.fillRect(90, 452, 480, 210); g.strokeRect(90, 452, 480, 210);
    g.fillStyle = '#837f76'; g.font = '26px -apple-system,"PingFang SC",sans-serif';
    g.fillText('按直径比缩（错）', 122, 480);
    g.fillStyle = '#a3251b'; g.font = '700 62px -apple-system,"PingFang SC",sans-serif';
    g.fillText('0.75', 122, 522);
    g.fillStyle = '#54514a'; g.font = '24px -apple-system,"PingFang SC",sans-serif';
    wrapText(g, '面粉要放 75 g，比该放的 56.25 g 多了 18.75 g', 122, 600, 436, 32, 2);

    g.fillStyle = '#ffffff'; g.strokeStyle = '#8a5a1e'; g.lineWidth = 3;
    g.fillRect(630, 452, 480, 210); g.strokeRect(630, 452, 480, 210);
    g.fillStyle = '#8a5a1e'; g.font = '26px -apple-system,"PingFang SC",sans-serif';
    g.fillText('按面积比（对）', 662, 480);
    g.fillStyle = '#8a5a1e'; g.font = '700 62px -apple-system,"PingFang SC",sans-serif';
    g.fillText('0.5625', 662, 522);
    g.fillStyle = '#54514a'; g.font = '24px -apple-system,"PingFang SC",sans-serif';
    wrapText(g, '面积跟直径的平方走 —— 这就是料量比 k', 662, 600, 420, 32, 2);

    g.fillStyle = '#1b1a17'; g.font = '700 34px -apple-system,"PingFang SC",sans-serif';
    g.fillText('还有一件不能按比例缩的事：鸡蛋不能切', 90, 720);
    g.fillStyle = '#54514a'; g.font = '28px -apple-system,"PingFang SC",sans-serif';
    wrapText(g, '目标 1.6875 个蛋：要么用 2 个蛋、把多出来的 15.625 g 蛋液从牛奶里扣掉（总液体守恒），要么按 2 个蛋反推面粉、整条方子等比（比例全对）。两条路的代价，页面都算出来。', 90, 776, W - 180, 42, 4);

    g.fillStyle = '#1b1a17'; g.font = '700 34px -apple-system,"PingFang SC",sans-serif';
    g.fillText('换算依据：k 是容积比 = 面积比 x 高度比', 90, 902);
    g.fillStyle = '#54514a'; g.font = '28px -apple-system,"PingFang SC",sans-serif';
    wrapText(g, '圆面积 πD x D / 4、方面积 长 x 宽，再乘侧壁内高得到容积。这一组：面积 ' + r.src.areaCm2 + ' → ' + r.dst.areaCm2 + ' cm2，容积 ' + r.src.volumeCm3 + ' → ' + r.dst.volumeCm3 + ' cm3，k = ' + r.kArea + ' x ' + r.kHeight + '。', 90, 954, W - 180, 40, 3);

    g.fillStyle = '#f0efe9'; g.fillRect(0, H - 116, W, 116);
    g.fillStyle = '#54514a'; g.font = '26px -apple-system,"PingFang SC",sans-serif';
    g.fillText('填自己的方子 · 页面不联网 · 默认值是虚构示例', 90, H - 88);
    g.fillStyle = '#837f76'; g.font = '23px -apple-system,"PingFang SC",sans-serif';
    g.fillText('尺寸按模具内侧量；不给烘烤温度与时间建议', 90, H - 52);
    return cv;
  }

  /* ─── 对外钩子（验收脚本用） ──────────────────────────────────────── */
  window.__exports = {
    csv: function () { return csvText(); },
    md: function () { return mdText(); },
    json: function () { return String(jsonText()); },
    png: function () { return downloadPng(); },
    names: function (kind) {
      var base = '改方子';
      return kind === 'png' ? base + '-结果卡-' + ts() + '.png' : base + '-' + kind.toUpperCase() + '-' + ts() + '.' + (kind === 'md' ? 'md' : kind);
    },
    doCsv: function () { return download(window.__exports.names('csv'), csvText(), 'text/csv;charset=utf-8'); },
    doMd: function () { return download(window.__exports.names('md'), mdText(), 'text/markdown;charset=utf-8'); },
    doJson: function () { return download(window.__exports.names('json'), jsonText(), 'application/json;charset=utf-8'); },
    doPng: function () { return downloadPng(); }
  };
  window.__app = {
    cfg: function () { return CFG; },
    result: function () { return RES; },
    checks: function () { return SC; },
    advice: function () { return ADVICE_CACHE; },
    scenarios: function () { return SCENARIOS; },
    refresh: refresh,
    setCfg: function (patch) {
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) CFG[k] = patch[k];
      CFG = A.normCfg(CFG);
      fillInputs();
      return refresh();
    },
    reset: function () { CFG = A.normCfg(A.DEFAULTS); fillInputs(); return refresh(); },
    clearStore: function () { try { localStorage.removeItem(LS_KEY); } catch (e) { } return true; },
    importText: function (txt) {
      try {
        var o = JSON.parse(String(txt));
        if (!o || !o.cfg) return 'no-cfg';
        CFG = A.normCfg(o.cfg); fillInputs(); refresh(); saveLocal();
        return 'imported';
      } catch (e) { return 'err:' + e.message; }
    },
    save: saveLocal,
    seed: function () { var v = restoreOrSeed(); return v ? 'restored' : 'fresh'; },
    csvText: csvText, mdText: mdText, jsonText: jsonText,
    cardSize: function () { var cv = drawCard(RES); return { w: cv.width, h: cv.height }; },
    coverSize: function () { var cv = drawCover(RES); return { w: cv.width, h: cv.height }; },
    saveCover: function (name) {
      var cv = drawCover(RES);
      return new Promise(function (resolve) {
        cv.toBlob(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = (name || 'cover') + '.png';
          a.style.position = 'fixed'; a.style.left = '-9999px';
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 2000);
          resolve(a.download);
        }, 'image/png');
      });
    },
    lsKey: LS_KEY
  };

  /* ─── 事件 ────────────────────────────────────────────────────────── */
  function bind() {
    ['input', 'change'].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        var t = e.target;
        if (!t || !t.id || t.id.indexOf('f-') !== 0) return;
        if (t.id === 'file-import') return;
        refresh(); saveLocal();
      }, true);
    });
    ['f-srcShape', 'f-dstShape'].forEach(function (id) {
      $(id).addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button[data-v]') : null;
        if (!b) return;
        setChip(id, b.getAttribute('data-v'));
        syncShape(); refresh(); saveLocal();
      });
    });
    ['f-roundStep', 'f-roundMode'].forEach(function (id) {
      $(id).addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button[data-v]') : null;
        if (!b) return;
        setChip(id, b.getAttribute('data-v'));
        refresh(); saveLocal();
      });
    });
    $('btn-add-row').addEventListener('click', addRow);
    $('btn-save').addEventListener('click', function () {
      var ok = saveLocal();
      $('btn-save').textContent = ok ? '已保存（刷新会恢复）' : '保存失败';
      setTimeout(function () { $('btn-save').textContent = '保存到本机'; }, 2200);
    });
    $('btn-reset').addEventListener('click', function () { CFG = A.normCfg(A.DEFAULTS); fillInputs(); refresh(); saveLocal(); });
    $('btn-export-csv').addEventListener('click', function () { window.__exports.doCsv(); });
    $('btn-export-md').addEventListener('click', function () { window.__exports.doMd(); });
    $('btn-export-png').addEventListener('click', function () { window.__exports.doPng(); });
    $('btn-export-json').addEventListener('click', function () { window.__exports.doJson(); });
    $('btn-import-json').addEventListener('click', function () { $('file-import').click(); });
    $('file-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var o = JSON.parse(String(fr.result));
          if (o && o.cfg) { CFG = A.normCfg(o.cfg); fillInputs(); refresh(); saveLocal(); }
        } catch (err) { /* 坏文件静默忽略，不动现有输入 */ }
      };
      fr.readAsText(f);
      e.target.value = '';
    });
    /* 采用哪一条收口：这是一次"读数选择"，不是改配方 —— 所以它不改任何输入，
       只记下来并写进 CSV / MD 导出，免得你三天后忘了当初照哪张表称的 */
    $('btn-apply-A').addEventListener('click', function () {
      if (!RES || !RES.closeA.available) return;
      CFG.closeChoice = CFG.closeChoice === 'A' ? 'none' : 'A';
      fillInputs(); refresh(); saveLocal();
    });
    $('btn-apply-B').addEventListener('click', function () {
      if (!RES || !RES.closeB.available) return;
      CFG.closeChoice = CFG.closeChoice === 'B' ? 'none' : 'B';
      fillInputs(); refresh(); saveLocal();
    });
    $('scenarios').addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-v]') : null;
      if (!b) return;
      var i = Number(b.getAttribute('data-v'));
      var s = SCENARIOS[i];
      if (!s) return;
      var base = A.normCfg(A.DEFAULTS);
      for (var k in s.patch) if (Object.prototype.hasOwnProperty.call(s.patch, k)) base[k] = s.patch[k];
      CFG = A.normCfg(base);
      fillInputs(); refresh(); saveLocal();
    });
  }
  function renderScenarios() {
    var box = $('scenarios'); clear(box);
    SCENARIOS.forEach(function (s, i) {
      var b = el('button', 'chip', s.label);
      b.type = 'button'; b.setAttribute('data-v', String(i));
      box.appendChild(b);
    });
  }

  /* ─── 启动 ────────────────────────────────────────────────────────── */
  function init(seed) {
    renderScenarios();
    if (seed) CFG = seed;
    fillInputs();
    bind();
    refresh();
  }
  window.__boot = function (mode) {
    var m = mode || 'restore';
    var seed = null;
    if (m === 'restore') seed = restoreOrSeed();
    else if (m === 'fresh') { try { localStorage.removeItem(LS_KEY); } catch (e) { } }
    init(seed);
    return m;
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') window.__boot('restore');
  else document.addEventListener('DOMContentLoaded', function () { window.__boot('restore'); });
})();
