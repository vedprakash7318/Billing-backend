const mongoose = require('mongoose');

const addOnPackSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['SMS', 'WHATSAPP'],
      required: true,
      index: true,
    },
    credits: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    description: { type: String, trim: true, default: '' },
    isPopular: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

addOnPackSchema.index({ type: 1, isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('AddOnPack', addOnPackSchema);
