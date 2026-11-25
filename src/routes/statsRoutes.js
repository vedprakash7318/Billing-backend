const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { verifyToken, requireSuperAdmin } = require('../middleware/auth');

router.get('/', verifyToken, requireSuperAdmin, statsController.getStats);

module.exports = router;
