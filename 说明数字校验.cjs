/* 改方子 · 发布说明数字回溯校验
 *
 * 作用：把 说明.txt 里出现的**每一个数字 token**，逐个查回「同一次已验算的引擎输出」。
 *   1) 跑若干条**在本脚本里显式声明**的引擎运行（默认场景 + 说明正文里提到的那一处高度变化）；
 *   2) 把每次运行输出里的所有数值、以及所有字符串里的数字，连同它们的 0/1/2/3/4/6 位小数
 *      与 ×100 / ÷100 形式，登记成一个允许集合（并记下来源是哪一次运行）；
 *   3) 再扫 说明.txt 的数字 token，逐个查表 —— 查不到的必须报出来，不允许"编造的数字"。
 *
 * 结果卡那两个尺寸（1080 / 1350）不是引擎输出，而是 ui.js 里 drawCard 的常量，
 * 本脚本直接从 ui.js 里读出来核对，不放进"来源不明"那一栏。
 *
 * 用法：node 说明数字校验.cjs   （退出码 0 = 未登记 0 个）
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const A = require('./core.js');

const ROOT = path.resolve(__dirname, '..');
const DESC = path.join(ROOT, '说明.txt');
const UI = path.join(__dirname, 'ui.js');
const OUT = path.join(ROOT, 'evidence', '说明数字校验.txt');

/* 说明正文里点名过的引擎运行，逐条声明（不写"大概是默认场景"这种） */
const RUNS = [
  { label: '默认场景（8 寸圆模 φ20.32 × 高 6 → 6 寸圆模 φ15.24 × 高 6）', patch: {} },
  { label: '说明里「把高度从 6 cm 改成 7.5 cm」那一处', patch: { dstHeight: 7.5 } }
];

function variants(v) {
  const set = new Set();
  if (!isFinite(v)) return set;
  /* 只放宽两种尺度：原值，以及百分数写法（说明里会写"相差 18.518%"）。
     不放 ÷100：那会让 70.3125 这种无关的数意外地把 0.703125 洗白（本轮实测踩到过）。 */
  const cands = [v];
  if (Math.abs(v) < 1e7) cands.push(v * 100);
  cands.forEach((x) => {
    [0, 1, 2, 3, 4, 6].forEach((d) => {
      let s = x.toFixed(d);
      if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
      if (s === '-0') s = '0';
      set.add(s);
    });
  });
  return set;
}

function collect(node, bag, from) {
  if (node === null || node === undefined) return;
  if (typeof node === 'number') { variants(node).forEach((s) => { if (!bag.has(s)) bag.set(s, from); }); return; }
  if (typeof node === 'string') {
    (node.match(/[0-9]+(?:\.[0-9]+)?/g) || []).forEach((t) => {
      if (!bag.has(t)) bag.set(t, from + '（字符串里的数字）');
      variants(Number(t)).forEach((s) => { if (!bag.has(s)) bag.set(s, from + '（字符串里的数字）'); });
    });
    return;
  }
  if (Array.isArray(node)) { node.forEach((x) => collect(x, bag, from)); return; }
  Object.keys(node).forEach((k) => collect(node[k], bag, from));
}

(function main() {
  const bag = new Map();          // 数字 → 来源
  const perRun = [];

  RUNS.forEach((run) => {
    const cfg = A.normCfg(Object.assign({}, A.DEFAULTS, run.patch));
    const errs = A.validate(cfg);
    if (errs.length) throw new Error('声明的运行不合法：' + run.label + ' → ' + JSON.stringify(errs));
    const out = A.compute(cfg);
    const before = bag.size;
    collect(out, bag, run.label);
    /* 也把这一次的输入登记进去（7.5 这种是输入，不是输出） */
    collect(cfg, bag, run.label + '（输入）');
    perRun.push({ label: run.label, added: bag.size - before, k: out.k, flour: out.flour.dstG, checks: out.passCount + '/' + out.totalCount });
  });

  /* 引擎常量（尺寸换算、上限）—— 也是代码里定的，不是编的 */
  (function () {
    const cbag = new Map();
    collect({ CM_PER_INCH: A.CM_PER_INCH, MAX_ROWS: A.MAX_ROWS, LIMITS: A.LIMITS, DEFAULTS: A.DEFAULTS }, cbag, 'core.js 的引擎常量');
    cbag.forEach((v, kk) => { if (!bag.has(kk)) bag.set(kk, v); });
  })();

  /* 结果卡尺寸：直接从 ui.js 的 drawCard / drawCover 里读出来核对 */
  const uiSrc = fs.readFileSync(UI, 'utf8');
  const cardM = uiSrc.match(/function drawCard[\s\S]*?var W = (\d+), H = (\d+);/);
  const coverM = uiSrc.match(/function drawCover[\s\S]*?var W = (\d+), H = (\d+);/);
  if (!cardM || !coverM) throw new Error('从 ui.js 里读不到 drawCard / drawCover 的画布尺寸');
  [cardM[1], cardM[2], coverM[1], coverM[2]].forEach((n) => { if (!bag.has(n)) bag.set(n, 'ui.js 里 drawCard/drawCover 的画布常量（已核对）'); });

  const desc = fs.readFileSync(DESC, 'utf8');
  const tokens = Array.from(new Set((desc.match(/[0-9]+(?:\.[0-9]+)?/g) || [])));
  const missing = tokens.filter((t) => !bag.has(t));

  const KEY = ['0.5625', '56.25', '84.375', '118.125', '66.666667', '18.518', '0.75', '33.33', '13.5061', '16.59', '0.703125', '1945.7567'];
  const keyMissing = KEY.filter((k) => tokens.indexOf(k) < 0);

  const paras = desc.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const noStar = (desc.match(/\*/g) || []).length;

  const L = [];
  L.push('# 改方子 · 说明数字回溯校验');
  L.push('# 运行时间 ' + new Date().toISOString());
  L.push('');
  L.push('## 显式声明的引擎运行（不是"大概是默认场景"）');
  perRun.forEach((r) => L.push('  · ' + r.label + ' → k=' + r.k + '、面粉=' + r.flour + ' g、自检 ' + r.checks + '（贡献数字 ' + r.added + ' 个）'));
  L.push('');
  L.push('## 结果卡 / 封面画布常量（从 ui.js 读出核对）');
  L.push('  · drawCard ' + cardM[1] + '×' + cardM[2] + '，drawCover ' + coverM[1] + '×' + coverM[2]);
  L.push('');
  L.push('## 说明.txt');
  L.push('  · 段落数 ' + paras.length + '，字符数 ' + desc.length + '，去空白字符数 ' + desc.replace(/\s/g, '').length);
  L.push('  · 数字 token 去重后 ' + tokens.length + ' 个');
  L.push('  · 字面 Markdown 星号 ' + noStar + ' 个（应为 0）');
  L.push('');
  L.push('## 结果');
  L.push('  · 未登记的数字 token：' + missing.length + ' 个' + (missing.length ? ' → ' + missing.join('、') : ''));
  if (missing.length) missing.forEach((t) => L.push('      ' + t + ' 的来源：查不到'));
  L.push('  · 关键数字缺失：' + keyMissing.length + ' 个' + (keyMissing.length ? ' → ' + keyMissing.join('、') : ''));
  L.push('  · 判定：' + (missing.length === 0 && keyMissing.length === 0 && noStar === 0 ? 'PASS' : 'FAIL'));
  L.push('');
  L.push('## 抽样：几个关键数字的来源');
  ['0.5625', '56.25', '84.375', '15.625', '18.518', '66.666667', '0.703125', '13.5061', '1080', '2.54'].forEach((t) => {
    L.push('  · ' + t + ' ← ' + (bag.get(t) || '（查不到）'));
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, L.join('\n') + '\n');
  console.log(L.join('\n'));
  if (missing.length || keyMissing.length || noStar) process.exit(2);
})();
