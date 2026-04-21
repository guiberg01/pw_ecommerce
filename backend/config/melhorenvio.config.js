/**
 * Configuração da API MelhorEnvio
 *
 * Docs: https://docs.melhorenvio.com.br/docs/
 */

const MELHOR_ENVIO_CONFIG = {
  // Ambiente: production ou sandbox
  environment: process.env.MELHOR_ENVIO_ENV || "production",

  // URLs base da API
  baseUrl: {
    production: "https://api.melhorenvio.com.br",
    sandbox: "https://sandbox.melhorenvio.com.br",
  },

  // OAuth2 - Credenciais do Aplicativo
  // Criar em: https://www.melhorenvio.com.br/painel/integracoes
  oauth: {
    clientId: process.env.MELHOR_ENVIO_CLIENT_ID,
    clientSecret: process.env.MELHOR_ENVIO_CLIENT_SECRET,
    redirectUri:
      process.env.MELHOR_ENVIO_REDIRECT_URI || "http://localhost:3980/api/webhooks/melhorenvio/auth/callback",
  },

  // Token JWT válido por 30 dias, precisa refresh token
  tokenExpiration: 30 * 24 * 60 * 60 * 1000, // 30 dias em ms

  // Endpoints da API
  endpoints: {
    // OAuth2
    authorize: "/oauth/authorize",
    token: "/oauth/token",
    refreshToken: "/oauth/token",

    // Cotação
    calculateShipping: "/api/shipment/calculate",

    // Etiquetas
    createShippingLabel: "/api/shipment",
    getShippingLabel: "/api/shipment/:id",
    getPrintLabel: "/api/shipment/:id/label",

    // Tracking
    trackShipment: "/api/shipment/tracking",

    // Carrier info
    getCarriers: "/api/shipment/carriers",
  },

  // Timeouts e retry policy
  httpClient: {
    timeout: 30000, // 30s
    maxRetries: 3,
    retryDelay: 1000, // 1s
  },

  // Transportadoras suportadas
  carriers: {
    SEDEX: { id: 1, name: "SEDEX" },
    PAC: { id: 2, name: "PAC" },
    JADLOG: { id: 3, name: "JADLOG" },
    LOGGI: { id: 4, name: "LOGGI" },
    AZUL: { id: 5, name: "Azul Cargo" },
    CORREIOS: { id: 17, name: "Correios" },
    // ... mais transportadoras podem ser adicionadas
  },

  // Configuração de webhook
  webhook: {
    // URL callback que o ME vai chamar
    callbackUrl:
      process.env.MELHOR_ENVIO_WEBHOOK_URL ||
      "https://90a9-2804-7f0-3c8-1a12-37c7-8978-8960-b19f.ngrok-free.app/api/webhooks/melhorenvio/events",
    // Secret compartilhado para validar HMAC-SHA256
    secret: process.env.MELHOR_ENVIO_WEBHOOK_SECRET,
    // Timeout para resposta: 6 segundos
    timeout: 6000,
    // Retry policy: 5 tentativas a cada 15 minutos
    maxRetries: 5,
    retryInterval: 15 * 60 * 1000, // 15 minutos
  },

  // Eventos de webhook suportados
  webhookEvents: {
    ORDER_CREATED: "order.created",
    ORDER_PENDING: "order.pending",
    ORDER_RELEASED: "order.released",
    ORDER_GENERATED: "order.generated",
    ORDER_RECEIVED: "order.received",
    ORDER_POSTED: "order.posted",
    ORDER_DELIVERED: "order.delivered",
    ORDER_CANCELLED: "order.cancelled",
    ORDER_UNDELIVERED: "order.undelivered",
    ORDER_PAUSED: "order.paused",
    ORDER_SUSPENDED: "order.suspended",
  },

  // Status mapping: MelhorEnvio → nossa aplicação
  statusMap: {
    created: "pending",
    pending: "pending",
    released: "pending", // já foi paga
    generated: "pending", // etiqueta gerada
    received: "posted", // recebida em ponto de distribuição
    posted: "in_transit", // postada
    delivered: "delivered",
    cancelled: "cancelled",
    undelivered: "failed",
    paused: "in_transit", // interrrompido (requer ação)
    suspended: "failed", // suspenso
  },
};

// Validar environment vars necessárias
if (!MELHOR_ENVIO_CONFIG.oauth.clientId || !MELHOR_ENVIO_CONFIG.oauth.clientSecret) {
  console.warn(
    "[MelhorEnvio] ⚠️ MELHOR_ENVIO_CLIENT_ID ou MELHOR_ENVIO_CLIENT_SECRET não configurados. " +
      "Funcionalidade de shipping desabilitada até configurar.",
  );
}

export default MELHOR_ENVIO_CONFIG;
