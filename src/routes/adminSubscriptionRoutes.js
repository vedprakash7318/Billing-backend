const express = require('express');
const router = express.Router();
const adminSubscriptionController = require('../controllers/adminSubscriptionController');
const { verifyToken, requireAdmin, attachTenant } = require('../middleware/auth');

router.use(verifyToken, requireAdmin, attachTenant);

router.get('/', adminSubscriptionController.getSubscriptionOverview);
router.post('/create-order', adminSubscriptionController.createRazorpayOrder);
router.post('/verify-payment', adminSubscriptionController.verifyRazorpayPayment);
router.post('/activate-free', adminSubscriptionController.activateFreePlan);
router.post('/recharge/create-order', adminSubscriptionController.createAddOnOrder);
router.post('/recharge/verify-payment', adminSubscriptionController.verifyAddOnPayment);
router.post('/toggle-autopay', adminSubscriptionController.toggleAutoPay);

module.exports = router;
