const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'TRIAL', 'EXPIRED', 'CANCELLED'],
      default: 'ACTIVE',
    },
    paymentStatus: {
      type: String,
      enum: ['PAID', 'PENDING', 'FREE', 'WAIVED'],
      default: 'PAID',
    },
    amountPaid: { type: Number, default: 0 },
    paymentMethod: {
      type: String,
      enum: ['UPI', 'CASH', 'BANK_TRANSFER', 'ONLINE', 'MANUAL'],
      default: 'MANUAL',
    },
    transactionRef: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Subscription', subscriptionSchema);
