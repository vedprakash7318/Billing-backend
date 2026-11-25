require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const Tenant = require('./models/Tenant');
const Plan = require('./models/Plan');
const Subscription = require('./models/Subscription');
const Category = require('./models/Category');
const Product = require('./models/Product');
const BillSetting = require('./models/BillSetting');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vedprakashvp0123_db_user:t45Jcfh773bMWxsX@ved.hxreoxx.mongodb.net/billing?appName=Ved';

async function seed() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to MongoDB Atlas successfully.');

    const defaultPasswordHash = await bcrypt.hash('1234', 10);

    // 1. Super Admin
    console.log('Seeding Super Admin (supper@gmail.com)...');
    let superAdmin = await User.findOne({ email: 'supper@gmail.com' });
    if (superAdmin) {
      superAdmin.passwordHash = defaultPasswordHash;
      superAdmin.role = 'SUPER_ADMIN';
      superAdmin.status = 'ACTIVE';
      await superAdmin.save();
    } else {
      superAdmin = await User.create({
        name: 'Super Administrator',
        email: 'supper@gmail.com',
        passwordHash: defaultPasswordHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      });
    }

    // 2. Plans
    console.log('Seeding Subscription Plans...');
    const plansData = [
      {
        name: 'Free Trial',
        slug: 'free-trial',
        description: '14-Day Full Access Trial for new stores',
        planType: 'FREE_TRIAL',
        durationType: 'CUSTOM_DAYS',
        durationValue: 14,
        price: 0,
        currency: 'INR',
        isActive: true,
        features: ['Up to 500 Invoices', '1 Store Staff', 'Thermal & SMS Invoices', 'Catalog & Inventory'],
        sortOrder: 1,
      },
      {
        name: 'Pro Monthly',
        slug: 'pro-monthly',
        description: 'All-inclusive monthly plan for active retail stores',
        planType: 'PAID',
        durationType: 'MONTHLY',
        durationValue: 1,
        price: 999,
        currency: 'INR',
        isPopular: true,
        isActive: true,
        features: ['Unlimited Invoices', 'Unlimited Staff', 'WhatsApp & SMS Invoices', 'Barcode Scanning', 'Daily Analytics'],
        sortOrder: 2,
      },
      {
        name: 'Annual Business',
        slug: 'annual-business',
        description: 'Best value 1-year plan for growing retail business',
        planType: 'PAID',
        durationType: 'YEARLY',
        durationValue: 1,
        price: 7999,
        currency: 'INR',
        isActive: true,
        features: ['Everything in Pro', 'Priority 24/7 Support', 'Multi-counter Billing', 'Custom Branding & Logo'],
        sortOrder: 3,
      },
    ];

    const savedPlans = [];
    for (const p of plansData) {
      const plan = await Plan.findOneAndUpdate({ slug: p.slug }, p, { upsert: true, new: true });
      savedPlans.push(plan);
    }
    const proMonthlyPlan = savedPlans.find((p) => p.slug === 'pro-monthly') || savedPlans[0];

    // 3. Store Admin (admin@gmail.com)
    console.log('Seeding Store Admin (admin@gmail.com)...');
    let storeAdmin = await User.findOne({ email: 'admin@gmail.com' });
    if (storeAdmin) {
      storeAdmin.passwordHash = defaultPasswordHash;
      storeAdmin.role = 'ADMIN';
      storeAdmin.status = 'ACTIVE';
      await storeAdmin.save();
    } else {
      storeAdmin = await User.create({
        name: 'Store Admin',
        email: 'admin@gmail.com',
        passwordHash: defaultPasswordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
        phone: '9876543210',
      });
    }

    // 4. Tenant / Store (Apex Mart Superstore)
    console.log('Seeding Tenant (Apex Mart Superstore)...');
    let tenant = await Tenant.findOne({ slug: 'apex-mart' });
    if (!tenant) {
      tenant = await Tenant.create({
        businessName: 'Apex Mart Superstore',
        slug: 'apex-mart',
        owner: storeAdmin._id,
        phone: '9876543210',
        email: 'admin@gmail.com',
        address: 'Shop 12, Commercial Market, Sector 18',
        city: 'Noida',
        state: 'Uttar Pradesh',
        pincode: '201301',
        gstin: '09AAACH7409R1ZZ',
        currency: 'INR',
        status: 'ACTIVE',
      });
    } else {
      tenant.owner = storeAdmin._id;
      tenant.status = 'ACTIVE';
      await tenant.save();
    }

    // 5. Subscription for Tenant (Active for 60 days)
    console.log('Seeding Subscription for Tenant...');
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + 60);

    let subscription = await Subscription.findOne({ tenant: tenant._id, status: 'ACTIVE' });
    if (!subscription) {
      subscription = await Subscription.create({
        tenant: tenant._id,
        plan: proMonthlyPlan._id,
        startDate: now,
        endDate: futureDate,
        status: 'ACTIVE',
        paymentStatus: 'PAID',
        amountPaid: 999,
        paymentMethod: 'UPI',
        transactionRef: 'UPI-TXN-SEED99812',
        notes: 'Pre-activated 60-day Pro subscription',
      });
    } else {
      subscription.plan = proMonthlyPlan._id;
      subscription.endDate = futureDate;
      subscription.status = 'ACTIVE';
      await subscription.save();
    }

    tenant.currentSubscription = subscription._id;
    await tenant.save();

    // 6. Employee (emp@gmail.com)
    console.log('Seeding Employee (emp@gmail.com)...');
    let employee = await User.findOne({ email: 'emp@gmail.com' });
    if (employee) {
      employee.passwordHash = defaultPasswordHash;
      employee.role = 'STAFF';
      employee.tenant = tenant._id;
      employee.designation = 'Billing Cashier';
      employee.status = 'ACTIVE';
      await employee.save();
    } else {
      employee = await User.create({
        name: 'Ramesh Sharma (Cashier)',
        email: 'emp@gmail.com',
        passwordHash: defaultPasswordHash,
        role: 'STAFF',
        tenant: tenant._id,
        designation: 'Billing Cashier',
        phone: '9876500001',
        status: 'ACTIVE',
      });
    }

    // 7. Categories
    console.log('Seeding Categories...');
    const categoriesData = [
      { name: 'Snacks & Munchies', slug: 'snacks-munchies', description: 'Chips, biscuits, namkeen and ready-to-eat snacks' },
      { name: 'Beverages & Cold Drinks', slug: 'beverages-cold-drinks', description: 'Cold drinks, juices, energy drinks, tea & coffee' },
      { name: 'Groceries & Staples', slug: 'groceries-staples', description: 'Atta, rice, dal, salt, sugar and cooking oils' },
      { name: 'Personal Care', slug: 'personal-care', description: 'Soaps, shampoos, toothpaste and hygiene products' },
      { name: 'Dairy & Bakery', slug: 'dairy-bakery', description: 'Milk, butter, paneer, bread and bakery items' },
    ];

    const categoryMap = {};
    for (const cat of categoriesData) {
      let existingCat = await Category.findOne({ tenant: tenant._id, name: cat.name });
      if (!existingCat) {
        existingCat = await Category.create({
          tenant: tenant._id,
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          isActive: true,
        });
      }
      categoryMap[cat.name] = existingCat._id;
    }

    // 8. Products (with realistic barcodes/SKU, MRP and Selling Price)
    console.log('Seeding Products...');
    const productsData = [
      {
        title: 'Kurkure Masala Munch 90g',
        slug: 'kurkure-masala-munch-90g',
        uniqueCode: '8901491101837',
        category: categoryMap['Snacks & Munchies'],
        mrp: 20,
        price: 18,
        description: 'Crispy crunchy namkeen snack with authentic spicy Indian masala',
        tenant: tenant._id,
        isActive: true,
      },
      {
        title: 'Maggi 2-Minute Masala Noodles 70g',
        slug: 'maggi-2-minute-masala-noodles-70g',
        uniqueCode: '8901058852232',
        category: categoryMap['Snacks & Munchies'],
        mrp: 14,
        price: 12,
        description: 'Instant noodles with special tastemaker spices',
        tenant: tenant._id,
        isActive: true,
      },
      {
        title: 'Coca-Cola Can 300ml',
        slug: 'coca-cola-can-300ml',
        uniqueCode: '5449000000996',
        category: categoryMap['Beverages & Cold Drinks'],
        mrp: 40,
        price: 35,
        description: 'Chilled refreshing sparkling soft drink',
        tenant: tenant._id,
        isActive: true,
      },
      {
        title: 'Tata Salt Vacuum Evaporated 1kg',
        slug: 'tata-salt-vacuum-evaporated-1kg',
        uniqueCode: '8901058000121',
        category: categoryMap['Groceries & Staples'],
        mrp: 28,
        price: 25,
        description: 'Desh ka namak with guaranteed purity and iodine',
        tenant: tenant._id,
        isActive: true,
      },
      {
        title: 'Dettol Original Bathing Soap 125g',
        slug: 'dettol-original-bathing-soap-125g',
        uniqueCode: '8901396123456',
        category: categoryMap['Personal Care'],
        mrp: 55,
        price: 48,
        description: 'Antiseptic germ protection bar soap for family hygiene',
        tenant: tenant._id,
        isActive: true,
      },
      {
        title: 'Fortune Sunlite Refined Sunflower Oil 1L',
        slug: 'fortune-sunlite-refined-sunflower-oil-1l',
        uniqueCode: '8906007280123',
        category: categoryMap['Groceries & Staples'],
        mrp: 165,
        price: 145,
        description: 'Light and healthy refined sunflower cooking oil with Vitamin A & D',
        tenant: tenant._id,
        isActive: true,
      },
      {
        title: 'Amul Butter 100g',
        slug: 'amul-butter-100g',
        uniqueCode: '8901262010055',
        category: categoryMap['Dairy & Bakery'],
        mrp: 60,
        price: 56,
        description: 'Delicious pasteurized salted butter, taste of India',
        tenant: tenant._id,
        isActive: true,
      },
      {
        title: 'Cadbury Dairy Milk Chocolate 50g',
        slug: 'cadbury-dairy-milk-chocolate-50g',
        uniqueCode: '7622210815123',
        category: categoryMap['Snacks & Munchies'],
        mrp: 45,
        price: 40,
        description: 'Rich, smooth and creamy milk chocolate bar',
        tenant: tenant._id,
        isActive: true,
      },
    ];

    for (const prd of productsData) {
      await Product.findOneAndUpdate(
        { tenant: tenant._id, uniqueCode: prd.uniqueCode },
        prd,
        { upsert: true, new: true }
      );
    }

    // 9. Bill Settings
    console.log('Seeding Bill Settings...');
    await BillSetting.findOneAndUpdate(
      { tenant: tenant._id },
      {
        tenant: tenant._id,
        headerTitle: 'TAX INVOICE',
        businessName: 'Apex Mart Superstore',
        tagline: 'Wholesale & Retail Supermarket',
        address: 'Shop 12, Commercial Market, Sector 18, Noida, UP - 201301',
        phone: '9876543210',
        email: 'admin@gmail.com',
        gstin: '09AAACH7409R1ZZ',
        showGstin: true,
        showPhone: true,
        showAddress: true,
        footerMessage: 'Thank You for Shopping at Apex Mart! Visit Again 🙏',
        termsAndConditions: '1. Goods once sold cannot be returned without original bill.\n2. Warranty as per manufacturer terms.\n3. Subject to local Noida jurisdiction.',
        upiId: 'apexmart@upi',
        authorizedSignatoryText: 'Authorized Cashier / Apex Mart',
        showSignatory: true,
        paperSize: 'THERMAL_80MM',
      },
      { upsert: true, new: true }
    );

    console.log('\n=========================================');
    console.log('DATABASE SEEDING COMPLETED SUCCESSFULLY!');
    console.log('=========================================');
    console.log('1. Super Admin:  supper@gmail.com  / 1234 (Super Admin Portal on port 3000)');
    console.log('2. Store Admin:  admin@gmail.com   / 1234 (Store Admin App on port 3002)');
    console.log('3. Employee:     emp@gmail.com     / 1234 (Store Admin App on port 3002)');
    console.log('4. Store:        Apex Mart Superstore (Active 60 days subscription)');
    console.log(`5. Products:     ${productsData.length} items with both MRP & Selling Price`);
    console.log(`6. Categories:   ${categoriesData.length} categories`);
    console.log('=========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
}

seed();
