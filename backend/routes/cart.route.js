import { Router } from "express";

const router = Router();

router.get("/", getCart);
router.post("/", addToCart);
router.delete("/:id", removeAllCart);
router.put("/:id", updateCartItem);

export default router;
