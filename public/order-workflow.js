// Shared by the classic browser scripts and the Node server (side-effect import).
// Stages describe work; agreed deposits never stand in for actual receipts.
(function (root) {
  const statuses = Object.freeze(['待确认', '待收预付款', '生产中', '待收尾款', '待发货', '已发货', '已完成', '已取消']);
  const legacyStatuses = Object.freeze(['已确认', '已收款']);
  const stage = order => ({'已确认':'待收预付款', '已收款':'待发货'}[order.status] || order.status || '待确认');
  const isCancelled = order => ['已取消', 'Cancelled'].includes(order.status);
  const isDeal = order => !isCancelled(order) && (['生产中', '待收尾款', '待发货', '已发货', '已完成'].includes(stage(order)) || payment(order).received > 0 || Number(order.productionProgress) === 100);
  const isConfirmed = order => ['待收预付款', '生产中', '待收尾款', '待发货', '已发货', '已完成'].includes(stage(order));
  function payment(order) {
    const raw = order.paidPercent;
    const percent = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
    const explicit = Number.isFinite(percent) && percent >= 0 && percent <= 100;
    // Preserve the old full-payment meaning of these historical states. Never infer
    // receipts from production, shipment, or an agreed deposit percentage.
    const historical = !explicit && !(Number(order.retentionAmount) > 0) && ['已收款', '已完成'].includes(order.status);
    const awaiting = !explicit && ['待确认', '待收预付款'].includes(stage(order));
    const paidPercent = explicit ? percent : historical ? 100 : awaiting ? 0 : null;
    const value = order.amount;
    const amount = value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    const known = paidPercent != null && amount != null;
    const received = known ? Math.round(amount * paidPercent) / 100 : null;
    const outstanding = known ? Math.round((amount - received) * 100) / 100 : null;
    return {paidPercent, amount, received, outstanding, known, source:explicit?'recorded':historical?'historical':awaiting?'awaiting':'unknown'};
  }
  function collection(order) {
    const receipt = payment(order);
    const balance = receipt.outstanding;
    const reserve = Math.max(0, Number(order.retentionAmount) || 0);
    const retained = balance == null ? null : Math.min(reserve, balance);
    const beforeShipment = balance == null ? null : Math.round((balance - retained) * 100) / 100;
    const recorded = stage(order);
    let operational = recorded;
    const delivered = ['已发货', '已完成', '已取消', 'Cancelled'].includes(order.status);
    const finished = Number(order.productionProgress) === 100 ||
      ['待收尾款', '待发货'].includes(recorded);
    if (!delivered && finished) {
      operational = beforeShipment == null ? '收款待核对' : beforeShipment > 0 ? '待收尾款' : '待发货';
    } else if (!delivered && receipt.received > 0 &&
               ['待确认', '待收预付款', '未完成'].includes(recorded)) {
      operational = '生产中';
    }
    const agreed = (receipt.amount || 0) * (Number(order.depositPercent) || 0) / 100;
    const depositDue = receipt.known ? Math.max(0, Math.round((agreed - receipt.received) * 100) / 100) : null;
    const pendingBalance = !isCancelled(order) && beforeShipment > 0 &&
      (receipt.received > 0 || operational === '待收尾款');
    return {operational, retained, beforeShipment, depositDue, pendingBalance};
  }
  root.FTWOrderWorkflow = Object.freeze({statuses, legacyStatuses, stage, isCancelled, isDeal, isConfirmed, payment, collection});
})(globalThis);
