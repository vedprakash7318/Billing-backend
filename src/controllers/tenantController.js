const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const AuditLog = require('../models/AuditLog');
const AddOnOrder = require('../models/AddOnOrder');
const cache = require('../utils/cache');
const { calculateSubscriptionDates } = require('../utils/duration');

function escapeRegex(text) {
  if (!text) return '';
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// GET Tenants with Server-side Pagination & Searching
exports.getTenants = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const search = req.query.search ? req.query.search.trim() : '';
    const status = req.query.status;
    const planId = req.query.planId;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

    let filter = {};

    if (status && status !== 'ALL') {
      filter.status = status;
    }

    if (planId && planId !== 'ALL' && mongoose.Types.ObjectId.isValid(planId)) {
      const matchingSubs = await Subscription.find({ plan: planId }).select('_id');
      const subIds = matchingSubs.map((s) => s._id);
      filter.currentSubscription = { $in: subIds };
    }

    if (search) {
      const safeSearch = escapeRegex(search);
      // Find matching users first
      const matchingUsers = await User.find({
        $or: [
          { name: { $regex: safeSearch, $options: 'i' } },
          { email: { $regex: safeSearch, $options: 'i' } },
          { phone: { $regex: safeSearch, $options: 'i' } },
        ],
      }).select('_id');

      const userIds = matchingUsers.map((u) => u._id);

      filter.$or = [
        { businessName: { $regex: safeSearch, $options: 'i' } },
        { slug: { $regex: safeSearch, $options: 'i' } },
        { phone: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } },
        { gstin: { $regex: safeSearch, $options: 'i' } },
        { owner: { $in: userIds } },
      ];
    }

    const skip = (page - 1) * limit;

    const [total, tenants] = await Promise.all([
      Tenant.countDocuments(filter),
      Tenant.find(filter)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .populate('owner', 'name email phone status createdAt')
        .populate({
          path: 'currentSubscription',
          populate: { path: 'plan' },
        })
        .lean(),
    ]);

    // Format for client UI
    const formattedTenants = tenants.map((t) => ({
      ...t,
      id: t._id,
      subscriptions: t.currentSubscription ? [t.currentSubscription] : [],
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return res.json({
      success: true,
      data: formattedTenants,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error('getTenants error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Server error fetching tenants' });
  }
};

// GET Single Tenant by ID
exports.getTenantById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: 'Tenant not found (invalid ID)' });
    }

    const tenant = await Tenant.findById(id)
      .populate('owner', 'name email phone status createdAt')
      .populate({
        path: 'currentSubscription',
        populate: { path: 'plan' },
      })
      .lean();

    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }

    const subscriptions = await Subscription.find({ tenant: tenant._id })
      .sort({ createdAt: -1 })
      .populate('plan')
      .lean();

    return res.json({
      success: true,
      data: { ...tenant, id: tenant._id, subscriptions },
    });
  } catch (error) {
    console.error('getTenantById error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Server error fetching tenant' });
  }
};

// Create Tenant & Admin (Onboarding)
exports.createTenant = async (req, res) => {
  try {
    const {
      businessName,
      ownerName,
      email,
      password,
      phone,
      address,
      city,
      state,
      pincode,
      gstin,
      planId,
      customDurationDays,
      customStartDate,
      paymentStatus = 'PAID',
      paymentMethod = 'MANUAL',
      amountPaid,
      notes,
    } = req.body;

    if (!businessName || !businessName.trim()) {
      return res.status(400).json({ success: false, error: 'Business name is required' });
    }
    if (!ownerName || !ownerName.trim()) {
      return res.status(400).json({ success: false, error: 'Owner/Admin name is required' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid email is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    if (!planId || !mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ success: false, error: 'Please select a valid subscription plan' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'User with this email already exists' });
    }

    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Selected plan not found' });
    }

    let slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    if (!slug) slug = 'shop-' + Date.now();
    const existingSlug = await Tenant.findOne({ slug });
    if (existingSlug) {
      slug = `${slug}-${Date.now().toString().slice(-4)}`;
    }

    // Dynamic duration calculation
    let dates;
    if (customDurationDays && Number(customDurationDays) > 0) {
      dates = calculateSubscriptionDates('CUSTOM_DAYS', Number(customDurationDays), customStartDate);
    } else {
      dates = calculateSubscriptionDates(plan.durationType, plan.durationValue, customStartDate);
    }

    const initialStatus = plan.planType === 'FREE_TRIAL' ? 'TRIAL' : 'ACTIVE';
    const passwordHash = await bcrypt.hash(password, 10);

    // 1. Create Admin User
    const user = await User.create({
      name: ownerName.trim(),
      email: cleanEmail,
      passwordHash,
      role: 'ADMIN',
      phone: phone ? phone.trim() : null,
      status: 'ACTIVE',
    });

    // Calculate initial SMS and WhatsApp quotas from assigned plan
    const initialSmsQuota = (plan.freeSmsQuota && plan.freeSmsQuota > 0) ? Number(plan.freeSmsQuota) : 0;
    const initialWhatsAppQuota = (plan.freeWhatsAppQuota && plan.freeWhatsAppQuota > 0) ? Number(plan.freeWhatsAppQuota) : 0;

    // 2. Create Tenant
    const tenant = await Tenant.create({
      businessName: businessName.trim(),
      slug,
      owner: user._id,
      phone: phone ? phone.trim() : null,
      email: cleanEmail,
      address: address ? address.trim() : null,
      city: city ? city.trim() : null,
      state: state ? state.trim() : null,
      pincode: pincode ? pincode.trim() : null,
      gstin: gstin ? gstin.trim().toUpperCase() : null,
      status: initialStatus,
      smsBalance: initialSmsQuota,
      smsTotalCredited: initialSmsQuota,
      whatsAppBalance: initialWhatsAppQuota,
      whatsAppTotalCredited: initialWhatsAppQuota,
    });

    // 3. Create Subscription
    const subscription = await Subscription.create({
      tenant: tenant._id,
      plan: plan._id,
      startDate: dates.startDate,
      endDate: dates.endDate,
      status: initialStatus,
      paymentStatus: plan.planType === 'FREE_TRIAL' || plan.planType === 'FREE' ? 'FREE' : paymentStatus,
      amountPaid: (amountPaid !== undefined && amountPaid !== null && amountPaid !== '') ? Number(amountPaid) : plan.price,
      paymentMethod: paymentMethod || 'MANUAL',
      notes: notes ? notes.trim() : `Subscribed to ${plan.name}`,
    });

    // Link subscription
    tenant.currentSubscription = subscription._id;
    // Mark trial as used if plan is FREE_TRIAL or FREE
    if (plan.planType === 'FREE_TRIAL' || plan.planType === 'FREE') {
      tenant.hasUsedTrial = true;
    }
    await tenant.save();

    try {
      await AuditLog.create({
        action: 'CREATE_TENANT',
        entity: 'Tenant',
        entityId: tenant._id.toString(),
        details: { businessName: tenant.businessName, plan: plan.name, email: cleanEmail },
        performedBy: req.user?.email || 'admin@saasbilling.com',
      });
    } catch (auditErr) {
      console.warn('AuditLog create warning:', auditErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Business client & admin onboarded successfully',
      data: { ...tenant.toObject(), id: tenant._id },
    });
  } catch (error) {
    console.error('createTenant error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Server error creating tenant' });
  }
};

// Extend / Renew Subscription
exports.extendSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: 'Tenant not found (invalid ID)' });
    }

    const {
      planId,
      durationType,
      durationValue,
      customDays,
      customStartDate,
      paymentStatus = 'PAID',
      paymentMethod = 'UPI',
      amountPaid,
      notes,
    } = req.body;

    const tenant = await Tenant.findById(id).populate('currentSubscription');
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }

    if (!planId || !mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ success: false, error: 'Valid plan ID is required' });
    }

    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    const now = new Date();
    let startDate = now;
    if (tenant.currentSubscription && new Date(tenant.currentSubscription.endDate) > now && !customStartDate) {
      startDate = new Date(tenant.currentSubscription.endDate);
    } else if (customStartDate) {
      startDate = new Date(customStartDate);
    }

    const effectiveDurationType = durationType || plan.durationType;
    const effectiveDurationValue = customDays ? Number(customDays) : (durationValue ? Number(durationValue) : plan.durationValue);

    const dates = calculateSubscriptionDates(effectiveDurationType, effectiveDurationValue, startDate);

    const newSub = await Subscription.create({
      tenant: tenant._id,
      plan: plan._id,
      startDate: dates.startDate,
      endDate: dates.endDate,
      status: plan.planType === 'FREE_TRIAL' ? 'TRIAL' : 'ACTIVE',
      paymentStatus: plan.planType === 'FREE_TRIAL' || plan.planType === 'FREE' ? 'FREE' : paymentStatus,
      amountPaid: (amountPaid !== undefined && amountPaid !== null && amountPaid !== '') ? Number(amountPaid) : plan.price,
      paymentMethod: paymentMethod || 'MANUAL',
      notes: notes ? notes.trim() : `Extended with ${plan.name}`,
    });

    tenant.currentSubscription = newSub._id;
    tenant.status = plan.planType === 'FREE_TRIAL' ? 'TRIAL' : 'ACTIVE';

    // Credit plan's SMS & WhatsApp quotas if included
    if (plan.freeSmsQuota && plan.freeSmsQuota > 0) {
      tenant.smsBalance = (tenant.smsBalance || 0) + Number(plan.freeSmsQuota);
      tenant.smsTotalCredited = (tenant.smsTotalCredited || 0) + Number(plan.freeSmsQuota);
    }
    if (plan.freeWhatsAppQuota && plan.freeWhatsAppQuota > 0) {
      tenant.whatsAppBalance = (tenant.whatsAppBalance || 0) + Number(plan.freeWhatsAppQuota);
      tenant.whatsAppTotalCredited = (tenant.whatsAppTotalCredited || 0) + Number(plan.freeWhatsAppQuota);
    }

    await tenant.save();
    await cache.delPattern(`*${id}*`);
    await cache.flush();

    try {
      await AuditLog.create({
        action: 'EXTEND_SUBSCRIPTION',
        entity: 'Subscription',
        entityId: newSub._id.toString(),
        details: { businessName: tenant.businessName, plan: plan.name, endDate: dates.endDate },
        performedBy: req.user?.email || 'admin@saasbilling.com',
      });
    } catch (auditErr) {
      console.warn('AuditLog extend warning:', auditErr.message);
    }

    return res.json({
      success: true,
      message: 'Subscription extended successfully',
      data: newSub,
    });
  } catch (error) {
    console.error('extendSubscription error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Server error extending subscription' });
  }
};

// Update Tenant & Reset Password
exports.updateTenant = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: 'Tenant not found (invalid ID)' });
    }

    const { businessName, ownerName, phone, city, state, gstin, status, newPassword } = req.body;

    const tenant = await Tenant.findById(id);
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }

    if (businessName) tenant.businessName = businessName.trim();
    if (phone !== undefined) tenant.phone = phone ? phone.trim() : null;
    if (city !== undefined) tenant.city = city ? city.trim() : null;
    if (state !== undefined) tenant.state = state ? state.trim() : null;
    if (gstin !== undefined) tenant.gstin = gstin ? gstin.trim().toUpperCase() : null;
    if (status) tenant.status = status;
    await tenant.save();

    // Update User
    const userUpdate = {};
    if (ownerName) userUpdate.name = ownerName.trim();
    if (phone !== undefined) userUpdate.phone = phone ? phone.trim() : null;
    if (status) userUpdate.status = status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
    if (newPassword && newPassword.length >= 6) {
      userUpdate.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(userUpdate).length > 0) {
      await User.findByIdAndUpdate(tenant.owner, userUpdate);
    }

    return res.json({
      success: true,
      message: 'Admin and business updated successfully',
    });
  } catch (error) {
    console.error('updateTenant error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Server error updating tenant' });
  }
};

// Delete Tenant
exports.deleteTenant = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: 'Tenant not found (invalid ID)' });
    }

    const tenant = await Tenant.findById(id);
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }

    await Subscription.deleteMany({ tenant: tenant._id });
    await User.findByIdAndDelete(tenant.owner);
    await Tenant.findByIdAndDelete(id);

    return res.json({ success: true, message: 'Tenant and admin credentials deleted' });
  } catch (error) {
    console.error('deleteTenant error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Server error deleting tenant' });
  }
};

// Grant Free Booster / Quota Pack to Tenant (Super Admin action)
exports.grantBooster = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, credits, note } = req.body;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: 'Tenant not found (invalid ID)' });
    }

    if (!['SMS', 'WHATSAPP'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid booster type. Must be SMS or WHATSAPP.' });
    }

    const numCredits = parseInt(credits, 10);
    if (!numCredits || numCredits <= 0) {
      return res.status(400).json({ success: false, error: 'Credits must be a positive number (e.g. 50, 100, 500).' });
    }

    const tenant = await Tenant.findById(id);
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Tenant not found.' });
    }

    if (type === 'SMS') {
      tenant.smsBalance = (tenant.smsBalance || 0) + numCredits;
      tenant.smsTotalCredited = (tenant.smsTotalCredited || 0) + numCredits;
    } else {
      tenant.whatsAppBalance = (tenant.whatsAppBalance || 0) + numCredits;
      tenant.whatsAppTotalCredited = (tenant.whatsAppTotalCredited || 0) + numCredits;
    }

    await tenant.save();

    await AddOnOrder.create({
      tenant: tenant._id,
      type,
      creditsAdded: numCredits,
      amountPaid: 0,
      paymentMethod: 'SUPER_ADMIN_GRANT',
      paymentStatus: 'PAID',
      transactionRef: `FREE_GRANT_${Date.now()}`,
      notes: note || `Super Admin free complimentary ${type} booster pack`,
    });

    try {
      await AuditLog.create({
        action: 'GRANT_FREE_BOOSTER',
        entity: 'Tenant',
        entityId: tenant._id.toString(),
        details: { businessName: tenant.businessName, type, credits: numCredits, note },
        performedBy: req.user?.email || 'superadmin@billing.com',
      });
    } catch (_) {}

    await cache.delPattern(`*${id}*`);
    await cache.flush();

    return res.json({
      success: true,
      message: `🎉 Successfully gifted ${numCredits} free ${type} credits to ${tenant.businessName}!`,
      data: {
        smsBalance: tenant.smsBalance,
        whatsAppBalance: tenant.whatsAppBalance,
      },
    });
  } catch (error) {
    console.error('grantBooster error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to grant booster' });
  }
};
