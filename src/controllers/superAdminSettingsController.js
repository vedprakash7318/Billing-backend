const GlobalSetting = require('../models/GlobalSetting');
const cache = require('../utils/cache');

// GET Global Settings (fetch or init)
exports.getGlobalSettings = async (req, res) => {
  try {
    let settings = await GlobalSetting.findOne();
    if (!settings) {
      settings = await GlobalSetting.create({
        isSmsGloballyEnabled: true,
        isWhatsAppGloballyEnabled: true,
        smsDisabledNotice: 'SMS service is temporarily paused by Super Admin for maintenance.',
        whatsAppDisabledNotice: 'WhatsApp messaging is temporarily paused by Super Admin for maintenance.',
        maintenanceMode: false,
      });
    }
    return res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error('getGlobalSettings error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error fetching global settings' });
  }
};

// UPDATE Global Settings
exports.updateGlobalSettings = async (req, res) => {
  try {
    const {
      isSmsGloballyEnabled,
      isWhatsAppGloballyEnabled,
      smsDisabledNotice,
      whatsAppDisabledNotice,
      maintenanceMode,
    } = req.body;

    let settings = await GlobalSetting.findOne();
    if (!settings) {
      settings = new GlobalSetting();
    }

    if (isSmsGloballyEnabled !== undefined) settings.isSmsGloballyEnabled = Boolean(isSmsGloballyEnabled);
    if (isWhatsAppGloballyEnabled !== undefined) settings.isWhatsAppGloballyEnabled = Boolean(isWhatsAppGloballyEnabled);
    if (smsDisabledNotice !== undefined) settings.smsDisabledNotice = smsDisabledNotice;
    if (whatsAppDisabledNotice !== undefined) settings.whatsAppDisabledNotice = whatsAppDisabledNotice;
    if (maintenanceMode !== undefined) settings.maintenanceMode = Boolean(maintenanceMode);

    await settings.save();
    await cache.flush();

    return res.json({
      success: true,
      message: 'Global settings updated successfully',
      data: settings,
    });
  } catch (error) {
    console.error('updateGlobalSettings error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error updating global settings' });
  }
};
