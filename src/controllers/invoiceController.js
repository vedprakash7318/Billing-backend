const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const BillSetting = require('../models/BillSetting');
const Product = require('../models/Product');

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
      billSnapshot: billSetting,
    });

    const receiptUrl = `${clientOrigin.replace(/\/$/, '')}/receipt/${invoice._id}`;
    const storeName = billSetting.businessName || tenant.businessName || 'Store';
    const messageText = `Thank you for shopping at ${storeName}! Your Bill #${invoice.invoiceNumber} for Rs.${invoice.grandTotal.toFixed(2)} (${paymentMode}) is ready. View receipt: ${receiptUrl}`;

    let whatsappUrl = null;
    if (deliveryMethod === 'SMS') {
      // Log SMS API dispatch (ready for Twilio / Fast2SMS / MSG91 integration)
      console.log(`[SMS DISPATCH] To: ${invoice.customerPhone} | Message: ${messageText}`);
    } else if (deliveryMethod === 'WHATSAPP') {
      const cleanPhone = invoice.customerPhone.replace(/[^0-9]/g, '');
      const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      whatsappUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(messageText)}`;
      console.log(`[WHATSAPP DISPATCH] To: ${phoneWithCountry} | Link: ${receiptUrl}`);
    }

    return res.status(201).json({
      success: true,
      message:
        deliveryMethod === 'PRINT'
          ? 'Bill created and ready to print'
          : `Bill saved and ${deliveryMethod} receipt sent to ${invoice.customerPhone}`,
      data: {
        ...invoice.toObject(),
        id: invoice._id,
        receiptUrl,
        whatsappUrl,
        messageText,
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
