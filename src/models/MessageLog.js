const mongoose = require('mongoose');

const messageLogSchema = new mongoose.Schema(
  {
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    type: { type: String, enum: ['SMS', 'WHATSAPP'], required: true, index: true },
    recipient: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['DELIVERED', 'FAILED', 'BLOCKED'], default: 'DELIVERED' },
    failureReason: { type: String, default: '' },
    costDeducted: { type: Number, default: 1 },
  },
  { timestamps: true }
);

messageLogSchema.index({ tenant: 1, createdAt: -1 });

module.exports = mongoose.model('MessageLog', messageLogSchema);
