import Store from "../models/store.model.js";
import Product from "../models/product.model.js";
import { slugify } from "../helpers/slug.js";
import { sendSuccess } from "../helpers/successResponse.js";

//garantir slug unico no banco
const buildUniqueSlug = async (name) => {
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let suffix = 1;

  while (await Store.findOne({ slug })) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
};

//cria loja
export const createStore = async (req, res, next) => {
  try {
    const { name, description, logoUrl } = req.body;

    const existingStore = await Store.findOne({ owner: req.user._id });
    if (existingStore) {
      const error = new Error("Este seller já possui uma loja");
      error.statusCode = 409;
      throw error;
    }

    const slug = await buildUniqueSlug(name);

    const store = await Store.create({
      name,
      slug,
      description,
      logoUrl,
      owner: req.user._id,
    });

    return sendSuccess(res, 201, "Loja criada com sucesso", store);
  } catch (error) {
    return next(error);
  }
};

export const getMyStore = async (req, res, next) => {
  try {
    const store = await Store.findOne({ owner: req.user._id });

    if (!store) {
      const error = new Error("Loja não encontrada");
      error.statusCode = 404;
      throw error;
    }

    return sendSuccess(res, 200, "Loja encontrada com sucesso", store);
  } catch (error) {
    return next(error);
  }
};

export const getStoreById = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const store = await Store.findById(storeId).populate("owner", "name email role");

    if (!store) {
      const error = new Error("Loja não encontrada");
      error.statusCode = 404;
      throw error;
    }

    return sendSuccess(res, 200, "Loja encontrada com sucesso", store);
  } catch (error) {
    return next(error);
  }
};

export const updateMyStore = async (req, res, next) => {
  try {
    const { name, description, logoUrl } = req.body;

    const store = await Store.findOne({ owner: req.user._id });
    if (!store) {
      const error = new Error("Loja não encontrada");
      error.statusCode = 404;
      throw error;
    }

    if (name && name !== store.name) {
      store.name = name;
      store.slug = await buildUniqueSlug(name);
    }

    if (description !== undefined) {
      store.description = description;
    }

    if (logoUrl !== undefined) {
      store.logoUrl = logoUrl;
    }

    await store.save();

    return sendSuccess(res, 200, "Loja atualizada com sucesso", store);
  } catch (error) {
    return next(error);
  }
};

export const deleteMyStore = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    const store = await Store.findOne({ _id: storeId });

    if (!store) {
      const error = new Error("Loja não encontrada");
      error.statusCode = 404;
      throw error;
    }

    if (!store.owner.equals(req.user._id)) {
      const error = new Error("Apenas o dono da loja pode deletar esta loja");
      error.statusCode = 403;
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
