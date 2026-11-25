const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');

// Calculate end date based on duration type and value
function calculateEndDate(startDate, durationType, durationValue = 1) {
  const end = new Date(startDate);
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

// GET Current subscription status, available plans, and history
exports.getSubscriptionOverview = async (req, res) => {
  try {
    const tenantId = req.tenant._id;

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
    let canActivate = true; // Allowed if no sub, expired, or within 7 days of expiry
    let renewalOpenDate = null;

    if (sub && sub.endDate) {
      const now = new Date();
      const end = new Date(sub.endDate);
      daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysRemaining <= 0 || sub.status === 'EXPIRED') {
        isExpired = true;
        canActivate = true;
      } else if (daysRemaining <= 7) {
        // Within 7 days of expiry - allowed to renew / activate
        canActivate = true;
      } else {
        // More than 7 days remaining - renewal locked
        canActivate = false;
        // Renewal opens 7 days before endDate
        const openDate = new Date(end);
        openDate.setDate(openDate.getDate() - 7);
        renewalOpenDate = openDate;
      }
    }

    return res.json({
      success: true,
      data: {
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
              status: isExpired ? 'EXPIRED' : sub.status,
              paymentStatus: sub.paymentStatus,
              canActivate,
              renewalOpenDate,
            }
          : null,
        canActivate,
        daysRemaining,
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
          createdAt: h.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('getSubscriptionOverview error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch subscription details' });
  }
};

// POST Activate or Renew a plan
exports.activatePlan = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const { planId, paymentMethod = 'UPI' } = req.body;

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

    const currentSub = tenant.currentSubscription;
    const now = new Date();
    let startDate = now;

    // RULE ENFORCEMENT: Expiry ke 7 din pehle se hi renew/activate kiya ja sakta hai
    if (currentSub && currentSub.endDate && currentSub.status === 'ACTIVE') {
      const end = new Date(currentSub.endDate);
      const daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysRemaining > 7) {
        return res.status(400).json({
          success: false,
          error: `Your current plan has ${daysRemaining} days remaining. Plan renewal / activation is permitted only within 7 days of expiry.`,
        });
      }

      // If within 7 days and has positive days remaining, extend from the current endDate!
      if (daysRemaining > 0) {
        startDate = end;
      }
    }

    const endDate = calculateEndDate(startDate, plan.durationType, plan.durationValue);

    // Create new subscription record
    const newSub = await Subscription.create({
      tenant: tenantId,
      plan: plan._id,
      startDate,
      endDate,
      status: 'ACTIVE',
      paymentStatus: plan.price === 0 ? 'FREE' : 'PAID',
      amountPaid: plan.price || 0,
      paymentMethod,
      notes: `Activated by Store Admin on ${new Date().toLocaleDateString('en-IN')}`,
    });

    // Update tenant currentSubscription and status
    tenant.currentSubscription = newSub._id;
    tenant.status = 'ACTIVE';
    await tenant.save();

    return res.status(201).json({
      success: true,
      message: `🎉 Plan "${plan.name}" successfully activated! Valid until ${endDate.toLocaleDateString('en-IN')}`,
      data: {
        subscriptionId: newSub._id,
        planName: plan.name,
        startDate,
        endDate,
        status: 'ACTIVE',
      },
    });
  } catch (error) {
    console.error('activatePlan error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to activate plan' });
  }
};
