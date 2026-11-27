const express = require('express');
const router = express.Router();
const controller = require('../controllers/adminPaymentModeController');
const { verifyToken, requireAdmin, attachTenant } = require('../middleware/auth');

router.use(verifyToken, requireAdmin, attachTenant);

router.get('/', controller.getPaymentModes);
router.post('/', controller.createPaymentMode);
router.put('/:id/toggle', controller.togglePaymentMode);
router.delete('/:id', controller.deletePaymentMode);

module.exports = router;
