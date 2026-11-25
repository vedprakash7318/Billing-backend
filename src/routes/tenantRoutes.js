const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');

router.use(verifyToken, requireSuperAdmin);

router.get('/', tenantController.getTenants);
router.get('/:id', tenantController.getTenantById);
router.post('/', tenantController.createTenant);
router.put('/:id', tenantController.updateTenant);
router.delete('/:id', tenantController.deleteTenant);
router.post('/:id/subscription', tenantController.extendSubscription);

module.exports = router;
