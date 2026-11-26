const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const cache = require('../utils/cache');

exports.getClientStats = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const cacheKey = `stats_${tenantId}`;

    const cachedStats = await cache.get(cacheKey);
    if (cachedStats) {
      return res.json({ success: true, data: cachedStats, fromCache: true });
    }

    const [totalProducts, activeProducts, totalCategories, totalEmployees, recentProducts] = await Promise.all([
      Product.countDocuments({ tenant: tenantId }),
      Product.countDocuments({ tenant: tenantId, isActive: true }),
      Category.countDocuments({ tenant: tenantId }),
      User.countDocuments({ tenant: tenantId, role: 'STAFF' }),
      Product.find({ tenant: tenantId })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('category', 'name')
        .lean(),
    ]);

    const sub = req.tenant.currentSubscription;
    let daysRemaining = null;
    let stackedDisplay = null;
    if (sub && sub.endDate) {
      const now = new Date();
      const end = new Date(sub.endDate);
      daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysRemaining > 0) {
        if (sub.stackedPreviousDays && sub.stackedPreviousDays > 0) {
          stackedDisplay = `${sub.stackedPreviousDays}+${sub.planDays || 30} day left`;
        } else if (daysRemaining > 30) {
          stackedDisplay = `${daysRemaining - 30}+30 day left`;
        } else {
          stackedDisplay = `${daysRemaining} day left`;
        }
      } else {
        stackedDisplay = 'Expired';
      }
    }

    const statsPayload = {
      store: {
        name: req.tenant.businessName,
        slug: req.tenant.slug,
        phone: req.tenant.phone,
        email: req.tenant.email,
        gstin: req.tenant.gstin,
        status: req.tenant.status,
      },
      subscription: sub
        ? {
            planName: sub.plan?.name || 'Active Plan',
            durationType: sub.plan?.durationType,
            endDate: sub.endDate,
            daysRemaining,
            stackedDisplay,
            status: sub.status,
          }
        : null,
      metrics: {
        totalProducts,
        activeProducts,
        totalCategories,
        totalEmployees,
      },
      recentProducts: recentProducts.map((p) => ({
        id: p._id,
        title: p.title,
        uniqueCode: p.uniqueCode,
        price: p.price,
        categoryName: p.category?.name || 'Uncategorized',
        createdAt: p.createdAt,
      })),
    };

    // Cache for 30s for ultra-fast Dashboard load
    await cache.set(cacheKey, statsPayload, 30);

    return res.json({
      success: true,
      data: statsPayload,
    });
  } catch (error) {
    console.error('getClientStats error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error fetching client stats' });
  }
};
