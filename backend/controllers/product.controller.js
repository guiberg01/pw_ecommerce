import { sendSuccess } from "../helpers/successResponse.js";
import { createHttpError } from "../helpers/httpError.js";
import {
  createProductForStore,
  getProduct,
  findActiveProductOrThrow,
  findActiveStoreByOwnerOrThrow,
  getVisibleProducts,
  softDeleteProduct,
  updateProductAndPopulate,
} from "../services/catalog.service.js";

const canManageProduct = (product, user) => {
  return product.store?.owner?.toString() === user._id.toString();
};

export const allProducts = async (req, res, next) => {
  try {
    const visibleProducts = await getVisibleProducts();

    return sendSuccess(res, 200, "Produtos listados com sucesso", visibleProducts);
  } catch (error) {
    return next(error);
  }
};

export const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await getProduct(id);

    return sendSuccess(res, 200, "Produto encontrado com sucesso", product);
  } catch (error) {
    return next(error);
  }
};

export const createProductForMyStore = async (req, res, next) => {
  try {
    const { name, description, price, imageUrl, category, highlighted, stock, maxPerPerson } = req.body;

    const store = await findActiveStoreByOwnerOrThrow(req.user._id);
    const productWithStore = await createProductForStore(store._id, {
      name,
      description,
      price,
      imageUrl,
      category,
      highlighted,
      stock,
      maxPerPerson,
    });

    return sendSuccess(res, 201, "Produto criado com sucesso", productWithStore);
  } catch (error) {
    return next(error);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await findActiveProductOrThrow(id, { populateStoreOwner: true });

    if (!canManageProduct(product, req.user)) {
      throw createHttpError("Acesso proibido - Permissão insuficiente", 403, undefined, "PRODUCT_MANAGE_FORBIDDEN");
    }

    const updatedProduct = await updateProductAndPopulate(product, req.body);

    return sendSuccess(res, 200, "Produto atualizado com sucesso", updatedProduct);
  } catch (error) {
    return next(error);
  }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await findActiveProductOrThrow(id, { populateStoreOwner: true });

    if (!canManageProduct(product, req.user)) {
      throw createHttpError("Acesso proibido - Permissão insuficiente", 403, undefined, "PRODUCT_MANAGE_FORBIDDEN");
    }

    await softDeleteProduct(id);

    return sendSuccess(res, 200, "Produto removido com sucesso");
  } catch (error) {
    return next(error);
  }
};
