const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Tenant = require('../models/Tenant');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_billing_saas_2026_express_mongo';

// Super Admin Login
exports.superAdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || user.role !== 'SUPER_ADMIN') {
      return res.status(401).json({ success: false, error: 'Invalid super admin credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid super admin credentials' });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '3650d' } // 10 years permanent session until manual logout
    );

    return res.json({
      success: true,
      message: 'Super Admin login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Client Admin / Staff Login
exports.clientAdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN' && user.role !== 'STAFF')) {
      return res.status(401).json({ success: false, error: 'Invalid user credentials' });
    }

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ success: false, error: 'Your account is suspended' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid user credentials' });
    }

    let tenant = null;
    if (user.role === 'STAFF' && user.tenant) {
      tenant = await Tenant.findById(user.tenant).populate({
        path: 'currentSubscription',
        populate: { path: 'plan' },
      });

      // RULE: Staff / Employee cannot login if subscription is expired
      const currentSub = tenant?.currentSubscription;
      const now = new Date();
      const isExpired =
        !currentSub ||
        currentSub.status === 'EXPIRED' ||
        tenant?.status === 'EXPIRED' ||
        (currentSub.endDate && new Date(currentSub.endDate) < now);

      if (isExpired) {
        return res.status(403).json({
          success: false,
          error: 'Store subscription is expired. Only Store Admin can login to view details and renew the subscription.',
          isSubscriptionExpired: true,
        });
      }
    } else {
      tenant = await Tenant.findOne({ owner: user._id }).populate({
        path: 'currentSubscription',
        populate: { path: 'plan' },
      });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role, name: user.name, tenantId: tenant?._id },
      JWT_SECRET,
      { expiresIn: '3650d' } // 10 years permanent session until manual logout
    );

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        designation: user.designation,
        tenant,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Get Current User
exports.getMe = async (req, res) => {
  return res.json({
    success: true,
    user: req.user,
  });
};

// Get Full Profile (User + Store/Tenant)
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-passwordHash');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    let tenant = null;
    if (user.role === 'STAFF' && user.tenant) {
      tenant = await Tenant.findById(user.tenant).populate({
        path: 'currentSubscription',
        populate: { path: 'plan' },
      });
    } else {
      tenant = await Tenant.findOne({ owner: user._id }).populate({
        path: 'currentSubscription',
        populate: { path: 'plan' },
      });
    }

    return res.json({
      success: true,
      data: {
        user,
        tenant,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Update Profile & Store Details
exports.updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const {
      name,
      phone,
      password,
      businessName,
      address,
      city,
      state,
      pincode,
      gstin,
    } = req.body;

    if (name && name.trim()) user.name = name.trim();
    if (phone !== undefined) user.phone = phone.trim();

    if (password && password.trim().length >= 4) {
      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(password.trim(), salt);
    }

    await user.save();

    // If user owns a tenant or is an admin, update tenant
    let tenant = null;
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      tenant = await Tenant.findOne({ owner: user._id });
      if (tenant) {
        if (businessName && businessName.trim()) tenant.businessName = businessName.trim();
        if (address !== undefined) tenant.address = address.trim();
        if (city !== undefined) tenant.city = city.trim();
        if (state !== undefined) tenant.state = state.trim();
        if (pincode !== undefined) tenant.pincode = pincode.trim();
        if (gstin !== undefined) tenant.gstin = gstin.trim().toUpperCase();
        if (phone !== undefined) tenant.phone = phone.trim();
        await tenant.save();

        // Also sync with BillSetting so receipt reflects the updated businessName/address/phone/gstin
        const BillSetting = require('../models/BillSetting');
        await BillSetting.updateOne(
          { tenant: tenant._id },
          {
            $set: {
              businessName: tenant.businessName,
              address: tenant.address,
              phone: tenant.phone,
              gstin: tenant.gstin,
            },
          }
        );
      }
    }

    const updatedUser = await User.findById(user._id).select('-passwordHash');

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: updatedUser,
        tenant,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
