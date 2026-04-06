/**
 * Schools24 SDK Validation Layer
 * Runtime validation with LLM-friendly error messages
 * Provides type safety AND runtime safety
 */

import { UnsupportedOperationError } from '../types';

// ============================================================================
// Validation Result Type
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: {
    field: string;
    message: string;
    code?: string;
  }[];
}

// ============================================================================
// Validator Class
// ============================================================================

export class Validator {
  private errors: ValidationResult['errors'] = [];

  addError(field: string, message: string, code?: string): this {
    this.errors.push({ field, message, code });
    return this;
  }

  isValid(): boolean {
    return this.errors.length === 0;
  }

  getErrors(): ValidationResult {
    return {
      valid: this.isValid(),
      errors: this.errors
    };
  }

  throwIfInvalid(context: string): void {
    if (!this.isValid()) {
      const errorList = this.errors
        .map(e => `"${e.field}": ${e.message}`)
        .join(', ');
      throw new UnsupportedOperationError(
        `Validation failed in ${context}: {${errorList}}`
      );
    }
  }

  // ============================================================================
  // Email Validation
  // ============================================================================

  validateEmail(field: string, email: string): this {
    const trimmed = email?.trim() || '';

    if (!trimmed) {
      this.addError(field, '${field} is required');
      return this;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      this.addError(field, 'must be a valid email address (e.g., user@domain.com)');
      return this;
    }

    if (trimmed.length > 254) {
      this.addError(field, 'email is too long (max 254 characters)');
    }

    return this;
  }

  // ============================================================================
  // Name Validation
  // ============================================================================

  validateName(field: string, name: string, minLen = 2, maxLen = 100): this {
    const trimmed = name?.trim() || '';

    if (!trimmed) {
      this.addError(field, `${field} is required`);
      return this;
    }

    if (trimmed.length < minLen) {
      this.addError(
        field,
        `${field} must be at least ${minLen} characters (got ${trimmed.length})`
      );
      return this;
    }

    if (trimmed.length > maxLen) {
      this.addError(
        field,
        `${field} must be at most ${maxLen} characters (got ${trimmed.length})`
      );
      return this;
    }

    // Allow letters, spaces, hyphens, apostrophes
    const nameRegex = /^[a-zA-Z\s\-']+$/;
    if (!nameRegex.test(trimmed)) {
      this.addError(
        field,
        'must contain only letters, spaces, hyphens, and apostrophes'
      );
    }

    return this;
  }

  // ============================================================================
  // Password Validation
  // ============================================================================

  validatePassword(field: string, password: string): this {
    if (!password) {
      this.addError(field, 'password is required');
      return this;
    }

    if (password.length < 8) {
      this.addError(
        field,
        `password must be at least 8 characters (got ${password.length})`
      );
      return this;
    }

    if (password.length > 128) {
      this.addError(field, 'password is too long (max 128 characters)');
      return this;
    }

    const checks = {
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      digit: /\d/.test(password),
      special: /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)
    };

    const missing: string[] = [];
    if (!checks.uppercase) missing.push('uppercase letter (A-Z)');
    if (!checks.lowercase) missing.push('lowercase letter (a-z)');
    if (!checks.digit) missing.push('digit (0-9)');
    if (!checks.special) missing.push('special character (!@#$%^&*)');

    if (missing.length > 0) {
      this.addError(
        field,
        `password must contain at least one: ${missing.join(', ')}`
      );
    }

    return this;
  }

  // ============================================================================
  // Phone Validation
  // ============================================================================

  validatePhone(field: string, phone: string): this {
    const trimmed = phone?.trim() || '';

    if (!trimmed) {
      this.addError(field, `${field} is required`);
      return this;
    }

    // Extract only digits
    const digitsOnly = trimmed.replace(/\D/g, '');

    if (digitsOnly.length < 10 || digitsOnly.length > 15) {
      this.addError(
        field,
        `must be 10-15 digits (got ${digitsOnly.length} digits)`
      );
    }

    return this;
  }

  // ============================================================================
  // Required Field Validation
  // ============================================================================

  required(field: string, value: any): this {
    if (value === null || value === undefined || value === '') {
      this.addError(field, `${field} is required`);
    }
    return this;
  }

  // ============================================================================
  // UUID Validation
  // ============================================================================

  validateUUID(field: string, value: string): this {
    if (!value) {
      this.addError(field, `${field} is required`);
      return this;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) {
      this.addError(field, 'must be a valid UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)');
    }

    return this;
  }

  // ============================================================================
  // Number Validation
  // ============================================================================

  min(field: string, value: number, min: number): this {
    if (value < min) {
      this.addError(field, `must be at least ${min} (got ${value})`);
    }
    return this;
  }

  max(field: string, value: number, max: number): this {
    if (value > max) {
      this.addError(field, `must be at most ${max} (got ${value})`);
    }
    return this;
  }

  range(field: string, value: number, min: number, max: number): this {
    if (value < min || value > max) {
      this.addError(field, `must be between ${min} and ${max} (got ${value})`);
    }
    return this;
  }

  // ============================================================================
  // String Length Validation
  // ============================================================================

  minLength(field: string, value: string, min: number): this {
    const len = value?.length || 0;
    if (len < min) {
      this.addError(field, `must be at least ${min} characters (got ${len})`);
    }
    return this;
  }

  maxLength(field: string, value: string, max: number): this {
    const len = value?.length || 0;
    if (len > max) {
      this.addError(field, `must be at most ${max} characters (got ${len})`);
    }
    return this;
  }

  // ============================================================================
  // Enum Validation
  // ============================================================================

  oneOf(field: string, value: string, allowed: string[]): this {
    if (!allowed.includes(value)) {
      this.addError(
        field,
        `must be one of: ${allowed.join(', ')} (got "${value}")`
      );
    }
    return this;
  }

  // ============================================================================
  // Date Validation
  // ============================================================================

  validateDate(field: string, dateStr: string, format = 'YYYY-MM-DD'): this {
    if (!dateStr) {
      this.addError(field, `${field} is required`);
      return this;
    }

    // Try to parse as ISO date
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      this.addError(field, `must be a valid date in format ${format}`);
      return this;
    }

    return this;
  }

  validateFutureDate(field: string, dateStr: string): this {
    this.validateDate(field, dateStr);

    if (this.isValid()) {
      const date = new Date(dateStr);
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      if (date < now) {
        this.addError(field, 'must be a future date');
      }
    }

    return this;
  }

  validatePastDate(field: string, dateStr: string): this {
    this.validateDate(field, dateStr);

    if (this.isValid()) {
      const date = new Date(dateStr);
      const now = new Date();
      now.setHours(23, 59, 59, 999);

      if (date > now) {
        this.addError(field, 'must be a past date');
      }
    }

    return this;
  }
}

// ============================================================================
// Payload Validation Functions (for common operations)
// ============================================================================

export function validateCreateSchool(payload: any): ValidationResult {
  const v = new Validator();
  v.validateName('name', payload.name, 3, 100);
  if (payload.code) {
    v.validateName('code', payload.code, 2, 20);
  }
  if (payload.address) {
    v.minLength('address', payload.address, 5);
    v.maxLength('address', payload.address, 255);
  }
  return v.getErrors();
}

export function validateCreateUser(payload: any): ValidationResult {
  const v = new Validator();
  v.validateEmail('email', payload.email);
  v.validateName('full_name', payload.full_name, 2, 100);
  if (payload.phone) {
    v.validatePhone('phone', payload.phone);
  }
  if (payload.role) {
    v.oneOf('role', payload.role, [
      'super_admin',
      'admin',
      'teacher',
      'student',
      'staff',
      'parent'
    ]);
  }
  if (payload.password) {
    v.validatePassword('password', payload.password);
  }
  return v.getErrors();
}

export function validateCreateClass(payload: any): ValidationResult {
  const v = new Validator();
  v.validateName('name', payload.name, 2, 50);
  v.required('academic_year', payload.academic_year);
  if (payload.grade !== null && payload.grade !== undefined) {
    v.range('grade', payload.grade, 1, 12);
  }
  return v.getErrors();
}

export function validateCreateStudent(payload: any): ValidationResult {
  const v = new Validator();
  v.validateEmail('email', payload.email);
  v.validateName('full_name', payload.full_name, 2, 100);
  v.required('class_id', payload.class_id);
  if (payload.phone) {
    v.validatePhone('phone', payload.phone);
  }
  if (payload.date_of_birth) {
    v.validateDate('date_of_birth', payload.date_of_birth);
  }
  if (payload.gender) {
    v.oneOf('gender', payload.gender, ['male', 'female', 'other']);
  }
  return v.getErrors();
}

export function validateCreateTeacher(payload: any): ValidationResult {
  const v = new Validator();
  v.validateEmail('email', payload.email);
  v.validateName('full_name', payload.full_name, 2, 100);
  if (payload.phone) {
    v.validatePhone('phone', payload.phone);
  }
  if (payload.password) {
    v.validatePassword('password', payload.password);
  }
  return v.getErrors();
}

export function validateCreateHomework(payload: any): ValidationResult {
  const v = new Validator();
  v.required('title', payload.title);
  v.minLength('title', payload.title || '', 3);
  v.required('class_id', payload.class_id);
  v.required('subject_id', payload.subject_id);
  v.validateFutureDate('due_date', payload.due_date);
  return v.getErrors();
}
