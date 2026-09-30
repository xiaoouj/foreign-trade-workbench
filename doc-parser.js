// ============================================================================
// doc-parser.js —— 文档解析模块（替换原手写实现）
// 支持：PDF / Word(.docx) / Excel(.xlsx, .xls) / TXT / CSV
// 依赖：mammoth, xlsx, pdf-parse@2.x
// ============================================================================
import mammoth from 'mammoth';
import XLSX from 'xlsx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MAX_CHARS = 200000;

function clip(s) {
  const t = String(s || '').trim();
  return t.length > MAX_CHARS
    ? t.slice(0, MAX_CHARS) + '\n…（内容过长，已截断）'
    : t;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// ---------- Word ----------
export async function parseDocx(buf) {
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  const text = decodeEntities(
    html
      .replace(/<\/(p|h[1-6]|tr|div|li)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '\t')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clip(text);
}

// ---------- Excel ----------
export function parseXlsx(buf) {
  const wb = XLSX.read(buf, {
    type: 'buffer',
    cellDates: false,
    cellText: false,
    cellFormula: false,
    cellNF: true,
  });
  const p = (n) => String(n).padStart(2, '0');
  // Excel 序列号 → YYYY-MM-DD（避开时区问题）
  function serialToDate(n) {
    const ms = Math.round((n - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  function isDateFormat(fmt) {
    if (!fmt) return false;
    const f = String(fmt).toLowerCase();
    return /(^|[^\\])[ymdhs]/.test(f) && !/^[#0.,%\s]+$/.test(f);
  }
  const out = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell) { cells.push(''); continue; }
        let v = cell.v;
        if (typeof v === 'number' && isDateFormat(cell.z) && v > 1 && v < 2958466) {
          v = serialToDate(v);
        } else if (v == null) {
          v = '';
        } else {
          v = String(v).replace(/[\t\n\r]/g, ' ');
        }
        cells.push(v);
      }
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      if (cells.some((x) => x !== '')) rows.push(cells.join('\t'));
    }
    if (rows.length) {
      if (out.length) out.push('');
      out.push('【工作表：' + name + '】');
      out.push(rows.join('\n'));
    }
  }
  return clip(out.join('\n'));
}

// ---------- PDF ----------
// PDF content streams follow drawing order; reconstruct rows from page coordinates.
export function positionedPdfText(items, viewport) {
  const cells = items.filter(item => typeof item.str === 'string' && item.str.trim()).map(item => {
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    return {x, y, width:item.width || 0, text:item.str};
  }).sort((a,b) => a.y-b.y || a.x-b.x);
  const rows=[];
  for(const cell of cells){
    let row=rows[rows.length-1];
    if(!row || Math.abs(row.y-cell.y)>2){row={y:cell.y,cells:[]};rows.push(row);}
    row.cells.push(cell);
  }
  const lines = rows.map(row=>{
    row.cells.sort((a,b)=>a.x-b.x);
    return row.cells.map((cell,i)=>{
      if(!i)return cell.text;
      const prev=row.cells[i-1],gap=cell.x-prev.x-prev.width;
      return (gap>8?'\t':gap>1?' ':'')+cell.text;
    }).join('');
  });
  // Repeat unambiguous amount rows as labeled cells so merged descriptions cannot
  // swallow the quantity/price. Only emit when all three printed values reconcile.
  const amountRows=[];
  let ambiguousAmounts=false;
  for(let i=0;i<lines.length;i++){
    const match=lines[i].match(/(?:^|\t)([\d,]+(?:\.\d+)?)\t((?:US\$|USD|EUR|CNY|RMB|[$€¥￥])\s*[\d,]+(?:\.\d+)?)\t((?:US\$|USD|EUR|CNY|RMB|[$€¥￥])\s*[\d,]+(?:\.\d+)?)$/i);
    if(!match)continue;
    const number=v=>Number(v.replace(/[^\d.]/g,''));
    if(Math.abs(number(match[1])*number(match[2])-number(match[3]))>0.011){ambiguousAmounts=true;continue;}
    amountRows.push({index:i,y:rows[i].y,qty:match[1],price:match[2],amount:match[3]});
  }
  const header=lines.findIndex(line=>/\bQty\b|数量/i.test(line) && /unit price|单价/i.test(line));
  if(!ambiguousAmounts && amountRows.length>=2 && header>=0 && header<amountRows[0].index){
    const last=amountRows[amountRows.length-1];
    const totalIndex=lines.findIndex((line,i)=>i>last.index && /total amount|grand total|总金额|合计/i.test(line));
    const intermediateTotal=lines.some((line,i)=>i>header&&i<last.index&&/total amount|grand total|总金额|合计/i.test(line));
    if(totalIndex>last.index && !intermediateTotal){
      // Midpoints of printed amount rows group vertically merged descriptions.
      // Keep headers, totals and terms outside the product blocks.
      const blocks=amountRows.map((anchor,i)=>{
        const top=i?(amountRows[i-1].y+anchor.y)/2:rows[header].y+5;
        const bottom=i+1<amountRows.length?(anchor.y+amountRows[i+1].y)/2:rows[totalIndex].y;
        const description=lines.filter((line,j)=>rows[j].y>top && rows[j].y<bottom).join(' / ');
        const headerCells=rows[header].cells;
        const modelColumn=headerCells.findIndex(cell=>/^model$|^型号$/i.test(cell.text.trim()));
        let model='';
        if(modelColumn>0 && modelColumn<headerCells.length-1){
          const center=cell=>cell.x+cell.width/2;
          const left=(center(headerCells[modelColumn-1])+center(headerCells[modelColumn]))/2;
          const right=(center(headerCells[modelColumn])+center(headerCells[modelColumn+1]))/2;
          model=rows.filter(row=>row.y>top&&row.y<bottom).flatMap(row=>row.cells.filter(cell=>cell.x>=left&&(cell.x<right || (cell.x<right+12&&/^[)）]$/.test(cell.text)))).map(cell=>cell.text)).join(' ');
        }
        return '【报价明细行 '+(i+1)+'】\n'+(model?'型号/品名（原文）：'+model+'\n':'')+'原文名称及规格：'+description+'\n数量：'+anchor.qty+'；单价：'+anchor.price+'；行金额：'+anchor.amount+'\n【该明细行结束】';
      });
      return [...lines.slice(0,header+1),...blocks,...lines.slice(totalIndex)].join('\n');
    }
  }
  return lines.join('\n');
}
export async function parsePdf(buf) {
  const task=getDocument({data:new Uint8Array(buf),isEvalSupported:false});
  try {
    const pdf=await task.promise, pages=[];
    for(let n=1;n<=pdf.numPages;n++){
      const page=await pdf.getPage(n);
      const content=await page.getTextContent();
      const text=positionedPdfText(content.items,page.getViewport({scale:1}));
      if(text.trim())pages.push('【第 '+n+' 页】\n'+text);
      page.cleanup();
    }
    return clip(pages.join('\n\n'));
  } finally { await task.destroy(); }
}

// ---------- 统一入口（异步） ----------
export async function parseDocument(ext, buf) {
  const e = String(ext || '').toLowerCase();
  if (e === '.txt' || e === '.csv') {
    return clip(buf.toString('utf8').replace(/^\uFEFF/, ''));
  }
  if (e === '.docx') return await parseDocx(buf);
  if (e === '.xlsx' || e === '.xls') return await parseXlsx(buf);
  if (e === '.pdf') return await parsePdf(buf);
  if (e === '.doc') throw new Error('旧版 .doc 不支持，请另存为 .docx');
  throw new Error('仅支持 PDF / Word / Excel / TXT / CSV');
}
