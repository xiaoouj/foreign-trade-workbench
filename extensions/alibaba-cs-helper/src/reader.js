/*!
 * 阿里国际站客服页面读取规则 · AliChatReader v1.0.0
 * 适配：https://message.alibaba.com/message/maDetail.htm?imInquiryId=...
 *      https://message.alibaba.com/message/default.htm#feedback/all
 *      https://onetalk.alibaba.com/message/weblite.htm
 *
 * 说明：本文件只读取当前页面可见 DOM，不发送、不修改任何数据。
 * 选择器基于 2026-11-23 实测页面（Chrome 157）。
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';

  function norm(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function textOf(el) {
    if (!el) return '';
    return norm(el.innerText != null ? el.innerText : el.textContent);
  }

  function pick(rootEl, selector) {
    try { return rootEl.querySelector(selector); } catch (e) { return null; }
  }

  function pickText(rootEl, selector) {
    return textOf(pick(rootEl, selector));
  }

  function decodeHtml(value) {
    var text = String(value || '');
    if (!text) return '';
    if (typeof document !== 'undefined') {
      var ta = document.createElement('textarea');
      ta.innerHTML = text;
      return ta.value;
    }
    return text;
  }

  function parseJsonAttr(el, name) {
    try { return JSON.parse(el.getAttribute(name) || '{}') || {}; } catch (e) { return {}; }
  }

  function parseUrlInfo() {
    var url = location.href;
    var imInquiryId = '';
    var hash = location.hash || '';
    try {
      var u = new URL(url);
      imInquiryId = u.searchParams.get('imInquiryId') || '';
    } catch (e) {}
    if (!imInquiryId) {
      var m = hash.match(/feedback\/detail\/[^/]+\/(\d+)/) || url.match(/feedback\/detail\/[^/]+\/(\d+)/);
      if (m) imInquiryId = m[1];
    }
    return { url: url, imInquiryId: imInquiryId };
  }

  function formFields() {
    var out = {};
    var items = document.querySelectorAll('#app-crm .base-information-form-item');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var label = pickText(item, '.base-information-form-item-label');
      var content = pickText(item, '.base-information-form-item-content');
      if (label) out[label] = content;
    }
    return out;
  }

  function firstValue(map, names) {
    for (var i = 0; i < names.length; i++) {
      if (map[names[i]]) return map[names[i]];
    }
    return '';
  }

  function readBuyer() {
    var panel = document.querySelector('#app-crm');
    if (!panel) return null;
    var fields = formFields();
    var detailLink = panel.querySelector('a.customer-detail-link');
    var href = detailLink ? (detailLink.href || detailLink.getAttribute('href') || '') : '';
    var customerId = '';
    try { customerId = new URL(href, location.href).searchParams.get('customerId') || ''; } catch (e) {}
    var flag = panel.querySelector('.country-flag');
    var flagClass = flag ? (typeof flag.className === 'string' ? flag.className : '') : '';
    var flagMatch = flagClass.match(/icbu-icon-flag-([a-z]{2})\b/);
    var ownerRaw = pickText(panel, '.other-customer-trigger .text.others');
    var owner = ownerRaw
      .replace(/的客户\s*$/, '')
      .replace(/['’]s\s+customer\s*$/i, '')
      .trim();
    var name = pickText(panel, '.alicrm-customer-detail-card-header-name-container .name-text') ||
      pickText(panel, '.alicrm-customer-detail-card-header .name');
    return {
      name: name,
      company: firstValue(fields, ['公司名称', 'Company Name', 'Company']),
      email: firstValue(fields, ['邮箱', 'Email', 'E-mail']),
      registeredAt: firstValue(fields, ['注册时间', 'Registration Time', 'Registered']),
      country: pickText(panel, '.country-flag-label'),
      countryCode: flagMatch ? flagMatch[1].toUpperCase() : '',
      ownerRaw: ownerRaw,
      owner: owner,
      customerId: customerId,
      customerDetailUrl: href,
      tags: Array.prototype.map.call(panel.querySelectorAll('.customer-tag .ai-tag-content-list-item'), function (el) { return norm(el.textContent); }).filter(Boolean),
      features: Array.prototype.map.call(panel.querySelectorAll('.buyer-feature-form-item .ai-tag-content-list-item'), function (el) { return norm(el.textContent); }).filter(Boolean)
    };
  }

  function readSeller(pageContext) {
    var info = pageContext && pageContext.seller ? pageContext.seller : {};
    var headerText = '';
    var header = document.querySelector('.ui-header-user-detail-top');
    if (header) headerText = textOf(header);
    var displayName = norm(info.displayName || '');
    if (!displayName && headerText) {
      var m = headerText.match(/(?:您好|Hello)[,，]\s*([^\s]+)/i);
      if (m) displayName = m[1];
    }
    return {
      memberId: norm(info.memberId || ''),
      displayName: displayName,
      userName: norm(info.userName || ''),
      userRole: norm(info.userRole || '')
    };
  }

  function messageKind(type) {
    var value = String(type);
    if (value === '1') return 'text';
    if (value === '15') return 'system';
    if (value === '52') return 'quote-card';
    if (value === '53') return 'file-card';
    if (value === '60') return 'image-card';
    return 'other';
  }

  function readMessages(buyer, seller) {
    var flow = document.querySelector('.im-message-flow');
    if (!flow) return [];
    var items = Array.prototype.slice.call(flow.querySelectorAll('.message-item-wrapper'));
    var messages = [];
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var exp = parseJsonAttr(el, 'data-expinfo');
      var cls = typeof el.className === 'string' ? el.className : '';
      // 阿里页面（maDetail 与 onetalk weblite）：item-left = 客户/买家，item-right = 我方。
      var side = 'unknown';
      if (/\bitem-left\b/.test(cls)) side = 'buyer';
      else if (/\bitem-right\b/.test(cls)) side = 'seller';
      var content = el.querySelector('.session-rich-content');
      var original = decodeHtml(el.getAttribute('data-original') || '');
      var bodyText = textOf(content);
      var translation = pickText(el, '.session-translate .target-content');
      var ts = Number(exp.sendTime || 0);
      var date = ts ? new Date(ts) : null;
      var pad = function (n) { return String(n).padStart(2, '0'); };
      var sentAt = date && !isNaN(date.getTime())
        ? date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
        : pickText(el, '.item-base-info > span:not(.name)');
      var kind = messageKind(exp.messageType);
      var displayText = bodyText;
      if (!displayText) {
        if (kind === 'file-card') displayText = '[文件] ' + (original || '');
        else if (kind === 'image-card') displayText = '[图片/卡片]';
        else if (kind === 'quote-card') displayText = '[报价卡片] ' + (original || '');
        else displayText = original || '';
      }
      var senderName = side === 'buyer'
        ? (pickText(el, '.item-base-info .name') || (buyer && buyer.name) || '买家')
        : (seller && seller.displayName) || '我方';
      messages.push({
        id: norm(exp.messageId || ''),
        messageType: exp.messageType == null ? null : Number(exp.messageType),
        kind: kind,
        side: side,
        sender: senderName,
        sentAt: sentAt,
        sentAtMs: ts || null,
        text: displayText,
        originalText: original,
        translation: translation,
        readStatus: norm(exp.read_status || ''),
        imageUrl: (content && content.querySelector('img') ? content.querySelector('img').src : '') || ''
      });
    }
    messages.sort(function (a, b) {
      var am = a.sentAtMs || 0;
      var bm = b.sentAtMs || 0;
      if (am !== bm) return am - bm;
      return 0;
    });
    return messages;
  }

  function readConversations() {
    var items = document.querySelectorAll('#icbu-weblite-list .contact-item-container, .im-conversation-list-container .contact-item-container');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var name = pickText(el, '.contact-info .name') || pickText(el, '.name');
      if (!name) continue;
      var flag = el.querySelector('.country-flag');
      var flagClass = flag ? (typeof flag.className === 'string' ? flag.className : '') : '';
      var flagMatch = flagClass.match(/icbu-icon-flag-([a-z]{2})\b/);
      out.push({
        name: name,
        company: pickText(el, '.contact-company'),
        countryCode: flagMatch ? flagMatch[1].toUpperCase() : '',
        lastMessage: pickText(el, '.latest-msg'),
        lastTime: pickText(el, '.contact-time'),
        unread: !!el.querySelector('.read-status.unread')
      });
    }
    return out;
  }

  function readPage(options) {
    var opts = options || {};
    var urlInfo = parseUrlInfo();
    var buyer = readBuyer();
    var seller = readSeller(opts.pageContext);
    var messages = readMessages(buyer, seller);
    var conversations = readConversations();
    var hasChat = !!document.querySelector('.im-message-flow');
    var hasBuyer = !!buyer;
    var ok = hasChat || hasBuyer || conversations.length > 0;
    var stats = { messageCount: messages.length, buyerMessages: 0, sellerMessages: 0, otherMessages: 0, firstAt: '', lastAt: '' };
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].side === 'buyer') stats.buyerMessages++;
      else if (messages[i].side === 'seller') stats.sellerMessages++;
      else stats.otherMessages++;
      if (!stats.firstAt || messages[i].sentAt < stats.firstAt) stats.firstAt = messages[i].sentAt;
      if (!stats.lastAt || messages[i].sentAt > stats.lastAt) stats.lastAt = messages[i].sentAt;
    }
    return {
      ok: ok,
      readerVersion: VERSION,
      pageType: hasChat ? 'chat-detail' : (hasBuyer ? 'buyer-only' : (conversations.length ? 'conversation-list' : 'unknown')),
      url: urlInfo.url,
      conversation: {
        imInquiryId: urlInfo.imInquiryId,
        subject: pickText(document, '.top .subject') || document.title,
        buyer: buyer,
        seller: seller
      },
      conversations: conversations,
      stats: stats,
      messages: messages,
      readAt: new Date().toISOString()
    };
  }

  function diagnose() {
    var sig = function (el) {
      if (!el) return '';
      var cls = '';
      if (typeof el.className === 'string' && el.className.trim()) {
        cls = '.' + el.className.trim().split(/\s+/).slice(0, 6).join('.');
      }
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
    };
    var chain = function (el, max) {
      var out = [];
      for (var e = el, i = 0; e && i < (max || 8); e = e.parentElement, i++) {
        out.push({
          level: i,
          node: sig(e),
          dataAttrs: Array.prototype.map.call(e.attributes || [], function (a) { return a.name; }).filter(function (n) { return n.indexOf('data-') === 0 || n === 'role'; }),
          childCount: e.children ? e.children.length : 0
        });
      }
      return out;
    };
    var messageEl = document.querySelector('.im-message-flow .message-item-wrapper');
    var nameEl = document.querySelector('#app-crm .alicrm-customer-detail-card-header-name-container .name-text');
    var ownerEl = document.querySelector('#app-crm .other-customer-trigger .text.others');
    return {
      readerVersion: VERSION,
      url: location.href.slice(0, 300),
      iframes: Array.prototype.map.call(document.querySelectorAll('iframe'), function (f) {
        var r = f.getBoundingClientRect();
        return { id: f.id, cls: typeof f.className === 'string' ? f.className : '', src: (f.src || '').slice(0, 160), width: Math.round(r.width), height: Math.round(r.height) };
      }),
      page: {
        pageType: document.querySelector('.im-message-flow') ? 'chat-detail' : 'unknown',
        chatFlow: !!document.querySelector('.im-message-flow'),
        chatContainer: !!document.querySelector('.im-message-flow .scroll-box'),
        messageItemCount: document.querySelectorAll('.im-message-flow .message-item-wrapper').length,
        buyerPanel: !!document.querySelector('#app-crm'),
        buyerName: !!nameEl,
        owner: !!ownerEl
      },
      chatChain: chain(messageEl, 8),
      buyerChain: chain(nameEl, 6),
      ownerChain: chain(ownerEl, 4),
      fieldLabels: Array.prototype.map.call(document.querySelectorAll('#app-crm .base-information-form-item-label'), function (el) { return norm(el.textContent); }),
      messageDataAttrs: messageEl ? Array.prototype.map.call(messageEl.attributes, function (a) { return a.name; }) : []
    };
  }

  var api = { version: VERSION, readPage: readPage, diagnose: diagnose };
  root.AliChatReader = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
