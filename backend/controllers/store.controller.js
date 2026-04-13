import Store from "../models/store.model.js";
import { slugify } from "../helpers/slug.js";
import { createHttpError } from "../helpers/httpError.js";
import { sendSuccess } from "../helpers/successResponse.js";
import {
  ensureStoreHasNoActiveProducts,
  findActiveStoreByOwnerOrThrow,
  findStoreByIdOrThrow,
  softDeleteStore,
} from "../services/catalog.service.js";

const buildSlugCandidate = (name, suffix = 0) => {
  const base = slugify(name);
  return suffix === 0 ? base : `${base}-${suffix}`;
};

const MAX_SLUG_RETRIES = 5;

const saveStoreWithUniqueSlug = async (store, name) => {
  for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
    store.slug = buildSlugCandidate(name, attempt === 0 ? 0 : attempt);
    try {
      await store.save();
      return true;
    } catch (err) {
      if (err?.name === "MongoServerError" && err?.code === 11000 && err?.keyValue?.slug) {
        continue;
      }
      throw err;
    }
  }

  return false;
};

export const createStore = async (req, res, next) => {
  try {
    const { name, description, logoUrl } = req.body;

    const existingStore = await Store.findOne({ owner: req.user._id, status: { $ne: "deleted" } });
    if (existingStore) {
      throw createHttpError("Este seller já possui uma loja", 409, undefined, "STORE_ALREADY_EXISTS");
    }

    const deletedStore = await Store.findOne({ owner: req.user._id, status: "deleted" }).sort({ updatedAt: -1 });

    if (deletedStore) {
      deletedStore.name = name;
      deletedStore.description = description;
      deletedStore.logoUrl = logoUrl;
      deletedStore.status = "active";

      const slugSaved = await saveStoreWithUniqueSlug(deletedStore, name);

      if (!slugSaved) {
        throw createHttpError(
          "Não foi possível gerar um slug único para a loja",
          409,
          undefined,
          "STORE_SLUG_CONFLICT",
        );
      }

      return sendSuccess(res, 200, "Loja reativada com sucesso", deletedStore);
    }

    let store;

    for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
      const slug = buildSlugCandidate(name, attempt === 0 ? 0 : attempt);
      try {
        store = await Store.create({
          name,
          slug,
          description,
          logoUrl,
          owner: req.user._id,
        });
        break;
      } catch (err) {
        if (err?.name === "MongoServerError" && err?.code === 11000 && err?.keyValue?.slug) {
          continue;
        }

        if (err?.name === "MongoServerError" && err?.code === 11000 && err?.keyValue?.owner) {
          throw createHttpError("Este seller já possui uma loja", 409, undefined, "STORE_ALREADY_EXISTS");
        }

        throw err;
      }
    }

    if (!store) {
      throw createHttpError("Não foi possível gerar um slug único para a loja", 409, undefined, "STORE_SLUG_CONFLICT");
    }

    return sendSuccess(res, 201, "Loja criada com sucesso", store);
  } catch (error) {
    return next(error);
  }
};

export const getMyStore = async (req, res, next) => {
  try {
    const store = await findActiveStoreByOwnerOrThrow(req.user._id);

    return sendSuccess(res, 200, "Loja encontrada com sucesso", store);
  } catch (error) {
    return next(error);
  }
};

export const getStoreById = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const store = await findStoreByIdOrThrow(storeId);

    return sendSuccess(res, 200, "Loja encontrada com sucesso", store);
  } catch (error) {
    return next(error);
  }
};

export const updateMyStore = async (req, res, next) => {
  try {
    const { name, description, logoUrl } = req.body;

    const store = await findActiveStoreByOwnerOrThrow(req.user._id);
    let slugSaved = true;
    let shouldSave = false;

    if (name && name !== store.name) {
      store.name = name;
      slugSaved = await saveStoreWithUniqueSlug(store, name);
    }

    if (!slugSaved) {
      throw createHttpError("Não foi possível gerar um slug único para a loja", 409, undefined, "STORE_SLUG_CONFLICT");
    }

    if (description !== undefined) {
      store.description = description;
      shouldSave = true;
    }

    if (logoUrl !== undefined) {
      store.logoUrl = logoUrl;
      shouldSave = true;
    }

    if (shouldSave) {
      await store.save();
    }

    return sendSuccess(res, 200, "Loja atualizada com sucesso", store);
  } catch (error) {
    return next(error);
  }
};

export const deleteMyStore = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const store = await findStoreByIdOrThrow(storeId);

    if (!store.owner.equals(req.user._id)) {
      throw createHttpError("Apenas o dono da loja pode deletar esta loja", 403, undefined, "STORE_DELETE_FORBIDDEN");
    }

    await ensureStoreHasNoActiveProducts(storeId);
    await softDeleteStore(store._id);

    return sendSuccess(res, 200, "Loja deletada com sucesso");
  } catch (error) {
    return next(error);
  }
};
