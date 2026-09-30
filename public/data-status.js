(() => {
  const endpoints=['clients','orders','inquiries','quotations','tasks','products','suppliers','shipments'];
  let busy=false,lastUser='',lastFetch=0;
  function timestamp(value){
    if(value==null || value==='')return 0;
    const n=typeof value==='number'?value:/^\d+$/.test(String(value))?Number(value):Date.parse(value);
    return Number.isFinite(n)&&n>0?n:0;
  }
  async function refresh(){
    const target=document.getElementById('dataFreshnessTime');if(!target)return;
    const uid=typeof currentUser!=='undefined'&&currentUser?.id;
    if(!uid){lastUser='';target.textContent='登录后查看';target.removeAttribute('datetime');return;}
    if(busy || (lastUser===uid&&Date.now()-lastFetch<60000))return;
    busy=true;lastUser=uid;lastFetch=Date.now();target.textContent='正在查询…';
    try{
      const results=await Promise.allSettled(endpoints.map(async name=>{
        const r=await api('/api/'+name);if(!r.ok)throw Error('读取失败');
        const rows=await r.json();if(!Array.isArray(rows))throw Error('数据格式不符');
        return rows.reduce((latest,row)=>Math.max(latest,timestamp(row.updatedAt),timestamp(row.createdAt)),0);
      }));
      if(typeof currentUser==='undefined'||currentUser?.id!==uid)return;
      const ok=results.filter(r=>r.status==='fulfilled'),latest=Math.max(0,...ok.map(r=>r.value));
      target.removeAttribute('datetime');
      if(latest){const date=new Date(latest);target.dateTime=date.toISOString();target.textContent=date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})+(ok.length<endpoints.length?'（部分数据）':'');}
      else target.textContent=ok.length<endpoints.length?'暂时无法确认':'暂无更新时间记录';
    }finally{busy=false;}
  }
  setInterval(()=>{if(!document.hidden)refresh();},3000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  refresh();
})();
