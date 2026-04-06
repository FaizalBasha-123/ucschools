/**
 * Schools24 SDK Type Definitions
 * Enterprise-grade type safety for API operations
 */

export type UserRole = 'super_admin' | 'admin' | 'teacher' | 'student' | 'staff' | 'parent';

// ============================================================================
// Authentication Types
// ============================================================================

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface AuthResponse {
  user: User;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface User {
  id: string;
  name: string;
  full_name?: string;
  email: string;
  role: UserRole;
  phone?: string;
  avatar?: string;
  school_id?: string;
  school_name?: string;
  created_at?: string;
}

// ============================================================================
// School Types
// ============================================================================

export interface CreateSchoolPayload {
  name: string;
  code?: string;
  address?: string;
  contact_email?: string;
  admins: Array<{
    name: string;
    email: string;
    password: string;
  }>;
  password: string;
}

export interface School {
  id: string;
  name: string;
  code?: string;
  slug?: string;
  address?: string;
  contact_email?: string;
  is_active?: boolean;
  created_at?: string;
}

// ============================================================================
// User Creation Types
// ============================================================================

export interface CreateUserPayload {
  full_name: string;
  email: string;
  phone?: string;
  role: UserRole;
  password?: string; // Optional, system can generate
  school_id?: string;
  class_id?: string;
}

export interface CreateTeacherPayload {
  full_name: string;
  email: string;
  phone?: string;
  password: string;
  employee_id?: string;
  designation?: string;
  qualifications?: string[];
  subjects_taught?: string[];
  experience_years?: number;
  hire_date?: string;
  salary?: number;
  status?: string;
}

export interface CreateStudentPayload {
  full_name: string;
  email: string;
  phone?: string;
  password: string;
  admission_number?: string;
  roll_number?: string;
  class_id: string;
  section?: string;
  gender?: 'male' | 'female' | 'other';
  date_of_birth?: string;
  blood_group?: string;
  address?: string;
  parent_name?: string;
  parent_email?: string;
  parent_phone?: string;
  academic_year?: string;
}

export interface CreateStaffPayload {
  full_name: string;
  email: string;
  phone?: string;
  password: string;
  employeeId?: string;
  designation: string;
  qualification?: string;
  experience?: number;
  salary?: number;
  staffType: 'teaching' | 'non-teaching';
}

// ============================================================================
// Class and Subject Types
// ============================================================================

export interface CreateClassPayload {
  name: string;
  grade?: number | null;
  section?: string;
  academic_year: string;
  room_number?: string | null;
  class_teacher_id?: string;
  school_id?: string;
}

export interface Class {
  id: string;
  name: string;
  grade: number;
  section?: string;
  academic_year: string;
  class_teacher_id?: string;
  capacity?: number;
  student_count?: number;
  created_at: string;
}

export interface CreateSubjectPayload {
  name: string;
  code: string;
}

export interface Subject {
  id: string;
  name: string;
  code?: string;
  description?: string;
  credit_hours?: number;
  created_at: string;
}

export interface CatalogClass {
  id: string;
  name: string;
  sort_order: number;
}

export interface CatalogAssignment {
  class: CatalogClass;
  subjects: Subject[];
}

export interface GlobalSettings {
  current_academic_year: string;
}

// ============================================================================
// Academic Content Types
// ============================================================================

export interface CreateHomeworkPayload {
  title: string;
  description?: string;
  class_id: string;
  subject_id: string;
  due_date: string;
  max_marks?: number | string;
}

export interface CreateQuizPayload {
  title: string;
  chapter?: string;
  class_id: string;
  subject_id: string;
  is_anytime: boolean;
  scheduled_at: string;
  duration_minutes: number;
  total_marks: number;
  questions: QuizQuestion[];
}

export interface QuizQuestion {
  question_text: string;
  options: Array<{
    option_text: string;
    is_correct: boolean;
  }>;
  marks: number;
}

export interface CreateExamPayload {
  title: string;
  class_id: string;
  subject_id: string;
  exam_date: string;
  start_time: string;
  end_time: string;
  total_marks: number;
  exam_type: 'mid_term' | 'final' | 'unit_test' | 'assignment';
}

// ============================================================================
// Attendance Types
// ============================================================================

export interface MarkAttendancePayload {
  class_id: string;
  date: string;
  attendance: string;
}

export interface AttendanceRecord {
  student_id: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  remarks?: string;
}

// ============================================================================
// Fee Types
// ============================================================================

export interface CreateFeeStructurePayload {
  academic_year: string;
  fee_type: 'tuition' | 'transport' | 'library' | 'exam' | 'sports' | 'other';
  amount: number;
  description?: string;
  due_date?: string;
  applicable_classes?: string[];
}

export interface RecordPaymentPayload {
  student_id: string;
  amount: number;
  payment_method: 'cash' | 'card' | 'upi' | 'net_banking' | 'cheque';
  transaction_id?: string;
  payment_date: string;
  fee_type?: string;
  notes?: string;
}

// ============================================================================
// Event Types
// ============================================================================

export interface CreateEventPayload {
  title: string;
  type: 'holiday' | 'exam' | 'event' | 'meeting' | 'sports';
  event_date: string;
  start_time?: string;
  description?: string | null;
  location?: string;
}

// ============================================================================
// Bus Route Types
// ============================================================================

export interface CreateBusRoutePayload {
  route_number: string;
  driver_staff_id: string;
  vehicle_number: string;
  capacity: number;
  stops: Array<{ name: string; time: string }>;
}

export interface CreateBusStopPayload {
  route_id: string;
  stop_name: string;
  stop_time: string;
  sequence_number: number;
  latitude?: number;
  longitude?: number;
}

// ============================================================================
// Inventory Types
// ============================================================================

export interface CreateInventoryItemPayload {
  item_name: string;
  category: 'books' | 'equipment' | 'stationery' | 'sports' | 'lab' | 'other';
  quantity: number;
  unit_price?: number;
  minimum_stock?: number;
  supplier?: string;
  location?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  data?: T;
  message?: string;
  error?: string;
  success?: boolean;
}

export interface PaginatedResponse<T> {
  users: T[];
  total: number;
  page: number;
  page_size: number;
}

// ============================================================================
// SDK Configuration Types
// ============================================================================

export interface SDKConfig {
  apiUrl: string;
  apiKey?: string;
  timeout?: number;
  retryAttempts?: number;
  rateLimitDelay?: number;
  enableLogging?: boolean;
  logFilePath?: string;
}

export interface SDKAuthContext {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  expiresAt: number | null;
}

// ============================================================================
// Error Types
// ============================================================================

export class SDKError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'SDKError';
  }
}

export class AuthenticationError extends SDKError {
  constructor(message: string, details?: unknown) {
    super(message, 'AUTH_ERROR', 401, details);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends SDKError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NetworkError extends SDKError {
  constructor(message: string, details?: unknown) {
    super(message, 'NETWORK_ERROR', 0, details);
    this.name = 'NetworkError';
  }
}

export class RateLimitError extends SDKError {
  constructor(message: string, retryAfter?: number) {
    super(message, 'RATE_LIMIT_ERROR', 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

export class UnsupportedOperationError extends SDKError {
  constructor(message: string, details?: unknown) {
    super(message, 'UNSUPPORTED_OPERATION', 400, details);
    this.name = 'UnsupportedOperationError';
  }
}
