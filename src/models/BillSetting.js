const mongoose = require('mongoose');

const billSettingSchema = new mongoose.Schema(
  {
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true, index: true },
    // Header Configuration
    headerTitle: { type: String, default: 'TAX INVOICE', trim: true },
    businessName: { type: String, trim: true, default: '' },
    tagline: { type: String, trim: true, default: 'Wholesale & Retail Billing' },
    address: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    gstin: { type: String, trim: true, default: '' },
    showGstin: { type: Boolean, default: true },
    showPhone: { type: Boolean, default: true },
    showAddress: { type: Boolean, default: true },

    // Footer Configuration
    footerMessage: { type: String, trim: true, default: 'Thank You for Shopping With Us! Visit Again 🙏' },
    termsAndConditions: {
      type: String,
      trim: true,
      default: '1. Goods once sold cannot be returned without original bill.\n2. Warranty as per manufacturer terms.\n3. Subject to local jurisdiction.',
    },
    upiId: { type: String, trim: true, default: '' },
    authorizedSignatoryText: { type: String, trim: true, default: 'Authorized Signatory' },
    showSignatory: { type: Boolean, default: true },
    paperSize: { type: String, enum: ['THERMAL_80MM', 'THERMAL_58MM', 'A4'], default: 'THERMAL_80MM' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BillSetting', billSettingSchema);
