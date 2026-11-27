const mongoose = require('mongoose');

const paymentModeSchema = new mongoose.Schema(
  {
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    icon: { type: String, default: 'CreditCard', trim: true },
    color: { type: String, default: 'text-emerald-600', trim: true },
    description: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Multi-tenant unique index: prevent duplicate code within the same tenant
paymentModeSchema.index({ tenant: 1, code: 1 }, { unique: true });
paymentModeSchema.index({ tenant: 1, isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('PaymentMode', paymentModeSchema);
