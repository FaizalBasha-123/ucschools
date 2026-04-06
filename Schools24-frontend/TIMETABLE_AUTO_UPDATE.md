# Timetable Auto-Update Implementation

## Overview
This implementation ensures that timetable changes made by admins automatically reflect in both teacher and student views without requiring manual refresh or page reload.

## Architecture

### 1. Centralized Timetable Store (`/src/lib/timetableStore.ts`)
- Uses localStorage for data persistence (simulates a backend database)
- Implements a pub-sub pattern for real-time updates
- Provides methods for getting, setting, and subscribing to timetable changes

### 2. React Hook (`/src/lib/useTimetable.ts`)
- Provides role-based access to timetable data
- **Admin role**: Gets read/write access with `updateTimetable` function
- **Teacher/Student roles**: Gets read-only access that auto-updates
- Automatically subscribes to changes and updates component state

### 3. Page Updates

#### Admin Pages (Editable)
- `/src/app/admin/students-timetable/page.tsx`
- `/src/app/admin/teachers-timetable/page.tsx`
- Use `useTimetable('admin')` to get update capabilities
- Changes are saved to the centralized store

#### Teacher Pages (Read-only)
- `/src/app/teacher/students-timetable/page.tsx` - View student timetables
- `/src/app/teacher/teachers-timetable/page.tsx` - View own timetable
- Use `useTimetable('teacher')` for read-only access
- Automatically receive updates when admin makes changes

#### Student Pages (Read-only)
- `/src/app/student/timetable/page.tsx`
- Use `useTimetable('student')` for read-only access
- Automatically receive updates when admin makes changes

## How It Works

1. **Admin makes a change**:
   - Admin edits a timetable slot
   - Calls `updateTimetable(newData)`
   - Data is saved to localStorage
   - All subscribers are notified

2. **Teachers/Students see the update**:
   - Their components are subscribed to the store
   - When notified, they automatically fetch the latest data
   - React re-renders with the new timetable
   - No manual refresh needed!

## Benefits

✅ **Real-time sync**: Changes appear immediately across all views
✅ **Role-based access**: Only admins can edit, others can only view
✅ **Persistent data**: Timetables survive page refreshes
✅ **Type-safe**: Full TypeScript support
✅ **Clean separation**: Clear distinction between admin and view-only pages

## Future Enhancements

For production deployment, replace the localStorage-based store with:
- Backend API (REST or GraphQL)
- Real-time database (Firebase, Supabase)
- WebSocket connections for instant updates
- Server-side state management (Redux, Zustand, etc.)

## Testing

1. Open the admin students-timetable page
2. Make a change to any timetable slot
3. Open the teacher students-timetable page (in a new tab or window)
4. The change should appear automatically without refresh!
5. Same applies for teacher timetables and student timetables
