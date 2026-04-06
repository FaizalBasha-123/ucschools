import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

// ---- Types matching backend teacher module ----

export interface TeacherClass {
    id: string
    class_id: string
    class_name: string
    is_class_teacher: boolean
    academic_year: string
    subject_name?: string
}

export interface TeacherClassStudent {
    id: string
    user_id: string
    roll_number: string
    full_name: string
    email: string
}

export interface TeacherStudentFeeItem {
    id: string
    purpose_id?: string | null
    purpose_name: string
    amount: number
    paid_amount: number
    status: 'paid' | 'partial' | 'pending' | 'overdue'
    due_date?: string | null
}

export interface TeacherStudentPaymentItem {
    id: string
    amount: number
    payment_method: string
    payment_date: string
    status: string
    receipt_number: string
    purpose?: string | null
}

export interface TeacherStudentFeeResponse {
    student_id: string
    student_name: string
    class_name: string
    academic_year: string
    total_amount: number
    paid_amount: number
    pending_amount: number
    breakdown: TeacherStudentFeeItem[]
    payment_history: TeacherStudentPaymentItem[]
}

// ---- Hooks ----

/** Returns the teacher's assigned classes for the class dropdown. */
export function useTeacherClasses() {
    return useQuery({
        queryKey: ['teacher', 'classes'],
        queryFn: () => api.getOrEmpty<{ classes: TeacherClass[] }>('/teacher/classes', { classes: [] }),
        staleTime: 60 * 1000,
    })
}

/** Returns students in a specific class for the student dropdown. */
export function useTeacherClassStudents(classId: string | null) {
    return useQuery({
        queryKey: ['teacher', 'class-students', classId],
        enabled: !!classId,
        queryFn: () =>
            api.getOrEmpty<{ students: TeacherClassStudent[] }>(
                `/teacher/classes/${classId}/students`,
                { students: [] }
            ),
        staleTime: 60 * 1000,
    })
}

/** Returns fee data for a specific student in one of the teacher's classes. */
export function useTeacherStudentFees(studentId: string | null) {
    return useQuery({
        queryKey: ['teacher', 'student-fees', studentId],
        enabled: !!studentId,
        queryFn: () =>
            api.getOrEmpty<TeacherStudentFeeResponse>(
                `/teacher/fees/student/${studentId}`,
                {
                    student_id: '', student_name: '', class_name: '', academic_year: '',
                    total_amount: 0, paid_amount: 0, pending_amount: 0,
                    breakdown: [], payment_history: [],
                }
            ),
        staleTime: 30 * 1000,
    })
}
