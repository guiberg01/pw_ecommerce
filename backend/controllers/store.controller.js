import Store from "../models/store.model.js";

//função para gerar um slug único a partir do nome da loja (slug pra deixar a url bonitinha)
const slugify = (value) => {
  return value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
};

//função para garantir que o slug seja único no banco de dados
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

export const createStore = async (req, res, next) => {
  try {
    const { name, description, logoUrl } = req.body;

    if (!name) {
      const error = new Error("Nome da loja é obrigatório");
      error.statusCode = 400;
      throw error;
    }

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

    return res.status(201).json(store);
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

    return res.status(200).json(store);
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

    return res.status(200).json(store);
  } catch (error) {
    return next(error);
  }
};

export const updateMyStore = async (req, res, next) => {
  try {
    const { name, description, logoUrl, status } = req.body;

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

    if (req.user.role === "admin" && status) {
      store.status = status;
    }

    await store.save();

    return res.status(200).json(store);
  } catch (error) {
    return next(error);
  }
};
