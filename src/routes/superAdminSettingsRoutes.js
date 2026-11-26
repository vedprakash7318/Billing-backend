const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/superAdminSettingsController');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');

router.use(verifyToken, requireSuperAdmin);

router.get('/', settingsController.getGlobalSettings);
router.put('/', settingsController.updateGlobalSettings);

module.exports = router;
