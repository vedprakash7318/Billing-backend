const express = require('express');
const router = express.Router();
const billSettingController = require('../controllers/billSettingController');
const { verifyToken, requireAdmin, attachTenant } = require('../middleware/auth');

router.use(verifyToken, requireAdmin, attachTenant);

router.get('/', billSettingController.getBillSettings);
router.put('/', billSettingController.updateBillSettings);

module.exports = router;
