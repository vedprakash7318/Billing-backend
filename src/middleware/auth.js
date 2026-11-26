const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Tenant = require('../models/Tenant');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_billing_saas_2026_express_mongo';

const verifyToken = async (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-passwordHash');
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ success: false, error: 'Account suspended' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};

const requireSuperAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'Forbidden: Super Admin access required' });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user || (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'STAFF')) {
    return res.status(403).json({ success: false, error: 'Forbidden: Admin access required' });
  }
  next();
};

const attachTenant = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    let tenant = null;
    if (req.user.role === 'STAFF' && req.user.tenant) {
      tenant = await Tenant.findById(req.user.tenant).populate({
        path: 'currentSubscription',
        populate: { path: 'plan' },
      });
    } else {
      tenant = await Tenant.findOne({ owner: req.user._id }).populate({
        path: 'currentSubscription',
        populate: { path: 'plan' },
      });
    }

    if (!tenant && req.headers['x-tenant-id'] && req.user.role === 'SUPER_ADMIN') {
      tenant = await Tenant.findById(req.headers['x-tenant-id']).populate({
        path: 'currentSubscription',
        populate: { path: 'plan' },
      });
    }

    if (!tenant) {
      return res.status(404).json({ success: false, error: 'No associated store/tenant found for this admin' });
    }

    if (tenant.status === 'SUSPENDED') {
      return res.status(403).json({ success: false, error: 'Store access has been suspended by Super Admin' });
    }

    // Check Subscription status and calculate expiry
    const now = new Date();
    const currentSub = tenant.currentSubscription;
    const isExpired =
      !currentSub ||
      currentSub.status === 'EXPIRED' ||
      tenant.status === 'EXPIRED' ||
      (currentSub.endDate && new Date(currentSub.endDate) < now);

    req.isSubscriptionExpired = isExpired;

    // RULE: If employee (STAFF) attempts access when subscription is expired, block them completely
    if (req.user.role === 'STAFF' && isExpired) {
      return res.status(403).json({
        success: false,
        error: 'Store subscription has expired. Please contact Store Admin to renew the subscription.',
        isSubscriptionExpired: true,
      });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const requireActiveSubscription = (req, res, next) => {
  if (req.isSubscriptionExpired) {
    return res.status(403).json({
      success: false,
      error: 'Your subscription plan has expired. Please renew or activate a plan to add products, categories, or create new bills.',
      isSubscriptionExpired: true,
    });
  }
  next();
};

module.exports = {
  verifyToken,
  requireSuperAdmin,
  requireAdmin,
  attachTenant,
  requireActiveSubscription,
};
