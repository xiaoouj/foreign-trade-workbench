// Suggestions only: this module never writes, merges, or deletes customer records.
(function (root) {
  const text = value => String(value ?? '').normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '').trim().toLowerCase();
  const normalizeName = value => text(value).replace(/[^\p{L}\p{N}]+/gu, '');
  const normalizeEmail = value => {
    const email = text(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : '';
  };
  const normalizePhone = value => {
    const phone = text(value).replace(/[^0-9]/g, '');
    return phone.length >= 6 ? phone : '';
  };
  function nameCore(value) {
    const words = text(value).replace(/[.,]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const suffixes = new Set(['llc','ltd','limited','inc','incorporated','corp','corporation','company','co','gmbh','llp','plc','association']);
    while (words.length > 1 && suffixes.has(words.at(-1))) words.pop();
    return normalizeName(words.join('')).replace(/(?:有限责任公司|股份有限公司|有限公司|公司)$/u, '');
  }
  function editDistance(left, right, limit) {
    if (Math.abs(left.length-right.length) > limit) return limit+1;
    let previous = Array.from({length:right.length+1}, (_,i)=>i);
    for (let i=1;i<=left.length;i++) {
      const current = [i];
      let smallest = i;
      for (let j=1;j<=right.length;j++) {
        current[j] = Math.min(previous[j]+1, current[j-1]+1, previous[j-1]+(left[i-1]!==right[j-1]));
        smallest = Math.min(smallest, current[j]);
      }
      if (smallest > limit) return limit+1;
      previous = current;
    }
    return previous[right.length];
  }
  function findGroups(records) {
    const rows = Array.isArray(records) ? records.filter(Boolean) : [];
    const parent = rows.map((_,i)=>i), owners = new Map(), links=[];
    const find = index => {
      while (parent[index]!==index) { parent[index]=parent[parent[index]];index=parent[index]; }
      return index;
    };
    const union = (left,right) => { parent[find(left)]=find(right); };
    const entries = rows.map((record,index)=>({record,index,name:normalizeName(record.company),core:nameCore(record.company),country:normalizeName(record.country),contact:normalizeName(record.contactName)}));
    for (const entry of entries) {
      const keys = [['company',entry.name,'公司名一致（忽略大小写、空格及标点）'],['phone',normalizePhone(entry.record.contactPhone),'联系电话一致'],['email',normalizeEmail(entry.record.contactEmail),'联系邮箱一致（忽略大小写）']];
      for (const [kind,value,reason] of keys) {
        if (!value) continue;
        const key=kind+':'+value;
        if (owners.has(key)) { const other=owners.get(key);union(other,entry.index);links.push({left:other,right:entry.index,reason}); }
        else owners.set(key,entry.index);
      }
    }
    const clusters = new Map();
    entries.forEach(entry=>{const key=find(entry.index);if(!clusters.has(key))clusters.set(key,[]);clusters.get(key).push(entry.record);});
    const groups = [...clusters].filter(([,records])=>records.length>1).map(([key,records])=>({records,type:'exact',reasons:[...new Set(links.filter(link=>find(link.left)===key).map(link=>link.reason))]}));
    // Similar names remain independent pairs: do not merge fuzzy matches transitively.
    for (let i=0;i<entries.length;i++) for (let j=i+1;j<entries.length;j++) {
      const left=entries[i],right=entries[j];
      if (find(i)===find(j)) continue;
      if (left.country && right.country && left.country!==right.country) continue;
      const a=Array.from(left.core),b=Array.from(right.core),longest=Math.max(a.length,b.length);
      if (Math.min(a.length,b.length)<8) continue;
      const limit=Math.min(3,Math.floor(longest*0.15));
      if (Math.abs(a.length-b.length)>limit) continue;
      const distance=editDistance(a,b,limit);
      if (distance>limit) continue;
      const reasons=[distance===0?'名称主体相同（公司后缀或写法不同）':`名称相近（文本相似度 ${Math.round((1-distance/longest)*100)}%）`];
      if (left.country && left.country===right.country) reasons.push('国家一致');
      if (left.contact && left.contact===right.contact) reasons.push('联系人同名');
      groups.push({records:[left.record,right.record],type:'similar',reasons});
    }
    return groups;
  }
  root.ftwClientDedup = Object.freeze({normalizeName,findGroups});
})(globalThis);
