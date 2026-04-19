import Address from "../models/address.model.js";
import { createHttpError } from "../helpers/httpError.js";

const ADDRESS_SORT = { isDefault: -1, createdAt: -1 };

const normalizeAddressPayload = (payload = {}) => {
  const normalized = { ...payload };

  if (payload.location?.coordinates) {
    normalized.location = {
      type: "Point",
      coordinates: payload.location.coordinates,
    };
  }

  return normalized;
};

const setDefaultAddressForUser = async (userId, addressId) => {
  await Address.updateMany({ user: userId, _id: { $ne: addressId } }, { $set: { isDefault: false } });
  await Address.findOneAndUpdate({ _id: addressId, user: userId }, { $set: { isDefault: true } });
};

const ensureAddressBelongsToUserOrThrow = async (addressId, userId) => {
  const address = await Address.findOne({ _id: addressId, user: userId });

  if (!address) {
    throw createHttpError("Endereço não encontrado", 404, undefined, "ADDRESS_NOT_FOUND");
  }

  return address;
};

const ensureUserKeepsAtLeastOneDefaultAddress = async (userId) => {
  const currentDefault = await Address.findOne({ user: userId, isDefault: true });
  if (currentDefault) return;

  const fallback = await Address.findOne({ user: userId }).sort({ createdAt: -1 });
  if (fallback) {
    fallback.isDefault = true;
    await fallback.save();
  }
};

export const listAddressesByUser = async (userId) => {
  return Address.find({ user: userId }).sort(ADDRESS_SORT);
};

export const findUserAddressByIdOrThrow = async (addressId, userId) => {
  return ensureAddressBelongsToUserOrThrow(addressId, userId);
};

export const createAddressForUser = async (userId, payload) => {
  const normalizedPayload = normalizeAddressPayload(payload);
  const hasAddress = await Address.exists({ user: userId });

  const address = await Address.create({
    ...normalizedPayload,
    user: userId,
    isDefault: payload.isDefault ?? !hasAddress,
  });

  if (address.isDefault) {
    await setDefaultAddressForUser(userId, address._id);
  }

  return Address.findById(address._id);
};

export const updateAddressForUser = async (addressId, userId, payload) => {
  const address = await ensureAddressBelongsToUserOrThrow(addressId, userId);
  const normalizedPayload = normalizeAddressPayload(payload);

  Object.assign(address, normalizedPayload);
  await address.save();

  if (payload.isDefault === true) {
    await setDefaultAddressForUser(userId, address._id);
  }

  if (payload.isDefault === false) {
    await ensureUserKeepsAtLeastOneDefaultAddress(userId);
  }

  return Address.findById(address._id);
};

export const setDefaultAddressForUserById = async (addressId, userId) => {
  await ensureAddressBelongsToUserOrThrow(addressId, userId);
  await setDefaultAddressForUser(userId, addressId);

  return Address.findById(addressId);
};

export const deleteAddressForUser = async (addressId, userId) => {
  const address = await ensureAddressBelongsToUserOrThrow(addressId, userId);
  await Address.findByIdAndDelete(address._id);

  if (address.isDefault) {
    await ensureUserKeepsAtLeastOneDefaultAddress(userId);
  }
};
