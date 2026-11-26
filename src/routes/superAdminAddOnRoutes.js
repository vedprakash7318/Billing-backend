const express = require('express');
const router = express.Router();
const addOnController = require('../controllers/superAdminAddOnController');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');

router.use(verifyToken, requireSuperAdmin);

router.get('/', addOnController.getAddOnPacks);
router.post('/', addOnController.createAddOnPack);
router.put('/:id', addOnController.updateAddOnPack);
router.delete('/:id', addOnController.deleteAddOnPack);

module.exports = router;
