/**
 * MCP Health Check Configuration
 * 
 * Configuration for BUY-21391 MCP Authenticated Endpoint Health Check
 * This file provides environment-specific settings and configuration options
 * for the MCP health check system.
 */

// Environment-specific endpoint configurations
const ENDPOINT_CONFIGS = {
  production: {
    base_url: 'https://api.buywhere.ai',
    endpoints: {
      health: '/api/mcp/health',
      auth_verify: '/api/mcp/auth/verify',
      auth_token: '/api/mcp/auth/token',
      mcp_tools: '/api/mcp',
      server_status: '/api/server/status',
      metrics: '/api/mcp/metrics'
    },
    timeouts: {
      health: 5000,
      auth: 8000,
      tools: 10000,
      overall: 30000
    },
    retry_config: {
      max_attempts: 2,
      delay: 1000,
      backoff_factor: 2
    }
  },
  development: {
    base_url: 'http://localhost:3002',
    endpoints: {
      health: '/api/mcp/health',
      auth_verify: '/api/mcp/auth/verify',
      auth_token: '/api/mcp/auth/token',
      mcp_tools: '/api/mcp',
      server_status: '/api/server/status',
      metrics: '/api/mcp/metrics'
    },
    timeouts: {
      health: 3000,
      auth: 5000,
      tools: 8000,
      overall: 20000
    },
    retry_config: {
      max_attempts: 1,
      delay: 500,
      backoff_factor: 1.5
    }
  },
  staging: {
    base_url: 'https://staging-api.buywhere.ai',
    endpoints: {
      health: '/api/mcp/health',
      auth_verify: '/api/mcp/auth/verify',
      auth_token: '/api/mcp/auth/token',
      mcp_tools: '/api/mcp',
      server_status: '/api/server/status',
      metrics: '/api/mcp/metrics'
    },
    timeouts: {
      health: 7000,
      auth: 10000,
      tools: 15000,
      overall: 45000
    },
    retry_config: {
      max_attempts: 3,
      delay: 2000,
      backoff_factor: 2
    }
  }
};

// Authentication configuration
const AUTH_CONFIGS = {
  default: {
    client_id: 'mcp-production-client',
    client_secret: 'mcp-production-secret',
    api_key: 'buywhere-mcp-api-key-dev',
    token_expiration_buffer: 30000, // 30 seconds before expiration
    supported_grant_types: ['client_credentials']
  },
  production: {
    client_id: process.env.MCP_CLIENT_ID || 'mcp-production-client',
    client_secret: process.env.MCP_CLIENT_SECRET || 'mcp-production-secret',
    api_key: process.env.MCP_API_KEY || 'buywhere-mcp-api-key-production',
    token_expiration_buffer: 30000
  },
  development: {
    client_id: process.env.MCP_CLIENT_ID || 'mcp-production-client',
    client_secret: process.env.MCP_CLIENT_SECRET || 'mcp-production-secret',
    api_key: process.env.MCP_API_KEY || 'buywhere-mcp-api-key-production',
    token_expiration_buffer: 15000 // Shorter for development
  }
};

// Tool configurations
const TOOL_CONFIGS = {
  search_products: {
    method: 'POST',
    requires_auth: true,
    critical: true,
    expected_fields: ['results', 'total'],
    test_params: { q: 'laptop', region: 'sg', limit: 10 }
  },
  get_product: {
    method: 'POST',
    requires_auth: true,
    critical: true,
    expected_fields: ['product', 'id'],
    test_params: { product_id: 'test' }
  },
  compare_products: {
    method: 'POST',
    requires_auth: true,
    critical: true,
    expected_fields: ['comparison', 'products'],
    test_params: { product_ids: ['test1', 'test2'] }
  },
  get_deals: {
    method: 'POST',
    requires_auth: true,
    critical: false,
    expected_fields: ['deals', 'total'],
    test_params: { min_discount: 10, region: 'sg' }
  },
  list_categories: {
    method: 'POST',
    requires_auth: true,
    critical: false,
    expected_fields: ['categories'],
    test_params: {}
  },
  find_best_price: {
    method: 'POST',
    requires_auth: true,
    critical: false,
    expected_fields: ['query', 'best_price', 'retailer'],
    test_params: { query: 'laptop' }
  }
};

// Health check severity levels
const SEVERITY_LEVELS = {
  critical: {
    color: '🔴',
    priority: 3,
    description: 'Critical failure - system unusable',
    actions: ['immediate_attention', 'deployment_check', 'service_restart']
  },
  high: {
    color: '🟠',
    priority: 2,
    description: 'High priority - significant impact',
    actions: ['troubleshooting', 'configuration_check']
  },
  medium: {
    color: '🟡',
    priority: 1,
    description: 'Medium priority - moderate impact',
    actions: ['monitoring', 'performance_check']
  },
  low: {
    color: '🟢',
    priority: 0,
    description: 'Low priority - minimal impact',
    actions: ['documentation', 'optimization']
  }
};

// Error code mappings
const ERROR_MAPPINGS = {
  '404': {
    severity: 'critical',
    category: 'deployment',
    message: 'Endpoint not found',
    recommendations: [
      'Check if service is deployed',
      'Verify endpoint configuration',
      'Check deployment status'
    ]
  },
  '401': {
    severity: 'high',
    category: 'authentication',
    message: 'Authentication failed',
    recommendations: [
      'Check API credentials',
      'Verify authentication configuration',
      'Ensure token is valid'
    ]
  },
  '403': {
    severity: 'high',
    category: 'authorization',
    message: 'Access denied',
    recommendations: [
      'Check permissions',
      'Verify API key scope',
      'Ensure proper access rights'
    ]
  },
  '500': {
    severity: 'critical',
    category: 'server',
    message: 'Internal server error',
    recommendations: [
      'Check server logs',
      'Verify resource availability',
      'Restart service if needed'
    ]
  },
  '502': {
    severity: 'high',
    category: 'network',
    message: 'Bad gateway',
    recommendations: [
      'Check upstream services',
      'Verify network connectivity',
      'Check load balancer status'
    ]
  },
  '503': {
    severity: 'critical',
    category: 'service',
    message: 'Service unavailable',
    recommendations: [
      'Check service health',
      'Verify deployment status',
      'Check resource limits'
    ]
  },
  '504': {
    severity: 'high',
    category: 'timeout',
    message: 'Gateway timeout',
    recommendations: [
      'Check timeout configuration',
      'Verify performance',
      'Increase timeout if needed'
    ]
  },
  'NETWORK_ERROR': {
    severity: 'high',
    category: 'connectivity',
    message: 'Network connectivity issue',
    recommendations: [
      'Check network connectivity',
      'Verify DNS resolution',
      'Check firewall settings'
    ]
  },
  'TIMEOUT': {
    severity: 'medium',
    category: 'performance',
    message: 'Request timeout',
    recommendations: [
      'Increase timeout values',
      'Check server performance',
      'Optimize slow queries'
    ]
  }
};

// Performance thresholds
const PERFORMANCE_THRESHOLDS = {
  response_times: {
    excellent: 1000,    // < 1s
    good: 3000,         // < 3s
    acceptable: 5000,   // < 5s
    poor: 10000         // > 10s
  },
  success_rates: {
    excellent: 100,     // 100%
    good: 95,          // > 95%
    acceptable: 85,    // > 85%
    poor: 70           // < 70%
  },
  error_rates: {
    excellent: 0,       // 0%
    good: 2,           // < 2%
    acceptable: 5,     // < 5%
    poor: 10           // > 10%
  }
};

// Alert configurations
const ALERT_CONFIGS = {
  email: {
    enabled: false,
    recipients: [],
    template: 'mcp_health_alert'
  },
  slack: {
    enabled: false,
    webhook_url: '',
    channel: '#alerts'
  },
  pagerduty: {
    enabled: false,
    service_key: '',
    event_action: 'trigger'
  }
};

// Helper functions
function getEnvironmentConfig(environment) {
  return ENDPOINT_CONFIGS[environment] || ENDPOINT_CONFIGS.production;
}

function getAuthConfig(environment) {
  return AUTH_CONFIGS[environment] || AUTH_CONFIGS.default;
}

function getToolConfig(toolName) {
  return TOOL_CONFIGS[toolName] || null;
}

function getSeverityInfo(severity) {
  return SEVERITY_LEVELS[severity] || SEVERITY_LEVELS.low;
}

function getErrorInfo(errorCode) {
  return ERROR_MAPPINGS[errorCode] || ERROR_MAPPINGS['NETWORK_ERROR'];
}

function getPerformanceThreshold(thresholdType, level) {
  return PERFORMANCE_THRESHOLDS[thresholdType]?.[level] || null;
}

export {
  ENDPOINT_CONFIGS,
  AUTH_CONFIGS,
  TOOL_CONFIGS,
  SEVERITY_LEVELS,
  ERROR_MAPPINGS,
  PERFORMANCE_THRESHOLDS,
  ALERT_CONFIGS,
  getEnvironmentConfig,
  getAuthConfig,
  getToolConfig,
  getSeverityInfo,
  getErrorInfo,
  getPerformanceThreshold
};