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
    const { page = 1, limit = 20 } = req.validatedQuery ?? {};
    const safePage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
    const safeLimit = Number.isFinite(Number(limit)) ? Math.min(100, Math.max(1, Number(limit))) : 20;
    const skip = (safePage - 1) * safeLimit;

    const [stores, total, myStore] = await Promise.all([
      Store.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .populate("owner", "name email role"),
      Store.countDocuments({}),
      Store.findOne({ owner: req.user._id }).select("_id"),
    ]);

    return sendSuccess(res, 200, "Lojas listadas com sucesso", {
      stores,
      myStoreId: myStore?._id ?? null,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
    });
};

export const createProductForStoreByAdmin = async (req, res, next) => {
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
};

export const deleteStoreByAdmin = async (req, res, next) => {
    const { storeId } = req.params;
    await findExistingStoreOrThrow(storeId);
    await ensureStoreHasNoActiveProducts(storeId);
    await softDeleteStore(storeId);

    return sendSuccess(res, 200, "Loja deletada com sucesso");
};

export const updateProductByAdmin = async (req, res, next) => {
    const { id } = req.params;
    const product = await findActiveProductOrThrow(id);
    const updatedProduct = await updateProductAndPopulate(product, req.body);

    return sendSuccess(res, 200, "Produto atualizado com sucesso", updatedProduct);
};

export const deleteProductByAdmin = async (req, res, next) => {
    const { id } = req.params;
    await findActiveProductOrThrow(id);
    await softDeleteProduct(id);

    return sendSuccess(res, 200, "Produto removido com sucesso");
};

export const updateStoreStatusByAdmin = async (req, res, next) => {
    const { storeId } = req.params;
    const { status } = req.body;

    const store = await findExistingStoreOrThrow(storeId);

    store.status = status;
    await store.save();

    return sendSuccess(res, 200, "Status da loja atualizado com sucesso", store);
};
