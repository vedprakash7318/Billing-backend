const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

router.post('/super-admin/login', authController.superAdminLogin);
router.post('/login', authController.superAdminLogin);
router.post('/admin/login', authController.clientAdminLogin);
router.get('/me', verifyToken, authController.getMe);
router.get('/profile', verifyToken, authController.getProfile);
router.put('/profile', verifyToken, authController.updateProfile);

module.exports = router;
