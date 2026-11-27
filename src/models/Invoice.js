const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  title: { type: String, required: true },
  uniqueCode: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  total: { type: Number, required: true, min: 0 },
});

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, trim: true, index: true },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    customerName: { type: String, trim: true, default: 'Walk-in Customer' },
    customerPhone: { type: String, trim: true, default: '' },
    items: [invoiceItemSchema],
    subtotal: { type: Number, required: true, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true, default: 0 },
    paymentMode: {
      type: String,
      enum: ['CASH', 'UPI', 'CARD', 'CREDIT', 'SPLIT'],
      default: 'CASH',
    },
    paymentStatus: {
      type: String,
      enum: ['PAID', 'PENDING', 'PARTIAL'],
      default: 'PAID',
    },
    deliveryMethod: {
      type: String,
      enum: ['PRINT', 'SMS', 'WHATSAPP'],
      default: 'PRINT',
    },
    deliveryStatus: {
      type: String,
      enum: ['PRINTED', 'SENT', 'PENDING'],
      default: 'PRINTED',
    },
    notes: { type: String, trim: true, default: '' },
    // Cashier / Employee who generated this bill
    billedBy: {
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      name: { type: String, default: 'Store Admin' },
      role: { type: String, default: 'ADMIN' },
      designation: { type: String, default: 'Cashier' },
    },
    // Snapshot of header/footer at the moment bill was printed
    billSnapshot: { type: Object, default: {} },
  },
  { timestamps: true }
);

// Compound indexes for lightning-fast queries & reporting
invoiceSchema.index({ tenant: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ tenant: 1, createdAt: -1 });
invoiceSchema.index({ tenant: 1, paymentMode: 1, createdAt: -1 });
invoiceSchema.index({ tenant: 1, customerPhone: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
