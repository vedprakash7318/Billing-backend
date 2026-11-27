const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const BillSetting = require('../models/BillSetting');
const Product = require('../models/Product');
const Tenant = require('../models/Tenant');
const GlobalSetting = require('../models/GlobalSetting');
const MessageLog = require('../models/MessageLog');
const cache = require('../utils/cache');
const { deductMessageQuota } = require('../utils/quotaHelper');

function escapeRegex(text) {
  if (!text) return '';
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

function generateInvoiceNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `INV-${dateStr}-${randomPart}`;
}

// CREATE / GENERATE NEW BILL
exports.createInvoice = async (req, res) => {
  try {
    const tenant = req.tenant;
    const {
      customerName = 'Walk-in Customer',
      customerPhone = '',
      items,
      discount = 0,
      tax = 0,
      paymentMode = 'CASH',
      paymentStatus = 'PAID',
      deliveryMethod = 'PRINT',
      clientOrigin = 'http://localhost:3002',
      notes = '',
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one item is required in the bill' });
    }

    if ((deliveryMethod === 'SMS' || deliveryMethod === 'WHATSAPP') && (!customerPhone || customerPhone.trim().length < 8)) {
      return res.status(400).json({
        success: false,
        error: `Customer mobile number is required to send bill via ${deliveryMethod}`,
      });
    }

    // Check Global Service Toggles & Tenant Quota Balances
    const [liveTenant, globalSetting] = await Promise.all([
      Tenant.findById(tenant._id),
      GlobalSetting.findOne().lean(),
    ]);

    if (deliveryMethod === 'SMS') {
      if (globalSetting?.isSmsGloballyEnabled === false) {
        return res.status(400).json({
          success: false,
          error: globalSetting?.smsDisabledNotice || 'SMS service is temporarily paused by Super Admin for maintenance.',
        });
      }
      if ((liveTenant?.smsBalance || 0) <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Your store SMS message balance is 0. Please recharge SMS pack from Subscription & Add-On Packs.',
        });
      }
    } else if (deliveryMethod === 'WHATSAPP') {
      if (globalSetting?.isWhatsAppGloballyEnabled === false) {
        return res.status(400).json({
          success: false,
          error: globalSetting?.whatsAppDisabledNotice || 'WhatsApp service is temporarily paused by Super Admin for maintenance.',
        });
      }
      if ((liveTenant?.whatsAppBalance || 0) <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Your store WhatsApp message balance is 0. Please recharge WhatsApp pack from Subscription & Add-On Packs.',
        });
      }
    }

    // Validate items and calculate subtotal
    let subtotal = 0;
    const formattedItems = [];

    for (const it of items) {
      const price = Number(it.price) || 0;
      const quantity = Math.max(1, Number(it.quantity) || 1);
      const total = price * quantity;
      subtotal += total;

      formattedItems.push({
        product: it.product || it.productId || null,
        title: it.title || 'Item',
        uniqueCode: it.uniqueCode || '',
        price,
        quantity,
        total,
      });
    }

    const discountAmount = Math.max(0, Number(discount) || 0);
    const taxAmount = Math.max(0, Number(tax) || 0);
    const grandTotal = Math.max(0, subtotal - discountAmount + taxAmount);

    // Get current bill header/footer settings snapshot
    let billSetting = await BillSetting.findOne({ tenant: tenant._id }).lean();
    if (!billSetting) {
      billSetting = {
        headerTitle: 'TAX INVOICE',
        businessName: tenant.businessName || '',
        tagline: 'Wholesale & Retail Billing',
        address: [tenant.address, tenant.city, tenant.state].filter(Boolean).join(', ') || '',
        phone: tenant.phone || '',
        gstin: tenant.gstin || '',
        footerMessage: 'Thank You for Shopping With Us! Visit Again 🙏',
        termsAndConditions: 'Goods once sold cannot be returned without bill.',
        showGstin: true,
        showPhone: true,
        showAddress: true,
        showSignatory: true,
        authorizedSignatoryText: 'Authorized Signatory',
      };
    }

    // Ensure unique invoice number
    let invoiceNumber = generateInvoiceNumber();
    let exists = await Invoice.findOne({ tenant: tenant._id, invoiceNumber });
    while (exists) {
      invoiceNumber = generateInvoiceNumber();
      exists = await Invoice.findOne({ tenant: tenant._id, invoiceNumber });
    }

    let billedBy = {
      user: req.user?._id || null,
      name: req.user?.name || (req.user?.role === 'STAFF' ? 'Staff' : 'Admin'),
      role: req.user?.role || 'ADMIN',
      designation: req.user?.designation || (req.user?.role === 'STAFF' ? 'Cashier' : 'Store Admin'),
    };

    if (req.body.billedBy && req.body.billedBy.name) {
      billedBy = {
        user: req.body.billedBy.user || req.user?._id || null,
        name: req.body.billedBy.name.trim(),
        role: req.body.billedBy.role || req.user?.role || 'STAFF',
        designation: req.body.billedBy.designation || 'Cashier',
      };
    }

    const invoice = await Invoice.create({
      invoiceNumber,
      tenant: tenant._id,
      customerName: customerName ? customerName.trim() : 'Walk-in Customer',
      customerPhone: customerPhone ? customerPhone.trim() : '',
      items: formattedItems,
      subtotal,
      discount: discountAmount,
      tax: taxAmount,
      grandTotal,
      paymentMode,
      paymentStatus,
      deliveryMethod,
      deliveryStatus: deliveryMethod === 'PRINT' ? 'PRINTED' : 'SENT',
      notes: notes ? notes.trim() : '',
      billedBy,
      billSnapshot: billSetting,
    });

    // Invalidate dashboard stats cache
    await cache.del(`stats_${tenant._id}`);

    const receiptUrl = `${clientOrigin.replace(/\/$/, '')}/receipt/${invoice._id}`;
    const storeName = billSetting.businessName || tenant.businessName || 'Store';
    const messageText = `Thank you for shopping at ${storeName}! Your Bill #${invoice.invoiceNumber} for Rs.${invoice.grandTotal.toFixed(2)} (${paymentMode}) is ready. View receipt: ${receiptUrl}`;

    let whatsappUrl = null;
    let quotaDeducted = false;

    if (deliveryMethod === 'SMS') {
      try {
        console.log(`[SMS DISPATCH] To: ${invoice.customerPhone} | Message: ${messageText}`);
        // Deduct 1 SMS credit with priority (Plan Quota first, then Booster)
        const deductResult = await deductMessageQuota(tenant._id, 'SMS');
        await MessageLog.create({
          tenant: tenant._id,
          invoice: invoice._id,
          type: 'SMS',
          recipient: invoice.customerPhone,
          message: messageText,
          status: 'DELIVERED',
          costDeducted: 1,
        });
        quotaDeducted = true;
      } catch (smsErr) {
        console.error('SMS dispatch error:', smsErr);
        await MessageLog.create({
          tenant: tenant._id,
          invoice: invoice._id,
          type: 'SMS',
          recipient: invoice.customerPhone,
          message: messageText,
          status: 'FAILED',
          failureReason: smsErr.message,
          costDeducted: 0,
        });
      }
    } else if (deliveryMethod === 'WHATSAPP') {
      try {
        const cleanPhone = invoice.customerPhone.replace(/[^0-9]/g, '');
        const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
        whatsappUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(messageText)}`;
        console.log(`[WHATSAPP DISPATCH] To: ${phoneWithCountry} | Link: ${receiptUrl}`);

        // Deduct 1 WhatsApp credit with priority (Plan Quota first, then Booster)
        const deductResult = await deductMessageQuota(tenant._id, 'WHATSAPP');
        await MessageLog.create({
          tenant: tenant._id,
          invoice: invoice._id,
          type: 'WHATSAPP',
          recipient: phoneWithCountry,
          message: messageText,
          status: 'DELIVERED',
          costDeducted: 1,
        });
        quotaDeducted = true;
      } catch (waErr) {
        console.error('WhatsApp dispatch error:', waErr);
        await MessageLog.create({
          tenant: tenant._id,
          invoice: invoice._id,
          type: 'WHATSAPP',
          recipient: invoice.customerPhone,
          message: messageText,
          status: 'FAILED',
          failureReason: waErr.message,
          costDeducted: 0,
        });
      }
    }

    // Invalidate tenant cache if quota was consumed
    if (quotaDeducted) {
      await cache.del(`sub_overview_${tenant._id}`);
      await cache.del(`stats_${tenant._id}`);
    }

    return res.status(201).json({
      success: true,
      message:
        deliveryMethod === 'PRINT'
          ? 'Bill created and ready to print'
          : `Bill saved and ${deliveryMethod} receipt prepared for ${invoice.customerPhone}`,
      data: {
        ...invoice.toObject(),
        id: invoice._id,
        receiptUrl,
        whatsappUrl,
        messageText,
        quotaDeducted,
      },
    });
  } catch (error) {
    console.error('createInvoice error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error generating bill' });
  }
};

// GET Invoices List
exports.getInvoices = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const search = req.query.search ? req.query.search.trim() : '';
    const paymentMode = req.query.paymentMode;

    const filter = { tenant: req.tenant._id };

    if (search) {
      const safeSearch = escapeRegex(search);
      filter.$or = [
        { invoiceNumber: { $regex: safeSearch, $options: 'i' } },
        { customerName: { $regex: safeSearch, $options: 'i' } },
        { customerPhone: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    if (paymentMode && paymentMode !== 'ALL') {
      filter.paymentMode = paymentMode;
    }

    const skip = (page - 1) * limit;

    const [total, invoices] = await Promise.all([
      Invoice.countDocuments(filter),
      Invoice.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.json({
      success: true,
      data: invoices.map((inv) => ({ ...inv, id: inv._id })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// GET Single Invoice by ID
exports.getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, tenant: req.tenant._id }).lean();
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Bill/Invoice not found' });
    }
    return res.json({ success: true, data: { ...invoice, id: invoice._id } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};


// PUBLIC: Get Digital Receipt by Invoice ID (for SMS / WhatsApp link)
exports.getPublicReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, error: 'Invalid receipt link' });
    }

    const invoice = await Invoice.findById(id).lean();
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Receipt not found' });
    }

    return res.json({ success: true, data: { ...invoice, id: invoice._id } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// POST Send / Re-send Receipt via SMS or WhatsApp for an existing invoice
exports.sendInvoiceReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const { method = 'WHATSAPP', phone, clientOrigin = 'http://localhost:3002' } = req.body;

    const [invoice, tenant, globalSetting] = await Promise.all([
      Invoice.findOne({ _id: id, tenant: req.tenant._id }),
      Tenant.findById(req.tenant._id),
      GlobalSetting.findOne().lean(),
    ]);

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    const targetPhone = phone || invoice.customerPhone;
    if (!targetPhone || targetPhone.trim().length < 8) {
      return res.status(400).json({ success: false, error: 'Valid customer phone number is required' });
    }

    const receiptUrl = `${clientOrigin.replace(/\/$/, '')}/receipt/${invoice._id}`;
    const storeName = req.tenant.businessName || 'Store';
    const messageText = `Thank you for shopping at ${storeName}! Your Bill #${invoice.invoiceNumber} for Rs.${invoice.grandTotal.toFixed(2)} is ready. View receipt: ${receiptUrl}`;

    if (method === 'SMS') {
      if (globalSetting?.isSmsGloballyEnabled === false) {
        return res.status(400).json({
          success: false,
          error: globalSetting?.smsDisabledNotice || 'SMS service is temporarily paused by Super Admin for maintenance.',
        });
      }
      if ((tenant?.smsBalance || 0) <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Store SMS balance is 0. Please recharge SMS pack from Subscription & Add-Ons.',
        });
      }

      console.log(`[SMS SEND] To: ${targetPhone} | Message: ${messageText}`);
      const deductResult = await deductMessageQuota(tenant._id, 'SMS');
      await MessageLog.create({
        tenant: tenant._id,
        invoice: invoice._id,
        type: 'SMS',
        recipient: targetPhone,
        message: messageText,
        status: 'DELIVERED',
        costDeducted: 1,
      });

      return res.json({
        success: true,
        message: `SMS sent successfully to ${targetPhone} (deducted from ${deductResult.deductedFrom})`,
        newBalance: deductResult.newTotal,
        deductedFrom: deductResult.deductedFrom,
      });
    } else {
      if (globalSetting?.isWhatsAppGloballyEnabled === false) {
        return res.status(400).json({
          success: false,
          error: globalSetting?.whatsAppDisabledNotice || 'WhatsApp messaging is temporarily paused by Super Admin for maintenance.',
        });
      }
      if ((tenant?.whatsAppBalance || 0) <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Store WhatsApp balance is 0. Please recharge WhatsApp pack from Subscription & Add-Ons.',
        });
      }

      const cleanPhone = targetPhone.replace(/[^0-9]/g, '');
      const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const whatsappUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(messageText)}`;

      const deductResult = await deductMessageQuota(tenant._id, 'WHATSAPP');
      await MessageLog.create({
        tenant: tenant._id,
        invoice: invoice._id,
        type: 'WHATSAPP',
        recipient: phoneWithCountry,
        message: messageText,
        status: 'DELIVERED',
        costDeducted: 1,
      });

      return res.json({
        success: true,
        message: `WhatsApp receipt ready for ${phoneWithCountry} (deducted from ${deductResult.deductedFrom})`,
        whatsappUrl,
        newBalance: deductResult.newTotal,
        deductedFrom: deductResult.deductedFrom,
      });
    }
  } catch (error) {
    console.error('sendInvoiceReceipt error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to send receipt' });
  }
};

