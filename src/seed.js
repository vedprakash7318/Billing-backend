const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const Plan = require('./models/Plan');
const Tenant = require('./models/Tenant');
const Subscription = require('./models/Subscription');
const AuditLog = require('./models/AuditLog');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/billing_saas_db';

async function seed() {
  console.log('--- Cleaning MongoDB & Creating Only Super Admin ---');
  await mongoose.connect(MONGODB_URI);

  // Delete all existing data from all collections
  await Promise.all([
    User.deleteMany({}),
    Plan.deleteMany({}),
    Tenant.deleteMany({}),
    Subscription.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);

  // Create ONLY Super Admin
  const superAdminPassword = await bcrypt.hash('SuperAdmin@123', 10);
  const superAdmin = await User.create({
    name: 'Master Super Admin',
    email: 'admin@saasbilling.com',
    passwordHash: superAdminPassword,
    role: 'SUPER_ADMIN',
    phone: '+91 9876543210',
    status: 'ACTIVE',
  });

  console.log(`✓ All old data deleted.`);
  console.log(`✓ Only Super Admin created: ${superAdmin.email} (Password: SuperAdmin@123)`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
