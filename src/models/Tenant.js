const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    businessName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    gstin: { type: String, trim: true, uppercase: true },
    logo: { type: String },
    currency: { type: String, default: 'INR' },
    status: {
      type: String,
      enum: ['ACTIVE', 'TRIAL', 'EXPIRED', 'SUSPENDED'],
      default: 'ACTIVE',
    },
    currentSubscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
  },
  { timestamps: true }
);

// Indexes for tenant lookups and subscription resolution
tenantSchema.index({ status: 1 });
tenantSchema.index({ currentSubscription: 1 });
tenantSchema.index({ owner: 1 });

module.exports = mongoose.model('Tenant', tenantSchema);
