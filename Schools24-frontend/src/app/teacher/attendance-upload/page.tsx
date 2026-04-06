"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { CheckCircle, Clock, Loader2, Save, Search, UserCheck, UserX, Users, XCircle } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { getInitials } from "@/lib/utils"
import { sortTeacherClassRows } from "@/lib/classOrdering"

interface TeacherClass {
    class_id: string
    class_name: string
}

interface ClassStudent {
    id: string
    user_id: string
    roll_number: string
    full_name: string
    email: string
}

interface AttendanceStudentRecord {
    student_id: string
    user_id: string
    full_name: string
    roll_number: string
    email: string
    status: string
    remarks: string
}

type AttendanceStatus = "present" | "absent" | "late"

export default function AttendanceUploadPage() {
    const queryClient = useQueryClient()
    const [selectedClassId, setSelectedClassId] = useState("")
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0])
    const [searchQuery, setSearchQuery] = useState("")
    const [attendanceOverrides, setAttendanceOverrides] = useState<Record<string, AttendanceStatus>>({})

    const { data: classesData, isLoading: classesLoading } = useQuery({
        queryKey: ["teacher-attendance-classes"],
        queryFn: () => api.getOrEmpty<{ classes: TeacherClass[] }>("/teacher/classes", { classes: [] }),
        staleTime: 30 * 1000,
    })

    const classOptions = useMemo(() => {
        const classes = classesData?.classes || []
        const seen = new Set<string>()
        const unique: TeacherClass[] = []
        for (const cls of classes) {
            if (!cls?.class_id || seen.has(cls.class_id)) continue
            seen.add(cls.class_id)
            unique.push(cls)
        }
        return sortTeacherClassRows(unique)
    }, [classesData])

    const effectiveSelectedClassId = selectedClassId || classOptions[0]?.class_id || ""

    const { data: studentsData, isLoading: studentsLoading } = useQuery({
        queryKey: ["teacher-attendance-students", effectiveSelectedClassId],
        queryFn: () => api.getOrEmpty<{ students: ClassStudent[] }>(`/teacher/classes/${effectiveSelectedClassId}/students`, { students: [] }),
        enabled: !!effectiveSelectedClassId,
        staleTime: 10 * 1000,
    })

    const students = useMemo(() => studentsData?.students || [], [studentsData?.students])

    const { data: existingAttendanceData, isLoading: existingAttendanceLoading } = useQuery({
        queryKey: ["teacher-attendance-existing", effectiveSelectedClassId, selectedDate],
        enabled: !!effectiveSelectedClassId && !!selectedDate,
        queryFn: () =>
            api.getOrEmpty<{ class_id: string; date: string; students: AttendanceStudentRecord[] }>(
                `/teacher/attendance?class_id=${effectiveSelectedClassId}&date=${selectedDate}`,
                { class_id: '', date: '', students: [] }
            ),
        staleTime: 0,
    })

    const existingAttendanceMap = useMemo(() => {
        const next: Record<string, AttendanceStatus> = {}
        for (const row of existingAttendanceData?.students || []) {
            if (row.status === "present" || row.status === "absent" || row.status === "late") {
                next[row.student_id] = row.status
            }
        }
        return next
    }, [existingAttendanceData?.students])

    const attendance = useMemo(
        () => ({ ...existingAttendanceMap, ...attendanceOverrides }),
        [existingAttendanceMap, attendanceOverrides]
    )

    const filteredStudents = useMemo(() => {
        const query = searchQuery.trim().toLowerCase()
        if (!query) return students
        return students.filter((student) =>
            student.full_name.toLowerCase().includes(query) || (student.roll_number || "").toLowerCase().includes(query)
        )
    }, [students, searchQuery])

    const markAttendanceMutation = useMutation({
        mutationFn: () => {
            const rows = Object.entries(attendance).map(([studentId, status]) => ({
                student_id: studentId,
                status,
                remarks: "",
            }))

            return api.post("/teacher/attendance", {
                class_id: effectiveSelectedClassId,
                date: selectedDate,
                attendance: JSON.stringify(rows),
            })
        },
        onSuccess: () => {
            toast.success("Attendance saved successfully")
            setAttendanceOverrides({})
            queryClient.invalidateQueries({ queryKey: ["teacher-attendance-existing", effectiveSelectedClassId, selectedDate] })
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : "Please try again"
            toast.error("Failed to save attendance", {
                description: message,
            })
        },
    })

    const handleAttendanceChange = (studentId: string, status: AttendanceStatus) => {
        setAttendanceOverrides((prev) => ({
            ...prev,
            [studentId]: status,
        }))
    }

    const handleMarkAllPresent = () => {
        const next: Record<string, AttendanceStatus> = {}
        for (const student of students) {
            next[student.id] = "present"
        }
        setAttendanceOverrides(next)
    }

    const handleMarkAllAbsent = () => {
        const next: Record<string, AttendanceStatus> = {}
        for (const student of students) {
            next[student.id] = "absent"
        }
        setAttendanceOverrides(next)
    }

    const presentCount = Object.values(attendance).filter((s) => s === "present").length
    const absentCount = Object.values(attendance).filter((s) => s === "absent").length
    const lateCount = Object.values(attendance).filter((s) => s === "late").length
    const totalCount = students.length
    const notMarkedCount = Math.max(totalCount - presentCount - absentCount - lateCount, 0)

    const canSave = !!effectiveSelectedClassId && Object.keys(attendance).length > 0 && !markAttendanceMutation.isPending

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                    <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 bg-clip-text text-transparent">
                        Attendance
                    </h1>
                    <Button
                        onClick={() => markAttendanceMutation.mutate()}
                        className="h-9 whitespace-nowrap bg-gradient-to-r from-emerald-500 to-teal-600 text-white border-0"
                        disabled={!canSave}
                    >
                        {markAttendanceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save Changes
                    </Button>
                </div>
                <p className="text-muted-foreground">Mark attendance for your assigned classes only</p>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_132px] gap-2 sm:gap-3 sm:grid-cols-[minmax(0,220px)_180px]">
                <Select
                    value={effectiveSelectedClassId}
                    onValueChange={(value) => {
                        setSelectedClassId(value)
                        setAttendanceOverrides({})
                    }}
                    disabled={classesLoading || classOptions.length === 0}
                >
                    <SelectTrigger className="w-full">
                        <SelectValue placeholder={classesLoading ? "Loading classes..." : "Select Class"} />
                    </SelectTrigger>
                    <SelectContent>
                        {classOptions.map((cls) => (
                            <SelectItem key={cls.class_id} value={cls.class_id}>
                                {cls.class_name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                        setSelectedDate(e.target.value)
                        setAttendanceOverrides({})
                    }}
                    className="w-full"
                />
            </div>

            <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
                <Card>
                    <CardContent className="p-3 md:p-6 flex items-center gap-3 md:gap-4">
                        <div className="flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-600">
                            <CheckCircle className="h-5 w-5 md:h-6 md:w-6 text-white" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-lg md:text-2xl font-bold leading-tight">{presentCount}</p>
                            <p className="text-xs md:text-sm text-muted-foreground">Present</p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-3 md:p-6 flex items-center gap-3 md:gap-4">
                        <div className="flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-rose-600">
                            <XCircle className="h-5 w-5 md:h-6 md:w-6 text-white" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-lg md:text-2xl font-bold leading-tight">{absentCount}</p>
                            <p className="text-xs md:text-sm text-muted-foreground">Absent</p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-3 md:p-6 flex items-center gap-3 md:gap-4">
                        <div className="flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600">
                            <Users className="h-5 w-5 md:h-6 md:w-6 text-white" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-lg md:text-2xl font-bold leading-tight">{totalCount}</p>
                            <p className="text-xs md:text-sm text-muted-foreground">Total Students</p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-3 md:p-6 flex items-center gap-3 md:gap-4">
                        <div className="flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600">
                            <Clock className="h-5 w-5 md:h-6 md:w-6 text-white" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-lg md:text-2xl font-bold leading-tight">{notMarkedCount}</p>
                            <p className="text-xs md:text-sm text-muted-foreground">Not Marked</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-4 lg:flex-row xl:items-center xl:justify-between">
                        <div>
                            <CardTitle>Mark Attendance</CardTitle>
                            <CardDescription>Only students assigned to the selected class are listed</CardDescription>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search students..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9 w-full sm:w-[220px]"
                                />
                            </div>
                            <Button variant="outline" size="sm" onClick={handleMarkAllPresent} disabled={!students.length}>
                                <UserCheck className="mr-2 h-4 w-4 text-green-500" />
                                Mark All Present
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleMarkAllAbsent} disabled={!students.length}>
                                <UserX className="mr-2 h-4 w-4 text-red-500" />
                                Mark All Absent
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {studentsLoading || existingAttendanceLoading ? (
                        <div className="flex items-center justify-center py-12 text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading attendance...
                        </div>
                    ) : filteredStudents.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <Users className="h-12 w-12 text-muted-foreground/30 mb-4" />
                            <p className="text-muted-foreground">No students found for this class</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredStudents.map((student, index) => (
                                <div key={student.id} className="rounded-xl border bg-card p-3 sm:p-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
                                            {index + 1}
                                        </span>
                                        <Avatar className="h-10 w-10">
                                            <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                                                {getInitials(student.full_name)}
                                            </AvatarFallback>
                                        </Avatar>
                                            <div className="min-w-0">
                                            <p className="font-semibold">{student.full_name}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <Badge variant="outline" className="text-xs">
                                                    Roll: {student.roll_number || "-"}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>

                                        <div className="grid grid-cols-3 gap-2 w-full sm:w-auto">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className={
                                                attendance[student.id] === "present"
                                                    ? "bg-green-600 border-green-600 text-white hover:bg-green-700 hover:border-green-700"
                                                    : "border-green-600 text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                                            }
                                            onClick={() => handleAttendanceChange(student.id, "present")}
                                        >
                                            Present
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className={
                                                attendance[student.id] === "absent"
                                                    ? "bg-red-600 border-red-600 text-white hover:bg-red-700 hover:border-red-700"
                                                    : "border-red-600 text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                                            }
                                            onClick={() => handleAttendanceChange(student.id, "absent")}
                                        >
                                            Absent
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className={
                                                attendance[student.id] === "late"
                                                    ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700 hover:border-blue-700"
                                                    : "border-blue-600 text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                                            }
                                            onClick={() => handleAttendanceChange(student.id, "late")}
                                        >
                                            Late
                                        </Button>
                                    </div>
                                </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

