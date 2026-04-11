import Store from "../models/store.model.js";
import Product from "../models/product.model.js";
import { sendSuccess } from "../helpers/successResponse.js";

export const allStoresForAdmin = async (req, res, next) => {
  try {
    const [stores, myStore] = await Promise.all([
      Store.find().populate("owner", "name email role"),
      Store.findOne({ owner: req.user._id }).select("_id"),
    ]);

    return sendSuccess(res, 200, "Lojas listadas com sucesso", {
      stores,
      myStoreId: myStore?._id ?? null,
    });
  } catch (error) {
    return next(error);
  }
};

export const createProductForStoreByAdmin = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const { name, description, price, imageUrl, category, highlighted, stock } = req.body;

    const store = await Store.findById(storeId);

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

    return sendSuccess(res, 201, "Produto criado com sucesso", productWithStore);
  } catch (error) {
    return next(error);
  }
};

export const deleteStoreByAdmin = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const store = await Store.findById(storeId);

    if (!store) {
      const error = new Error("Loja não encontrada");
      error.statusCode = 404;
      throw error;
    }

    const hasProduct = await Product.exists({ store: storeId });

    if (hasProduct) {
      const error = new Error("Não é possível deletar uma loja que possui produtos");
      error.statusCode = 400;
      throw error;
    }

    await Store.findByIdAndUpdate(store._id, { status: "deleted" });

    return sendSuccess(res, 200, "Loja deletada com sucesso");
  } catch (error) {
    return next(error);
  }
};

export const updateProductByAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);

    if (!product) {
      const error = new Error("Produto não encontrado");
      error.statusCode = 404;
      throw error;
    }

    Object.assign(product, req.body);
    await product.save();

    const updatedProduct = await Product.findById(product._id).populate("store", "name slug owner status");

    return sendSuccess(res, 200, "Produto atualizado com sucesso", updatedProduct);
  } catch (error) {
    return next(error);
  }
};

export const deleteProductByAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);

    if (!product) {
      const error = new Error("Produto não encontrado");
      error.statusCode = 404;
      throw error;
    }

    await Product.findByIdAndUpdate(id, { status: "deleted" });

    return sendSuccess(res, 200, "Produto removido com sucesso");
  } catch (error) {
    return next(error);
  }
};

export const updateStoreStatusByAdmin = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const { status } = req.body;

    const store = await Store.findById(storeId);

    if (!store) {
      const error = new Error("Loja não encontrada");
      error.statusCode = 404;
      throw error;
    }

    store.status = status;
    await store.save();

    return sendSuccess(res, 200, "Status da loja atualizado com sucesso", store);
  } catch (error) {
    return next(error);
  }
};
