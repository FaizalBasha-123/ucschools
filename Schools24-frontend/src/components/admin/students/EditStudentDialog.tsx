"use client"

import { useState, useEffect } from 'react'
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
import { Student } from '@/hooks/useAdminStudents'
import { api } from '@/lib/api'
import { Check, ChevronsUpDown, Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from "@/lib/utils"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { useBusRoutes } from "@/hooks/useBusRoutes"

interface EditStudentDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    student: Student | null
    onSave: (id: string, data: any) => void
    schoolId?: string
}

export function EditStudentDialog({ open, onOpenChange, student, onSave, schoolId }: EditStudentDialogProps) {
    const [classes, setClasses] = useState<any[]>([])
    const [busSearch, setBusSearch] = useState("")
    const [openBusSelect, setOpenBusSelect] = useState(false)
    const [formData, setFormData] = useState({
        // Academic
        roll_number: '',
        class_id: '',
        admission_number: '',
        admission_date: '',
        academic_year: '',
        // Personal
        full_name: '',
        email: '',
        date_of_birth: '',
        gender: '',
        blood_group: '',
        address: '',
        // Parent/Contact
        parent_name: '',
        parent_phone: '',
        parent_email: '',
        emergency_contact: '',
        // Transport
        bus_route_id: '',
        transport_mode: 'private',
    })

    const { data: busRoutesData } = useBusRoutes(busSearch, schoolId, {
        enabled: open && formData.transport_mode === 'bus'
    })
    const routes = busRoutesData?.pages.flatMap(page => page.routes) || []

    // Fetch classes
    useEffect(() => {
        if (open) {
            const fetchClasses = async () => {
                try {
                    const res = await api.get<any>('/classes')
                    // Adjust based on your API response structure for /classes
                    // If it returns { classes: [...] } use res.data.classes or similar if using axios
                    // Here assuming the response *is* the array or has a classes property
                    // Verify if api.get returns data directly or response object
                    // Based on previous code, api.get usually returns the data.
                    const data = res as any // If res is the array
                    if (Array.isArray(data)) {
                        setClasses(data)
                    } else if (data && Array.isArray((data as any).classes)) {
                        setClasses((data as any).classes)
                    }
                } catch (error) {
                    console.error("Failed to fetch classes", error)
                    toast.error("Failed to load classes list")
                }
            }
            fetchClasses()
        }
    }, [open])

    useEffect(() => {
        if (student) {
            setFormData({
                roll_number: student.roll_number || '',
                class_id: student.class_id || '',
                admission_number: student.admission_number || '',
                admission_date: student.admission_date ? student.admission_date.split('T')[0] : '',
                academic_year: student.academic_year || new Date().getFullYear().toString() + '-' + (new Date().getFullYear() + 1).toString(),

                full_name: student.full_name || '',
                email: student.email || '',
                date_of_birth: student.date_of_birth ? student.date_of_birth.split('T')[0] : '',
                gender: student.gender || '',
                blood_group: student.blood_group || '',
                address: student.address || '',

                parent_name: student.parent_name || '',
                parent_phone: student.parent_phone || '',
                parent_email: student.parent_email || '',
                emergency_contact: student.emergency_contact || '',
                // Transport
                bus_route_id: student.bus_route_id || '',
                transport_mode: student.transport_mode || 'private',
            })
        }
    }, [student])

    const handleSubmit = () => {
        if (!student?.id) return

        const payload = {
            full_name: formData.full_name,
            email: formData.email,
            admission_number: formData.admission_number,

            roll_number: formData.roll_number,
            class_id: formData.class_id,
            admission_date: formData.admission_date || undefined,
            academic_year: formData.academic_year,

            date_of_birth: formData.date_of_birth || undefined,
            gender: formData.gender,
            blood_group: formData.blood_group || undefined,
            address: formData.address || undefined,

            parent_name: formData.parent_name,
            parent_phone: formData.parent_phone,
            parent_email: formData.parent_email,
            emergency_contact: formData.emergency_contact || undefined,
            bus_route_id: formData.transport_mode === 'bus' ? formData.bus_route_id || null : null,
            transport_mode: formData.transport_mode,
        }

        onSave(student.id, payload)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px]">
                <DialogHeader>
                    <DialogTitle>Edit Student Details</DialogTitle>
                    <DialogDescription>
                        Update all student information.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="academic" className="w-full">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="academic">Academic Info</TabsTrigger>
                        <TabsTrigger value="personal">Personal Details</TabsTrigger>
                        <TabsTrigger value="parent">Parent & Contact</TabsTrigger>
                        <TabsTrigger value="transport">Transport</TabsTrigger>
                    </TabsList>

                    {/* --- ACADEMIC INFO --- */}
                    <TabsContent value="academic" className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Admission Number</Label>
                                <Input
                                    value={formData.admission_number}
                                    onChange={(e) => setFormData({ ...formData, admission_number: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <div className="flex items-center gap-1.5">
                                    <Label>Class</Label>
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
                                    value={formData.class_id}
                                    onValueChange={(val) => setFormData({ ...formData, class_id: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select Class" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {classes.length > 0 ? classes.map((cls: any) => (
                                            <SelectItem key={cls.id} value={cls.id}>
                                                {cls.name} {cls.section ? `(${cls.section})` : ''}
                                            </SelectItem>
                                        )) : <SelectItem value="loading" disabled>Loading classes...</SelectItem>}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Roll Number</Label>
                                <Input
                                    value={formData.roll_number}
                                    onChange={(e) => setFormData({ ...formData, roll_number: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Admission Date</Label>
                                <Input
                                    type="date"
                                    value={formData.admission_date}
                                    onChange={(e) => setFormData({ ...formData, admission_date: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Academic Year</Label>
                                <Input
                                    value={formData.academic_year}
                                    placeholder="e.g. 2024-2025"
                                    onChange={(e) => setFormData({ ...formData, academic_year: e.target.value })}
                                />
                            </div>
                        </div>
                    </TabsContent>

                    {/* --- PERSONAL DETAILS --- */}
                    <TabsContent value="personal" className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Full Name</Label>
                                <Input
                                    value={formData.full_name}
                                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Email (Login)</Label>
                                <Input
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Date of Birth</Label>
                                <Input
                                    type="date"
                                    value={formData.date_of_birth}
                                    onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Gender</Label>
                                <Select
                                    value={formData.gender}
                                    onValueChange={(val) => setFormData({ ...formData, gender: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select Gender" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="male">Male</SelectItem>
                                        <SelectItem value="female">Female</SelectItem>
                                        <SelectItem value="other">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <div className="grid gap-2">
                                <Label>Blood Group</Label>
                                <Select
                                    value={formData.blood_group}
                                    onValueChange={(val) => setFormData({ ...formData, blood_group: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(bg => (
                                            <SelectItem key={bg} value={bg}>{bg}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label>Address</Label>
                            <Input
                                value={formData.address}
                                placeholder="Full residential address"
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                            />
                        </div>
                    </TabsContent>

                    {/* --- PARENT INFO --- */}
                    <TabsContent value="parent" className="space-y-4 py-4">
                        <div className="grid gap-2">
                            <Label>Parent/Guardian Name</Label>
                            <Input
                                value={formData.parent_name}
                                onChange={(e) => setFormData({ ...formData, parent_name: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Parent Phone</Label>
                                <Input
                                    type="tel"
                                    inputMode="numeric"
                                    maxLength={10}
                                    placeholder="10-digit mobile number"
                                    value={formData.parent_phone}
                                    onChange={(e) => setFormData({ ...formData, parent_phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Parent Email</Label>
                                <Input
                                    value={formData.parent_email}
                                    onChange={(e) => setFormData({ ...formData, parent_email: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label>Emergency Contact</Label>
                            <Input
                                type="tel"
                                inputMode="numeric"
                                maxLength={10}
                                placeholder="10-digit mobile number"
                                value={formData.emergency_contact}
                                onChange={(e) => setFormData({ ...formData, emergency_contact: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                            />
                        </div>
                    </TabsContent>

                    <TabsContent value="transport" className="space-y-4 py-4">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <div className="flex items-center gap-1.5">
                                    <Label>Transport Mode</Label>
                                    <TooltipProvider delayDuration={100}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="max-w-[220px] text-xs">
                                                Make sure to set up bus routes in &ldquo;Bus Routes&rdquo; before selecting School Bus.
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </div>
                                <Select
                                    value={formData.transport_mode}
                                    onValueChange={(value) => setFormData(prev => ({
                                        ...prev,
                                        transport_mode: value,
                                        bus_route_id: value === 'private' ? '' : prev.bus_route_id,
                                    }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select transport mode" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="private">Private (Parent Drop-off)</SelectItem>
                                        <SelectItem value="bus">School Bus</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {formData.transport_mode === 'bus' && (
                                <div className="space-y-2">
                                    <Label>Bus Route</Label>
                                    <Popover open={openBusSelect} onOpenChange={setOpenBusSelect}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                aria-expanded={openBusSelect}
                                                className="w-full justify-between"
                                            >
                                                {formData.bus_route_id
                                                    ? routes.find((route) => route.id === formData.bus_route_id)
                                                        ? `${routes.find((route) => route.id === formData.bus_route_id)?.routeNumber} - ${routes.find((route) => route.id === formData.bus_route_id)?.vehicleNumber}`
                                                        : "Select bus route..."
                                                    : "Select bus route..."}
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[400px] p-0" align="start">
                                            <div className="p-2 border-b">
                                                <Input
                                                    placeholder="Search route #, vehicle, driver..."
                                                    value={busSearch}
                                                    onChange={(e) => setBusSearch(e.target.value)}
                                                    className="h-8"
                                                />
                                            </div>
                                            <div className="max-h-[300px] overflow-y-auto p-1">
                                                {routes.length === 0 ? (
                                                    <div className="text-sm text-muted-foreground p-2 text-center">No routes found.</div>
                                                ) : (
                                                    routes.map((route) => (
                                                        <div
                                                            key={route.id}
                                                            className={cn(
                                                                "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                                                                formData.bus_route_id === route.id ? "bg-accent" : ""
                                                            )}
                                                            onClick={() => {
                                                                setFormData(prev => ({ ...prev, bus_route_id: route.id }))
                                                                setOpenBusSelect(false)
                                                            }}
                                                        >
                                                            <Check
                                                                className={cn(
                                                                    "mr-2 h-4 w-4",
                                                                    formData.bus_route_id === route.id ? "opacity-100" : "opacity-0"
                                                                )}
                                                            />
                                                            <div className="flex flex-col">
                                                                <span className="font-medium">Route {route.routeNumber} ({route.vehicleNumber})</span>
                                                                <span className="text-xs text-muted-foreground">{route.driverName} • {route.driverPhone}</span>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                    <p className="text-[0.8rem] text-muted-foreground">
                                        Search by Route Number, Vehicle Number, Driver Name or Phone.
                                    </p>
                                </div>
                            )}
                        </div>
                    </TabsContent>
                </Tabs>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit}>Save Changes</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
