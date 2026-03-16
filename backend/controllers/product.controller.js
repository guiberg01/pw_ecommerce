import Product from "../models/product.model.js";
import Store from "../models/store.model.js";

const canManageProduct = (product, user) => {
  if (user.role === "admin") return true;

  return product.store?.owner?.toString() === user._id.toString();
};

export const allProducts = async (req, res, next) => {
  try {
    const products = await Product.find().populate("store", "name slug owner status");
    return res.status(200).json(products);
  } catch (error) {
    return next(error);
  }
};

export const createProductForMyStore = async (req, res, next) => {
  try {
    const { name, description, price, imageUrl, category, highlighted, stock, storeId } = req.body;

    let store = null;

    if (req.user.role === "admin" && storeId) {
      store = await Store.findById(storeId);
    } else {
      if (storeId && req.user.role !== "admin") {
        const error = new Error("Seller só pode criar produto na própria loja");
        error.statusCode = 403;
        throw error;
      }

      store = await Store.findOne({ owner: req.user._id });
    }

    if (!store) {
      const error = new Error("Loja não encontrada");
      error.statusCode = 404;
      throw error;
    }

    const product = new Product({
      name,
      description,
      price,
      imageUrl,
      category,
      highlighted,
      stock,
      store: store._id,
    });
    await product.save();

    const productWithStore = await Product.findById(product._id).populate("store", "name slug owner status");

    return res.status(201).json(productWithStore);
  } catch (error) {
    return next(error);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id).populate("store", "owner");

    if (!product) {
      const error = new Error("Produto não encontrado");
      error.statusCode = 404;
      throw error;
    }

    if (!canManageProduct(product, req.user)) {
      const error = new Error("Acesso proibido - Permissão insuficiente");
      error.statusCode = 403;
      throw error;
    }

    Object.assign(product, req.body);
    await product.save();

    const updatedProduct = await Product.findById(product._id).populate("store", "name slug owner status");

    return res.status(200).json(updatedProduct);
  } catch (error) {
    return next(error);
  }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id).populate("store", "owner");

    if (!product) {
      const error = new Error("Produto não encontrado");
      error.statusCode = 404;
      throw error;
    }

    if (!canManageProduct(product, req.user)) {
      const error = new Error("Acesso proibido - Permissão insuficiente");
      error.statusCode = 403;
      throw error;
    }

    await product.deleteOne();

    return res.status(200).json({ message: "Produto removido com sucesso" });
  } catch (error) {
    return next(error);
  }
};
