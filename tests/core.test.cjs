/* 改方子 · 核心测试
 * 运行：node --test tests/core.test.cjs
 * 看原始 pass/fail/cancelled/skipped/todo，不凑数量。
 *
 * ── 手算锚点（默认场景，逐个数字都能在纸上重算；下面每条断言都对应这里的一行） ──
 * 输入：原模 圆 φ20.32 cm 高 6 cm；目标模 圆 φ15.24 cm 高 6 cm；
 *       面粉 100 g；牛奶 60%（勾为液体）、细砂糖 45%、玉米油 40%；鸡蛋 3 个 × 50 g；
 *       称量刻度 1 g、四舍五入（半格向上）
 *
 * ① 直径比 = 15.24 ÷ 20.32 = 381 ÷ 508 = 3/4 = 0.75（精确，不是近似）
 * ② 高度比 = 6 ÷ 6 = 1；面积比 = (3/4)² = 9/16 = 0.5625（精确）
 *    → **k = 0.5625**（精确 = 9/16）
 * ③ 原面积 = π×20.32² ÷ 4 = π × 103.2256 = 324.292751… cm²；目标 = π×15.24² ÷ 4 = π × 58.0644 = 182.414726… cm²
 *    原体积 = 324.292751 × 6 = 1945.756506… cm³；目标 = 182.414726 × 6 = 1094.488356… cm³
 * ④ 面粉′ = 100 × 0.5625 = 56.25 g
 *    牛奶  = 60% × 56.25 = 33.75 g
 *    细砂糖 = 45% × 56.25 = 25.3125 g
 *    玉米油 = 40% × 56.25 = 22.5 g
 * ⑤ 原总料重 = 100 + 60 + 45 + 40 + 150 = 395 g（含蛋液）；新 = 395 × 0.5625 = 222.1875 g
 * ⑥ 蛋液目标 = 150 × 0.5625 = 84.375 g → 目标个数 = 84.375 ÷ 50 = 1.6875 个
 *    建议蛋数 = round(1.6875) = 2 个 = 100 g；差额 = 100 − 84.375 = +15.625 g
 * ⑦ 收口①（扣液体）：液体行只有牛奶（60%）→ 差额全摊到牛奶
 *    牛奶 33.75 − 15.625 = 18.125 g
 *    总液体：目标 33.75 + 84.375 = 118.125 g；实际 18.125 + 100 = 118.125 g ✓ 守恒
 * ⑧ 收口②（按整蛋配平）：面粉″ = 2 × 50 ÷ (150 ÷ 100) = 100 ÷ 1.5 = 66.6666666… g
 *    k″ = 66.6666666… ÷ 100 = 0.6666666…；偏差 = 0.6666666… ÷ 0.5625 − 1 = 0.1851851…（+18.5185%）
 *    等价线性放大 = √(0.6666666… ÷ 0.5625) = √1.1851851… = 1.0886621… → 目标 φ15.24 × 1.0886621 = 16.5912 cm
 * ⑨ 按直径比缩（常见的那一步错）：面粉 = 100 × 0.75 = 75 g，比正确的 56.25 g 多 18.75 g，多 1/3 = 33.3333%
 * ⑩ 目标模的等面积方模边长 = √182.414726 = 13.506099… cm
 * ⑪ 舍入（刻度 1 g、四舍五入、半格向上）：56.25 → 56；33.75 → 34；25.3125 → 25；22.5 → 23
 *    收口①里牛奶 18.125 → 18
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../core.js');

const base = () => A.normCfg(A.DEFAULTS);
const R = (patch) => A.compute(A.normCfg(Object.assign({}, A.DEFAULTS, patch || {})));

function near(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' 期望 ' + b + ' ± ' + tol + '，实际 ' + a);
}

/* 纯标准库的种子随机（可复现，不用 Math.random） */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ── 独立对拍：另写一条代数路线（同形状时把 π/4 直接约掉，完全不碰 π） ── */
function kIndependent(cfg) {
  const realArea = (sh, d, l, w) => (sh === 'round' ? Math.PI * d * d / 4 : l * w);
  if (cfg.srcShape === cfg.dstShape) {
    const bare = (sh, d, l, w) => (sh === 'round' ? d * d : l * w); // π/4 或 1 在两边约掉
    return (bare(cfg.dstShape, cfg.dstDia, cfg.dstLen, cfg.dstWid) / bare(cfg.srcShape, cfg.srcDia, cfg.srcLen, cfg.srcWid))
      * (cfg.dstHeight / cfg.srcHeight);
  }
  return (realArea(cfg.dstShape, cfg.dstDia, cfg.dstLen, cfg.dstWid) * cfg.dstHeight)
    / (realArea(cfg.srcShape, cfg.srcDia, cfg.srcLen, cfg.srcWid) * cfg.srcHeight);
}

/* ══════════════════ 1. 手算锚点 ══════════════════ */
test('锚点①：直径比恰好 3/4，面积比（= k，两模等高）恰好 9/16 = 0.5625', () => {
  const o = R();
  assert.strictEqual(o.k, 0.5625);      // 精确分数，不是"约等于"
  assert.strictEqual(o.kArea, 0.5625);
  assert.strictEqual(o.kHeight, 1);
  assert.strictEqual(o.sameHeight, true);
});

test('锚点③：两个模的面积与体积与手算一致', () => {
  const o = R();
  near(o.src.areaCm2, 324.2928, 2e-4);
  near(o.dst.areaCm2, 182.4147, 2e-4);
  near(o.src.volumeCm3, 1945.7565, 2e-4);
  near(o.dst.volumeCm3, 1094.4884, 2e-4);
});

test('锚点④：面粉′ 与三行配料逐位等于手算', () => {
  const o = R();
  assert.strictEqual(o.flour.dstG, 56.25);
  const m = {}; o.rows.forEach((r) => { m[r.name] = r.dstG; });
  assert.strictEqual(m['牛奶'], 33.75);
  assert.strictEqual(m['细砂糖'], 25.3125);
  assert.strictEqual(m['玉米油'], 22.5);
  assert.strictEqual(o.flour.srcG, 100);
});

test('锚点⑤：原方总料重 395 g、新方 222.1875 g（= 395 × k）', () => {
  const o = R();
  assert.strictEqual(o.totals.srcG, 395);
  assert.strictEqual(o.totals.dstG, 222.1875);
  assert.strictEqual(o.totals.dstG, o.totals.srcG * o.k);
});

test('锚点⑥：蛋液目标 84.375 g、目标 1.6875 个、建议 2 个、差额 +15.625 g', () => {
  const o = R();
  assert.strictEqual(o.egg.dstG, 84.375);
  assert.strictEqual(o.egg.exactCount, 1.6875);
  assert.strictEqual(o.egg.suggestedCount, 2);
  assert.strictEqual(o.egg.suggestedG, 100);
  assert.strictEqual(o.egg.diffG, 15.625);
  assert.strictEqual(o.egg.floorCount, 1);
  assert.strictEqual(o.egg.ceilCount, 2);
});

test('锚点⑦：收口①把 15.625 g 全从牛奶扣掉 → 18.125 g，且总液体守恒在 118.125 g', () => {
  const o = R();
  assert.strictEqual(o.closeA.available, true);
  assert.strictEqual(o.closeA.eggDiffG, 15.625);
  assert.strictEqual(o.closeA.rows[0].name, '牛奶');
  assert.strictEqual(o.closeA.rows[0].deduct, 15.625);
  assert.strictEqual(o.closeA.rows[0].after, 18.125);
  assert.strictEqual(o.closeA.rows[1].deduct, 0);      // 细砂糖不是液体
  assert.strictEqual(o.closeA.rows[2].deduct, 0);      // 玉米油也不是
  assert.strictEqual(o.closeA.targetLiquidG, 118.125);
  assert.strictEqual(o.closeA.actualLiquidG, 118.125);
  assert.strictEqual(o.closeA.negativeWarning, false);
});

test('锚点⑧：收口②面粉″ = 100 ÷ 1.5、k″ = 2/3、偏差 +18.5185%、等价 φ16.59', () => {
  const o = R();
  assert.strictEqual(o.closeB.available, true);
  near(o.closeB.flourG, 66.666667, 1e-6);
  near(o.closeB.kActual, 0.666667, 1e-6);
  near(o.closeB.kDeviation, 0.185185, 1e-6);
  near(o.reverse.egg.perEggFlourG, 33.333333, 1e-6);
  near(o.closeB.equivScale, Math.sqrt((2 / 3) / 0.5625), 1e-4);
  near(o.closeB.equivDiaCm, 15.24 * Math.sqrt((2 / 3) / 0.5625), 1e-2);
  assert.strictEqual(o.closeB.eggCount, 2);
  assert.strictEqual(o.closeB.eggG, 100);
});

test('锚点⑨：按直径比缩会多放 1/3 的料（面粉 75 g vs 56.25 g）', () => {
  const o = R();
  assert.strictEqual(o.naive.diaRatio, 0.75);
  assert.strictEqual(o.naive.kByDia, 0.75);
  assert.strictEqual(o.naive.kByDiaSq, 0.5625);
  assert.strictEqual(o.naive.flourByDiaG, 75);
  assert.strictEqual(o.naive.flourExtraG, 18.75);
  near(o.naive.extraPct, 1 / 3, 1e-6);
  near(o.naive.overdoRatio, 4 / 3, 1e-6);
});

test('锚点⑩：等面积方模的边长 = √182.4147 = 13.5061 cm', () => {
  const o = R();
  assert.strictEqual(o.reverse.shape.from, 'round');
  near(o.reverse.shape.sideCm, 13.5061, 2e-4);
  near(o.reverse.shape.sideCm * o.reverse.shape.sideCm, o.dst.areaCm2, 2e-3);
});

test('锚点⑪：刻度 1 g 四舍五入（半格向上）—— 56 / 34 / 25 / 23，收口①里 18', () => {
  const o = R();
  assert.strictEqual(o.flour.rounded, 56);
  const m = {}; o.rows.forEach((r) => { m[r.name] = r.rounded; });
  assert.strictEqual(m['牛奶'], 34);
  assert.strictEqual(m['细砂糖'], 25);
  assert.strictEqual(m['玉米油'], 23);            // 22.5 → 23（半格向上）
  assert.strictEqual(o.closeA.rows[0].rounded, 18);
  assert.strictEqual(o.totals.roundStepG, 1);
  assert.strictEqual(o.totals.roundMode, 'nearest');
});

/* ══════════════════ 2. 取整、阈值两侧与"半格" ══════════════════ */
test('取整：先归一到 6 位小数，再半格一律向上（不靠浮点运气）', () => {
  /* 1e-6 以内的差别视为同一个数（归一到 6 位小数），正好半格时向上 */
  assert.strictEqual(A.q(22.5, 1, 'nearest'), 23);
  assert.strictEqual(A.q(22.499999, 1, 'nearest'), 22);
  assert.strictEqual(A.q(22.5000001, 1, 'nearest'), 23);      // 归一后就是 22.5 → 向上
  assert.strictEqual(A.q(0.5, 1, 'nearest'), 1);
  assert.strictEqual(A.q(1.5, 0.5, 'nearest'), 1.5);          // 正好是刻度整数倍，不多进
  assert.strictEqual(A.q(2.25, 0.5, 'nearest'), 2.5);         // 半格向上
  assert.strictEqual(A.q(2.2, 0.5, 'nearest'), 2);
  assert.strictEqual(A.q(22.5, 1, 'up'), 23);
  assert.strictEqual(A.q(22, 1, 'up'), 22);                   // 正好是刻度就不再多进一格
  assert.strictEqual(A.q(22.0000001, 1, 'up'), 22);           // 归一后就是 22
  assert.strictEqual(A.q(22.001, 1, 'up'), 23);
  assert.strictEqual(A.q(0.001, 1, 'up'), 1);
  assert.strictEqual(A.q(0.0000001, 1, 'up'), 0);
  assert.ok(Number.isNaN(A.q(5, 0, 'nearest')));              // 刻度为 0 → NaN，不静默取整
  assert.ok(Number.isNaN(A.q(NaN, 1, 'nearest')));
});

test('同一行在两个收口表里的取整结果必须一致（浮点噪声回归锁）', () => {
  const o = R({ roundMode: 'nearest' });
  assert.strictEqual(o.rows[2].rounded, 23);
  assert.strictEqual(o.closeA.rows[2].rounded, 23);
  /* 玉米油不是液体行 → 两处的精确值也必须一模一样 */
  assert.strictEqual(o.closeA.rows[2].after, o.rows[2].dstG);
});

test('刻度换成 0.1 g / 5 g：取整值都落在刻度的整数倍上，且与精确值不超出 1 个刻度', () => {
  [[0.1, 'nearest'], [0.1, 'up'], [5, 'nearest'], [5, 'up'], [2, 'nearest']].forEach(([step, mode]) => {
    const o = R({ roundStep: step, roundMode: mode });
    [o.flour].concat(o.rows).forEach((r) => {
      const v = r.rounded;
      near(v / step, Math.round(v / step), 1e-6, 'step=' + step);
      assert.ok(Math.abs(v - r.dstG) <= step + 1e-9, 'step=' + step + ' 差 ' + (v - r.dstG));
      if (mode === 'up') assert.ok(v >= r.dstG - 1e-9);
    });
  });
});

test('缩放系数阈值两侧：目标直径比原模大一点点 → k 就大于 1；小一点点 → 小于 1', () => {
  const big = R({ dstDia: 20.32 * (1 + 1e-6) });
  const same = R({ dstDia: 20.32 });
  const small = R({ dstDia: 20.32 * (1 - 1e-6) });
  assert.ok(big.k > 1);
  assert.strictEqual(same.k, 1);
  assert.ok(small.k < 1);
  assert.ok(big.k > same.k && same.k > small.k);
});

test('放大场景（k > 1）：新方每一行都严格大于原方，总料重也更大', () => {
  const o = R({ dstDia: 24 });
  assert.ok(o.k > 1);
  o.rows.forEach((r) => assert.ok(r.dstG > r.srcG, r.name));
  assert.ok(o.flour.dstG > o.flour.srcG);
  assert.ok(o.totals.dstG > o.totals.srcG);
});

test('缩小场景（k < 1）：新方每一行都严格小于原方', () => {
  const o = R({ dstDia: 10 });
  assert.ok(o.k < 1);
  o.rows.forEach((r) => assert.ok(r.dstG < r.srcG, r.name));
  assert.ok(o.flour.dstG < o.flour.srcG);
});

/* ══════════════════ 3. 几何与形状 ══════════════════ */
test('高度不能忽略：同一个 6 寸模，高 6 → 7.5 cm 时 k 恰好放大 1.25 倍', () => {
  const a = R();
  const b = R({ dstHeight: 7.5 });
  near(b.k / a.k, 1.25, 1e-6);
  near(b.k, 0.5625 * 1.25, 1e-6);
  assert.strictEqual(b.sameHeight, false);
});

test('不等高时 k = 面积比 × 高度比，且 k 不再等于直径比²', () => {
  const o = R({ srcHeight: 8, dstHeight: 5 });
  near(o.k, o.kArea * (5 / 8), 1e-6);
  assert.ok(Math.abs(o.naive.kByDiaSq - o.k) > 1e-6);
});

test('圆 → 方：面积比按 πD²/4 与 长×宽 算（不是按对角线）', () => {
  const o = R({ dstShape: 'rect', dstLen: 18, dstWid: 18 });
  near(o.dst.areaCm2, 324, 2e-4);
  const srcArea = Math.PI * 20.32 * 20.32 / 4;
  near(o.k, 324 / srcArea, 1e-6);
  /* 口径对照：若把"边长 = 直径"当成等面积（外接方形，412.90 cm²），k 会是 1.27 —— 本页不是这个口径 */
  assert.ok(Math.abs(o.k - (20.32 * 20.32) / srcArea) > 0.2);
  assert.ok(Math.abs(o.k - 1) < 0.01);      // 18×18 与 φ20.32 的面积几乎相等
  assert.strictEqual(o.reverse.shape.from, 'rect');
  near(o.reverse.shape.diaCm, Math.sqrt(4 * 324 / Math.PI), 2e-4);
  assert.strictEqual(o.naive, null);              // 只有圆模对圆模才谈得上"直径比"
});

test('方 → 圆：直径 = √(4×长×宽/π)', () => {
  const o = R({ srcShape: 'rect', srcLen: 40, srcWid: 30, dstDia: 20, dstShape: 'round' });
  near(o.src.areaCm2, 1200, 2e-4);
  near(o.reverse.shape.diaCm, Math.sqrt(4 * (Math.PI * 100) / Math.PI), 2e-4);
  assert.strictEqual(o.naive, null);
});

test('方 → 方：k 就是两组边长的乘积比（再乘高度比）', () => {
  const o = R({ srcShape: 'rect', srcLen: 30, srcWid: 20, srcHeight: 5, dstShape: 'rect', dstLen: 18, dstWid: 18, dstHeight: 5 });
  near(o.k, (18 * 18) / (30 * 20), 1e-6);
});

test('圆形寸换算（1 英寸 = 2.54 cm）：6/7/8/9/10 寸的直径与等面积方模边长', () => {
  const o = R();
  const t = o.reverse.roundSizes;
  assert.strictEqual(t.length, 5);
  assert.strictEqual(t[2].inch, 8);
  near(t[2].diaCm, 20.32, 1e-9);
  near(t[2].areaCm2, 324.2928, 2e-4);
  near(t[2].equivSideCm, Math.sqrt(324.2928), 2e-3);
  near(t[0].diaCm, 6 * 2.54, 1e-9);
  near(t[4].diaCm, 25.4, 1e-9);
  near(t[2].kVsSrc, 1, 1e-6);                      // 原模就是 8 寸
});

/* ══════════════════ 4. 收口①与收口② ══════════════════ */
test('收口①多于一个液体行时：差额按各行原占比分摊，总和仍等于差额', () => {
  const o = R({ rows: [{ name: '牛奶', pct: 60, liquid: true }, { name: '水', pct: 40, liquid: true }, { name: '糖', pct: 50, liquid: false }] });
  const d0 = o.closeA.rows[0].deduct, d1 = o.closeA.rows[1].deduct;
  near(d0 + d1, o.closeA.eggDiffG, 1e-5);
  near(d0 / d1, 60 / 40, 1e-6);                   // 按 60:40 分摊
  assert.strictEqual(o.closeA.liquidPctSum, 100);
  near(o.closeA.actualLiquidG, o.closeA.targetLiquidG, 1e-5);
});

test('收口①在任何缩放方向下都守恒（缩小 30 个点、放大 30 个点各一条）', () => {
  [0.7, 1.3].forEach((f) => {
    const o = R({ dstDia: 15.24 * f });
    assert.strictEqual(o.closeA.available, true);
    near(o.closeA.actualLiquidG, o.closeA.targetLiquidG, 1e-5, 'f=' + f);
    assert.ok(!o.closeA.negativeWarning || o.closeA.rows.some((r) => r.after < 0));
  });
});

test('收口①会被扣成负数时如实标出来（不是悄悄取 0）', () => {
  const o = R({
    flourG: 100, eggCount: 3, eggG: 50,
    rows: [{ name: '水', pct: 10, liquid: true }, { name: '糖', pct: 100, liquid: false }, { name: '油', pct: 100, liquid: false }],
    dstDia: 9.1
  });
  assert.strictEqual(o.closeA.available, true);
  assert.strictEqual(o.closeA.negativeWarning, true);
  assert.ok(o.closeA.rows[0].after < 0);
  near(o.closeA.actualLiquidG, o.closeA.targetLiquidG, 1e-5);   // 守恒照样成立
});

test('收口②永远是"整数个蛋 + 比例全对"，代价体现在 k″ 偏差上；蛋数就是建议蛋数', () => {
  [0.6, 0.8, 1.0, 1.4].forEach((f) => {
    const cfg = A.normCfg(Object.assign({}, A.DEFAULTS, { dstDia: 15.24 * f }));
    const o = A.compute(cfg);
    assert.strictEqual(o.closeB.available, true);
    assert.strictEqual(o.closeB.eggCount, o.egg.suggestedCount);
    near(o.closeB.kActual * cfg.flourG, o.closeB.flourG, 1e-3);   // k″ × 面粉 = 面粉″
    o.closeB.rows.forEach((r) => near(r.bG, r.pct / 100 * o.closeB.flourG, 1e-6));
    near(o.closeB.flourG, o.closeB.eggCount * 50 / 1.5, 1e-5);    // 每 1 g 面粉配 1.5 g 蛋液
  });
});

test('收口②的偏差方向：目标模偏小（蛋只能向上取整）时 k″ > k，偏差为正', () => {
  const o = R({ dstDia: 15.24 });          // 建议 2 个 > 目标 1.6875 个
  assert.ok(o.closeB.kActual > o.k);
  assert.ok(o.closeB.kDeviation > 0);
  near(o.closeB.equivScale, Math.sqrt(1 + o.closeB.kDeviation), 1e-4);
  /* 等价模直径要大于目标模直径（料多了，要更大的模才装得下） */
  assert.ok(o.closeB.equivDiaCm > o.dst.diaCm);
});

test('反推"想用 N 个整蛋"：每多一个蛋，面粉多一个常数（每蛋 33.3333 g），且与收口②对得上', () => {
  const o = R();
  const r = o.reverse.egg.ratios;
  near(o.reverse.egg.perEggFlourG, 50 / 1.5, 1e-6);
  near(r[2].flourG, 2 * (50 / 1.5), 1e-4);
  near(r[2].flourG, o.closeB.flourG, 1e-4);         // 与收口②的面粉″必须是同一个数
  for (let i = 1; i < r.length; i++) near(r[i].flourG - r[i - 1].flourG, 50 / 1.5, 1e-3, 'i=' + i);
  near(r[0].flourG, 0, 1e-9);
});

/* ══════════════════ 5. 退化与边界 ══════════════════ */
test('没有鸡蛋（0 个）：两个收口都不适用，但配方照样按 k 缩放', () => {
  const o = R({ eggCount: 0 });
  assert.strictEqual(o.egg.srcG, 0);
  assert.strictEqual(o.egg.dstG, 0);
  assert.strictEqual(o.egg.suggestedCount, 0);
  assert.strictEqual(o.closeA.available, false);
  assert.strictEqual(o.closeB.available, false);
  assert.ok(o.closeA.reason.length > 0 && o.closeB.reason.length > 0);
  assert.strictEqual(o.flour.dstG, 56.25);          // 配方部分不受影响
  assert.strictEqual(o.totals.dstG, 245 * 0.5625);  // 100+60+45+40 = 245
});

test('一行液体都没勾：收口①不适用并写明原因，收口②仍可用', () => {
  const o = R({ rows: [{ name: '牛奶', pct: 60, liquid: false }, { name: '细砂糖', pct: 45, liquid: false }] });
  assert.strictEqual(o.closeA.available, false);
  assert.ok(/液体/.test(o.closeA.reason));
  assert.strictEqual(o.closeB.available, true);
  assert.strictEqual(o.liquidPctSum, 0);
});

test('目标模小到连一个蛋都用不上：两个收口都标"不适用"并写明原因，不硬算出 0 g 面粉', () => {
  const o = R({ dstDia: 6 });
  assert.strictEqual(o.egg.suggestedCount, 0);
  assert.strictEqual(o.closeA.available, false);
  assert.strictEqual(o.closeB.available, false);
  assert.ok(/用不上/.test(o.closeA.reason) || /用不上/.test(o.closeB.reason));
  assert.ok(o.flour.dstG > 0);
});

test('单个蛋的蛋液改小/改大只影响蛋相关的量，不影响 k 与配方行', () => {
  const a = R({ eggG: 40 }), b = R({ eggG: 60 });
  assert.strictEqual(a.k, b.k);
  a.rows.forEach((r, i) => assert.strictEqual(r.dstG, b.rows[i].dstG));
  assert.strictEqual(a.flour.dstG, b.flour.dstG);
  assert.strictEqual(a.egg.dstG, 3 * 40 * 0.5625);   // 蛋液目标 = 蛋数 × 每蛋克数 × k
  assert.strictEqual(b.egg.dstG, 3 * 60 * 0.5625);
  /* 目标"个数"= 蛋数 × k，与每蛋克数无关；变的是建议蛋数下的实际蛋液克数 */
  assert.strictEqual(a.egg.exactCount, 1.6875);
  assert.strictEqual(b.egg.exactCount, 1.6875);
  assert.strictEqual(a.egg.suggestedG, 2 * 40);
  assert.strictEqual(b.egg.suggestedG, 2 * 60);
});

test('极值：最小与最大的一整套尺寸都能算出来，且都通过全部自检', () => {
  const minCfg = A.normCfg(Object.assign({}, A.DEFAULTS, { srcDia: 5, srcHeight: 1, dstDia: 5, dstHeight: 1, flourG: 10, eggCount: 0, roundStep: 0.1 }));
  const maxCfg = A.normCfg(Object.assign({}, A.DEFAULTS, { srcDia: 60, srcHeight: 30, dstDia: 60, dstHeight: 30, flourG: 5000, eggCount: 24, eggG: 100, roundStep: 10 }));
  [minCfg, maxCfg].forEach((c) => {
    const o = A.compute(c);
    assert.strictEqual(o.selfChecks.filter((x) => !x.pass).length, 0);
    assert.ok(isFinite(o.k) && o.k > 0);
  });
  assert.strictEqual(Math.round(minCfg.srcDia), 5);
});

test('刻度比某一行精确值还大时：取整可能为 0，仍然如实给出并计入舍入误差', () => {
  const o = R({ dstDia: 6, roundStep: 10 });
  assert.ok(o.rows.some((r) => r.rounded === 0));
  const roundedSum = o.rows.reduce((s, r) => s + r.rounded, 0);
  const exactSum = o.rows.reduce((s, r) => s + r.dstG, 0);
  assert.ok(Math.abs(roundedSum - exactSum) <= 10 * o.rows.length + 1e-6);
});

/* ══════════════════ 6. 非法输入（逐条核字段） ══════════════════ */
test('合法默认配置零错误', () => {
  assert.deepStrictEqual(A.validate(base()), []);
});

test('非法输入逐条报出正确的字段名（29 类）', () => {
  const cases = [
    ['flourG', { flourG: '' }], ['flourG', { flourG: 'abc' }], ['flourG', { flourG: -1 }],
    ['flourG', { flourG: 9 }], ['flourG', { flourG: 5001 }], ['flourG', { flourG: '1e999' }],
    ['eggCount', { eggCount: '' }], ['eggCount', { eggCount: -1 }], ['eggCount', { eggCount: 25 }],
    ['eggCount', { eggCount: 'x' }],
    ['eggG', { eggG: 0 }], ['eggG', { eggG: 101 }], ['eggG', { eggG: '' }],
    ['roundStep', { roundStep: 0 }], ['roundStep', { roundStep: 11 }], ['roundStep', { roundStep: '' }],
    ['srcDia', { srcDia: 4 }], ['srcDia', { srcDia: 61 }], ['srcDia', { srcDia: '' }],
    ['dstDia', { dstDia: 0 }], ['dstDia', { dstDia: 'abc' }],
    ['srcHeight', { srcHeight: 0 }], ['srcHeight', { srcHeight: 31 }],
    ['dstHeight', { dstHeight: 0 }], ['dstHeight', { dstHeight: '' }],
    ['row0', { rows: [{ name: 'a', pct: 0 }] }], ['row1', { rows: [{ name: 'a', pct: 10 }, { name: 'b', pct: -5 }] }],
    ['row0', { rows: [{ name: 'a', pct: 501 }] }], ['row0', { rows: [{ name: 'a', pct: '' }] }]
  ];
  cases.forEach(([field, patch]) => {
    const errs = A.validate(A.normCfg(Object.assign({}, A.DEFAULTS, patch)));
    assert.ok(errs.some((e) => e.field === field), field + ' 应报错，实际 ' + JSON.stringify(errs));
  });
});

test('方模时校验的是长与宽（不是直径）；切到方模后圆形字段不再参与校验', () => {
  const errs = A.validate(A.normCfg(Object.assign({}, A.DEFAULTS, { srcShape: 'rect', srcLen: 2 })));
  assert.deepStrictEqual(errs.map((e) => e.field), ['srcLen']);
  const errs2 = A.validate(A.normCfg(Object.assign({}, A.DEFAULTS, { srcShape: 'rect', srcDia: 3, srcLen: 20, srcWid: 20 })));
  assert.deepStrictEqual(errs2, []);      // srcDia 非法也不该报（当前不是圆模）
});

test('一次多错一起报，不是只报第一个', () => {
  const errs = A.validate(A.normCfg(Object.assign({}, A.DEFAULTS, { flourG: -1, eggG: 0, srcDia: 1, dstHeight: 99 })));
  assert.ok(errs.length >= 4, '实际只报了 ' + errs.length + ' 条：' + JSON.stringify(errs));
  ['flourG', 'eggG', 'srcDia', 'dstHeight'].forEach((f) => assert.ok(errs.some((e) => e.field === f), f));
});

test('配方行全被删掉要报错；换成 8 行（上限）合法，9 行被截到 8 行', () => {
  assert.ok(A.validate(A.normCfg(Object.assign({}, A.DEFAULTS, { rows: [] }))).some((e) => e.field === 'rows'));
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ name: '行' + i, pct: 10, liquid: false }));
  assert.strictEqual(A.normCfg(Object.assign({}, A.DEFAULTS, { rows: mk(8) })).rows.length, 8);
  assert.strictEqual(A.normCfg(Object.assign({}, A.DEFAULTS, { rows: mk(9) })).rows.length, 8);
  assert.deepStrictEqual(A.validate(A.normCfg(Object.assign({}, A.DEFAULTS, { rows: mk(8) }))), []);
});

test('空串不等于"没填"：留空要报错，不提供才用默认值（不静默换默认）', () => {
  const cleared = A.normCfg({ flourG: '', srcDia: '', eggG: '' });
  assert.ok(Number.isNaN(cleared.flourG) && Number.isNaN(cleared.srcDia) && Number.isNaN(cleared.eggG));
  assert.ok(A.validate(cleared).length >= 3);
  const missing = A.normCfg({});
  assert.strictEqual(missing.flourG, A.DEFAULTS.flourG);
  assert.strictEqual(missing.srcDia, A.DEFAULTS.srcDia);
  /* 0 个蛋是合法输入，不能被当成"没填"而回退成默认的 3 个 */
  assert.strictEqual(A.normCfg({ eggCount: 0 }).eggCount, 0);
  assert.deepStrictEqual(A.validate(A.normCfg(Object.assign({}, A.DEFAULTS, { eggCount: 0 }))), []);
});

test('枚举兜底：形状 / 舍入口径给个不认识的取值，一律归一到合法枚举而不是崩掉', () => {
  const c = A.normCfg(Object.assign({}, A.DEFAULTS, { srcShape: 'triangle', dstShape: '', roundMode: 'whatever' }));
  assert.strictEqual(c.srcShape, 'round');
  assert.strictEqual(c.dstShape, 'round');
  assert.strictEqual(c.roundMode, 'nearest');
  assert.deepStrictEqual(A.validate(c), []);
});

/* ══════════════════ 7. 独立对拍 ══════════════════ */
test('独立对拍：另一条代数路线（同形状时把 π/4 约掉，完全不用 π）算出的 k 与引擎一致', () => {
  const cfgs = [
    {}, { dstDia: 24 }, { dstDia: 6 }, { srcHeight: 8, dstHeight: 5 },
    { srcShape: 'rect', srcLen: 40, srcWid: 30, dstShape: 'rect', dstLen: 18, dstWid: 18 },
    { dstShape: 'rect', dstLen: 20, dstWid: 12, dstHeight: 7 },
    { srcShape: 'rect', srcLen: 25, srcWid: 25, dstDia: 20, dstShape: 'round', dstHeight: 4 }
  ];
  let n = 0;
  cfgs.forEach((patch) => {
    const cfg = A.normCfg(Object.assign({}, A.DEFAULTS, patch));
    const o = A.compute(cfg);
    near(o.k, kIndependent(cfg), 1e-6, JSON.stringify(patch));
    n++;
  });
  assert.strictEqual(n, cfgs.length);
});

test('独立对拍：用"每 g 面粉的配比表"思路重算整张新方（逐行），7 个构型共 35 项', () => {
  const patches = [{}, { dstDia: 24 }, { dstDia: 6 }, { dstHeight: 7.5 }, { srcHeight: 8, dstHeight: 5 }, { dstShape: 'rect', dstLen: 18, dstWid: 18 }, { dstDia: 17.78 }];
  let n = 0;
  patches.forEach((patch) => {
    const cfg = A.normCfg(Object.assign({}, A.DEFAULTS, patch));
    const o = A.compute(cfg);
    const k = kIndependent(cfg);
    const flour = cfg.flourG * k;
    assert.ok(Math.abs(o.flour.dstG - flour) < 1e-6, 'flour ' + JSON.stringify(patch));
    n++;
    cfg.rows.forEach((r, i) => {
      assert.ok(Math.abs(o.rows[i].dstG - r.pct / 100 * flour) < 1e-6, r.name + ' ' + JSON.stringify(patch));
      n++;
    });
    assert.ok(Math.abs(o.totals.dstG - (cfg.flourG + cfg.eggCount * cfg.eggG + cfg.rows.reduce((s, r) => s + r.pct, 0) / 100 * cfg.flourG) * k) < 1e-6);
    n++;
  });
  assert.strictEqual(n, patches.length * 5);   // 每构型：面粉 1 + 三行 3 + 总料重 1
});

test('独立对拍：面积用"半径"写一遍（πr²），与引擎的 πD²/4 对得上', () => {
  [5, 12.7, 15.24, 20.32, 25.4, 60].forEach((d) => {
    const o = R({ dstDia: d });
    near(o.dst.areaCm2, Math.PI * Math.pow(d / 2, 2), 2e-4, 'd=' + d);
  });
});

/* ══════════════════ 8. 随机压力与不变量 ══════════════════ */
test('随机压力：300 组合法构型，34 项自检全过（累计 ≥10,200 条断言 0 失败）', () => {
  const rnd = mulberry32(20261112);
  let n = 0;
  for (let i = 0; i < 300; i++) {
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const nRows = 1 + Math.floor(rnd() * 5);
    const rows = [];
    for (let j = 0; j < nRows; j++) rows.push({ name: 'r' + j, pct: 1 + rnd() * 120, liquid: rnd() < 0.4 });
    const srcShape = rnd() < 0.5 ? 'round' : 'rect';
    const dstShape = rnd() < 0.5 ? 'round' : 'rect';
    const cfg = A.normCfg(Object.assign({}, A.DEFAULTS, {
      srcShape, dstShape,
      srcDia: 6 + rnd() * 40, srcLen: 4 + rnd() * 50, srcWid: 4 + rnd() * 50, srcHeight: 1.5 + rnd() * 15,
      dstDia: 6 + rnd() * 40, dstLen: 4 + rnd() * 50, dstWid: 4 + rnd() * 50, dstHeight: 1.5 + rnd() * 15,
      flourG: 20 + rnd() * 900, eggCount: Math.floor(rnd() * 8), eggG: 20 + rnd() * 60,
      rows, roundStep: pick([0.1, 0.5, 1, 2, 5]), roundMode: pick(['nearest', 'up'])
    }));
    const errs = A.validate(cfg);
    assert.deepStrictEqual(errs, [], 'cfg#' + i + ' ' + JSON.stringify(errs));
    const o = A.compute(cfg);
    const fails = o.selfChecks.filter((x) => !x.pass);
    assert.deepStrictEqual(fails.map((x) => x.label), [], 'cfg#' + i);
    n += o.totalCount;
  }
  assert.ok(n >= 300 * 34, '断言条数 ' + n);
});

test('物理不变量（300 组随机，0 违反）：守恒、单调、蛋数夹逼、舍入界限、液体不为负的标记一致', () => {
  const rnd = mulberry32(777);
  let n = 0;
  for (let i = 0; i < 300; i++) {
    const nRows = 1 + Math.floor(rnd() * 4);
    const rows = Array.from({ length: nRows }, (_, j) => ({ name: 'r' + j, pct: 5 + rnd() * 80, liquid: j === 0 }));
    const cfg = A.normCfg(Object.assign({}, A.DEFAULTS, {
      srcDia: 8 + rnd() * 30, dstDia: 6 + rnd() * 30,
      srcHeight: 2 + rnd() * 10, dstHeight: 2 + rnd() * 10,
      flourG: 50 + rnd() * 500, eggCount: 1 + Math.floor(rnd() * 6), eggG: 40 + rnd() * 20,
      rows, roundStep: 1, roundMode: 'nearest'
    }));
    const o = A.compute(cfg);
    /* 不变量 1：k > 0 */
    assert.ok(o.k > 0);
    /* 不变量 2：新方总料重 = 原方总料重 × k（按显示位数取容差，k 可能很大） */
    near(o.totals.dstG, o.totals.srcG * o.k, 1e-3 * Math.max(1, Math.abs(o.totals.dstG)), 'cfg#' + i);
    /* 不变量 3：蛋数建议把目标夹在半个蛋以内 */
    assert.ok(Math.abs(o.egg.diffG) <= cfg.eggG / 2 + 1e-9);
    /* 不变量 4：舍入值都在 ±1 刻度 */
    o.rows.forEach((r) => assert.ok(Math.abs(r.rounded - r.dstG) <= 1 + 1e-9));
    /* 不变量 5：液体行守恒 + 负数标记一致（这里恒定只有一个液体行） */
    if (o.closeA.available) {
      near(o.closeA.actualLiquidG, o.closeA.targetLiquidG, 1e-5);
      assert.strictEqual(o.closeA.negativeWarning, o.closeA.rows[0].after < 0);
      near(o.closeA.rows[0].deduct, o.closeA.eggDiffG, 1e-5);
    }
    /* 不变量 6：对照表 k 单调不减，且 ×1.00 行等于主结论 */
    for (let j = 1; j < o.tables.dia.length; j++) assert.ok(o.tables.dia[j].k >= o.tables.dia[j - 1].k - 1e-12);
    assert.ok(Math.abs(o.tables.dia[2].k - o.k) < 1e-9);
    n += 6;
  }
  assert.ok(n >= 1800);
});

/* ══════════════════ 9. 自检会红 / 校验器会红 ══════════════════ */
test('自检不是摆设：把 k 改坏、把总量改坏、把守恒改坏，自检都必须红', () => {
  const cfg = base();
  const good = A.compute(cfg);
  const mut = [
    ['k', (o) => { o.k = o.k * 1.1; }],
    ['总料重', (o) => { o.totals.dstG = o.totals.dstG + 1; }],
    ['收口①守恒', (o) => { o.closeA.actualLiquidG = o.closeA.actualLiquidG + 1; }],
    ['收口②等比', (o) => { o.closeB.rows[0].bG = o.closeB.rows[0].bG + 1; }],
    ['对照表 ×1.00 行', (o) => { o.tables.dia[2].k = o.tables.dia[2].k + 0.01; }],
    ['舍入倍数', (o) => { o.rows[0].rounded = o.rows[0].rounded + 0.3; }],
    ['NaN 契约', (o) => { o.egg.dstG = NaN; }]
  ];
  mut.forEach(([what, fn]) => {
    const copy = JSON.parse(JSON.stringify(good));
    fn(copy);
    const ck = A.selfChecks(cfg, copy);
    assert.ok(ck.some((x) => !x.pass), what + ' 改坏之后自检居然全过 —— 说明这条自检是空转的');
  });
  /* 原样的输出必须全过（对照组） */
  assert.strictEqual(A.selfChecks(cfg, good).filter((x) => !x.pass).length, 0);
});

test('校验器不是摆设：默认配置零错误，塞一个坏值就至少一条错误', () => {
  assert.strictEqual(A.validate(base()).length, 0);
  assert.ok(A.validate(A.normCfg(Object.assign({}, A.DEFAULTS, { flourG: 0 }))).length > 0);
});

/* ══════════════════ 10. 确定性、纯函数与导出 ══════════════════ */
test('确定性与纯函数：两次计算结果一致，且不改动传进去的 cfg（含 rows 数组）', () => {
  const cfg = A.normCfg(Object.assign({}, A.DEFAULTS, { rows: [{ name: '牛奶', pct: 60, liquid: true }, { name: '糖', pct: 45, liquid: false }] }));
  const snapshot = JSON.stringify(cfg);
  const a = A.compute(cfg), b = A.compute(cfg);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.strictEqual(JSON.stringify(cfg), snapshot);
});

test('干跑自检（只有必填尺寸与行、其余全用默认）也不抛异常', () => {
  const bare = A.normCfg({ srcDia: 20, dstDia: 15, rows: [{ name: '水', pct: 50, liquid: true }] });
  const o = A.compute(bare);
  assert.ok(o.totalCount >= 30);
  assert.strictEqual(o.selfChecks.filter((x) => !x.pass).length, 0);
});

test('导出 CSV：含 k、逐行克数、两种收口与自检，且带 BOM、行列数对得上', () => {
  const cfg = base();
  const o = A.compute(cfg);
  const csv = A.toCSV(cfg, o);
  assert.ok(csv.charCodeAt(0) === 0xFEFF);
  assert.ok(csv.includes('料量比 k,0.5625'));
  assert.ok(csv.includes('牛奶,60,60,33.75,34,是'));
  assert.ok(csv.includes('玉米油,40,40,22.5,23,否'));
  assert.ok(csv.includes('收口① 扣液体'));
  assert.ok(csv.includes('收口② 按整蛋配平'));
  assert.ok(csv.includes('66.666667'));
  assert.ok(csv.includes('自检'));
  const selfRows = csv.split('\n').filter((l) => /^\d+,/.test(l) && l.includes('通过'));
  assert.strictEqual(selfRows.length, o.totalCount);
});

test('导出 MD：含料量比、两张表与逐条自检', () => {
  const cfg = base();
  const o = A.compute(cfg);
  const md = A.toMD(cfg, o);
  assert.ok(md.includes('料量比 k = 0.5625'));
  assert.ok(md.includes('| 面粉（基准） | 100% | 100 | 56.25 | **56** |'));
  assert.ok(md.includes('| 牛奶（液体） | 60% | 60 | 33.75 | **34** |'));
  assert.ok(md.includes('## 对照表：目标尺寸 ±20%'));
  assert.ok(md.includes('## 对照表：目标高度'));
  assert.ok(md.includes('## 自检 ' + o.passCount + '/' + o.totalCount));
  assert.ok(md.includes('不给烘烤温度与时间建议'));
});

test('导出 JSON：备份里带着完整 cfg，能原样读回来算出同一个结果（往返一致）', () => {
  const cfg = A.normCfg(Object.assign({}, A.DEFAULTS, { dstDia: 17.78, roundStep: 0.5, roundMode: 'up' }));
  const o = A.compute(cfg);
  const backup = JSON.parse(A.toJSON(cfg, o));
  const cfg2 = A.normCfg(backup.cfg);
  assert.deepStrictEqual(cfg2, cfg);
  const o2 = A.compute(cfg2);
  assert.strictEqual(o2.k, o.k);
  assert.strictEqual(o2.flour.rounded, o.flour.rounded);
  assert.deepStrictEqual(o2.rows.map((r) => r.rounded), o.rows.map((r) => r.rounded));
  assert.strictEqual(o2.selfChecks.length, o.totalCount);
});

/* ══════════════════ 11. 场景与表格一致性 ══════════════════ */
test('对照片区的默认场景名带上"虚构"字样，不冒充真实配方', () => {
  assert.ok(/虚构/.test(A.DEFAULTS.label));
});

test('两张对照表逐行都能被独立重算（直径表 5 行 × 4 个量 + 高度表 5 行 × 3 个量）', () => {
  const cfg = base();
  const o = A.compute(cfg);
  let n = 0;
  o.tables.dia.forEach((t) => {
    const k = kIndependent(A.normCfg(Object.assign({}, A.DEFAULTS, { dstDia: t.diaCm })));
    near(t.k, k, 1e-6, 'dia ' + t.diaCm);
    near(t.flourG, cfg.flourG * t.k, 1e-4);
    near(t.firstRowG, cfg.rows[0].pct / 100 * cfg.flourG * t.k, 1e-4);
    near(t.eggDstG, cfg.eggCount * cfg.eggG * t.k, 1e-4);
    n += 4;
  });
  o.tables.height.forEach((t) => {
    const k = kIndependent(A.normCfg(Object.assign({}, A.DEFAULTS, { dstHeight: t.heightCm })));
    near(t.k, k, 1e-6, 'h ' + t.heightCm);
    near(t.flourG, cfg.flourG * t.k, 1e-4);
    near(t.totalG, (cfg.flourG + cfg.eggCount * cfg.eggG + cfg.rows.reduce((s, r) => s + r.pct, 0) / 100 * cfg.flourG) * k, 1e-3);
    n += 3;
  });
  assert.strictEqual(n, 35);
});

test('三张形状等价表：圆 ↔ 方的面积回代都对得上', () => {
  const a = A.compute(base());
  assert.strictEqual(a.tables.shape.length, 2);
  a.tables.shape.forEach((row) => near(row.equivSideCm * row.equivSideCm, row.areaCm2, 2e-3, row.what));
  const b = A.compute(A.normCfg(Object.assign({}, A.DEFAULTS, { srcShape: 'rect', srcLen: 30, srcWid: 20, dstDia: 18, dstShape: 'round' })));
  b.tables.shape.forEach((row) => near(Math.PI * row.equivDiaCm * row.equivDiaCm / 4, row.areaCm2, 2e-3, row.what));
});

test('敏感性输出与对照表的 k 序列一致（不是另算一套）', () => {
  const cfg = base();
  const o = A.compute(cfg);
  const s = A.sensitivity(cfg);
  assert.strictEqual(s.length, o.tables.dia.length);
  s.forEach((row, i) => {
    assert.strictEqual(row.k, o.tables.dia[i].k);
    assert.strictEqual(row.flourG, o.tables.dia[i].flourG);
    assert.strictEqual(row.eggCount, o.tables.dia[i].eggCount);
  });
});
