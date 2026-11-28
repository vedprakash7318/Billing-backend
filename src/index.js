const dns = require('dns');
// Set robust public DNS resolvers (Google & Cloudflare) to prevent Windows / ISP querySrv ECONNREFUSED errors
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);
} catch (e) {
  console.warn('DNS server override warning:', e.message);
}

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/authRoutes');
const planRoutes = require('./routes/planRoutes');
const tenantRoutes = require('./routes/tenantRoutes');
const statsRoutes = require('./routes/statsRoutes');
const adminCategoryRoutes = require('./routes/adminCategoryRoutes');
const adminProductRoutes = require('./routes/adminProductRoutes');
const adminStatsRoutes = require('./routes/adminStatsRoutes');
const adminBillSettingRoutes = require('./routes/adminBillSettingRoutes');
const adminInvoiceRoutes = require('./routes/adminInvoiceRoutes');
const adminEmployeeRoutes = require('./routes/adminEmployeeRoutes');
const adminSubscriptionRoutes = require('./routes/adminSubscriptionRoutes');
const adminPaymentModeRoutes = require('./routes/adminPaymentModeRoutes');
const superAdminSettingsRoutes = require('./routes/superAdminSettingsRoutes');
const superAdminAddOnRoutes = require('./routes/superAdminAddOnRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const invoiceController = require('./controllers/invoiceController');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/billing_saas_db';

// Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/super-admin/plans', planRoutes);
app.use('/api/super-admin/tenants', tenantRoutes);
app.use('/api/super-admin/stats', statsRoutes);
app.use('/api/admin/categories', adminCategoryRoutes);
app.use('/api/admin/products', adminProductRoutes);
app.use('/api/admin/stats', adminStatsRoutes);
app.use('/api/admin/bill-settings', adminBillSettingRoutes);
app.use('/api/admin/invoices', adminInvoiceRoutes);
app.use('/api/admin/employees', adminEmployeeRoutes);
app.use('/api/admin/subscription', adminSubscriptionRoutes);
app.use('/api/admin/payment-modes', adminPaymentModeRoutes);
app.use('/api/super-admin/settings', superAdminSettingsRoutes);
app.use('/api/super-admin/addons', superAdminAddOnRoutes);
app.use('/api/webhooks', webhookRoutes);

// Public Digital Receipt Route (for SMS / WhatsApp link)
app.get('/api/public/receipt/:id', invoiceController.getPublicReceipt);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Billing SaaS Backend (Node+Express+Mongo)' });
});

// Connect to MongoDB with retry & resilient DNS
async function startServer() {
  const maxRetries = 5;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Connecting to MongoDB (attempt ${attempt}/${maxRetries})...`);
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
      });
      console.log('✓ Connected to MongoDB Atlas successfully');
      app.listen(PORT, () => {
        console.log(`✓ Billing SaaS Express Server listening on http://localhost:${PORT}`);
      });
      return;
    } catch (err) {
      console.error(`MongoDB Connection Error (attempt ${attempt}):`, err.message || err);
      if (attempt === maxRetries) {
        console.error('CRITICAL: Unable to connect to MongoDB Atlas after multiple retries.');
        process.exit(1);
      }
      // Re-apply Google & Cloudflare DNS before retrying
      try {
        dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
      } catch {}
      console.log('Retrying connection in 3 seconds...');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

startServer();
