# NDEAR COMPLIANCE IMPLEMENTATION PLAN
**Target**: Achieve 90%+ scores in Federated Identity, Open APIs, and Data Privacy (DPDPA)  
**Repository**: D:\Schools24-Workspace\  
**Date**: March 28, 2026

---

## CURRENT STATE ANALYSIS

### **Existing Infrastructure** ✅

**Backend** (Schools24-backend):
- ✅ Student model has `apaar_id`, `abc_id`, `learner_id`, `date_of_birth` fields
- ✅ `parental_consents` table exists (migration 064) with OTP method support
- ✅ `data_subject_requests` table exists (migration 071) with DPDPA request types
- ✅ `consent_audit_events` table exists (migration 072) - immutable audit log
- ✅ `learner_registry` table (global) for cross-school identity
- ✅ `interop_jobs` table (migration 068) for DIKSHA/DigiLocker sync
- ✅ Admin module has `consent_handler.go`, `consent_service.go`, `consent_repository.go`
- ✅ Admin module has `reconciliation_handler.go` for APAAR/ABC verification
- ✅ JWT middleware with role-based access control
- ✅ Tenant isolation (per-school schemas)

**Frontend** (Schools24-frontend):
- ✅ Next.js 16 with App Router
- ✅ shadcn/ui components (Radix UI)
- ✅ React Hook Form + Zod validation
- ✅ TanStack Query for API calls
- ✅ AuthContext with role-based routing
- ✅ Admin dashboard with `/admin/compliance` route (placeholder?)
- ❌ NO parent pages/dashboard (role defined but no routes)
- ❌ NO parental consent workflow UI
- ❌ NO age verification UI indicators

### **Missing Enforcement Logic** ❌

**Backend Gaps:**
1. ❌ NO `isMinor()` function to calculate age from DOB
2. ❌ NO middleware to check parental consent before accessing minor data
3. ❌ NO tracking controls for minors (audit logs track everyone equally)
4. ❌ NO DSR execution logic (request workflow exists, but no automated data deletion)
5. ❌ NO APAAR ID auto-generation logic
6. ❌ NO mandatory APAAR ID validation at student creation

**Frontend Gaps:**
1. ❌ NO parental consent capture during student enrollment
2. ❌ NO parent dashboard to manage consent
3. ❌ NO privacy indicators (showing if user is minor, consent status)
4. ❌ NO admin UI for APAAR/ABC reconciliation (handler exists, no UI)
5. ❌ NO transfer workflow UI
6. ❌ NO DSR management UI for admins

---

## IMPLEMENTATION STRATEGY

### **Phase 1: Backend - Data Privacy Enforcement** (Priority: CRITICAL)

#### 1.1 Age Verification System
**File**: `internal/shared/utils/age_verification.go` (NEW)
```go
package utils

import "time"

// IsMinor determines if a date of birth indicates a minor (< 18 years old)
func IsMinor(dob time.Time) bool {
    now := time.Now()
    age := now.Year() - dob.Year()
    
    // Adjust if birthday hasn't occurred this year
    if now.Month() < dob.Month() || (now.Month() == dob.Month() && now.Day() < dob.Day()) {
        age--
    }
    
    return age < 18
}

// CalculateAge returns the age in years
func CalculateAge(dob time.Time) int {
    now := time.Now()
    age := now.Year() - dob.Year()
    
    if now.Month() < dob.Month() || (now.Month() == dob.Month() && now.Day() < dob.Day()) {
        age--
    }
    
    return age
}
```

**Usage**: Import in student/teacher/admin services

---

#### 1.2 Consent Enforcement Middleware
**File**: `internal/shared/middleware/consent.go` (NEW)
```go
package middleware

import (
    "github.com/gin-gonic/gin"
    "internal/modules/admin" // consent service
    "internal/shared/utils"
)

// RequireParentalConsent middleware checks if accessing minor data requires active consent
func RequireParentalConsent(consentService *admin.ConsentService) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Extract student ID from URL params or body
        studentID := c.Param("studentID") // or c.Param("id")
        if studentID == "" {
            c.Next()
            return
        }
        
        // Get student DOB
        student := getStudentByID(studentID) // TODO: inject student service
        
        // Check if minor
        if utils.IsMinor(student.DateOfBirth) {
            // Check active consent
            consent, err := consentService.GetActiveConsentByStudentID(studentID)
            if err != nil || consent == nil {
                c.AbortWithStatusJSON(403, gin.H{
                    "error": "Parental consent required to access minor's data",
                    "code": "CONSENT_REQUIRED",
                })
                return
            }
        }
        
        c.Next()
    }
}
```

**Apply to**:
- Student grades endpoints
- Student attendance endpoints
- Student homework endpoints
- Student profile update endpoints

---

#### 1.3 Tracking Controls for Minors
**Update**: `internal/shared/database/audit.go` (MODIFY EXISTING)

Add age check before logging:
```go
func LogAudit(userID, action, entityType string, entityID uuid.UUID) {
    // Get user's DOB if student
    if userRole == "student" {
        student := getStudentByUserID(userID)
        if utils.IsMinor(student.DateOfBirth) {
            // Check tracking consent
            consent := getActiveConsent(student.ID)
            if consent == nil || !consent.AllowsTracking {
                return // Skip logging for minors without consent
            }
        }
    }
    
    // Original audit logging logic
    db.Insert(AuditLog{...})
}
```

---

#### 1.4 APAAR ID Auto-Generation
**File**: `internal/shared/utils/apaar.go` (NEW)
```go
package utils

import (
    "crypto/rand"
    "fmt"
    "time"
)

// GenerateAPAARID generates a 16-character APAAR ID
// Format: APAAR-YYYYMMDD-XXXX (where XXXX is random alphanumeric)
// Example: APAAR-20260328-A7K9
func GenerateAPAARID() string {
    date := time.Now().Format("20060102") // YYYYMMDD
    
    // Generate 4-character random suffix (alphanumeric uppercase)
    const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    suffix := make([]byte, 4)
    randomBytes := make([]byte, 4)
    rand.Read(randomBytes)
    
    for i := range suffix {
        suffix[i] = charset[int(randomBytes[i])%len(charset)]
    }
    
    return fmt.Sprintf("APAAR-%s-%s", date, string(suffix))
}

// ValidateAPAARID validates APAAR ID format
func ValidateAPAARID(apaarID string) bool {
    if len(apaarID) != 19 { // APAAR-YYYYMMDD-XXXX = 19 chars
        return false
    }
    if apaarID[0:6] != "APAAR-" {
        return false
    }
    if apaarID[14] != '-' {
        return false
    }
    // Additional validation logic
    return true
}
```

**Integration**: Modify `student/service.go` CreateStudent() to auto-generate APAAR ID

---

#### 1.5 DSR Execution Workflow
**Update**: `internal/modules/admin/consent_service.go` (ADD METHOD)
```go
func (s *ConsentService) ExecuteErasureRequest(dsrID uuid.UUID) error {
    // Get DSR
    dsr := s.repo.GetDSRByID(dsrID)
    if dsr.RequestType != "erasure" || dsr.Status != "approved" {
        return errors.New("DSR must be approved erasure request")
    }
    
    // Execute deletion
    studentID := dsr.SubjectStudentID
    
    // Cascade delete:
    // 1. Student grades
    s.gradeRepo.DeleteByStudentID(studentID)
    // 2. Student attendance
    s.attendanceRepo.DeleteByStudentID(studentID)
    // 3. Student homework
    s.homeworkRepo.DeleteByStudentID(studentID)
    // 4. Consent records
    s.consentRepo.DeleteByStudentID(studentID)
    // 5. Audit logs
    s.auditRepo.DeleteByStudentID(studentID)
    // 6. Student record
    s.studentRepo.PermanentDelete(studentID)
    // 7. User account
    s.userRepo.Delete(dsr.SubjectUserID)
    
    // Update DSR status
    s.repo.UpdateDSRStatus(dsrID, "completed")
    
    // Log audit event
    s.LogConsentAudit("dsr_completed", dsrID, nil)
    
    return nil
}
```

---

### **Phase 2: Frontend - UI Implementation** (Priority: HIGH)

#### 2.1 Parent Dashboard (NEW)
**Directory**: `src/app/parent/` (CREATE NEW)

**Pages to Create**:
1. `/parent/dashboard` - Overview (children list, recent activities)
2. `/parent/child/[id]/consent` - Manage consent for specific child
3. `/parent/child/[id]/data` - View child's data (grades, attendance)
4. `/parent/child/[id]/privacy` - Privacy settings
5. `/parent/requests` - Data Subject Requests (access, erasure, etc.)

**Example**: `src/app/parent/dashboard/page.tsx`
```typescript
'use client'

import { useAuth } from '@/contexts/AuthContext'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function ParentDashboard() {
  const { user } = useAuth()
  const { data: children } = useQuery({
    queryKey: ['parent-children'],
    queryFn: () => fetch('/api/parent/children').then(r => r.json())
  })

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Parent Dashboard</h1>
      
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {children?.map((child) => (
          <Card key={child.id}>
            <CardHeader>
              <h3 className="text-xl font-semibold">{child.full_name}</h3>
              <Badge variant={child.is_minor ? 'warning' : 'default'}>
                {child.is_minor ? 'Minor (< 18)' : 'Adult'}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p><strong>Class:</strong> {child.class_name}</p>
                <p><strong>Admission #:</strong> {child.admission_number}</p>
                <p><strong>APAAR ID:</strong> {child.apaar_id || 'Pending'}</p>
                
                <div className="mt-4">
                  <h4 className="font-semibold mb-2">Consent Status:</h4>
                  <Badge variant={child.consent_status === 'active' ? 'success' : 'destructive'}>
                    {child.consent_status}
                  </Badge>
                </div>
                
                <div className="mt-4 flex gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/parent/child/${child.id}/consent`}>
                      Manage Consent
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/parent/child/${child.id}/data`}>
                      View Data
                    </Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

---

#### 2.2 Student Enrollment with Parental Consent
**Update**: `src/app/admin/users/students/create/page.tsx` (MODIFY EXISTING)

Add conditional parental consent form:
```typescript
const studentForm = useForm({
  schema: z.object({
    full_name: z.string(),
    email: z.string().email(),
    date_of_birth: z.date(),
    // ... other fields
    
    // Conditional: if DOB indicates minor (< 18)
    guardian_name: z.string().optional(),
    guardian_phone: z.string().optional(),
    guardian_email: z.string().email().optional(),
    guardian_relation: z.enum(['father', 'mother', 'legal_guardian']).optional(),
    consent_method: z.enum(['otp', 'written', 'digital']).optional(),
  }).refine((data) => {
    const isMinor = calculateAge(data.date_of_birth) < 18
    if (isMinor) {
      // Require guardian fields for minors
      return data.guardian_name && data.guardian_phone && data.guardian_relation
    }
    return true
  }, {
    message: "Parental consent required for students under 18 years"
  })
})

// In JSX:
{isMinor && (
  <Card className="border-yellow-500 bg-yellow-50">
    <CardHeader>
      <AlertTriangle className="h-5 w-5 text-yellow-600" />
      <h3 className="text-lg font-semibold">Parental Consent Required (DPDPA 2023)</h3>
    </CardHeader>
    <CardContent>
      <p className="text-sm mb-4">Student is under 18 years old. Parental consent is mandatory.</p>
      
      <FormField
        control={form.control}
        name="guardian_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Guardian Name *</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
          </FormItem>
        )}
      />
      
      {/* Guardian phone, email, relation fields... */}
      
      <FormField
        control={form.control}
        name="consent_method"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Consent Verification Method *</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <SelectTrigger>
                <SelectValue placeholder="Select method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="otp">OTP to Phone (Recommended)</SelectItem>
                <SelectItem value="written">Written Consent Form</SelectItem>
                <SelectItem value="digital">Digital Signature</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
        )}
      />
      
      {consentMethod === 'otp' && (
        <Button type="button" onClick={sendOTP}>
          Send OTP to Guardian
        </Button>
      )}
    </CardContent>
  </Card>
)}
```

---

#### 2.3 Admin Reconciliation Dashboard
**Create**: `src/app/admin/compliance/reconciliation/page.tsx` (NEW)

```typescript
'use client'

export default function ReconciliationDashboard() {
  const { data: unverified } = useQuery({
    queryKey: ['unverified-students'],
    queryFn: () => fetch('/api/admin/learners/unverified').then(r => r.json())
  })

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">APAAR/ABC Reconciliation</h1>
      
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">Unverified Students ({unverified?.length || 0})</h2>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Admission #</TableHead>
                <TableHead>APAAR ID</TableHead>
                <TableHead>ABC ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unverified?.map((student) => (
                <TableRow key={student.id}>
                  <TableCell>{student.full_name}</TableCell>
                  <TableCell>{student.admission_number}</TableCell>
                  <TableCell>
                    {student.apaar_id ? (
                      <Badge variant="success">{student.apaar_id}</Badge>
                    ) : (
                      <Badge variant="destructive">Not Set</Badge>
                    )}
                  </TableCell>
                  <TableCell>{student.abc_id || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={student.verified ? 'success' : 'warning'}>
                      {student.verified ? 'Verified' : 'Pending'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      onClick={() => verifyStudent(student.id)}
                    >
                      Verify with Registry
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
```

---

### **Phase 3: Auto-Generation vs Manual Entry** (Decision)

#### **APAAR ID: AUTO-GENERATE** ✅
**Reasoning**:
- APAAR IDs follow a standard format (16 chars, unique)
- Backend can ensure uniqueness via database constraints
- Reduces human error in data entry
- Faster enrollment process

**Implementation**:
- Auto-generate on student creation
- Display in UI as read-only field
- Allow admin override if needed (existing APAAR from transfer)

**Code Location**: `internal/modules/student/service.go`
```go
func (s *Service) CreateStudent(req CreateStudentRequest) error {
    // Auto-generate APAAR ID if not provided
    if req.APAARId == "" {
        req.APAARId = utils.GenerateAPAARID()
    }
    
    // Validate uniqueness
    exists := s.repo.APAARExists(req.APAARId)
    if exists {
        return ErrDuplicateAPAAR
    }
    
    // Continue with student creation...
}
```

---

#### **ABC ID: MANUAL ENTRY (Initially)** ⚠️
**Reasoning**:
- ABC IDs are assigned by government registry
- Schools don't generate, they receive from ABC portal
- Student must first register on ABC portal, then provide ID to school

**Implementation**:
- Optional field during enrollment
- Admin can add later via "Edit Student" page
- UI shows "Register on ABC" link if not set

**Future Enhancement**: API integration with ABC registry to auto-fetch after APAAR verification

---

#### **Parental Consent: SEMI-AUTO** ✅
**Reasoning**:
- Age verification is automatic (calculated from DOB)
- Consent capture is manual (guardian provides info + OTP)
- Consent status is automatic (system tracks active/withdrawn/expired)

**Implementation**:
```
1. Student DOB entered → System calculates age → isMinor flag set
2. If isMinor = true → Form expands to show parental consent section
3. Guardian enters info + OTP sent → Guardian verifies → Consent record created
4. System automatically checks consent before data access (middleware)
```

---

## UI ACCESS MAP

### **Where Users Access NDEAR Features**

#### **Admin** (Primary NDEAR Manager)

| Feature | Location | Path |
|---------|----------|------|
| **Student Enrollment with Consent** | Admin → Users → Add Student | `/admin/users/students/create` |
| **APAAR/ABC Reconciliation** | Admin → Compliance → Reconciliation | `/admin/compliance/reconciliation` |
| **Consent Management** | Admin → Compliance → Consents | `/admin/compliance/consents` |
| **Data Subject Requests (DSR)** | Admin → Compliance → DSR | `/admin/compliance/dsr` |
| **Transfer Workflow** | Admin → Transfers | `/admin/transfers` |
| **Interop Jobs (DIKSHA/DigiLocker)** | Admin → Interop | `/admin/interop` |
| **Consent Audit Trail** | Admin → Compliance → Audit | `/admin/compliance/audit` |

**New Pages to Create**:
- `/admin/compliance/reconciliation` - APAAR/ABC verification
- `/admin/compliance/consents` - View all parental consents
- `/admin/compliance/dsr` - DSR management
- `/admin/compliance/audit` - Consent audit events

---

#### **Parent** (NEW ROLE)

| Feature | Location | Path |
|---------|----------|------|
| **Dashboard** | Parent → Dashboard | `/parent/dashboard` |
| **Manage Child Consent** | Parent → Child → Consent | `/parent/child/[id]/consent` |
| **View Child Data** | Parent → Child → Data | `/parent/child/[id]/data` |
| **Privacy Settings** | Parent → Child → Privacy | `/parent/child/[id]/privacy` |
| **Submit DSR** | Parent → Requests | `/parent/requests` |
| **Withdraw Consent** | Parent → Child → Consent → Withdraw | `/parent/child/[id]/consent` |

**New Pages to Create**: ALL (parent role has NO current pages)

---

#### **Student** (View Only)

| Feature | Location | Path |
|---------|----------|------|
| **View Own APAAR ID** | Student → Dashboard (badge) | `/student/dashboard` |
| **View Consent Status** | Student → Privacy | `/student/privacy` (NEW) |
| **Transfer Request Status** | Student → Profile | `/student/profile` (add section) |

**Modifications**:
- Add APAAR ID badge to `/student/dashboard`
- Create `/student/privacy` page showing consent status (read-only)

---

#### **Teacher** (No Direct Access)

Teachers do NOT access NDEAR features directly. They interact with students, and the system enforces consent checks behind the scenes.

**Example**: When teacher views student grades, middleware checks parental consent automatically.

---

#### **Super Admin** (Global Oversight)

| Feature | Location | Path |
|---------|----------|------|
| **Global Reconciliation** | Super Admin → Reconciliation | `/super-admin/reconciliation` (NEW) |
| **Cross-School Learner Registry** | Super Admin → Learners | `/super-admin/learners` (NEW) |
| **NDEAR Compliance Report** | Super Admin → Reports | `/super-admin/reports/ndear` (NEW) |

---

## IMPLEMENTATION CHECKLIST

### **Backend** (Priority: CRITICAL → HIGH → MEDIUM)

- [ ] **P0**: Create `internal/shared/utils/age_verification.go` (IsMinor, CalculateAge)
- [ ] **P0**: Create `internal/shared/middleware/consent.go` (RequireParentalConsent)
- [ ] **P0**: Modify `internal/shared/database/audit.go` (add age check before logging)
- [ ] **P1**: Create `internal/shared/utils/apaar.go` (GenerateAPAARID, ValidateAPAARID)
- [ ] **P1**: Modify `internal/modules/student/service.go` (auto-generate APAAR on create)
- [ ] **P1**: Add `ExecuteErasureRequest()` to `internal/modules/admin/consent_service.go`
- [ ] **P2**: Add OAuth2 implementation (Google, Microsoft)

### **Frontend** (Priority: CRITICAL → HIGH → MEDIUM)

- [ ] **P0**: Create `/parent/*` pages (dashboard, consent, data, privacy, requests)
- [ ] **P0**: Modify `/admin/users/students/create` (add parental consent flow)
- [ ] **P1**: Create `/admin/compliance/reconciliation` page
- [ ] **P1**: Create `/admin/compliance/consents` page
- [ ] **P1**: Create `/admin/compliance/dsr` page
- [ ] **P1**: Create `/admin/compliance/audit` page
- [ ] **P2**: Add APAAR ID badge to `/student/dashboard`
- [ ] **P2**: Create `/student/privacy` page

### **Testing**
- [ ] Test age verification logic (boundary cases: exactly 18, 17.99 years)
- [ ] Test consent enforcement (minor without consent should be blocked)
- [ ] Test tracking controls (minor actions not logged without consent)
- [ ] Test APAAR auto-generation (uniqueness, format)
- [ ] Test DSR execution (data actually deleted)
- [ ] Test UI flows for all user roles

---

## SUCCESS METRICS

### **Target Scores (After Implementation)**

| Pillar | Current | Target | Gap |
|--------|---------|--------|-----|
| **Federated Identity** | 85/100 | 95/100 | +10 (APAAR auto-gen, reconciliation UI) |
| **Open APIs** | 89/100 | 95/100 | +6 (OAuth2, complete OpenAPI docs) |
| **Data Privacy (DPDPA)** | 42/100 | 95/100 | +53 (enforcement logic + UI) |
| **Weighted Total** | 73/100 | 95/100 | +22 |

### **Compliance Checklist (Post-Implementation)**

- [x] Age verification implemented
- [x] Parental consent enforced at data access
- [x] Tracking controls for minors
- [x] APAAR ID auto-generation
- [x] Reconciliation UI
- [x] Parent dashboard
- [x] DSR execution workflow
- [x] Consent audit trail
- [x] Transfer workflow UI

---

## NEXT STEPS

1. **Phase 1**: Implement backend enforcement logic (age verification, consent middleware, tracking controls)
2. **Phase 2**: Implement parent dashboard and consent UI
3. **Phase 3**: Implement admin compliance dashboards
4. **Phase 4**: Testing and documentation
5. **Phase 5**: Deploy and monitor

**Estimated Timeline**: 4-6 weeks with 2 developers

**Estimated Cost**: $37,500 - $50,000 (as per initial estimate)

---

**Document Created**: March 28, 2026  
**Status**: Ready for Implementation  
**Next Action**: Start with Phase 1 (Backend enforcement logic)
