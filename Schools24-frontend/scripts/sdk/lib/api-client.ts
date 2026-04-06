/**
 * Schools24 SDK API Client
 * Enterprise-grade HTTP client with authentication, retry logic, and rate limiting
 */

import {
  SDKConfig,
  SDKAuthContext,
  AuthResponse,
  AuthenticationError,
  ValidationError,
  NetworkError,
  RateLimitError,
  SDKError
} from '../types';
import { Logger, getLogger } from './logger';

interface RefreshTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export class APIClient {
  private config: Required<SDKConfig>;
  private auth: SDKAuthContext;
  private logger: Logger;
  private requestCount: number = 0;
  private lastRequestTime: number = 0;
  private currentRequestId: string = '';

  constructor(config: SDKConfig) {
    const normalizedBase = APIClient.normalizeApiBase(config.apiUrl);
    this.config = {
      apiUrl: normalizedBase,
      apiKey: config.apiKey || '',
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      rateLimitDelay: config.rateLimitDelay || 100,
      enableLogging: config.enableLogging !== false,
      logFilePath: config.logFilePath || ''
    };

    this.auth = {
      accessToken: null,
      refreshToken: null,
      user: null,
      expiresAt: null
    };

    this.logger = getLogger(
      this.config.logFilePath,
      this.config.enableLogging
    );
  }

  private static normalizeApiBase(raw: string): string {
    const trimmed = (raw || '').trim().replace(/\/+$/, '');
    if (trimmed === '') {
      return 'http://localhost:8000/api/v1';
    }
    if (trimmed.endsWith('/api/v1')) {
      return trimmed;
    }
    return `${trimmed}/api/v1`;
  }

  private generateRequestId(): string {
    // Format: timestamp-random (e.g., 1712245200123-abc123)
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${timestamp}-${random}`;
  }

  // Public getter for user role
  get role(): string | null {
    return this.auth.user?.role || null;
  }

  // ============================================================================
  // Authentication Methods
  // ============================================================================

  async login(email: string, password: string): Promise<void> {
    this.logger.info('Attempting login', { email });

    const response = await this.request<AuthResponse>('POST', '/auth/login', {
      email,
      password
    });

    if (response.user && response.access_token) {
      this.auth.accessToken = response.access_token;
      this.auth.refreshToken = response.refresh_token || null;
      this.auth.user = response.user;
      this.auth.expiresAt = Date.now() + (response.expires_in * 1000);

      this.logger.success('Login successful', {
        userId: response.user.id,
        role: response.user.role,
        email: response.user.email
      });
    } else {
      throw new AuthenticationError('Invalid login response format');
    }
  }

  async logout(): Promise<void> {
    this.logger.info('Logging out');
    
    try {
      await this.request('POST', '/auth/logout', {});
    } catch {
      this.logger.warn('Logout request failed, clearing auth anyway');
    }

    this.clearAuth();
    this.logger.success('Logged out successfully');
  }

  isAuthenticated(): boolean {
    return !!(
      this.auth.accessToken &&
      this.auth.expiresAt &&
      this.auth.expiresAt > Date.now()
    );
  }

  getAuthUser() {
    return this.auth.user;
  }

  private clearAuth(): void {
    this.auth.accessToken = null;
    this.auth.refreshToken = null;
    this.auth.user = null;
    this.auth.expiresAt = null;
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.auth.refreshToken) {
      return false;
    }

    this.logger.debug('Attempting to refresh access token');

    try {
      const response = await this.request<RefreshTokenResponse>('POST', '/auth/refresh', {
        refresh_token: this.auth.refreshToken
      }, false); // Don't retry on refresh

      if (response.access_token) {
        this.auth.accessToken = response.access_token;
        if (response.refresh_token) {
          this.auth.refreshToken = response.refresh_token;
        }
        this.auth.expiresAt = Date.now() + (response.expires_in * 1000);
        
        this.logger.success('Access token refreshed');
        return true;
      }
    } catch (error) {
      this.logger.error('Token refresh failed', error instanceof Error ? error : undefined);
    }

    return false;
  }

  // ============================================================================
  // HTTP Request Methods
  // ============================================================================

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.config.rateLimitDelay) {
      const delay = this.config.rateLimitDelay - timeSinceLastRequest;
      await this.sleep(delay);
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    retry = true
  ): Promise<T> {
    const fullUrl = `${this.config.apiUrl}${endpoint}`;
    const startTime = Date.now();

    // Generate and track request ID
    this.currentRequestId = this.generateRequestId();

    // Rate limiting
    await this.enforceRateLimit();

    // Log request with ID
    this.logger.apiRequest(method, endpoint, body, this.currentRequestId);

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': this.currentRequestId
    };

    if (this.auth.accessToken && endpoint !== '/auth/login') {
      headers['Authorization'] = `Bearer ${this.auth.accessToken}`;
    }

    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    // Prepare request options
    const options: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.config.timeout)
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      options.body = JSON.stringify(body);
    }

    // Execute request with retry logic
    let lastError: Error | null = null;
    const maxAttempts = retry ? this.config.retryAttempts : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(fullUrl, options);
        const duration = Date.now() - startTime;

        // Log response
        this.logger.apiResponse(method, endpoint, response.status, duration);

        // Handle different status codes
        if (response.status === 401) {
          // Try to refresh token and retry once
          if (endpoint !== '/auth/refresh' && endpoint !== '/auth/login') {
            const refreshed = await this.refreshAccessToken();
            if (refreshed) {
              return this.request<T>(method, endpoint, body, false);
            }
          }
          throw new AuthenticationError('Authentication failed. Please login again.');
        }

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
          throw new RateLimitError(
            `Rate limit exceeded. Retry after ${retrySeconds} seconds`,
            retrySeconds
          );
        }

        if (response.status >= 500) {
          throw new SDKError(
            `Server error: ${response.statusText}`,
            'SERVER_ERROR',
            response.status
          );
        }

        if (response.status >= 400) {
          const errorData = await response.json().catch(() => ({}));
          throw new ValidationError(
            errorData.message || errorData.error || `Request failed: ${response.statusText}`,
            errorData
          );
        }

        // Handle 204 No Content
        if (response.status === 204) {
          return {} as T;
        }

        // Parse successful response
        const data = await response.json();
        return data as T;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on validation errors or auth errors
        if (error instanceof ValidationError || error instanceof AuthenticationError) {
          throw error;
        }

        // Log retry attempt
        if (attempt < maxAttempts) {
          const retryDelay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          this.logger.warn(
            `Request failed, retrying in ${retryDelay}ms (attempt ${attempt}/${maxAttempts})`,
            { error: lastError.message }
          );
          await this.sleep(retryDelay);
        }
      }
    }

    // All retries failed
    this.logger.apiError(method, endpoint, lastError!);
    
    if (lastError instanceof SDKError) {
      throw lastError;
    }
    
    throw new NetworkError(
      `Request failed after ${maxAttempts} attempts: ${lastError!.message}`,
      { originalError: lastError }
    );
  }

  // ============================================================================
  // Convenience HTTP Methods
  // ============================================================================

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>('GET', endpoint);
  }

  async post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>('POST', endpoint, body);
  }

  async put<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', endpoint, body);
  }

  async patch<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', endpoint, body);
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>('DELETE', endpoint);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  getRequestCount(): number {
    return this.requestCount;
  }

  resetRequestCount(): void {
    this.requestCount = 0;
  }

  getLogger(): Logger {
    return this.logger;
  }
}
