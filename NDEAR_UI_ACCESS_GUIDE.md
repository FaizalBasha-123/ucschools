# NDEAR IMPLEMENTATION STATUS & UI ACCESS GUIDE

**Date**: March 28, 2026  
**Repository**: D:\Schools24-Workspace\  
**Implementation Phase**: 1 of 4 (Backend Foundation)

---

## ✅ COMPLETED IMPLEMENTATIONS

### **1. Age Verification System** (CRITICAL - DONE)
**File**: `internal/shared/utils/age_verification.go`

**Functions Created**:
- `IsMinor(dob time.Time) bool` - Determines if user is < 18 years old
- `CalculateAge(dob time.Time) int` - Returns age in years
- `WillBeMinorOn(dob, futureDate time.Time) bool` - Checks future minor status
- `DaysUntil18thBirthday(dob time.Time) int` - Days remaining until age 18

**Usage Example**:
```go
import "internal/shared/utils"

student := getStudent(studentID)
if utils.IsMinor(student.DateOfBirth) {
    // Apply DPDPA 2023 minor protections
    requireParentalConsent()
}
```

**Impact**: Foundation for all DPDPA 2023 minor data protection

---

### **2. APAAR/ABC ID Generation** (HIGH - DONE)
**File**: `internal/shared/utils/apaar.go`

**Functions Created**:
- `GenerateAPAARID() string` - Auto-generates unique APAAR ID (format: AP20260328A7K9M2)
- `ValidateAPAARID(id string) bool` - Validates APAAR ID format
- `GenerateABCID(seq int) string` - Generates ABC ID (format: ABC-2026-000123)
- `ValidateABCID(id string) bool` - Validates ABC ID format
- `ParseAPAARDate(id string) (time.Time, error)` - Extracts date from APAAR ID

**Auto-Generation Strategy**:
- ✅ **APAAR ID**: Auto-generated on student creation (reduces errors, ensures uniqueness)
- ⚠️ **ABC ID**: Manual entry initially (assigned by government ABC portal)

**Impact**: Federated Identity pillar - ensures every student has portable national ID

---

## 🚧 IN PROGRESS / PENDING

### **Phase 2: Consent Enforcement Middleware** (CRITICAL - NEXT)

**File to Create**: `internal/shared/middleware/consent.go`

**Purpose**: Block access to minor's data unless parental consent is active

**Endpoints to Protect**:
- Student grades: `GET /api/v1/student/:id/grades`
- Student attendance: `GET /api/v1/student/:id/attendance`
- Student homework: `GET /api/v1/student/:id/homework`
- Student profile: `PUT /api/v1/student/:id`

**Implementation Approach**:
```go
func RequireParentalConsent(consentService *admin.ConsentService) gin.HandlerFunc {
    return func(c *gin.Context) {
        studentID := c.Param("id")
        student := getStudent(studentID)
        
        if utils.IsMinor(student.DateOfBirth) {
            consent, _ := consentService.GetActiveConsentByStudentID(studentID)
            if consent == nil {
                c.JSON(403, gin.H{"error": "Parental consent required"})
                c.Abort()
                return
            }
        }
        c.Next()
    }
}
```

---

### **Phase 3: Parent Dashboard UI** (CRITICAL - PENDING)

**Pages to Create**:
1. `/parent/dashboard` - Main parent dashboard
2. `/parent/child/[id]/consent` - Manage consent for child
3. `/parent/child/[id]/data` - View child's academic data
4. `/parent/child/[id]/privacy` - Privacy settings
5. `/parent/requests` - Data Subject Requests (DSR)

**Priority**: Create parent role routing in `src/middleware.ts` first

---

### **Phase 4: Admin Compliance Dashboards** (HIGH - PENDING)

**Pages to Create**:
1. `/admin/compliance/reconciliation` - APAAR/ABC verification
2. `/admin/compliance/consents` - View all parental consents
3. `/admin/compliance/dsr` - Manage Data Subject Requests
4. `/admin/compliance/audit` - Consent audit trail

---

## 📍 UI ACCESS MAP: Where Users Find NDEAR Features

### **Admin** (Primary NDEAR Manager)

**Current Working Features** (Backend APIs exist):
| Feature | UI Location | API Endpoint | Status |
|---------|-------------|--------------|--------|
| View Consents | ❌ Not built | `GET /api/v1/admin/consent/history` | Backend ✅, UI ❌ |
| Withdraw Consent | ❌ Not built | `POST /api/v1/admin/consent/:id/withdraw` | Backend ✅, UI ❌ |
| View DSRs | ❌ Not built | `GET /api/v1/admin/dsr` | Backend ✅, UI ❌ |
| Create DSR | ❌ Not built | `POST /api/v1/admin/dsr` | Backend ✅, UI ❌ |
| View Audit Events | ❌ Not built | `GET /api/v1/admin/consent/audit` | Backend ✅, UI ❌ |
| Verify Learner Identity | ❌ Not built | `POST /api/v1/admin/learners/:id/verify` | Backend ✅, UI ❌ |
| View Unverified Learners | ❌ Not built | `GET /api/v1/admin/learners/unverified` | Backend ✅, UI ❌ |
| Interop Jobs | ❌ Not built | `GET /api/v1/admin/interop/jobs` | Backend ✅, UI ❌ |

**Recommended Admin Menu Structure**:
```
Admin Menu
├── Dashboard
├── Users
│   ├── Students (existing)
│   └── Teachers (existing)
├── Academic (existing)
├── Operations (existing)
├── **Compliance** ← NEW SECTION
│   ├── Reconciliation (APAAR/ABC verification)
│   ├── Consents (Parental consents management)
│   ├── Data Requests (DSR workflow)
│   ├── Audit Trail (Consent events)
│   └── Interop Jobs (DIKSHA/DigiLocker sync status)
└── Settings
```

**How Admins Will Access**:
1. Login to admin account → `/admin/dashboard`
2. Click "Compliance" in sidebar (NEW section to add)
3. Select subsection:
   - **Reconciliation**: See students without APAAR IDs, verify with government registry
   - **Consents**: View all parental consents, see active/withdrawn status
   - **Data Requests**: Manage DSR (access, erasure, portability requests from parents)
   - **Audit Trail**: View immutable log of all consent actions

---

### **Parent** (NEW ROLE - All Pages Need to be Built)

**Planned Access Flow**:
1. Parent logs in → Automatic redirect to `/parent/dashboard`
2. Dashboard shows list of children enrolled in school
3. For each child, parent can:
   - View consent status (active/withdrawn/expired)
   - Manage consent (grant, withdraw, update scope)
   - View child's academic data (grades, attendance, homework)
   - Submit Data Subject Requests (access data, request deletion)

**Parent Menu Structure** (All NEW):
```
Parent Menu
├── Dashboard (children list with consent badges)
├── My Children
│   └── [Child Name]
│       ├── Consent Management
│       ├── Academic Data
│       ├── Privacy Settings
│       └── Attendance & Performance
├── Data Requests (DSR submission)
└── Settings
```

**Key UX Considerations for Parents**:
- ✅ **Simple Language**: Avoid jargon, use plain language ("Allow school to track attendance")
- ✅ **Visual Indicators**: Green badge = consent active, Red badge = consent required
- ✅ **One-Click Actions**: "Grant Consent" button, OTP sent to phone
- ✅ **Transparency**: Show exactly what data is collected and why
- ✅ **Withdrawal**: Easy "Withdraw Consent" button with confirmation dialog

---

### **Student** (View Only - Minor Enhancements)

**Current Pages** (Existing):
- `/student/dashboard` - Main dashboard

**Proposed Enhancements**:
1. Add **APAAR ID Badge** to dashboard:
   ```tsx
   <Card>
     <CardHeader>
       <h3>My Identity</h3>
     </CardHeader>
     <CardContent>
       <div className="flex items-center gap-2">
         <Badge variant="outline">APAAR ID</Badge>
         <code className="text-sm">{student.apaar_id}</code>
         <CheckCircle className="h-4 w-4 text-green-500" />
       </div>
       {student.is_minor && (
         <p className="text-xs text-muted-foreground mt-2">
           🔒 Protected under DPDPA 2023 (minor data protection)
         </p>
       )}
     </CardContent>
   </Card>
   ```

2. Create **Privacy Page** (`/student/privacy`):
   - Show consent status (if minor)
   - Show what data is being collected
   - Link to parent contact for consent questions

**Student Access Flow**:
- Login → `/student/dashboard` → See APAAR ID badge (read-only)
- Click "Privacy" in menu → See consent status + data collection transparency

---

### **Teacher** (No Direct Access - Transparent Enforcement)

**No UI Changes Needed**. Teachers interact with students normally, and the system enforces consent checks **behind the scenes**.

**Example**:
- Teacher clicks "View Student Grades" for a minor student
- Middleware checks parental consent automatically
- If consent missing: Show error "Cannot access minor's data - parental consent required"
- Teacher is redirected to tell admin to obtain consent

**Error Message Example**:
```tsx
<Alert variant="destructive">
  <AlertCircle className="h-4 w-4" />
  <AlertTitle>Parental Consent Required</AlertTitle>
  <AlertDescription>
    This student is under 18 years old. Parental consent is required to view academic data.
    Please contact the admin to request parental consent.
  </AlertDescription>
</Alert>
```

---

### **Super Admin** (Global Oversight)

**Planned Pages**:
1. `/super-admin/reconciliation` - Cross-school learner registry
2. `/super-admin/compliance/report` - NDEAR compliance scores across all schools

**How Super Admins Access**:
- Login → `/super-admin` → See global school list
- Click "Compliance Report" → See aggregated NDEAR scores:
  - % students with APAAR IDs
  - % students with active parental consent
  - % schools with DIKSHA sync enabled
  - DSR response time metrics

---

## 🎯 AUTO-GENERATION DECISIONS

### **What Gets Auto-Generated?**

| Item | Auto-Generate? | Reasoning |
|------|----------------|-----------|
| **APAAR ID** | ✅ YES | Reduces errors, ensures uniqueness, faster enrollment |
| **ABC ID** | ❌ NO (initially) | Assigned by government ABC portal, not school-generated |
| **Learner ID** | ✅ YES | Internal cross-school tracking, auto-generated UUID |
| **Consent Reference** | ✅ YES | Unique reference for each consent record, auto-generated |
| **is_minor Flag** | ✅ YES | Calculated from DOB on every data access |

### **How Auto-Generation Works**

#### **APAAR ID** (On Student Creation)
```go
// File: internal/modules/student/service.go
func (s *Service) CreateStudent(req CreateStudentRequest) error {
    // Auto-generate if not provided (e.g., transfer student may have existing)
    if req.APAARId == "" {
        req.APAARId = utils.GenerateAPAARID()
    }
    
    // Validate uniqueness
    if s.repo.APAARExists(req.APAARId) {
        return errors.New("APAAR ID already exists")
    }
    
    // Create student with APAAR ID
    student := &Student{
        APAARId:      req.APAARId,
        DateOfBirth:  req.DateOfBirth,
        // ... other fields
    }
    
    return s.repo.Create(student)
}
```

**UI Behavior**:
- Admin creates student → APAAR ID auto-generated → Shown in form (read-only)
- Admin can override if transferring student with existing APAAR ID

---

#### **is_minor Flag** (Runtime Calculation)
```go
// NOT stored in database (calculated on-the-fly from DOB)
student := getStudent(studentID)
isMinor := utils.IsMinor(student.DateOfBirth)

if isMinor {
    // Apply minor protections
}
```

**Why Not Store?**: 
- DOB changes age daily (student turns 18)
- Storing flag would require daily batch updates
- Runtime calculation is simpler and always accurate

---

## 🚀 NEXT STEPS TO REACH 90%+ SCORES

### **Immediate Actions** (This Week)

1. ✅ **DONE**: Create age verification utils
2. ✅ **DONE**: Create APAAR generation utils
3. ⏳ **IN PROGRESS**: Create consent enforcement middleware
4. ⏳ **TODO**: Integrate APAAR auto-generation into student creation
5. ⏳ **TODO**: Add age check to audit logging

### **Short-Term** (Next 2 Weeks)

6. Build parent dashboard UI (`/parent/*` pages)
7. Build admin compliance dashboards (`/admin/compliance/*` pages)
8. Modify student enrollment form to capture parental consent
9. Add APAAR ID badge to student dashboard

### **Medium-Term** (Next 4 Weeks)

10. Implement DSR execution logic (automated data deletion)
11. Add OAuth2 (Google/Microsoft SSO)
12. Create reconciliation UI (APAAR/ABC verification)
13. End-to-end testing with all user roles

---

## 📊 EXPECTED SCORE IMPROVEMENTS

| Pillar | Current | After Implementation | Improvement |
|--------|---------|---------------------|-------------|
| **Federated Identity** | 85/100 | 95/100 | +10 |
| **Open APIs** | 89/100 | 95/100 | +6 |
| **Data Privacy (DPDPA)** | 42/100 | 95/100 | +53 |
| **Weighted Total** | 73/100 | 95/100 | +22 |

### **Why 95% (Not 100%)?**

**Remaining 5% Gap**:
1. **Federated Identity (-5%)**: Waiting for official APAAR API integration from government (Option B onboarding)
2. **Open APIs (-5%)**: OAuth2 implementation + complete OpenAPI docs (327 endpoints)
3. **Data Privacy (-5%)**: Advanced features (consent expiry, re-consent prompts, behavioral tracking dashboard)

**These require**:
- Government API credentials (DIKSHA, DigiLocker, ABC - Option B process)
- Additional dev time (OAuth2, docs generation)
- User feedback on consent UX

---

## 📝 IMPLEMENTATION CHECKLIST

### **Backend** (8 tasks)

- [x] Create `internal/shared/utils/age_verification.go`
- [x] Create `internal/shared/utils/apaar.go`
- [ ] Create `internal/shared/middleware/consent.go`
- [ ] Modify `internal/modules/student/service.go` (integrate APAAR auto-gen)
- [ ] Modify `internal/shared/database/audit.go` (add age check)
- [ ] Add `ExecuteErasureRequest()` to `internal/modules/admin/consent_service.go`
- [ ] Add DSR execution endpoints to `internal/modules/admin/consent_handler.go`
- [ ] Test all backend changes with unit tests

### **Frontend** (12 tasks)

- [ ] Update `src/middleware.ts` (add parent role routing)
- [ ] Create `/parent/dashboard/page.tsx`
- [ ] Create `/parent/child/[id]/consent/page.tsx`
- [ ] Create `/parent/child/[id]/data/page.tsx`
- [ ] Create `/parent/requests/page.tsx`
- [ ] Modify `/admin/users/students/create/page.tsx` (add consent form)
- [ ] Create `/admin/compliance/reconciliation/page.tsx`
- [ ] Create `/admin/compliance/consents/page.tsx`
- [ ] Create `/admin/compliance/dsr/page.tsx`
- [ ] Create `/admin/compliance/audit/page.tsx`
- [ ] Add APAAR badge to `/student/dashboard/page.tsx`
- [ ] Create `/student/privacy/page.tsx`

### **Testing** (5 tasks)

- [ ] Test age verification (boundary: exactly 18 years old)
- [ ] Test consent enforcement (minor blocked without consent)
- [ ] Test APAAR auto-generation (uniqueness, format)
- [ ] Test DSR execution (data actually deleted)
- [ ] End-to-end user flow testing (all roles)

---

## 🔒 SECURITY & COMPLIANCE NOTES

### **DPDPA 2023 Compliance Checklist**

- [x] **Age Verification**: System can determine if user is minor (< 18)
- [ ] **Consent Enforcement**: Data access blocked for minors without consent
- [ ] **Tracking Controls**: Minors not tracked without explicit consent
- [ ] **Right to Erasure**: Automated data deletion on DSR approval
- [ ] **Consent Audit Trail**: Immutable log of consent actions (already exists)
- [ ] **Parental Controls**: Parent dashboard to manage consent
- [ ] **Data Minimization**: Review fields collected (already minimal)

### **NDEAR Federated Identity Checklist**

- [x] **UDISE+ Codes**: School identification (already exists)
- [x] **APAAR ID Generation**: Auto-generate portable student ID
- [ ] **ABC ID Support**: Manual entry (later: API integration)
- [ ] **Reconciliation**: Admin UI to verify against government registry
- [ ] **Transfer Workflow**: Student portability between schools
- [x] **Learner Registry**: Global cross-school tracking (table exists)

---

**Document Status**: Living document - updated as implementation progresses  
**Last Updated**: March 28, 2026  
**Next Review**: After Phase 2 completion (Consent Middleware)
