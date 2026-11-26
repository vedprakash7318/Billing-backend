const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { verifyToken, requireAdmin, attachTenant, requireActiveSubscription } = require('../middleware/auth');

router.use(verifyToken, requireAdmin, attachTenant);

router.get('/', invoiceController.getInvoices);
router.get('/:id', invoiceController.getInvoiceById);
router.post('/', requireActiveSubscription, invoiceController.createInvoice);
router.post('/:id/send-receipt', requireActiveSubscription, invoiceController.sendInvoiceReceipt);

module.exports = router;
