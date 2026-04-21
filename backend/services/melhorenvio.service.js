import axios from "axios";
import MELHOR_ENVIO_CONFIG from "../config/melhorenvio.config.js";
import MelhorEnvioAuth from "../models/melhorEnvioAuth.model.js";

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
      scope: "shipment-create shipment-read shipment-shipping shipment-cancel",
    });

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
      throw {
        errorCode: "ME_AUTH_EXCHANGE_FAILED",
        message: "Falha ao trocar código de autorização por token",
        details: error.response?.data || error.message,
      };
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
      throw {
        errorCode: "ME_REFRESH_FAILED",
        message: "Falha ao renovar token MelhorEnvio",
        details: error.response?.data || error.message,
      };
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
      throw {
        errorCode: "ME_AUTH_NOT_FOUND",
        message: "Loja não possui credenciais MelhorEnvio configuradas",
      };
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
    const axiosInstance = this.createAxiosInstance(token);

    try {
      const response = await this.runWithRetry("calculateShipping", () =>
        axiosInstance.post(MELHOR_ENVIO_CONFIG.endpoints.calculateShipping, payload),
      );

      return {
        carriers: response.data,
        timestamp: new Date(),
      };
    } catch (error) {
      throw {
        errorCode: "ME_CALCULATE_FAILED",
        message: "Falha ao calcular frete com MelhorEnvio",
        details: error.response?.data || error.message,
      };
    }
  }

  /**
   * Cria etiqueta de envio (insere no carrinho do ME)
   * POST /api/shipment
   */
  async createShippingLabel(storeId, payload) {
    const token = await this.ensureValidToken(storeId);
    const axiosInstance = this.createAxiosInstance(token);

    try {
      const response = await this.runWithRetry("createShippingLabel", () =>
        axiosInstance.post(MELHOR_ENVIO_CONFIG.endpoints.createShippingLabel, payload),
      );

      return {
        id: response.data.id,
        protocol: response.data.protocol,
        status: response.data.status,
        tracking: response.data.tracking,
        labelUrl: response.data.label, // URL da etiqueta impressão
        timestamp: new Date(),
      };
    } catch (error) {
      throw {
        errorCode: "ME_CREATE_LABEL_FAILED",
        message: "Falha ao criar etiqueta de envio",
        details: error.response?.data || error.message,
      };
    }
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
      throw {
        errorCode: "ME_GET_LABEL_FAILED",
        message: "Falha ao buscar detalhes da etiqueta",
        details: error.response?.data || error.message,
      };
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
      throw {
        errorCode: "ME_GET_PRINT_FAILED",
        message: "Falha ao gerar URL de impressão da etiqueta",
        details: error.response?.data || error.message,
      };
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
      throw {
        errorCode: "ME_CANCEL_LABEL_FAILED",
        message: "Falha ao cancelar etiqueta",
        details: error.response?.data || error.message,
      };
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
      throw {
        errorCode: "ME_TRACK_FAILED",
        message: "Falha ao rastrear envios",
        details: error.response?.data || error.message,
      };
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
      throw {
        errorCode: "ME_GET_CARRIERS_FAILED",
        message: "Falha ao buscar transportadoras disponíveis",
        details: error.response?.data || error.message,
      };
    }
  }
}

export default new MelhorEnvioService();
