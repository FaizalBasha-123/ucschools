"use client"

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowLeft, School as SchoolIcon, Users, GraduationCap, BookOpen, ChevronLeft, ChevronRight, UserCog, Mail, MapPin, Hash, CalendarDays, FileDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSchool, useSchoolUsers } from '@/hooks/useSchools'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { UserManagement } from '@/components/school/UserManagement'
import { SchoolImportUsersPanel } from '@/components/school/SchoolImportUsersPanel'
import { StaffManagement } from '@/components/school/StaffManagement'
import { useAuth } from '@/contexts/AuthContext'

export default function SchoolConsolePage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isLoading } = useAuth()
  const isSuperAdmin = user?.role === 'super_admin'
  const canLoad = isSuperAdmin && !isLoading

  const schoolIdOrSlug = params.id as string
  const currentTab = searchParams.get('tab') || 'overview'
  const [isImportPanelOpen, setIsImportPanelOpen] = useState(false)

  const { data: school, isLoading: isSchoolLoading } = useSchool(schoolIdOrSlug, canLoad)
  const { data: adminsData } = useSchoolUsers(school?.id || '', 'admin', canLoad)
  const { data: teachersData } = useSchoolUsers(school?.id || '', 'teacher', canLoad)
  const { data: studentsData } = useSchoolUsers(school?.id || '', 'student', canLoad)

  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    if (isLoading || !user) return
    if (!isSuperAdmin) {
      const fallbackPath =
        user.role === 'admin' ? '/admin/dashboard'
          : user.role === 'teacher' ? '/teacher/dashboard'
            : user.role === 'student' ? '/student/dashboard'
              : '/login'
      router.push(fallbackPath)
    }
  }, [isLoading, isSuperAdmin, router, user])

  if (!isLoading && !isSuperAdmin) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Access denied</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Your account does not have Super Admin permissions.
          </p>
        </div>
      </div>
    )
  }

  const handleTabChange = (value: string) => {
    router.push(`/super-admin/school/${schoolIdOrSlug}?tab=${value}`)
  }

  if (isSchoolLoading || !school) {
    return (
      <div className="min-h-[100dvh] bg-background p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-4">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>

        <div className="flex items-center gap-4 mb-6">
          <Skeleton className="h-14 w-14 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>

        <div className="flex flex-col xl:flex-row gap-2">
          <aside className="w-full xl:w-52 flex-shrink-0 space-y-2">
            <Skeleton className="h-6 w-6 ml-auto mb-2" />
            <div className="space-y-1">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          </aside>

          <div className="flex-1 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-48 rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-background p-3 sm:p-4 md:p-6">
      <div className="mx-auto w-full max-w-[1440px] space-y-6">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            className="gap-2 bg-card"
            onClick={() => router.push('/super-admin')}
          >
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Button>
          <Button
            onClick={() => setIsImportPanelOpen(true)}
            className="gap-2"
          >
            <FileDown className="h-4 w-4" />
            Import
          </Button>
        </div>

        <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardContent className="p-5 md:p-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-600/20">
                  <SchoolIcon className="h-8 w-8 text-white" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                    {school.name}
                  </h1>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 text-slate-500" />
                      {school.address || 'No address provided'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-4 w-4 text-slate-500" />
                      {school.contact_email || 'No email provided'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm min-w-0 w-full md:w-auto md:min-w-[260px]">
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">School Slug</p>
                  <p className="mt-1 font-medium text-foreground">{school.slug || 'N/A'}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Created</p>
                  <p className="mt-1 font-medium text-foreground">{new Date(school.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs value={currentTab} onValueChange={handleTabChange} orientation="vertical" className="flex flex-col xl:flex-row gap-3">
          <aside className={`w-full ${isCollapsed ? 'xl:w-12' : 'xl:w-56'} xl:flex-shrink-0 transition-all duration-300 ease-in-out`}>
            <div className="mb-2 hidden xl:flex justify-end">
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:bg-muted hover:text-indigo-600" onClick={() => setIsCollapsed(!isCollapsed)}>
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </Button>
            </div>
            <TabsList className="flex xl:flex-col h-auto w-full bg-transparent p-0 gap-1.5 items-stretch justify-start overflow-x-auto xl:overflow-visible">
              <TabsTrigger value="overview" className={`flex-none xl:flex-auto justify-start px-3 py-2 h-9 text-sm font-medium data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 data-[state=active]:shadow-none bg-card border border-border/70 data-[state=active]:border-indigo-100 hover:bg-muted/40 transition-colors ${isCollapsed ? 'xl:justify-center xl:px-0' : ''}`}>
                <SchoolIcon className={`h-4 w-4 ${isCollapsed ? 'xl:mr-0 mr-3' : 'mr-3'}`} />
                <span className={isCollapsed ? 'xl:hidden' : ''}>Overview</span>
              </TabsTrigger>
              <TabsTrigger value="admins" className={`flex-none xl:flex-auto justify-start px-3 py-2 h-9 text-sm font-medium data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 data-[state=active]:shadow-none bg-card border border-border/70 data-[state=active]:border-indigo-100 hover:bg-muted/40 transition-colors ${isCollapsed ? 'xl:justify-center xl:px-0' : ''}`}>
                <Users className={`h-4 w-4 ${isCollapsed ? 'xl:mr-0 mr-3' : 'mr-3'}`} />
                <span className={isCollapsed ? 'xl:hidden' : ''}>Admins</span>
                {(school.stats?.admins ?? 0) > 0 && (<Badge variant="secondary" className={`ml-auto text-xs h-5 px-1.5 min-w-[1.25rem] justify-center ${isCollapsed ? 'xl:hidden' : ''}`}>{school.stats?.admins ?? 0}</Badge>)}
              </TabsTrigger>
              <TabsTrigger value="teachers" className={`flex-none xl:flex-auto justify-start px-3 py-2 h-9 text-sm font-medium data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 data-[state=active]:shadow-none bg-card border border-border/70 data-[state=active]:border-indigo-100 hover:bg-muted/40 transition-colors ${isCollapsed ? 'xl:justify-center xl:px-0' : ''}`}>
                <BookOpen className={`h-4 w-4 ${isCollapsed ? 'xl:mr-0 mr-3' : 'mr-3'}`} />
                <span className={isCollapsed ? 'xl:hidden' : ''}>Teachers</span>
                {(school.stats?.teachers ?? 0) > 0 && (<Badge variant="secondary" className={`ml-auto text-xs h-5 px-1.5 min-w-[1.25rem] justify-center ${isCollapsed ? 'xl:hidden' : ''}`}>{school.stats?.teachers ?? 0}</Badge>)}
              </TabsTrigger>
              <TabsTrigger value="students" className={`flex-none xl:flex-auto justify-start px-3 py-2 h-9 text-sm font-medium data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 data-[state=active]:shadow-none bg-card border border-border/70 data-[state=active]:border-indigo-100 hover:bg-muted/40 transition-colors ${isCollapsed ? 'xl:justify-center xl:px-0' : ''}`}>
                <GraduationCap className={`h-4 w-4 ${isCollapsed ? 'xl:mr-0 mr-3' : 'mr-3'}`} />
                <span className={isCollapsed ? 'xl:hidden' : ''}>Students</span>
                {(school.stats?.students ?? 0) > 0 && (<Badge variant="secondary" className={`ml-auto text-xs h-5 px-1.5 min-w-[1.25rem] justify-center ${isCollapsed ? 'xl:hidden' : ''}`}>{school.stats?.students ?? 0}</Badge>)}
              </TabsTrigger>
              <TabsTrigger value="staff" className={`flex-none xl:flex-auto justify-start px-3 py-2 h-9 text-sm font-medium data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 data-[state=active]:shadow-none bg-card border border-border/70 data-[state=active]:border-indigo-100 hover:bg-muted/40 transition-colors ${isCollapsed ? 'xl:justify-center xl:px-0' : ''}`}>
                <UserCog className={`h-4 w-4 ${isCollapsed ? 'xl:mr-0 mr-3' : 'mr-3'}`} />
                <span className={isCollapsed ? 'xl:hidden' : ''}>Staff</span>
                {(school.stats?.staff ?? 0) > 0 && (<Badge variant="secondary" className={`ml-auto text-xs h-5 px-1.5 min-w-[1.25rem] justify-center ${isCollapsed ? 'xl:hidden' : ''}`}>{school.stats?.staff ?? 0}</Badge>)}
              </TabsTrigger>
            </TabsList>
          </aside>

          <div className="flex-1 min-w-0">
            <TabsContent value="overview" className="mt-0 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                <Card className="border-slate-200/80 dark:border-slate-800">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Admins</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{school.stats?.admins || adminsData?.total || 0}</div>
                    <p className="text-xs text-muted-foreground">Manage school access</p>
                  </CardContent>
                </Card>
                <Card className="border-slate-200/80 dark:border-slate-800">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Teachers</CardTitle>
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{school.stats?.teachers || teachersData?.total || 0}</div>
                    <p className="text-xs text-muted-foreground">Academic staff</p>
                  </CardContent>
                </Card>
                <Card className="border-slate-200/80 dark:border-slate-800">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Students</CardTitle>
                    <GraduationCap className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{school.stats?.students || studentsData?.total || 0}</div>
                    <p className="text-xs text-muted-foreground">Enrolled students</p>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-slate-200/80 dark:border-slate-800">
                <CardHeader>
                  <CardTitle>School Details</CardTitle>
                  <CardDescription>Core institution information and system identifiers.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-border p-4 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <SchoolIcon className="h-4 w-4" /> Organization
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between"><span className="text-muted-foreground">School Name</span><span className="font-medium">{school.name}</span></div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border p-4 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Mail className="h-4 w-4" /> Contact
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground shrink-0">Email</span><span className="font-medium text-right break-all">{school.contact_email || 'Not provided'}</span></div>
                        <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground shrink-0">Address</span><span className="font-medium text-right">{school.address || 'Not provided'}</span></div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border p-4 space-y-3 lg:col-span-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Hash className="h-4 w-4" /> System Metadata
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 text-sm">
                        <div className="rounded-md bg-muted p-3"><p className="text-muted-foreground">School ID</p><p className="mt-1 font-mono text-xs break-all">{school.id}</p></div>
                        <div className="rounded-md bg-muted p-3"><p className="text-muted-foreground">School Slug</p><p className="mt-1 font-mono text-xs">{school.slug || 'N/A'}</p></div>
                        <div className="rounded-md bg-muted p-3"><p className="text-muted-foreground inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Created At</p><p className="mt-1 font-medium text-xs">{new Date(school.created_at).toLocaleString()}</p></div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="admins" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>School Admins</CardTitle>
                  <CardDescription>Manage administrator access for this school.</CardDescription>
                </CardHeader>
                <CardContent>
                  <UserManagement role="admin" schoolId={school.id} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="teachers" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Teachers</CardTitle>
                  <CardDescription>Manage teacher accounts.</CardDescription>
                </CardHeader>
                <CardContent>
                  <UserManagement role="teacher" schoolId={school.id} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="students" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Students</CardTitle>
                  <CardDescription>Manage student accounts.</CardDescription>
                </CardHeader>
                <CardContent>
                  <UserManagement role="student" schoolId={school.id} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="staff" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Staff</CardTitle>
                  <CardDescription>Manage non-teaching staff.</CardDescription>
                </CardHeader>
                <CardContent>
                  <StaffManagement schoolId={school.id} />
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </Tabs>
        <SchoolImportUsersPanel
          open={isImportPanelOpen}
          onOpenChange={setIsImportPanelOpen}
          schoolId={school.id}
        />
      </div>
    </div>
  )
}
