const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { verifyToken, requireAdmin, attachTenant } = require('../middleware/auth');

router.use(verifyToken, requireAdmin, attachTenant);

router.get('/', invoiceController.getInvoices);
router.get('/:id', invoiceController.getInvoiceById);
router.post('/', invoiceController.createInvoice);

module.exports = router;
