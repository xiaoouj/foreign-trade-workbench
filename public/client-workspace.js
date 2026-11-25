
// Live adapter around the supplied clients.html rendering functions.
let clientPage=1,clientPageRows=[],clientPageSize=20;
(function(){
 var mounted=false,draw=null,loadState='pending';
 window.crmClientRender=function(){if(draw)draw()};
 window.ftwClientFeedback=function(state){loadState=state;if(draw)draw()};
 document.addEventListener('DOMContentLoaded',function(){
 var CP=window.CRMPrototype,root=document.getElementById('crm-clients'),idmap={"fmoreBtn": "clp-fmoreBtn", "scope": "clp-scope", "kpis": "clp-kpis", "bX": "clp-bX", "moreBtn": "clp-moreBtn", "drTitle": "clp-drTitle", "count": "clp-count", "viewSeg": "clp-viewSeg", "fK": "clp-fK", "note": "clp-note", "body": "clp-body", "fbar": "clp-fbar", "fpanel": "clp-fpanel", "drawer": "clp-drawer", "page": "clp-page", "addBtn": "clientAdd", "fmoreInfo": "clp-fmoreInfo", "q": "clientSearch", "reset": "clp-reset", "qWrap": "clp-qWrap", "pager": "clp-pager", "lstTitle": "clp-lstTitle", "batch": "clp-batch", "ckAll": "clp-ckAll", "fLv": "clp-fLv", "fSrc": "clp-fSrc", "moreMenu": "clp-moreMenu", "bN": "clp-bN", "saveNote": "clp-saveNote", "lstSub": "clp-lstSub", "sortSel": "clp-sortSel", "headSub": "clp-headSub", "fPh": "clp-fPh", "drX": "clp-drX", "fOwner": "clp-fOwner", "fmore": "clp-fmore", "drBg": "clp-drBg", "per": "clp-per"};
 if(!root)return;
 var esc=CP.h,ic=CP.ic,fmtW=CP.fmtW,pct=CP.pct,ftwToast=function(m){toast(m)},ftwPlace=CP.place;
 function selector(s){return s.replace(/#([a-zA-Z][a-zA-Z0-9_-]*)/g,function(_,id){return '#'+(idmap[id]||id)})}

  var D={},TODAY=CP.today(),ME='',CL=[],account='',drafts=new Map(),starBusy=new Set(),noteBusy=false;
  var $=function(s,r){return (r||root).querySelector(selector(s))}, $$=function(s,r){return Array.prototype.slice.call((r||root).querySelectorAll(selector(s)))};
  function dd(a,b){return Math.round((new Date(b)-new Date(a))/864e5)}
  var OWN={'管理员':'o3'};
  function own(o){return o?'<span class="own"><i class="'+(OWN[o]||'o0')+'" aria-hidden="true">'+esc(o.slice(0,1).toUpperCase())+'</i>'+esc(o)+'</span>':'<span class="dim">未分配</span>'}
  var PH={'线索':'t-plain','初步接触':'t-new','报价中':'t-quote','谈判':'t-neg','成交':'t-won'};
  function phTag(p){return !p||p==='未补充'?'<span class="dim" style="font-size:12.5px">未补充</span>':'<span class="tag '+(PH[p]||'t-plain')+'">'+esc(p)+'</span>'}
  function lvOf(c){return c.lv||(/^[SABC]$/.test(c.st)?c.st:'')}
  function lvTag(l){return l?'<span class="lv '+esc(l.toLowerCase().replace('+',''))+'">'+esc(l)+'</span>':'<span class="dim">—</span>'}
  function avNum(s){var n=parseFloat(String(s).replace(/[^\d.]/g,''));return isNaN(n)?0:n}

  function byId(id){return CL.find(c=>c.i===String(id))}
  function refreshData(){
    TODAY=CP.today();ME=currentUser?.id||'';
    if(account!==ME){if(window.__crmCoreDataOwner!==ME&&(account||loadState!=='error'))loadState='pending';account=ME;st.sel={};st.scope='all';st.qf=st.q=st.owner=st.ph=st.lv=st.k=st.src='';st.page=1;drafts.clear();closeDr();dr.replaceChildren();var prefs={};try{prefs=JSON.parse(localStorage.getItem('ftw.crm.clients.'+ME)||'{}')}catch{}st.per=[20,50,100].includes(prefs.per)?prefs.per:20;st.view=['table','card'].includes(prefs.view)?prefs.view:'table';$('#q').value='';}
    CL=CP.allClients().map(CP.clientDTO);D.iq=CP.allInquiries();
    if(typeof clientFollowFilter!=='undefined'&&clientFollowFilter){st.qf='late';st.scope='all';clientFollowFilter=false;}
    for(var id of Object.keys(st.sel))if(!byId(id))delete st.sel[id];
    refreshOptions();
    var sum=CL.reduce((n,c)=>n+c.avn,0),missing=CL.reduce((n,c)=>n+c.annualMissing,0),won=CL.filter(c=>c.hasOrder).length;
    $('#headSub').innerHTML='<b>'+CL.length+'</b> 个客户 · 成交客户 <b>'+won+'</b> 家 · 年度成交额 <b>'+fmtW(sum)+'</b> 元'+(missing?' · '+missing+' 笔金额待折算':'');
    if(loadState==='pending'&&!CL.length)$('#headSub').textContent='正在加载客户资料…';
  }
  function savePrefs(){try{localStorage.setItem('ftw.crm.clients.'+ME,JSON.stringify({per:st.per,view:st.view}))}catch{}}
  var st={scope:'all',qf:'',q:'',owner:'',ph:'',lv:'',k:'',src:'',sort:'cr:desc',page:1,per:20,view:'table',sel:{},state:'ok'};
  var mq=matchMedia('(max-width:820px)');

  // header & static buttons
  var sumAv=CL.reduce(function(s,c){return s+c.avn},0), won=CL.filter(function(c){return c.ph==='成交'}).length;

  $('[data-crm-action="导入客户"]').innerHTML=ic('download')+'<span class="lbl2">导入</span>';
  $('#moreBtn').insertAdjacentHTML('afterbegin',ic('more'));
  $('#addBtn').innerHTML=ic('plus')+'新增客户';
  $('[data-v="table"]',$('#viewSeg')).innerHTML=ic('rows','width:15px;height:15px');
  $('[data-v="card"]',$('#viewSeg')).innerHTML=ic('grid','width:15px;height:15px');
  $('#bX').innerHTML=ic('x');

  // KPIs = 快捷筛选
  var KP=[
    ['','全部客户',function(){return true},function(n){return '本月新增 <b>'+CL.filter(function(c){return c.cr>=(TODAY.slice(0,7)+'-01')&&c.cr<=TODAY}).length+'</b> 个'}],
    ['late','跟进已到期',function(c){return c.late},function(n){return n?'最早一笔已拖 <b>'+Math.max.apply(null,CL.filter(function(c){return c.late}).map(function(c){return dd(c.nf,TODAY)}))+'</b> 天':'暂无到期的跟进计划'},true],
    ['act','有在途询盘',function(c){return c.act>0},function(){var n=CL.filter(function(c){return c.act>1}).length;return '其中 <b>'+n+'</b> 家有多条在谈'}],
    ['stale','超 30 天未联系',function(c){return c.stale},function(n){return '占全部客户 <b>'+pct(n,CL.length,0)+'</b>'}],
    ['newc','近 30 天新增',function(c){return c.newc},function(){return '来自阿里巴巴 <b>'+CL.filter(function(c){return c.newc&&c.src==='阿里巴巴'}).length+'</b> 个'}]
  ];
  function renderKpis(){
    $('#kpis').innerHTML=KP.map(function(k){var n=CL.filter(k[2]).length;
      return '<button class="kpi'+(k[4]?' alert':'')+'" data-qf="'+k[0]+'" aria-pressed="'+(st.qf===k[0])+'"><span class="k">'+k[1]+'</span><span class="v'+(k[4]?' warn':'')+'">'+n+'<small>个</small></span><span class="d">'+k[3](n)+'</span></button>'}).join('');
  }

  function opts(id,label,vals){var el=$('#'+id);el.innerHTML='<option value="">'+label+'</option>'+vals.map(v=>'<option value="'+esc(v[0])+'">'+esc(v[1])+'</option>').join('')}
  function pairs(field){var map=new Map();CL.forEach(c=>{var v=c[field]||'未填写';map.set(v,(map.get(v)||0)+1)});return [...map].sort((a,b)=>b[1]-a[1]);}
  function refreshOptions(){
    opts('fOwner','全部负责人',pairs('oid').map(([id,n])=>[id,(CL.find(c=>c.oid===id)?.o||'未分配')+'（'+n+'）']));
    opts('fPh','全部阶段',pairs('ph').map(([x,n])=>[x,x+'（'+n+'）']));
    opts('fLv','全部级别',[...new Set(CL.map(c=>c.lvl||'—'))].sort().map(x=>[x,x==='—'?'未分级':x+' 级']));
    opts('fK','全部国家',pairs('k').map(([x,n])=>[x,x+'（'+n+'）']));opts('fSrc','全部来源',pairs('src').map(([x,n])=>[x,x+'（'+n+'）']));
  }
  function filtered(){
    var q=st.q.trim().toLowerCase(), kf=KP.filter(function(k){return k[0]===st.qf})[0];
    var L=CL.filter(function(c){
      if(st.scope==='mine'&&c.oid!==ME)return false;
      if(st.scope==='star'&&!c.star)return false;
      if(kf&&!kf[2](c))return false;
      if(st.owner&&c.oid!==st.owner)return false;
      if(st.ph&&c.ph!==st.ph)return false;
      if(st.lv&&(c.lvl||'—')!==st.lv)return false;
      if(st.k&&(c.k||'未填写')!==st.k)return false;
      if(st.src&&(c.src||'未填写')!==st.src)return false;
      if(q&&[c.n,c.ct,c.k,c.buy,c.biz].concat(c.iqs.map(function(x){return x.p})).join(' ').toLowerCase().indexOf(q)<0)return false;
      return true});
    var s=st.sort.split(':'),key=s[0],dir=s[1]==='desc'?-1:1;
    L.sort(function(a,b){var x,y;
      if(key==='av'){x=a.avn;y=b.avn}else if(key==='n'){return a.n.localeCompare(b.n)*dir}
      else{x=a[key]||(dir>0?'9999':'');y=b[key]||(dir>0?'9999':'')}
      return x<y?-dir:x>y?dir:0});
    return L;
  }

  function lastCell(c){if(!c.lf)return '<span class="dim">无记录</span>';var n=dd(c.lf,TODAY);return '<span class="dt'+(n>30?' soon':'')+'">'+c.lf.slice(5)+'<small>'+(n<=0?'今天':n+' 天前')+'</small></span>'}
  function nextCell(c){if(!c.nf)return '<span class="dim">未安排</span>';var n=dd(TODAY,c.nf);return '<span class="dt'+(n<0?' late':n===0?' soon':'')+'">'+c.nf.slice(5)+'<small>'+(n<0?'逾期 '+(-n)+' 天':n===0?'今天':n+' 天后')+'</small></span>'}
  function actCell(c){return c.act?'<span class="chip on">'+ic('inbox')+c.act+' 条在谈</span>':'<span class="dim">—</span>'}
  function starBtn(c){return '<button class="starb" data-star="'+c.i+'" aria-pressed="'+c.star+'" aria-label="'+(c.star?'取消星标':'设为星标')+'：'+esc(c.n)+'">'+ic('star','width:16px;height:16px')+'</button>'}
  function avCell(c){return c.avn?'<span class="dt">¥'+Math.round(c.avn).toLocaleString('zh-CN')+'</span>':'<span class="dim">—</span>'}

  function render(){
    refreshData();st.state=loadState==='error'&&!CL.length?'error':(loadState==='pending'||window.__crmCoreDataOwner!==ME)&&!CL.length?'loading':'ok';
    renderKpis();
    var dirty=st.qf||st.q||st.owner||st.ph||st.lv||st.k||st.src||st.scope!=='all';
    $('#fbar').classList.toggle('dirty',!!dirty);
    $('#qWrap').classList.toggle('has',!!st.q);
    ['owner','ph','lv','k','src'].forEach(function(k){var el=$('#f'+{owner:'Owner',ph:'Ph',lv:'Lv',k:'K',src:'Src'}[k]);el.value=st[k];el.classList.toggle('on',!!st[k])});
    var moreN=['ph','lv','k','src'].filter(function(k){return !!st[k]}).length;
    $('#fmoreBtn').classList.toggle('on',moreN>0);
    $('#fmoreBtn').innerHTML='更多筛选'+(moreN?'<span class="n">'+moreN+'</span>':'');
    $('#fmoreBtn').setAttribute('aria-expanded',$('#fmore').classList.contains('open'));
    $('#fmoreInfo').textContent=moreN?('已应用 '+moreN+' 个筛选条件'):'未使用更多筛选';
    $$('#scope button').forEach(function(b){b.setAttribute('aria-selected',b.dataset.v===st.scope)});
    var view=mq.matches?'card':st.view;
    $$('#viewSeg button').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.v===view)});
    var body=$('#body'),pg=$('#pager');var notice=$('#clientNotice');if(!notice){notice=document.createElement('div');notice.id='clientNotice';notice.className='crm-notice';body.before(notice);}notice.hidden=!(loadState==='error'&&CL.length);notice.innerHTML='更新失败，当前保留上次加载的客户。<button type="button" data-retry>重新加载</button>';
    if(st.state==='loading'){$('#count').innerHTML='加载中…';$('#lstSub').textContent='';
      body.innerHTML='<div class="tbl-wrap"><table class="tbl"><tbody>'+Array(8).join('<tr class="sk-row"><td style="width:40px"><span class="sk" style="width:16px;height:16px"></span></td><td><span class="sk" style="width:220px;height:13px"></span><span class="sk" style="width:140px;height:10px;margin-top:6px"></span></td><td><span class="sk" style="width:60px;height:18px;border-radius:9px"></span></td><td><span class="sk" style="width:80px;height:13px"></span></td><td><span class="sk" style="width:70px;height:13px"></span></td><td><span class="sk" style="width:90px;height:13px"></span></td></tr>')+'</tbody></table></div>';pg.innerHTML='';return}
    if(st.state==='error'){$('#count').innerHTML='';$('#lstSub').textContent='';
      body.innerHTML='<div class="err" role="alert">'+ic('alert')+'<h3>客户列表没有加载出来</h3><p>暂时无法连接客户资料，请重新加载。</p><button class="btn" data-retry>'+ic('refresh')+'重新加载</button></div>';pg.innerHTML='';return}
    var L=filtered(),pages=Math.max(1,Math.ceil(L.length/st.per));if(st.page>pages)st.page=pages;
    var rows=L.slice((st.page-1)*st.per,st.page*st.per);
    $('#count').innerHTML='筛选结果 <b>'+L.length+'</b> / '+CL.length;
    var kf=KP.filter(function(k){return k[0]===st.qf})[0];
    $('#lstTitle').textContent=kf&&kf[0]?kf[1]:st.scope==='mine'?'我负责的客户':st.scope==='star'?'星标客户':'客户列表';
    $('#lstSub').textContent=L.length+' 个';
    if(!L.length){body.innerHTML='<div class="empty">'+ic(st.scope==='star'?'star':'search')+'<h3>'+(st.scope==='star'&&!st.q?'还没有星标客户':'没有符合条件的客户')+'</h3><p>'+(st.scope==='star'?'在列表里点客户名前的星标，重点客户就会集中到这里。':'换个关键词，或者放宽筛选条件。')+'</p>'+(dirty?'<button class="btn" data-reset>清空筛选</button>':'')+'</div>';pg.innerHTML='';return}
    if(view==='card'){
      body.innerHTML='<div class="cards">'+rows.map(function(c){return '<div class="ccard'+(st.sel[c.i]?' sel':'')+'" role="button" tabindex="0" data-open="'+c.i+'"><div class="t"><input type="checkbox" class="crm-card-check" data-ck="'+esc(c.i)+'" aria-label="选择 '+esc(c.n)+'" '+(st.sel[c.i]?'checked':'')+'>'+starBtn(c)+'<div class="who"><b>'+esc(c.n)+'</b><span>'+esc([c.k,c.ct].filter(Boolean).join(' · ')||'—')+'</span></div>'+lvTag(c.lvl)+'</div><div class="m">'+phTag(c.ph)+(c.act?actCell(c):'')+(c.avn?'<span class="chip">¥'+fmtW(c.avn)+'</span>':'')+'</div><div class="f">'+own(c.o)+(c.nf?'<span class="'+(c.late?'late':'')+'">'+(c.late?'跟进逾期 '+dd(c.nf,TODAY)+' 天':'下次跟进 '+c.nf.slice(5))+'</span>':'<span>未安排跟进</span>')+'</div></div>'}).join('')+'</div>';
    }else{
      var allOn=rows.every(function(c){return st.sel[c.i]});
      var sk=st.sort.split(':');function th(k,l,cls){var on=sk[0]===k;return '<th data-sort="'+k+'" class="'+(cls||'')+'"'+(on?' aria-sort="'+(sk[1]==='asc'?'ascending':'descending')+'"':'')+'><button data-sort="'+k+'">'+l+ic('sort')+'</button></th>'}
      body.innerHTML='<div class="tbl-wrap"><table class="tbl data-table cl-table crm-client-table"><thead><tr><th class="ck"><input type="checkbox" id="clp-ckAll" aria-label="选择本页" '+(allOn?'checked':'')+'></th><th style="width:36px"><span class="sr">星标</span></th>'+th('n','客户')+'<th>阶段</th><th class="c-lv">级别</th><th>负责人</th><th>在途询盘</th>'+th('lf','最近联系')+th('nf','下次跟进')+th('av','年度成交额','r')+th('cr','创建','c-cr')+'<th style="width:44px"><span class="sr">操作</span></th></tr></thead><tbody id="clientBody">'+
        rows.map(function(c){return '<tr data-open="'+c.i+'" class="'+(st.sel[c.i]?'sel':'')+'"><td class="ck"><input type="checkbox" data-ck="'+c.i+'" aria-label="选择 '+esc(c.n)+'" '+(st.sel[c.i]?'checked':'')+'></td><td style="padding:0 0 0 4px">'+starBtn(c)+'</td><td><div class="who"><b>'+esc(c.n)+'</b><span>'+esc([c.k,c.ct].filter(Boolean).join(' · ')||'—')+'</span></div></td><td>'+phTag(c.ph)+'</td><td class="c-lv">'+lvTag(c.lvl)+'</td><td>'+own(c.o)+'</td><td>'+actCell(c)+'</td><td>'+lastCell(c)+'</td><td>'+nextCell(c)+'</td><td class="r">'+avCell(c)+'</td><td class="c-cr"><span class="dt" style="color:var(--muted)">'+esc(c.cr)+'</span></td><td><button class="rowact" data-open="'+c.i+'" aria-label="查看 '+esc(c.n)+'">'+ic('arrow','width:16px;height:16px')+'</button></td></tr>'}).join('')+'</tbody></table></div>';
    }
    var nums=[];for(var i=1;i<=pages;i++){if(i===1||i===pages||Math.abs(i-st.page)<=1)nums.push(i);else if(nums[nums.length-1]!=='…')nums.push('…')}
    pg.innerHTML='<span>第 <b class="num">'+((st.page-1)*st.per+1)+'–'+Math.min(L.length,st.page*st.per)+'</b> 个，共 '+L.length+' 个</span><span class="sp"></span><div class="sel"><label class="sr" for="clp-per">每页</label><select data-no-combo id="clp-per">'+[20,50,100].map(function(n){return '<option value="'+n+'"'+(n===st.per?' selected':'')+'>每页 '+n+' 个</option>'}).join('')+'</select><svg class="i"><use href="#crmi-chev"/></svg></div><div class="pg"><button data-pg="'+(st.page-1)+'" '+(st.page<=1?'disabled':'')+' aria-label="上一页">‹</button>'+nums.map(function(n){return n==='…'?'<span style="padding:0 4px">…</span>':'<button data-pg="'+n+'"'+(n===st.page?' aria-current="page"':'')+'>'+n+'</button>'}).join('')+'<button data-pg="'+(st.page+1)+'" '+(st.page>=pages?'disabled':'')+' aria-label="下一页">›</button></div>';
    renderBatch();
  }
  function positionBatch(){var b=$('#batch'),r=root.getBoundingClientRect();b.style.left=Math.max(b.offsetWidth/2+14,Math.min(innerWidth-b.offsetWidth/2-14,r.left+r.width/2))+'px';}
  function renderBatch(){clientSelected.clear();Object.keys(st.sel).forEach(id=>clientSelected.add(id));var n=Object.keys(st.sel).length;$('#bN').textContent=n;$('#batch').classList.toggle('show',n>0);positionBatch()}

  // drawer
  var dr=$('#drawer'),drBg=$('#drBg'),opener=null,curC=null;
  var STG={'新询盘':'t-new','已报价':'t-quote','等回复':'t-wait','谈判中':'t-neg','成交':'t-won','暂缓':'t-lost','无效':'t-lost'};
  var followBusy=new Set();dr.inert=true;
  function openDr(c,keep){
    if(!c)return;if(!keep)opener=document.activeElement;curC=c;
    var scroll=$('.dr-b',dr)?.scrollTop||0,raw=c.raw,draft=drafts.get(c.i)||{content:'',date:c.nf&&c.nf>TODAY?c.nf:CP.addDays(TODAY,Math.max(1,Math.min(365,parseInt(c.freq,10)||7)))};
    drafts.set(c.i,draft);
    var timeline=[];
    if(c.nf)timeline.push({date:c.nf,text:c.late?'计划跟进 · 已到期':'计划跟进',cls:c.late?'late':'next',at:Date.parse(c.nf+'T23:59:59Z')});
    for(var entry of CP.logs(raw.followLog))timeline.push({date:CP.day(entry.at),text:entry.content,actor:entry.by||'',at:Number(entry.at)||0});
    for(var q of CP.allInquiries().filter(q=>CP.matches(raw,q)))timeline.push({date:CP.day(q.receivedAt||q.createdAt),text:'收到询盘：'+(q.product||'未说明产品'),at:Date.parse(CP.day(q.receivedAt||q.createdAt))||0});
    for(var m of CP.allComms().filter(m=>CP.matches(raw,m)))timeline.push({date:CP.day(m.date||m.createdAt),text:m.content||'沟通记录',actor:m.ownerName||'',at:Date.parse(CP.day(m.date||m.createdAt))||0});
    timeline.sort((a,b)=>b.at-a.at);if(c.cr)timeline.push({date:c.cr,text:'建档 · 来源 '+(c.src||'未填写')});
    function kv(label,value,cls){return '<div class="'+(cls||'')+'"><dt>'+label+'</dt><dd>'+(value?esc(value):'<span class="dim">未填写</span>')+'</dd></div>'}
    var phone=c.ph2?(revealedPhones.has(c.i)?esc(c.ph2):esc(maskPhone(c.ph2))):'<span class="dim">未填写</span>';
    dr.innerHTML='<div class="dr-h"><button class="btn btn-ghost icon-btn x" id="clp-drX" aria-label="关闭">'+ic('x')+'</button><div class="eb">'+phTag(c.ph)+lvTag(c.lvl)+(c.typ?'<span class="tag t-plain">'+esc(c.typ)+'</span>':'')+(c.star?ic('star','width:15px;height:15px;color:#E0A400;fill:#FFD43B'):'')+'</div><h2 id="clp-drTitle">'+esc(c.n)+'</h2><div class="sub">'+esc([c.k,c.ct].filter(Boolean).join(' · ')||'—')+'</div><div class="dr-acts"><button class="btn btn-pri" data-focus-note>'+ic('pen')+'写跟进</button><button class="btn" data-crm-action="新增询盘">'+ic('inbox')+'新增询盘</button><button class="btn" data-crm-action="新建报价">'+ic('file')+'新建报价</button><button class="btn" data-crm-action="WhatsApp">'+ic('chat')+'WhatsApp</button><button class="btn" data-crm-action="编辑客户">编辑</button></div></div><div class="dr-b"><section class="dr-sec"><h3>联系与归属</h3><dl class="kv">'+kv('联系人',c.ct)+'<div><dt>电话</dt><dd class="num">'+phone+(c.ph2?' <button class="link" data-reveal-phone>'+ (revealedPhones.has(c.i)?'隐藏':'显示')+'</button>':'')+'</dd></div>'+kv('邮箱',c.em)+kv('国家 / 地区',[c.k,c.reg].filter(Boolean).join(' · '))+kv('来源',c.src)+'<div><dt>负责人</dt><dd>'+own(c.o)+'</dd></div>'+kv('跟进频率',c.freq)+'</dl></section><section class="dr-sec"><h3>在谈询盘<span class="n">'+c.iqs.length+'</span><button class="link" data-client-inquiries>去询盘 / 商机</button></h3>'+(c.iqs.length?'<div class="mini">'+c.iqs.map(q=>'<button type="button" data-open-inquiry="'+esc(q.i)+'"><b>'+esc(q.p||'未说明产品')+'</b><span class="amt">'+(q.hasAmount?q.a.toLocaleString('en-US')+' '+esc(q.cur):'未估金额')+'</span><span><span class="tag '+(STG[q.s]||'t-plain')+'">'+esc(q.s)+'</span> '+esc(q.d)+' 收到 · '+esc(q.o)+'</span><span>报价 '+q.nq+' · 订单 '+q.no+'</span></button>').join('')+'</div>':'<p class="dim" style="margin:0;font-size:13px">目前没有在谈的询盘。</p>')+'</section><section class="dr-sec"><h3>采购画像</h3><dl class="kv">'+kv('主营业务',c.biz)+kv('采购产品',c.buy)+kv('首单',c.first)+kv('末单',c.lastord)+'<div class="full"><dt>年度成交额 · '+TODAY.slice(0,4)+' 年生产中及后续订单</dt><dd class="num" style="font:700 18px var(--num)">'+(c.annualMissing?'¥'+fmtW(c.avn)+' + '+c.annualMissing+' 笔待折算':c.avn?'¥'+c.avn.toLocaleString('zh-CN',{minimumFractionDigits:2}):'<span class="dim" style="font:13.5px var(--sans)">暂无</span>')+'</dd></div></dl></section><section class="dr-sec"><h3>跟进记录 <span class="n">'+(CP.logs(raw.followLog)).length+'</span></h3><textarea class="note-in" id="clp-note" maxlength="8000" placeholder="记录这次沟通：客户关心什么、下一步做什么…">'+esc(draft.content)+'</textarea><div class="note-f"><label class="hint">下次跟进 <input class="in in-num" id="clp-nextD" type="date" value="'+esc(draft.date)+'"></label><button class="btn btn-pri" id="clp-saveNote" '+(!draft.content.trim()||followBusy.has(c.i)?'disabled':'')+'>保存跟进</button></div><p class="crm-save-error" role="status" id="clp-noteError">'+esc(draft.error||'')+'</p><ul class="tl" style="margin-top:16px">'+timeline.map(t=>'<li class="'+(t.cls||'')+'"><time>'+esc(t.date||'日期未记录')+(t.actor?' · '+esc(t.actor):'')+'</time><span class="crm-timeline-content">'+esc(t.text)+'</span></li>').join('')+'</ul><button type="button" class="link" data-crm-action="完整档案">打开完整客户档案 →</button></section></div>';
    dr.classList.add('open');drBg.classList.add('open');dr.setAttribute('aria-hidden','false');dr.inert=!!document.querySelector('#modal.open');document.body.dataset.crmDrawerOpen='true';
    if(keep)$('.dr-b',dr).scrollTop=scroll;else setTimeout(()=>$('#drX')?.focus(),30);
  }
  function closeDr(){if(!dr)return;dr.classList.remove('open');drBg.classList.remove('open');dr.setAttribute('aria-hidden','true');dr.inert=true;curC=null;delete document.body.dataset.crmDrawerOpen;if(opener&&document.body.contains(opener))opener.focus({preventScroll:true})}
  function goClientInquiries(c,id){closeDr();window.inqClientFilter=c.n;window.inqClientIdFilter=c.i;switchView('enquiry');window.crmInquiryFilterClient?.(c.i,c.n);if(id)window.openInqDetail?.(id);}
  function act(label,button){
    if(['导入客户','客户查重','列设置','新增客户'].includes(label))return;
    if(label==='导出当前筛选')return window.crmClientExport();
    var actions={'批量分配负责人':'owner','批量建跟进任务':'task','批量修改级别':'grade','批量删除':'delete'};
    if(actions[label])return CP.batch('clients',actions[label],Object.keys(st.sel),async(ok,failed)=>{ok.forEach(id=>delete st.sel[id]);await loadAll();render();});
    var c=curC;if(!c)return;
    if(label==='新增询盘')return openInqModal({clientId:c.i,clientName:c.n,country:c.k,contactName:c.ct,contactEmail:c.em,contactPhone:c.ph2,owner:c.raw.owner,ownerName:c.o,receivedAt:TODAY});
    if(label==='新建报价')return openQuoteModal(null,{clientId:c.i,clientName:c.n,country:c.k,owner:c.raw.owner,ownerName:c.o});
    if(label==='WhatsApp')return openWaForClient(c.i);
    if(label==='编辑客户')return openClientModal(c.i);
    if(label==='完整档案'){closeDr();return viewClientDetail(c.i)}
  }
  drBg.addEventListener('click',closeDr);
  dr.addEventListener('input',function(e){if(!curC)return;var draft=drafts.get(curC.i);if(e.target.id==='clp-note')draft.content=e.target.value;if(e.target.id==='clp-nextD')draft.date=e.target.value;$('#saveNote').disabled=!draft.content.trim()||followBusy.has(curC.i)});
  dr.addEventListener('click',async function(e){
    if(e.target.closest('#clp-drX'))return closeDr();
    if(e.target.closest('[data-focus-note]'))return $('#note').focus();
    var c=curC;if(!c)return;
    if(e.target.closest('[data-reveal-phone]')){if(revealedPhones.has(c.i))revealedPhones.delete(c.i);else revealedPhones.add(c.i);return openDr(c,true)}
    if(e.target.closest('[data-client-inquiries]'))return goClientInquiries(c);
    var iq=e.target.closest('[data-open-inquiry]');if(iq)return goClientInquiries(c,iq.dataset.openInquiry);
    if(!e.target.closest('#clp-saveNote'))return;
    var draft=drafts.get(c.i),content=draft.content.trim(),actor=currentUser?.id;if(!content||followBusy.has(c.i))return;
    var signature=content+'\n'+draft.date;if(draft.signature!==signature){draft.signature=signature;draft.requestId=crypto.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}
    followBusy.add(c.i);$('#saveNote').disabled=true;
    try{var saved=await CP.request('/api/clients/'+encodeURIComponent(c.i)+'/followups',{content,nextFollowUp:draft.date,requestId:draft.requestId});if(currentUser?.id!==actor)return;var raw=CP.allClients().find(x=>x.id===c.i);if(raw)Object.assign(raw,saved);drafts.delete(c.i);render();ftwToast('跟进已保存');}
    catch(error){draft.error=error.message;if(curC?.i===c.i)$('#clp-noteError')?($('#clp-noteError').textContent=error.message):toast(error.message)}
    finally{followBusy.delete(c.i);if(currentUser?.id===actor&&curC?.i===c.i)openDr(CP.clientDTO(c.raw),true)}
  });
  document.addEventListener('keydown',function(e){
    if(!dr.classList.contains('open')||document.querySelector('#modal.open'))return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeDr()}
    if(e.key==='Tab'){var f=$$('button:not([disabled]),a[href],textarea,input',dr).filter(x=>x.offsetParent);if(!f.length)return;if(e.shiftKey&&document.activeElement===f[0]){e.preventDefault();f.at(-1).focus()}else if(!e.shiftKey&&document.activeElement===f.at(-1)){e.preventDefault();f[0].focus()}}
  },true);

  // events
  function set(k,v){st[k]=v;st.page=1;render()}
  $('#kpis').addEventListener('click',function(e){var b=e.target.closest('[data-qf]');if(b)set('qf',st.qf===b.dataset.qf?'':b.dataset.qf)});
  $('#scope').addEventListener('click',function(e){var b=e.target.closest('button');if(b)set('scope',b.dataset.v)});
  var qT;$('#q').addEventListener('input',function(e){clearTimeout(qT);qT=setTimeout(function(){set('q',e.target.value)},160)});
  $('#qWrap .clr').addEventListener('click',function(){$('#q').value='';set('q','');$('#q').focus()});
  [['fOwner','owner'],['fPh','ph'],['fLv','lv'],['fK','k'],['fSrc','src']].forEach(function(p){$('#'+p[0]).addEventListener('change',function(e){set(p[1],e.target.value)})});
  $('#sortSel').addEventListener('change',function(e){set('sort',e.target.value)});
  $('#viewSeg').addEventListener('click',function(e){var b=e.target.closest('button');if(b){st.view=b.dataset.v;savePrefs();render()}});
  function resetAll(){st.qf=st.q=st.owner=st.ph=st.lv=st.k=st.src='';st.scope='all';$('#q').value='';st.page=1;render()}
  $('#reset').addEventListener('click',resetAll);
  mq.addEventListener('change',render);
  document.addEventListener('click',async function(e){
    var t=e.target;if(!root.contains(t))return;
    if(t.closest('[data-reset]'))return resetAll();
    if(t.closest('[data-more-reset]')){st.ph=st.lv=st.k=st.src='';st.page=1;render();return}
    if(t.closest('#clp-fmoreBtn')){var fm=$('#fmore'),o=fm.classList.toggle('open');if(o){$('#fpanel').classList.add('open');ftwPlace($('#fpanel'),$('#fmoreBtn'))}else $('#fpanel').classList.remove('open');$('#fmoreBtn').setAttribute('aria-expanded',o);return}
    if(!t.closest('#clp-fmore')&&!t.closest('#clp-fpanel')){$('#fmore').classList.remove('open');$('#fpanel').classList.remove('open')}
    if(t.closest('[data-retry]')){loadAll().catch(()=>{});return}
    var demo=t.closest('[data-crm-action]');if(demo){$('#moreMenu').classList.remove('open');$('#moreBtn').setAttribute('aria-expanded','false');return act(demo.dataset.crmAction,demo)}
    if(t.closest('#clp-moreBtn')){var m=$('#moreMenu'),o=m.classList.toggle('open');$('#moreBtn').setAttribute('aria-expanded',o);if(o)$('button',m).focus();return}
    if(!t.closest('.menu-w'))$('#moreMenu').classList.remove('open');
    var sb=t.closest('[data-star]');if(sb){var c=byId(sb.dataset.star);if(starBusy.has(c.i))return;var starActor=currentUser?.id;starBusy.add(c.i);sb.disabled=true;try{var saved=await CP.request('/api/clients/'+encodeURIComponent(c.i),{star:!c.star},'PUT');if(currentUser?.id!==starActor)return;Object.assign(c.raw,saved);ftwToast(saved.star?'已加入星标：'+c.n:'已取消星标：'+c.n);}catch(error){ftwToast(error.message)}finally{starBusy.delete(c.i);render()}return}
    var ck=t.closest('[data-ck]');if(ck){if(ck.checked)st.sel[ck.dataset.ck]=1;else delete st.sel[ck.dataset.ck];ck.closest('tr,.ccard')?.classList.toggle('sel',ck.checked);renderBatch();return}
    if(t.id==='clp-ckAll'){var L=filtered().slice((st.page-1)*st.per,st.page*st.per);L.forEach(function(c){if(t.checked)st.sel[c.i]=1;else delete st.sel[c.i]});render();return}
    if(t.closest('#clp-bX')){st.sel={};render();return}
    var so=t.closest('[data-sort]');if(so){var k=so.dataset.sort,cur=st.sort.split(':');var dir=cur[0]===k?(cur[1]==='asc'?'desc':'asc'):(k==='av'||k==='cr'?'desc':'asc');set('sort',k+':'+dir);var opt=$('#sortSel option[value="'+st.sort+'"]');$('#sortSel').value=opt?st.sort:'';return}
    var pg=t.closest('[data-pg]');if(pg&&!pg.disabled){st.page=+pg.dataset.pg;render();$('.lst').scrollIntoView({block:'start'});return}
    if(t.closest('.ck'))return;
    var op=t.closest('[data-open]');if(op&&!t.closest('.drawer'))openDr(byId(op.dataset.open));
  });
  document.addEventListener('keydown',function(e){if((e.key==='Enter'||e.key===' ')&&e.target.matches('.ccard')){e.preventDefault();openDr(byId(e.target.dataset.open))}});
  document.addEventListener('change',function(e){if(e.target.id==='clp-per'){st.per=+e.target.value;st.page=1;savePrefs();render()}});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&$('#moreMenu').classList.contains('open')){$('#moreMenu').classList.remove('open');$('#moreBtn').focus()}});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&$('#fmore').classList.contains('open')){$('#fmore').classList.remove('open');$('#fpanel').classList.remove('open');$('#fmoreBtn').focus()}});

  function finish(){
    var L=filtered();clientPage=st.page;clientPageSize=st.per;clientPageRows=L.slice((st.page-1)*st.per,st.page*st.per).map(c=>c.raw);
    clientSelected.clear();Object.keys(st.sel).forEach(id=>clientSelected.add(id));renderBatch();
    var table=$('table.crm-client-table');if(table){var keys=['check','star','name','customerPhase','grade','owner','phase','rel','follow','yearAmount','created','ops'];
      table.querySelectorAll('thead th').forEach((th,i)=>{if(!th.dataset.col)th.dataset.col=keys[i]});
      table.querySelectorAll('tbody tr').forEach(row=>[...row.cells].forEach((td,i)=>{td.dataset.col=keys[i]}));
      applyClientColOrder();window.applyClientTableColumns?.();
    }
    if(curC){var latest=byId(curC.i);if(latest&&dr.classList.contains('open'))openDr(latest,true);else if(!latest)closeDr()}
  }
  var baseRender=render;render=function(){baseRender();finish()};
  draw=render;window.crmClientRecords=()=>filtered().map(c=>c.raw);window.crmClientBatch=function(){st.sel=Object.fromEntries([...clientSelected].map(id=>[id,1]));renderBatch()};
  window.crmClientOpen=id=>{render();var c=byId(id);if(c)openDr(c)};
  window.crmClientExport=function(){var L=filtered();CP.csv('客户资料-'+TODAY+'.csv',['客户','国家','联系人','阶段','级别','负责人','在途询盘','最近联系','下次跟进','年度成交额 CNY','创建日期'],L.map(c=>[c.n,c.k,c.ct,c.ph,c.lvl,c.o,c.act,c.lf,c.nf,c.annualMissing?'待折算':c.avn,c.cr]));ftwToast('已导出 '+L.length+' 个客户')};
  CP.wireShell(root,closeDr);
  ['ftw:inquiriesChanged','ftw:dataReady','ftw:ratesReady','ftw:quotationsChanged','ftw:commsChanged'].forEach(name=>window.addEventListener(name,render));
  document.addEventListener('ftw:session-change',()=>{if(!window.__ftwNoticeUser){drafts.clear();closeDr();dr.replaceChildren();st.sel={};loadState='pending';}render()});
  mounted=true;render();
 });
})();
