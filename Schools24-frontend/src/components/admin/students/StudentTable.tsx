"use client"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import {
    MoreHorizontal,
    Eye,
    Edit,
    FileText,
    Trash2,
    AlertTriangle
} from 'lucide-react'
import { getInitials, formatCurrency } from '@/lib/utils'
interface Student {
    id: string
    full_name: string
    email: string
    class_name?: string
    section?: string
    roll_number?: string
    parent_name?: string
    parent_phone?: string
    attendance?: number // Placeholder/Detailed stats mismatch handling
    attendance_stats?: {
        attendance_percent: number
    }
    grade?: string      // Placeholder
    current_grade?: string
    fees?: {
        status: string
        paid: number
        total: number
    }
}

interface StudentTableProps {
    students: Student[]
    totalStudents: number
    fetchTriggerIndex?: number
    fetchTriggerRef?: any
    onView: (student: any) => void
    onEdit: (student: any) => void
    onDelete: (student: any) => void
    onToggleFee: (student: any) => void
}

export function StudentTable({ students, totalStudents, fetchTriggerIndex, fetchTriggerRef, onView, onEdit, onDelete, onToggleFee }: StudentTableProps) {
    const getFeesBadgeVariant = (status: string) => {
        switch (status) {
            case 'paid':
                return 'success'
            case 'partial':
                return 'warning'
            case 'pending':
                return 'destructive'
            default:
                return 'secondary'
        }
    }

    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Class</TableHead>
                        <TableHead>Roll No</TableHead>
                        <TableHead>Parent</TableHead>
                        <TableHead>Attendance</TableHead>
                        <TableHead>Class</TableHead>
                        <TableHead>Fees</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {students.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                No students found
                            </TableCell>
                        </TableRow>
                    ) : (
                        students.map((student, index) => (
                            <TableRow key={student.id} className="hover:bg-muted/50" ref={index === fetchTriggerIndex ? fetchTriggerRef : undefined}>
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <Avatar>
                                            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-500 text-white">
                                                {getInitials(student.full_name || 'Unknown')}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <p className="font-medium">{student.full_name || 'Unknown Student'}</p>
                                            <p className="text-sm text-muted-foreground">{student.email || 'No email'}</p>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className="font-medium">
                                        {student.class_name || 'N/A'}-{student.section || 'A'}
                                    </Badge>
                                </TableCell>
                                <TableCell className="font-mono">{student.roll_number || '-'}</TableCell>
                                <TableCell>
                                    <div>
                                        <p className="text-sm">{student.parent_name || 'N/A'}</p>
                                        <p className="text-xs text-muted-foreground">{student.parent_phone || '-'}</p>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <Progress
                                            value={student.attendance_stats?.attendance_percent || 0}
                                            className="w-16 h-2"
                                        />
                                        <span className="text-sm font-medium">{student.attendance_stats?.attendance_percent || 0}%</span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="secondary">
                                        {student.current_grade || 'X'}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="space-y-1">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <Badge
                                                    variant={getFeesBadgeVariant(student.fees?.status || 'pending') as any}
                                                    className="cursor-pointer"
                                                    onClick={() => onToggleFee(student)}
                                                >
                                                    {student.fees?.status || 'Pending'}
                                                </Badge>
                                                {/* Check for missing mandatory fields */}
                                                {(!student.full_name || !student.email || !student.class_name || !student.roll_number || !student.parent_name || !student.parent_phone) && (
                                                    <div className="group relative">
                                                        <div className="h-5 w-5 rounded-full bg-destructive/10 flex items-center justify-center cursor-help">
                                                            <AlertTriangle className="h-3 w-3 text-destructive" />
                                                        </div>
                                                        <div className="absolute bottom-full right-0 mb-2 hidden w-48 rounded bg-popover p-2 text-xs text-popover-foreground shadow-md group-hover:block border z-50">
                                                            <p className="font-semibold mb-1 text-destructive">Missing Info:</p>
                                                            <ul className="list-disc pl-3 space-y-0.5">
                                                                {!student.full_name && <li>Full Name</li>}
                                                                {!student.email && <li>Email</li>}
                                                                {!student.class_name && <li>Class</li>}
                                                                {!student.roll_number && <li>Roll Number</li>}
                                                                {!student.parent_name && <li>Parent Name</li>}
                                                                {!student.parent_phone && <li>Parent Phone</li>}
                                                            </ul>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                {formatCurrency(student.fees?.paid || 0)} / {formatCurrency(student.fees?.total || 0)}
                                            </p>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => onView(student)}>
                                                <Eye className="mr-2 h-4 w-4" />
                                                View Details
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => onEdit(student)}>
                                                <Edit className="mr-2 h-4 w-4" />
                                                Edit
                                            </DropdownMenuItem>
                                            <DropdownMenuItem>
                                                <FileText className="mr-2 h-4 w-4" />
                                                Generate Report
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                className="text-destructive"
                                                onClick={() => onDelete(student)}
                                            >
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                Remove
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
