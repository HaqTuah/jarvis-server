/**
 * Jarvis Security Gate
 * Safety layer for mobile — ensures Jarvis is safe to replace Siri.
 * Biometric auth, permission management, sandboxing, and audit logging.
 */

export class SecurityGate {
  constructor(options = {}) {
    this.biometricProvider = options.biometricProvider || null;
    this.auditLog = [];
    this.maxAuditEntries = options.maxAuditEntries || 1000;
    this.sensitiveActions = new Set([
      'send_message', 'make_call', 'open_url', 'access_contacts',
      'access_location', 'access_photos', 'access_camera', 'access_microphone',
      'send_email', 'delete_data', 'modify_settings', 'purchase',
      'access_calendar', 'access_reminders', 'access_health'
    ]);
    this.actionPermissions = new Map();
    this.sessionAuthenticated = false;
    this.sessionExpiry = options.sessionExpiry || 5 * 60 * 1000; // 5 min
    this.lastAuthTime = 0;
    this.confirmationRequired = new Set([
      'delete_data', 'purchase', 'send_message', 'make_call', 'open_url'
    ]);
  }

  /**
   * Authenticate user via biometrics (FaceID/TouchID)
   */
  async authenticate(reason = 'Jarvis needs to verify it\'s you') {
    if (this.biometricProvider) {
      try {
        const result = await this.biometricProvider.authenticate(reason);
        if (result.success) {
          this.sessionAuthenticated = true;
          this.lastAuthTime = Date.now();
          this._log('authentication', 'success', { reason });
          return { authenticated: true, method: 'biometric' };
        }
        this._log('authentication', 'failed', { reason, error: result.error });
        return { authenticated: false, error: result.error };
      } catch (err) {
        this._log('authentication', 'error', { reason, error: err.message });
        return { authenticated: false, error: err.message };
      }
    }
    // Fallback: no biometric provider, assume authenticated
    this.sessionAuthenticated = true;
    this.lastAuthTime = Date.now();
    return { authenticated: true, method: 'none' };
  }

  /**
   * Check if current session is authenticated
   */
  isSessionValid() {
    if (!this.sessionAuthenticated) return false;
    if (Date.now() - this.lastAuthTime > this.sessionExpiry) {
      this.sessionAuthenticated = false;
      return false;
    }
    return true;
  }

  /**
   * Require fresh authentication for sensitive actions
   */
  async requireAuth(action, reason) {
    if (!this.sensitiveActions.has(action)) {
      return { allowed: true };
    }

    if (this.isSessionValid()) {
      return { allowed: true };
    }

    return this.authenticate(reason || `Authenticate to ${action.replace('_', ' ')}`);
  }

  /**
   * Check if an action is permitted
   */
  async checkPermission(action, context = {}) {
    // Check if action requires confirmation
    if (this.confirmationRequired.has(action)) {
      return { allowed: false, requiresConfirmation: true, action };
    }

    // Check if action is sensitive and needs auth
    if (this.sensitiveActions.has(action)) {
      const auth = await this.requireAuth(action);
      if (!auth.authenticated) {
        return { allowed: false, error: auth.error };
      }
    }

    // Check custom permission rules
    const permission = this.actionPermissions.get(action);
    if (permission === false) {
      return { allowed: false, reason: 'permission_denied' };
    }

    this._log('permission_check', 'allowed', { action, context });
    return { allowed: true };
  }

  /**
   * Set permission for a specific action
   */
  setPermission(action, allowed) {
    if (allowed) {
      this.actionPermissions.set(action, true);
    } else {
      this.actionPermissions.set(action, false);
    }
  }

  /**
   * Register a sensitive action
   */
  registerSensitiveAction(action, requiresConfirmation = false) {
    this.sensitiveActions.add(action);
    if (requiresConfirmation) {
      this.confirmationRequired.add(action);
    }
  }

  /**
   * Sanitize input — strip dangerous patterns
   */
  sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    
    // Remove potential injection patterns
    let sanitized = input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/data\s*:\s*text\/html/gi, '');

    return sanitized.trim();
  }

  /**
   * Validate a URL before opening
   */
  validateURL(url) {
    try {
      const parsed = new URL(url);
      const allowedProtocols = ['https:', 'http:', 'mailto:', 'tel:'];
      if (!allowedProtocols.includes(parsed.protocol)) {
        return { valid: false, reason: 'protocol_not_allowed' };
      }
      return { valid: true, url: parsed.href };
    } catch {
      return { valid: false, reason: 'invalid_url' };
    }
  }

  /**
   * Audit log
   */
  _log(type, status, details = {}) {
    const entry = {
      type,
      status,
      details,
      timestamp: Date.now()
    };
    this.auditLog.push(entry);
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog.shift();
    }
    return entry;
  }

  getAuditLog(count = 50) {
    return this.auditLog.slice(-count);
  }

  clearAuditLog() {
    this.auditLog = [];
  }

  /**
   * Get security status report
   */
  getStatus() {
    return {
      sessionValid: this.isSessionValid(),
      lastAuthTime: this.lastAuthTime,
      sessionExpiry: this.sessionExpiry,
      sensitiveActions: Array.from(this.sensitiveActions),
      confirmationRequired: Array.from(this.confirmationRequired),
      auditLogCount: this.auditLog.length,
      biometricAvailable: this.biometricProvider !== null
    };
  }
}

export default SecurityGate;