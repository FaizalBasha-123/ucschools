"use client"

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Calendar, Clock, Users, Edit, Trash2, FileText } from 'lucide-react'
import { api } from '@/lib/api'
import { SUBJECTS_LIST } from '@/lib/constants'

interface TeacherExam {
    id: string
    title: string
    subject: string
    class: string
    date: string
    time: string
    duration: number
    type: string
}

interface TeacherExamsResponse {
    exams: TeacherExam[]
}

export default function ExamSchedulerPage() {
    const { data, isLoading } = useQuery({
        queryKey: ['teacher-exams'],
        queryFn: () => api.getOrEmpty<TeacherExamsResponse>('/teacher/exams', { exams: [] }),
    })

    const exams = data?.exams || []

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold">Exam Scheduler</h1>
                    <p className="text-muted-foreground">Schedule and manage examinations</p>
                </div>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button><Plus className="mr-2 h-4 w-4" />Schedule Exam</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Schedule New Exam</DialogTitle>
                            <DialogDescription>Set up a new examination.</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2"><Label>Exam Title</Label><Input placeholder="Enter exam title" /></div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="grid gap-2"><Label>Subject</Label><Select><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{SUBJECTS_LIST.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
                                <div className="grid gap-2"><Label>Class</Label><Select><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent><SelectItem value="10-A">10-A</SelectItem><SelectItem value="10-B">10-B</SelectItem></SelectContent></Select></div>
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                <div className="grid gap-2"><Label>Date</Label><Input type="date" /></div>
                                <div className="grid gap-2"><Label>Time</Label><Input type="time" /></div>
                                <div className="grid gap-2"><Label>Duration (mins)</Label><Input type="number" placeholder="180" /></div>
                            </div>
                        </div>
                        <DialogFooter><Button variant="outline">Cancel</Button><Button>Schedule</Button></DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {isLoading ? (
                <div className="grid gap-4 md:gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {[1, 2, 3].map((i) => (
                        <Card key={i} className="animate-pulse">
                            <CardHeader><div className="h-4 bg-muted rounded w-3/4" /><div className="h-3 bg-muted rounded w-1/2 mt-2" /></CardHeader>
                            <CardContent><div className="space-y-2"><div className="h-3 bg-muted rounded" /><div className="h-3 bg-muted rounded" /></div></CardContent>
                        </Card>
                    ))}
                </div>
            ) : exams.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                        <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-semibold mb-1">No exams scheduled</h3>
                        <p className="text-sm text-muted-foreground">Use the &quot;Schedule Exam&quot; button to create your first exam.</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {exams.map((exam) => (
                        <Card key={exam.id} className="card-hover">
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <Badge variant={exam.type === 'exam' ? 'destructive' : exam.type === 'test' ? 'default' : 'secondary'}>{exam.type}</Badge>
                                    <div className="flex gap-1"><Button variant="ghost" size="icon"><Edit className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4" /></Button></div>
                                </div>
                                <CardTitle className="text-lg">{exam.title}</CardTitle>
                                <CardDescription>{exam.subject}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground"><Users className="h-4 w-4" /><span>Class {exam.class}</span></div>
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground"><Calendar className="h-4 w-4" /><span>{exam.date}</span></div>
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4" /><span>{exam.time} • {exam.duration} mins</span></div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
