import axios from "axios";
import MELHOR_ENVIO_CONFIG from "../config/melhorenvio.config.js";
import MelhorEnvioAuth from "../models/melhorEnvioAuth.model.js";
import { createHttpError } from "../helpers/httpError.js";

/**
 * Serviço HTTP client para API MelhorEnvio
 * Gerencia autenticação, refresh token e requisições
 */
class MelhorEnvioService {
  constructor() {
    this.baseUrl = MELHOR_ENVIO_CONFIG.baseUrl[MELHOR_ENVIO_CONFIG.environment];
    this.clientId = MELHOR_ENVIO_CONFIG.oauth.clientId;
    this.clientSecret = MELHOR_ENVIO_CONFIG.oauth.clientSecret;
    this.redirectUri = MELHOR_ENVIO_CONFIG.oauth.redirectUri;
  }

  /**
   * Cria instance do axios com timeout
   */
  createAxiosInstance(token = null) {
    const config = {
      baseURL: this.baseUrl,
      timeout: MELHOR_ENVIO_CONFIG.httpClient.timeout,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "PW MelhorEnvio Integration (suporte@localhost)",
      },
    };

    if (token) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }

    return axios.create(config);
  }

  isRetryableError(error) {
    const status = Number(error?.response?.status ?? 0);
    const networkCode = String(error?.code ?? "").toUpperCase();

    if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) {
      return true;
    }

    return ["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(networkCode);
  }

  async runWithRetry(actionName, fn) {
    const maxRetries = Number(MELHOR_ENVIO_CONFIG.httpClient.maxRetries ?? 0);
    const retryDelay = Number(MELHOR_ENVIO_CONFIG.httpClient.retryDelay ?? 0);

    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const retryable = this.isRetryableError(error);
        if (!retryable || attempt === maxRetries) {
          break;
        }

        console.warn(
          `[MelhorEnvio] tentativa ${attempt + 1}/${maxRetries + 1} falhou em ${actionName}; tentando novamente...`,
        );
        await new Promise((resolve) => {
          setTimeout(resolve, retryDelay * (attempt + 1));
        });
      }
    }

    throw lastError;
  }

  /**
   * Gera URL de autorização OAuth2 para seller
   * Redirect por broswer → MelhorEnvio → callback com code
   */
  generateAuthorizationUrl(storeId) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      state: storeId, // usar storeId como state para validar depois
    });

    const configuredScope = String(MELHOR_ENVIO_CONFIG.oauth.scope ?? "").trim();
    if (configuredScope) {
      params.set("scope", configuredScope.replace(/,/g, " "));
    }

    return `${this.baseUrl}${MELHOR_ENVIO_CONFIG.endpoints.authorize}?${params.toString()}`;
  }

  /**
   * Troca authorization code por access token
   * Chamado após seller autorizou no browser
   */
  async exchangeCodeForToken(code) {
    try {
      const axiosInstance = this.createAxiosInstance();
      const response = await axiosInstance.post(MELHOR_ENVIO_CONFIG.endpoints.token, {
        grant_type: "authorization_code",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.redirectUri,
      });

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in, // segundos
      };
    } catch (error) {
      throw createHttpError(
        "Falha ao trocar código de autorização por token",
        502,
        error.response?.data || error.message,
        "ME_AUTH_EXCHANGE_FAILED",
      );
    }
  }

  /**
   * Renova access token usando refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const axiosInstance = this.createAxiosInstance();
      const response = await axiosInstance.post(MELHOR_ENVIO_CONFIG.endpoints.refreshToken, {
        grant_type: "refresh_token",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
      });

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
      };
    } catch (error) {
      throw createHttpError(
        "Falha ao renovar token MelhorEnvio",
        502,
        error.response?.data || error.message,
        "ME_REFRESH_FAILED",
      );
    }
  }

  /**
   * Valida e renova token se necessário
   */
  async ensureValidToken(storeId) {
    const auth = await MelhorEnvioAuth.findOne({
      store: storeId,
      isActive: true,
    });

    if (!auth) {
      throw createHttpError(
        "Loja não possui credenciais MelhorEnvio configuradas",
        404,
        undefined,
        "ME_AUTH_NOT_FOUND",
      );
    }

    // Renovar se expira em menos de 5 minutos
    const expiresIn = auth.expiresAt.getTime() - Date.now();
    if (expiresIn < 5 * 60 * 1000) {
      const newTokens = await this.refreshAccessToken(auth.refreshToken);
      auth.accessToken = newTokens.accessToken;
      auth.refreshToken = newTokens.refreshToken;
      auth.expiresAt = new Date(Date.now() + newTokens.expiresIn * 1000);
      auth.lastRefreshed = new Date();
      await auth.save();
    }

    return auth.accessToken;
  }

  /**
   * Calcula frete (cotação)
   * POST /api/shipment/calculate
   */
  async calculateShipping(storeId, payload) {
    const token = await this.ensureValidToken(storeId);
    let axiosInstance = this.createAxiosInstance(token);
    const configuredEndpoint = MELHOR_ENVIO_CONFIG.endpoints.calculateShipping;
    const endpointCandidates = [configuredEndpoint];

    const legacyCandidate = configuredEndpoint.includes("/api/v2/me/")
      ? configuredEndpoint.replace("/api/v2/me/", "/api/")
      : configuredEndpoint.replace("/api/", "/api/v2/me/");

    if (legacyCandidate && !endpointCandidates.includes(legacyCandidate)) {
      endpointCandidates.push(legacyCandidate);
    }

    // Alguns apps usam o endpoint v2 sem "/me".
    // Mantemos compatibilidade testando essa variação também.
    const v2NoMeCandidate = configuredEndpoint
      .replace("/api/v2/me/", "/api/v2/")
      .replace("/api/me/", "/api/");
    if (v2NoMeCandidate && !endpointCandidates.includes(v2NoMeCandidate)) {
      endpointCandidates.push(v2NoMeCandidate);
    }

    const isUnauthorizedStatus = (status) => [401, 403].includes(Number(status));

    const tryCalculateAcrossCandidates = async () => {
      let lastError = null;
      let unauthorizedError = null;

      for (const endpoint of endpointCandidates) {
        try {
          const response = await this.runWithRetry("calculateShipping", () => axiosInstance.post(endpoint, payload));
          return {
            data: {
              carriers: response.data,
              timestamp: new Date(),
            },
            error: null,
          };
        } catch (error) {
          lastError = error;
          const status = Number(error?.response?.status ?? 0);

          // Em caso de incompatibilidade de endpoint/método, tenta o próximo candidato.
          if ([404, 405].includes(status)) {
            continue;
          }

          // Guarda erro de autorização e tenta os próximos endpoints antes de concluir reauth.
          if (isUnauthorizedStatus(status)) {
            unauthorizedError = unauthorizedError || error;
            continue;
          }

          throw createHttpError(
            "Falha ao calcular frete com MelhorEnvio",
            502,
            error.response?.data || error.message,
            "ME_CALCULATE_FAILED",
          );
        }
      }

      if (unauthorizedError) {
        return { data: null, error: unauthorizedError };
      }

      return { data: null, error: lastError };
    };

    const firstAttempt = await tryCalculateAcrossCandidates();
    if (firstAttempt.data) return firstAttempt.data;

    const firstStatus = Number(firstAttempt.error?.response?.status ?? 0);
    if (isUnauthorizedStatus(firstStatus)) {
      const auth = await MelhorEnvioAuth.findOne({ store: storeId, isActive: true });
      if (auth?.refreshToken) {
        try {
          const refreshedTokens = await this.refreshAccessToken(auth.refreshToken);
          auth.accessToken = refreshedTokens.accessToken;
          auth.refreshToken = refreshedTokens.refreshToken;
          auth.expiresAt = new Date(Date.now() + Number(refreshedTokens.expiresIn ?? 0) * 1000);
          auth.lastRefreshed = new Date();
          await auth.save();

          axiosInstance = this.createAxiosInstance(refreshedTokens.accessToken);
          const secondAttempt = await tryCalculateAcrossCandidates();
          if (secondAttempt.data) return secondAttempt.data;

          const secondStatus = Number(secondAttempt.error?.response?.status ?? 0);
          if (isUnauthorizedStatus(secondStatus)) {
            throw createHttpError(
              "A conta da loja não está autorizada para cálculo de frete no MelhorEnvio. Reconecte a loja no onboarding.",
              502,
              {
                providerError: secondAttempt.error?.response?.data || secondAttempt.error?.message,
                attemptedEndpoints: endpointCandidates,
                environment: MELHOR_ENVIO_CONFIG.environment,
                hasConfiguredScope: Boolean(String(MELHOR_ENVIO_CONFIG.oauth.scope ?? "").trim()),
              },
              "ME_REAUTH_REQUIRED",
            );
          }

          throw createHttpError(
            "Falha ao calcular frete com MelhorEnvio",
            502,
            secondAttempt.error?.response?.data || secondAttempt.error?.message,
            "ME_CALCULATE_FAILED",
          );
        } catch (error) {
          if (error?.code === "ME_REAUTH_REQUIRED" || error?.code === "ME_CALCULATE_FAILED") {
            throw error;
          }

          throw createHttpError(
            "Falha ao renovar autenticação com MelhorEnvio para cálculo de frete",
            502,
            error?.response?.data || error?.message,
            "ME_AUTH_REFRESH_FOR_CALCULATE_FAILED",
          );
        }
      }

      throw createHttpError(
        "A conta da loja não está autorizada para cálculo de frete no MelhorEnvio. Reconecte a loja no onboarding.",
        502,
        {
          providerError: firstAttempt.error?.response?.data || firstAttempt.error?.message,
          attemptedEndpoints: endpointCandidates,
          environment: MELHOR_ENVIO_CONFIG.environment,
          hasConfiguredScope: Boolean(String(MELHOR_ENVIO_CONFIG.oauth.scope ?? "").trim()),
        },
        "ME_REAUTH_REQUIRED",
      );
    }

    throw createHttpError(
      "Falha ao calcular frete com MelhorEnvio",
      502,
      firstAttempt.error?.response?.data || firstAttempt.error?.message,
      "ME_CALCULATE_FAILED",
    );
  }

  /**
   * Cria etiqueta de envio (insere no carrinho do ME)
   * POST /api/v2/me/shipment
   */
  async createShippingLabel(storeId, payload) {
    const token = await this.ensureValidToken(storeId);
    let axiosInstance = this.createAxiosInstance(token);

    const normalizeLabelPayload = (rawData) => {
      const base = Array.isArray(rawData) ? rawData[0] : rawData;
      const data = base?.data && typeof base.data === "object" ? base.data : base;

      if (!data || !data.id) {
        return null;
      }

      return {
        id: data.id,
        protocol: data.protocol,
        status: data.status,
        tracking: data.tracking,
        labelUrl: data.label,
        timestamp: new Date(),
      };
    };

    const configuredEndpoint = MELHOR_ENVIO_CONFIG.endpoints.createShippingLabel;
    const endpointCandidates = [
      configuredEndpoint,
      "/api/v2/me/cart",
      "/api/v2/me/shipment/checkout",
      "/api/v2/me/shipment/generate",
      "/api/v2/me/shipment",
      "/api/v2/shipment",
      "/api/shipment",
    ];
    const uniqueCandidates = Array.from(new Set(endpointCandidates.filter(Boolean)));

    const isUnauthorizedStatus = (status) => [401, 403].includes(Number(status));

    const tryCreateAcrossCandidates = async () => {
      let lastError = null;
      let unauthorizedError = null;
      const invalidResponses = [];

      for (const endpoint of uniqueCandidates) {
        try {
          const response = await this.runWithRetry("createShippingLabel", () => axiosInstance.post(endpoint, payload));
          const normalized = normalizeLabelPayload(response.data);

          if (normalized) {
            return { data: normalized, error: null, invalidResponses };
          }

          invalidResponses.push({
            endpoint,
            providerResponse: response.data,
          });
          continue;
        } catch (error) {
          lastError = error;
          const status = Number(error?.response?.status ?? 0);

          if ([404, 405].includes(status)) {
            continue;
          }

          if (isUnauthorizedStatus(status)) {
            unauthorizedError = unauthorizedError || error;
            continue;
          }

          throw createHttpError(
            "Falha ao criar etiqueta de envio",
            502,
            error.response?.data || error.message,
            "ME_CREATE_LABEL_FAILED",
          );
        }
      }

      if (unauthorizedError) {
        return { data: null, error: unauthorizedError, invalidResponses };
      }

      if (invalidResponses.length > 0 && !lastError) {
        lastError = createHttpError(
          "Resposta inválida ao criar etiqueta no MelhorEnvio",
          502,
          { invalidResponses },
          "ME_CREATE_LABEL_INVALID_RESPONSE",
        );
      }

      return { data: null, error: lastError, invalidResponses };
    };

    const firstAttempt = await tryCreateAcrossCandidates();
    if (firstAttempt.data) return firstAttempt.data;

    const firstStatus = Number(firstAttempt.error?.response?.status ?? 0);
    if (isUnauthorizedStatus(firstStatus)) {
      const auth = await MelhorEnvioAuth.findOne({ store: storeId, isActive: true });
      if (auth?.refreshToken) {
        try {
          const refreshedTokens = await this.refreshAccessToken(auth.refreshToken);
          auth.accessToken = refreshedTokens.accessToken;
          auth.refreshToken = refreshedTokens.refreshToken;
          auth.expiresAt = new Date(Date.now() + Number(refreshedTokens.expiresIn ?? 0) * 1000);
          auth.lastRefreshed = new Date();
          await auth.save();

          axiosInstance = this.createAxiosInstance(refreshedTokens.accessToken);
          const secondAttempt = await tryCreateAcrossCandidates();
          if (secondAttempt.data) return secondAttempt.data;

          const secondStatus = Number(secondAttempt.error?.response?.status ?? 0);
          if (isUnauthorizedStatus(secondStatus)) {
            throw createHttpError(
              "A conta da loja não está autorizada para criação de etiqueta no MelhorEnvio. Reconecte a loja no onboarding.",
              502,
              {
                providerError: secondAttempt.error?.response?.data || secondAttempt.error?.message,
                attemptedEndpoints: uniqueCandidates,
                environment: MELHOR_ENVIO_CONFIG.environment,
                configuredScope: String(MELHOR_ENVIO_CONFIG.oauth.scope ?? "").trim(),
              },
              "ME_REAUTH_REQUIRED",
            );
          }

          throw createHttpError(
            "Falha ao criar etiqueta de envio",
            502,
            secondAttempt.error?.response?.data || secondAttempt.error?.message,
            "ME_CREATE_LABEL_FAILED",
          );
        } catch (error) {
          if (error?.code === "ME_REAUTH_REQUIRED" || error?.code === "ME_CREATE_LABEL_FAILED") {
            throw error;
          }

          throw createHttpError(
            "Falha ao renovar autenticação com MelhorEnvio para criação de etiqueta",
            502,
            error?.response?.data || error?.message,
            "ME_AUTH_REFRESH_FOR_LABEL_FAILED",
          );
        }
      }

      throw createHttpError(
        "A conta da loja não está autorizada para criação de etiqueta no MelhorEnvio. Reconecte a loja no onboarding.",
        502,
        {
          providerError: firstAttempt.error?.response?.data || firstAttempt.error?.message,
          attemptedEndpoints: uniqueCandidates,
          environment: MELHOR_ENVIO_CONFIG.environment,
          configuredScope: String(MELHOR_ENVIO_CONFIG.oauth.scope ?? "").trim(),
        },
        "ME_REAUTH_REQUIRED",
      );
    }

    throw createHttpError(
      "Falha ao criar etiqueta de envio",
      502,
      {
        providerError: firstAttempt.error?.response?.data || firstAttempt.error?.message,
        invalidResponses: firstAttempt.invalidResponses ?? [],
        attemptedEndpoints: uniqueCandidates,
        environment: MELHOR_ENVIO_CONFIG.environment,
      },
      "ME_CREATE_LABEL_FAILED",
    );
  }

  /**
   * Busca detalhes da etiqueta/envio
   * GET /api/shipment/:id
   */
  async getShippingLabel(storeId, melhorEnvioId) {
    const token = await this.ensureValidToken(storeId);
    const axiosInstance = this.createAxiosInstance(token);

    try {
      const endpoint = MELHOR_ENVIO_CONFIG.endpoints.getShippingLabel.replace(":id", melhorEnvioId);
      const response = await this.runWithRetry("getShippingLabel", () => axiosInstance.get(endpoint));

      return response.data;
    } catch (error) {
      throw createHttpError(
        "Falha ao buscar detalhes da etiqueta",
        502,
        error.response?.data || error.message,
        "ME_GET_LABEL_FAILED",
      );
    }
  }

  /**
   * Busca URL da etiqueta para impressão
   * GET /api/shipment/:id/label
   */
  async getPrintLabel(storeId, melhorEnvioId, format = "url") {
    const token = await this.ensureValidToken(storeId);
    const axiosInstance = this.createAxiosInstance(token);

    try {
      const endpoint = MELHOR_ENVIO_CONFIG.endpoints.getPrintLabel.replace(":id", melhorEnvioId);
      const response = await this.runWithRetry("getPrintLabel", () =>
        axiosInstance.get(endpoint, {
          params: { format }, // url, pdf, etc
        }),
      );

      return response.data;
    } catch (error) {
      throw createHttpError(
        "Falha ao gerar URL de impressão da etiqueta",
        502,
        error.response?.data || error.message,
        "ME_GET_PRINT_FAILED",
      );
    }
  }

  /**
   * Cancela etiqueta
   * DELETE /api/shipment/:id
   */
  async cancelLabel(storeId, melhorEnvioId) {
    const token = await this.ensureValidToken(storeId);
    const axiosInstance = this.createAxiosInstance(token);

    try {
      const endpoint = MELHOR_ENVIO_CONFIG.endpoints.createShippingLabel + `/${melhorEnvioId}`;
      await this.runWithRetry("cancelLabel", () => axiosInstance.delete(endpoint));

      return {
        success: true,
        melhorEnvioId,
        timestamp: new Date(),
      };
    } catch (error) {
      throw createHttpError(
        "Falha ao cancelar etiqueta",
        502,
        error.response?.data || error.message,
        "ME_CANCEL_LABEL_FAILED",
      );
    }
  }

  /**
   * Rastreia envios
   * GET /api/shipment/tracking?:params
   */
  async trackShipments(storeId, melhorEnvioIds) {
    const token = await this.ensureValidToken(storeId);
    const axiosInstance = this.createAxiosInstance(token);

    try {
      const response = await this.runWithRetry("trackShipments", () =>
        axiosInstance.get(MELHOR_ENVIO_CONFIG.endpoints.trackShipment, {
          params: {
            orders: melhorEnvioIds.join(","),
          },
        }),
      );

      return response.data;
    } catch (error) {
      throw createHttpError("Falha ao rastrear envios", 502, error.response?.data || error.message, "ME_TRACK_FAILED");
    }
  }

  /**
   * Lista transportadoras disponíveis
   * GET /api/shipment/carriers
   */
  async getCarriers(storeId) {
    const token = await this.ensureValidToken(storeId);
    const axiosInstance = this.createAxiosInstance(token);

    try {
      const response = await this.runWithRetry("getCarriers", () =>
        axiosInstance.get(MELHOR_ENVIO_CONFIG.endpoints.getCarriers),
      );

      return response.data;
    } catch (error) {
      throw createHttpError(
        "Falha ao buscar transportadoras disponíveis",
        502,
        error.response?.data || error.message,
        "ME_GET_CARRIERS_FAILED",
      );
    }
  }
}

export default new MelhorEnvioService();
