import { z } from "zod";
import { mongoIdSchema } from "./common.validator.js";

const coordinatesSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const addressLocationSchema = z.object({
  coordinates: coordinatesSchema,
});

const addressBaseSchema = {
  label: z.string().trim().min(1).max(60).optional().nullable(),
  isDefault: z.boolean().optional(),
  zipCode: z.string().trim().min(3, "CEP inválido"),
  street: z.string().trim().min(1, "Rua é obrigatória"),
  number: z.string().trim().min(1, "Número é obrigatório"),
  complement: z.string().trim().optional().nullable(),
  neighborhood: z.string().trim().min(1, "Bairro é obrigatório"),
  city: z.string().trim().min(1, "Cidade é obrigatória"),
  state: z.string().trim().min(2, "Estado é obrigatório"),
  receiverName: z.string().trim().min(1, "Nome do destinatário é obrigatório"),
  phoneNumber: z.string().trim().min(8, "Telefone inválido"),
  location: addressLocationSchema.optional(),
};

export const addressIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const createAddressSchema = z.object(addressBaseSchema);

export const updateAddressSchema = z
  .object({
    label: addressBaseSchema.label,
    isDefault: addressBaseSchema.isDefault,
    zipCode: addressBaseSchema.zipCode.optional(),
    street: addressBaseSchema.street.optional(),
    number: addressBaseSchema.number.optional(),
    complement: addressBaseSchema.complement,
    neighborhood: addressBaseSchema.neighborhood.optional(),
    city: addressBaseSchema.city.optional(),
    state: addressBaseSchema.state.optional(),
    receiverName: addressBaseSchema.receiverName.optional(),
    phoneNumber: addressBaseSchema.phoneNumber.optional(),
    location: addressBaseSchema.location,
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Envie ao menos um campo para atualização",
  });
