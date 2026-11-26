const mongoose = require('mongoose');

const globalSettingSchema = new mongoose.Schema(
  {
    isSmsGloballyEnabled: { type: Boolean, default: true },
    isWhatsAppGloballyEnabled: { type: Boolean, default: true },
    smsDisabledNotice: {
      type: String,
      default: 'SMS service is temporarily paused by Super Admin for maintenance.',
    },
    whatsAppDisabledNotice: {
      type: String,
      default: 'WhatsApp messaging is temporarily paused by Super Admin for maintenance.',
    },
    maintenanceMode: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GlobalSetting', globalSettingSchema);
