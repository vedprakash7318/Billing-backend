const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');

function escapeRegex(text) {
  if (!text) return '';
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// GET all employees (STAFF) for the current tenant
exports.getEmployees = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const search = req.query.search ? req.query.search.trim() : '';
    const status = req.query.status;

    const filter = { tenant: tenantId, role: 'STAFF' };

    if (search) {
      const safeSearch = escapeRegex(search);
      filter.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } },
        { phone: { $regex: safeSearch, $options: 'i' } },
        { designation: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    if (status && status !== 'ALL') {
      filter.status = status;
    }

    const employees = await User.find(filter)
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      data: employees.map((e) => ({ ...e, id: e._id })),
      total: employees.length,
    });
  } catch (error) {
    console.error('getEmployees error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error fetching employees' });
  }
};

// GET single employee by ID
exports.getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    const employee = await User.findOne({ _id: id, tenant: req.tenant._id, role: 'STAFF' })
      .select('-passwordHash')
      .lean();

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    return res.json({ success: true, data: { ...employee, id: employee._id } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// CREATE new employee
exports.createEmployee = async (req, res) => {
  try {
    const { name, email, phone = '', password, designation = 'Cashier', status = 'ACTIVE' } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Employee name is required' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid email is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const employee = await User.create({
      name: name.trim(),
      email: cleanEmail,
      phone: phone ? phone.trim() : '',
      passwordHash,
      role: 'STAFF',
      tenant: req.tenant._id,
      designation: designation ? designation.trim() : 'Cashier',
      status: ['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status) ? status : 'ACTIVE',
    });

    const result = employee.toObject();
    delete result.passwordHash;

    return res.status(201).json({
      success: true,
      message: 'Employee added successfully',
      data: { ...result, id: result._id },
    });
  } catch (error) {
    console.error('createEmployee error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error creating employee' });
  }
};

// UPDATE employee
exports.updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    const employee = await User.findOne({ _id: id, tenant: req.tenant._id, role: 'STAFF' });
    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    const { name, phone, designation, status, newPassword } = req.body;

    if (name && name.trim()) employee.name = name.trim();
    if (phone !== undefined) employee.phone = phone.trim();
    if (designation && designation.trim()) employee.designation = designation.trim();
    if (status && ['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status)) {
      employee.status = status;
    }

    if (newPassword && newPassword.trim()) {
      if (newPassword.trim().length < 6) {
        return res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
      }
      employee.passwordHash = await bcrypt.hash(newPassword.trim(), 10);
    }

    await employee.save();

    const result = employee.toObject();
    delete result.passwordHash;

    return res.json({
      success: true,
      message: 'Employee updated successfully',
      data: { ...result, id: result._id },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// DELETE employee
exports.deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    const employee = await User.findOne({ _id: id, tenant: req.tenant._id, role: 'STAFF' });
    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    await User.deleteOne({ _id: employee._id });

    return res.json({ success: true, message: 'Employee removed successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
