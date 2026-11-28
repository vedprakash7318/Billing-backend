const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, lowercase: true },
    uniqueCode: { type: String, required: true, trim: true, uppercase: true, index: true },
    description: { type: String, trim: true, default: '' },
    price: { type: Number, required: true, min: 0, default: 0 },
    mrp: { type: Number, min: 0, default: 0 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: false, default: null, index: true },
    image: { type: String, trim: true, default: '' },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Compound indexes for lightning-fast queries per tenant
productSchema.index({ tenant: 1, uniqueCode: 1 }, { unique: true });
productSchema.index({ tenant: 1, isActive: 1, createdAt: -1 });
productSchema.index({ tenant: 1, category: 1, isActive: 1 });
productSchema.index({ tenant: 1, title: 1 });

module.exports = mongoose.model('Product', productSchema);
