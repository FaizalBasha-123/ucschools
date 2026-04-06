# System Architecture: User & Staff Isolation

This document illustrates how the application separates User Management from Staff Management at the database and API levels.

## 1. Database Schema (The "Source of Truth")

The system uses a **Base Table + Extension Table** pattern. Everyone is a User, but specialized roles have extra tables.

```mermaid
erDiagram
    USERS ||--o| TEACHERS : "1-to-1 (Extension)"
    USERS ||--o| NON_TEACHING_STAFF : "1-to-1 (Extension)"

    USERS {
        uuid id PK
        string email
        string role "('admin', 'student', 'teacher', 'staff')"
        string full_name
        uuid school_id
    }

    TEACHERS {
        uuid id PK
        uuid user_id FK "Links to USERS"
        string department "e.g. Mathematics"
        string qualification
        string[] subjects
    }

    NON_TEACHING_STAFF {
        uuid id PK
        uuid user_id FK "Links to USERS"
        string department "e.g. Security"
        string designation "e.g. Guard"
    }
```

## 2. API & Data Flow (The "Isolation Logic")

The Frontend calls distinct APIs. The Backend runs distinct queries to ensure no overlap.

```mermaid
flowchart TD
    subgraph Frontend
        PageUser[User Management Page]
        PageStaff[Staff Management Page]
    end

    subgraph Backend_API
        APIUser[GET /api/v1/admin/users]
        APIStaff[GET /api/v1/admin/staff]
    end

    subgraph Database_Queries
        QueryUser["SELECT * FROM users <br/> WHERE role != 'staff'<br/>(Includes Teachers)"]
        QueryStaff["SELECT * FROM non_teaching_staff <br/> JOIN users<br/>(Strictly Non-Teaching)"]
    end

    %% Data Flow
    PageUser -->|Request| APIUser
    APIUser -->|Execute| QueryUser
    QueryUser -->|Returns| ResultsUser[Admins, Students, Teachers]
    ResultsUser --> PageUser

    PageStaff -->|Request| APIStaff
    APIStaff -->|Execute| QueryStaff
    QueryStaff -->|Returns| ResultsStaff[Accountants, Guards, Drivers]
    ResultsStaff --> PageStaff

    %% Styling
    classDef page fill:#f9f,stroke:#333,stroke-width:2px;
    classDef db fill:#bfb,stroke:#333,stroke-width:2px;
    class PageUser,PageStaff page;
    class QueryUser,QueryStaff db;
```

## Key Distinctions

| Feature | User Management (`/users`) | Staff Management (`/staff`) |
| :--- | :--- | :--- |
| **Target Roles** | Admin, Student, **Teacher** | **Non-Teaching Staff** (only) |
| **Primary Table** | `users` | `non_teaching_staff` |
| **Logic** | "Show everyone except support staff" | "Show only support staff" |
