const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['SUPER_ADMIN', 'ADMIN', 'STAFF'],
      default: 'ADMIN',
    },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    designation: { type: String, trim: true, default: 'Cashier' },
    phone: { type: String, trim: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
      default: 'ACTIVE',
    },
  },
  { timestamps: true }
);

// Fast role and status indexes per tenant
userSchema.index({ tenant: 1, role: 1, status: 1 });

module.exports = mongoose.model('User', userSchema);
