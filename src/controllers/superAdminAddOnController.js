const AddOnPack = require('../models/AddOnPack');
const cache = require('../utils/cache');

// GET All AddOn Packs
exports.getAddOnPacks = async (req, res) => {
  try {
    const packs = await AddOnPack.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
    return res.json({
      success: true,
      data: packs.map((p) => ({ ...p, id: p._id })),
    });
  } catch (error) {
    console.error('getAddOnPacks error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error fetching add-on packs' });
  }
};

// CREATE AddOn Pack
exports.createAddOnPack = async (req, res) => {
  try {
    const { title, type, credits, price, description = '', isPopular = false, isActive = true, sortOrder = 0 } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Pack title is required' });
    }
    if (!['SMS', 'WHATSAPP'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type must be either SMS or WHATSAPP' });
    }
    if (!credits || Number(credits) <= 0) {
      return res.status(400).json({ success: false, error: 'Valid credits count is required (min 1)' });
    }
    if (price === undefined || Number(price) < 0) {
      return res.status(400).json({ success: false, error: 'Valid price is required (min 0)' });
    }

    const pack = await AddOnPack.create({
      title: title.trim(),
      type,
      credits: Number(credits),
      price: Number(price),
      description: description.trim(),
      isPopular: Boolean(isPopular),
      isActive: Boolean(isActive),
      sortOrder: Number(sortOrder) || 0,
    });

    await cache.flush();

    return res.status(201).json({
      success: true,
      message: 'Add-on pack created successfully',
      data: { ...pack.toObject(), id: pack._id },
    });
  } catch (error) {
    console.error('createAddOnPack error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error creating add-on pack' });
  }
};

// UPDATE AddOn Pack
exports.updateAddOnPack = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, type, credits, price, description, isPopular, isActive, sortOrder } = req.body;

    const pack = await AddOnPack.findById(id);
    if (!pack) {
      return res.status(404).json({ success: false, error: 'Add-on pack not found' });
    }

    if (title !== undefined) pack.title = title.trim();
    if (type !== undefined && ['SMS', 'WHATSAPP'].includes(type)) pack.type = type;
    if (credits !== undefined) pack.credits = Math.max(1, Number(credits) || 1);
    if (price !== undefined) pack.price = Math.max(0, Number(price) || 0);
    if (description !== undefined) pack.description = description.trim();
    if (isPopular !== undefined) pack.isPopular = Boolean(isPopular);
    if (isActive !== undefined) pack.isActive = Boolean(isActive);
    if (sortOrder !== undefined) pack.sortOrder = Number(sortOrder) || 0;

    await pack.save();
    await cache.flush();

    return res.json({
      success: true,
      message: 'Add-on pack updated successfully',
      data: { ...pack.toObject(), id: pack._id },
    });
  } catch (error) {
    console.error('updateAddOnPack error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error updating add-on pack' });
  }
};

// DELETE AddOn Pack
exports.deleteAddOnPack = async (req, res) => {
  try {
    const { id } = req.params;
    const pack = await AddOnPack.findByIdAndDelete(id);
    if (!pack) {
      return res.status(404).json({ success: false, error: 'Add-on pack not found' });
    }
    await cache.flush();
    return res.json({
      success: true,
      message: 'Add-on pack deleted successfully',
    });
  } catch (error) {
    console.error('deleteAddOnPack error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Error deleting add-on pack' });
  }
};
