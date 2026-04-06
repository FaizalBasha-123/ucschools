# Teacher API Routes

Base: `/api/v1/teacher`

## Dashboard & Classes
- `GET /teacher/classes` - List assigned classes
- `GET /teacher/timetable` - Teacher's timetable
- `GET /teacher/timetable/config` - Timetable config
- `GET /teacher/timetable/classes/:classId` - Class timetable

## Attendance
- `GET /teacher/attendance` - Attendance records
- `POST /teacher/attendance` - Mark attendance

## Homework
- `GET /teacher/homework/options` - Class/subject options
- `GET /teacher/homework` - List homework
- `POST /teacher/homework` - Create homework
- `GET /teacher/homework/:id/attachments/:attachmentId/view` - View attachment
- `GET /teacher/homework/:id/attachments/:attachmentId/download` - Download

## Quizzes
- `GET /teacher/quizzes/options` - Class/subject options
- `GET /teacher/quizzes` - List quizzes
- `POST /teacher/quizzes` - Schedule quiz

## Question Documents
- `GET /teacher/question-documents` - List documents (teacher + super-admin)
- `GET /teacher/question-documents/:id/view` - View document
- `GET /teacher/question-documents/:id/download` - Download
- `POST /teacher/question-uploader/options` - Upload options
- `POST /teacher/question-documents/upload` - Upload document

## Materials
- `GET /teacher/materials` - List materials
- `GET /teacher/materials/:id/view` - View material
- `GET /teacher/materials/:id/download` - Download
- `POST /teacher/materials/upload` - Upload material
- `DELETE /teacher/materials/:id` - Delete material

## Class Messaging
- `GET /teacher/messages/class-groups` - List class groups
- `GET /teacher/messages/class-groups/:classId/messages` - Class messages
- `POST /teacher/messages/class-groups/:classId/messages` - Send message
