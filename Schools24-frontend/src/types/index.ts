// Global Type Definitions for School24 Platform

export type UserRole = 'super_admin' | 'admin' | 'teacher' | 'student' | 'staff' | 'parent';

export interface User {
    id: string;
    name: string;
    full_name?: string;
    email: string;
    role: UserRole;
    avatar?: string;
    phone?: string;
    department?: string;
    class?: string;
    section?: string;
    rollNumber?: string;
    employeeId?: string;
    joinDate?: string;
    status: 'active' | 'inactive';
}

export interface Student {
    id: string;
    name: string;
    email: string;
    phone: string;
    class: string;
    section: string;
    rollNumber: string;
    parentName: string;
    parentPhone: string;
    address: string;
    dateOfBirth: string;
    admissionDate: string;
    avatar?: string;
    attendance: number;
    grade: string;
    fees: {
        total: number;
        paid: number;
        pending: number;
        status: 'paid' | 'partial' | 'pending';
    };
    performance: {
        rank: number;
        totalStudents: number;
        averageScore: number;
        subjects: { name: string; score: number; grade: string }[];
    };
}

export interface Teacher {
    id: string;
    userId?: string;
    name: string;
    email: string;
    phone: string;
    employeeId: string;
    department: string;
    subjects: string[];
    subjectIds?: string[];
    classes: string[];
    qualification: string;
    experience: string;
    joinDate: string;
    avatar?: string;
    salary: number;
    rating: number;
    status: 'active' | 'on-leave' | 'inactive';
}

export interface Staff {
    id: string;
    userId?: string; // actual user UUID, used for suspend/unsuspend
    name: string;
    email: string;
    phone: string;
    employeeId: string;
    staffType: 'teaching' | 'non-teaching';
    designation: string;
    subjects?: string[];
    classes?: string[];
    qualification: string;
    experience: number;
    joinDate: string;
    avatar?: string;
    salary: number;
    rating?: number;
    schoolId?: string;
    address?: string;
    dateOfBirth?: string;
    emergencyContact?: string;
    bloodGroup?: string;
    status?: 'active' | 'on-leave' | 'inactive';
    is_suspended?: boolean;
}


export interface Event {
    id: string;
    title: string;
    description: string;
    date: string;
    time: string;
    type: 'holiday' | 'exam' | 'event' | 'meeting' | 'sports' | 'cultural';
    location?: string;
    attendees?: string[];
}

export interface Quiz {
    id: string;
    title: string;
    subject: string;
    class: string;
    duration: number;
    totalMarks: number;
    questions: number;
    scheduledDate: string;
    status: 'upcoming' | 'active' | 'completed';
    createdBy: string;
}

export interface Homework {
    id: string;
    title: string;
    subject: string;
    class: string;
    description: string;
    dueDate: string;
    attachments?: string[];
    assignedBy: string;
    status: 'pending' | 'submitted' | 'graded';
}

export interface BusRoute {
    id: string;
    routeNumber: string;
    driverStaffId?: string;
    driverName: string;
    driverPhone: string;
    vehicleNumber: string;
    capacity: number;
    currentStudents: number;
    stops: { name: string; time: string }[];
    status?: 'active' | 'inactive';
}

export interface BusRouteStop {
    id: string;
    school_id: string;
    route_id: string;
    sequence: number;
    stop_name: string;
    address: string;
    lat: number;
    lng: number;
    radius_meters: number;
    place_id?: string | null;
    notes?: string | null;
}

export interface BusRouteStopInput {
    sequence: number;
    stop_name: string;
    address: string;
    lat: number;
    lng: number;
    radius_meters: number;
    place_id?: string;
    notes?: string;
}

export interface BusRouteShape {
    route_id: string;
    school_id: string;
    polyline: string;
    distance_m?: number | null;
    duration_est?: number | null;
}

export interface BusStopAssignment {
    id: string;
    school_id: string;
    student_id: string;
    route_id: string;
    stop_id: string;
    pickup_or_drop: 'pickup' | 'drop' | 'both';
    student_name?: string;
    stop_name?: string;
    sequence?: number;
}

export interface BusStopAssignmentInput {
    student_id: string;
    stop_id: string;
    pickup_or_drop?: 'pickup' | 'drop' | 'both';
}

export interface InventoryItem {
    id: string;
    name: string;
    category: string;
    quantity: number;
    unit: string;
    minStock: number;
    location: string;
    lastUpdated: string;
    status: 'in-stock' | 'low-stock' | 'out-of-stock';
}

export interface TimetableSlot {
    id: string;
    day: string;
    startTime: string;
    endTime: string;
    subject: string;
    teacher: string;
    class: string;
    room: string;
}

export interface AttendanceRecord {
    id: string;
    studentId: string;
    studentName: string;
    date: string;
    status: 'present' | 'absent' | 'late' | 'excused';
    remarks?: string;
}

export interface FeeRecord {
    id: string;
    studentId: string;
    studentName: string;
    class: string;
    feeType: string;
    amount: number;
    dueDate: string;
    paidDate?: string;
    status: 'paid' | 'pending' | 'overdue';
    paymentMethod?: string;
    transactionId?: string;
}

export interface Material {
    id: string;
    title: string;
    subject: string;
    class: string;
    type: 'pdf' | 'video' | 'link' | 'document';
    url: string;
    uploadedBy: string;
    uploadedDate: string;
    downloads: number;
    size?: string;
}

export interface Message {
    id: string;
    from: string;
    to: string;
    subject: string;
    content: string;
    date: string;
    read: boolean;
    attachments?: string[];
}
