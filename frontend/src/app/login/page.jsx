"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form"; // Importamos o Controller
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { api } from "@/api/api";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";

const loginSchema = z.object({
  email: z.email({ error: "Introduza um e-mail válido." }),
  password: z.string().min(6, { error: "A senha deve ter no mínimo 6 caracteres." }),
});

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values) {
    setIsLoading(true);

    try {
      const response = await api.post("/auth/login", values);
      toast.success("Login efetuado com sucesso!");

      router.push("/");
      router.refresh();
    } catch (error) {
      console.error("Erro capturado:", error);

      const serverMessage = error.response?.data?.message;
      const genericMessage = "E-mail ou senha incorretos. Tente novamente.";

      toast.error(serverMessage || genericMessage, {
        duration: 4000,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <Card className="w-full max-w-md shadow-lg border-zinc-200">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold tracking-tight text-zinc-900">Entrar na sua conta</CardTitle>
          <CardDescription className="text-zinc-500">
            Introduza as suas credenciais para acessar o marketplace.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Controller
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name} className="text-zinc-700">
                    E-mail
                  </FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    placeholder="exemplo@email.com"
                    disabled={isLoading}
                    aria-invalid={fieldState.invalid}
                    className="bg-white"
                  />
                  {/* Renderiza o erro em vermelho se a validação do Zod falhar */}
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="password"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name} className="text-zinc-700">
                    Senha
                  </FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    type="password"
                    placeholder="••••••••"
                    disabled={isLoading}
                    aria-invalid={fieldState.invalid}
                    className="bg-white"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Button type="submit" className="w-full bg-zinc-900 hover:bg-zinc-800 text-white mt-4" disabled={isLoading}>
              {isLoading ? "Validando credenciais..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
