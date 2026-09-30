// 计算器：键盘计算、CBM 与装柜估算。所有计算只在浏览器本地进行。
const CONTAINERS = {
  '20GP': { name: '20GP 小柜', l: 5.90, w: 2.35, h: 2.39, load: 28000 },
  '40GP': { name: '40GP 平柜', l: 12.03, w: 2.35, h: 2.39, load: 26500 },
  '40HQ': { name: '40HQ 高柜', l: 12.03, w: 2.35, h: 2.69, load: 26500 },
  '45HQ': { name: '45HQ 超高柜', l: 13.10, w: 2.45, h: 2.69, load: 27500 },
};
const CALC_PLAN_RATIO = 0.85;
const calcEl = (id) => document.getElementById(id);
const calcFmt = (n, digits = 2) => Number(n).toLocaleString('zh-CN', { maximumFractionDigits: digits });
const calcValue = (id, integer = false) => {
  const raw = calcEl(id).value.trim();
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) && n > 0 && (!integer || Number.isInteger(n)) ? n : null;
};
const calcOptional = (id) => {
  const raw = calcEl(id).value.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const calcRow = (label, value, emphasis = false, warning = false) =>
  `<div class="cr-row"><span>${label}</span><b class="${warning ? 'warn' : emphasis ? 'hl' : ''}">${value}</b></div>`;
const calcEmpty = (message) => `<div class="calc-empty">${message}</div>`;
async function calcCopyText(value) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const field = document.createElement('textarea');
      field.value = value;
      field.style.position = 'fixed'; field.style.opacity = '0';
      document.body.appendChild(field); field.select();
      const copied = document.execCommand('copy');
      field.remove();
      if (!copied) throw Error('copy failed');
    }
    toast('已复制结果');
  } catch { toast('复制失败，请检查浏览器剪贴板权限'); }
}

function selectCalcTab(name) {
  document.querySelectorAll('[data-calctab]').forEach((button) => {
    const active = button.dataset.calctab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('#view-calc .calc-tab').forEach((panel) => {
    const active = panel.id === 'calc-' + name;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}
document.querySelectorAll('[data-calctab]').forEach((button) =>
  button.addEventListener('click', () => selectCalcTab(button.dataset.calctab)));

// ---------- 普通计算 ----------
let calcExpr = '0';
let calcFinished = false;
let calcLastExpression = '';
let calcHistory = [];
function calcEvaluate(expression) {
  const values = [], operators = [];
  const priority = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const apply = () => {
    const b = values.pop(), a = values.pop(), op = operators.pop();
    if (a === undefined || b === undefined) throw Error('计算式不完整');
    if (op === '/' && b === 0) throw Error('不能除以 0');
    const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b;
    if (!Number.isFinite(result)) throw Error('结果超出范围');
    values.push(result);
  };
  let i = 0, expectNumber = true;
  while (i < expression.length) {
    if (expectNumber) {
      const match = expression.slice(i).match(/^-?(?:\d+(?:\.\d*)?|\.\d+)/);
      if (!match) throw Error('计算式不完整');
      values.push(Number(match[0]));
      i += match[0].length;
      expectNumber = false;
    } else {
      const op = expression[i];
      if (!Object.hasOwn(priority, op)) throw Error('计算式无效');
      while (operators.length && priority[operators[operators.length - 1]] >= priority[op]) apply();
      operators.push(op);
      i++;
      expectNumber = true;
    }
  }
  if (expectNumber) throw Error('计算式不完整');
  while (operators.length) apply();
  return Number(values[0].toPrecision(12));
}
function calcOperandStart(expression) {
  let start = 0;
  for (let i = 0; i < expression.length; i++) {
    if ('+*/'.includes(expression[i]) || (expression[i] === '-' && i > 0 && !'+-*/'.includes(expression[i - 1]))) start = i + 1;
  }
  return start;
}
function calcRender() {
  calcEl('calcDisplay').value = calcExpr.replaceAll('*', '×').replaceAll('/', '÷').replaceAll('-', '−');
  calcEl('calcStatus').textContent = calcFinished ? '已计算' : '可用键盘输入';
  const preview = calcEl('calcPreview');
  if (calcFinished) {
    preview.textContent = calcLastExpression.replaceAll('*', '×').replaceAll('/', '÷').replaceAll('-', '−') + ' =';
    return;
  }
  try { preview.textContent = '结果 ' + calcFmt(calcEvaluate(calcExpr), 10); }
  catch (error) { preview.textContent = error.message === '不能除以 0' ? error.message : '继续输入数字'; }
}
function calcPress(key) {
  if (key === 'C') { calcExpr = '0'; calcFinished = false; calcLastExpression = ''; }
  else if (key === 'back') {
    calcExpr = calcExpr.length > 1 ? calcExpr.slice(0, -1) : '0';
    calcFinished = false;
  } else if (key === '=') {
    try {
      const value = calcEvaluate(calcExpr);
      calcLastExpression = calcExpr;
      calcExpr = String(value);
      calcFinished = true;
      calcHistory.unshift({ expression: calcLastExpression, result: calcExpr });
      calcHistory = calcHistory.slice(0, 10);
      calcRenderHistory();
    } catch (error) { toast(error.message); }
  } else if (key === '±' || key === '%') {
    const start = calcOperandStart(calcExpr);
    const operand = calcExpr.slice(start);
    if (!operand || operand === '-') return;
    if (key === '±') calcExpr = calcExpr.slice(0, start) + (operand.startsWith('-') ? operand.slice(1) : '-' + operand);
    else {
      const prefix = calcExpr.slice(0, start);
      const operator = prefix.at(-1);
      const base = operator === '+' || operator === '-' ? calcEvaluate(prefix.slice(0, -1)) : 1;
      calcExpr = prefix + String(Number((base * Number(operand) / 100).toPrecision(12)));
    }
    calcFinished = false;
  } else if ('+-*/'.includes(key)) {
    if (calcExpr === '0' && key === '-') calcExpr = '-';
    else if (calcExpr === '-') return;
    else if ('+-*/'.includes(calcExpr.at(-1))) calcExpr = calcExpr.slice(0, -1) + key;
    else calcExpr += key;
    calcFinished = false;
  } else if (/^\d$/.test(key) || key === '.') {
    if (calcFinished) { calcExpr = '0'; calcFinished = false; }
    const start = calcOperandStart(calcExpr), operand = calcExpr.slice(start);
    if (key === '.') {
      if (operand.includes('.')) return;
      calcExpr += operand === '' || operand === '-' ? '0.' : '.';
    } else if (operand === '0') calcExpr = calcExpr.slice(0, start) + key;
    else if (operand === '-0') calcExpr = calcExpr.slice(0, start) + '-' + key;
    else calcExpr += key;
  }
  calcRender();
}
function calcRenderHistory() {
  const box = calcEl('calcHistory');
  box.innerHTML = calcHistory.length ? calcHistory.map((item, index) =>
    `<button class="calc-history-item" data-history="${index}" title="使用此结果"><span>${item.expression.replaceAll('*', '×').replaceAll('/', '÷').replaceAll('-', '−')}</span><b>= ${item.result}</b></button>`).join('') : calcEmpty('还没有计算记录');
}
calcEl('calc-normal').querySelectorAll('.ck').forEach((button) => button.addEventListener('click', () => calcPress(button.dataset.k)));
calcEl('calcHistory').addEventListener('click', (event) => {
  const button = event.target.closest('[data-history]');
  if (!button) return;
  calcExpr = calcHistory[Number(button.dataset.history)].result;
  calcFinished = true;
  calcLastExpression = calcHistory[Number(button.dataset.history)].expression;
  calcRender();
});
calcEl('calcHistoryClear').addEventListener('click', () => { calcHistory = []; calcRenderHistory(); });
calcEl('calcCopy').addEventListener('click', () => {
  try { calcCopyText(String(calcEvaluate(calcExpr))); }
  catch (error) { toast(error.message); }
});
document.addEventListener('keydown', (event) => {
  if (!calcEl('view-calc').classList.contains('active') || !calcEl('calc-normal').classList.contains('active')) return;
  if ((event.target.id !== 'calcDisplay' && event.target.closest('input, textarea, select, [contenteditable="true"]')) || event.ctrlKey || event.metaKey || event.altKey) return;
  let key = event.key;
  if (key === 'Enter' || key === '=') key = '=';
  else if (key === 'Backspace') key = 'back';
  else if (key === 'Escape') key = 'C';
  else if (key === 'x' || key === 'X') key = '*';
  if (/^\d$/.test(key) || ['.', '+', '-', '*', '/', '%', '=', 'back', 'C'].includes(key)) {
    event.preventDefault(); calcPress(key);
  }
});
calcRender();
calcRenderHistory();

// ---------- CBM 体积 ----------
let cbmCopyValue = '';
function renderCbm() {
  const box = calcEl('cbmResult');
  const L = calcValue('cbmL'), W = calcValue('cbmW'), H = calcValue('cbmH'), quantity = calcValue('cbmQty', true);
  const weight = calcOptional('cbmWt');
  cbmCopyValue = '';
  calcEl('cbmCopy').disabled = true;
  if ([L, W, H, quantity].some((n) => n === null)) {
    box.innerHTML = calcEmpty('填写大于 0 的长、宽、高和整数件数，即可查看结果。'); return;
  }
  if (weight === null) { box.innerHTML = calcEmpty('单件毛重不能为负数。'); return; }
  const perCbm = L * W * H / 1000000, totalCbm = perCbm * quantity;
  const totalWeight = weight === undefined ? undefined : weight * quantity;
  if (!Number.isFinite(totalCbm) || !Number.isFinite(totalWeight ?? 0)) { box.innerHTML = calcEmpty('数值超出计算范围。'); return; }
  const suggestion = Object.values(CONTAINERS).find((c) => totalCbm <= c.l * c.w * c.h * CALC_PLAN_RATIO && (totalWeight === undefined || totalWeight <= c.load));
  box.innerHTML = `<div class="calc-result-hero"><span>总体积</span><strong>${calcFmt(totalCbm, 4)} <small>m³</small></strong><span>${quantity} 件货物</span></div>`
    + calcRow('单件体积', `${calcFmt(perCbm, 5)} m³`)
    + (totalWeight === undefined ? '' : calcRow('总毛重', `${calcFmt(totalWeight, 2)} kg`))
    + calcRow('容量参考', suggestion ? suggestion.name : '超出所列单柜规划容量', true, !suggestion)
    + '<p class="calc-note">箱型按内尺寸的 85% 规划容量和标称载重粗估。能否装入还取决于货物外形、摆放、门高及实际箱况。</p>'
    + '<button class="calc-link" id="cbmToContainer">用此结果估算装柜 →</button>';
  cbmCopyValue = `总体积 ${calcFmt(totalCbm, 4)} m³；单件 ${calcFmt(perCbm, 5)} m³` + (totalWeight === undefined ? '' : `；总毛重 ${calcFmt(totalWeight, 2)} kg`);
  calcEl('cbmCopy').disabled = false;
  calcEl('cbmToContainer').addEventListener('click', () => {
    calcEl('ctMode').value = 'cbm';
    updateContainerMode();
    calcEl('ctCBM').value = String(Number(totalCbm.toPrecision(12)));
    calcEl('ctWeight').value = totalWeight === undefined ? '' : String(Number(totalWeight.toPrecision(12)));
    selectCalcTab('container');
    renderContainer();
  });
}
['cbmL', 'cbmW', 'cbmH', 'cbmQty', 'cbmWt'].forEach((id) => calcEl(id).addEventListener('input', renderCbm));
calcEl('cbmCalc').addEventListener('click', renderCbm);
calcEl('cbmReset').addEventListener('click', () => {
  ['cbmL', 'cbmW', 'cbmH', 'cbmQty', 'cbmWt'].forEach((id) => { calcEl(id).value = ''; });
  renderCbm(); calcEl('cbmL').focus();
});
calcEl('cbmCopy').addEventListener('click', () => cbmCopyValue && calcCopyText(cbmCopyValue));
renderCbm();

// ---------- 装柜估算 ----------
let containerCopyValue = '';
function updateContainerMode() {
  const carton = calcEl('ctMode').value === 'carton';
  calcEl('ctCbmWrap').hidden = carton;
  calcEl('ctCartonWrap').hidden = !carton;
}
function maxGridCount(containerDims, cartonDims) {
  const [a, b, c] = cartonDims;
  const arrangements = [[a,b,c], [a,c,b], [b,a,c], [b,c,a], [c,a,b], [c,b,a]];
  return Math.max(...arrangements.map((dims) => dims.reduce((count, dim, index) => count * Math.floor((containerDims[index] + 1e-9) / dim), 1)));
}
function renderContainer() {
  const box = calcEl('ctResult'), ref = calcEl('ctRef');
  const l = calcValue('ctL'), w = calcValue('ctW'), h = calcValue('ctH'), load = calcOptional('ctLoad');
  containerCopyValue = '';
  calcEl('ctCopy').disabled = true;
  ref.innerHTML = '';
  if ([l, w, h].some((n) => n === null) || load === null || load === 0) {
    box.innerHTML = calcEmpty('请填写大于 0 的集装箱内长、宽、高；最大载重可留空。'); return;
  }
  const volume = l * w * h, planned = volume * CALC_PLAN_RATIO;
  const cartonMode = calcEl('ctMode').value === 'carton';
  let totalCbm, totalWeight, count, maxCartons;
  if (cartonMode) {
    const cl = calcValue('ctcL'), cw = calcValue('ctcW'), ch = calcValue('ctcH');
    count = calcValue('ctcN', true);
    const cartonWeight = calcOptional('ctcWt');
    if ([cl, cw, ch, count].some((n) => n === null)) {
      box.innerHTML = calcEmpty('填写大于 0 的箱长、箱宽、箱高和整数箱数，即可查看结果。'); return;
    }
    if (cartonWeight === null) { box.innerHTML = calcEmpty('单箱毛重不能为负数。'); return; }
    totalCbm = cl * cw * ch / 1000000 * count;
    totalWeight = cartonWeight === undefined ? undefined : cartonWeight * count;
    const gridCount = maxGridCount([l, w, h], [cl / 100, cw / 100, ch / 100]);
    const weightCount = load !== undefined && cartonWeight > 0 ? Math.floor(load / cartonWeight) : Infinity;
    maxCartons = Math.min(gridCount, weightCount);
  } else {
    totalCbm = calcValue('ctCBM');
    totalWeight = calcOptional('ctWeight');
    if (totalCbm === null) { box.innerHTML = calcEmpty('填写大于 0 的货物总体积，即可查看结果。'); return; }
    if (totalWeight === null) { box.innerHTML = calcEmpty('总毛重不能为负数。'); return; }
  }
  if (![volume, totalCbm, totalWeight ?? 0, maxCartons ?? 0].every(Number.isFinite)) {
    box.innerHTML = calcEmpty('数值超出计算范围。'); return;
  }
  const volumeRate = totalCbm / volume * 100;
  const weightRate = load !== undefined && totalWeight !== undefined && load > 0 ? totalWeight / load * 100 : undefined;
  const overVolume = volumeRate > 100, overWeight = weightRate !== undefined && weightRate > 100;
  const overCount = cartonMode && count > maxCartons;
  const status = overVolume || overWeight || overCount ? '超出当前箱型估算范围' : volumeRate > CALC_PLAN_RATIO * 100 ? '超过 85% 规划容量，请核实装载' : '在规划容量内';
  box.innerHTML = `<div class="calc-result-hero ${overVolume || overWeight || overCount ? 'is-warning' : ''}"><span>估算状态</span><strong>${status}</strong><span>${calcEl('ctType').selectedOptions[0].textContent.trim()}</span></div>`
    + calcRow('集装箱内体积', `${calcFmt(volume, 2)} m³`)
    + calcRow('85% 规划容量', `${calcFmt(planned, 2)} m³`)
    + calcRow('货物总体积', `${calcFmt(totalCbm, 3)} m³`, true)
    + calcRow('体积占比', `${calcFmt(volumeRate, 1)}%`, false, overVolume)
    + (totalWeight === undefined ? '' : calcRow('货物总毛重', `${calcFmt(totalWeight, 2)} kg`))
    + (weightRate === undefined ? '' : calcRow('载重占比', `${calcFmt(weightRate, 1)}%`, false, overWeight))
    + (cartonMode ? calcRow('整齐排放上限', `${calcFmt(maxCartons, 0)} 箱`, true, overCount) : '')
    + (cartonMode ? calcRow('计划箱数', `${calcFmt(count, 0)} 箱`) : '');
  ref.innerHTML = `<p class="calc-note">${cartonMode ? '箱数按单一摆放方向的长宽高整齐排列，并取 6 种方向中的最大值；载重有填写时取更小上限。' : '仅按总体积和载重估算，无法判断单件尺寸是否能穿过柜门或实际堆放。'} 门高、装卸空间、托盘及货物限制需现场核实。</p>`;
  containerCopyValue = `${status}；集装箱 ${calcFmt(volume, 2)} m³；货物 ${calcFmt(totalCbm, 3)} m³；体积占比 ${calcFmt(volumeRate, 1)}%`
    + (totalWeight === undefined ? '' : `；总毛重 ${calcFmt(totalWeight, 2)} kg`)
    + (cartonMode ? `；整齐排放上限 ${calcFmt(maxCartons, 0)} 箱` : '');
  calcEl('ctCopy').disabled = false;
}
calcEl('ctType').addEventListener('change', () => {
  const c = CONTAINERS[calcEl('ctType').value];
  if (c) {
    calcEl('ctL').value = c.l; calcEl('ctW').value = c.w;
    calcEl('ctH').value = c.h; calcEl('ctLoad').value = c.load;
  }
  renderContainer();
});
calcEl('ctMode').addEventListener('change', () => { updateContainerMode(); renderContainer(); });
['ctL', 'ctW', 'ctH', 'ctLoad', 'ctCBM', 'ctWeight', 'ctcL', 'ctcW', 'ctcH', 'ctcN', 'ctcWt'].forEach((id) =>
  calcEl(id).addEventListener('input', () => {
    if (['ctL', 'ctW', 'ctH', 'ctLoad'].includes(id)) calcEl('ctType').value = 'custom';
    renderContainer();
  }));
calcEl('ctCalc').addEventListener('click', renderContainer);
calcEl('ctReset').addEventListener('click', () => {
  ['ctCBM', 'ctWeight', 'ctcL', 'ctcW', 'ctcH', 'ctcN', 'ctcWt'].forEach((id) => { calcEl(id).value = ''; });
  renderContainer();
  calcEl(calcEl('ctMode').value === 'carton' ? 'ctcL' : 'ctCBM').focus();
});
calcEl('ctCopy').addEventListener('click', () => containerCopyValue && calcCopyText(containerCopyValue));
updateContainerMode();
renderContainer();
