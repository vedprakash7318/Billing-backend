const crypto = require('crypto');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const Tenant = require('../models/Tenant');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const cache = require('../utils/cache');

// Initialize Razorpay client helper
function getRazorpayInstance() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error('Razorpay keys not configured on server. Please check RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET');
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

// Calculate end date based on duration type and value
function calculateEndDate(baseDate, durationType, durationValue = 1) {
  const end = new Date(baseDate);
  const val = Number(durationValue) || 1;

  switch (durationType) {
    case 'DAILY':
      end.setDate(end.getDate() + val);
      break;
    case 'WEEKLY':
      end.setDate(end.getDate() + val * 7);
      break;
    case 'MONTHLY':
      end.setMonth(end.getMonth() + val);
      break;
    case 'YEARLY':
      end.setFullYear(end.getFullYear() + val);
      break;
    case 'CUSTOM_DAYS':
      end.setDate(end.getDate() + val);
      break;
    case 'LIFETIME':
      end.setFullYear(end.getFullYear() + 100);
      break;
    default:
      end.setMonth(end.getMonth() + 1);
  }
  return end;
}

// Calculate stacked dates: If current subscription/trial has remaining days (e.g. 3 days left),
// the new plan's duration is stacked on top of the remaining days (e.g. 3 days + 1 Month = 33 days)
function calculateStackedDates(currentSub, plan) {
  const now = new Date();
  let baseDate = now;
  let stackedPreviousDays = 0;

  if (
    currentSub &&
    currentSub.endDate &&
    new Date(currentSub.endDate) > now &&
    (currentSub.status === 'ACTIVE' || currentSub.status === 'TRIAL')
  ) {
    baseDate = new Date(currentSub.endDate);
    stackedPreviousDays = Math.ceil((new Date(currentSub.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  const endDate = calculateEndDate(baseDate, plan.durationType, plan.durationValue);
  const planDays = Math.round((endDate.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24));

  return { startDate: now, endDate, baseDate, stackedPreviousDays, planDays };
}

// 1. GET Current subscription status, available plans, and history
exports.getSubscriptionOverview = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const cacheKey = `sub_overview_${tenantId}`;

    const cachedData = await cache.get(cacheKey);
    if (cachedData) {
      return res.json({ success: true, data: cachedData, fromCache: true });
    }

    const [tenant, availablePlans, history] = await Promise.all([
      Tenant.findById(tenantId)
        .populate({
          path: 'currentSubscription',
          populate: { path: 'plan' },
        })
        .lean(),
      Plan.find({ isActive: true }).sort({ sortOrder: 1, price: 1 }).lean(),
      Subscription.find({ tenant: tenantId })
        .populate('plan', 'name durationType price')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const sub = tenant?.currentSubscription;
    let daysRemaining = null;
    let isExpired = false;
    let canActivate = true;
    let renewalOpenDate = null;
    let renewalDaysLeft = 0;
    let stackedDisplay = null;

    if (sub && sub.endDate) {
      const now = new Date();
      const end = new Date(sub.endDate);
      daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysRemaining <= 0 || sub.status === 'EXPIRED') {
        isExpired = true;
        canActivate = true;
        daysRemaining = 0;
        stackedDisplay = 'Expired';
      } else {
        // Stacked breakdown: e.g. 3+30 day left
        if (sub.stackedPreviousDays && sub.stackedPreviousDays > 0) {
          stackedDisplay = `${sub.stackedPreviousDays}+${sub.planDays || 30} day left`;
        } else if (daysRemaining > 30) {
          stackedDisplay = `${daysRemaining - 30}+30 day left`;
        } else {
          stackedDisplay = `${daysRemaining} day left`;
        }

        if (daysRemaining <= 7) {
          // Within 7 days of expiry: Allowed to renew
          canActivate = true;
        } else {
          // More than 7 days remaining on active plan: Activation strictly locked
          canActivate = false;
          renewalDaysLeft = daysRemaining - 7;
          const openDate = new Date(end);
          openDate.setDate(openDate.getDate() - 7);
          renewalOpenDate = openDate;
        }
      }
    }

    const payload = {
      currentSubscription: sub
        ? {
            id: sub._id,
            planId: sub.plan?._id,
            planName: sub.plan?.name || 'Active Plan',
            durationType: sub.plan?.durationType || 'MONTHLY',
            durationValue: sub.plan?.durationValue || 1,
            price: sub.plan?.price || 0,
            startDate: sub.startDate,
            endDate: sub.endDate,
            daysRemaining,
            stackedDisplay,
            stackedPreviousDays: sub.stackedPreviousDays || 0,
            planDays: sub.planDays || 30,
            status: isExpired ? 'EXPIRED' : sub.status,
            paymentStatus: sub.paymentStatus,
            canActivate,
            renewalOpenDate,
            renewalDaysLeft,
          }
        : null,
      canActivate,
      daysRemaining,
      stackedDisplay,
      renewalOpenDate,
      renewalDaysLeft,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
      availablePlans: availablePlans.map((p) => ({
        ...p,
        id: p._id,
      })),
      history: history.map((h) => ({
        id: h._id,
        planName: h.plan?.name || 'Plan',
        startDate: h.startDate,
        endDate: h.endDate,
        status: h.status,
        amountPaid: h.amountPaid,
        paymentMethod: h.paymentMethod,
        transactionRef: h.transactionRef,
        createdAt: h.createdAt,
      })),
    };

    // Cache for 60 seconds for lightning fast response
    await cache.set(cacheKey, payload, 60);

    return res.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    console.error('getSubscriptionOverview error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch subscription details' });
  }
};

// 2. POST Create Razorpay Order for a Plan
exports.createRazorpayOrder = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const { planId } = req.body;

    if (!planId || !mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ success: false, error: 'Please select a valid subscription plan' });
    }

    const [tenant, plan] = await Promise.all([
      Tenant.findById(tenantId).populate('currentSubscription'),
      Plan.findOne({ _id: planId, isActive: true }),
    ]);

    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Store tenant account not found' });
    }

    if (!plan) {
      return res.status(404).json({ success: false, error: 'Selected plan is not available or inactive' });
    }

    // Strict 7-day rule check on server:
    const currentSub = tenant.currentSubscription;
    if (
      currentSub &&
      currentSub.endDate &&
      (currentSub.status === 'ACTIVE' || currentSub.status === 'TRIAL')
    ) {
      const now = new Date();
      const end = new Date(currentSub.endDate);
      const daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysRemaining > 7) {
        return res.status(400).json({
          success: false,
          error: `Aapka plan abhi active hai (${daysRemaining} din bache hain). Renewal expiry ke 7 din pehle se hi open hoga.`,
        });
      }
    }

    // Check if free trial/plan
    if (plan.price === 0 || plan.planType === 'FREE_TRIAL') {
      return res.json({
        success: true,
        isFree: true,
        plan: {
          id: plan._id,
          name: plan.name,
          price: 0,
        },
      });
    }

    // Initialize Razorpay
    const razorpay = getRazorpayInstance();
    const amountInPaise = Math.round(plan.price * 100);

    const options = {
      amount: amountInPaise,
      currency: plan.currency || 'INR',
      receipt: `sub_${tenantId.toString().slice(-6)}_${Date.now().toString().slice(-6)}`,
      notes: {
        tenantId: tenantId.toString(),
        planId: plan._id.toString(),
        storeName: tenant.businessName,
      },
    };

    const order = await razorpay.orders.create(options);

    return res.json({
      success: true,
      isFree: false,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      plan: {
        id: plan._id,
        name: plan.name,
        price: plan.price,
        durationType: plan.durationType,
        durationValue: plan.durationValue,
      },
      store: {
        name: tenant.businessName,
        email: tenant.email || req.user.email,
        phone: tenant.phone || req.user.phone || '9876543210',
      },
    });
  } catch (error) {
    console.error('createRazorpayOrder error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to initialize payment with Razorpay',
    });
  }
};

// 3. POST Verify Razorpay Payment and Activate Subscription
exports.verifyRazorpayPayment = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !planId) {
      return res.status(400).json({
        success: false,
        error: 'Incomplete payment verification payload (order_id, payment_id, signature required)',
      });
    }

    // Verify HMAC SHA256 Signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: 'Razorpay payment signature verification failed. Transaction rejected.',
      });
    }

    const [tenant, plan] = await Promise.all([
      Tenant.findById(tenantId).populate('currentSubscription'),
      Plan.findById(planId),
    ]);

    if (!tenant || !plan) {
      return res.status(404).json({ success: false, error: 'Store or Plan not found for activation' });
    }

    // Stack dates: preserve existing remaining days (e.g. 3 days of trial + 1 Month)
    const { startDate, endDate, stackedPreviousDays, planDays } = calculateStackedDates(tenant.currentSubscription, plan);

    // Create Subscription record (recorded for Super Admin & Merchant)
    const newSub = await Subscription.create({
      tenant: tenantId,
      plan: plan._id,
      startDate,
      endDate,
      status: 'ACTIVE',
      paymentStatus: 'PAID',
      amountPaid: plan.price,
      stackedPreviousDays,
      planDays,
      paymentMethod: 'UPI',
      transactionRef: razorpay_payment_id,
      notes: `Razorpay Order: ${razorpay_order_id} | Payment: ${razorpay_payment_id} | Paid on ${new Date().toLocaleDateString('en-IN')}`,
    });

    // Update Tenant
    tenant.currentSubscription = newSub._id;
    tenant.status = 'ACTIVE';
    await tenant.save();

    // Invalidate caches
    await cache.del(`sub_overview_${tenantId}`);
    await cache.delPattern(`tenant_${tenantId}`);

    return res.json({
      success: true,
      message: `🎉 Payment successful! Plan "${plan.name}" activated. Valid until ${endDate.toLocaleDateString('en-IN')}`,
      data: {
        subscriptionId: newSub._id,
        planName: plan.name,
        startDate,
        endDate,
        paymentId: razorpay_payment_id,
        status: 'ACTIVE',
      },
    });
  } catch (error) {
    console.error('verifyRazorpayPayment error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Payment verification and plan activation failed',
    });
  }
};

// 4. POST Activate Free Plan (e.g. Free Trial)
exports.activateFreePlan = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const { planId } = req.body;

    const [tenant, plan] = await Promise.all([
      Tenant.findById(tenantId).populate('currentSubscription'),
      Plan.findOne({ _id: planId, isActive: true }),
    ]);

    if (!tenant || !plan) {
      return res.status(404).json({ success: false, error: 'Store or Plan not found' });
    }

    if (plan.price > 0 && plan.planType !== 'FREE_TRIAL') {
      return res.status(400).json({ success: false, error: 'This is a paid plan. Please complete payment via Razorpay.' });
    }

    // Check if store already has an active plan > 7 days left
    const currentSub = tenant.currentSubscription;
    if (
      currentSub &&
      currentSub.endDate &&
      (currentSub.status === 'ACTIVE' || currentSub.status === 'TRIAL')
    ) {
      const now = new Date();
      const end = new Date(currentSub.endDate);
      const daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysRemaining > 7) {
        return res.status(400).json({
          success: false,
          error: `Aapka plan abhi active hai (${daysRemaining} din bache hain). Renewal expiry ke 7 din pehle se hi open hoga.`,
        });
      }
    }

    // Check if free trial already used
    const previousSubs = await Subscription.countDocuments({ tenant: tenantId });
    if (previousSubs > 0 && (plan.planType === 'FREE_TRIAL' || plan.price === 0)) {
      return res.status(400).json({
        success: false,
        error: 'Free trial already used on this store. Please select a standard subscription plan.',
      });
    }

    const { startDate, endDate, stackedPreviousDays, planDays } = calculateStackedDates(tenant.currentSubscription, plan);

    const newSub = await Subscription.create({
      tenant: tenantId,
      plan: plan._id,
      startDate,
      endDate,
      status: 'ACTIVE',
      paymentStatus: 'FREE',
      amountPaid: 0,
      stackedPreviousDays,
      planDays,
      paymentMethod: 'MANUAL',
      transactionRef: `FREE_${Date.now()}`,
      notes: `Activated Free/Trial plan on ${new Date().toLocaleDateString('en-IN')}`,
    });

    tenant.currentSubscription = newSub._id;
    tenant.status = 'ACTIVE';
    await tenant.save();

    // Invalidate caches
    await cache.del(`sub_overview_${tenantId}`);
    await cache.delPattern(`tenant_${tenantId}`);

    return res.json({
      success: true,
      message: `🎉 Free Plan "${plan.name}" activated! Valid until ${endDate.toLocaleDateString('en-IN')}`,
      data: {
        subscriptionId: newSub._id,
        planName: plan.name,
        startDate,
        endDate,
        status: 'ACTIVE',
      },
    });
  } catch (error) {
    console.error('activateFreePlan error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to activate free plan' });
  }
};
