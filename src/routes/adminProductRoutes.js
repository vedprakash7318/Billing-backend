const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { verifyToken, requireAdmin, attachTenant, requireActiveSubscription } = require('../middleware/auth');

router.use(verifyToken, requireAdmin, attachTenant);

router.get('/generate-code', productController.generateCode);
router.get('/', productController.getProducts);
router.get('/:id', productController.getProductById);
router.post('/', requireActiveSubscription, productController.createProduct);
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);

module.exports = router;
