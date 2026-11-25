const BillSetting = require('../models/BillSetting');

// Get bill print settings (header & footer) for the store
exports.getBillSettings = async (req, res) => {
  try {
    const tenant = req.tenant;
    let setting = await BillSetting.findOne({ tenant: tenant._id });

    if (!setting) {
      // Auto-create with store's initial defaults
      setting = await BillSetting.create({
        tenant: tenant._id,
        headerTitle: 'TAX INVOICE',
        businessName: tenant.businessName || '',
        tagline: 'Wholesale & Retail Billing',
        address: [tenant.address, tenant.city, tenant.state, tenant.pincode].filter(Boolean).join(', ') || '',
        phone: tenant.phone || '',
        email: tenant.email || '',
        gstin: tenant.gstin || '',
        showGstin: Boolean(tenant.gstin),
        showPhone: true,
        showAddress: true,
        footerMessage: 'Thank You for Shopping With Us! Visit Again 🙏',
        termsAndConditions: '1. Goods once sold cannot be returned without original bill.\n2. Warranty as per manufacturer terms.\n3. Subject to local jurisdiction.',
        upiId: '',
        authorizedSignatoryText: 'Authorized Signatory',
        showSignatory: true,
        paperSize: 'THERMAL_80MM',
      });
    }

    return res.json({ success: true, data: setting });
  } catch (error) {
    console.error('getBillSettings error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error fetching bill settings' });
  }
};

// Update bill print settings (header & footer)
exports.updateBillSettings = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const {
      headerTitle,
      businessName,
      tagline,
      address,
      phone,
      email,
      gstin,
      showGstin,
      showPhone,
      showAddress,
      footerMessage,
      termsAndConditions,
      upiId,
      authorizedSignatoryText,
      showSignatory,
      paperSize,
    } = req.body;

    let setting = await BillSetting.findOne({ tenant: tenantId });
    if (!setting) {
      setting = new BillSetting({ tenant: tenantId });
    }

    if (headerTitle !== undefined) setting.headerTitle = headerTitle.trim();
    if (businessName !== undefined) setting.businessName = businessName.trim();
    if (tagline !== undefined) setting.tagline = tagline.trim();
    if (address !== undefined) setting.address = address.trim();
    if (phone !== undefined) setting.phone = phone.trim();
    if (email !== undefined) setting.email = email.trim();
    if (gstin !== undefined) setting.gstin = gstin.trim().toUpperCase();
    if (showGstin !== undefined) setting.showGstin = Boolean(showGstin);
    if (showPhone !== undefined) setting.showPhone = Boolean(showPhone);
    if (showAddress !== undefined) setting.showAddress = Boolean(showAddress);

    if (footerMessage !== undefined) setting.footerMessage = footerMessage.trim();
    if (termsAndConditions !== undefined) setting.termsAndConditions = termsAndConditions.trim();
    if (upiId !== undefined) setting.upiId = upiId.trim();
    if (authorizedSignatoryText !== undefined) setting.authorizedSignatoryText = authorizedSignatoryText.trim();
    if (showSignatory !== undefined) setting.showSignatory = Boolean(showSignatory);
    if (paperSize !== undefined) setting.paperSize = paperSize;

    await setting.save();

    return res.json({
      success: true,
      message: 'Bill Header & Footer print settings saved successfully',
      data: setting,
    });
  } catch (error) {
    console.error('updateBillSettings error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error updating bill settings' });
  }
};
