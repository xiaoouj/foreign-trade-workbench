/* Ali Chat Reader + Workbench CRM Sync - side panel */
(function () {
  'use strict';

  var DEFAULT_WB_URL = 'http://localhost:4173';
  var state = {
    tabId: null,
    frameId: null,
    data: null,
    diagnose: null,
    wbUrl: DEFAULT_WB_URL,
    wbFallbackUrl: '',
    activeUrl: DEFAULT_WB_URL,
    activeRoute: '',
    wbToken: '',
    wbContext: null,
    match: null,
    dupCandidate: null,
  };
  var $ = function (id) { return document.getElementById(id); };

  function showToast(text) {
    var toast = $('toast');
    toast.textContent = text;
    toast.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toast.classList.add('hidden'); }, 2200);
  }

  function setStatus(text, tone) {
    var badge = $('statusBadge');
    badge.textContent = text;
    badge.className = 'badge ' + (tone || 'badge-gray');
  }

  function setText(id, value) {
    $(id).textContent = value || '—';
  }

  function storageGet(keys) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(keys, function (res) { resolve(res || {}); });
      } catch (e) { resolve({}); }
    });
  }

  function storageSet(obj) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.set(obj, function () { resolve(); });
      } catch (e) { resolve(); }
    });
  }

  function normalizeWbUrl(raw, allowEmpty) {
    var s = String(raw || '').trim().replace(/\/+$/, '');
    if (!s) return allowEmpty ? '' : DEFAULT_WB_URL;
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
  }

  async function probeUrl(baseUrl, timeoutMs) {
    if (!baseUrl) return false;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 1500) : null;
    try {
      var res = await fetch(baseUrl + '/api/version', {
        method: 'GET',
        signal: controller ? controller.signal : undefined,
      });
      return res.ok;
    } catch (e) {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function resolveActiveUrl() {
    var primary = normalizeWbUrl(state.wbUrl);
    var fallback = normalizeWbUrl(state.wbFallbackUrl, true);
    if (await probeUrl(primary, 1500)) {
      state.activeUrl = primary;
      state.activeRoute = '内网';
      return primary;
    }
    if (fallback && fallback !== primary && await probeUrl(fallback, 4000)) {
      state.activeUrl = fallback;
      state.activeRoute = '隧道';
      return fallback;
    }
    state.activeUrl = primary;
    state.activeRoute = '';
    return '';
  }

  async function requestOnBase(baseUrl, path, opts) {
    var headers = Object.assign({}, opts.headers || {});
    if (opts.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (state.wbToken) headers.Authorization = 'Bearer ' + state.wbToken;
    var res = await fetch(baseUrl + path, {
      method: opts.method || 'GET',
      headers: headers,
      credentials: 'include',
      body: opts.body === undefined ? undefined : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)),
    });
    var json = null;
    try { json = await res.json(); } catch (e) {}
    if (!res.ok) {
      var err = new Error((json && json.error) || ('HTTP ' + res.status));
      err.status = res.status;
      err.data = json;
      throw err;
    }
    return json;
  }

  async function wbFetch(path, options) {
    var opts = options || {};
    var target = state.activeUrl || normalizeWbUrl(state.wbUrl);
    try {
      return await requestOnBase(target, path, opts);
    } catch (err) {
      // 业务 HTTP 状态错误（401/403/400/409/500 等）说明链路已通，直接抛出
      if (err && typeof err.status === 'number') throw err;
      // 网络断开时自动重新探测内网与备用隧道
      var next = await resolveActiveUrl();
      if (!next) throw err;
      return await requestOnBase(next, path, opts);
    }
  }

  function setWbConnState(connected, text) {
    var badge = $('wbConnBadge');
    badge.textContent = text || (connected ? '工作台已连接' : '工作台未连接');
    badge.className = 'badge ' + (connected ? 'badge-green' : 'badge-warn');
  }

  async function loadWorkbenchContext() {
    $('wbUrlInput').value = state.wbUrl;
    $('wbFallbackInput').value = state.wbFallbackUrl || '';
    var reachable = await resolveActiveUrl();
    if (!reachable) {
      state.wbContext = null;
      $('wbUserLabel').textContent = '';
      setWbConnState(false, state.wbFallbackUrl ? '内网与隧道均不通' : '连接失败');
      $('wbLogoutBtn').classList.add('hidden');
      return false;
    }
    try {
      var ctx = await wbFetch('/api/chat-sync/context');
      state.wbContext = ctx;
      setWbConnState(true, state.activeRoute ? ('已连接 · ' + state.activeRoute) : '已连接工作台');
      $('wbUserLabel').textContent = (ctx.user && (ctx.user.name || ctx.user.username)) || '';
      $('wbLoginBox').classList.add('hidden');
      $('wbLogoutBtn').classList.toggle('hidden', !state.wbToken);
      $('crmNeedLogin').classList.add('hidden');
      return true;
    } catch (err) {
      state.wbContext = null;
      $('wbUserLabel').textContent = '';
      if (err && err.status === 401) {
        setWbConnState(false, (state.activeRoute ? state.activeRoute + ' · ' : '') + '未登录');
        $('wbLoginBox').classList.remove('hidden');
        $('wbPanel').classList.remove('hidden');
      } else {
        setWbConnState(false, '连接失败');
      }
      $('wbLogoutBtn').classList.add('hidden');
      return false;
    }
  }

  function populateOwnerSelect(selectEl, resolvedOwner) {
    selectEl.innerHTML = '';
    var ctx = state.wbContext;
    var list = (ctx && ctx.salesUsers) || [];
    list.forEach(function (u) {
      var opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name + (u.role === 'admin' ? ' (管理员)' : u.role === 'manager' ? ' (经理)' : '');
      selectEl.appendChild(opt);
    });
    if (resolvedOwner && resolvedOwner.owner) selectEl.value = resolvedOwner.owner;
    selectEl.disabled = !!(resolvedOwner && resolvedOwner.locked);
  }

  function populateClientSelect(selectEl, clientsList, keyword) {
    var q = String(keyword || '').trim().toLowerCase();
    selectEl.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— 请选择工作台客户 —';
    selectEl.appendChild(placeholder);
    var filtered = (clientsList || []).filter(function (c) {
      if (!q) return true;
      return [c.company, c.contactName, c.contactEmail, c.country].some(function (v) {
        return String(v || '').toLowerCase().indexOf(q) >= 0;
      });
    }).slice(0, 80);
    filtered.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.company + (c.country ? ' · ' + c.country : '') + (c.ownerName ? ' (' + c.ownerName + ')' : '');
      selectEl.appendChild(opt);
    });
  }

  function renderMatchState() {
    var card = $('crmCard');
    var data = state.data;
    if (!data || !data.ok) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    if (!state.wbContext) {
      $('crmNeedLogin').classList.remove('hidden');
      $('crmMatched').classList.add('hidden');
      $('crmUnmatched').classList.add('hidden');
      $('crmSyncBadge').textContent = '需登录';
      $('crmSyncBadge').className = 'badge badge-warn';
      return;
    }
    $('crmNeedLogin').classList.add('hidden');
    var m = state.match;
    if (!m) return;

    var syncedSet = new Set(m.syncedMessageIds || []);
    var validMsgs = (data.messages || []).filter(function (x) { return x.side !== 'system' && x.text; });
    var newCount = validMsgs.filter(function (x) { return x.id && !syncedSet.has(x.id); }).length;

    if (m.matched && m.client) {
      $('crmMatched').classList.remove('hidden');
      $('crmUnmatched').classList.add('hidden');
      $('crmClientName').textContent = m.client.company || '—';
      $('crmClientMeta').textContent = [
        m.client.country || '',
        m.client.contactName || '',
        m.client.ownerName ? ('原负责人: ' + m.client.ownerName) : ''
      ].filter(Boolean).join(' · ') || '工作台客户';
      var typeLabels = { binding: '已永久绑定', email: '邮箱匹配', company: '公司名匹配', phone: '电话匹配' };
      $('crmMatchTypeBadge').textContent = typeLabels[m.matchType] || '已匹配';

      if (newCount > 0) {
        $('crmSyncBadge').textContent = newCount + ' 条新消息';
        $('crmSyncBadge').className = 'badge badge-blue';
      } else {
        $('crmSyncBadge').textContent = '已是最新';
        $('crmSyncBadge').className = 'badge badge-green';
      }

      var recentBox = $('crmRecentComm');
      if (m.recentComms && m.recentComms.length) {
        var lastComm = m.recentComms[0];
        recentBox.textContent = '上次同步（' + (lastComm.date || '') + '）：' + (lastComm.summary || '—');
        recentBox.classList.remove('hidden');
      } else {
        recentBox.classList.add('hidden');
      }

      populateOwnerSelect($('crmOwnerSelect'), m.resolvedOwner);

      var inqSel = $('crmInquirySelect');
      inqSel.innerHTML = '';
      (m.inquiries || []).forEach(function (iq) {
        var opt = document.createElement('option');
        opt.value = iq.id;
        opt.textContent = (iq.product || '未填产品') + ' · ' + (iq.status || '新询盘');
        opt.dataset.status = iq.status || '新询盘';
        opt.dataset.nextFollow = iq.nextFollowAt || '';
        inqSel.appendChild(opt);
      });
      var optNew = document.createElement('option');
      optNew.value = '__new__';
      optNew.textContent = '+ 新建一条询盘';
      inqSel.appendChild(optNew);
      var optComm = document.createElement('option');
      optComm.value = '__comm_only__';
      optComm.textContent = '仅记沟通记录（不改询盘）';
      inqSel.appendChild(optComm);

      if (m.inquiries && m.inquiries.length) {
        inqSel.value = m.inquiries[0].id;
      } else {
        inqSel.value = '__comm_only__';
      }
      updateSyncInqVisibility();
      populateClientSelect($('crmRebindSelect'), state.wbContext.clients, $('crmRebindSearch').value);
    } else {
      $('crmMatched').classList.add('hidden');
      $('crmUnmatched').classList.remove('hidden');
      $('crmSyncBadge').textContent = '未建档';
      $('crmSyncBadge').className = 'badge badge-warn';

      var candWrap = $('crmCandidatesWrap');
      var candBox = $('crmCandidates');
      candBox.innerHTML = '';
      if (m.candidates && m.candidates.length) {
        candWrap.classList.remove('hidden');
        m.candidates.forEach(function (cand) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'crm-cand-btn';
          btn.textContent = cand.company + (cand.country ? ' · ' + cand.country : '');
          btn.addEventListener('click', function () { bindExistingClient(cand.id); });
          candBox.appendChild(btn);
        });
      } else {
        candWrap.classList.add('hidden');
      }
      populateClientSelect($('crmBindSelect'), state.wbContext.clients, $('crmBindSearch').value);
      populateOwnerSelect($('crmCreateOwnerSelect'), m.resolvedOwner);
    }
  }

  function updateSyncInqVisibility() {
    var val = $('crmInquirySelect').value;
    $('crmSyncInqFields').classList.toggle('hidden', val === '__comm_only__');
    $('crmSyncNewInqExtra').classList.toggle('hidden', val !== '__new__');
  }

  async function syncMatchWithWorkbench(data) {
    if (!data || !data.ok || !state.wbContext) {
      renderMatchState();
      return;
    }
    $('crmSyncBadge').textContent = '匹配中…';
    $('crmSyncBadge').className = 'badge badge-blue';
    try {
      var conv = data.conversation || {};
      var res = await wbFetch('/api/chat-sync/match', {
        method: 'POST',
        body: {
          channel: 'alibaba',
          customerId: conv.buyer && conv.buyer.customerId,
          imInquiryId: conv.imInquiryId,
          buyer: conv.buyer || {},
          seller: conv.seller || {},
        },
      });
      state.match = res;
      $('crmSyncPreview').classList.add('hidden');
      $('crmCreatePreview').classList.add('hidden');
      $('crmDupBox').classList.add('hidden');
      renderMatchState();
    } catch (err) {
      if (err && err.status === 401) {
        state.wbContext = null;
        setWbConnState(false, '登录已过期');
        $('wbLoginBox').classList.remove('hidden');
      }
      renderMatchState();
    }
  }

  async function bindExistingClient(clientId) {
    if (!clientId) return showToast('请先选择要绑定的客户');
    var conv = (state.data && state.data.conversation) || {};
    try {
      await wbFetch('/api/chat-sync/bind', {
        method: 'POST',
        body: {
          channel: 'alibaba',
          clientId: clientId,
          customerId: conv.buyer && conv.buyer.customerId,
          imInquiryId: conv.imInquiryId,
          buyer: conv.buyer || {},
        },
      });
      showToast('已绑定到工作台客户');
      $('crmRebindBox').classList.add('hidden');
      await syncMatchWithWorkbench(state.data);
    } catch (err) {
      showToast('绑定失败：' + err.message);
    }
  }

  async function analyzeForSync() {
    if (!state.data || !state.match) return;
    var btn = $('crmAnalyzeSyncBtn');
    btn.disabled = true;
    btn.textContent = '✨ 分析中…';
    try {
      var conv = state.data.conversation || {};
      var res = await wbFetch('/api/chat-sync/analyze', {
        method: 'POST',
        body: {
          channel: 'alibaba',
          clientId: state.match.client && state.match.client.id,
          imInquiryId: conv.imInquiryId,
          buyer: conv.buyer || {},
          messages: state.data.messages || [],
          syncedMessageIds: state.match.syncedMessageIds || [],
          onlyUnsynced: true,
        },
      });
      $('crmSyncSummary').value = res.summary || '';
      var iq = res.inquiryDraft || {};
      if (iq.status) $('crmSyncStatus').value = iq.status;
      if (iq.nextFollowAt) $('crmSyncNextDate').value = iq.nextFollowAt;
      if (iq.product) $('crmSyncProduct').value = iq.product;
      if (iq.expectedAmount != null) $('crmSyncAmount').value = String(iq.expectedAmount);

      var tk = res.taskDraft || {};
      $('crmSyncTaskChk').checked = !!tk.action;
      $('crmSyncTaskFields').classList.toggle('hidden', !tk.action);
      $('crmSyncTaskAction').value = tk.action || '';
      $('crmSyncTaskDue').value = tk.dueDate || '';

      if (res.replyDraft) {
        $('crmSyncReplyText').textContent = res.replyDraft;
        $('crmSyncReplyWrap').classList.remove('hidden');
      } else {
        $('crmSyncReplyWrap').classList.add('hidden');
      }
      $('crmSyncPreview').classList.remove('hidden');
      if (res.aiFallback) showToast('AI 暂不可用，已用规则生成草稿（可手动修改）');
      else showToast('已分析 ' + (res.analyzedMessageCount || 0) + ' 条消息');
    } catch (err) {
      showToast('分析失败：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ AI 提取进度小结';
    }
  }

  async function commitSync() {
    if (!state.data || !state.match || !state.match.client) return;
    var summary = $('crmSyncSummary').value.trim();
    if (!summary) return showToast('请填写进度小结');
    var btn = $('crmCommitSyncBtn');
    btn.disabled = true;
    btn.textContent = '写入中…';
    try {
      var conv = state.data.conversation || {};
      var inqSelVal = $('crmInquirySelect').value;
      var inquiryPayload = null;
      if (inqSelVal === '__new__') {
        inquiryPayload = {
          action: 'create',
          product: $('crmSyncProduct').value.trim(),
          expectedAmount: $('crmSyncAmount').value ? Number($('crmSyncAmount').value) : 0,
          status: $('crmSyncStatus').value,
          nextFollowAt: $('crmSyncNextDate').value,
        };
      } else if (inqSelVal && inqSelVal !== '__comm_only__') {
        inquiryPayload = {
          action: 'update',
          inquiryId: inqSelVal,
          status: $('crmSyncStatus').value,
          nextFollowAt: $('crmSyncNextDate').value,
        };
      }
      await wbFetch('/api/chat-sync/commit', {
        method: 'POST',
        body: {
          mode: 'sync',
          channel: 'alibaba',
          clientId: state.match.client.id,
          customerId: conv.buyer && conv.buyer.customerId,
          imInquiryId: conv.imInquiryId,
          ownerId: $('crmOwnerSelect').value,
          buyerOwnerHint: conv.buyer && conv.buyer.owner,
          buyer: conv.buyer || {},
          summary: summary,
          messages: state.data.messages || [],
          inquiry: inquiryPayload,
          task: {
            create: $('crmSyncTaskChk').checked,
            action: $('crmSyncTaskAction').value.trim(),
            dueDate: $('crmSyncTaskDue').value,
          },
        },
      });
      showToast('✅ 进度已同步到工作台');
      $('crmSyncPreview').classList.add('hidden');
      await syncMatchWithWorkbench(state.data);
    } catch (err) {
      showToast('同步失败：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '✅ 确认写入工作台';
    }
  }

  async function analyzeForCreate() {
    if (!state.data) return;
    var btn = $('crmAnalyzeCreateBtn');
    btn.disabled = true;
    btn.textContent = '✨ 识别中…';
    try {
      var conv = state.data.conversation || {};
      var res = await wbFetch('/api/chat-sync/analyze', {
        method: 'POST',
        body: {
          channel: 'alibaba',
          imInquiryId: conv.imInquiryId,
          buyer: conv.buyer || {},
          messages: state.data.messages || [],
          onlyUnsynced: false,
        },
      });
      var cd = res.clientDraft || {};
      $('crmNewCompany').value = cd.company || '';
      $('crmNewContact').value = cd.contactName || '';
      $('crmNewCountry').value = cd.country || '';
      $('crmNewEmail').value = cd.contactEmail || '';
      $('crmNewPhone').value = cd.contactPhone || '';

      var iq = res.inquiryDraft || {};
      $('crmNewProduct').value = iq.product || '';
      $('crmNewModel').value = iq.model || '';
      $('crmNewAmount').value = iq.expectedAmount != null ? String(iq.expectedAmount) : '';
      $('crmNewCurrency').value = iq.currency || 'USD';
      if (iq.status) $('crmNewInqStatus').value = iq.status;
      $('crmNewNextDate').value = iq.nextFollowAt || '';
      $('crmNewSummary').value = res.summary || '';

      var tk = res.taskDraft || {};
      $('crmNewTaskChk').checked = !!tk.action;
      $('crmNewTaskBox').classList.toggle('hidden', !tk.action);
      $('crmNewTaskAction').value = tk.action || '';
      $('crmNewTaskDue').value = tk.dueDate || '';

      if (res.replyDraft) {
        $('crmNewReplyText').textContent = res.replyDraft;
        $('crmNewReplyWrap').classList.remove('hidden');
      } else {
        $('crmNewReplyWrap').classList.add('hidden');
      }
      $('crmDupBox').classList.add('hidden');
      state.dupCandidate = null;
      $('crmCreatePreview').classList.remove('hidden');
      if (res.aiFallback) showToast('AI 暂不可用，已预填页面信息（可手动补充）');
    } catch (err) {
      showToast('识别失败：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ AI 识别并一键建档';
    }
  }

  async function commitCreate(forceCreate) {
    if (!state.data) return;
    var company = $('crmNewCompany').value.trim();
    if (!company) return showToast('请填写客户公司或名称');
    var btn = $('crmCommitCreateBtn');
    btn.disabled = true;
    btn.textContent = '建档中…';
    try {
      var conv = state.data.conversation || {};
      var createInq = $('crmNewInqChk').checked;
      await wbFetch('/api/chat-sync/commit', {
        method: 'POST',
        body: {
          mode: 'create',
          forceCreate: !!forceCreate,
          channel: 'alibaba',
          customerId: conv.buyer && conv.buyer.customerId,
          imInquiryId: conv.imInquiryId,
          ownerId: $('crmCreateOwnerSelect').value,
          buyerOwnerHint: conv.buyer && conv.buyer.owner,
          buyer: conv.buyer || {},
          clientDraft: {
            company: company,
            contactName: $('crmNewContact').value.trim(),
            country: $('crmNewCountry').value.trim(),
            contactEmail: $('crmNewEmail').value.trim(),
            contactPhone: $('crmNewPhone').value.trim(),
          },
          summary: $('crmNewSummary').value.trim(),
          messages: state.data.messages || [],
          inquiry: createInq ? {
            action: 'create',
            product: $('crmNewProduct').value.trim(),
            model: $('crmNewModel').value.trim(),
            expectedAmount: $('crmNewAmount').value ? Number($('crmNewAmount').value) : 0,
            currency: $('crmNewCurrency').value.trim() || 'USD',
            status: $('crmNewInqStatus').value,
            nextFollowAt: $('crmNewNextDate').value,
          } : null,
          task: {
            create: $('crmNewTaskChk').checked,
            action: $('crmNewTaskAction').value.trim(),
            dueDate: $('crmNewTaskDue').value,
          },
        },
      });
      showToast('✅ 新客户已建档并绑定');
      $('crmCreatePreview').classList.add('hidden');
      $('crmDupBox').classList.add('hidden');
      await loadWorkbenchContext();
      await syncMatchWithWorkbench(state.data);
    } catch (err) {
      if (err && err.status === 409 && err.data && err.data.duplicateClient) {
        state.dupCandidate = err.data.duplicateClient;
        $('crmDupText').textContent = err.data.error || '工作台已有相似客户';
        $('crmDupBox').classList.remove('hidden');
      } else {
        showToast('建档失败：' + err.message);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '✅ 确认建档并绑定';
    }
  }

  function fillBuyer(buyer) {
    var card = $('buyerCard');
    if (!buyer || (!buyer.name && !buyer.company && !buyer.email)) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    buyer = buyer || {};
    setText('buyerName', buyer.name);
    setText('buyerCompany', buyer.company);
    setText('buyerEmail', buyer.email);
    setText('buyerRegisteredAt', buyer.registeredAt);
    setText('buyerCountry', (buyer.country || '—') + (buyer.countryCode ? ' · ' + buyer.countryCode : ''));
    setText('buyerTags', (buyer.tags || []).join(' / '));
    setText('buyerFeatures', (buyer.features || []).join(' / '));
    setText('buyerAvatar', (buyer.name || '?').trim().charAt(0).toUpperCase());
    var owner = buyer.owner || buyer.ownerRaw || '未识别';
    var ownerBadge = $('ownerBadge');
    ownerBadge.textContent = owner;
    ownerBadge.title = buyer.ownerRaw || '';
    var link = $('customerDetailLink');
    if (buyer.customerDetailUrl) {
      link.href = buyer.customerDetailUrl;
      link.style.display = '';
    } else {
      link.style.display = 'none';
    }
  }

  function fillConversations(conversations) {
    var card = $('conversationCard');
    var list = $('conversationList');
    list.innerHTML = '';
    if (!conversations || !conversations.length) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    $('conversationCount').textContent = conversations.length + ' 个会话';
    conversations.forEach(function (conv) {
      var item = document.createElement('div');
      item.className = 'conv-item' + (conv.unread ? ' unread' : '');
      var dot = document.createElement('span');
      dot.className = 'conv-dot';
      item.appendChild(dot);
      var main = document.createElement('div');
      main.className = 'conv-main';
      var top = document.createElement('div');
      top.className = 'conv-top';
      var name = document.createElement('span');
      name.className = 'conv-name';
      name.textContent = conv.name || '';
      var time = document.createElement('span');
      time.className = 'conv-time';
      time.textContent = conv.lastTime || '';
      top.appendChild(name);
      top.appendChild(time);
      main.appendChild(top);
      if (conv.company) {
        var sub = document.createElement('div');
        sub.className = 'conv-sub';
        sub.textContent = conv.company;
        main.appendChild(sub);
      }
      var last = document.createElement('div');
      last.className = 'conv-last';
      last.textContent = conv.lastMessage || '';
      main.appendChild(last);
      item.appendChild(main);
      list.appendChild(item);
    });
  }

  function messageRow(message) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + (message.side || 'other');
    var meta = document.createElement('div');
    meta.className = 'msg-meta';
    var sideLabel = message.side === 'buyer' ? '客户' : message.side === 'seller' ? '我方' : '系统';
    var tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = sideLabel;
    meta.appendChild(tag);
    var sender = document.createElement('span');
    sender.textContent = message.sender || '';
    meta.appendChild(sender);
    var time = document.createElement('span');
    time.textContent = message.sentAt || '';
    meta.appendChild(time);
    wrap.appendChild(meta);
    var bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = message.text || '';
    wrap.appendChild(bubble);
    if (message.translation && message.translation !== message.text) {
      var tr = document.createElement('div');
      tr.className = 'msg translation';
      var trBubble = document.createElement('div');
      trBubble.className = 'msg-bubble';
      trBubble.textContent = '译：' + message.translation;
      tr.appendChild(trBubble);
      wrap.appendChild(tr);
    }
    return wrap;
  }

  function fillMessages(data) {
    var list = $('messageList');
    list.innerHTML = '';
    var messages = (data.messages || []).slice().sort(function (a, b) { return (b.sentAtMs || 0) - (a.sentAtMs || 0); });
    var limit = Math.min(messages.length, 100);
    for (var i = 0; i < limit; i++) {
      list.appendChild(messageRow(messages[i]));
    }
    var stats = data.stats || {};
    $('messageStats').textContent = '共 ' + (stats.messageCount || 0) + ' 条 · 客户 ' + (stats.buyerMessages || 0) + ' / 我方 ' + (stats.sellerMessages || 0);
  }

  function render(data) {
    state.data = data;
    if (!data || !data.ok) {
      $('emptyState').classList.remove('hidden');
      $('content').classList.add('hidden');
      setStatus('未找到聊天页', 'badge-gray');
      return;
    }
    $('emptyState').classList.add('hidden');
    $('content').classList.remove('hidden');
    setStatus('已读取', 'badge-green');
    setText('inquiryId', data.conversation && data.conversation.imInquiryId);
    setText('messageCount', data.stats && data.stats.messageCount);
    setText('lastMessageAt', data.stats && data.stats.lastAt);
    setText('subject', data.conversation && data.conversation.subject);
    $('pageUrl').textContent = data.url || '';
    fillBuyer(data.conversation && data.conversation.buyer);
    fillConversations(data.conversations || []);
    fillMessages(data);
    syncMatchWithWorkbench(data);
  }

  function getActiveTab() {
    return new Promise(function (resolve, reject) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
  }

  function sendToTab(tabId, message, frameId) {
    return new Promise(function (resolve) {
      var options = {};
      if (typeof frameId === 'number') options.frameId = frameId;
      chrome.tabs.sendMessage(tabId, message, options, function (response) {
        if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
        resolve(response || { ok: false, error: 'empty-response' });
      });
    });
  }

  function getAllFrames(tabId) {
    return new Promise(function (resolve) {
      try {
        chrome.webNavigation.getAllFrames({ tabId: tabId }, function (frames) {
          if (chrome.runtime.lastError) return resolve([]);
          resolve(frames || []);
        });
      } catch (e) { resolve([]); }
    });
  }

  function scoreResult(data) {
    if (!data || !data.ok) return -1;
    var score = 0;
    if (data.pageType === 'chat-detail') score += 100;
    if (data.pageType === 'buyer-only') score += 40;
    if (data.pageType === 'conversation-list') score += 10;
    if (data.conversation && data.conversation.buyer && data.conversation.buyer.name) score += 60;
    score += Math.min((data.stats && data.stats.messageCount) || 0, 200) * 2;
    score += Math.min((data.conversations && data.conversations.length) || 0, 100);
    return score;
  }

  async function readBest(tabId) {
    var frames = await getAllFrames(tabId);
    if (!frames.length) return { ok: false, error: 'no-frames' };
    var best = null;
    var bestScore = -1;
    var firstFailure = null;
    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i];
      var result = await sendToTab(tabId, { type: 'ALI_CS_READ' }, frame.frameId);
      if (!result || !result.ok) { if (!firstFailure) firstFailure = result; continue; }
      var score = scoreResult(result);
      if (score > bestScore) { bestScore = score; best = result; state.frameId = frame.frameId; }
    }
    return best || firstFailure || { ok: false, error: 'no-reader' };
  }

  async function refresh() {
    setStatus('读取中…', 'badge-blue');
    try {
      var tab = await getActiveTab();
      if (!tab || !/^https:\/\/(message|onetalk)\.alibaba\.com\//.test(tab.url || '')) {
        state.tabId = null;
        state.frameId = null;
        render(null);
        setStatus('不在阿里页面', 'badge-gray');
        return;
      }
      state.tabId = tab.id;
      var result = await readBest(tab.id);
      if (!result || !result.ok) {
        render(null);
        setStatus('请刷新页面', 'badge-gray');
        showToast(result && result.error ? '读取失败：' + result.error : '请先刷新阿里客服页面');
        return;
      }
      render(result);
    } catch (error) {
      render(null);
      setStatus('读取失败', 'badge-gray');
      showToast(String(error && error.message ? error.message : error));
    }
  }

  function currentJson() {
    if (!state.data) return '';
    return JSON.stringify(state.data, null, 2);
  }

  async function copyText(text, successText) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successText || '已复制');
    } catch (e) {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast(successText || '已复制');
    }
  }

  function downloadJson() {
    var json = currentJson();
    if (!json) return showToast('还没有可导出的数据');
    var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var id = (state.data.conversation && state.data.conversation.imInquiryId) || 'alibaba-chat';
    a.href = url;
    a.download = '阿里客服_' + id + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    showToast('已下载 JSON');
  }

  async function diagnose() {
    if (!state.tabId) return showToast('请先读取一个阿里客服页面');
    setStatus('探测中…', 'badge-blue');
    var result = await sendToTab(state.tabId, { type: 'ALI_CS_DIAGNOSE' }, state.frameId == null ? undefined : state.frameId);
    state.diagnose = result;
    var output = $('diagnoseOutput');
    var text = JSON.stringify(result, null, 2);
    output.textContent = text;
    output.classList.remove('hidden');
    await copyText(text, '脱敏结构已复制');
    setStatus('已读取', 'badge-green');
  }

  function bindEvents() {
    $('refreshBtn').addEventListener('click', refresh);
    $('copyJsonBtn').addEventListener('click', function () {
      var json = currentJson();
      if (json) copyText(json, 'JSON 已复制'); else showToast('还没有可复制的数据');
    });
    $('downloadJsonBtn').addEventListener('click', downloadJson);
    $('diagnoseBtn').addEventListener('click', diagnose);

    $('wbToggleBtn').addEventListener('click', function () {
      $('wbPanel').classList.toggle('hidden');
    });
    $('wbOpenBtn').addEventListener('click', function () {
      chrome.tabs.create({ url: state.activeUrl || state.wbUrl });
    });
    $('wbReconnectBtn').addEventListener('click', async function () {
      state.wbUrl = normalizeWbUrl($('wbUrlInput').value);
      state.wbFallbackUrl = normalizeWbUrl($('wbFallbackInput').value, true);
      state.activeUrl = '';
      await storageSet({ wbUrl: state.wbUrl, wbFallbackUrl: state.wbFallbackUrl });
      var ok = await loadWorkbenchContext();
      if (ok && state.data && state.data.ok) syncMatchWithWorkbench(state.data);
      showToast(ok ? ('已连接工作台（' + (state.activeRoute || '默认') + '）') : '未能连接工作台，请检查地址或登录');
    });
    $('wbLoginBtn').addEventListener('click', async function () {
      var username = $('wbUsername').value.trim();
      var password = $('wbPassword').value;
      if (!username || !password) return showToast('请输入用户名和密码');
      state.wbUrl = normalizeWbUrl($('wbUrlInput').value);
      state.wbFallbackUrl = normalizeWbUrl($('wbFallbackInput').value, true);
      await storageSet({ wbUrl: state.wbUrl, wbFallbackUrl: state.wbFallbackUrl });
      try {
        var target = await resolveActiveUrl();
        if (!target) throw new Error('内网与备用隧道均无法连接');
        var res = await wbFetch('/api/login', { method: 'POST', body: { username: username, password: password } });
        state.wbToken = res.token || '';
        await storageSet({ wbUrl: state.wbUrl, wbFallbackUrl: state.wbFallbackUrl, wbToken: state.wbToken });
        $('wbPassword').value = '';
        await loadWorkbenchContext();
        $('wbPanel').classList.add('hidden');
        if (state.data && state.data.ok) syncMatchWithWorkbench(state.data);
        showToast('登录成功（' + (state.activeRoute || '默认') + '）');
      } catch (err) {
        showToast('登录失败：' + err.message);
      }
    });
    $('wbLogoutBtn').addEventListener('click', async function () {
      state.wbToken = '';
      await storageSet({ wbToken: '' });
      await loadWorkbenchContext();
      renderMatchState();
    });

    $('crmInquirySelect').addEventListener('change', updateSyncInqVisibility);
    $('crmSyncTaskChk').addEventListener('change', function () {
      $('crmSyncTaskFields').classList.toggle('hidden', !$('crmSyncTaskChk').checked);
    });
    $('crmNewInqChk').addEventListener('change', function () {
      $('crmNewInqBox').classList.toggle('hidden', !$('crmNewInqChk').checked);
    });
    $('crmNewTaskChk').addEventListener('change', function () {
      $('crmNewTaskBox').classList.toggle('hidden', !$('crmNewTaskChk').checked);
    });

    $('crmRebindToggleBtn').addEventListener('click', function () {
      $('crmRebindBox').classList.toggle('hidden');
    });
    $('crmRebindCancelBtn').addEventListener('click', function () {
      $('crmRebindBox').classList.add('hidden');
    });
    $('crmRebindSearch').addEventListener('input', function () {
      populateClientSelect($('crmRebindSelect'), (state.wbContext && state.wbContext.clients) || [], $('crmRebindSearch').value);
    });
    $('crmRebindSaveBtn').addEventListener('click', function () {
      bindExistingClient($('crmRebindSelect').value);
    });

    $('crmBindSearch').addEventListener('input', function () {
      populateClientSelect($('crmBindSelect'), (state.wbContext && state.wbContext.clients) || [], $('crmBindSearch').value);
    });
    $('crmBindBtn').addEventListener('click', function () {
      bindExistingClient($('crmBindSelect').value);
    });

    $('crmAnalyzeSyncBtn').addEventListener('click', analyzeForSync);
    $('crmCommitSyncBtn').addEventListener('click', commitSync);
    $('crmCancelSyncBtn').addEventListener('click', function () {
      $('crmSyncPreview').classList.add('hidden');
    });
    $('crmSyncCopyReply').addEventListener('click', function () {
      copyText($('crmSyncReplyText').textContent || '', '回复建议已复制');
    });

    $('crmAnalyzeCreateBtn').addEventListener('click', analyzeForCreate);
    $('crmCommitCreateBtn').addEventListener('click', function () { commitCreate(false); });
    $('crmCancelCreateBtn').addEventListener('click', function () {
      $('crmCreatePreview').classList.add('hidden');
    });
    $('crmNewCopyReply').addEventListener('click', function () {
      copyText($('crmNewReplyText').textContent || '', '回复建议已复制');
    });
    $('crmDupBindBtn').addEventListener('click', function () {
      if (state.dupCandidate && state.dupCandidate.id) bindExistingClient(state.dupCandidate.id);
    });
    $('crmDupForceBtn').addEventListener('click', function () {
      commitCreate(true);
    });
  }

  async function init() {
    bindEvents();
    var saved = await storageGet(['wbUrl', 'wbFallbackUrl', 'wbToken']);
    if (saved.wbUrl) state.wbUrl = normalizeWbUrl(saved.wbUrl);
    if (saved.wbFallbackUrl) state.wbFallbackUrl = normalizeWbUrl(saved.wbFallbackUrl, true);
    if (saved.wbToken) state.wbToken = saved.wbToken;
    await loadWorkbenchContext();
    await refresh();
  }

  init();
})();
