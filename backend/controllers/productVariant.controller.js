import { sendSuccess } from "../helpers/successResponse.js";
import { findProductVariantByIdOrThrow } from "../services/catalog.service.js";

export const getProductVariantById = async (req, res, next) => {
    const { id } = req.params;
    const variant = await findProductVariantByIdOrThrow(id);

    return sendSuccess(res, 200, "Variação encontrada com sucesso", variant);
};
