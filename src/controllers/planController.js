const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const AuditLog = require('../models/AuditLog');

// Helper to escape regex special characters
function escapeRegex(text) {
  if (!text) return '';
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// GET Plans with Server-side Pagination & Searching
exports.getPlans = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const search = req.query.search ? req.query.search.trim() : '';
    const durationType = req.query.durationType;
    const planType = req.query.planType;
    const status = req.query.status;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

    // Build MongoDB filter query
    const filter = {};

    if (search) {
      const safeSearch = escapeRegex(search);
      filter.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { slug: { $regex: safeSearch, $options: 'i' } },
        { description: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    if (durationType && durationType !== 'ALL') {
      filter.durationType = durationType;
    }

    if (planType && planType !== 'ALL') {
      filter.planType = planType;
    }

    if (status === 'active') {
      filter.isActive = true;
    } else if (status === 'inactive') {
      filter.isActive = false;
    }

    const skip = (page - 1) * limit;

    const [total, plans] = await Promise.all([
      Plan.countDocuments(filter),
      Plan.find(filter)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    // Attach subscriber count to each plan
    const plansWithCount = await Promise.all(
      plans.map(async (plan) => {
        const subCount = await Subscription.countDocuments({ plan: plan._id });
        return { ...plan, id: plan._id, subscriberCount: subCount };
      })
    );

    const totalPages = Math.ceil(total / limit) || 1;

    return res.json({
      success: true,
      data: plansWithCount,
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
    console.error('getPlans error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Server error fetching plans' });
  }
};

// GET Single Plan by ID
exports.getPlanById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: 'Plan not found (invalid ID)' });
    }

    const plan = await Plan.findById(id).lean();
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    return res.json({ success: true, data: { ...plan, id: plan._id } });
  } catch (error) {
    console.error('getPlanById error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Server error fetching plan' });
  }
};

// Create Dynamic Plan
exports.createPlan = async (req, res) => {
  try {
    const {
      name,
      slug,
      description = '',
      planType = 'PAID',
      durationType = 'MONTHLY',
      durationValue = 1,
      price = 0,
      currency = 'INR',
      isPopular = false,
      isActive = true,
      maxInvoices = -1,
      maxCustomers = -1,
      maxProducts = -1,
      maxUsers = -1,
      features = ['all_permissions'],
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Plan name is required' });
    }

    let finalSlug = slug ? slug.trim().toLowerCase() : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    if (!finalSlug) finalSlug = 'plan-' + Date.now();

    const existing = await Plan.findOne({ slug: finalSlug });
    if (existing) {
      finalSlug = `${finalSlug}-${Date.now().toString().slice(-4)}`;
    }

    const newPlan = await Plan.create({
      name: name.trim(),
      slug: finalSlug,
      description: description ? description.trim() : '',
      planType,
      durationType,
      durationValue: Math.max(1, Number(durationValue) || 1),
      price: planType === 'FREE_TRIAL' || planType === 'FREE' ? 0 : Math.max(0, Number(price) || 0),
      currency: currency || 'INR',
      isPopular: Boolean(isPopular),
      isActive: Boolean(isActive),
      maxInvoices: Number(maxInvoices) || -1,
      maxCustomers: Number(maxCustomers) || -1,
      maxProducts: Number(maxProducts) || -1,
      maxUsers: Number(maxUsers) || -1,
      features: Array.isArray(features) ? features : ['all_permissions'],
      isSmsEnabled: Boolean(req.body.isSmsEnabled),
      freeSmsQuota: Math.max(0, Number(req.body.freeSmsQuota) || 0),
      isWhatsAppEnabled: Boolean(req.body.isWhatsAppEnabled),
      freeWhatsAppQuota: Math.max(0, Number(req.body.freeWhatsAppQuota) || 0),
    });

    try {
      await AuditLog.create({
        action: 'CREATE_PLAN',
        entity: 'Plan',
        entityId: newPlan._id.toString(),
        details: { name: newPlan.name, price: newPlan.price, durationType },
        performedBy: req.user?.email || 'admin@saasbilling.com',
      });
    } catch (auditErr) {
      console.warn('AuditLog creation warning:', auditErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Dynamic plan created successfully',
      data: { ...newPlan.toObject(), id: newPlan._id },
    });
  } catch (error) {
    console.error('createPlan error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Server error creating plan' });
  }
};

// Update Plan
exports.updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: 'Plan not found (invalid ID)' });
    }

    const updateData = { ...req.body };

    if (updateData.name) updateData.name = updateData.name.trim();
    if (updateData.slug) updateData.slug = updateData.slug.trim().toLowerCase();
    if (updateData.price !== undefined) {
      updateData.price = updateData.planType === 'FREE_TRIAL' || updateData.planType === 'FREE' ? 0 : Math.max(0, Number(updateData.price) || 0);
    }
    if (updateData.durationValue !== undefined) {
      updateData.durationValue = Math.max(1, Number(updateData.durationValue) || 1);
    }

    // Check slug collision
    if (updateData.slug) {
      const existing = await Plan.findOne({ slug: updateData.slug, _id: { $ne: id } });
      if (existing) {
        return res.status(400).json({ success: false, error: 'Slug is already used by another plan' });
      }
    }

    const updated = await Plan.findByIdAndUpdate(id, updateData, { new: true });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    try {
      await AuditLog.create({
        action: 'UPDATE_PLAN',
        entity: 'Plan',
        entityId: updated._id.toString(),
        details: { name: updated.name, price: updated.price },
        performedBy: req.user?.email || 'admin@saasbilling.com',
      });
    } catch (auditErr) {
      console.warn('AuditLog update warning:', auditErr.message);
    }

    return res.json({
      success: true,
      message: 'Plan updated successfully',
      data: { ...updated.toObject(), id: updated._id },
    });
  } catch (error) {
    console.error('updatePlan error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Server error updating plan' });
  }
};

// Delete / Deactivate Plan
exports.deletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: 'Plan not found (invalid ID)' });
    }

    const subCount = await Subscription.countDocuments({ plan: id });
    if (subCount > 0) {
      await Plan.findByIdAndUpdate(id, { isActive: false });
      return res.json({
        success: true,
        message: `Plan has ${subCount} active subscribers. It was deactivated instead of deleted to protect historical records.`,
      });
    }

    await Plan.findByIdAndDelete(id);
    return res.json({ success: true, message: 'Plan deleted successfully' });
  } catch (error) {
    console.error('deletePlan error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Server error deleting plan' });
  }
};
