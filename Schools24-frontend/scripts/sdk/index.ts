/**
 * Schools24 SDK - Main Client
 * Enterprise-grade SDK for Schools24 platform automation
 */

import { APIClient } from './lib/api-client';
import { Logger } from './lib/logger';
import {
  validateCreateSchool,
  validateCreateUser,
  validateCreateClass,
  validateCreateStudent,
  validateCreateTeacher,
  validateCreateHomework
} from './lib/validation';
import {
  SDKConfig,
  UserRole,
  CreateSchoolPayload,
  CreateUserPayload,
  CreateTeacherPayload,
  CreateStudentPayload,
  CreateStaffPayload,
  CreateClassPayload,
  CreateSubjectPayload,
  CreateHomeworkPayload,
  CreateQuizPayload,
  CreateExamPayload,
  MarkAttendancePayload,
  CreateFeeStructurePayload,
  RecordPaymentPayload,
  CreateEventPayload,
  CreateBusRoutePayload,
  CreateBusStopPayload,
  CreateInventoryItemPayload,
  PaginatedResponse,
  UnsupportedOperationError,
  AuthenticationError,
  ValidationError,
  School,
  Class,
  Subject,
  CatalogClass,
  CatalogAssignment,
  GlobalSettings,
  User
} from './types';

export class Schools24SDK {
  private client: APIClient;
  private logger: Logger;

  private static readonly dashboardPathMap: Record<UserRole, string> = {
    super_admin: '/super-admin',
    admin: '/admin/dashboard',
    teacher: '/teacher/dashboard',
    student: '/student/dashboard',
    staff: '/driver/tracking',
    parent: '/login'
  };

  constructor(config: SDKConfig) {
    this.client = new APIClient(config);
    this.logger = this.client.getLogger();
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  async login(email: string, password: string): Promise<void> {
    await this.client.login(email, password);
  }

  async loginAndGetSession(email: string, password: string): Promise<{ user: User; dashboardPath: string }> {
    await this.client.login(email, password);
    const user = this.client.getAuthUser();

    if (!user) {
      throw new AuthenticationError('Login succeeded but no authenticated user was stored by the SDK');
    }

    return {
      user,
      dashboardPath: this.getDashboardPathForRole(user.role)
    };
  }

  async logout(): Promise<void> {
    await this.client.logout();
  }

  isAuthenticated(): boolean {
    return this.client.isAuthenticated();
  }

  getAuthUser() {
    return this.client.getAuthUser();
  }

  getDashboardPathForRole(role?: UserRole | null): string {
    if (!role) return '/login';
    return Schools24SDK.dashboardPathMap[role] || '/login';
  }

  getDashboardPath(): string {
    return this.getDashboardPathForRole(this.client.role as UserRole | null);
  }

  // ============================================================================
  // School Management (Super Admin)
  // ============================================================================

  async createSchool(payload: CreateSchoolPayload): Promise<School> {
    // Validate payload before sending to backend
    const validation = validateCreateSchool({
      name: payload.name,
      code: payload.code,
      address: payload.address
    });

    if (!validation.valid) {
      const errors = validation.errors
        .map(e => `${e.field}: ${e.message}`)
        .join('; ');
      throw new ValidationError(`School creation validation failed: ${errors}`);
    }

    this.logger.info('Creating school', { name: payload.name });
    const response = await this.client.post<{ school?: School } & Partial<School>>('/super-admin/schools', payload);
    const school = (response.school ?? response) as School;
    this.logger.success('School created', { id: school.id, name: school.name });
    return school;
  }

  async listSchools(): Promise<School[]> {
    const response = await this.client.get<{ schools: School[] }>('/super-admin/schools');
    return response.schools || [];
  }

  async getSchool(schoolId: string): Promise<School> {
    return this.client.get<School>(`/super-admin/schools/${schoolId}`);
  }

  // ============================================================================
  // User Management
  // ============================================================================

  async createUser(payload: CreateUserPayload): Promise<User> {
    // Validate payload
    const validation = validateCreateUser({
      email: payload.email,
      full_name: payload.full_name,
      phone: payload.phone,
      role: payload.role,
      password: payload.password
    });

    if (!validation.valid) {
      const errors = validation.errors
        .map(e => `${e.field}: ${e.message}`)
        .join('; ');
      throw new ValidationError(`User creation validation failed: ${errors}`);
    }

    this.logger.info('Creating user', { email: payload.email, role: payload.role });
    const query = new URLSearchParams();
    if (payload.school_id) {
      query.set('school_id', payload.school_id);
    }
    const endpoint = `/admin/users${query.toString() ? `?${query.toString()}` : ''}`;
    const response = await this.client.post<User>(endpoint, payload);
    this.logger.success('User created', { id: response.id, email: response.email });
    return response;
  }

  async createTeacher(payload: CreateTeacherPayload): Promise<unknown> {
    // Validate payload
    const validation = validateCreateTeacher({
      email: payload.email,
      full_name: payload.full_name,
      phone: payload.phone,
      password: payload.password
    });

    if (!validation.valid) {
      const errors = validation.errors
        .map(e => `${e.field}: ${e.message}`)
        .join('; ');
      throw new ValidationError(`Teacher creation validation failed: ${errors}`);
    }

    this.logger.info('Creating teacher', { name: payload.full_name });
    const response = await this.client.post('/admin/teachers', payload);
    this.logger.success('Teacher created', { name: payload.full_name });
    return response;
  }

  async createStudent(payload: CreateStudentPayload): Promise<unknown> {
    // Validate payload
    const validation = validateCreateStudent({
      email: payload.email,
      full_name: payload.full_name,
      phone: payload.phone,
      password: payload.password,
      class_id: payload.class_id,
      date_of_birth: payload.date_of_birth,
      gender: payload.gender
    });

    if (!validation.valid) {
      const errors = validation.errors
        .map(e => `${e.field}: ${e.message}`)
        .join('; ');
      throw new ValidationError(`Student creation validation failed: ${errors}`);
    }

    this.logger.info('Creating student', { name: payload.full_name });
    const response = await this.client.post('/admin/students', payload);
    this.logger.success('Student created', { name: payload.full_name });
    return response;
  }

  async createStaff(payload: CreateStaffPayload): Promise<unknown> {
    this.logger.info('Creating staff', { name: payload.full_name });
    const response = await this.client.post('/admin/staff', payload);
    this.logger.success('Staff created', { name: payload.full_name });
    return response;
  }

  async getUsers(params?: { page?: number; page_size?: number; role?: string; search?: string; school_id?: string }): Promise<PaginatedResponse<User>> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.page_size) query.set('page_size', String(params.page_size));
    if (params?.role) query.set('role', params.role);
    if (params?.search) query.set('search', params.search);
    if (params?.school_id) query.set('school_id', params.school_id);
    
    const response = await this.client.get<PaginatedResponse<User> & { items?: User[] }>(`/admin/users?${query.toString()}`);
    if ((response as PaginatedResponse<User>).users) {
      return response as PaginatedResponse<User>;
    }
    return {
      users: response.items ?? [],
      total: response.total ?? 0,
      page: response.page ?? 1,
      page_size: response.page_size ?? (params?.page_size ?? 20)
    };
  }

  async listStaff(params?: { page?: number; page_size?: number; search?: string }): Promise<Array<{ id: string; designation?: string }>> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.page_size) query.set('page_size', String(params.page_size));
    if (params?.search) query.set('search', params.search);
    const response = await this.client.get<{ staff?: Array<{ id: string; designation?: string }> }>(
      `/admin/staff?${query.toString()}`
    );
    return response.staff ?? [];
  }

  // ============================================================================
  // Class Management
  // ============================================================================

  async createClass(payload: CreateClassPayload): Promise<Class> {
    // Validate payload
    const validation = validateCreateClass({
      name: payload.name,
      academic_year: payload.academic_year,
      grade: payload.grade
    });

    if (!validation.valid) {
      const errors = validation.errors
        .map(e => `${e.field}: ${e.message}`)
        .join('; ');
      throw new ValidationError(`Class creation validation failed: ${errors}`);
    }

    this.logger.info('Creating class', { name: payload.name });
    const query = new URLSearchParams();
    if (this.client.role === 'super_admin' && payload.school_id) {
      query.set('school_id', payload.school_id);
    }
    const endpoint = `/classes${query.toString() ? `?${query.toString()}` : ''}`;
    const response = await this.client.post<{ class?: Class } & Partial<Class>>(endpoint, payload);
    const classData = (response.class ?? response) as Class;
    this.logger.success('Class created', { id: classData.id, name: classData.name });
    return classData;
  }

  async listClasses(academicYear?: string, schoolId?: string): Promise<Class[]> {
    const params = new URLSearchParams();
    if (academicYear) params.append('academic_year', academicYear);
    if (this.client.role === 'super_admin' && schoolId) params.append('school_id', schoolId);
    const query = params.toString();
    const response = await this.client.get<{ classes: Class[] }>(`/classes${query ? `?${query}` : ''}`);
    return response.classes || [];
  }

  async getClass(classId: string): Promise<Class> {
    return this.client.get<Class>(`/admin/classes/${classId}`);
  }

  // ============================================================================
  // Subject Management
  // ============================================================================

  async createSubject(payload: CreateSubjectPayload): Promise<Subject> {
    if (this.client.role !== 'super_admin') {
      throw new UnsupportedOperationError('Subject creation is super-admin catalog only. Use existing /admin/catalog/subjects for reads as admin.');
    }
    this.logger.info('Creating subject', { name: payload.name });
    const response = await this.client.post<{ subject?: Subject } & Partial<Subject>>('/super-admin/catalog/subjects', payload);
    const subjectData = (response.subject ?? response) as Subject;
    this.logger.success('Subject created', { id: subjectData.id, name: subjectData.name });
    return subjectData;
  }

  async listSubjects(): Promise<Subject[]> {
    const endpoint = this.client.role === 'super_admin' ? '/super-admin/catalog/subjects' : '/admin/catalog/subjects';
    const response = await this.client.get<{ subjects: Subject[] }>(endpoint);
    return response.subjects || [];
  }

  async listCatalogClasses(): Promise<CatalogClass[]> {
    const endpoint = this.client.role === 'super_admin' ? '/super-admin/catalog/classes' : '/admin/catalog/classes';
    const response = await this.client.get<{ classes: CatalogClass[] }>(endpoint);
    return response.classes || [];
  }

  async createCatalogClass(payload: { name: string; sort_order: number }): Promise<CatalogClass> {
    if (this.client.role !== 'super_admin') {
      throw new UnsupportedOperationError('Catalog class creation requires super-admin role.');
    }
    this.logger.info('Creating catalog class', { name: payload.name });
    const response = await this.client.post<{ class?: CatalogClass } & Partial<CatalogClass>>('/super-admin/catalog/classes', payload);
    const classData = (response.class ?? response) as CatalogClass;
    this.logger.success('Catalog class created', { id: classData.id, name: classData.name });
    return classData;
  }

  async listCatalogAssignments(): Promise<CatalogAssignment[]> {
    if (this.client.role !== 'super_admin') {
      throw new UnsupportedOperationError('Catalog assignment listing requires super-admin role.');
    }
    const response = await this.client.get<{ assignments: CatalogAssignment[] }>('/super-admin/catalog/assignments');
    return response.assignments || [];
  }

  async setCatalogClassSubjects(classId: string, subjectIds: string[]): Promise<void> {
    if (this.client.role !== 'super_admin') {
      throw new UnsupportedOperationError('Catalog assignment update requires super-admin role.');
    }
    await this.client.put(`/super-admin/catalog/classes/${classId}/subjects`, { subject_ids: subjectIds });
  }

  async getGlobalSettings(): Promise<GlobalSettings> {
    if (this.client.role !== 'super_admin') {
      throw new UnsupportedOperationError('Global settings are available to super-admin only.');
    }
    return this.client.get<GlobalSettings>('/super-admin/settings/global');
  }

  async updateGlobalSettings(payload: GlobalSettings): Promise<GlobalSettings> {
    if (this.client.role !== 'super_admin') {
      throw new UnsupportedOperationError('Global settings update requires super-admin role.');
    }
    return this.client.put<GlobalSettings>('/super-admin/settings/global', payload);
  }

  // ============================================================================
  // Academic Content
  // ============================================================================

  async createHomework(payload: CreateHomeworkPayload): Promise<unknown> {
    // Validate payload
    const validation = validateCreateHomework({
      title: payload.title,
      class_id: payload.class_id,
      subject_id: payload.subject_id,
      due_date: payload.due_date,
      max_marks: payload.max_marks
    });

    if (!validation.valid) {
      const errors = validation.errors
        .map(e => `${e.field}: ${e.message}`)
        .join('; ');
      throw new ValidationError(`Homework creation validation failed: ${errors}`);
    }

    this.logger.info('Creating homework', { title: payload.title });
    const response = await this.client.post('/teacher/homework', payload);
    this.logger.success('Homework created', { title: payload.title });
    return response;
  }

  async createQuiz(payload: CreateQuizPayload): Promise<unknown> {
    this.logger.info('Creating quiz', { title: payload.title });
    const response = await this.client.post('/teacher/quizzes', payload);
    this.logger.success('Quiz created', { title: payload.title });
    return response;
  }

  async createExam(_payload: CreateExamPayload): Promise<unknown> {
    throw new UnsupportedOperationError(
      'Exam creation payload does not match this backend. Use /admin/assessments with assessment payload shape.'
    );
  }

  // ============================================================================
  // Attendance
  // ============================================================================

  async markAttendance(payload: MarkAttendancePayload): Promise<unknown> {
    this.logger.info('Marking attendance', { 
      classId: payload.class_id, 
      date: payload.date,
      count: payload.attendance.length
    });
    const response = await this.client.post('/teacher/attendance', payload);
    this.logger.success('Attendance marked');
    return response;
  }

  // ============================================================================
  // Fee Management
  // ============================================================================

  async createFeeStructure(_payload: CreateFeeStructurePayload): Promise<unknown> {
    throw new UnsupportedOperationError(
      'Fee structure payload does not match this backend. Use /admin/fees/structures with name, academic_year, and items.'
    );
  }

  async recordPayment(payload: RecordPaymentPayload): Promise<unknown> {
    this.logger.info('Recording payment', { studentId: payload.student_id, amount: payload.amount });
    const response = await this.client.post('/admin/payments', payload);
    this.logger.success('Payment recorded');
    return response;
  }

  // ============================================================================
  // Events
  // ============================================================================

  async createEvent(_payload: CreateEventPayload): Promise<unknown> {
    throw new UnsupportedOperationError('Admin event creation endpoint is not available in this backend. Use supported operations endpoints only.');
  }

  async listEvents(): Promise<unknown[]> {
    throw new UnsupportedOperationError('Admin events listing endpoint is not available in this backend.');
  }

  // ============================================================================
  // Bus Routes
  // ============================================================================

  async createBusRoute(payload: CreateBusRoutePayload): Promise<unknown> {
    this.logger.info('Creating bus route', { routeNumber: payload.route_number });
    const response = await this.client.post('/admin/bus-routes', payload);
    this.logger.success('Bus route created', { routeNumber: payload.route_number });
    return response;
  }

  async listBusRoutes(params?: { page?: number; page_size?: number; search?: string }): Promise<{ routes: unknown[]; total: number; page: number; page_size: number }> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.page_size) query.set('page_size', String(params.page_size));
    if (params?.search) query.set('search', params.search);
    const response = await this.client.get<{ routes?: unknown[]; total?: number; page?: number; page_size?: number }>(
      `/admin/bus-routes${query.toString() ? `?${query.toString()}` : ''}`
    );
    return {
      routes: response.routes ?? [],
      total: response.total ?? 0,
      page: response.page ?? (params?.page ?? 1),
      page_size: response.page_size ?? (params?.page_size ?? 20),
    };
  }

  async createBusStop(_payload: CreateBusStopPayload): Promise<unknown> {
    throw new UnsupportedOperationError('Direct bus stop creation endpoint is not available. Use PUT /admin/bus-routes/:id/stops.');
  }

  // ============================================================================
  // Inventory
  // ============================================================================

  async createInventoryItem(payload: CreateInventoryItemPayload): Promise<unknown> {
    this.logger.info('Creating inventory item', { name: payload.item_name });
    const response = await this.client.post('/admin/inventory', payload);
    this.logger.success('Inventory item created', { name: payload.item_name });
    return response;
  }

  // ============================================================================
  // Dashboard & Stats
  // ============================================================================

  async getDashboardStats(): Promise<Record<string, unknown>> {
    return this.client.get('/admin/dashboard');
  }

  async getStudentLeaderboard(params?: { classId?: string; academicYear?: string }): Promise<Record<string, unknown>> {
    const query = new URLSearchParams();
    if (params?.classId) query.set('class_id', params.classId);
    if (params?.academicYear) query.set('academic_year', params.academicYear);
    
    return this.client.get(`/admin/leaderboards/students?${query.toString()}`);
  }

  async getTeacherLeaderboard(params?: { academicYear?: string }): Promise<Record<string, unknown>> {
    const query = new URLSearchParams();
    if (params?.academicYear) query.set('academic_year', params.academicYear);
    
    return this.client.get(`/admin/leaderboards/teachers?${query.toString()}`);
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  getLogger(): Logger {
    return this.logger;
  }

  getRequestCount(): number {
    return this.client.getRequestCount();
  }

  resetRequestCount(): void {
    this.client.resetRequestCount();
  }

  async waitForRateLimit(ms: number): Promise<void> {
    this.logger.debug(`Waiting ${ms}ms for rate limit`);
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================================
  // Batch Operations (with progress tracking)
  // ============================================================================

  async createBatch<T, P>(
    operation: (payload: P) => Promise<T>,
    payloads: P[],
    batchSize = 10,
    operationName = 'operation'
  ): Promise<{ succeeded: T[]; failed: Array<{ payload: P; error: Error }> }> {
    this.logger.section(`Starting batch ${operationName}`);
    this.logger.info(`Total items: ${payloads.length}`);

    const succeeded: T[] = [];
    const failed: Array<{ payload: P; error: Error }> = [];

    for (let i = 0; i < payloads.length; i += batchSize) {
      const batch = payloads.slice(i, i + batchSize);
      this.logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(payloads.length / batchSize)}`);

      const results = await Promise.allSettled(
        batch.map(payload => operation.call(this, payload))
      );

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          succeeded.push(result.value);
        } else {
          failed.push({
            payload: batch[index],
            error: result.reason
          });
          this.logger.error(`Failed item ${i + index + 1}`, result.reason);
        }
      });

      this.logger.progress(Math.min(i + batchSize, payloads.length), payloads.length, operationName);

      // Rate limiting between batches
      if (i + batchSize < payloads.length) {
        await this.waitForRateLimit(1000);
      }
    }

    this.logger.summary(`Batch ${operationName} Summary`, {
      'Total': payloads.length,
      'Succeeded': succeeded.length,
      'Failed': failed.length,
      'Success Rate': `${((succeeded.length / payloads.length) * 100).toFixed(2)}%`
    });

    return { succeeded, failed };
  }
}

// Export factory function
export function createSDK(config: SDKConfig): Schools24SDK {
  return new Schools24SDK(config);
}
