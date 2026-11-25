const express = require('express');
const router = express.Router();
const clientStatsController = require('../controllers/clientStatsController');
const { verifyToken, requireAdmin, attachTenant } = require('../middleware/auth');

router.use(verifyToken, requireAdmin, attachTenant);

router.get('/', clientStatsController.getClientStats);

module.exports = router;
