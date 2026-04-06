# Frontend Components

Location: `src/components/`

## UI Components (26+)
Radix UI primitives in `components/ui/`:
- button, card, dialog, dropdown-menu
- input, label, select, textarea
- table, tabs, checkbox, tooltip
- accordion, popover, toggle-switch

## Layout Components
- `Header.tsx` - Top navigation bar
- `Sidebar.tsx` - Side navigation (role-based)
- `BackToTopButton.tsx` - Scroll utility

## Feature Components

### Admin Components
`components/admin/`
- `students/` - StudentTable, Add/Edit/View dialogs
- `teachers/` - EditTeacherDialog
- `leaderboard/` - LeaderboardPodium

### Transport Components
`components/transport/`
- `TrackBusDialog.tsx` - Real-time bus tracking
- `StopsBuilder.tsx` - Route stop management
- `StopAssignmentManager.tsx` - Student stop assignment

### Other Key Components
- `AdamChatbot.tsx` - AI chatbot component
- `CookieConsent.tsx` - GDPR cookie banner
- `OfflineBanner.tsx` - Network status indicator
- `PermissionPrompts.tsx` - Camera, location, notification permissions
- `PushTokenRegistration.tsx` - FCM push setup
- `PasswordSetupDialog.tsx` - First-time password setup

## Styling
- Tailwind CSS utility classes
- Dark mode support via `theme-provider.tsx`
- Custom CSS in `globals.css`
