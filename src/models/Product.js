const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, lowercase: true },
    uniqueCode: { type: String, required: true, trim: true, uppercase: true, index: true },
    description: { type: String, trim: true, default: '' },
    price: { type: Number, required: true, min: 0, default: 0 },
    mrp: { type: Number, min: 0, default: 0 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    image: { type: String, trim: true, default: '' },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Compound index so uniqueCode is unique per tenant
productSchema.index({ tenant: 1, uniqueCode: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);
