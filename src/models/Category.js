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

// Compound index so category name is unique per tenant
categorySchema.index({ tenant: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Category', categorySchema);
