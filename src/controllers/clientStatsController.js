const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const BillSetting = require('../models/BillSetting');
const GlobalSetting = require('../models/GlobalSetting');
const cache = require('../utils/cache');

function getLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

exports.getClientStats = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const cacheKey = `stats_${tenantId}`;

    const cachedStats = await cache.get(cacheKey);
    if (cachedStats) {
      return res.json({ success: true, data: cachedStats, fromCache: true });
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const endOfYesterday = new Date(endOfToday);
    endOfYesterday.setDate(endOfYesterday.getDate() - 1);

    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 6);

    const startOfMonth = new Date(startOfToday);
    startOfMonth.setDate(startOfMonth.getDate() - 29);

    const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);

    const [
      totalProducts,
      activeProducts,
      totalCategories,
      totalEmployees,
      totalInvoicesCount,
      recentProducts,
      recentInvoices,
      billSetting,
      globalSetting,
      pastYearInvoices,
    ] = await Promise.all([
      Product.countDocuments({ tenant: tenantId }),
      Product.countDocuments({ tenant: tenantId, isActive: true }),
      Category.countDocuments({ tenant: tenantId }),
      User.countDocuments({ tenant: tenantId, role: 'STAFF' }),
      Invoice.countDocuments({ tenant: tenantId }),
      Product.find({ tenant: tenantId })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('category', 'name')
        .lean(),
      Invoice.find({ tenant: tenantId })
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
      BillSetting.findOne({ tenant: tenantId }).lean(),
      GlobalSetting.findOne().lean(),
      Invoice.find(
        { tenant: tenantId, createdAt: { $gte: startOfYear } },
        'grandTotal paymentMode createdAt items'
      ).lean(),
    ]);

    // Sales Aggregations
    let todaySales = 0, todayCount = 0;
    let yesterdaySales = 0, yesterdayCount = 0;
    let weekSales = 0, weekCount = 0;
    let monthSales = 0, monthCount = 0;
    let yearSales = 0, yearCount = 0;

    // Day maps for Week (last 7 days)
    const weekMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfToday);
      d.setDate(d.getDate() - i);
      const dateStr = getLocalDateStr(d);
      const dayLabel = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : d.toLocaleDateString('en-IN', { weekday: 'short' });
      weekMap[dateStr] = { date: dateStr, label: dayLabel, sales: 0, count: 0 };
    }

    // Month map (last 30 days)
    const monthMap = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(startOfToday);
      d.setDate(d.getDate() - i);
      const dateStr = getLocalDateStr(d);
      const dayLabel = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      monthMap[dateStr] = { date: dateStr, label: dayLabel, sales: 0, count: 0 };
    }

    // Year map (12 months of current calendar year)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const yearMap = {};
    for (let m = 0; m < 12; m++) {
      yearMap[m] = { monthIndex: m, label: monthNames[m], sales: 0, count: 0 };
    }

    // Payment mode breakdown
    const paymentBreakdown = {
      UPI: { mode: 'UPI', sales: 0, count: 0 },
      CASH: { mode: 'Cash', sales: 0, count: 0 },
      CARD: { mode: 'Card', sales: 0, count: 0 },
      OTHER: { mode: 'Other', sales: 0, count: 0 },
    };

    pastYearInvoices.forEach((inv) => {
      const invDate = new Date(inv.createdAt);
      const amount = Number(inv.grandTotal) || 0;
      const dateStr = getLocalDateStr(invDate);
      const monthIndex = invDate.getMonth();

      // Year total
      yearSales += amount;
      yearCount += 1;
      if (yearMap[monthIndex]) {
        yearMap[monthIndex].sales += amount;
        yearMap[monthIndex].count += 1;
      }

      // Payment breakdown
      const mode = (inv.paymentMode || 'CASH').toUpperCase();
      if (paymentBreakdown[mode]) {
        paymentBreakdown[mode].sales += amount;
        paymentBreakdown[mode].count += 1;
      } else {
        paymentBreakdown.OTHER.sales += amount;
        paymentBreakdown.OTHER.count += 1;
      }

      // Today
      if (invDate >= startOfToday && invDate <= endOfToday) {
        todaySales += amount;
        todayCount += 1;
      }

      // Yesterday
      if (invDate >= startOfYesterday && invDate <= endOfYesterday) {
        yesterdaySales += amount;
        yesterdayCount += 1;
      }

      // Week
      if (invDate >= startOfWeek) {
        weekSales += amount;
        weekCount += 1;
        if (weekMap[dateStr]) {
          weekMap[dateStr].sales += amount;
          weekMap[dateStr].count += 1;
        }
      }

      // Month
      if (invDate >= startOfMonth) {
        monthSales += amount;
        monthCount += 1;
        if (monthMap[dateStr]) {
          monthMap[dateStr].sales += amount;
          monthMap[dateStr].count += 1;
        }
      }
    });

    // Comparison calculations
    const salesDifference = todaySales - yesterdaySales;
    const growthPercent = yesterdaySales > 0
      ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100)
      : todaySales > 0 ? 100 : 0;

    const countDifference = todayCount - yesterdayCount;
    const countGrowthPercent = yesterdayCount > 0
      ? Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100)
      : todayCount > 0 ? 100 : 0;

    // Subscription status
    const sub = req.tenant.currentSubscription;
    let daysRemaining = null;
    let stackedDisplay = null;
    let isExpiringSoon = false;
    let isExpired = false;

    if (sub && sub.endDate) {
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

      // Show alert badge ONLY when 10 days or fewer remain
      isExpiringSoon = daysRemaining > 0 && daysRemaining <= 10;
      isExpired = daysRemaining <= 0;
    }

    const statsPayload = {
      store: {
        name: req.tenant.businessName,
        slug: req.tenant.slug,
        phone: req.tenant.phone || billSetting?.phone || '',
        email: req.tenant.email || billSetting?.email || '',
        gstin: req.tenant.gstin || billSetting?.gstin || '',
        address: billSetting?.address || '',
        tagline: billSetting?.tagline || '',
        upiId: billSetting?.upiId || '',
        status: req.tenant.status,
        createdAt: req.tenant.createdAt,
        isLivePosReady: true,
      },
      salesComparison: {
        today: {
          sales: todaySales,
          count: todayCount,
          aov: todayCount > 0 ? Math.round(todaySales / todayCount) : 0,
        },
        yesterday: {
          sales: yesterdaySales,
          count: yesterdayCount,
          aov: yesterdayCount > 0 ? Math.round(yesterdaySales / yesterdayCount) : 0,
        },
        difference: salesDifference,
        growthPercent,
        countDifference,
        countGrowthPercent,
      },
      charts: {
        week: Object.values(weekMap),
        month: Object.values(monthMap),
        year: Object.values(yearMap),
      },
      paymentBreakdown: Object.values(paymentBreakdown).map((p) => ({
        ...p,
        percent: yearSales > 0 ? Math.round((p.sales / yearSales) * 100) : 0,
      })),
      summary: {
        todaySales,
        todayCount,
        yesterdaySales,
        yesterdayCount,
        weekSales,
        weekCount,
        monthSales,
        monthCount,
        yearSales,
        yearCount,
        totalLifetimeSales: yearSales,
        totalInvoicesCount,
      },
      quotas: {
        smsBalance: req.tenant.smsBalance || 0,
        smsPlanBalance: req.tenant.smsPlanBalance || 0,
        smsBoosterBalance: req.tenant.smsBoosterBalance || 0,
        smsTotalCredited: req.tenant.smsTotalCredited || 0,
        whatsAppBalance: req.tenant.whatsAppBalance || 0,
        whatsAppPlanBalance: req.tenant.whatsAppPlanBalance || 0,
        whatsAppBoosterBalance: req.tenant.whatsAppBoosterBalance || 0,
        whatsAppTotalCredited: req.tenant.whatsAppTotalCredited || 0,
        isSmsGloballyEnabled: globalSetting?.isSmsGloballyEnabled !== false,
        isWhatsAppGloballyEnabled: globalSetting?.isWhatsAppGloballyEnabled !== false,
        smsDisabledNotice: globalSetting?.smsDisabledNotice || 'SMS service is temporarily paused by Admin',
        whatsAppDisabledNotice: globalSetting?.whatsAppDisabledNotice || 'WhatsApp service is temporarily paused by Admin',
      },
      subscription: sub
        ? {
            planName: sub.plan?.name || 'Active Plan',
            durationType: sub.plan?.durationType,
            endDate: sub.endDate,
            daysRemaining,
            stackedDisplay,
            status: sub.status,
            isExpiringSoon,
            isExpired,
          }
        : null,
      metrics: {
        totalProducts,
        activeProducts,
        totalCategories,
        totalEmployees,
        totalInvoicesCount,
      },
      recentInvoices: recentInvoices.map((inv) => ({
        id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName || 'Walk-in Customer',
        customerPhone: inv.customerPhone || '',
        grandTotal: inv.grandTotal,
        subtotal: inv.subtotal,
        discount: inv.discount,
        paymentMode: inv.paymentMode,
        createdAt: inv.createdAt,
        items: inv.items || [],
        billedBy: inv.billedBy || { name: 'Store Admin', role: 'ADMIN', designation: 'Store Admin' },
        billSnapshot: inv.billSnapshot || {},
      })),
      recentProducts: recentProducts.map((p) => ({
        id: p._id,
        title: p.title,
        uniqueCode: p.uniqueCode,
        price: p.price,
        categoryName: p.category?.name || 'Uncategorized',
        createdAt: p.createdAt,
      })),
    };

    // Cache for 15s for fast dashboard updates
    await cache.set(cacheKey, statsPayload, 15);

    return res.json({
      success: true,
      data: statsPayload,
    });
  } catch (error) {
    console.error('getClientStats error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error fetching client stats' });
  }
};
