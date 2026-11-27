const PaymentMode = require('../models/PaymentMode');

const PLATFORM_SUGGESTIONS = [
  { name: 'Cash', code: 'CASH', icon: 'Banknote', color: 'text-emerald-600', description: 'Cash payment at counter' },
  { name: 'UPI', code: 'UPI', icon: 'QrCode', color: 'text-purple-600', description: 'Google Pay, PhonePe, Paytm QR' },
  { name: 'Card', code: 'CARD', icon: 'CreditCard', color: 'text-blue-600', description: 'Card swipe / POS terminal' },
  { name: 'Credit (Khata / Udhar)', code: 'CREDIT', icon: 'BookOpen', color: 'text-amber-600', description: 'Customer store credit book' },
  { name: 'Paytm / PhonePe Direct', code: 'PAYTM', icon: 'Smartphone', color: 'text-cyan-600', description: 'Direct mobile wallet' },
  { name: 'Bank Transfer / NEFT', code: 'BANK_TRANSFER', icon: 'Landmark', color: 'text-indigo-600', description: 'Direct account transfer' },
  { name: 'Cheque', code: 'CHEQUE', icon: 'FileText', color: 'text-slate-600', description: 'Bank cheque' },
  { name: 'Food / Shopping Voucher', code: 'VOUCHER', icon: 'Tag', color: 'text-rose-600', description: 'Sodexo or store coupon' },
];

// Helper: Ensure initial defaults exist for a tenant
async function ensureDefaultModesForTenant(tenantId) {
  const count = await PaymentMode.countDocuments({ tenant: tenantId });
  if (count === 0) {
    const initialDefaults = [
      { tenant: tenantId, name: 'Cash', code: 'CASH', icon: 'Banknote', color: 'text-emerald-600', isActive: true, isDefault: true, sortOrder: 1 },
      { tenant: tenantId, name: 'UPI', code: 'UPI', icon: 'QrCode', color: 'text-purple-600', isActive: true, isDefault: false, sortOrder: 2 },
      { tenant: tenantId, name: 'Card', code: 'CARD', icon: 'CreditCard', color: 'text-blue-600', isActive: true, isDefault: false, sortOrder: 3 },
    ];
    await PaymentMode.insertMany(initialDefaults);
  }
}

// 1. GET ALL PAYMENT MODES FOR TENANT
exports.getPaymentModes = async (req, res) => {
  try {
    const tenantId = req.tenant._id;

    // Auto-seed defaults if brand new tenant
    await ensureDefaultModesForTenant(tenantId);

    const modes = await PaymentMode.find({ tenant: tenantId })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    const existingCodes = new Set(modes.map((m) => (m.code || '').toUpperCase()));
    const existingNames = new Set(modes.map((m) => (m.name || '').toUpperCase().trim()));

    const availableSuggestions = PLATFORM_SUGGESTIONS.filter((s) => {
      const codeMatch = existingCodes.has(s.code.toUpperCase());
      const nameMatch = existingNames.has(s.name.toUpperCase().trim()) ||
        (s.code === 'UPI' && Array.from(existingNames).some((n) => n.includes('UPI')));
      return !codeMatch && !nameMatch;
    });

    return res.json({
      success: true,
      data: modes.map((m) => ({ ...m, id: m._id })),
      suggestions: availableSuggestions,
    });
  } catch (error) {
    console.error('getPaymentModes error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch payment modes' });
  }
};

// 2. CREATE A NEW PAYMENT MODE (Custom or from Suggestion)
exports.createPaymentMode = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const { name, code, icon, color, description, isDefault } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Payment mode name is required' });
    }

    const cleanName = name.trim();
    const cleanCode = (code ? code.trim() : cleanName)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 30);

    // Multi-tenant check: Is this code already used by THIS store?
    const existing = await PaymentMode.findOne({ tenant: tenantId, code: cleanCode });
    if (existing) {
      // If it exists but is inactive, activate it
      if (!existing.isActive) {
        existing.isActive = true;
        await existing.save();
        return res.json({
          success: true,
          message: `Payment mode "${existing.name}" re-activated!`,
          data: { ...existing.toObject(), id: existing._id },
        });
      }
      return res.status(400).json({ success: false, error: `Payment mode "${cleanName}" already exists for your store` });
    }

    // If marked as default, unset other defaults
    if (isDefault) {
      await PaymentMode.updateMany({ tenant: tenantId }, { isDefault: false });
    }

    // Determine icon and color matching suggestion if applicable
    const matchedSuggestion = PLATFORM_SUGGESTIONS.find((s) => s.code === cleanCode);
    const chosenIcon = icon || matchedSuggestion?.icon || 'CreditCard';
    const chosenColor = color || matchedSuggestion?.color || 'text-emerald-600';

    const count = await PaymentMode.countDocuments({ tenant: tenantId });

    const newMode = await PaymentMode.create({
      tenant: tenantId,
      name: cleanName,
      code: cleanCode,
      icon: chosenIcon,
      color: chosenColor,
      description: description ? description.trim() : (matchedSuggestion?.description || ''),
      isActive: true,
      isDefault: Boolean(isDefault),
      sortOrder: count + 1,
    });

    return res.status(201).json({
      success: true,
      message: `Payment mode "${cleanName}" created successfully!`,
      data: { ...newMode.toObject(), id: newMode._id },
    });
  } catch (error) {
    console.error('createPaymentMode error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to create payment mode' });
  }
};

// 3. TOGGLE ACTIVE / INACTIVE
exports.togglePaymentMode = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const { id } = req.params;

    const mode = await PaymentMode.findOne({ _id: id, tenant: tenantId });
    if (!mode) {
      return res.status(404).json({ success: false, error: 'Payment mode not found' });
    }

    mode.isActive = !mode.isActive;
    await mode.save();

    return res.json({
      success: true,
      message: `Payment mode "${mode.name}" is now ${mode.isActive ? 'Active' : 'Disabled'}`,
      data: { ...mode.toObject(), id: mode._id },
    });
  } catch (error) {
    console.error('togglePaymentMode error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to update payment mode' });
  }
};

// 4. DELETE PAYMENT MODE
exports.deletePaymentMode = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const { id } = req.params;

    const mode = await PaymentMode.findOneAndDelete({ _id: id, tenant: tenantId });
    if (!mode) {
      return res.status(404).json({ success: false, error: 'Payment mode not found' });
    }

    return res.json({
      success: true,
      message: `Payment mode "${mode.name}" deleted.`,
    });
  } catch (error) {
    console.error('deletePaymentMode error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to delete payment mode' });
  }
};
