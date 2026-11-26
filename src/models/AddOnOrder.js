const mongoose = require('mongoose');

const addOnOrderSchema = new mongoose.Schema(
  {
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    pack: { type: mongoose.Schema.Types.ObjectId, ref: 'AddOnPack', required: true },
    type: { type: String, enum: ['SMS', 'WHATSAPP'], required: true },
    creditsAdded: { type: Number, required: true },
    amountPaid: { type: Number, required: true },
    paymentMethod: { type: String, default: 'UPI' },
    paymentStatus: { type: String, enum: ['PAID', 'PENDING', 'FAILED'], default: 'PAID' },
    transactionRef: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

addOnOrderSchema.index({ tenant: 1, createdAt: -1 });

module.exports = mongoose.model('AddOnOrder', addOnOrderSchema);
