const Tenant = require('../models/Tenant');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');

exports.getStats = async (req, res) => {
  try {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalTenants,
      activeTenants,
      trialTenants,
      expiredTenants,
      suspendedTenants,
      totalPlans,
      recentTenants,
      expiringSoon,
      paidSubscriptions,
    ] = await Promise.all([
      Tenant.countDocuments(),
      Tenant.countDocuments({ status: 'ACTIVE' }),
      Tenant.countDocuments({ status: 'TRIAL' }),
      Tenant.countDocuments({ status: 'EXPIRED' }),
      Tenant.countDocuments({ status: 'SUSPENDED' }),
      Plan.countDocuments(),
      Tenant.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('owner', 'name email phone')
        .populate({
          path: 'currentSubscription',
          populate: { path: 'plan', select: 'name price durationType' },
        })
        .lean(),
      Subscription.find({
        status: { $in: ['ACTIVE', 'TRIAL'] },
        endDate: { $gte: now, $lte: sevenDaysFromNow },
      })
        .sort({ endDate: 1 })
        .limit(5)
        .populate('tenant', 'businessName phone email')
        .populate('plan', 'name')
        .lean(),
      Subscription.find({ paymentStatus: 'PAID' }).select('amountPaid').lean(),
    ]);

    const totalRevenue = paidSubscriptions.reduce((sum, s) => sum + (s.amountPaid || 0), 0);

    // Plans breakdown with subscriber count
    const plans = await Plan.find().lean();
    const plansWithCount = await Promise.all(
      plans.map(async (p) => {
        const count = await Subscription.countDocuments({ plan: p._id });
        return {
          id: p._id,
          name: p.name,
          price: p.price,
          _count: { subscriptions: count },
        };
      })
    );

    // Format recentTenants to include subscriptions array for compatibility
    const formattedRecentTenants = recentTenants.map((t) => ({
      ...t,
      id: t._id,
      subscriptions: t.currentSubscription ? [t.currentSubscription] : [],
    }));

    return res.json({
      success: true,
      stats: {
        totalTenants,
        activeTenants,
        trialTenants,
        expiredTenants,
        suspendedTenants,
        totalPlans,
        totalRevenue,
        recentTenants: formattedRecentTenants,
        expiringSoon: expiringSoon.map((s) => ({ ...s, id: s._id })),
        plansWithCount,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
