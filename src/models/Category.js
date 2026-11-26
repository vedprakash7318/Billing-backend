const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, lowercase: true },
    description: { type: String, trim: true, default: '' },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Compound index so category name is unique per tenant + fast sorting index
categorySchema.index({ tenant: 1, name: 1 }, { unique: true });
categorySchema.index({ tenant: 1, isActive: 1, createdAt: -1 });

module.exports = mongoose.model('Category', categorySchema);
