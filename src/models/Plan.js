const mongoose = require('mongoose');

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    planType: {
      type: String,
      enum: ['PAID', 'FREE_TRIAL', 'FREE', 'CUSTOM'],
      default: 'PAID',
    },
    durationType: {
      type: String,
      enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM_DAYS', 'LIFETIME'],
      default: 'MONTHLY',
    },
    durationValue: { type: Number, default: 1 }, // e.g. 7 for daily, 1 for month, 45 for custom days
    price: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    isPopular: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    maxInvoices: { type: Number, default: -1 }, // -1 = unlimited
    maxCustomers: { type: Number, default: -1 },
    maxProducts: { type: Number, default: -1 },
    maxUsers: { type: Number, default: -1 },
    features: [{ type: String }],
    // SMS & WhatsApp quota configurations
    isSmsEnabled: { type: Boolean, default: false },
    freeSmsQuota: { type: Number, default: 0 },
    isWhatsAppEnabled: { type: Boolean, default: false },
    freeWhatsAppQuota: { type: Number, default: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Indexes for fast active plans lookup
planSchema.index({ isActive: 1, sortOrder: 1, price: 1 });

module.exports = mongoose.model('Plan', planSchema);
