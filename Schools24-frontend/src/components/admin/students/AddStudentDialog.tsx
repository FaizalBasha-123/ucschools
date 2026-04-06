"use client"

import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from 'sonner'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import { Info } from 'lucide-react'

export interface ClassOption {
    id: string
    name: string
    grade: number | null
    section?: string | null
}

interface AddStudentDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onAdd: (data: any) => void
    classes?: ClassOption[]
    isLoading?: boolean
}

export function AddStudentDialog({ open, onOpenChange, onAdd, classes = [], isLoading = false }: AddStudentDialogProps) {
    const [newStudent, setNewStudent] = useState({
        full_name: '',
        email: '',
        phone: '',
        password: '',
        class_id: '',
        section: 'A',
        roll_number: '',
        parent_name: '',
        parent_phone: '',
        parent_email: '',
        address: '',
        date_of_birth: '',
        gender: 'male',
    })

    const handleSubmit = () => {
        if (!newStudent.full_name || !newStudent.email || !newStudent.class_id || !newStudent.password) {
            toast.error('Please fill in all required fields (Name, Email, Class, Password)')
            return
        }
        if (!newStudent.parent_name || !newStudent.parent_phone) {
            toast.error('Parent information is required')
            return
        }
        onAdd(newStudent)
        // Reset form
        setNewStudent({
            full_name: '',
            email: '',
            phone: '',
            password: '',
            class_id: '',
            section: 'A',
            roll_number: '',
            parent_name: '',
            parent_phone: '',
            parent_email: '',
            address: '',
            date_of_birth: '',
            gender: 'male',
        })
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px]">
                <DialogHeader>
                    <DialogTitle>Add New Student</DialogTitle>
                    <DialogDescription>
                        Enroll a new student in the school.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="personal" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="academic">Academic Info</TabsTrigger>
                        <TabsTrigger value="personal">Personal Details</TabsTrigger>
                        <TabsTrigger value="parent">Parent & Contact</TabsTrigger>
                    </TabsList>

                    {/* --- ACADEMIC INFO --- */}
                    <TabsContent value="academic" className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <div className="flex items-center gap-1.5">
                                    <Label htmlFor="class">Class *</Label>
                                    <TooltipProvider delayDuration={100}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="max-w-[220px] text-xs">
                                                Make sure to set up classes in &ldquo;Class Management&rdquo; from the User Management page first.
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                                <Select
                                    value={newStudent.class_id}
                                    onValueChange={(value) => setNewStudent({ ...newStudent, class_id: value })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={isLoading ? 'Loading classes...' : 'Select Class'} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {classes.length === 0 && !isLoading && (
                                            <SelectItem value="__none" disabled>No classes found — add classes first</SelectItem>
                                        )}
                                        {classes.map(c => (
                                            <SelectItem key={c.id} value={c.id}>
                                                {c.name}{c.section ? ` - ${c.section}` : ''}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="section">Section *</Label>
                                <Select
                                    value={newStudent.section}
                                    onValueChange={(value) => setNewStudent({ ...newStudent, section: value })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select Section" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {['A', 'B', 'C', 'D'].map(s => (
                                            <SelectItem key={s} value={s}>{s}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="rollNumber">Roll Number *</Label>
                                <Input
                                    id="rollNumber"
                                    placeholder="e.g., 1001"
                                    value={newStudent.roll_number}
                                    onChange={(e) => setNewStudent({ ...newStudent, roll_number: e.target.value })}
                                />
                            </div>
                        </div>
                    </TabsContent>

                    {/* --- PERSONAL DETAILS --- */}
                    <TabsContent value="personal" className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="name">Full Name *</Label>
                                <Input
                                    id="name"
                                    placeholder="Enter full name"
                                    value={newStudent.full_name}
                                    onChange={(e) => setNewStudent({ ...newStudent, full_name: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="email">Email Address *</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="student@school24.in"
                                    value={newStudent.email}
                                    onChange={(e) => setNewStudent({ ...newStudent, email: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="password">Password *</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    placeholder="Temporary password"
                                    value={newStudent.password}
                                    onChange={(e) => setNewStudent({ ...newStudent, password: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="gender">Gender *</Label>
                                <Select
                                    value={newStudent.gender}
                                    onValueChange={(value) => setNewStudent({ ...newStudent, gender: value })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="male">Male</SelectItem>
                                        <SelectItem value="female">Female</SelectItem>
                                        <SelectItem value="other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="phone">Phone Number</Label>
                                <Input
                                    id="phone"
                                    type="tel"
                                    inputMode="numeric"
                                    maxLength={10}
                                    placeholder="10-digit mobile number"
                                    value={newStudent.phone}
                                    onChange={(e) => setNewStudent({ ...newStudent, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="dob">Date of Birth</Label>
                                <Input
                                    id="dob"
                                    type="date"
                                    value={newStudent.date_of_birth}
                                    onChange={(e) => setNewStudent({ ...newStudent, date_of_birth: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="address">Address</Label>
                            <Input
                                id="address"
                                placeholder="Enter full address"
                                value={newStudent.address}
                                onChange={(e) => setNewStudent({ ...newStudent, address: e.target.value })}
                            />
                        </div>
                    </TabsContent>

                    {/* --- PARENT INFO --- */}
                    <TabsContent value="parent" className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                        <div className="grid gap-2">
                            <Label htmlFor="parentName">Parent Name *</Label>
                            <Input
                                id="parentName"
                                placeholder="Enter parent name"
                                value={newStudent.parent_name}
                                onChange={(e) => setNewStudent({ ...newStudent, parent_name: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="parentPhone">Parent Phone *</Label>
                                <Input
                                    id="parentPhone"
                                    type="tel"
                                    inputMode="numeric"
                                    maxLength={10}
                                    placeholder="10-digit mobile number"
                                    value={newStudent.parent_phone}
                                    onChange={(e) => setNewStudent({ ...newStudent, parent_phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="parentEmail">Parent Email</Label>
                                <Input
                                    id="parentEmail"
                                    placeholder="Enter parent email"
                                    value={newStudent.parent_email}
                                    onChange={(e) => setNewStudent({ ...newStudent, parent_email: e.target.value })}
                                />
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit}>Enroll Student</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
