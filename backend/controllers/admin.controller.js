import { sendSuccess } from "../helpers/successResponse.js";
import {
  createProductForStore,
  ensureStoreHasNoActiveProducts,
  findActiveProductOrThrow,
  findExistingStoreOrThrow,
  softDeleteProduct,
  softDeleteStore,
  updateProductAndPopulate,
} from "../services/catalog.service.js";
import Store from "../models/store.model.js";

export const allStoresForAdmin = async (req, res, next) => {
  try {
    const [stores, myStore] = await Promise.all([
      Store.find({ status: { $ne: "deleted" } }).populate("owner", "name email role"),
      Store.findOne({ owner: req.user._id, status: { $ne: "deleted" } }).select("_id"),
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
    const { name, description, category, highlighted, maxPerPerson, mainVariant, variants } = req.body;

    await findExistingStoreOrThrow(storeId);

    const productWithStore = await createProductForStore(storeId, {
      name,
      description,
      category,
      highlighted,
      maxPerPerson,
      mainVariant,
      variants,
    });

    return sendSuccess(res, 201, "Produto criado com sucesso", productWithStore);
  } catch (error) {
    return next(error);
  }
};

export const deleteStoreByAdmin = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    await findExistingStoreOrThrow(storeId);
    await ensureStoreHasNoActiveProducts(storeId);
    await softDeleteStore(storeId);

    return sendSuccess(res, 200, "Loja deletada com sucesso");
  } catch (error) {
    return next(error);
  }
};

export const updateProductByAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await findActiveProductOrThrow(id);
    const updatedProduct = await updateProductAndPopulate(product, req.body);

    return sendSuccess(res, 200, "Produto atualizado com sucesso", updatedProduct);
  } catch (error) {
    return next(error);
  }
};

export const deleteProductByAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    await findActiveProductOrThrow(id);
    await softDeleteProduct(id);

    return sendSuccess(res, 200, "Produto removido com sucesso");
  } catch (error) {
    return next(error);
  }
};

export const updateStoreStatusByAdmin = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const { status } = req.body;

    const store = await findExistingStoreOrThrow(storeId);

    store.status = status;
    await store.save();

    return sendSuccess(res, 200, "Status da loja atualizado com sucesso", store);
  } catch (error) {
    return next(error);
  }
};
