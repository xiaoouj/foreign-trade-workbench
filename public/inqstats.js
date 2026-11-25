// Inquiry-analysis components follow prototype/inqstats.html. All records are
// derived afresh from the authenticated CRM store; source records stay intact.
// Country aliases come from the supplied inquiry-analysis prototype.
const isbCountryAliases=new Map(Object.entries({'Poland':'波兰','Australia':'澳大利亚','India':'印度','Belarus':'白俄罗斯','Malaysia':'马来西亚','Thailand':'泰国','Algeria':'阿尔及利亚','Bangladesh':'孟加拉国','Paraguay':'巴拉圭','Spain':'西班牙','Nigeria':'尼日利亚','Maldives':'马尔代夫','Mexico':'墨西哥','Jamaica':'牙买加','Russia':'俄罗斯','Israel':'以色列','Indonesia':'印度尼西亚','Republic of Korea':'韩国','Korea':'韩国','South Korea':'韩国','Vietnam':'越南','Morocco':'摩洛哥','Philippines':'菲律宾','Unknown':'未填','':'未填'}).map(([alias,name])=>[alias.toLowerCase(),name]));
function isbCountryLabel(country) {
 const value=String(country||'').normalize('NFKC').trim();
 return isbCountryAliases.get(value.toLowerCase())||value||'未填';
}

(() => {
 const host=document.getElementById('view-inqstats');
 const $=selector=>host.querySelector(selector),$$=selector=>[...host.querySelectorAll(selector)];
 const fmtCNY=n=>n==null?'待核对':fmtMoney(n),fmtW=n=>Math.abs(n)>=10000?(n/10000).toFixed(1)+'万':Math.round(n).toLocaleString('zh-CN');
 const pct=(a,b,d=0)=>b?(a/b*100).toFixed(d)+'%':'—';
 const ic=name=>'<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">'+(name==='sort'?'<path d="m8 8 4-4 4 4M12 4v16m-4-4 4 4 4-4"/>':'<circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7v1"/>')+'</svg>';
 const ftwToast=message=>toast(message);
 let ALL=[],TODAY=todayStr();
  /* ---- Normalisation (display-level; data unchanged) ---- */
  var CN={'Poland':'波兰','Australia':'澳大利亚','India':'印度','Belarus':'白俄罗斯','Malaysia':'马来西亚','Thailand':'泰国','Algeria':'阿尔及利亚','Bangladesh':'孟加拉国','Paraguay':'巴拉圭','Spain':'西班牙','Nigeria':'尼日利亚','Maldives':'马尔代夫','Mexico':'墨西哥','Jamaica':'牙买加','Russia':'俄罗斯','Israel':'以色列','Indonesia':'印度尼西亚','Republic of Korea':'韩国','Korea':'韩国','Vietnam':'越南','Morocco':'摩洛哥','Philippines':'菲律宾','Unknown':'未填','':'未填'};
  var STG={'新询盘':{k:'new',c:'#2F5BD3'},'已报价':{k:'quote',c:'#C68A12'},'等回复':{k:'wait',c:'#6A4BB8'},'谈判中':{k:'neg',c:'#0B8A97'},'成交':{k:'won',c:'#1B7A4B'},'暂缓':{k:'lost',c:'#9AA0B2'},'无效':{k:'lost',c:'#C3C7D1'},'输单':{k:'lost',c:'#B5BAC7'}};
  var ORDER=['新询盘','已报价','等回复','谈判中','成交','暂缓','无效','输单'];
  var ACTIVE=['新询盘','已报价','等回复','谈判中'],CLOSED=['暂缓','无效','输单'];
  var aliasCount={},merged=[];
  function refreshRecords(){
    TODAY=todayStr();aliasCount={};
    ALL=(window.getAllInquiries?.()||[]).map(raw=>{
      const amount=Number(raw.expectedAmount),q={id:raw.id,c:raw.clientName||raw.contactName||'未填客户',p:raw.product||'',k:raw.country||'',kc:isbCountryLabel(raw.country),srcN:raw.source||'未填',d:raw.receivedAt||'',o:orderOwnerKey(raw),ownerLabel:clientOwnerLabel(raw),s:raw.status||'新询盘',nf:raw.nextFollowAt||'',a:Number.isFinite(amount)&&amount>0?amount:null,cur:raw.currency||'CNY'};
      if(!STG[q.s]){STG[q.s]={k:'lost',c:'#9aa0b2'};ORDER.push(q.s);}
      q.cny=q.a==null?null:q.cur==='CNY'?q.a:toCNY(q.a,q.cur);
      q.iss=[];
      if(!analyticsValidDate(q.d))q.iss.push('收到日期缺失或无效');
      if(!raw.owner)q.iss.push('未分配负责人');
      if(q.s==='成交'&&q.a==null)q.iss.push('成交金额缺失');
      if(q.a!=null&&q.cny==null)q.iss.push('汇率待核对');
      if(q.nf&&q.nf<TODAY&&ACTIVE.includes(q.s)){q.iss.push('跟进逾期');q.late=Math.round((Date.parse(TODAY+'T00:00:00Z')-Date.parse(q.nf+'T00:00:00Z'))/86400000);}
      if(q.kc!==q.k&&q.k)(aliasCount[q.kc]=aliasCount[q.kc]||{})[q.k]=1;
      return q;
    });
    merged=Object.keys(aliasCount).filter(c=>c!=='未填'&&(ALL.some(q=>q.k===c)||Object.keys(aliasCount[c]).length>1));
  }
  function ownerLabel(key){return ALL.find(q=>q.o===key)?.ownerLabel||'未分配';}

  /* ---- Filters ---- */
  var F={o:'',y:'',m:'',src:'',k:'',s:''};
  function uniq(f){var m={};ALL.forEach(function(q){var v=f(q);m[v]=(m[v]||0)+1});return Object.keys(m).sort(function(a,b){return m[b]-m[a]}).map(function(k){return [k,m[k]]})}
  function fillSel(id,label,opts){$(id).innerHTML='<option value="">'+label+'</option>'+opts.map(function(o){return '<option value="'+esc(o[0])+'">'+esc(o[1]||o[0])+'</option>'}).join('')}
  function fillOptions(){
  fillSel('#isbOwnerFilter','全部负责人',uniq(function(q){return q.o}).map(function(x){return [x[0],ownerLabel(x[0])+'（'+x[1]+'）']}));
  fillSel('#isbYearFilter','全部年份',[...new Set([String(new Date().getFullYear()-1),String(new Date().getFullYear()),...(F.y?[F.y]:[]),...ALL.map(q=>q.d.slice(0,4)).filter(y=>/^\d{4}$/.test(y))])].sort().reverse().map(y=>[y,y+' 年']));
  fillSel('#isbMonthFilter','全部月份',Array.from({length:12},function(_,i){return [String(i+1).padStart(2,'0'),(i+1)+' 月']}));
  fillSel('#isbSourceFilter','全部来源',uniq(function(q){return q.srcN}).map(function(x){return [x[0],x[0]+'（'+x[1]+'）']}));
  fillSel('#isbCountryFilter','全部国家',uniq(function(q){return q.kc}).map(function(x){return [x[0],x[0]+'（'+x[1]+'）']}));
  fillSel('#isbStatusFilter','全部状态',ORDER.filter(function(s){return ALL.some(function(q){return q.s===s})}).map(function(s){return [s,s]}));
  }
  var SEL={o:'#isbOwnerFilter',y:'#isbYearFilter',m:'#isbMonthFilter',src:'#isbSourceFilter',k:'#isbCountryFilter',s:'#isbStatusFilter'};
  Object.keys(SEL).forEach(function(k){$(SEL[k]).addEventListener('change',function(e){F[k]=e.target.value;page=1;render()})});
  $('#isbReset').addEventListener('click',function(){Object.keys(F).forEach(function(k){F[k]=''});page=1;render();$('#isbOwnerFilter').focus()});
  function setF(k,v){F[k]=F[k]===v?'':v;page=1;render()}
  function match(q,skip){
    return (skip==='o'||!F.o||q.o===F.o)&&(skip==='y'||!F.y||q.d.slice(0,4)===F.y)&&(skip==='m'||!F.m||q.d.slice(5,7)===F.m)&&
      (skip==='src'||!F.src||q.srcN===F.src)&&(skip==='k'||!F.k||q.kc===F.k)&&(skip==='s'||!F.s||q.s===F.s);
  }

  var state='ok',page=1,PER=12,sortK='flag',sortDir=-1,srcSort='n',ctryAll=false,dq='';
  function cnt(a,f){return a.filter(f).length}
  function sumCNY(a){return a.reduce(function(s,q){return s+(q.cny||0)},0)}

  function render(){
    Object.keys(SEL).forEach(function(k){$(SEL[k]).value=F[k];$(SEL[k]).classList.toggle('on',!!F[k])});
    $('#isbReset').hidden=!Object.keys(F).some(function(k){return F[k]});
    var R=ALL.filter(function(q){return match(q)});
    $('#isbCount').textContent=R.length;$('#isbVisibleTotal').textContent=ALL.length;
    kpis(R);flow(R);notes(R);months();stages(R);sources();owners();countries();detail(R);
  }

  function kpis(R){
    var act=cnt(R,function(q){return ACTIVE.indexOf(q.s)>-1}),won=cnt(R,function(q){return q.s==='成交'}),late=cnt(R,function(q){return q.iss.indexOf('跟进逾期')>-1}),iss=cnt(R,function(q){return q.iss.length}),closed=cnt(R,function(q){return CLOSED.indexOf(q.s)>-1});
    var K=[
      {id:'isbMonth',k:'筛选询盘',v:R.length,u:'条',d:'可见总数 '+ALL.length},
      {id:'isbPending',k:'推进中',v:act,u:'条',d:'预计 '+fmtW(sumCNY(R.filter(function(q){return ACTIVE.indexOf(q.s)>-1})))+'元'},
      {id:'isbWon',k:'成交',v:won,u:'条',d:'成交率 '+pct(won,R.length,0)},
      {id:'isbFollow',k:'跟进逾期',v:late,u:'条',d:late?'最久逾期 '+Math.max.apply(null,R.filter(function(q){return q.late}).map(function(q){return q.late}))+' 天':'没有逾期',alert:late>0,act:'flag'},
      {id:'isbTotal',k:'数据待完善',v:cnt(R,function(q){return q.iss.some(i=>i!=='跟进逾期')}),u:'条',d:'未分配负责人等 · 已关闭 '+closed+' 条'}
    ];
    $('#isbKpis').innerHTML=K.map(function(k){return '<'+(k.act?'button':'div')+' class="kpi'+(k.alert?' alert':'')+'"'+(k.act?' data-act="'+k.act+'"':'')+'><span class="k">'+k.k+(k.alert?' <span class="flag">需处理</span>':'')+'</span><span class="v num"><span id="'+k.id+'">'+k.v+'</span><small>'+k.u+'</small></span><span class="d">'+k.d+'</span></'+(k.act?'button':'div')+'>'}).join('');
    var b=$('#isbKpis [data-act=flag]');if(b)b.addEventListener('click',function(){sortK='flag';sortDir=-1;page=1;detail(ALL.filter(function(q){return match(q)}));document.getElementById('inqstats-dh').scrollIntoView({behavior:'smooth',block:'start'})});
  }

  function flow(R){
    var act=R.filter(function(q){return ACTIVE.indexOf(q.s)>-1}),won=R.filter(function(q){return q.s==='成交'}),cl=R.filter(function(q){return CLOSED.indexOf(q.s)>-1});
    $('#isbGroups').innerHTML='<div><span>推进中</span><b class="num">'+act.length+'<small>'+fmtW(sumCNY(act))+'元</small></b></div><div><span>已成交</span><b class="num">'+won.length+'<small>'+fmtW(sumCNY(won))+'元</small></b></div><div><span>已关闭（暂缓 / 无效）</span><b class="num">'+cl.length+'<small>条</small></b></div>';
    var stg=ORDER.map(function(s){return {s:s,n:cnt(R,function(q){return q.s===s}),a:sumCNY(R.filter(function(q){return q.s===s}))}}).filter(function(x){return x.n});
    var river=$('#flowStageRiver');river.classList.toggle('dim',!!F.s);
    river.innerHTML=stg.length?stg.map(function(x){return '<button style="flex:'+x.n+';background:'+STG[x.s].c+'" class="'+(F.s===x.s?'on':'')+'" aria-pressed="'+(F.s===x.s)+'" aria-label="'+x.s+' '+x.n+' 条" data-s="'+x.s+'" data-flow-stage="'+x.s+'" title="'+x.s+' '+x.n+' 条"><b>'+x.n+'</b><span>'+x.s+'</span></button>'}).join(''):'<div class="empty" style="padding:10px;flex:1">没有符合条件的询盘</div>';
    $('#isbStageLegend').innerHTML=stg.map(function(x){return '<span><i style="background:'+STG[x.s].c+'"></i>'+x.s+' '+x.n+(x.a?'<span class="amt">'+fmtW(x.a)+'</span>':'')+'</span>'}).join('');
    river.onclick=function(e){var b=e.target.closest('button');if(b)setF('s',b.dataset.s)};
  }

  function notes(R){
    var N=[],n=R.length;
    if(!n){$('#flowInquiryInsights').innerHTML='<li><span class="n">!</span><span>当前筛选下没有询盘，试试 <button data-reset>清除筛选</button>。</span></li>';bindNotes();return}
    var src=uniqR(R,function(q){return q.srcN});
    if(src.length){var s=src[0],sw=cnt(R,function(q){return q.srcN===s[0]&&q.s==='成交'});N.push('<b>'+esc(s[0])+'</b> 带来 <b class="num">'+Math.round(s[1]/n*100)+'%</b> 的询盘（'+s[1]+' 条），成交率 '+pct(sw,s[1],0)+(src.length>1?'；其余来源合计 '+(n-s[1])+' 条，样本太少暂不比较。':'。'))}
    var mm=uniqR(R,function(q){return q.d.slice(0,7)});
    if(mm.length>1){var top=mm[0],rest=(n-top[1])/(mm.length-1);N.push('<b>'+top[0].replace('-',' 年 ')+' 月</b> 收到 '+top[1]+' 条，约为其他月份平均的 <b class="num">'+(top[1]/rest).toFixed(1)+' 倍</b>，<button data-m="'+top[0]+'">只看这个月</button>。')}
    var ac=ACTIVE.slice(1).map(function(s){return [s,cnt(R,function(q){return q.s===s}),sumCNY(R.filter(function(q){return q.s===s}))]}).sort(function(a,b){return b[1]-a[1]});
    if(ac[0]&&ac[0][1])N.push('最大的卡点是 <b>'+ac[0][0]+'</b>：'+ac[0][1]+' 条、预计 '+fmtW(ac[0][2])+'元在等客户，<button data-s="'+ac[0][0]+'">查看这些询盘</button>。');
    var late=R.filter(function(q){return q.late});
    if(late.length)N.push('<b class="num">'+late.length+'</b> 条询盘的下次跟进日已过期，最早的停在 '+late.map(function(q){return q.nf}).sort()[0]+'，<button data-flag>优先处理</button>。');
    if(merged.length&&!F.k)N.push('国家名称中英文混写，已在本页合并显示（如 '+merged.slice(0,3).join('、')+'），原数据未改动。');
    $('#flowInquiryInsights').innerHTML=N.slice(0,4).map(function(t,i){return '<li><span class="n">'+(i+1)+'</span><span>'+t+'</span></li>'}).join('');
    bindNotes();
  }
  function bindNotes(){
    $('#flowInquiryInsights').onclick=function(e){var b=e.target.closest('button');if(!b)return;
      if(b.dataset.m){F.y=b.dataset.m.slice(0,4);F.m=b.dataset.m.slice(5,7);page=1;render()}
      else if(b.dataset.s){setF('s',b.dataset.s)}
      else if(b.hasAttribute('data-flag')){sortK='flag';sortDir=-1;page=1;render();document.getElementById('inqstats-dh').scrollIntoView({behavior:'smooth'})}
      else if(b.hasAttribute('data-reset')){$('#isbReset').click()}};
  }
  function uniqR(R,f){var m={};R.forEach(function(q){var v=f(q);if(v)m[v]=(m[v]||0)+1});return Object.keys(m).map(function(k){return [k,m[k]]}).sort(function(a,b){return b[1]-a[1]})}

  function months(){
    var R=ALL.filter(function(q){return match(q,'m')});
    var keys=[];var begin=new Date(new Date().getFullYear(),new Date().getMonth()-11,1),y0=F.y?+F.y:begin.getFullYear(),m0=F.y?1:begin.getMonth()+1,cnt=12;
    for(var i=0;i<cnt;i++){var y=y0+Math.floor((m0-1+i)/12),m=(m0-1+i)%12+1;keys.push(y+'-'+String(m).padStart(2,'0'))}
    var data=keys.map(function(k){var a=R.filter(function(q){return q.d.slice(0,7)===k});return {k:k,n:a.length,w:a.filter(function(q){return q.s==='成交'}).length}});
    var max=Math.max(5,Math.ceil(Math.max.apply(null,data.map(function(d){return d.n}))/10)*10);
    var W=720,H=230,pl=28,pb=34,pt=18,bw=(W-pl)/data.length,g='';
    for(var v=0;v<=max;v+=max/5){var y=pt+(H-pt-pb)*(1-v/max);g+='<line class="gl" x1="'+pl+'" x2="'+W+'" y1="'+y+'" y2="'+y+'"/><text class="ax" x="'+(pl-6)+'" y="'+(y+4)+'" text-anchor="end">'+v+'</text>'}
    var cols=data.map(function(d,i){var x=pl+i*bw,h1=(H-pt-pb)*d.n/max,h2=(H-pt-pb)*d.w/max,w=bw*.5,x0=x+bw*.25,sel=F.m&&d.k.slice(5,7)===F.m&&(!F.y||d.k.slice(0,4)===F.y);
      return '<g class="col'+(sel?' sel':'')+'" tabindex="0" role="button" aria-pressed="'+sel+'" aria-label="'+d.k+'：询盘 '+d.n+' 条，成交 '+d.w+' 条" data-k="'+d.k+'" data-isb-month="'+d.k+'"><rect x="'+x+'" y="'+pt+'" width="'+bw+'" height="'+(H-pt-pb)+'" fill="transparent"/>'+
      '<rect class="b1" x="'+x0+'" y="'+(H-pb-h1)+'" width="'+w+'" height="'+Math.max(h1,d.n?2:0)+'" rx="2"/>'+(d.w?'<rect class="b2" x="'+x0+'" y="'+(H-pb-h2)+'" width="'+w+'" height="'+h2+'" rx="2"/>':'')+
      (d.n?'<text class="lab" x="'+(x0+w/2)+'" y="'+(H-pb-h1-6)+'" text-anchor="middle">'+d.n+'</text>':'')+
      '<text class="ax" x="'+(x0+w/2)+'" y="'+(H-pb+15)+'" text-anchor="middle">'+(+d.k.slice(5,7))+'月</text>'+((i===0||d.k.slice(5,7)==='01')?'<text class="ax" x="'+(x0+w/2)+'" y="'+(H-pb+29)+'" text-anchor="middle">'+d.k.slice(0,4)+'</text>':'')+'</g>'}).join('');
    $('#isbTrend').innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-label="月度询盘柱状图">'+g+cols+'</svg>';
    var mc=$('#isbTrend');mc.scrollLeft=mc.scrollWidth;
    var svg=$('#isbTrend svg');
    function pick(el){var k=el.dataset.k;if(F.m===k.slice(5,7)&&F.y===k.slice(0,4)){F.m='';F.y=''}else{F.y=k.slice(0,4);F.m=k.slice(5,7)}page=1;render()}
    svg.addEventListener('click',function(e){var c=e.target.closest('.col');if(c)pick(c)});
    svg.addEventListener('keydown',function(e){var c=e.target.closest('.col');if(c&&(e.key==='Enter'||e.key===' ')){e.preventDefault();var k=c.dataset.k;pick(c);var n=$('#isbTrend .col[data-k="'+k+'"]');n&&n.focus()}});
  }

  function stages(R){
    var n=R.length||1,rows=ORDER.map(function(s){var a=R.filter(function(q){return q.s===s});return {s:s,n:a.length,a:sumCNY(a)}}).filter(function(x){return x.n||ACTIVE.indexOf(x.s)>-1||x.s==='成交'});
    var max=Math.max.apply(null,rows.map(function(x){return x.n}).concat([1]));
    function li(x){return '<li><button class="'+(F.s===x.s?'on':'')+'" aria-pressed="'+(F.s===x.s)+'" data-s="'+x.s+'" data-flow-stage="'+x.s+'"><span class="tag t-'+STG[x.s].k+'">'+x.s+'</span><span class="bar"><i style="width:'+(x.n/max*100)+'%;background:'+STG[x.s].c+'"></i></span><span class="n num">'+x.n+'</span><span class="p">'+Math.round(x.n/n*100)+'%</span><span class="a">'+(x.a?fmtCNY(x.a):'—')+'</span></button></li>'}
    $('#isbFunnel').innerHTML='<li class="cap">推进中</li>'+rows.filter(function(x){return ACTIVE.indexOf(x.s)>-1}).map(li).join('')+'<li class="sep" role="presentation"></li><li class="cap">结果</li>'+rows.filter(function(x){return ACTIVE.indexOf(x.s)<0}).map(li).join('');
    $('#isbFunnel').onclick=function(e){var b=e.target.closest('button');if(b)setF('s',b.dataset.s)};
  }

  function sources(){
    var R=ALL.filter(function(q){return match(q,'src')});
    var rows=uniqR(R,function(q){return q.srcN}).map(function(x){var w=cnt(R,function(q){return q.srcN===x[0]&&q.s==='成交'});return {k:x[0],n:x[1],w:w,r:w/x[1]}});
    rows.sort(srcSort==='n'?function(a,b){return b.n-a.n||b.r-a.r}:function(a,b){return b.r-a.r||b.n-a.n});
    var max=Math.max.apply(null,rows.map(function(x){return x.n}).concat([1]));
    $('#isbSourceTable').innerHTML='<thead><tr><th>来源</th><th>询盘</th><th class="r">成交</th><th class="r">成交率</th></tr></thead><tbody>'+(rows.length?rows.map(function(x){return '<tr class="click'+(F.src===x.k?' on':'')+'" tabindex="0" data-v="'+esc(x.k)+'"><td>'+esc(x.k)+'</td><td><span class="vol"><i style="width:'+(x.n/max*120)+'px"></i><span class="numc">'+x.n+'</span></span></td><td class="r numc">'+x.w+'</td><td class="r"><span class="rate'+(x.n>=5&&x.r>=.1?' hi':'')+'">'+Math.round(x.r*100)+'%</span>'+(x.n<5?'<span class="small">样本少</span>':'')+'</td></tr>'}).join(''):'<tr><td colspan="4" class="empty">没有数据</td></tr>')+'</tbody>';
    bindRows('#isbSourceTable','src');
  }
  $('#isbSourceSort').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;srcSort=b.dataset.k;$$('#isbSourceSort button').forEach(function(x){x.setAttribute('aria-pressed',x===b)});sources()});

  function owners(){
    var R=ALL.filter(function(q){return match(q,'o')});
    var rows=uniqR(R,function(q){return q.o}).map(function(x){var a=R.filter(function(q){return q.o===x[0]});return {k:x[0],n:x[1],act:cnt(a,function(q){return ACTIVE.indexOf(q.s)>-1}),w:cnt(a,function(q){return q.s==='成交'}),late:cnt(a,function(q){return q.late})}});
    $('#isbOwnerTable').innerHTML='<thead><tr><th>负责人</th><th class="r">询盘</th><th class="r">推进中</th><th class="r">成交</th><th class="r">成交率</th><th class="r">逾期</th></tr></thead><tbody>'+rows.map(function(x){return '<tr class="click'+(F.o===x.k?' on':'')+'" tabindex="0" data-v="'+esc(x.k)+'"><td>'+(x.k==='__unassigned__'?'<span class="tag t-bad">未分配</span>':esc(ownerLabel(x.k)))+'</td><td class="r numc">'+x.n+'</td><td class="r numc">'+x.act+'</td><td class="r numc">'+x.w+'</td><td class="r"><span class="rate'+(x.n>=5&&x.w/x.n>=.1?' hi':'')+'">'+Math.round(x.w/x.n*100)+'%</span></td><td class="r">'+(x.late?'<span class="tag t-bad">'+x.late+'</span>':'<span class="numc" style="color:var(--faint)">0</span>')+'</td></tr>'}).join('')+'</tbody>';
    bindRows('#isbOwnerTable','o');
  }
  function bindRows(t,k){var el=$(t);el.onclick=function(e){var r=e.target.closest('tr.click');if(r)setF(k,r.dataset.v)};el.onkeydown=function(e){var r=e.target.closest('tr.click');if(r&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setF(k,r.dataset.v);var n=$(t+' tr[data-v="'+CSS.escape(r.dataset.v)+'"]');n&&n.focus()}}}

  function countries(){
    var R=ALL.filter(function(q){return match(q,'k')});
    var rows=uniqR(R,function(q){return q.kc}),max=rows.length?rows[0][1]:1;
    var show=ctryAll?rows:rows.slice(0,12);
    $('#isbCountryChart').innerHTML=show.map(function(x){var al=aliasCount[x[0]]?Object.keys(aliasCount[x[0]]).join(' / '):'';return '<li><button class="'+(F.k===x[0]?'on':'')+'" aria-pressed="'+(F.k===x[0])+'" data-v="'+esc(x[0])+'"><span>'+esc(x[0])+(al&&x[0]!=='未填'?'<span class="alias">含 '+esc(al)+'</span>':'')+'</span><span class="bar"><i style="width:'+(x[1]/max*100)+'%"></i></span><span class="n num">'+x[1]+'</span></button></li>'}).join('')||'<li class="empty">没有数据</li>';
    $('#isbCountriesMore').textContent=ctryAll?'收起':'显示全部 '+rows.length+' 个';
    $('#isbCountriesMore').hidden=rows.length<=12;
    $('#isbMergeNote').hidden=!merged.length;$('#isbMergeNote').innerHTML=ic('info')+'<span>同一国家存在中英文多种写法（如 Korea / Republic of Korea / 韩国），本页中英文写法已合并展示，共涉及 '+merged.length+' 个国家。建议在「设置」里统一国家字段，避免各处统计口径不一致。</span>';
    $('#isbCountryChart').onclick=function(e){var b=e.target.closest('button');if(b)setF('k',b.dataset.v)};
  }
  $('#isbCountriesMore').addEventListener('click',function(){ctryAll=!ctryAll;countries()});

  var COLS=[['c','客户 / 产品'],['kc','国家'],['srcN','来源'],['d','收到日期'],['o','负责人'],['s','状态'],['cny','预计金额'],['flag','提醒']];
  function detail(R){
    var rows=R.filter(function(q){return !dq||(q.c+' '+q.p).toLowerCase().indexOf(dq)>-1});
    rows.sort(function(a,b){var r;
      if(sortK==='flag'){r=(a.iss.length?1:0)-(b.iss.length?1:0)||(a.late||0)-(b.late||0)||(a.cny||0)-(b.cny||0)}
      else if(sortK==='cny'){r=(a.cny||-1)-(b.cny||-1)}
      else if(sortK==='s'){r=ORDER.indexOf(a.s)-ORDER.indexOf(b.s)}
      else r=String(a[sortK]).localeCompare(String(b[sortK]),'zh');
      return r*sortDir});
    var pages=Math.max(1,Math.ceil(rows.length/PER));if(page>pages)page=pages;
    var cur=rows.slice((page-1)*PER,page*PER);
    $('#isbDetailTable').innerHTML='<thead><tr>'+COLS.map(function(c){var s=sortK===c[0]?(sortDir>0?'ascending':'descending'):null;return '<th'+(s?' aria-sort="'+s+'"':'')+(c[0]==='cny'?' class="r"':'')+(['srcN','kc'].indexOf(c[0])>-1?' class="hide-m"':'')+'><button data-k="'+c[0]+'">'+c[1]+ic('sort')+'</button></th>'}).join('')+'</tr></thead><tbody>'+
      (cur.length?cur.map(function(q){
        var fl=q.iss.map(function(i){return i==='跟进逾期'?'<span class="tag t-bad">逾期 '+q.late+' 天</span>':'<span class="tag t-plain">'+i+'</span>'}).join(' ')||'<span style="color:var(--faint)">—</span>';
        return '<tr><td><button type="button" class="cname" data-isb-id="'+esc(q.id)+'">'+esc(q.c)+'</button><span class="cprod">'+esc(q.p||'—')+'</span></td><td class="hide-m">'+esc(q.kc)+'</td><td class="hide-m">'+esc(q.srcN)+'</td><td class="numc">'+esc(q.d)+'</td><td>'+esc(ownerLabel(q.o))+'</td><td><span class="tag t-'+STG[q.s].k+'">'+q.s+'</span></td>'+
          '<td class="r amtc">'+(q.a!=null?'<b>'+(q.cur==='USD'?'$':q.cur==='CNY'?'¥':'')+Math.round(q.a).toLocaleString('zh-CN')+'</b>'+(q.cur==='USD'?'<small>≈ '+fmtCNY(q.cny)+'</small>':''):'<span style="color:var(--faint)">未报价</span>')+'</td><td>'+fl+'</td></tr>'}).join('')
      :'<tr><td colspan="8"><div class="empty">'+ic('search')+'<h3>没有找到匹配的询盘</h3><p>换个关键词，或清除上方筛选。</p></div></td></tr>')+'</tbody>';
    $$('#isbDetailTable [data-isb-id]').forEach(b=>b.onclick=()=>window.openInqModal?.(b.dataset.isbId));
    $$('#isbDetailTable th button').forEach(function(b){b.addEventListener('click',function(){var k=b.dataset.k;if(sortK===k)sortDir=-sortDir;else{sortK=k;sortDir=k==='d'||k==='cny'||k==='flag'?-1:1}detail(ALL.filter(function(q){return match(q)}));var nb=$('#isbDetailTable th button[data-k="'+k+'"]');nb&&nb.focus()})});
    var pg='';for(var i=1;i<=pages;i++)pg+='<button aria-current="'+(i===page)+'" aria-label="第 '+i+' 页" data-p="'+i+'">'+i+'</button>';
    $('#isbPager').innerHTML='<span>共 '+rows.length+' 条 · 第 '+((page-1)*PER+(rows.length?1:0))+'–'+Math.min(page*PER,rows.length)+' 条</span><span class="pg"><button data-p="'+(page-1)+'" aria-label="上一页"'+(page<=1?' disabled':'')+'>‹</button>'+pg+'<button data-p="'+(page+1)+'" aria-label="下一页"'+(page>=pages?' disabled':'')+'>›</button></span>';
  }
  $('#isbPager').addEventListener('click',function(e){var b=e.target.closest('button');if(!b||b.disabled)return;page=+b.dataset.p;detail(ALL.filter(function(q){return match(q)}));$('#inqstats-dh').scrollIntoView({block:'start'})});
  var dqT;$('#isbDetailSearch').addEventListener('input',function(e){clearTimeout(dqT);dqT=setTimeout(function(){dq=e.target.value.trim().toLowerCase();page=1;detail(ALL.filter(function(q){return match(q)}))},150)});

  $('#isbExport').addEventListener('click',function(){
    var R=ALL.filter(function(q){return match(q)}),head=['客户','产品','国家','来源','收到日期','负责人','状态','金额','币种','提醒'];
    var csv=[head].concat(R.map(function(q){return [q.c,q.p,q.kc,q.srcN,q.d,q.o,q.s,q.a==null?'':q.a,q.cur,q.iss.join('；')]})).map(function(r){return r.map(function(v){return '"'+String(v).replace(/^[=+@\-\t\r]/,m=>"'"+m).replace(/"/g,'""')+'"'}).join(',')}).join('\n');
    var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'}));a.download='询盘分析_'+TODAY+'.csv';a.click();ftwToast('已导出 '+R.length+' 条询盘');
  });


 window.renderInqStatsBoard=()=>{refreshRecords();fillOptions();render();};
 ['ftw:dataReady','ftw:inquiriesChanged','ftw:ratesReady'].forEach(name=>window.addEventListener(name,window.renderInqStatsBoard));
 window.onViewActivated=((original)=>view=>{original?.(view);if(view==='inqstats')window.renderInqStatsBoard();})(window.onViewActivated);
 window.renderInqStatsBoard();
})();
