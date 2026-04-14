export const slugify = (value) => {
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

export const buildSlugCandidate = (value, attempt = 0) => {
  const base = slugify(value);
  return attempt === 0 ? base : `${base}-${attempt}`;
};

export const isDuplicateFieldError = (error, fieldName = "slug") => {
  return error?.name === "MongoServerError" && error?.code === 11000 && Boolean(error?.keyValue?.[fieldName]);
};

export const saveDocumentWithUniqueSlug = async ({ document, sourceValue, maxRetries = 5, slugField = "slug" }) => {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    document[slugField] = buildSlugCandidate(sourceValue, attempt);

    try {
      await document.save();
      return true;
    } catch (error) {
      if (isDuplicateFieldError(error, slugField)) {
        continue;
      }

      throw error;
    }
  }

  return false;
};

export const createDocumentWithUniqueSlug = async ({
  Model,
  payload,
  sourceValue,
  maxRetries = 5,
  slugField = "slug",
}) => {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await Model.create({
        ...payload,
        [slugField]: buildSlugCandidate(sourceValue, attempt),
      });
    } catch (error) {
      if (isDuplicateFieldError(error, slugField)) {
        continue;
      }

      throw error;
    }
  }

  return null;
};
