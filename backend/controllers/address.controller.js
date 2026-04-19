import { sendSuccess } from "../helpers/successResponse.js";
import {
  createAddressForUser,
  deleteAddressForUser,
  findUserAddressByIdOrThrow,
  listAddressesByUser,
  setDefaultAddressForUserById,
  updateAddressForUser,
} from "../services/address.service.js";

export const getMyAddresses = async (req, res, next) => {
  try {
    const addresses = await listAddressesByUser(req.user._id);
    return sendSuccess(res, 200, "Endereços listados com sucesso", addresses);
  } catch (error) {
    return next(error);
  }
};

export const getMyAddressById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const address = await findUserAddressByIdOrThrow(id, req.user._id);
    return sendSuccess(res, 200, "Endereço encontrado com sucesso", address);
  } catch (error) {
    return next(error);
  }
};

export const createMyAddress = async (req, res, next) => {
  try {
    const address = await createAddressForUser(req.user._id, req.body);
    return sendSuccess(res, 201, "Endereço criado com sucesso", address);
  } catch (error) {
    return next(error);
  }
};

export const updateMyAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const address = await updateAddressForUser(id, req.user._id, req.body);
    return sendSuccess(res, 200, "Endereço atualizado com sucesso", address);
  } catch (error) {
    return next(error);
  }
};

export const setMyDefaultAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const address = await setDefaultAddressForUserById(id, req.user._id);
    return sendSuccess(res, 200, "Endereço padrão atualizado com sucesso", address);
  } catch (error) {
    return next(error);
  }
};

export const deleteMyAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    await deleteAddressForUser(id, req.user._id);
    return sendSuccess(res, 200, "Endereço removido com sucesso");
  } catch (error) {
    return next(error);
  }
};
