const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const cache = require('../utils/cache');

function escapeRegex(text) {
  if (!text) return '';
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// Generate unique product code like PRD-829103
function generateAutoCode() {
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  const timePart = Date.now().toString().slice(-4);
  return `PRD-${timePart}${randomPart}`;
}

// Endpoint to generate a fresh unique code
exports.generateCode = async (req, res) => {
  try {
    let code = generateAutoCode();
    let attempts = 0;
    while (attempts < 5) {
      const exists = await Product.findOne({ tenant: req.tenant._id, uniqueCode: code });
      if (!exists) break;
      code = generateAutoCode();
      attempts++;
    }
    return res.json({ success: true, code });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// GET products with pagination, search, category filter
exports.getProducts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const search = req.query.search ? req.query.search.trim() : '';
    const categoryId = req.query.categoryId;
    const status = req.query.status;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

    const filter = { tenant: req.tenant._id };

    if (search) {
      const safeSearch = escapeRegex(search);
      filter.$or = [
        { title: { $regex: safeSearch, $options: 'i' } },
        { uniqueCode: { $regex: safeSearch, $options: 'i' } },
        { description: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    if (categoryId === 'UNCATEGORIZED' || categoryId === 'NONE') {
      filter.$or = [{ category: null }, { category: { $exists: false } }];
    } else if (categoryId && categoryId !== 'ALL' && mongoose.Types.ObjectId.isValid(categoryId)) {
      filter.category = categoryId;
    }

    if (status === 'active') {
      filter.isActive = true;
    } else if (status === 'inactive') {
      filter.isActive = false;
    }

    const skip = (page - 1) * limit;

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .populate('category', 'name slug')
        .lean(),
    ]);

    const formatted = products.map((p) => ({
      ...p,
      id: p._id,
      categoryName: p.category?.name || 'Uncategorized',
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return res.json({
      success: true,
      data: formatted,
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
    console.error('getProducts error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error fetching products' });
  }
};

// GET single product
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, tenant: req.tenant._id })
      .populate('category', 'name slug')
      .lean();

    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    return res.json({
      success: true,
      data: { ...product, id: product._id, categoryName: product.category?.name },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// CREATE product
exports.createProduct = async (req, res) => {
  try {
    const {
      title,
      description = '',
      price,
      mrp,
      categoryId,
      image = '',
      uniqueCode,
      isActive = true,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Product title is required' });
    }
    if (price === undefined || price === '' || isNaN(Number(price)) || Number(price) < 0) {
      return res.status(400).json({ success: false, error: 'Valid price (positive number) is required' });
    }

    const numPrice = Number(price);
    const numMrp = mrp !== undefined && mrp !== '' && !isNaN(Number(mrp)) ? Number(mrp) : numPrice;

    if (numMrp > 0 && numPrice > numMrp) {
      return res.status(400).json({
        success: false,
        error: `Selling price (₹${numPrice}) cannot be greater than MRP (₹${numMrp})`,
      });
    }

    // Category is optional
    let assignedCategoryId = null;
    if (categoryId && typeof categoryId === 'string' && categoryId.trim() && mongoose.Types.ObjectId.isValid(categoryId.trim())) {
      const category = await Category.findOne({ _id: categoryId.trim(), tenant: req.tenant._id });
      if (!category) {
        return res.status(404).json({ success: false, error: 'Selected category does not exist' });
      }
      assignedCategoryId = category._id;
    }

    // Auto or custom uniqueCode
    let finalCode = uniqueCode ? uniqueCode.trim().toUpperCase() : generateAutoCode();
    let codeConflict = await Product.findOne({ tenant: req.tenant._id, uniqueCode: finalCode });
    if (codeConflict) {
      if (uniqueCode) {
        return res.status(409).json({ success: false, error: `Product code "${finalCode}" already exists. Please use a different code or leave blank to auto-generate.` });
      }
      finalCode = `${finalCode}-${Math.floor(100 + Math.random() * 900)}`;
    }

    let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    if (!slug) slug = 'prod-' + Date.now();

    const product = await Product.create({
      title: title.trim(),
      slug,
      uniqueCode: finalCode,
      description: description ? description.trim() : '',
      price: numPrice,
      mrp: numMrp,
      category: assignedCategoryId,
      image: image ? image.trim() : '',
      tenant: req.tenant._id,
      isActive: Boolean(isActive),
    });

    const populated = await Product.findById(product._id).populate('category', 'name slug').lean();

    // Invalidate caches
    await cache.del(`stats_${req.tenant._id}`);
    await cache.del(`cats_${req.tenant._id}`);

    return res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: { ...populated, id: populated._id, categoryName: populated.category?.name },
    });
  } catch (error) {
    console.error('createProduct error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// UPDATE product
exports.updateProduct = async (req, res) => {
  try {
    const { title, description, price, mrp, categoryId, image, uniqueCode, isActive } = req.body;

    const product = await Product.findOne({ _id: req.params.id, tenant: req.tenant._id });
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    if (title && title.trim()) {
      product.title = title.trim();
      product.slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    }

    if (price !== undefined && price !== '') {
      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice < 0) {
        return res.status(400).json({ success: false, error: 'Price must be a valid positive number' });
      }
      product.price = numPrice;
    }

    if (mrp !== undefined && mrp !== '') {
      const numMrp = Number(mrp);
      if (!isNaN(numMrp) && numMrp >= 0) {
        product.mrp = numMrp;
      }
    }

    if (product.mrp > 0 && product.price > product.mrp) {
      return res.status(400).json({
        success: false,
        error: `Selling price (₹${product.price}) cannot be greater than MRP (₹${product.mrp})`,
      });
    }

    if (categoryId !== undefined) {
      if (!categoryId || categoryId === 'null' || categoryId === '' || categoryId === 'NONE') {
        product.category = null;
      } else if (mongoose.Types.ObjectId.isValid(categoryId)) {
        const cat = await Category.findOne({ _id: categoryId, tenant: req.tenant._id });
        if (!cat) {
          return res.status(404).json({ success: false, error: 'Category not found' });
        }
        product.category = cat._id;
      }
    }

    if (uniqueCode && uniqueCode.trim()) {
      const codeUpper = uniqueCode.trim().toUpperCase();
      const existing = await Product.findOne({
        _id: { $ne: product._id },
        tenant: req.tenant._id,
        uniqueCode: codeUpper,
      });
      if (existing) {
        return res.status(409).json({ success: false, error: `Product code "${codeUpper}" already taken` });
      }
      product.uniqueCode = codeUpper;
    }

    if (description !== undefined) product.description = description.trim();
    if (image !== undefined) product.image = image.trim();
    if (isActive !== undefined) product.isActive = Boolean(isActive);

    await product.save();

    const populated = await Product.findById(product._id).populate('category', 'name slug').lean();

    // Invalidate caches
    await cache.del(`stats_${req.tenant._id}`);
    await cache.del(`cats_${req.tenant._id}`);

    return res.json({
      success: true,
      message: 'Product updated successfully',
      data: { ...populated, id: populated._id, categoryName: populated.category?.name },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// DELETE product
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, tenant: req.tenant._id });
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    await Product.deleteOne({ _id: product._id });

    // Invalidate caches
    await cache.del(`stats_${req.tenant._id}`);
    await cache.del(`cats_${req.tenant._id}`);

    return res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
