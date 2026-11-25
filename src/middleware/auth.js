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
  if (!req.user || (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN')) {
    return res.status(403).json({ success: false, error: 'Forbidden: Admin access required' });
  }
  next();
};

const attachTenant = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    let tenant = await Tenant.findOne({ owner: req.user._id }).populate({
      path: 'currentSubscription',
      populate: { path: 'plan' },
    });

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

    req.tenant = tenant;
    next();
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  verifyToken,
  requireSuperAdmin,
  requireAdmin,
  attachTenant,
};
