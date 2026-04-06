# Frontend Structure

Location: `D:/uc-schools/Schools24-frontend/`

## Entry Point
`src/app/layout.tsx` (Next.js App Router)

## Directory Organization
```
src/
├── app/              # 84 pages (App Router)
├── components/       # 120+ components
├── hooks/           # 40+ custom hooks
├── contexts/        # Global state (Auth)
├── services/        # API clients
├── lib/             # Utilities
└── types/           # TypeScript definitions
```

## Page Structure (by role)
- **Public**: 10+ pages (login, admission, etc.)
- **Admin**: 20+ pages (dashboard, users, fees, etc.)
- **Teacher**: 15+ pages (dashboard, messages, homework, etc.)
- **Student**: 15+ pages (dashboard, timetable, attendance, etc.)
- **Super Admin**: 10+ pages (system-wide management)

## State Management
- **Server State**: TanStack React Query (caching)
- **Global State**: Context API (AuthContext)
- **Local State**: React useState
- **Timetable**: Custom hook + store

## Routing Convention
- `/admin/*` - Admin pages
- `/teacher/*` - Teacher pages
- `/student/*` - Student pages
- `/super-admin/*` - Super admin pages
- `/admission/[slug]` - Public embeddable forms
- `/api/*` - Next.js API routes
