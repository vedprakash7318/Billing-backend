const Category = require('../models/Category');
const Product = require('../models/Product');

function escapeRegex(text) {
  if (!text) return '';
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// GET all categories for the tenant
exports.getCategories = async (req, res) => {
  try {
    const tenantId = req.tenant._id;
    const search = req.query.search ? req.query.search.trim() : '';
    const status = req.query.status;

    const filter = { tenant: tenantId };
    if (search) {
      filter.name = { $regex: escapeRegex(search), $options: 'i' };
    }
    if (status === 'active') {
      filter.isActive = true;
    } else if (status === 'inactive') {
      filter.isActive = false;
    }

    const categories = await Category.find(filter).sort({ name: 1 }).lean();

    // Attach product counts to each category
    const categoriesWithCount = await Promise.all(
      categories.map(async (cat) => {
        const productCount = await Product.countDocuments({ tenant: tenantId, category: cat._id });
        return {
          ...cat,
          id: cat._id,
          productCount,
        };
      })
    );

    return res.json({
      success: true,
      data: categoriesWithCount,
      total: categoriesWithCount.length,
    });
  } catch (error) {
    console.error('getCategories error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error fetching categories' });
  }
};

// GET single category
exports.getCategoryById = async (req, res) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, tenant: req.tenant._id }).lean();
    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }
    const productCount = await Product.countDocuments({ tenant: req.tenant._id, category: category._id });
    return res.json({ success: true, data: { ...category, id: category._id, productCount } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// CREATE category
exports.createCategory = async (req, res) => {
  try {
    const { name, description = '', isActive = true } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Category name is required' });
    }

    const cleanName = name.trim();
    const existing = await Category.findOne({ tenant: req.tenant._id, name: { $regex: `^${escapeRegex(cleanName)}$`, $options: 'i' } });
    if (existing) {
      return res.status(409).json({ success: false, error: 'Category with this name already exists' });
    }

    let slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    if (!slug) slug = 'cat-' + Date.now();

    const category = await Category.create({
      name: cleanName,
      slug,
      description: description ? description.trim() : '',
      tenant: req.tenant._id,
      isActive: Boolean(isActive),
    });

    return res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: { ...category.toObject(), id: category._id, productCount: 0 },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// UPDATE category
exports.updateCategory = async (req, res) => {
  try {
    const { name, description, isActive } = req.body;
    const category = await Category.findOne({ _id: req.params.id, tenant: req.tenant._id });
    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    if (name && name.trim()) {
      const cleanName = name.trim();
      const existing = await Category.findOne({
        _id: { $ne: category._id },
        tenant: req.tenant._id,
        name: { $regex: `^${escapeRegex(cleanName)}$`, $options: 'i' },
      });
      if (existing) {
        return res.status(409).json({ success: false, error: 'Another category with this name already exists' });
      }
      category.name = cleanName;
      category.slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    }

    if (description !== undefined) category.description = description.trim();
    if (isActive !== undefined) category.isActive = Boolean(isActive);

    await category.save();

    const productCount = await Product.countDocuments({ tenant: req.tenant._id, category: category._id });

    return res.json({
      success: true,
      message: 'Category updated successfully',
      data: { ...category.toObject(), id: category._id, productCount },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// DELETE category
exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, tenant: req.tenant._id });
    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    const productCount = await Product.countDocuments({ tenant: req.tenant._id, category: category._id });
    if (productCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete category: ${productCount} products are linked to this category. Reassign or delete products first.`,
      });
    }

    await Category.deleteOne({ _id: category._id });

    return res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
