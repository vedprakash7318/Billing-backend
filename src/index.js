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
const superAdminSettingsRoutes = require('./routes/superAdminSettingsRoutes');
const superAdminAddOnRoutes = require('./routes/superAdminAddOnRoutes');
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
app.use('/api/super-admin/settings', superAdminSettingsRoutes);
app.use('/api/super-admin/addons', superAdminAddOnRoutes);

// Public Digital Receipt Route (for SMS / WhatsApp link)
app.get('/api/public/receipt/:id', invoiceController.getPublicReceipt);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Billing SaaS Backend (Node+Express+Mongo)' });
});

// Connect to MongoDB and start Express server
mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('✓ Connected to MongoDB:', MONGODB_URI);
    app.listen(PORT, () => {
      console.log(`✓ Billing SaaS Express Server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB Connection Error:', err);
    process.exit(1);
  });
