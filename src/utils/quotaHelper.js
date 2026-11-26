const Tenant = require('../models/Tenant');
const cache = require('./cache');

/**
 * Deduct 1 credit with priority:
 * 1st: Deduct from Plan Quota (since plan quota expires with subscription)
 * 2nd: Once Plan Quota is 0, deduct from Booster Quota (booster has lifetime validity)
 * Total balance is always: Plan Balance + Booster Balance
 */
async function deductMessageQuota(tenantId, type) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new Error('Store tenant not found');

  let deductedFrom = 'NONE';
  let newTotal = 0;

  if (type === 'SMS') {
    const totalAvail = (tenant.smsBalance || 0);
    if (totalAvail <= 0) {
      throw new Error('Insufficient SMS credit balance');
    }

    if ((tenant.smsPlanBalance || 0) > 0) {
      tenant.smsPlanBalance = Math.max(0, tenant.smsPlanBalance - 1);
      deductedFrom = 'PLAN';
    } else if ((tenant.smsBoosterBalance || 0) > 0) {
      tenant.smsBoosterBalance = Math.max(0, tenant.smsBoosterBalance - 1);
      deductedFrom = 'BOOSTER';
    } else {
      // Fallback if legacy numbers weren't split
      tenant.smsBalance = Math.max(0, tenant.smsBalance - 1);
      deductedFrom = 'LEGACY';
    }

    // Always keep total in sync
    tenant.smsBalance = Math.max(0, (tenant.smsPlanBalance || 0) + (tenant.smsBoosterBalance || 0));
    newTotal = tenant.smsBalance;
  } else if (type === 'WHATSAPP') {
    const totalAvail = (tenant.whatsAppBalance || 0);
    if (totalAvail <= 0) {
      throw new Error('Insufficient WhatsApp credit balance');
    }

    if ((tenant.whatsAppPlanBalance || 0) > 0) {
      tenant.whatsAppPlanBalance = Math.max(0, tenant.whatsAppPlanBalance - 1);
      deductedFrom = 'PLAN';
    } else if ((tenant.whatsAppBoosterBalance || 0) > 0) {
      tenant.whatsAppBoosterBalance = Math.max(0, tenant.whatsAppBoosterBalance - 1);
      deductedFrom = 'BOOSTER';
    } else {
      // Fallback if legacy numbers weren't split
      tenant.whatsAppBalance = Math.max(0, tenant.whatsAppBalance - 1);
      deductedFrom = 'LEGACY';
    }

    // Always keep total in sync
    tenant.whatsAppBalance = Math.max(0, (tenant.whatsAppPlanBalance || 0) + (tenant.whatsAppBoosterBalance || 0));
    newTotal = tenant.whatsAppBalance;
  }

  await tenant.save();
  await cache.del(`sub_overview_${tenantId}`);
  await cache.delPattern(`*${tenantId}*`);

  return {
    success: true,
    deductedFrom,
    type,
    newTotal,
    smsPlanBalance: tenant.smsPlanBalance,
    smsBoosterBalance: tenant.smsBoosterBalance,
    whatsAppPlanBalance: tenant.whatsAppPlanBalance,
    whatsAppBoosterBalance: tenant.whatsAppBoosterBalance,
  };
}

/**
 * Credit Booster Pack to Tenant:
 * Booster quota has LIFETIME validity (never expires with main plan).
 */
async function creditBoosterQuota(tenantId, type, credits) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new Error('Store tenant not found');

  const count = Number(credits) || 0;

  if (type === 'SMS') {
    tenant.smsBoosterBalance = (tenant.smsBoosterBalance || 0) + count;
    tenant.smsTotalCredited = (tenant.smsTotalCredited || 0) + count;
    tenant.smsBalance = (tenant.smsPlanBalance || 0) + (tenant.smsBoosterBalance || 0);
  } else if (type === 'WHATSAPP') {
    tenant.whatsAppBoosterBalance = (tenant.whatsAppBoosterBalance || 0) + count;
    tenant.whatsAppTotalCredited = (tenant.whatsAppTotalCredited || 0) + count;
    tenant.whatsAppBalance = (tenant.whatsAppPlanBalance || 0) + (tenant.whatsAppBoosterBalance || 0);
  }

  await tenant.save();
  await cache.del(`sub_overview_${tenantId}`);
  await cache.delPattern(`*${tenantId}*`);

  return tenant;
}

/**
 * Credit / Renew Plan Quota to Tenant:
 * When a plan is activated, extended, or renewed:
 * - Plan balance is set or updated with new plan's included quota.
 * - BOOSTER BALANCE IS PRESERVED 100% (NEVER EXPIRES!).
 * - Total available balance becomes: new plan quota + preserved booster balance.
 */
async function applyPlanQuota(tenantId, plan) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new Error('Store tenant not found');

  const freeSms = Number(plan?.freeSmsQuota || 0);
  const freeWhatsApp = Number(plan?.freeWhatsAppQuota || 0);

  // Set new plan quota (or add to existing if stacking)
  tenant.smsPlanBalance = freeSms;
  tenant.smsTotalCredited = (tenant.smsTotalCredited || 0) + freeSms;
  // Booster balance is preserved! Total = Plan + Booster
  tenant.smsBalance = tenant.smsPlanBalance + (tenant.smsBoosterBalance || 0);

  tenant.whatsAppPlanBalance = freeWhatsApp;
  tenant.whatsAppTotalCredited = (tenant.whatsAppTotalCredited || 0) + freeWhatsApp;
  // Booster balance is preserved! Total = Plan + Booster
  tenant.whatsAppBalance = tenant.whatsAppPlanBalance + (tenant.whatsAppBoosterBalance || 0);

  await tenant.save();
  await cache.del(`sub_overview_${tenantId}`);
  await cache.delPattern(`*${tenantId}*`);

  return tenant;
}

module.exports = {
  deductMessageQuota,
  creditBoosterQuota,
  applyPlanQuota,
};
