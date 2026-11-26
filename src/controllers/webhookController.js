const crypto = require('crypto');
const Tenant = require('../models/Tenant');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const { calculateSubscriptionDates } = require('../utils/duration');
const { applyPlanQuota } = require('../utils/quotaHelper');
const cache = require('../utils/cache');

exports.handleRazorpayWebhook = async (req, res) => {
  try {
    const event = req.body.event;
    const payload = req.body.payload;

    console.log(`[Razorpay Webhook] Received event: ${event}`);

    if (!payload) {
      return res.status(200).json({ status: 'ignored_no_payload' });
    }

    // 1. Mandate Revocation / Cancellation from Bank or UPI App (Google Pay / PhonePe / Paytm)
    if (
      event === 'mandate.revoked' ||
      event === 'mandate.paused' ||
      event === 'subscription.cancelled' ||
      event === 'subscription.paused'
    ) {
      const paymentEntity = payload.payment?.entity;
      const subEntity = payload.subscription?.entity;
      const paymentId = paymentEntity?.id;
      const subId = subEntity?.id;

      // Find tenant matching this mandate ID or subscription ID
      const query = {
        $or: [
          ...(paymentId ? [{ autoPayMandateId: paymentId }] : []),
          ...(subId ? [{ autoPayMandateId: subId }] : []),
        ],
      };

      if (query.$or.length > 0) {
        const tenant = await Tenant.findOne(query);
        if (tenant) {
          tenant.isAutoPayEnabled = false;
          tenant.autoPayStatus = 'CANCELLED';
          tenant.autoPayFailureReason = `Mandate cancelled or revoked on UPI / Bank platform (${event})`;
          await tenant.save();

          if (tenant.currentSubscription) {
            await Subscription.findByIdAndUpdate(tenant.currentSubscription, {
              isAutoPayEnabled: false,
            });
          }

          await cache.del(`sub_overview_${tenant._id}`);
          await cache.delPattern(`*${tenant._id}*`);
          console.log(`[Webhook] AutoPay mandate cancelled for store: ${tenant.businessName}`);
        }
      }
    }

    // 2. AutoPay Payment Failed on Expiry
    if (event === 'payment.failed') {
      const payment = payload.payment?.entity;
      const paymentId = payment?.id;
      const notes = payment?.notes || {};
      const tenantId = notes.tenantId;

      const tenant = tenantId
        ? await Tenant.findById(tenantId)
        : await Tenant.findOne({ autoPayMandateId: paymentId });

      if (tenant) {
        tenant.autoPayStatus = 'PAYMENT_FAILED';
        tenant.autoPayFailureReason = payment?.error_description || 'Payment debit failed on due date';
        await tenant.save();
        await cache.del(`sub_overview_${tenant._id}`);
        console.log(`[Webhook] Payment failed for store: ${tenant.businessName}. Subscription will NOT be renewed!`);
      }
    }

    // 3. Payment Captured / Paid (Recurring Renewal)
    if (event === 'payment.captured' || event === 'order.paid') {
      const payment = payload.payment?.entity;
      const notes = payment?.notes || {};
      if (notes.type === 'AUTOPAY_RENEWAL' && notes.tenantId && notes.planId) {
        const [tenant, plan] = await Promise.all([
          Tenant.findById(notes.tenantId).populate('currentSubscription'),
          Plan.findById(notes.planId),
        ]);

        if (tenant && plan) {
          const now = new Date();
          let baseDate = now;
          if (tenant.currentSubscription && tenant.currentSubscription.endDate) {
            const curEnd = new Date(tenant.currentSubscription.endDate);
            if (curEnd > now) baseDate = curEnd;
          }

          const { endDate, durationDays } = calculateSubscriptionDates(
            plan.durationType,
            plan.durationValue,
            baseDate
          );

          const newSub = await Subscription.create({
            tenant: tenant._id,
            plan: plan._id,
            startDate: now,
            endDate,
            status: 'ACTIVE',
            paymentStatus: 'PAID',
            amountPaid: plan.price,
            planDays: durationDays,
            paymentMethod: 'UPI',
            isAutoPayEnabled: true,
            transactionRef: payment.id,
            notes: `AutoPay Recurring Debit: ${payment.id} on ${now.toLocaleDateString('en-IN')}`,
          });

          tenant.currentSubscription = newSub._id;
          tenant.status = 'ACTIVE';
          tenant.autoPayStatus = 'ACTIVE';
          tenant.autoPayFailureReason = null;

          await tenant.save();

          // Apply plan quotas while preserving lifetime booster credits
          await applyPlanQuota(tenant._id, plan);
          console.log(`[Webhook] Subscription successfully auto-renewed for: ${tenant.businessName}`);
        }
      }
    }

    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('[Razorpay Webhook Error]:', error);
    return res.status(500).json({ error: error.message });
  }
};
