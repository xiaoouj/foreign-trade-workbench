
// Live adapter around the supplied enquiry.html rendering functions.
(function(){
 var draw=null,loadState='pending';
 window.crmEnquiryRender=function(){if(draw)draw()};
 window.renderInqWorkspaceList=window.crmEnquiryRender;
 window.setInqWorkspaceLoadState=function(state){loadState=state;if(draw)draw()};
 document.addEventListener('DOMContentLoaded',function(){
 var CP=window.CRMPrototype,root=document.getElementById('crm-enquiry'),idmap={"fmoreBtn": "eqp-fmoreBtn", "nextD": "eqp-nextD", "bX": "eqp-bX", "moreBtn": "eqp-moreBtn", "drTitle": "eqp-drTitle", "fFl": "eqp-fFl", "viewSeg": "eqp-viewSeg", "stages": "inqStageSummary", "count": "eqp-count", "note": "eqp-note", "fbar": "eqp-fbar", "fpanel": "eqp-fpanel", "drawer": "eqp-drawer", "page": "eqp-page", "sum": "eqp-sum", "addBtn": "inqAdd", "fmoreInfo": "eqp-fmoreInfo", "q": "inqSearch", "reset": "eqp-reset", "qWrap": "eqp-qWrap", "anomBtn": "eqp-anomBtn", "batch": "eqp-batch", "ckAll": "eqp-ckAll", "fSrc": "eqp-fSrc", "board": "eqp-board", "moreMenu": "eqp-moreMenu", "view": "eqp-view", "bN": "eqp-bN", "saveNote": "eqp-saveNote", "headSub": "eqp-headSub", "drX": "eqp-drX", "draftBtn": "eqp-draftBtn", "fOwner": "eqp-fOwner", "fmore": "eqp-fmore", "drBg": "eqp-drBg", "aiBtn": "aiRegisterBtn"};
 if(!root)return;
 var esc=CP.h,ic=CP.ic,fmtW=CP.fmtW,pct=CP.pct,ftwToast=function(m){toast(m)},ftwPlace=CP.place;
 function selector(s){return s.replace(/#([a-zA-Z][a-zA-Z0-9_-]*)/g,function(_,id){return '#'+(idmap[id]||id)})}

  var D={},TODAY=CP.today(),IQ=[],account='',drafts=new Map(),legacy=[],auxMode='',badgeRequest=0;
  var $=function(s,r){return (r||root).querySelector(selector(s))}, $$=function(s,r){return Array.prototype.slice.call((r||root).querySelectorAll(selector(s)))};
  function dd(a,b){return Math.round((new Date(b)-new Date(a))/864e5)}
  var OWN={'管理员':'o3'};
  function av(o,small){return '<span class="own" title="'+esc(o||'未分配')+'"><i class="'+(OWN[o]||'o0')+'" aria-hidden="true">'+esc((o||'?').slice(0,1).toUpperCase())+'</i>'+(small?'<span class="sr">负责人 '+esc(o||'未分配')+'</span>':esc(o||'未分配'))+'</span>'}
  var S=[
    {k:'新询盘',c:'var(--c-new)',t:'t-new'},{k:'已报价',c:'var(--c-quote)',t:'t-quote'},{k:'等回复',c:'var(--c-wait)',t:'t-wait'},
    {k:'谈判中',c:'var(--c-neg)',t:'t-neg'},{k:'成交',c:'var(--c-won)',t:'t-won'},{k:'暂缓 / 无效',c:'var(--c-lost)',t:'t-lost',of:['暂缓','无效','输单']}
  ];
  function colOf(s){for(var i=0;i<S.length;i++){if(S[i].k===s||(S[i].of&&S[i].of.indexOf(s)>=0))return i}return S.length+Math.max(0,legacy.indexOf(s))}
  function tagOf(s){return S[colOf(s)]?.t||'t-lost'}
  function cny(q){return q.hasAmount?CP.cny(q.a,q.cur):null}
  function amountSum(rows){var value=0,missing=0;rows.forEach(q=>{var n=cny(q);if(n==null){if(q.hasAmount)missing++}else value+=n});return {value,missing};}
  function sumLabel(rows,short){var a=amountSum(rows),known=rows.some(q=>q.hasAmount&&cny(q)!=null);return (known?'¥'+fmtW(a.value):a.missing?'待折算':'')+(a.missing&&known?' + '+a.missing+' 笔待折算':'');}
  function amt(q){return q.hasAmount?q.a.toLocaleString('en-US',{maximumFractionDigits:2})+' '+esc(q.cur||'USD'):q.invalidAmount?'金额待核对':''}
  function byId(id){return IQ.find(q=>q.i===String(id))}
  function refreshData(){
    TODAY=CP.today();var uid=currentUser?.id||'';
    if(account!==uid){if(window.__crmInquiryDataOwner!==uid&&(account||loadState!=='error'))loadState='pending';account=uid;drafts.clear();st.sel={};st.q=st.owner=st.src=st.fl='';st.stage=-1;st.page=1;st.view='board';auxMode='';closeDr();dr.replaceChildren();window.inqClientFilter='';window.inqClientIdFilter='';$('#eqp-country').value=$('#eqp-from').value=$('#eqp-to').value='';$('#q').value='';loadBadges();}
    IQ=CP.allInquiries().map(CP.inquiryDTO);legacy=[...new Set(IQ.map(q=>q.s).filter(status=>!S.some(x=>x.k===status||x.of?.includes(status))))];
    if(window.inqFollowFilter===true){st.q=st.owner=st.src='';st.fl='due';st.stage=-1;window.inqClientFilter='';window.inqClientIdFilter='';window.inqFollowFilter=false;$('#q').value='';}
    st.q=$('#q').value.trim();for(var id of Object.keys(st.sel))if(!byId(id))delete st.sel[id];
    refreshOptions();$('#anomBtn .n').textContent=String((typeof exceptions==='undefined'?[]:exceptions).filter(x=>x.status!=='已解决').length);
  }
  async function loadBadges(){var actor=currentUser?.id,sequence=++badgeRequest;if(!actor)return;try{var r=await api('/api/inquiry-drafts?status=pending&page=1&limit=1'),data=await r.json();if(r.ok&&actor===currentUser?.id&&sequence===badgeRequest)$('#draftBtn .n').textContent=String(data.total||0)}catch{}}
  function flags(q){var f={},active=colOf(q.s)<4;if(active&&q.nf){var n=dd(TODAY,q.nf);f.late=n<0;f.today=n===0;}
    var progress=[q.lf,...CP.logs(q.raw.stageLog).map(x=>CP.day(x.at)),...CP.logs(q.raw.followLog).map(x=>CP.day(x.at))].filter(Boolean).sort().at(-1)||q.d;
    f.age=dd(progress,TODAY);f.old=active&&!!progress&&f.age>30;
    f.nolink=['已报价','等回复','谈判中'].includes(q.s)&&q.nq===0;
    return f;
  }
  var st={view:'board',q:'',owner:'',src:'',fl:'',stage:-1,sel:{},state:'ok',expand:{},sort:'d:desc',page:1,per:20};
  var mq=matchMedia('(max-width:820px)');

  $('#moreBtn').insertAdjacentHTML('afterbegin',ic('more'));
  $('#aiBtn').insertAdjacentHTML('afterbegin',ic('spark'));
  $('#addBtn').insertAdjacentHTML('afterbegin',ic('plus'));
  $('[data-v="board"]',$('#viewSeg')).insertAdjacentHTML('afterbegin',ic('board','width:15px;height:15px;margin-right:6px;vertical-align:-3px'));
  $('[data-v="list"]',$('#viewSeg')).insertAdjacentHTML('afterbegin',ic('rows','width:15px;height:15px;margin-right:6px;vertical-align:-3px'));
  $('#bX').innerHTML=ic('x');

  function opts(id,label,field){var map=new Map();IQ.forEach(q=>{var v=q[field]||'未填写';map.set(v,(map.get(v)||0)+1)});$('#'+id).innerHTML='<option value="">'+label+'</option>'+[...map].sort((a,b)=>b[1]-a[1]).map(([v,n])=>'<option value="'+esc(v)+'">'+esc(field==='oid'?(IQ.find(q=>q.oid===v)?.o||'未分配'):v)+'（'+n+'）</option>').join('')}
  function refreshOptions(){opts('fOwner','全部负责人','oid');opts('fSrc','全部来源','src');var c=$('#eqp-country'),value=c.value;c.innerHTML='<option value="">全部国家</option>'+[...new Set(IQ.map(q=>q.k).filter(Boolean))].sort().map(k=>'<option>'+esc(k)+'</option>').join('');c.value=value;}
  function base(ignoreWarning){var q=st.q.trim().toLowerCase();return IQ.filter(function(x){
    if(st.owner&&x.oid!==st.owner)return false;
    if(st.src&&(x.src||'未填写')!==st.src)return false;
    if(window.inqClientIdFilter){if(x.raw.clientId){if(String(x.raw.clientId)!==String(window.inqClientIdFilter))return false;}else{var cl=CP.allClients().find(c=>c.id===window.inqClientIdFilter);if(!cl||!CP.matches(cl,x.raw))return false;}}
    else if(window.inqClientFilter&&CP.key(x.c)!==CP.key(window.inqClientFilter))return false;
    if(typeof inqOwnerFilterQ!=='undefined'&&inqOwnerFilterQ&&x.o!==inqOwnerFilterQ&&x.oid!==inqOwnerFilterQ)return false;
    if($('#eqp-country').value&&x.k!==$('#eqp-country').value)return false;
    if($('#eqp-from').value&&(!x.d||x.d<$('#eqp-from').value))return false;
    if($('#eqp-to').value&&(!x.d||x.d>$('#eqp-to').value))return false;
    if(st.fl&&!ignoreWarning){var f=flags(x);if(st.fl==='due'&&!(f.late||f.today))return false;if(st.fl==='none'&&(x.nf||colOf(x.s)>=4))return false;if(st.fl==='old'&&!f.old)return false;if(st.fl==='nolink'&&!f.nolink)return false}
    if(q&&[x.c,x.p,x.m,x.k].join(' ').toLowerCase().indexOf(q)<0)return false;
    return true})}

  function renderTop(L){
    var all=IQ.length, mx=Math.max(1,...S.map(function(s,i){return IQ.filter(function(q){return colOf(q.s)===i}).length}));
    $('#stages').innerHTML=S.map(function(s,i){var A=L.filter(function(q){return colOf(q.s)===i}),sum=amountSum(A).value,late=A.filter(function(q){return flags(q).late}).length;
      return '<button class="stg" style="--c:'+s.c+'" data-stage="'+i+'" aria-pressed="'+(st.stage===i)+'"><span class="k"><i></i>'+s.k+(late?'<span class="flag warn" title="跟进逾期">'+late+' 逾期</span>':'')+'</span><span class="v">'+A.length+'</span><span class="a'+(sum?'':' none')+'">'+(sumLabel(A)||'未估金额')+'</span><span class="bar" aria-hidden="true"><b style="width:'+(A.length/mx*100)+'%"></b></span>'+'</button>'}).join('');
    var open=L.filter(function(q){var c=colOf(q.s);return c>=1&&c<=3}), openSum=amountSum(open).value;
    var context=base(true);var due=context.filter(function(q){var f=flags(q);return f.late||f.today}).length, old=context.filter(function(q){return flags(q).old}).length, nolink=context.filter(function(q){return flags(q).nolink}).length;
    $('#sum').innerHTML='<div class="big"><span>报价后在谈金额</span><b>'+ (sumLabel(open)||'¥0')+'</b><small>已报价 + 等回复 + 谈判中 · '+open.length+' 条 · 按当前汇率折合 CNY</small></div><ul>'+
      [['due','跟进到期 / 逾期',due,'var(--danger)'],['old','超 30 天未推进',old,'#E08A1E'],['nolink','报价后未关联报价单',nolink,'var(--c-wait)']].map(function(r){return '<li><button data-fl="'+r[0]+'" aria-pressed="'+(st.fl===r[0])+'"><span class="dotw" style="background:'+r[3]+'"></span>'+r[1]+' <b>'+r[2]+'</b>'+ic('arrow')+'</button></li>'}).join('')+'</ul>';
  }

  function card(q){var f=flags(q),c=colOf(q.s);
    var pills=[];
    if(f.late)pills.push('<span class="pill late">'+ic('clock')+'逾期 '+dd(q.nf,TODAY)+' 天</span>');
    else if(f.today)pills.push('<span class="pill soon">'+ic('clock')+'今天跟进</span>');
    if(f.old)pills.push('<span class="pill old">'+f.age+' 天未推进</span>');
    if(c>=1&&c<=4)pills.push(q.nq||q.no?'<span class="pill ok">'+ic('link')+'报价 '+q.nq+(q.no?' · 订单 '+q.no:'')+'</span>':'<span class="pill no">未关联报价</span>');
    return '<div class="ic'+(f.late?' late':'')+'" role="button" tabindex="0" draggable="true" data-open="'+q.i+'" aria-label="'+esc(q.c)+'，'+esc(q.s)+(f.late?'，跟进逾期':'')+'"><div class="t"><b>'+esc(q.c||'未命名客户')+'</b>'+av(q.o,1)+'</div>'+
      '<div class="p"><span>'+esc(q.k||'—')+' · </span>'+esc(q.p||'未说明产品')+'</div>'+(q.why&&c>=1?'<div class="why" title="'+esc(q.why)+'">'+esc(q.why)+'</div>':'')+
      '<div class="f"><span class="amt'+(q.hasAmount?'':' none')+'">'+(q.hasAmount?amt(q):q.invalidAmount?'金额待核对':'未估金额')+'</span><span class="age">'+(q.d?q.d.slice(5)+' 收到':'')+'</span></div>'+(pills.length?'<div class="f">'+pills.join('')+'</div>':'')+'</div>'}

  function sortBoard(A){return A.sort(function(a,b){var fa=flags(a),fb=flags(b);if(fa.late!==fb.late)return fa.late?-1:1;return a.d<b.d?1:a.d>b.d?-1:0})}

  function render(){
    refreshData();st.state=loadState==='error'&&!IQ.length?'error':(loadState==='pending'||window.__crmInquiryDataOwner!==account)&&!IQ.length?'loading':'ok';
    var dirty=st.q||st.owner||st.src||st.fl||st.stage>=0||window.inqClientFilter||window.inqClientIdFilter||$('#eqp-country').value||$('#eqp-from').value||$('#eqp-to').value;
    $('#fbar').classList.toggle('dirty',!!dirty);$('#qWrap').classList.toggle('has',!!st.q);
    [['fOwner','owner'],['fSrc','src'],['fFl','fl']].forEach(function(p){var el=$('#'+p[0]);el.value=st[p[1]];el.classList.toggle('on',!!st[p[1]])});
    var moreN=[st.src,$('#eqp-country').value,$('#eqp-from').value,$('#eqp-to').value].filter(Boolean).length;
    $('#fmoreBtn').classList.toggle('on',moreN>0);
    $('#fmoreBtn').innerHTML='更多筛选'+(moreN?'<span class="n">'+moreN+'</span>':'');
    $('#fmoreBtn').setAttribute('aria-expanded',$('#fmore').classList.contains('open'));
    $('#fmoreInfo').textContent=moreN?'已应用 1 个筛选条件':'未使用更多筛选';
    $$('#viewSeg button').forEach(function(b){b.setAttribute('aria-selected',b.dataset.v===st.view)});
    var L=base(); renderTop(L);
    var won=IQ.filter(function(q){return q.s==='成交'}).length;
    $('#headSub').innerHTML='<b>'+IQ.length+'</b> 条询盘 · 本月收到 <b>'+IQ.filter(function(q){return q.d>=(TODAY.slice(0,7)+'-01')&&q.d<=TODAY}).length+'</b> 条 · 已成交 <b>'+won+'</b> 条，成交率 <b>'+pct(won,IQ.length)+'</b>';
    var V=$('#view');
    if(auxMode)return;
    if(st.state==='loading'){$('#count').textContent='加载中…';V.innerHTML='<div class="board">'+S.map(function(s){return '<div class="col" style="--c:'+s.c+'"><div class="col-h"><i></i><h3>'+s.k+'</h3></div><div class="col-b">'+[1,2,3].map(function(){return '<div class="sk-c"><span class="sk" style="width:70%;height:13px"></span><span class="sk" style="width:95%;height:10px"></span><span class="sk" style="width:40%;height:12px"></span></div>'}).join('')+'</div></div>'}).join('')+'</div>';return}
    if(st.state==='error'){$('#count').textContent='';V.innerHTML='<section class="card"><div class="err" role="alert">'+ic('alert')+'<h3>询盘没有加载出来</h3><p>暂时无法读取询盘，请重试。已保存的业务记录不会被此页面覆盖。</p><button class="btn" data-retry>'+ic('refresh')+'重新加载</button></div></section>';return}
    var shown=st.stage>=0?L.filter(function(q){return colOf(q.s)===st.stage}):L;
    $('#count').innerHTML='共 <b>'+shown.length+'</b> 条'+(shown.length!==IQ.length?' / '+IQ.length:'');
    if(!shown.length){V.innerHTML='<section class="card"><div class="empty">'+ic('search')+'<h3>没有符合条件的询盘</h3><p>换个关键词，或者放宽筛选条件。</p><button class="btn" data-reset>清空筛选</button></div></section>';renderBatch();return}
    if(st.view==='board'){
      V.innerHTML='<div class="board" id="eqp-board">'+S.concat(legacy.map(k=>({k,c:'var(--c-lost)',t:'t-lost'}))).map(function(s,i){
        if(st.stage>=0&&st.stage!==i)return '';
        var A=sortBoard(L.filter(function(q){return colOf(q.s)===i})),sum=amountSum(A).value,lim=st.expand[i]?A.length:8;
        return '<section class="col" style="--c:'+s.c+'" data-col="'+i+'" aria-label="'+s.k+'，'+A.length+' 条"><div class="col-h"><i></i><h3>'+s.k+'</h3><span class="n">'+A.length+'</span><span class="amt">'+(sumLabel(A)||'')+'</span></div><div class="col-b">'+(A.length?A.slice(0,lim).map(card).join(''):'<div class="nil">暂无询盘<br>可把卡片拖到这里</div>')+'</div>'+(A.length>lim?'<button class="more" data-expand="'+i+'">再显示 '+(A.length-lim)+' 条</button>':'')+'</section>'}).join('')+'</div>';
      $$('.batch').forEach(function(b){b.classList.remove('show')});
    }else{
      var sk=st.sort.split(':'),key=sk[0],dir=sk[1]==='desc'?-1:1;
      var R=shown.slice().sort(function(a,b){var x,y;if(key==='a'){x=cny(a)??-Infinity;y=cny(b)??-Infinity}else if(key==='s'){x=colOf(a.s);y=colOf(b.s)}else{x=a[key]||(dir>0?'9999':'');y=b[key]||(dir>0?'9999':'')}return x<y?-dir:x>y?dir:0});
      var pages=Math.max(1,Math.ceil(R.length/st.per));if(st.page>pages)st.page=pages;var rows=R.slice((st.page-1)*st.per,st.page*st.per);
      function th(k,l,cls){var on=key===k;return '<th class="'+(cls||'')+'"'+(on?' aria-sort="'+(dir>0?'ascending':'descending')+'"':'')+'><button data-sort="'+k+'">'+l+ic('sort')+'</button></th>'}
      var allOn=rows.every(function(q){return st.sel[q.i]});
      V.innerHTML='<section class="card lst"><div class="tbl-wrap"><table class="tbl"><thead><tr><th class="ck"><input type="checkbox" id="eqp-ckAll" aria-label="选择本页" '+(allOn?'checked':'')+'></th><th>客户</th><th>需求产品</th>'+th('s','阶段')+th('a','预计金额','r')+'<th>负责人</th>'+th('d','收到')+th('nf','下次跟进')+'<th>报价 / 订单</th></tr></thead><tbody>'+
        rows.map(function(q){var f=flags(q),n=q.nf?dd(TODAY,q.nf):null;return '<tr data-open="'+q.i+'" class="'+(st.sel[q.i]?'sel':'')+'"><td class="ck"><input type="checkbox" data-ck="'+q.i+'" aria-label="选择 '+esc(q.c)+'" '+(st.sel[q.i]?'checked':'')+'></td><td><div class="who"><b>'+esc(q.c||'未命名客户')+'</b><span>'+esc(q.k||'—')+' · '+esc(q.src||'未填写')+'</span></div></td><td><span class="p2" title="'+esc(q.p)+'">'+esc(q.p||'未说明产品')+'</span></td><td><span class="tag '+tagOf(q.s)+'">'+esc(q.s)+'</span></td><td class="r">'+(q.hasAmount?'<span class="dt">'+amt(q)+'</span>':'<span class="dim">—</span>')+'</td><td>'+av(q.o)+'</td><td><span class="dt">'+esc((q.d||'').slice(5))+'<small>'+q.age+' 天前</small></span></td><td>'+(q.nf?'<span class="dt'+(n<0?' late':n===0?' soon':'')+'">'+q.nf.slice(5)+'<small>'+(n<0?'逾期 '+(-n)+' 天':n===0?'今天':n+' 天后')+'</small></span>':'<span class="dim">未安排</span>')+'</td><td>'+(q.nq||q.no?'<span class="pill ok">报价 '+q.nq+' · 订单 '+q.no+'</span>':'<span class="dim">—</span>')+'</td></tr>'}).join('')+'</tbody></table></div>'+
        '<div class="pager"><span>第 <b class="num">'+((st.page-1)*st.per+1)+'–'+Math.min(R.length,st.page*st.per)+'</b> 条，共 '+R.length+' 条</span><span class="sp"></span><div class="pg"><button data-pg="'+(st.page-1)+'" '+(st.page<=1?'disabled':'')+' aria-label="上一页">‹</button>'+Array.apply(null,{length:pages}).map(function(_,i){return '<button data-pg="'+(i+1)+'"'+(i+1===st.page?' aria-current="page"':'')+'>'+(i+1)+'</button>'}).join('')+'<button data-pg="'+(st.page+1)+'" '+(st.page>=pages?'disabled':'')+' aria-label="下一页">›</button></div></div></section>';
      renderBatch();
    }
  }
  function positionBatch(){var b=$('#batch'),r=root.getBoundingClientRect();b.style.left=Math.max(b.offsetWidth/2+14,Math.min(innerWidth-b.offsetWidth/2-14,r.left+r.width/2))+'px';}
  function renderBatch(){inqSelected.clear();Object.keys(st.sel).forEach(id=>inqSelected.add(id));var n=Object.keys(st.sel).length;$('#bN').textContent=n;$('#batch').classList.toggle('show',n>0&&st.view==='list');positionBatch()}

  function moveTo(q,status){if(q&&q.s!==status)return window.crmChangeInquiryStage(q.i,status);}
  // drawer
  var dr=$('#drawer'),drBg=$('#drBg'),opener=null,cur=null;
  dr.inert=true;var followBusy=new Set();
  function openDr(q,keep){
    if(!q)return;cur=q;if(!keep)opener=document.activeElement;var f=flags(q),c=colOf(q.s),raw=q.raw,scroll=$('.dr-b',dr)?.scrollTop||0;
    var draft=drafts.get(q.i)||{content:'',date:q.nf&&q.nf>TODAY?q.nf:CP.addDays(TODAY,3)};drafts.set(q.i,draft);
    function kv(label,value,cls){return '<div class="'+(cls||'')+'"><dt>'+label+'</dt><dd>'+(value||'<span class="dim">未填写</span>')+'</dd></div>'}
    var timeline=[];
    if(q.nf)timeline.push({date:q.nf,text:'计划跟进'+(f.late?' · 已逾期 '+dd(q.nf,TODAY)+' 天':''),cls:f.late?'late':'next',at:Date.parse(q.nf+'T23:59:59Z')});
    for(var entry of CP.logs(raw.followLog))timeline.push({date:CP.day(entry.at),text:entry.content,actor:entry.by,at:Number(entry.at)||0});
    for(var entry of CP.logs(raw.stageLog))timeline.push({date:CP.day(entry.at),text:(entry.from||'建立询盘')+' → '+entry.to+' · '+(entry.reason||'历史记录未填写原因'),actor:entry.by,at:Number(entry.at)||0});
    timeline.sort((a,b)=>b.at-a.at);if(q.d)timeline.push({date:q.d,text:'收到询盘 · 来源 '+(q.src||'未填写')});
    var steps=['新询盘','已报价','等回复','谈判中','成交','暂缓','无效'];if(q.s==='输单')steps.push('输单');
    var client=CP.allClients().find(c=>q.cid?c.id===q.cid:CP.matches(c,raw));
    var business='<button type="button" data-enquiry-action="links"><b>'+(q.nq||q.no?'报价 '+q.nq+' 份 · 订单 '+q.no+' 份':'还没有关联报价单')+'</b><span class="amt">'+ic('arrow','width:15px;height:15px;color:var(--muted)')+'</span><span>'+(q.nq||q.no?'查看报价与订单，或补关联历史记录':(['已报价','等回复','谈判中'].includes(q.s)?'请关联对应报价，便于核对业务进展':'报价后在这里关联'))+'</span></button>';
    business+=q.links.quotes.map(x=>'<button type="button" data-linked-quote="'+esc(x.id)+'"><b>报价 '+esc(x.quoteNo||'未填编号')+'</b><span class="amt">'+esc(x.status||'草稿')+'</span><span>'+esc(x.currency||'USD')+' '+qtTotal(x.items).toLocaleString()+'</span></button>').join('');
    business+=q.links.orders.map(x=>'<button type="button" data-linked-order="'+esc(x.id)+'"><b>订单 '+esc(x.orderNo||'未填编号')+'</b><span class="amt">'+esc(x.status||'待确认')+'</span><span>'+esc(x.currency||'USD')+' '+Number(x.amount||0).toLocaleString()+'</span></button>').join('');
    dr.innerHTML='<div class="dr-h"><button class="btn btn-ghost icon-btn x" id="eqp-drX" aria-label="关闭">'+ic('x')+'</button><div class="eb"><span class="tag '+tagOf(q.s)+'">'+esc(q.s)+'</span><span>'+esc(q.src||'未填写来源')+' · '+(q.d?q.age+' 天前收到':'收到日期未填写')+'</span>'+(f.late?'<span class="pill late">跟进逾期</span>':'')+'</div><h2 id="eqp-drTitle">'+esc(q.c||'未命名客户')+'</h2><div class="sub">'+esc(q.k||'—')+' · '+esc(q.p||'未说明产品')+'</div><div class="stepper" role="group" aria-label="切换阶段">'+steps.map((s,i)=>'<button type="button" data-move="'+s+'" class="'+(i>=5?'alt':i<c&&c<5?'done':'')+'"'+(q.s===s?' aria-current="step"':'')+'>'+s+'</button>').join('')+'</div><div class="dr-acts"><button type="button" class="btn btn-pri" data-focus-note>'+ic('pen')+'写跟进</button><button type="button" class="btn" data-enquiry-action="quote">'+ic('file')+(q.nq?'查看报价':'生成报价')+'</button><button type="button" class="btn" data-enquiry-action="whatsapp">'+ic('chat')+'WhatsApp</button><button type="button" class="btn" data-enquiry-action="edit">编辑</button></div></div><div class="dr-b"><section class="dr-sec"><h3>需求</h3><dl class="kv">'+kv('产品',esc(q.p),'full')+kv('型号 / 规格',esc(q.m))+kv('预计金额',q.hasAmount?'<span class="num" style="font:700 16px var(--num)">'+amt(q)+'</span>'+(q.cur!=='CNY'?'<br><small class="dim">'+(cny(q)==null?'汇率未就绪，待折算':'≈ ¥'+Math.round(cny(q)).toLocaleString('zh-CN'))+'</small>':''):q.invalidAmount?'金额待核对':'')+kv('样品',esc(q.sample))+kv('负责人',av(q.o))+'</dl>'+(raw.notes||raw.chatLog?'<details class="crm-original"><summary>原始询盘与沟通</summary>'+ (raw.notes?'<pre>'+esc(raw.notes)+'</pre>':'')+(raw.chatLog?'<pre>'+esc(typeof raw.chatLog==='string'?raw.chatLog:JSON.stringify(raw.chatLog,null,2))+'</pre>':'')+'</details>':'')+'</section><section class="dr-sec"><h3>关联报价 / 订单</h3><div class="mini">'+business+'<button type="button" data-enquiry-action="client"><b>'+(client?'客户档案：'+esc(client.company):'未关联客户档案')+'</b><span class="amt">'+ic('arrow','width:15px;height:15px;color:var(--muted)')+'</span><span>'+(client?'打开客户资料':'去客户资料中建档或匹配')+'</span></button></div></section><section class="dr-sec"><h3>跟进记录 <span class="n">'+(CP.logs(raw.followLog)).length+'</span></h3><textarea class="note-in" id="eqp-note" maxlength="8000" placeholder="客户回复了什么？下一步做什么？">'+esc(draft.content)+'</textarea><div class="note-f"><label class="hint">下次跟进 <input type="date" class="in in-num" id="eqp-nextD" value="'+esc(draft.date)+'" style="height:30px;width:auto;padding:0 8px;margin-left:4px"></label><button class="btn btn-pri" id="eqp-saveNote" '+(!draft.content.trim()||followBusy.has(q.i)?'disabled':'')+'>保存跟进</button></div><p class="crm-save-error" id="eqp-noteError" role="status">'+esc(draft.error||'')+'</p><ul class="tl" style="margin-top:16px">'+timeline.map(t=>'<li class="'+(t.cls||'')+'"><time>'+esc(t.date||'日期未记录')+(t.actor?' · '+esc(t.actor):'')+'</time><span class="crm-timeline-content">'+esc(t.text)+'</span></li>').join('')+'</ul></section></div>';
    if(!keep){dr.classList.add('open');drBg.classList.add('open');dr.setAttribute('aria-hidden','false');dr.inert=!!document.querySelector('#modal.open');document.body.dataset.crmDrawerOpen='true';setTimeout(()=>$('#drX').focus(),30)}else $('.dr-b',dr).scrollTop=scroll;
  }
  function closeDr(){dr.classList.remove('open');drBg.classList.remove('open');dr.setAttribute('aria-hidden','true');dr.inert=true;cur=null;delete document.body.dataset.crmDrawerOpen;if(opener&&document.body.contains(opener))opener.focus({preventScroll:true})}
  function act(label,button){
    if(label==='异常登记')return setView('exception');if(label==='草稿箱')return setView('draft');
    if(['AI 智能登记','新增询盘','AI 设置','MCP 接入'].includes(label))return;
    if(label==='同步关联状态')return reconcileInquiryLinks(button);
    if(label==='导入记录'){openModal('导入询盘记录','<p>先保留来源原文，再核对并登记。</p><button type="button" class="btn-primary" id="crmImportPaste">粘贴邮件 / 聊天原文</button><button type="button" class="btn-ghost" id="crmImportDraft">核对来源草稿</button>',{plain:true,noFooter:true});document.getElementById('crmImportPaste').onclick=()=>openInqModal();document.getElementById('crmImportDraft').onclick=()=>{closeModal();$('#draftBtn').click()};return;}
    var actions={'批量改阶段':'stage','批量分配负责人':'owner','批量删除':'delete'};if(actions[label])return CP.batch('inquiries',actions[label],Object.keys(st.sel),async(ok,failed)=>{ok.forEach(id=>delete st.sel[id]);await loadInquiries().catch(()=>{});render()});
  }
  window.crmChangeInquiryStage=function(id,desired,opts={}){
    var raw=CP.allInquiries().find(q=>q.id===id);if(!raw)return Promise.resolve(false);var before=raw.status||'新询盘';if(before===desired)return Promise.resolve(true);
    return new Promise(resolve=>{
      var actor=currentUser?.id,done=false,saving=false;
      openModal('变更询盘阶段','<p>'+esc(typeof displayClientName==='function'?displayClientName(raw):raw.clientName)+' · 当前 '+esc(before)+'</p><div class="field"><label>新阶段</label><select name="newStage" data-no-combo>'+CP.options((INQ_STATUSES.includes(before)?INQ_STATUSES:[before,...INQ_STATUSES]).map(x=>[x,x]),desired||before)+'</select></div><div class="field full"><label>变更原因 *</label><textarea name="stageReason" required maxlength="8000" placeholder="说明本次阶段变更的原因"></textarea></div><p id="crmStageResult" class="crm-save-error field full" role="status"></p>');
      var form=document.getElementById('modalForm'),result=document.getElementById('crmStageResult');
      function cleanup(){document.removeEventListener('ftw:modal-close',cancel);document.removeEventListener('ftw:modal-replace',cancel)}
      function cancel(){if(!done){done=true;cleanup();opts.resetEl?.(before);resolve(false)}}
      document.addEventListener('ftw:modal-close',cancel);document.addEventListener('ftw:modal-replace',cancel);
      form.onsubmit=async e=>{e.preventDefault();if(saving||currentUser?.id!==actor)return;var fd=new FormData(form),reason=String(fd.get('stageReason')||'').trim(),status=String(fd.get('newStage')||'');if(!reason)return toast('请填写阶段变更原因');if(status===before)return toast('请选择不同阶段');saving=true;CP.modalBusy(form,true);
        try{var saved=await CP.request('/api/inquiries/'+encodeURIComponent(id),{status,lastStageReason:reason},'PUT');if(currentUser?.id!==actor)return;Object.assign(raw,saved);done=true;cleanup();if(document.getElementById('crmStageResult')===result)closeModal();await loadInquiries().catch(()=>{});render();resolve(true);toast('阶段已更新，原因已保存');}
        catch(error){result.textContent=error.message;}
        finally{saving=false;CP.modalBusy(form,false)}
      };
    });
  };
  window.openInqStageModal=(id,desired)=>window.crmChangeInquiryStage(id,desired);
  window.openInqFollowModal=function(id){
    var q=CP.allInquiries().find(x=>x.id===id);if(!q)return;var actor=currentUser?.id;
    openModal('记录询盘跟进','<p>'+esc(typeof displayClientName==='function'?displayClientName(q):q.clientName)+'</p><div class="field full"><label>跟进内容 *</label><textarea name="followContent" required maxlength="8000"></textarea></div><div class="field"><label>下次跟进日期</label><input type="date" name="followDate" value="'+esc(q.nextFollowAt||'')+'"></div><p id="crmFollowResult" class="crm-save-error field full" role="status"></p>');
    var form=document.getElementById('modalForm'),result=document.getElementById('crmFollowResult'),saving=false;
    form.onsubmit=async e=>{e.preventDefault();if(saving||currentUser?.id!==actor)return;var fd=new FormData(form),content=String(fd.get('followContent')||'').trim();if(!content)return toast('请填写跟进内容');saving=true;CP.modalBusy(form,true);try{var saved=await CP.request('/api/inquiries/'+encodeURIComponent(id)+'/followups',{content,nextFollowAt:String(fd.get('followDate')||'')});if(currentUser?.id!==actor)return;Object.assign(q,saved);if(document.getElementById('crmFollowResult')===result)closeModal();await loadInquiries().catch(()=>{});render();toast('跟进记录已保存')}catch(error){result.textContent=error.message}finally{saving=false;CP.modalBusy(form,false)}};
  };
  drBg.addEventListener('click',closeDr);
  dr.addEventListener('input',e=>{if(!cur)return;var draft=drafts.get(cur.i);if(e.target.id==='eqp-note')draft.content=e.target.value;if(e.target.id==='eqp-nextD')draft.date=e.target.value;$('#saveNote').disabled=!draft.content.trim()||followBusy.has(cur.i)});
  dr.addEventListener('click',async e=>{
    if(e.target.closest('#eqp-drX'))return closeDr();if(e.target.closest('[data-focus-note]'))return $('#note').focus();
    var q=cur;if(!q)return;var mv=e.target.closest('[data-move]');if(mv)return moveTo(q,mv.dataset.move);
    var quote=e.target.closest('[data-linked-quote]');if(quote)return openQuoteModal(quote.dataset.linkedQuote);
    var order=e.target.closest('[data-linked-order]');if(order)return openOrderDetail(order.dataset.linkedOrder);
    var action=e.target.closest('[data-enquiry-action]')?.dataset.enquiryAction;
    if(action==='links')return openInquiryLinks(q.i);
    if(action==='quote')return q.links.quotes.length?openQuoteModal(q.links.quotes.slice().sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0))[0].id):createQuoteFromInquiry(q.raw);
    if(action==='whatsapp')return openWaForInquiry(q.i);
    if(action==='edit')return openInqModal(q.i);
    if(action==='client'){var client=CP.allClients().find(c=>q.cid?c.id===q.cid:CP.matches(c,q.raw));closeDr();switchView('clients');if(client)window.crmClientOpen(client.id);else openClientModal(null,{company:q.c,country:q.k,contactName:q.raw.contactName,contactEmail:q.raw.contactEmail,contactPhone:q.raw.contactPhone});return;}
    if(!e.target.closest('#eqp-saveNote'))return;
    var draft=drafts.get(q.i),content=draft.content.trim(),actor=currentUser?.id;if(!content||followBusy.has(q.i))return;followBusy.add(q.i);$('#saveNote').disabled=true;
    try{var saved=await CP.request('/api/inquiries/'+encodeURIComponent(q.i)+'/followups',{content,nextFollowAt:draft.date});if(currentUser?.id!==actor)return;Object.assign(q.raw,saved);drafts.delete(q.i);render();await loadInquiries().catch(()=>{});ftwToast('跟进已保存');}
    catch(error){draft.error=error.message;}
    finally{followBusy.delete(q.i);if(currentUser?.id===actor&&cur?.i===q.i)openDr(CP.inquiryDTO(q.raw),true)}
  });
  document.addEventListener('keydown',e=>{
    if(!dr.classList.contains('open')||document.querySelector('#modal.open'))return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeDr()}
    if(e.key==='Tab'){var f=$$('button:not([disabled]),a[href],textarea,input',dr).filter(x=>x.offsetParent);if(!f.length)return;if(e.shiftKey&&document.activeElement===f[0]){e.preventDefault();f.at(-1).focus()}else if(!e.shiftKey&&document.activeElement===f.at(-1)){e.preventDefault();f[0].focus()}}
  },true);

  // drag & drop between columns
  var dragI=null;
  document.addEventListener('dragstart',function(e){var c=e.target.closest&&e.target.closest('.ic');if(!c||!root.contains(c))return;dragI=c.dataset.open;c.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(dragI))});
  document.addEventListener('dragend',function(){dragI=null;$$('.ic.dragging,.col.over').forEach(function(x){x.classList.remove('dragging','over')})});
  document.addEventListener('dragover',function(e){var col=e.target.closest&&e.target.closest('.col');if(!col||!root.contains(col)||dragI==null||+col.dataset.col>=S.length)return;e.preventDefault();$$('.col.over').forEach(function(x){if(x!==col)x.classList.remove('over')});col.classList.add('over')});
  document.addEventListener('drop',function(e){var col=e.target.closest&&e.target.closest('.col');if(!col||!root.contains(col)||dragI==null||+col.dataset.col>=S.length)return;e.preventDefault();var i=+col.dataset.col,q=byId(dragI);moveTo(q,i===5?'暂缓':S[i].k)});

  function set(k,v){st[k]=v;st.page=1;render()}
  $('#stages').addEventListener('click',function(e){var b=e.target.closest('[data-stage]');if(b)set('stage',st.stage===+b.dataset.stage?-1:+b.dataset.stage)});
  $('#sum').addEventListener('click',function(e){var b=e.target.closest('[data-fl]');if(b)set('fl',st.fl===b.dataset.fl?'':b.dataset.fl)});
  $('#viewSeg').addEventListener('click',function(e){var b=e.target.closest('button');if(b)setView(b.dataset.v)});
  var qT;$('#q').addEventListener('input',function(e){clearTimeout(qT);qT=setTimeout(function(){set('q',e.target.value)},160)});
  $('#qWrap .clr').addEventListener('click',function(){$('#q').value='';set('q','');$('#q').focus()});
  [['fOwner','owner'],['fSrc','src'],['fFl','fl']].forEach(function(p){$('#'+p[0]).addEventListener('change',function(e){set(p[1],e.target.value)})});
  function resetAll(){window.inqClientFilter='';window.inqClientIdFilter='';if(typeof inqOwnerFilterQ!=='undefined')inqOwnerFilterQ='';$('#eqp-country').value=$('#eqp-from').value=$('#eqp-to').value='';st.q=st.owner=st.src=st.fl='';st.stage=-1;$('#q').value='';st.page=1;render()}
  $('#reset').addEventListener('click',resetAll);
  document.addEventListener('click',function(e){
    var t=e.target;if(!root.contains(t))return;
    if(t.closest('[data-reset]'))return resetAll();
    if(t.closest('[data-more-reset]')){st.src='';st.page=1;render();return}
    if(t.closest('#eqp-fmoreBtn')){var fm=$('#fmore'),o=fm.classList.toggle('open');if(o){$('#fpanel').classList.add('open');ftwPlace($('#fpanel'),$('#fmoreBtn'))}else $('#fpanel').classList.remove('open');$('#fmoreBtn').setAttribute('aria-expanded',o);return}
    if(!t.closest('#eqp-fmore')&&!t.closest('#eqp-fpanel')){$('#fmore').classList.remove('open');$('#fpanel').classList.remove('open')}
    if(t.closest('[data-retry]')){loadInquiries().catch(()=>{});return}
    var demo=t.closest('[data-crm-action]');if(demo){$('#moreMenu').classList.remove('open');$('#moreBtn').setAttribute('aria-expanded','false');return act(demo.dataset.crmAction,demo)}
    if(t.closest('#eqp-moreBtn')){var m=$('#moreMenu'),o=m.classList.toggle('open');$('#moreBtn').setAttribute('aria-expanded',o);if(o)$('button',m).focus();return}
    if(!t.closest('.menu-w'))$('#moreMenu').classList.remove('open');
    var ex=t.closest('[data-expand]');if(ex){st.expand[ex.dataset.expand]=1;render();return}
    var ck=t.closest('[data-ck]');if(ck){if(ck.checked)st.sel[ck.dataset.ck]=1;else delete st.sel[ck.dataset.ck];ck.closest('tr').classList.toggle('sel',ck.checked);renderBatch();return}
    if(t.id==='eqp-ckAll'){$$('[data-ck]').forEach(function(c){if(t.checked)st.sel[c.dataset.ck]=1;else delete st.sel[c.dataset.ck]});render();return}
    if(t.closest('#eqp-bX')){st.sel={};render();return}
    var so=t.closest('[data-sort]');if(so){var k=so.dataset.sort,c=st.sort.split(':');set('sort',k+':'+(c[0]===k?(c[1]==='asc'?'desc':'asc'):(k==='a'||k==='d'?'desc':'asc')));return}
    var pg=t.closest('[data-pg]');if(pg&&!pg.disabled){st.page=+pg.dataset.pg;render();return}
    if(t.closest('.ck'))return;
    var op=t.closest('[data-open]');if(op&&!t.closest('.drawer'))openDr(byId(op.dataset.open));
  });
  document.addEventListener('keydown',function(e){if((e.key==='Enter'||e.key===' ')&&e.target.matches('.ic')){e.preventDefault();openDr(byId(e.target.dataset.open))}
    if(e.key==='Escape'&&$('#fmore').classList.contains('open')){$('#fmore').classList.remove('open');$('#fpanel').classList.remove('open');$('#fmoreBtn').focus()}
    if(e.key==='Escape'&&$('#moreMenu').classList.contains('open')){$('#moreMenu').classList.remove('open');$('#moreBtn').focus()}});
  function setView(mode){
    auxMode=['draft','exception','stats'].includes(mode)?mode:'';
    if(!auxMode)st.view=['board','list'].includes(mode)?mode:'board';
    $('.rail').hidden=!!auxMode;$('#fbar').hidden=!!auxMode;$('#view').hidden=!!auxMode;$('#eqp-aux').hidden=!auxMode;
    root.querySelectorAll('.subview').forEach(node=>node.classList.toggle('active',node.id==='sub-'+auxMode));
    root.querySelectorAll('[data-subtab]').forEach(button=>button.classList.toggle('active',button.dataset.subtab===(auxMode||st.view)));
    closeDr();if(auxMode==='exception')renderExceptions();if(auxMode==='stats')renderInqStats();
    window.dispatchEvent(new CustomEvent('ftw:inqViewChanged',{detail:mode}));render();
  }
  window.crmSetInquiryView=setView;
  $('#eqp-aux [data-crm-back]').onclick=()=>setView(st.view);
  ['eqp-country','eqp-from','eqp-to'].forEach(id=>$('#'+id).addEventListener('change',()=>{st.page=1;render()}));
  function finish(){
    inqSelected.clear();Object.keys(st.sel).forEach(id=>inqSelected.add(id));renderBatch();
    var notice=$('#eqp-loadNotice');if(!notice){notice=document.createElement('div');notice.id='eqp-loadNotice';notice.className='crm-notice';$('#view').before(notice)}notice.hidden=!(loadState==='error'&&IQ.length&&!auxMode);notice.innerHTML='更新失败，当前保留上次已加载的询盘。<button type="button" data-retry>重新加载</button>';
    var filterNotice=$('#eqp-clientScope');if(!filterNotice){filterNotice=document.createElement('div');filterNotice.id='eqp-clientScope';filterNotice.className='crm-client-scope';$('#view').before(filterNotice)}filterNotice.hidden=!(window.inqClientFilter||window.inqClientIdFilter);filterNotice.innerHTML='客户：'+esc(window.inqClientFilter||CP.allClients().find(c=>c.id===window.inqClientIdFilter)?.company||'已筛选')+' <button type="button" data-reset>清除筛选 ×</button>';
    if(cur&&dr.classList.contains('open')){var q=byId(cur.i);if(q)openDr(q,true);else closeDr()}
    $('#batch').classList.toggle('show',Object.keys(st.sel).length>0&&st.view==='list'&&!auxMode);
  }
  var baseRender=render;render=function(){var board=$('#board'),left=board?.scrollLeft||0;baseRender();finish();board=$('#board');if(board)board.scrollLeft=left;};
  draw=render;window.crmEnquiryBatch=()=>{st.sel=Object.fromEntries([...inqSelected].map(id=>[id,1]));renderBatch()};
  window.crmInquiryFilterClient=function(id,name){window.inqClientIdFilter=id;window.inqClientFilter=name;st.q=st.owner=st.src=st.fl='';st.stage=-1;$('#q').value='';setView('board')};
  window.openInqDetail=function(id){render();var q=byId(id);if(q){if(!root.closest('.view').classList.contains('active'))switchView('enquiry');if(auxMode)setView('board');openDr(q)}};
  window.closeInqDetail=closeDr;window.inqResetWorkspaceFilters=resetAll;window.inqRefreshDraftBadge=loadBadges;
  CP.wireShell(root,closeDr);
  window.addEventListener('ftw:inquiriesChanged',()=>{render();loadBadges()});['ftw:dataReady','ftw:ratesReady','ftw:quotationsChanged'].forEach(name=>window.addEventListener(name,render));
  document.addEventListener('ftw:session-change',()=>{if(!window.__ftwNoticeUser){drafts.clear();st.sel={};closeDr();dr.replaceChildren();loadState='pending';}render()});
  render();
 });
})();
