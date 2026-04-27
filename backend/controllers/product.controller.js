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
    const { categoryId, page, limit } = req.validatedQuery ?? {};
    const visibleProducts = await getVisibleProducts({ categoryId, page, limit });

    return sendSuccess(res, 200, "Produtos listados com sucesso", visibleProducts);
};

export const getProductById = async (req, res, next) => {
    const { id } = req.params;
    const product = await getProduct(id);

    return sendSuccess(res, 200, "Produto encontrado com sucesso", product);
};

export const createProductForMyStore = async (req, res, next) => {
    const { name, description, category, highlighted, maxPerPerson, mainVariant, variants } = req.body;

    const store = await findActiveStoreByOwnerOrThrow(req.user._id);
    const productWithStore = await createProductForStore(store._id, {
      name,
      description,
      category,
      highlighted,
      maxPerPerson,
      mainVariant,
      variants,
    });

    const productResponse = productWithStore.toObject();

    return sendSuccess(res, 201, "Produto criado com sucesso", {
      ...productResponse,
      mainVariantId: productResponse.mainVariant?._id?.toString?.() ?? null,
    });
};

export const updateProduct = async (req, res, next) => {
    const { id } = req.params;
    const product = await findActiveProductOrThrow(id, { populateStoreOwner: true });

    if (!canManageProduct(product, req.user)) {
      throw createHttpError("Acesso proibido - Permissão insuficiente", 403, undefined, "PRODUCT_MANAGE_FORBIDDEN");
    }

    const updatedProduct = await updateProductAndPopulate(product, req.body);

    return sendSuccess(res, 200, "Produto atualizado com sucesso", updatedProduct);
};

export const deleteProduct = async (req, res, next) => {
    const { id } = req.params;
    const product = await findActiveProductOrThrow(id, { populateStoreOwner: true });

    if (!canManageProduct(product, req.user)) {
      throw createHttpError("Acesso proibido - Permissão insuficiente", 403, undefined, "PRODUCT_MANAGE_FORBIDDEN");
    }

    await softDeleteProduct(id);

    return sendSuccess(res, 200, "Produto removido com sucesso");
};
