const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Razorpay Webhooks (public endpoint with signature verification)
router.post('/razorpay', webhookController.handleRazorpayWebhook);

module.exports = router;
