import crypto from 'node:crypto';

const DRAFTS = 'inquiry-drafts', TOKENS = 'inquiry-mcp-tokens';
const sources = new Set(['alibaba-mc', 'alibaba-im', 'manual-test']);
const textFields = {clientName:300,country:120,contactName:160,contactEmail:300,contactPhone:120,product:1000,model:6000,notes:8000};
const fail = (message, status=400) => Object.assign(new Error(message), {status});
const object = value => !!value && typeof value==='object' && !Array.isArray(value);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const manager = user => ['admin','manager'].includes(user?.role);
function text(value, limit, label, required=false) {
  if (value!=null && typeof value!=='string') throw fail(label+'必须是文本');
  const result=String(value??'').trim();
  if (result.length>limit) throw fail(label+'超出长度限制',413);
  if (required&&!result) throw fail(label+'不能为空');
  return result;
}
export function draftFields(input={}) {
  if(!object(input))throw fail('字段格式错误');
  const out={};
  for(const [key,value] of Object.entries(input)) {
    if(Object.hasOwn(textFields,key))out[key]=text(value,textFields[key],key);
    else if(key==='expectedAmount') {
      if(value===''||value==null)out[key]=null;
      else if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e12)out[key]=value;
      else throw fail('金额必须是非负数字，未知时留空');
    } else if(key==='currency') {
      out[key]=text(value,3,'币种').toUpperCase();
      if(out[key]&&!/^[A-Z]{3}$/.test(out[key]))throw fail('币种使用三位代码，未知时留空');
    } else throw fail('不允许修改字段：'+key);
  }
  return out;
}
function sourceDate(value) {
  const input=text(value,60,'来源时间');
  if(!input)return {sentAt:'',receivedAt:''};
  if(/^\d{4}-\d{2}-\d{2}$/.test(input)&&Number.isFinite(Date.parse(input+'T00:00:00Z'))&&new Date(input+'T00:00:00Z').toISOString().slice(0,10)===input)return {sentAt:input,receivedAt:input};
  if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input)||!Number.isFinite(Date.parse(input)))throw fail('来源时间使用 YYYY-MM-DD 或带时区的 ISO 时间');
  const timestamp=new Date(input).toISOString();
  return {sentAt:timestamp,receivedAt:new Date(Date.parse(timestamp)+8*3600000).toISOString().slice(0,10)};
}
function expectedVersion(row, body) {
  if(!Number.isInteger(body.version)||body.version!==row.version)throw fail('草稿已变化，请重新查看后操作',409);
}

export function createInquiryIntakeRoutes({read,write,commit,body,send,users,audit,now=Date.now}) {
  const visible=(row,user,mcp)=>mcp?row.owner===user.id:(manager(user)||row.owner===user.id);
  const safeToken=token=>({id:token.id,label:token.label,preview:token.preview,createdAt:token.createdAt,expiresAt:token.expiresAt,revokedAt:token.revokedAt||null});
  function view(row) {
    const missingFields=['clientName','product'].filter(k=>!row.fields[k]);
    if(!row.receivedAt)missingFields.push('receivedAt');
    return {...row,missingFields,reviewPath:'/?inquiryDraft='+encodeURIComponent(row.id)+'#/enquiry'};
  }
  async function authenticate(req) {
    const value=String(req.headers.authorization||'');
    if(!/^Bearer ftw_mcp_[A-Za-z0-9_-]{43}$/.test(value))throw fail('请使用个人 MCP 接入凭据',401);
    const digest=Buffer.from(hash(value.slice(7)),'hex');
    const rows=await read(TOKENS);
    const token=rows.find(row=>typeof row.digest==='string'&&row.digest.length===64&&crypto.timingSafeEqual(digest,Buffer.from(row.digest,'hex')));
    if(!token||token.revokedAt||token.expiresAt<=now())throw fail('MCP 接入凭据已失效，请在 CRM 重新生成',401);
    const user=users().find(u=>u.id===token.owner);
    if(!user)throw fail('接入账号已不存在',401);
    return {id:user.id,name:user.name||user.username,username:user.username,role:user.role||'sales'};
  }
  return async function route(req,res,url,p,method,user) {
    const mcp=p.startsWith('/api/inquiry-mcp/');
    const tokenPath=p==='/api/inquiry-mcp-tokens'||p.startsWith('/api/inquiry-mcp-tokens/');
    const draftPath=p==='/api/inquiry-drafts'||p.startsWith('/api/inquiry-drafts/');
    if(!mcp&&!tokenPath&&!draftPath)return false;
    res.setHeader('Cache-Control','no-store');
    try {
      if(mcp)user=await authenticate(req);
      if(!user)throw fail('请先登录 CRM',401);
      if(!mcp&&!['GET','HEAD'].includes(method)&&req.headers.origin&&req.headers.origin!==new URL(req.url,'http://'+req.headers.host).origin)throw fail('请求来源不正确',403);
      if(mcp&&p==='/api/inquiry-mcp/whoami'&&method==='GET') {
        send(res,200,{user,capabilities:['create_draft','list_drafts','get_draft','update_draft'],confirmation:'crm_review_required'});return true;
      }
      if(tokenPath) {
        const rows=await read(TOKENS);
        if(p==='/api/inquiry-mcp-tokens'&&method==='GET') {send(res,200,rows.filter(t=>t.owner===user.id).map(safeToken));return true;}
        if(p==='/api/inquiry-mcp-tokens'&&method==='POST') {
          const input=await body(req);
          if(!object(input))throw fail('请求格式错误');
          if(rows.filter(t=>t.owner===user.id&&!t.revokedAt&&t.expiresAt>now()).length>=10)throw fail('最多保留十个有效凭据，请先撤销旧凭据');
          const secret='ftw_mcp_'+crypto.randomBytes(32).toString('base64url'),stamp=now();
          const item={id:'mt_'+crypto.randomUUID(),owner:user.id,label:text(input.label,100,'凭据名称')||'WorkBuddy',digest:hash(secret),preview:secret.slice(-6),createdAt:stamp,expiresAt:stamp+30*86400000,revokedAt:null};
          rows.push(item);await write(TOKENS,rows);audit(user,'create','inquiry-mcp-token',item.id,'创建个人 MCP 凭据');
          send(res,201,{...safeToken(item),token:secret});return true;
        }
        const match=p.match(/^\/api\/inquiry-mcp-tokens\/([\w-]+)$/);
        if(match&&method==='DELETE') {
          const item=rows.find(t=>t.id===match[1]&&t.owner===user.id);
          if(!item)throw fail('凭据不存在',404);
          item.revokedAt=now();await write(TOKENS,rows);audit(user,'delete','inquiry-mcp-token',item.id,'撤销个人 MCP 凭据');send(res,200,{ok:true});return true;
        }
        throw fail('接口不存在',404);
      }
      const root=mcp?'/api/inquiry-mcp/drafts':'/api/inquiry-drafts';
      if(!p.startsWith(root))throw fail('接口不存在',404);
      const rows=await read(DRAFTS);
      if(p===root&&method==='GET') {
        const state=url.searchParams.get('status')||'pending';
        if(!['pending','confirmed','linked','dismissed','all'].includes(state))throw fail('草稿状态错误');
        const page=Math.max(1,Number(url.searchParams.get('page'))||1),limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||20));
        const matches=rows.filter(row=>visible(row,user,mcp)&&(state==='all'||row.status===state)).sort((a,b)=>b.updatedAt-a.updatedAt);
        send(res,200,{items:matches.slice((page-1)*limit,page*limit).map(view),total:matches.length,page,limit});return true;
      }
      if(p===root&&method==='POST') {
        const input=await body(req);
        if(!object(input)||!sources.has(input.source))throw fail('来源必须是 alibaba-mc、alibaba-im 或 manual-test');
        const accountId=text(input.accountId,128,'来源账号',true),recordId=text(input.sourceRecordId,300,'来源记录编号',true);
        if(typeof input.rawText!=='string'||!input.rawText.trim()||input.rawText.length>60000)throw fail('原文必填且不超过 60000 字符');
        if(input.isTest!==undefined&&typeof input.isTest!=='boolean')throw fail('isTest 必须是布尔值');
        const sourceKey=JSON.stringify([input.source,accountId,recordId]);
        const id='d_'+hash(sourceKey).slice(0,60),old=rows.find(row=>row.id===id);
        if(old) {
          if(!visible(old,user,mcp))throw fail('同一来源记录已由其他账号接入，请让经理核对',409);
          const same=old.rawHash===hash(input.rawText)||old.sourceUpdates?.some(update=>update.rawHash===hash(input.rawText));
          if(!same) {
            if((old.sourceUpdates||[]).length>=10)throw fail('同源原文变更过多，请人工核对',409);
            old.sourceUpdates=[...(old.sourceUpdates||[]),{rawText:input.rawText,rawHash:hash(input.rawText),observedAt:now()}];
            old.updatedAt=now();old.version++;await write(DRAFTS,rows);
          }
          send(res,200,{created:false,duplicate:true,sourceChanged:!same,draft:view(old)});return true;
        }
        const fields=draftFields(input.fields||{}),dates=sourceDate(input.sourceSentAt),stamp=now();
        const rawPayload=input.rawPayload??null;
        if(rawPayload!==null&&(!object(rawPayload)||Buffer.byteLength(JSON.stringify(rawPayload))>128*1024))throw fail('原始来源数据必须是对象且不超过 128KB');
        const item={id,source:input.source,accountId,sourceRecordId:recordId,sourceSentAt:dates.sentAt,receivedAt:dates.receivedAt,rawText:input.rawText,rawHash:hash(input.rawText),rawPayload,fields,isTest:input.source==='manual-test'||input.isTest===true,owner:user.id,ownerName:user.name,status:'pending',version:1,createdAt:stamp,updatedAt:stamp,sourceUpdates:[],inquiryId:null};
        rows.push(item);await write(DRAFTS,rows);audit(user,'create','inquiry-draft',item.id,'保存来源草稿');send(res,201,{created:true,duplicate:false,draft:view(item)});return true;
      }
      const match=p.slice(root.length).match(/^\/([\w-]+)(?:\/(confirm|link|dismiss))?$/);
      if(!match)throw fail('接口不存在',404);
      const item=rows.find(row=>row.id===match[1]);
      if(!item||!visible(item,user,mcp))throw fail('草稿不存在或无访问权限',404);
      const action=match[2];
      if(!action&&method==='GET') {send(res,200,view(item));return true;}
      if(mcp&&action)throw fail('请由业务员在 CRM 核对页操作，MCP 凭据不能正式登记或忽略记录',403);
      const input=await body(req);if(!object(input))throw fail('请求格式错误');
      if(!action&&method==='PUT') {
        if(item.status!=='pending')throw fail('已处理草稿不能再修改',409);
        expectedVersion(item,input);item.fields={...item.fields,...draftFields(input.fields)};
        if(mcp&&('receivedAt' in input||'clientId' in input))throw fail('MCP 只能补充字段候选，客户关联和日期修正请在 CRM 核对页操作',403);
        if(!mcp&&'receivedAt' in input)item.receivedAt=sourceDate(input.receivedAt).receivedAt;
        if(!mcp&&'clientId' in input) {
          item.clientId=text(input.clientId,64,'客户编号');
          if(item.clientId) {
            const client=(await read('clients')).find(row=>row.id===item.clientId);
            if(!client||!(manager(user)||client.owner===user.id))throw fail('无权关联该客户',403);
            item.fields.clientName=client.company;
          }
        }
        item.updatedAt=now();item.version++;
        await write(DRAFTS,rows);audit(user,'update','inquiry-draft',item.id,'修改待确认字段');send(res,200,view(item));return true;
      }
      if(action&&method==='POST') {
        if(item.status!=='pending') {
          if((item.status==='confirmed'&&action==='confirm')||(item.status==='linked'&&action==='link')||(item.status==='dismissed'&&action==='dismiss')) {send(res,200,{alreadyProcessed:true,draft:view(item),inquiryId:item.inquiryId});return true;}
          throw fail('草稿已经处理，请重新查看',409);
        }
        expectedVersion(item,input);
        if(action==='dismiss') {
          item.dismissReason=text(input.reason,1000,'非询盘原因',true);item.status='dismissed';item.processedBy=user.id;item.processedByName=user.name;item.processedAt=now();item.updatedAt=now();item.version++;
          await write(DRAFTS,rows);audit(user,'update','inquiry-draft',item.id,'标记非询盘');send(res,200,{draft:view(item)});return true;
        }
        if(item.isTest)throw fail('测试草稿不能进入正式询盘；可在核对页标记为非询盘',409);
        const inquiries=await read('inquiries');
        let inquiry;
        if(action==='link') {
          inquiry=inquiries.find(row=>row.id===input.inquiryId);
          if(!inquiry||!(manager(user)||inquiry.owner===user.id))throw fail('无权关联该询盘',403);
          item.status='linked';
        } else {
          const fields={...item.fields,...draftFields(input.fields||{})};
          let client=null;
          const clientId=input.clientId??item.clientId;
          if(clientId) {
            client=(await read('clients')).find(row=>row.id===clientId);
            if(!client||!(manager(user)||client.owner===user.id))throw fail('无权关联该客户',403);
            fields.clientName=client.company;
          }
          if(!fields.clientName||!fields.product)throw fail('请核对客户名称与产品需求后再登记');
          const dates=sourceDate(input.receivedAt||item.receivedAt);
          if(!dates.receivedAt)throw fail('收到日期未知，请在核对页补充');
          if(!users().some(u=>u.id===item.owner))throw fail('原负责人已不存在，请经理核对');
          if(fields.expectedAmount!=null&&!fields.currency)throw fail('已填金额时必须核对币种');
          const stamp=now();
          inquiry={id:crypto.randomUUID(),...fields,clientId:client?.id||'',receivedAt:dates.receivedAt,source:item.source.startsWith('alibaba-')?'阿里巴巴':'其他',status:'新询盘',owner:item.owner,ownerName:users().find(u=>u.id===item.owner)?.name||item.ownerName,chatLog:item.rawText+(item.sourceUpdates.length?'\n\n来源后续原文：\n'+item.sourceUpdates.map(u=>u.rawText).join('\n\n'):''),createdAt:stamp,updatedAt:stamp,sampleSent:'',stageLog:[]};
          inquiries.push(inquiry);item.fields=fields;item.receivedAt=dates.receivedAt;item.status='confirmed';
        }
        item.inquiryId=inquiry.id;item.clientId=inquiry.clientId||'';item.processedBy=user.id;item.processedByName=user.name;item.processedAt=now();item.updatedAt=now();item.version++;
        await commit({inquiries,[DRAFTS]:rows});audit(user,'create','inquiry-draft',item.id,'草稿'+(action==='link'?'关联已有询盘':'确认登记'));
        send(res,200,{draft:view(item),inquiryId:inquiry.id});return true;
      }
      throw fail('不支持的操作',405);
    } catch(error) {if(!error.status)console.error('[inquiry-intake]',error.code||error.name);send(res,error.status||500,{error:error.status?error.message:'草稿服务暂不可用，请重试'});return true;}
  };
}
