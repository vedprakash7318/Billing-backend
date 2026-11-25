const express = require('express');
const router = express.Router();
const adminSubscriptionController = require('../controllers/adminSubscriptionController');
const { verifyToken, requireAdmin, attachTenant } = require('../middleware/auth');

router.use(verifyToken, requireAdmin, attachTenant);

router.get('/', adminSubscriptionController.getSubscriptionOverview);
router.post('/activate', adminSubscriptionController.activatePlan);

module.exports = router;
