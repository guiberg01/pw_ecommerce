import { Router } from "express";
import {
  createMyAddress,
  deleteMyAddress,
  getMyAddressById,
  getMyAddresses,
  setMyDefaultAddress,
  updateMyAddress,
} from "../controllers/address.controller.js";
import { isLoggedIn } from "../middleware/auth.middleware.js";
import { validateBody, validateParams } from "../middleware/validation.middleware.js";
import { addressIdParamSchema, createAddressSchema, updateAddressSchema } from "../validators/address.validator.js";

const router = Router();

router.use(isLoggedIn);

router.get("/", getMyAddresses);
router.get("/:id", validateParams(addressIdParamSchema), getMyAddressById);
router.post("/", validateBody(createAddressSchema), createMyAddress);
router.put("/:id", validateParams(addressIdParamSchema), validateBody(updateAddressSchema), updateMyAddress);
router.patch("/:id/default", validateParams(addressIdParamSchema), setMyDefaultAddress);
router.delete("/:id", validateParams(addressIdParamSchema), deleteMyAddress);

export default router;
