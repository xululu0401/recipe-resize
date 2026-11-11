/* 改方子 · 配方按模具换算与配平（core.js）
 *
 * 纯函数引擎：不联网、不读外网、不内置任何真实配方、品牌、面粉吸水性或鸡蛋规格。
 * 所有默认值都是本页的设计默认值（**虚构示例**），可以在界面上改。
 * 运行环境：浏览器 <script>（window.AppCore）与 node（module.exports）通用。
 *
 * ── 模型一共五步，页面上逐步写明 ────────────────────────────────────────
 * ① 面积与体积
 *      圆模 A = πD²/4          方模 A = 长 × 宽          V = A × H
 * ② 料量比（唯一决定"乘以几"的数）
 *      k = V_目标 ÷ V_原 = (A_目标 ÷ A_原) × (H_目标 ÷ H_原)
 *      两个模等高时 k 退化成面积比；**不是直径比**（直径比要平方之后才对）
 * ③ 新方（不含蛋）：面粉' = 面粉 × k；第 i 行 = pct_i% × 面粉'
 * ④ 鸡蛋：蛋液目标 = 蛋数 × 每蛋克数 × k；建议蛋数 = round(蛋液目标 ÷ 每蛋克数)
 *      收口①「扣液体」：差额 = 建议蛋数×每蛋克数 − 蛋液目标，按各行原占比摊到勾选的液体行，
 *                        改完总液体守恒（配方结构变了，代价是液体被挤掉一部分）
 *      收口②「按整蛋配平」：面粉'' = 建议蛋数×每蛋克数 ÷ (原蛋液 ÷ 原面粉)，
 *                        全方按面粉''等比（比例全对，代价是总料量偏离目标 k）
 * ⑤ 舍入：q(x) = round(x÷刻度)×刻度 或 ceil(x÷刻度)×刻度 —— 只影响"照着称"的数，
 *      不影响任何精确值；舍入总误差单独报出来。
 *
 * ── 边界（写进页面与说明）──
 * 不给烘烤温度/时间建议（不随配方线性缩放，不在可复算范围内）；不换算杯/毫升（密度是原料属性）；
 * 不做心形/中空/异形模；异形模请自行按"装水量"折成等价直径。
 */
'use strict';

var SHAPES = [
  { key: 'round', label: '圆模（按直径算）' },
  { key: 'rect', label: '方模 / 长方模（按长 × 宽算）' }
];

var ROUND_MODES = [
  { key: 'nearest', label: '四舍五入到刻度' },
  { key: 'up', label: '一律向上到刻度' }
];

var DEFAULTS = {
  label: '虚构示例：8 寸圆模的方子改成 6 寸圆模',
  srcShape: 'round', srcDia: 20.32, srcLen: 20, srcWid: 20, srcHeight: 6,
  dstShape: 'round', dstDia: 15.24, dstLen: 15, dstWid: 15, dstHeight: 6,
  flourG: 100,
  eggCount: 3,
  eggG: 50,
  rows: [
    { name: '牛奶', pct: 60, liquid: true },
    { name: '细砂糖', pct: 45, liquid: false },
    { name: '玉米油', pct: 40, liquid: false }
  ],
  roundStep: 1,
  roundMode: 'nearest',
  closeChoice: 'none'          // 'none' | 'A'（扣液体）| 'B'（按整蛋配平）—— 只影响导出里写哪一条
};

var CLOSE_CHOICES = [
  { key: 'none', label: '还没定' },
  { key: 'A', label: '① 扣液体（总液体守恒）' },
  { key: 'B', label: '② 按整蛋配平（比例全对）' }
];

var LIMITS = {
  srcDia: [5, 60], dstDia: [5, 60],
  srcLen: [3, 80], srcWid: [3, 80], dstLen: [3, 80], dstWid: [3, 80],
  srcHeight: [1, 30], dstHeight: [1, 30],
  flourG: [10, 5000],
  eggCount: [0, 24],
  eggG: [10, 100],
  pct: [0.1, 500],
  roundStep: [0.1, 10]
};

var MAX_ROWS = 8;
var DIA_FACTORS = [0.8, 0.9, 1.0, 1.1, 1.2];
var HEIGHT_TABLE = [4, 5, 6, 7, 8];
var INCH_TABLE = [6, 7, 8, 9, 10];
var CM_PER_INCH = 2.54;

/* ─── 数值工具 ───────────────────────────────────────────────────────── */
function r2(x) { var v = Math.round(x * 1e2) / 1e2; return v === 0 ? 0 : v; }
function r4(x) { var v = Math.round(x * 1e4) / 1e4; return v === 0 ? 0 : v; }
function r6(x) { var v = Math.round(x * 1e6) / 1e6; return v === 0 ? 0 : v; }
function num(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  var n = typeof v === 'number' ? v : Number(String(v).replace(/[,，\s]/g, ''));
  return isFinite(n) ? n : NaN;
}
function shape(key) {
  for (var i = 0; i < SHAPES.length; i++) if (SHAPES[i].key === key) return SHAPES[i];
  return SHAPES[0];
}
function roundMode(key) {
  for (var i = 0; i < ROUND_MODES.length; i++) if (ROUND_MODES[i].key === key) return ROUND_MODES[i];
  return ROUND_MODES[0];
}
function closeChoice(key) {
  for (var i = 0; i < CLOSE_CHOICES.length; i++) if (CLOSE_CHOICES[i].key === key) return CLOSE_CHOICES[i];
  return CLOSE_CHOICES[0];
}

/* 按刻度取整：刻度不合法时返回 NaN，让上层报错而不是静默取整。
 * 先把输入归一到 6 位小数：22.499999999999996 与 22.5 必须给出同一个答案，
 * 否则同一行在两个收口表里会取整成不同的数（本轮实测踩到过）。
 * 半格一律向上（22.5 → 23）。 */
function q(x, step, mode) {
  if (!(step > 0) || !isFinite(x)) return NaN;
  var v = r6(x) / step;
  var n = mode === 'up' ? Math.ceil(v - 1e-9) : Math.round(v + 1e-9);
  return r6(n * step);
}

/* ─── 归一化：输入框读出来的是字符串，数值字段必须在这里统一转 number ── */
var DIM_NUM_KEYS = ['srcDia', 'srcLen', 'srcWid', 'srcHeight', 'dstDia', 'dstLen', 'dstWid', 'dstHeight'];
var NUM_KEYS = ['flourG', 'eggCount', 'eggG', 'roundStep'].concat(DIM_NUM_KEYS);

function normRows(raw) {
  var list = Array.isArray(raw) ? raw : [];
  var out = [];
  for (var i = 0; i < list.length && out.length < MAX_ROWS; i++) {
    var r = list[i] || {};
    var pct = num(r.pct);
    if (!(pct > 0)) pct = NaN;          // 留空或非法 → 保留 NaN 交给 validate
    out.push({
      name: (typeof r.name === 'string' && r.name.trim()) ? r.name.trim().slice(0, 20) : ('配料 ' + (out.length + 1)),
      pct: pct,
      liquid: !!r.liquid
    });
  }
  return out;
}

function normCfg(raw) {
  var src = raw || {}, out = {}, k, i;
  for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) out[k] = DEFAULTS[k];
  for (i = 0; i < NUM_KEYS.length; i++) {
    k = NUM_KEYS[i];
    if (src[k] === undefined || src[k] === null) continue;   // 没提供 → 用默认
    var n = num(src[k]);
    /* 提供了但读不出数字（含空串、乱填）→ 一律 NaN，交给 validate 报出来，
       不允许把"用户清空了输入框"静默换成默认值 */
    out[k] = isFinite(n) ? n : NaN;
  }
  if (typeof src.label === 'string' && src.label.trim()) out.label = src.label.trim().slice(0, 60);
  out.srcShape = shape(src.srcShape).key;
  out.dstShape = shape(src.dstShape).key;
  out.roundMode = roundMode(src.roundMode).key;
  out.closeChoice = closeChoice(src.closeChoice).key;
  out.rows = normRows(src.rows === undefined ? DEFAULTS.rows : src.rows);
  if (typeof src.eggCount === 'number' && src.eggCount === 0) out.eggCount = 0; // 0 个蛋是合法输入，别被当成"没填"
  return out;
}

/* ─── 校验 ───────────────────────────────────────────────────────────── */
function inRange(v, lo, hi) { return isFinite(v) && v >= lo && v <= hi; }

function validate(cfg) {
  var errs = [], k, lim;
  function bad(field, msg) { errs.push({ field: field, msg: msg }); }
  function checkNum(field, label, lo, hi) {
    var v = cfg[field];
    if (!isFinite(v)) { bad(field, label + '：请填一个数字'); return false; }
    if (v < lo || v > hi) { bad(field, label + '：' + fmtNum(lo) + ' – ' + fmtNum(hi) + ' 之间'); return false; }
    return true;
  }
  function fmtNum(v) { return String(v); }

  checkNum('flourG', '面粉基准（g）', LIMITS.flourG[0], LIMITS.flourG[1]);
  checkNum('eggCount', '鸡蛋个数', LIMITS.eggCount[0], LIMITS.eggCount[1]);
  checkNum('eggG', '每个鸡蛋的蛋液（g）', LIMITS.eggG[0], LIMITS.eggG[1]);
  checkNum('roundStep', '称量刻度（g）', LIMITS.roundStep[0], LIMITS.roundStep[1]);
  checkNum('srcHeight', '原模高度（cm）', LIMITS.srcHeight[0], LIMITS.srcHeight[1]);
  checkNum('dstHeight', '目标模高度（cm）', LIMITS.dstHeight[0], LIMITS.dstHeight[1]);

  if (cfg.srcShape === 'round') checkNum('srcDia', '原模直径（cm）', LIMITS.srcDia[0], LIMITS.srcDia[1]);
  else {
    checkNum('srcLen', '原模长（cm）', LIMITS.srcLen[0], LIMITS.srcLen[1]);
    checkNum('srcWid', '原模宽（cm）', LIMITS.srcWid[0], LIMITS.srcWid[1]);
  }
  if (cfg.dstShape === 'round') checkNum('dstDia', '目标模直径（cm）', LIMITS.dstDia[0], LIMITS.dstDia[1]);
  else {
    checkNum('dstLen', '目标模长（cm）', LIMITS.dstLen[0], LIMITS.dstLen[1]);
    checkNum('dstWid', '目标模宽（cm）', LIMITS.dstWid[0], LIMITS.dstWid[1]);
  }

  if (!cfg.rows || !cfg.rows.length) bad('rows', '配方至少要有一行配料（面粉单独填在上面的"面粉基准"里）');
  else {
    for (var i = 0; i < cfg.rows.length; i++) {
      var r = cfg.rows[i];
      if (!isFinite(r.pct)) bad('row' + i, '第 ' + (i + 1) + ' 行「' + r.name + '」的百分比：请填一个数字');
      else if (r.pct < LIMITS.pct[0] || r.pct > LIMITS.pct[1]) bad('row' + i, '第 ' + (i + 1) + ' 行「' + r.name + '」的百分比：' + LIMITS.pct[0] + ' – ' + LIMITS.pct[1] + ' 之间');
    }
  }
  return errs;
}

/* ─── 几何 ───────────────────────────────────────────────────────────── */
function dimsOf(cfg, which) {
  var isSrc = which === 'src';
  var sh = isSrc ? cfg.srcShape : cfg.dstShape;
  var h = isSrc ? cfg.srcHeight : cfg.dstHeight;
  if (sh === 'round') {
    var d = isSrc ? cfg.srcDia : cfg.dstDia;
    return { shape: sh, dia: d, len: NaN, wid: NaN, height: h };
  }
  return {
    shape: sh, dia: NaN,
    len: isSrc ? cfg.srcLen : cfg.dstLen,
    wid: isSrc ? cfg.srcWid : cfg.dstWid,
    height: h
  };
}
function areaOf(d) {
  if (d.shape === 'round') return Math.PI * d.dia * d.dia / 4;
  return d.len * d.wid;
}
function volOf(d) { return areaOf(d) * d.height; }
function labelOf(d) {
  if (d.shape === 'round') return '圆模 φ' + r2(d.dia) + ' × 高 ' + r2(d.height) + ' cm';
  return '方模 ' + r2(d.len) + ' × ' + r2(d.wid) + ' × 高 ' + r2(d.height) + ' cm';
}
/* 与 k 无关的"目标直径/高度"假设下重算 k —— 供对照表使用 */
function kWith(srcD, dstD, patch) {
  var d2 = { shape: dstD.shape, dia: dstD.dia, len: dstD.len, wid: dstD.wid, height: dstD.height };
  if (patch) {
    if (patch.dia !== undefined) d2.dia = patch.dia;
    if (patch.len !== undefined) d2.len = patch.len;
    if (patch.wid !== undefined) d2.wid = patch.wid;
    if (patch.height !== undefined) d2.height = patch.height;
  }
  return volOf(d2) / volOf(srcD);
}

/* ─── 主计算 ─────────────────────────────────────────────────────────── */
function computeCore(cfg) {
  var srcD = dimsOf(cfg, 'src'), dstD = dimsOf(cfg, 'dst');
  var srcArea = areaOf(srcD), dstArea = areaOf(dstD);
  var srcVol = volOf(srcD), dstVol = volOf(dstD);
  var kArea = dstArea / srcArea;
  var kHeight = dstD.height / srcD.height;
  var k = dstVol / srcVol;

  var flourSrc = cfg.flourG;
  var flourDst = flourSrc * k;

  var rows = [], i, r;
  var liquidPctSum = 0;
  for (i = 0; i < cfg.rows.length; i++) {
    r = cfg.rows[i];
    if (r.liquid) liquidPctSum += r.pct;
  }
  for (i = 0; i < cfg.rows.length; i++) {
    r = cfg.rows[i];
    var srcG = r.pct / 100 * flourSrc;
    var dstG = r.pct / 100 * flourDst;
    rows.push({
      name: r.name, pct: r.pct, liquid: !!r.liquid,
      srcG: r6(srcG), dstG: r6(dstG),
      rounded: q(dstG, cfg.roundStep, cfg.roundMode)
    });
  }

  var eggSrcG = cfg.eggCount * cfg.eggG;
  var eggDstG = eggSrcG * k;
  var eggExactCount = r6(eggDstG / cfg.eggG);            // 显示用的"目标个数"（6 位）
  var suggested = cfg.eggCount > 0 ? Math.round(eggExactCount) : 0;   // 就地对显示值取整，两处必然自洽
  var suggestedG = suggested * cfg.eggG;
  var eggDiffG = suggestedG - eggDstG;

  /* 收口①：扣液体（蛋多了就把液体扣掉，蛋少了就补水），液体总量守恒 */
  var closeA = { available: false, reason: '', deducts: [], rows: [] };
  if (cfg.eggCount > 0 && suggested <= 0) {
    closeA.reason = '目标模太小：按整蛋算连一个蛋都用不上（目标蛋液 ' + r2(eggDstG) + ' g，还不到半个蛋 ' + r2(cfg.eggG / 2) + ' g）。建议按打散的蛋液称克数，别硬凑个数。';
  } else if (cfg.eggCount > 0 && liquidPctSum > 0) {
    closeA.available = true;
    var anyNegative = false;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      var deduct = r.liquid ? eggDiffG * (r.pct / liquidPctSum) : 0;
      var after = r.dstG - deduct;
      if (r.liquid && after < 0) anyNegative = true;
      closeA.rows.push({
        name: r.name, pct: r.pct, liquid: !!r.liquid,
        srcG: r.srcG, dstG: r.dstG,
        deduct: r6(deduct), after: r6(after),
        rounded: q(after, cfg.roundStep, cfg.roundMode)
      });
    }
    closeA.eggCount = suggested;
    closeA.eggG = suggestedG;
    closeA.eggDiffG = r6(eggDiffG);
    closeA.flourG = r6(flourDst);
    closeA.flourRounded = q(flourDst, cfg.roundStep, cfg.roundMode);
    closeA.liquidPctSum = r6(liquidPctSum);
    closeA.targetLiquidG = r6(liquidTotal(rows, 'dstG') + eggDstG);
    closeA.actualLiquidG = r6(liquidTotal(closeA.rows, 'after') + suggestedG);
    closeA.negativeWarning = anyNegative;
    closeA.totalExact = r6(sumRows(closeA.rows, 'after') + flourDst + suggestedG);
    closeA.totalRounded = r6(sumRows(closeA.rows, 'rounded') + closeA.flourRounded + suggestedG);
  } else if (cfg.eggCount <= 0) {
    closeA.reason = '这个方子没有鸡蛋，收口①不适用。';
  } else {
    closeA.reason = '没有任何一行被勾成"液体"，收口①无处可扣。把牛奶/水这类行勾上，或者改用收口②。';
  }

  /* 收口②：按整蛋配平（先定整蛋，再反推面粉，全方按新面粉等比） */
  var closeB = { available: false, reason: '', rows: [] };
  if (cfg.eggCount > 0 && suggested <= 0) {
    closeB.reason = '目标模太小：按整蛋算连一个蛋都用不上，按整蛋配平没有意义。';
  } else if (cfg.eggCount > 0 && eggSrcG > 0 && flourSrc > 0) {
    closeB.available = true;
    var flourB = suggestedG / (eggSrcG / flourSrc);
    var kB = flourB / flourSrc;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      var bd = r.pct / 100 * flourB;
      closeB.rows.push({
        name: r.name, pct: r.pct, liquid: !!r.liquid,
        srcG: r.srcG, dstG: r.dstG, bG: r6(bd),
        rounded: q(bd, cfg.roundStep, cfg.roundMode)
      });
    }
    closeB.eggCount = suggested;
    closeB.eggG = suggestedG;
    closeB.flourG = r6(flourB);
    closeB.flourRounded = q(flourB, cfg.roundStep, cfg.roundMode);
    closeB.kActual = r6(kB);
    /* 偏差用全精度算（显示值取 6 位小数，读者回代到第 6 位会有 1e-6 级的差） */
    closeB.kDeviation = r6(kB / k - 1);
    closeB.totalExact = r6(sumRows(closeB.rows, 'bG') + flourB + suggestedG);
    closeB.totalRounded = r6(sumRows(closeB.rows, 'rounded') + closeB.flourRounded + suggestedG);
    /* 配平后的料量相当于目标模放大多少倍线性尺寸（料多了就要更大的模才装得下） */
    var scaleB = Math.sqrt(kB / k);
    closeB.equivScale = r4(scaleB);
    if (dstD.shape === 'round') closeB.equivDiaCm = r2(dstD.dia * scaleB);
    else { closeB.equivLenCm = r2(dstD.len * scaleB); closeB.equivWidCm = r2(dstD.wid * scaleB); }
  } else {
    closeB.reason = cfg.eggCount <= 0 ? '这个方子没有鸡蛋，收口②不适用。'
      : (suggested <= 0 ? closeB.reason : '面粉基准或蛋液为 0，收口②不适用。');
  }

  var srcTotalG = flourSrc + eggSrcG + sumRows(rows, 'srcG');
  var dstTotalG = flourDst + eggDstG + sumRows(rows, 'dstG');
  var dstRowsRoundedG = q(flourDst, cfg.roundStep, cfg.roundMode) + sumRows(rows, 'rounded');

  /* 「按直径比缩」这一步最常见的错：给了多少多余的料 */
  var diaRatio = (srcD.shape === 'round' && dstD.shape === 'round') ? dstD.dia / srcD.dia : null;
  var naive = null;
  if (diaRatio !== null) {
    var diaR = r6(diaRatio), kR = r6(k);
    naive = {
      diaRatio: diaR,                                    // 目标直径 ÷ 原直径
      kByDia: diaR,                                      // 按直径比直接缩（最常见的那一步错）
      kByDiaSq: r6(diaR * diaR),                         // 按面积比缩 = 直径比²（两模等高时才是正确做法）
      k: kR,
      overdoRatio: r6(diaR / kR),                        // 按直径比缩的料量 ÷ 正确料量
      extraPct: r6(diaR / kR - 1),                       // 多放几成
      flourByDiaG: r6(flourSrc * diaR),
      flourExtraG: r6(flourSrc * diaR - r6(flourDst))
    };
  }

  /* 反推：想用 N 个整蛋，面粉该多少、等价于多大模具 */
  var reverse = { egg: null, shape: null, roundSizes: [] };
  if (cfg.eggCount > 0 && eggSrcG > 0) {
    var ratios = [];
    var maxN = Math.max(1, Math.min(24, Math.ceil(cfg.eggCount * k) + 3));
    for (var n = 0; n <= maxN; n++) {
      var fN = n * cfg.eggG / (eggSrcG / flourSrc);
      ratios.push({ eggs: n, flourG: r4(fN), k: r6(fN / flourSrc), usable: n > 0 });
    }
    reverse.egg = { ratios: ratios, perEggFlourG: r6(cfg.eggG / (eggSrcG / flourSrc)) };
  }
  var sq = null, rd = null;
  if (dstD.shape === 'round') {
    sq = Math.sqrt(dstArea);
    reverse.shape = { from: 'round', to: 'rect', sideCm: r4(sq), areaCm2: r4(dstArea), volumeCm3: r4(dstVol), diaCm: r4(dstD.dia) };
  } else {
    rd = Math.sqrt(4 * dstArea / Math.PI);
    reverse.shape = { from: 'rect', to: 'round', diaCm: r4(rd), areaCm2: r4(dstArea), volumeCm3: r4(dstVol), sideCm: null };
  }
  for (i = 0; i < INCH_TABLE.length; i++) {
    var inch = INCH_TABLE[i], diaCm = inch * CM_PER_INCH;
    reverse.roundSizes.push({
      inch: inch, diaCm: r2(diaCm),
      areaCm2: r4(Math.PI * diaCm * diaCm / 4),
      equivSideCm: r4(diaCm * Math.sqrt(Math.PI) / 2),
      kVsSrc: r6((Math.PI * diaCm * diaCm / 4) / srcArea)
    });
  }

  var out = {
    label: cfg.label,
    closeChoice: cfg.closeChoice,
    k: r6(k), kArea: r6(kArea), kHeight: r6(kHeight),
    src: { shape: srcD.shape, label: labelOf(srcD), areaCm2: r4(srcArea), volumeCm3: r4(srcVol), heightCm: r2(srcD.height), diaCm: isFinite(srcD.dia) ? r2(srcD.dia) : null, lenCm: isFinite(srcD.len) ? r2(srcD.len) : null, widCm: isFinite(srcD.wid) ? r2(srcD.wid) : null },
    dst: { shape: dstD.shape, label: labelOf(dstD), areaCm2: r4(dstArea), volumeCm3: r4(dstVol), heightCm: r2(dstD.height), diaCm: isFinite(dstD.dia) ? r2(dstD.dia) : null, lenCm: isFinite(dstD.len) ? r2(dstD.len) : null, widCm: isFinite(dstD.wid) ? r2(dstD.wid) : null },
    sameHeight: r2(srcD.height) === r2(dstD.height),
    flour: { srcG: r6(flourSrc), dstG: r6(flourDst), rounded: q(flourDst, cfg.roundStep, cfg.roundMode) },
    rows: rows,
    liquidPctSum: r6(liquidPctSum),
    egg: {
      srcCount: cfg.eggCount, gPerEgg: cfg.eggG,
      srcG: r6(eggSrcG), dstG: r6(eggDstG), exactCount: eggExactCount,
      suggestedCount: suggested, floorCount: Math.floor(eggExactCount), ceilCount: Math.ceil(eggExactCount),
      suggestedG: r6(suggestedG), diffG: r6(eggDiffG)
    },
    closeA: closeA,
    closeB: closeB,
    totals: {
      srcG: r6(srcTotalG), dstG: r6(dstTotalG),
      dstRowsRoundedG: r6(dstRowsRoundedG),
      roundStepG: cfg.roundStep, roundMode: cfg.roundMode
    },
    naive: naive,
    reverse: reverse,
    tables: {}
  };

  /* 对照表 1：目标尺寸 ±20%（5 档） */
  var diaTable = [];
  for (i = 0; i < DIA_FACTORS.length; i++) {
    var f = DIA_FACTORS[i];
    var shownDia = null, patch1 = null;
    if (f !== 1) {   /* ×1.00 那一行必须与主结论逐位相同，所以不覆盖尺寸 */
      if (dstD.shape === 'round') { shownDia = r4(dstD.dia * f); patch1 = { dia: shownDia }; }
      else patch1 = { len: r4(dstD.len * f), wid: r4(dstD.wid * f) };
    } else if (dstD.shape === 'round') shownDia = r4(dstD.dia);
    /* 用显示出来的那个尺寸去算，不然后面几行读者按页面上的数字回代会对不上；
       ×1.00 那一行不覆盖尺寸（走全精度），保证它与主结论逐位相同 */
    diaTable.push(rowAt(cfg, kWith(srcD, dstD, patch1), f, shownDia, null, f === 1));
  }
  out.tables.dia = diaTable;

  /* 对照表 2：目标高度（4/5/6/7/8 cm） */
  var hTable = [];
  for (i = 0; i < HEIGHT_TABLE.length; i++) {
    var h = HEIGHT_TABLE[i];
    hTable.push(rowAt(cfg, kWith(srcD, dstD, { height: h }), h / dstD.height, null, h, h === dstD.height));
  }
  out.tables.height = hTable;

  /* 对照表 3：圆 ↔ 方 等容积 */
  var shapeTable = [];
  if (srcD.shape === 'round') {
    var dCm = srcD.dia;
    shapeTable.push({ what: '原模（圆）', sizeCm: r2(dCm), areaCm2: r4(areaOf(srcD)), equivSideCm: r4(Math.sqrt(areaOf(srcD))) });
    var t2 = dstD.shape === 'round' ? dstD.dia : null;
    if (t2 !== null) shapeTable.push({ what: '目标模（圆）', sizeCm: r2(t2), areaCm2: r4(areaOf(dstD)), equivSideCm: r4(Math.sqrt(areaOf(dstD))) });
    else shapeTable.push({ what: '目标模（方）', sizeCm: r2(dstD.len) + ' × ' + r2(dstD.wid), areaCm2: r4(areaOf(dstD)), equivSideCm: r4(Math.sqrt(areaOf(dstD))) });
  } else {
    shapeTable.push({ what: '原模（方）', sizeCm: r2(srcD.len) + ' × ' + r2(srcD.wid), areaCm2: r4(areaOf(srcD)), equivDiaCm: r4(Math.sqrt(4 * areaOf(srcD) / Math.PI)) });
    shapeTable.push({ what: '目标模', sizeCm: dstD.shape === 'round' ? r2(dstD.dia) : (r2(dstD.len) + ' × ' + r2(dstD.wid)), areaCm2: r4(areaOf(dstD)), equivDiaCm: r4(Math.sqrt(4 * areaOf(dstD) / Math.PI)) });
  }
  out.tables.shape = shapeTable;

  return out;
}

function rowAt(cfg, kkRaw, factor, diaCm, heightCm, exactK) {
  var kk = r6(kkRaw);                       // 页面上显示的那个 k
  var kUse = exactK ? kkRaw : kk;           // 默认就用显示值往下算，逐行可回代
  var flourDst = cfg.flourG * kUse;
  var eggDstG = cfg.eggCount * cfg.eggG * kUse;
  var row = {
    factor: r4(factor),
    diaCm: diaCm === null || diaCm === undefined ? null : r4(diaCm),
    heightCm: heightCm === undefined || heightCm === null ? null : r4(heightCm),
    k: kk,
    flourG: r6(flourDst),
    flourRounded: q(flourDst, cfg.roundStep, cfg.roundMode),
    firstRowG: cfg.rows.length ? r6(cfg.rows[0].pct / 100 * flourDst) : 0,
    firstRowName: cfg.rows.length ? cfg.rows[0].name : '',
    liquidG: r6(liquidTotalPre(cfg, flourDst) + eggDstG),
    eggDstG: r6(eggDstG),
    eggCount: cfg.eggCount > 0 ? Math.round(eggDstG / cfg.eggG) : 0,
    eggExact: r6(eggDstG / cfg.eggG),
    totalG: r6(flourDst + eggDstG + sumPct(cfg) / 100 * flourDst)
  };
  return row;
}
function sumPct(cfg) {
  var s = 0;
  for (var i = 0; i < cfg.rows.length; i++) s += cfg.rows[i].pct;
  return s;
}
function liquidTotalPre(cfg, flourDst) {
  var s = 0;
  for (var i = 0; i < cfg.rows.length; i++) if (cfg.rows[i].liquid) s += cfg.rows[i].pct / 100 * flourDst;
  return s;
}
function sumRows(rows, key) {
  var s = 0;
  for (var i = 0; i < rows.length; i++) { var v = rows[i][key]; if (isFinite(v)) s += v; }
  return s;
}
function liquidTotal(rows, key) {
  var s = 0;
  for (var i = 0; i < rows.length; i++) if (rows[i].liquid) { var v = rows[i][key]; if (isFinite(v)) s += v; }
  return s;
}

/* ─── 敏感性（与主输出同一次口径，逐行独立重算） ───────────────────── */
function sensitivity(cfg) {
  var out = computeCore(cfg), rows = [];
  for (var i = 0; i < out.tables.dia.length; i++) {
    var t = out.tables.dia[i];
    rows.push({
      label: (t.diaCm !== null ? 'φ' + t.diaCm + ' cm' : '尺寸 ×' + t.factor),
      k: t.k, flourG: t.flourG, firstRowG: t.firstRowG, eggCount: t.eggCount, totalG: t.totalG
    });
  }
  return rows;
}

/* ─── 自检（页面上逐条显示，任一不过就是那一条的问题，不整页挂） ────── */
function selfChecks(cfg, out) {
  var ck = [], i;
  out = out || computeCore(cfg);
  function ok(label, pass, detail) { ck.push({ label: label, pass: !!pass, detail: detail === undefined ? '' : String(detail) }); }

  /* 全部用**未舍入**的原始尺寸重算一遍，再各自 r6 后比较。
     两个 r6 值之间最多差一个量子（1e-6），所以容差按显示位数定，而不是按相对 1e-9 —— 
     拿全精度值去比 r6 输出会得到假失败（本轮实测踩到过）。 */
  var T6 = 2e-6, T4 = 2e-4, T2 = 2e-2;
  var T6n = T6 * (cfg.rows.length + 2);
  var rsrc = dimsOf(cfg, 'src'), rdst = dimsOf(cfg, 'dst');
  var srcA = areaOf(rsrc), dstA = areaOf(rdst);
  var srcV = srcA * rsrc.height, dstV = dstA * rdst.height;
  var kFull = dstV / srcV;                                   // 全精度 k
  var flourSrc = cfg.flourG;
  var eggSrcG = cfg.eggCount * cfg.eggG;
  var pctSum = sumPct(cfg);
  var totalSrcFull = flourSrc + eggSrcG + pctSum / 100 * flourSrc;
  var liquidPct = 0;
  for (i = 0; i < cfg.rows.length; i++) if (cfg.rows[i].liquid) liquidPct += cfg.rows[i].pct;

  /* 1–5 几何与 k */
  var srcAHand = rsrc.shape === 'round' ? Math.PI * rsrc.dia * rsrc.dia / 4 : rsrc.len * rsrc.wid;
  var dstAHand = rdst.shape === 'round' ? Math.PI * rdst.dia * rdst.dia / 4 : rdst.len * rdst.wid;
  ok('原模面积重算一致（圆 πD²/4，方 长 × 宽）',
    Math.abs(r4(srcAHand) - out.src.areaCm2) <= T4,
    r4(srcAHand) + ' cm²（显示 ' + out.src.areaCm2 + '）');
  ok('目标模面积重算一致',
    Math.abs(r4(dstAHand) - out.dst.areaCm2) <= T4,
    r4(dstAHand) + ' cm²（显示 ' + out.dst.areaCm2 + '）');
  ok('k = 面积比 × 高度比',
    Math.abs(r6((dstA / srcA) * (rdst.height / rsrc.height)) - out.k) <= T6,
    r6((dstA / srcA) * (rdst.height / rsrc.height)) + ' vs ' + out.k);
  ok('k = 目标体积 ÷ 原体积（体积都用面积 × 高重算）',
    Math.abs(r6(dstV / srcV) - out.k) <= T6,
    r6(dstV / srcV) + ' vs ' + out.k);
  ok('两模等高时 k 就等于面积比',
    !out.sameHeight || Math.abs(out.k - out.kArea) <= T6,
    out.sameHeight ? (out.k + ' = ' + out.kArea) : '两模高度不同 → 这一条不适用（必须用容积比）');

  /* 6–9 配方行 */
  ok('面粉′ = 面粉 × k', Math.abs(r6(flourSrc * kFull) - out.flour.dstG) <= T6,
    r6(flourSrc * kFull) + ' vs ' + out.flour.dstG);
  ok('每一行 = 百分比 × 面粉′（逐行重算）',
    out.rows.every(function (x) { return Math.abs(r6(x.pct / 100 * flourSrc * kFull) - x.dstG) <= T6; }),
    out.rows.length + ' 行');
  ok('新方总料重 = 原方总料重 × k（精确口径）',
    Math.abs(r6(totalSrcFull * kFull) - out.totals.dstG) <= T6,
    r6(totalSrcFull * kFull) + ' vs ' + out.totals.dstG);
  ok('缩放不动"相对比例"：每行占面粉的百分比在新方里不变',
    out.rows.every(function (x) { return Math.abs(x.dstG / out.flour.dstG * 100 - x.pct) <= 1e-3; }),
    out.rows.length + ' 行');
  ok('液体行百分比之和与输出一致',
    Math.abs(r6(liquidPct) - out.liquidPctSum) <= T6,
    r6(liquidPct) + ' vs ' + out.liquidPctSum);

  /* 9–12 鸡蛋 */
  ok('蛋液目标 = 蛋数 × 每蛋克数 × k',
    Math.abs(r6(eggSrcG * kFull) - out.egg.dstG) <= T6,
    r6(eggSrcG * kFull) + ' vs ' + out.egg.dstG);
  ok('目标个数 = 蛋液目标 ÷ 每蛋克数',
    Math.abs(r6(out.egg.dstG / cfg.eggG) - out.egg.exactCount) <= T6,
    r6(out.egg.dstG / cfg.eggG) + ' vs ' + out.egg.exactCount);
  ok('建议蛋数就是对目标个数取整，且离目标不超过半个蛋',
    (cfg.eggCount <= 0 || out.egg.suggestedCount === Math.round(out.egg.exactCount)) &&
    (cfg.eggCount <= 0 || Math.abs(out.egg.diffG) <= cfg.eggG / 2 + T6),
    '建议 ' + out.egg.suggestedCount + ' 个，差 ' + out.egg.diffG + ' g（半个蛋 ' + r2(cfg.eggG / 2) + ' g）');
  ok('蛋数下界 ≤ 目标 ≤ 上界（floor ≤ 目标 ≤ ceil）',
    cfg.eggCount <= 0 || (out.egg.floorCount <= out.egg.exactCount + 1e-9 && out.egg.exactCount <= out.egg.ceilCount + 1e-9),
    out.egg.floorCount + ' ≤ ' + out.egg.exactCount + ' ≤ ' + out.egg.ceilCount);

  /* 13–16 收口①（扣液体）：守恒 */
  if (out.closeA.available) {
    var deductSum = 0, liquidAfter = 0, liquidTargetOut = 0, minLiquid = Infinity;
    for (i = 0; i < out.closeA.rows.length; i++) {
      deductSum += out.closeA.rows[i].deduct;
      if (out.closeA.rows[i].liquid) {
        liquidAfter += out.closeA.rows[i].after;
        liquidTargetOut += out.closeA.rows[i].dstG;
        minLiquid = Math.min(minLiquid, out.closeA.rows[i].after);
      }
    }
    ok('收口①：各行扣减之和 = 蛋液差额（守恒）',
      Math.abs(deductSum - (out.egg.suggestedG - r6(eggSrcG * kFull))) <= T6n,
      r6(deductSum) + ' vs ' + r6(out.egg.suggestedG - eggSrcG * kFull));
    ok('收口①：只有勾成"液体"的行被扣，非液体行的精确值一动不动',
      out.closeA.rows.every(function (x) { return x.liquid || Math.abs(x.after - x.dstG) <= 1e-9; }),
      out.closeA.rows.filter(function (x) { return x.liquid; }).length + ' 行参与了扣减');
    ok('收口①：改完的总液体（液体行 + 蛋液）= 目标总液体（守恒）',
      Math.abs(r6(liquidAfter + out.egg.suggestedG) - r6(liquidPct / 100 * flourSrc * kFull + eggSrcG * kFull)) <= T6n,
      r6(liquidAfter + out.egg.suggestedG) + ' vs ' + r6(liquidPct / 100 * flourSrc * kFull + eggSrcG * kFull));
    ok('收口①：输出里的"总液体"两个数与逐行相加一致（不是另算一套）',
      Math.abs(out.closeA.actualLiquidG - r6(liquidAfter + out.egg.suggestedG)) <= T6n &&
      Math.abs(out.closeA.targetLiquidG - r6(liquidTargetOut + r6(eggSrcG * kFull))) <= T6n,
      out.closeA.actualLiquidG + ' / ' + out.closeA.targetLiquidG);
    ok('收口①：扣完之后液体行都不是负数（负数会单独标出来）',
      (minLiquid < 0) === !!out.closeA.negativeWarning,
      out.closeA.negativeWarning ? '有液体行被扣成负数（最小 ' + r4(minLiquid) + ' g）→ 这个方子不适合"扣液体"收口' : '最小液体行 ' + r4(minLiquid) + ' g');
  } else {
    ok('收口①：不适用（' + out.closeA.reason + '）', true, '跳过');
    ok('收口①：不适用，跳过守恒检查', true, '跳过');
    ok('收口①：不适用，跳过非液体行检查', true, '跳过');
    ok('收口①：不适用，跳过负数检查', true, '跳过');
  }

  /* 17–20 收口②（按整蛋配平） */
  if (out.closeB.available) {
    var flourBHand = (out.egg.suggestedCount * cfg.eggG) / (eggSrcG / flourSrc);
    ok('收口②：面粉″ = 整蛋蛋液 ÷ 原蛋液占面粉比',
      Math.abs(r6(flourBHand) - out.closeB.flourG) <= T6,
      r6(flourBHand) + ' vs ' + out.closeB.flourG);
    ok('收口②：k″ = 面粉″ ÷ 面粉',
      Math.abs(r6(out.closeB.flourG / flourSrc) - out.closeB.kActual) <= T6,
      r6(out.closeB.flourG / flourSrc) + ' vs ' + out.closeB.kActual);
    ok('收口②：偏差 = k″ ÷ k − 1（正负都要如实报；用全精度重算，与显示值回代相差不超过最后一位）',
      Math.abs(r6((flourBHand / flourSrc) / kFull - 1) - out.closeB.kDeviation) <= T6,
      r6((flourBHand / flourSrc) / kFull - 1) + ' vs ' + out.closeB.kDeviation);
    ok('收口②：全方按面粉″等比（每行 = 百分比 × 面粉″）',
      out.closeB.rows.every(function (x) { return Math.abs(r6(x.pct / 100 * out.closeB.flourG) - x.bG) <= T6; }),
      out.closeB.rows.length + ' 行');
  } else {
    ok('收口②：不适用（' + out.closeB.reason + '）', true, '跳过');
    ok('收口②：不适用，跳过 k″ 检查', true, '跳过');
    ok('收口②：不适用，跳过偏差检查', true, '跳过');
    ok('收口②：不适用，跳过等比检查', true, '跳过');
  }

  /* 21–23 舍入 */
  var step = cfg.roundStep;
  ok('舍入：每个取整值都在精确值的 ±1 个刻度内',
    out.rows.every(function (x) { return Math.abs(x.rounded - x.dstG) <= step + T6; }) &&
    Math.abs(out.flour.rounded - out.flour.dstG) <= step + T6,
    '刻度 ' + step + ' g（' + (cfg.roundMode === 'up' ? '一律向上' : '四舍五入') + '）');
  ok('舍入：取整值都是刻度的整数倍',
    out.rows.every(function (x) { return Math.abs(x.rounded / step - Math.round(x.rounded / step)) < 1e-6; }) &&
    Math.abs(out.flour.rounded / step - Math.round(out.flour.rounded / step)) < 1e-6,
    '刻度 ' + step + ' g');
  ok('舍入：' + (cfg.roundMode === 'up' ? '一律向上时取整值不小于精确值' : '四舍五入时取整值离精确值最近（半格向上）'),
    cfg.roundMode === 'up'
      ? (out.rows.every(function (x) { return x.rounded >= x.dstG - T6; }) && out.flour.rounded >= out.flour.dstG - T6)
      : out.rows.every(function (x) { return Math.abs(x.rounded - x.dstG) <= Math.abs(x.rounded - step - x.dstG) + 1e-9; }),
    '口径 ' + cfg.roundMode);

  /* 24–27 单调性与几何反推 */
  var dstPatchBig = rdst.shape === 'round' ? { dia: rdst.dia * 1.2 } : { len: rdst.len * 1.2, wid: rdst.wid * 1.2 };
  ok('目标模变大 → k 变大（单调）', kWith(rsrc, rdst, dstPatchBig) > kFull,
    r6(kWith(rsrc, rdst, dstPatchBig)) + ' > ' + out.k);
  ok('目标模变高 → k 变大（单调）', kWith(rsrc, rdst, { height: rdst.height * 1.5 }) > kFull,
    r6(kWith(rsrc, rdst, { height: rdst.height * 1.5 })) + ' > ' + out.k);
  if (out.reverse.shape && out.reverse.shape.from === 'round') {
    var side = out.reverse.shape.sideCm;
    ok('圆 → 等面积方模：边长 = √(πD²/4)（回代，与显示面积对得上）',
      Math.abs(side - Math.sqrt(out.dst.areaCm2)) <= T4,
      side + ' vs √' + out.dst.areaCm2 + ' = ' + r4(Math.sqrt(out.dst.areaCm2)));
  } else if (out.reverse.shape) {
    var dia = out.reverse.shape.diaCm;
    ok('方 → 等面积圆模：直径 = √(4 × 长 × 宽 / π)（回代）',
      Math.abs(dia - Math.sqrt(4 * out.dst.areaCm2 / Math.PI)) <= T4,
      dia + ' vs ' + r4(Math.sqrt(4 * out.dst.areaCm2 / Math.PI)));
  } else {
    ok('圆 ↔ 方 等价换算：不适用', true, '跳过');
  }
  if (out.naive) {
    ok('「按直径比缩」多放的料 = 直径比 ÷ k − 1（重算一致）',
      Math.abs(r6(out.naive.diaRatio / out.k - 1) - out.naive.extraPct) <= T6,
      r6(out.naive.diaRatio / out.k - 1) + ' vs ' + out.naive.extraPct);
    if (out.sameHeight) {
      ok('两模等高时：按面积比缩 = 直径比²（两条路必须给出同一个 k）',
        Math.abs(out.naive.kByDiaSq - out.k) <= T6,
        out.naive.kByDiaSq + ' vs ' + out.k);
    } else {
      ok('两模不等高：直径比² 不等于 k（k 里还有高度比），这一条按"不适用"处理',
        Math.abs(out.naive.kByDiaSq - out.k) > T6,
        '直径比² ' + out.naive.kByDiaSq + ' ≠ k ' + out.k + '（高度比 ' + out.kHeight + '）');
    }
  } else {
    ok('「按直径比缩」对照：只在圆模对圆模时适用（本轮不适用）', true, '跳过');
    ok('按面积比缩 = 直径比²：不适用', true, '跳过');
  }

  /* 28–30 对照表自洽 */
  var t100 = out.tables.dia.filter(function (x) { return x.factor === 1; })[0];
  ok('对照表里"×1.00"那一行与主结论逐位一致',
    !!t100 && Math.abs(t100.k - out.k) <= T6 && Math.abs(t100.flourG - out.flour.dstG) <= T6,
    t100 ? (t100.k + ' / ' + t100.flourG + ' g') : '缺行');
  var mono = true;
  for (i = 1; i < out.tables.dia.length; i++) if (out.tables.dia[i].k < out.tables.dia[i - 1].k - 1e-12) mono = false;
  ok('对照表：目标尺寸往大走 k 不减小（单调）', mono, out.tables.dia.map(function (x) { return x.k; }).join(' → '));
  var hMono = true;
  for (i = 1; i < out.tables.height.length; i++) if (out.tables.height[i].k < out.tables.height[i - 1].k - 1e-12) hMono = false;
  ok('高度对照表：高度往上走 k 不减小（单调）', hMono, out.tables.height.map(function (x) { return x.k; }).join(' → '));

  /* 31 数值契约 */
  var bad = [];
  (function walk(v, path) {
    if (v === null || v === undefined) return;
    if (typeof v === 'number') { if (!isFinite(v)) bad.push(path); return; }
    if (typeof v !== 'object') return;
    if (Array.isArray(v)) { for (var j = 0; j < v.length; j++) walk(v[j], path + '[' + j + ']'); return; }
    for (var kk in v) if (Object.prototype.hasOwnProperty.call(v, kk)) walk(v[kk], path + '.' + kk);
  })(out, 'out');
  ok('输出里没有任何 NaN / Infinity', bad.length === 0, bad.length ? ('异常字段：' + bad.slice(0, 5).join('、')) : '递归查过全部字段');

  return ck;
}

function compute(cfg, opts) {
  var out = computeCore(cfg);
  out.selfChecks = selfChecks(cfg, out);
  out.passCount = out.selfChecks.filter(function (x) { return x.pass; }).length;
  out.totalCount = out.selfChecks.length;
  return out;
}

/* ─── 导出内容（与页面同一次输出，不重算） ─────────────────────────── */
function toCSV(cfg, out) {
  out = out || compute(cfg);
  var L = [];
  L.push('改方子 · 配方按模具换算,' + csvCell(out.label));
  L.push('导出时间,' + new Date().toISOString());
  L.push('');
  L.push('原模,' + csvCell(out.src.label) + ',面积 cm2,' + out.src.areaCm2 + ',体积 cm3,' + out.src.volumeCm3);
  L.push('目标模,' + csvCell(out.dst.label) + ',面积 cm2,' + out.dst.areaCm2 + ',体积 cm3,' + out.dst.volumeCm3);
  L.push('料量比 k,' + out.k + ',面积比,' + out.kArea + ',高度比,' + out.kHeight + ',两模等高,' + (out.sameHeight ? '是' : '否'));
  L.push('已采用的收口,' + csvCell(closeChoice(out.closeChoice).label));
  L.push('');
  L.push('配料,烘焙百分比 %,原方 g,新方精确 g,新方按刻度 g,是液体');
  L.push('面粉（基准）,' + 100 + ',' + out.flour.srcG + ',' + out.flour.dstG + ',' + out.flour.rounded + ',否');
  for (var i = 0; i < out.rows.length; i++) {
    var r = out.rows[i];
    L.push(csvCell(r.name) + ',' + r.pct + ',' + r.srcG + ',' + r.dstG + ',' + r.rounded + ',' + (r.liquid ? '是' : '否'));
  }
  L.push(csvCell('鸡蛋') + ',,,,' + out.egg.suggestedCount + ' 个 = ' + out.egg.suggestedG + ' g,是');
  L.push('');
  L.push('鸡蛋,原方 ' + out.egg.srcCount + ' 个 = ' + out.egg.srcG + ' g,目标蛋液 ' + out.egg.dstG + ' g,目标个数 ' + out.egg.exactCount + ',建议 ' + out.egg.suggestedCount + ' 个,差额 ' + out.egg.diffG + ' g');
  L.push('');
  if (out.closeA.available) {
    L.push('收口① 扣液体（总液体守恒）');
    L.push('配料,新方精确 g,扣减 g,扣完 g,按刻度 g');
    L.push('面粉（基准）,' + out.closeA.flourG + ',0,' + out.closeA.flourG + ',' + out.closeA.flourRounded);
    for (i = 0; i < out.closeA.rows.length; i++) {
      var a = out.closeA.rows[i];
      L.push(csvCell(a.name) + ',' + a.dstG + ',' + a.deduct + ',' + a.after + ',' + a.rounded);
    }
  } else {
    L.push('收口① 不适用,' + csvCell(out.closeA.reason));
  }
  L.push('');
  if (out.closeB.available) {
    L.push('收口② 按整蛋配平（比例全对）');
    L.push('面粉″, ' + out.closeB.flourG + ' g,k″, ' + out.closeB.kActual + ',与目标 k 的偏差,' + (out.closeB.kDeviation * 100).toFixed(4) + '%');
    L.push('配料,新方精确 g,配平后 g,按刻度 g');
    L.push('面粉（基准）,' + out.flour.dstG + ',' + out.closeB.flourG + ',' + out.closeB.flourRounded);
    for (i = 0; i < out.closeB.rows.length; i++) {
      var b = out.closeB.rows[i];
      L.push(csvCell(b.name) + ',' + b.dstG + ',' + b.bG + ',' + b.rounded);
    }
  } else {
    L.push('收口② 不适用,' + csvCell(out.closeB.reason));
  }
  L.push('');
  L.push('目标尺寸对照（±20%）');
  L.push('目标尺寸 cm,系数,k,面粉 g,首行 g,建议蛋数,总料 g');
  for (i = 0; i < out.tables.dia.length; i++) {
    var t = out.tables.dia[i];
    L.push((t.diaCm === null ? '-' : t.diaCm) + ',' + t.factor + ',' + t.k + ',' + t.flourG + ',' + t.firstRowG + ',' + t.eggCount + ',' + t.totalG);
  }
  L.push('');
  L.push('目标高度对照');
  L.push('目标高度 cm,k,面粉 g,总料 g');
  for (i = 0; i < out.tables.height.length; i++) {
    var h = out.tables.height[i];
    L.push(h.heightCm + ',' + h.k + ',' + h.flourG + ',' + h.totalG);
  }
  L.push('');
  L.push('自检');
  L.push('序号,项目,结果,明细');
  for (i = 0; i < out.selfChecks.length; i++) {
    L.push((i + 1) + ',' + csvCell(out.selfChecks[i].label) + ',' + (out.selfChecks[i].pass ? '通过' : '未通过') + ',' + csvCell(out.selfChecks[i].detail));
  }
  return '\ufeff' + L.join('\n') + '\n';
}
function csvCell(s) {
  s = String(s === null || s === undefined ? '' : s);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toMD(cfg, out) {
  out = out || compute(cfg);
  var L = [], i;
  L.push('# 改方子 · ' + out.label);
  L.push('');
  L.push('- 原模：' + out.src.label + '（面积 ' + out.src.areaCm2 + ' cm²、体积 ' + out.src.volumeCm3 + ' cm³）');
  L.push('- 目标模：' + out.dst.label + '（面积 ' + out.dst.areaCm2 + ' cm²、体积 ' + out.dst.volumeCm3 + ' cm³）');
  L.push('- **料量比 k = ' + out.k + '**（面积比 ' + out.kArea + ' × 高度比 ' + out.kHeight + '，两模' + (out.sameHeight ? '等高' : '不等高 → 必须用体积比'));
  L.push('- 新方总料重（精确）' + out.totals.dstG + ' g（原方 ' + out.totals.srcG + ' g）');
  L.push('- 鸡蛋的收口：' + closeChoice(out.closeChoice).label);
  L.push('');
  L.push('## 新方（照着称）');
  L.push('');
  L.push('| 配料 | 烘焙百分比 | 原方 g | 新方精确 g | 新方按刻度 g |');
  L.push('|---|---|---|---|---|');
  L.push('| 面粉（基准） | 100% | ' + out.flour.srcG + ' | ' + out.flour.dstG + ' | **' + out.flour.rounded + '** |');
  for (i = 0; i < out.rows.length; i++) {
    var r = out.rows[i];
    L.push('| ' + r.name + (r.liquid ? '（液体）' : '') + ' | ' + r.pct + '% | ' + r.srcG + ' | ' + r.dstG + ' | **' + r.rounded + '** |');
  }
  L.push('| 鸡蛋 | — | ' + out.egg.srcCount + ' 个 = ' + out.egg.srcG + ' g | 目标 ' + out.egg.dstG + ' g（' + out.egg.exactCount + ' 个） | **' + out.egg.suggestedCount + ' 个 = ' + out.egg.suggestedG + ' g** |');
  L.push('');
  if (out.closeA.available) {
    L.push('## 收口① 扣液体（总液体守恒，差额 ' + out.closeA.eggDiffG + ' g）');
    L.push('');
    L.push('| 配料 | 新方精确 g | 扣减 g | 扣完 g | 按刻度 g |');
    L.push('|---|---|---|---|---|');
    L.push('| 面粉（基准） | ' + out.closeA.flourG + ' | 0 | ' + out.closeA.flourG + ' | **' + out.closeA.flourRounded + '** |');
    for (i = 0; i < out.closeA.rows.length; i++) {
      var a = out.closeA.rows[i];
      L.push('| ' + a.name + (a.liquid ? '（液体）' : '') + ' | ' + a.dstG + ' | ' + a.deduct + ' | ' + a.after + ' | **' + a.rounded + '** |');
    }
    L.push('');
    L.push('总液体：目标 ' + out.closeA.targetLiquidG + ' g = 实际 ' + out.closeA.actualLiquidG + ' g');
  } else {
    L.push('## 收口① 不适用');
    L.push('');
    L.push(out.closeA.reason);
  }
  L.push('');
  if (out.closeB.available) {
    L.push('## 收口② 按整蛋配平（' + out.closeB.eggCount + ' 个蛋 → 面粉″ ' + out.closeB.flourG + ' g）');
    L.push('');
    L.push('- k″ = ' + out.closeB.kActual + '，与目标 k 相差 **' + (out.closeB.kDeviation * 100).toFixed(2) + '%**');
    L.push('');
    L.push('| 配料 | 配平后 g | 按刻度 g |');
    L.push('|---|---|---|');
    L.push('| 面粉（基准） | ' + out.closeB.flourG + ' | **' + out.closeB.flourRounded + '** |');
    for (i = 0; i < out.closeB.rows.length; i++) {
      var b = out.closeB.rows[i];
      L.push('| ' + b.name + ' | ' + b.bG + ' | **' + b.rounded + '** |');
    }
  } else {
    L.push('## 收口② 不适用');
    L.push('');
    L.push(out.closeB.reason);
  }
  L.push('');
  if (out.naive) {
    L.push('## 如果按直径比缩会怎样');
    L.push('');
    L.push('- 直径比 ' + out.naive.diaRatio + '，直径比² = ' + out.naive.kByDia + '；真正的 k = ' + out.naive.k);
    L.push('- 按直径比缩会多放 **' + (out.naive.extraPct * 100).toFixed(2) + '%** 的料（面粉 ' + out.naive.flourByDiaG + ' g vs 正确的 ' + out.flour.dstG + ' g，多 ' + out.naive.flourExtraG + ' g）');
  }
  L.push('');
  L.push('## 对照表：目标尺寸 ±20%');
  L.push('');
  L.push('| 目标直径 cm | 系数 | k | 面粉 g | ' + out.tables.dia[0].firstRowName + ' g | 建议蛋数 | 总料 g |');
  L.push('|---|---|---|---|---|---|---|');
  for (i = 0; i < out.tables.dia.length; i++) {
    var t = out.tables.dia[i];
    L.push('| ' + (t.diaCm === null ? '—' : t.diaCm) + ' | ×' + t.factor + ' | ' + t.k + ' | ' + t.flourG + ' | ' + t.firstRowG + ' | ' + t.eggCount + ' | ' + t.totalG + ' |');
  }
  L.push('');
  L.push('## 对照表：目标高度');
  L.push('');
  L.push('| 目标高度 cm | k | 面粉 g | 总料 g |');
  L.push('|---|---|---|---|');
  for (i = 0; i < out.tables.height.length; i++) {
    var h = out.tables.height[i];
    L.push('| ' + h.heightCm + ' | ' + h.k + ' | ' + h.flourG + ' | ' + h.totalG + ' |');
  }
  L.push('');
  L.push('## 自检 ' + out.passCount + '/' + out.totalCount);
  L.push('');
  for (i = 0; i < out.selfChecks.length; i++) {
    L.push('- ' + (out.selfChecks[i].pass ? '✅' : '❌') + ' ' + out.selfChecks[i].label + '（' + out.selfChecks[i].detail + '）');
  }
  L.push('');
  L.push('> 本页不给烘烤温度与时间建议；不换算杯/毫升；异形模请自行按装水量折算等价直径。默认值是虚构示例。');
  return L.join('\n') + '\n';
}

function toJSON(cfg, out) {
  return JSON.stringify({
    app: 'recipe-resize', version: 1, exportedAt: new Date().toISOString(),
    cfg: {
      label: cfg.label, srcShape: cfg.srcShape, srcDia: cfg.srcDia, srcLen: cfg.srcLen, srcWid: cfg.srcWid, srcHeight: cfg.srcHeight,
      dstShape: cfg.dstShape, dstDia: cfg.dstDia, dstLen: cfg.dstLen, dstWid: cfg.dstWid, dstHeight: cfg.dstHeight,
      flourG: cfg.flourG, eggCount: cfg.eggCount, eggG: cfg.eggG, rows: cfg.rows, roundStep: cfg.roundStep, roundMode: cfg.roundMode,
      closeChoice: cfg.closeChoice
    },
    out: out || compute(cfg)
  }, null, 2);
}

var AppCore = {
  DEFAULTS: DEFAULTS, LIMITS: LIMITS, SHAPES: SHAPES, ROUND_MODES: ROUND_MODES, CLOSE_CHOICES: CLOSE_CHOICES,
  MAX_ROWS: MAX_ROWS, CM_PER_INCH: CM_PER_INCH,
  normCfg: normCfg, validate: validate, compute: compute, computeCore: computeCore,
  selfChecks: selfChecks, sensitivity: sensitivity,
  dimsOf: dimsOf, areaOf: areaOf, volOf: volOf, kWith: kWith,
  toCSV: toCSV, toMD: toMD, toJSON: toJSON,
  q: q, r2: r2, r4: r4, r6: r6, closeChoice: closeChoice
};

if (typeof window !== 'undefined') { window.AppCore = AppCore; }
if (typeof module !== 'undefined' && module.exports) { module.exports = AppCore; }
